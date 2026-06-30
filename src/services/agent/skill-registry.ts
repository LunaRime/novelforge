/**
 * Skill 注册中心
 *
 * 管理所有可用的 Skill（基于 SKILL.md 的模块化知识包）。
 * 支持：
 * - 内置 Skill（随 Vela 发布的预设 Skill）
 * - 用户 Skill（用户放在 ~/.vela/skills/ 下的自定义 Skill）
 * - 项目 Skill（放在项目的 .vela/skills/ 下的项目级 Skill）
 *
 * Skill 格式兼容 Cursor 的 SKILL.md 生态。
 */

import { ipc } from '../ipc-client'
import { useProjectStore } from '../../stores/project-store'
import { toolRegistry, type AgentTool } from './tool-registry'

// ===== 类型定义 =====

/** Skill 来源 */
export type SkillSource = 'builtin' | 'user' | 'project'

/** Skill 元数据（从 SKILL.md frontmatter 解析） */
export interface SkillMetadata {
  /** Skill 唯一名称 */
  name: string
  /** 显示名称 */
  displayName?: string
  /** 功能描述 */
  description: string
  /** 使用场景（用于 Agent 自动匹配） */
  whenToUse?: string
  /** 版本 */
  version?: string
  /** 允许的工具列表（白名单） */
  allowedTools?: string[]
  /** 参数提示 */
  argumentHint?: string
  /** 是否可由模型自动调用 */
  userInvocable?: boolean
}

/** 加载后的 Skill */
export interface LoadedSkill {
  /** 元数据 */
  metadata: SkillMetadata
  /** Skill 内容（Markdown 提示词） */
  content: string
  /** 来源 */
  source: SkillSource
  /** 文件所在目录 */
  baseDir: string
  /** SKILL.md 文件路径 */
  filePath: string
}

// ===== Skill Registry =====

class SkillRegistryImpl {
  private skills: Map<string, LoadedSkill> = new Map()

  /** 注册一个 Skill */
  register(skill: LoadedSkill): void {
    this.skills.set(skill.metadata.name, skill)
  }

  /** 查找 Skill */
  get(name: string): LoadedSkill | undefined {
    return this.skills.get(name)
  }

  /** 列出所有 Skill */
  listAll(): LoadedSkill[] {
    return Array.from(this.skills.values())
  }

  /** 按来源列出 */
  listBySource(source: SkillSource): LoadedSkill[] {
    return this.listAll().filter(s => s.source === source)
  }

  /** Skill 数量 */
  get size(): number {
    return this.skills.size
  }

  /** 清空 */
  clear(): void {
    this.skills.clear()
  }

  /**
   * 从目录加载 Skills
   *
   * 扫描指定目录下的 skill-name/SKILL.md 格式
   */
  async loadFromDirectory(dir: string, source: SkillSource): Promise<number> {
    let count = 0
    try {
      const entries = await ipc.invoke('fs:list-dir', dir)
      for (const entry of entries) {
        if (!entry.isDir) continue

        const skillFile = `${entry.path}/SKILL.md`
        try {
          const exists = await ipc.invoke('fs:check-exists', skillFile)
          if (!exists) continue

          const result = await ipc.invoke('fs:read-file', skillFile)
          if (!result.success) continue

          const skill = parseSkillMd(result.content, entry.name, source, entry.path, skillFile)
          if (skill) {
            this.register(skill)
            count++
          }
        } catch {
          // 单个 Skill 加载失败不影响整体
        }
      }
    } catch {
      // 目录不存在等情况，静默处理
    }
    return count
  }

  /**
   * 加载所有 Skill（内置 + 用户 + 项目）
   */
  async loadAll(): Promise<void> {
    this.clear()

    // 注册内置 Skill
    registerBuiltinSkills(this)

    // 加载用户 Skill（~/.vela/skills/）
    try {
      const velaHome = await ipc.invoke('config:get-vela-home')
      const userSkillsDir = `${velaHome}/skills`
      const userCount = await this.loadFromDirectory(userSkillsDir, 'user')
      if (userCount > 0) {
        console.log(`[Skills] 加载了 ${userCount} 个用户 Skill`)
      }
    } catch {
      // 静默处理
    }

    // 加载项目 Skill（项目/.vela/skills/）
    const project = useProjectStore.getState().currentProject
    if (project) {
      const projectSkillsDir = `${project.path}/.vela/skills`
      const projectCount = await this.loadFromDirectory(projectSkillsDir, 'project')
      if (projectCount > 0) {
        console.log(`[Skills] 加载了 ${projectCount} 个项目 Skill`)
      }
    }

    // 将所有 Skill 注册为 Agent Tool
    this.registerToToolRegistry()

    console.log(`[Skills] 共加载 ${this.size} 个 Skill`)
  }

  /**
   * 将 Skill 注册为 Agent Tool
   */
  private registerToToolRegistry(): void {
    // 先清理旧的 Skill Tool
    toolRegistry.unregisterBySource('skill')

    for (const skill of this.listAll()) {
      const agentTool: AgentTool = {
        name: `skill__${skill.metadata.name}`,
        description: skill.metadata.description + (skill.metadata.whenToUse ? ` — ${skill.metadata.whenToUse}` : ''),
        source: 'skill',
        inputSchema: {
          type: 'object',
          properties: {
            args: {
              type: 'string',
              description: skill.metadata.argumentHint ?? '可选的参数',
            },
          },
        },
        requiresConfirmation: false,
        isReadOnly: true,
        userFacingName: skill.metadata.displayName ?? skill.metadata.name,
        execute: async (toolArgs) => {
          const userArgs = (toolArgs.args as string) ?? ''
          // 变量替换
          let content = skill.content
          if (userArgs) {
            content = content.replace(/\$\{args\}/g, userArgs)
            content = content.replace(/\$1/g, userArgs)
          }
          content = content.replace(/\$\{SKILL_DIR\}/g, skill.baseDir)

          return {
            success: true,
            content: `[Skill: ${skill.metadata.displayName ?? skill.metadata.name}]\n\n${content}`,
          }
        },
      }
      toolRegistry.register(agentTool)
    }
  }
}

/** 全局 Skill 注册中心 */
export const skillRegistry = new SkillRegistryImpl()

// ===== SKILL.md 解析 =====

/**
 * 解析 SKILL.md 文件内容
 *
 * 格式：
 * ```
 * ---
 * name: skill-name
 * description: 功能描述
 * when_to_use: 什么时候使用
 * allowed-tools: [read_file, search_knowledge]
 * ---
 *
 * # Skill 提示词内容
 * ...
 * ```
 */
function parseSkillMd(
  raw: string,
  fallbackName: string,
  source: SkillSource,
  baseDir: string,
  filePath: string,
): LoadedSkill | null {
  // 解析 frontmatter
  const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n/)
  const frontmatter: Record<string, unknown> = {}
  let content = raw

  if (fmMatch) {
    const fmText = fmMatch[1]
    content = raw.slice(fmMatch[0].length)

    // 简单的 YAML 解析（支持 key: value 和 key: [items]）
    for (const line of fmText.split('\n')) {
      const kvMatch = line.match(/^\s*([^:]+):\s*(.*)$/)
      if (!kvMatch) continue
      const key = kvMatch[1].trim()
      let val: unknown = kvMatch[2].trim()

      // 解析数组 [a, b, c]
      if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map(s => s.trim()).filter(Boolean)
      }
      // 解析布尔值
      if (val === 'true') val = true
      if (val === 'false') val = false

      frontmatter[key] = val
    }
  }

  const metadata: SkillMetadata = {
    name: (frontmatter['name'] as string) || fallbackName,
    displayName: frontmatter['display_name'] as string,
    description: (frontmatter['description'] as string) || `Skill: ${fallbackName}`,
    whenToUse: frontmatter['when_to_use'] as string,
    version: frontmatter['version'] as string,
    allowedTools: frontmatter['allowed-tools'] as string[],
    argumentHint: frontmatter['argument-hint'] as string,
    userInvocable: frontmatter['user-invocable'] !== false,
  }

  return {
    metadata,
    content: content.trim(),
    source,
    baseDir,
    filePath,
  }
}

// ===== 内置 Skills =====

function registerBuiltinSkills(registry: SkillRegistryImpl): void {
  const builtins: Array<{ metadata: SkillMetadata; content: string }> = [
    {
      metadata: {
        name: 'review-chapter',
        displayName: '章节审阅',
        description: '对指定章节进行全面的质量审阅，包括剧情逻辑、角色一致性、节奏感、伏笔呼应等多个维度。',
        whenToUse: '用户要求审阅、检查、评估某个章节时',
      },
      content: `# 章节审阅

请对目标章节进行专业的小说审阅。依次检查以下维度：

## 1. 剧情逻辑
- 情节是否连贯，有无逻辑矛盾
- 因果关系是否成立

## 2. 角色一致性
- 角色行为是否符合既定性格
- 对话风格是否一致

## 3. 节奏感
- 张弛是否有度
- 是否有不必要的拖沓或过于仓促的转折

## 4. 伏笔与呼应
- 已有伏笔是否得到了回应
- 新埋的伏笔是否自然

## 5. 文笔与风格
- 描写是否生动
- 是否符合整体文风设定

请先使用 read_drafts 工具读取目标章节，再使用 read_architecture 读取故事架构进行对比评估。
输出格式：每个维度评分（1-5星）+ 详细说明 + 修改建议。`,
    },
    {
      metadata: {
        name: 'brainstorm',
        displayName: '脑暴创意',
        description: '针对指定话题进行创意脑暴，生成多个创意方向和灵感。',
        whenToUse: '用户要求头脑风暴、找灵感、想创意时',
      },
      content: `# 创意脑暴

请围绕用户给出的话题进行专业的创意脑暴。

## 输出格式
为每个创意方向提供：
1. **创意概念**（一句话）
2. **详细展开**（100-200 字）
3. **可行性评估**（高/中/低）
4. **与已有剧情的融合度**

请先使用 read_architecture 和 read_project_state 了解项目背景，确保创意与现有设定不矛盾。
至少提供 5 个不同方向的创意。`,
    },
    {
      metadata: {
        name: 'character-analysis',
        displayName: '角色分析',
        description: '深入分析指定角色的性格、动机、角色弧、人物关系等。',
        whenToUse: '用户想深入了解或调整角色设定时',
      },
      content: `# 角色深度分析

请对目标角色进行全方位的深度分析。

## 分析维度
1. **核心性格特质** — MBTI、大五人格倾向
2. **深层动机** — 驱动角色行动的核心诉求
3. **角色弧预测** — 基于当前设定推演角色成长轨迹
4. **关系网络** — 与其他角色的关系图谱
5. **冲突点** — 角色面临的核心矛盾和困境
6. **独特标识** — 口头禅、习惯动作、标志性特征

请先使用 read_characters 读取角色卡，以及 read_architecture 了解故事结构。`,
    },
    {
      metadata: {
        name: 'continuity-check',
        displayName: '连续性检查',
        description: '检查小说中的设定一致性和连续性问题，发现矛盾和遗漏。',
        whenToUse: '用户想检查设定有没有矛盾、是否有不一致的地方时',
      },
      content: `# 连续性与一致性检查

请对项目进行全面的连续性检查。

## 检查项
1. **时间线一致性** — 事件发生顺序是否合理
2. **地理一致性** — 地点描述是否前后一致
3. **角色状态** — 角色的伤病、装备、能力等是否正确追踪
4. **设定遵守** — 是否与世界观设定产生矛盾
5. **伏笔追踪** — 哪些伏笔已回收，哪些待回收

请使用 list_chapters 了解进度，使用 read_architecture 获取设定，逐章检查关键节点。
输出为表格形式，标注问题严重程度（🔴严重 / 🟡注意 / 🟢正常）。`,
    },
    {
      metadata: {
        name: 'writing-coach',
        displayName: '写作教练',
        description: '提供专业的写作技巧指导和文笔改善建议。',
        whenToUse: '用户想提高写作水平、求教写作技巧时',
      },
      content: `# 写作教练

作为专业的写作教练，为用户提供针对性的指导。

## 指导范围
- 叙述技巧（视角运用、时间线处理）
- 描写技法（环境渲染、人物刻画）
- 对话写作（个性化对话、潜台词运用）
- 节奏控制（场景切换、留白技巧）
- 悬念设置（钩子、反转、暗线）

请先使用 read_project_state 了解项目的写作风格设定，
再根据用户的具体问题提供定制化建议，并附上示例对比。`,
    },

    // ================================================================
    // ★ 新增 — 小说创作专用 Skills（v2.2）
    // ================================================================

    {
      metadata: {
        name: 'novel-outline',
        displayName: '大纲架构师',
        description: '基于故事前提和角色设定，生成结构严谨、节奏合理的小说大纲。自动适配三幕/英雄之旅/起承转合等多种结构模式。',
        whenToUse: '需要生成、优化或重构小说大纲时；用户提到"大纲""结构""分卷"时',
      },
      content: `# 大纲架构师

你是资深的小说大纲架构师。请基于已有的故事前提、角色图谱和世界观，生成一份专业的小说大纲。

## 工作流程
1. 使用 read_architecture 获取完整的故事架构
2. 使用 read_project_state 了解篇幅参数（总章数、每章字数）
3. 根据用户选择的结构模式组织大纲

## 大纲输出要求
- **分卷规划**：根据总章数合理划分为若干卷，每卷有明确的主题和高潮
- **章节节点**：标注关键转折章节（触发事件、第一幕结束、中点逆转、至暗时刻、高潮、结局）
- **节奏曲线**：为每卷标注紧张度变化（高/中/低）
- **角色弧对齐**：确保大纲节奏与角色成长轨迹同步

## 质量控制
- 禁止出现超过 5 章无实质推进的"水章"
- 每卷必须有独立的小高潮
- 伏笔埋设点与回收点必须标注`,
    },
    {
      metadata: {
        name: 'chapter-architect',
        displayName: '章节架构师',
        description: '针对单章进行精细化架构设计：开场钩子、场景分段、对话/描写/叙述比例、结尾悬念。',
        whenToUse: '需要设计具体章节的结构和节奏时；写稿前规划章节布局时',
      },
      content: `# 章节架构师

你是专业的章节架构师。为指定章节设计最优的叙事结构。

## 分析步骤
1. 使用 read_blueprint 读取目标章节的蓝图
2. 使用 read_drafts 读取前后章节（掌握上下文衔接）
3. 使用 read_architecture 确认整体设定

## 章节结构设计（输出格式）
### 1. 开场钩子（占章节约 10%）
- 方式：悬念式 / 冲突式 / 氛围式 / 对话式
- 必须在 200 字内抓住读者

### 2. 场景分段（占章节约 70%）
- 建议 2-4 个场景
- 每个场景标注：功能（推进剧情/塑造角色/埋设伏笔/营造氛围）
- 场景间的转场技巧

### 3. 对话/描写/叙述 黄金比例
- 根据章节功能推荐比例（动作章对话 30% 描写 40% 叙述 30%；情感章对话 50% 描写 25% 叙述 25%）

### 4. 结尾钩子（占章节约 10%）
- 方式：悬念钩子 / 反转钩子 / 情感钩子 / 预告钩子
- 必须让读者产生"必须看下一章"的冲动`,
    },
    {
      metadata: {
        name: 'dialogue-craft',
        displayName: '对话工艺师',
        description: '专门优化小说中的对话写作：角色语音个性化、潜台词设计、对话节奏、信息密度控制。',
        whenToUse: '需要优化对话、设计角色对白、检查对话质量时',
      },
      content: `# 对话工艺师

你是小说对话写作的专家。请分析和优化目标文本中的对话。

## 对话六维检查
### 1. 角色语音个性
- 每个角色的说话方式是否独一无二（用词习惯、句式长度、语气词）
- 去掉"某某说"后，读者能否仅凭对话内容分辨说话者

### 2. 潜台词层
- 对话表面意思 vs 真正含义的差距
- 是否有足够的"言外之意"

### 3. 信息密度
- 对话是否推进了剧情或揭示了角色
- 是否存在纯功能性的"信息倾倒"式对话

### 4. 节奏与停顿
- 紧张场景的对话是否短促有力
- 情感场景是否有适当的停顿和留白

### 5. 冲突嵌入
- 每段对话是否有内在冲突（目标对立 / 信息不对称 / 情感张力）

### 6. 场景适配
- 对话风格是否匹配当前场景的氛围（战场 vs 茶馆 vs 密室）

请使用 read_drafts 读取目标章节，逐段分析对话并给出改写建议。`,
    },
    {
      metadata: {
        name: 'description-master',
        displayName: '描写大师',
        description: '五感描写技法指导：环境渲染、人物外貌/动作刻画、氛围营造、抽象概念具象化。',
        whenToUse: '需要增强描写质量、丰富场景画面感、改善文笔时',
      },
      content: `# 描写大师

你是环境描写和人物刻画的大师。请对目标文本的描写段落进行专业评估和优化。

## 描写五维评估
### 1. 五感覆盖
- 视觉（形状/颜色/光影）→ 40%
- 听觉（环境音/对话语气）→ 20%
- 触觉（温度/质感/痛感）→ 15%
- 嗅觉（气味记忆触发）→ 15%
- 味觉（特殊场景）→ 10%

### 2. 动静结合
- 静态描写的画面感
- 动态描写的节奏感
- 动静转换的流畅度

### 3. 远近层次
- 全景→中景→特写的镜头推进
- 焦点切换的自然度

### 4. 情感着色
- 描写是否携带了视角角色的情感滤镜
- 同一场景在不同情绪下应有不同描写

### 5. 简洁与精准
- 避免堆砌形容词（每个段落不超过 3 个修饰语）
- 用具体的动作/细节替代抽象描述

请使用 read_drafts 读取目标章节，标注描写薄弱处并给出具体改写示例。`,
    },
    {
      metadata: {
        name: 'plot-weaver',
        displayName: '情节编织者',
        description: '多线叙事情节管理：主线/支线协调、伏笔埋设与回收、反转设计、冲突升级阶梯。',
        whenToUse: '需要处理复杂情节、设计反转、管理多线叙事时',
      },
      content: `# 情节编织者

你是情节设计专家。请对当前小说的情节结构进行专业分析和优化。

## 情节管理框架
### 1. 多线协调
- 主线（A Plot）：主角的核心目标推进
- 支线（B Plot）：关系线/成长线的并行推进
- 暗线（C Plot）：反派/隐藏势力的幕后行动
- 检查各线之间的交汇点和独立性

### 2. 伏笔系统
- 已埋伏笔清单 → 计划回收章节
- 新伏笔设计原则：自然分散、轻重搭配
- 禁止"机械降神"式解决

### 3. 反转设计
- 每卷至少 1 个中型反转（改变局面但非颠覆）
- 全书至少 1 个大型反转（颠覆认知）
- 反转必须可回溯（有前置线索支撑）

### 4. 冲突升级阶梯
- 每 3-5 章必须有冲突升级（更强对手/更大代价/更深困境）
- 禁止扁平化冲突（每章打脸装逼）

### 5. 节奏校验
- 高潮后的"呼吸章"设计
- 连续高潮的疲劳度控制

请使用 read_architecture 和 list_chapters 了解全局后给出诊断报告。`,
    },
    {
      metadata: {
        name: 'pacing-conductor',
        displayName: '节奏指挥家',
        description: '精细化的小说节奏控制：章节级/段落级/句子级节奏分析、高潮间隔校验、留白与加速技巧。',
        whenToUse: '检查小说节奏问题、调整张弛度时',
      },
      content: `# 节奏指挥家

你是小说节奏控制的大师。请对目标文本进行三级节奏分析。

## 节奏分析框架
### 1. 句子级节奏
- 短句（<15字）：制造紧张感、动作场景
- 中句（15-30字）：叙述推进、信息传递
- 长句（>30字）：氛围渲染、心理描写
- 检查句子长度的变化模式（单调 = 节奏差）

### 2. 段落级节奏
- 段落长度的波浪形变化
- 对话段落 vs 叙述段落的比例
- 场景转换频率（同一场景超过 2000 字需检查是否拖沓）

### 3. 章节级节奏
- 开场 500 字内的张力建立速度
- 中段的节奏维持（是否有"中间塌陷"）
- 结尾 300 字的高潮冲击力

### 4. 跨章节奏
- 前 3 章的吸引力度（黄金三章法则）
- 每 5 章一次小高潮的节奏维持
- 上架章节的高潮设计

请使用 read_drafts 读取目标章节进行分析，给出节奏优化方案。`,
    },
    {
      metadata: {
        name: 'world-forge',
        displayName: '世界观锻造师',
        description: '硬核世界观构建：规则体系自洽性验证、势力博弈推演、历史文化层积、设定利用率最大化。',
        whenToUse: '需要构建或优化世界观、检查设定矛盾时',
      },
      content: `# 世界观锻造师

你是世界观构建的专家。请对当前小说的世界观设定进行专业审查和拓展。

## 世界观审计
### 1. 规则自洽性
- 力量/科技/魔法体系是否存在内部矛盾
- 规则的"边界条件"是否清晰（什么能做/什么不能做）
- 例外的合理性（主角的特殊性是否有充分解释）

### 2. 势力博弈矩阵
- 列出所有主要势力及其目标/资源/盟友/敌人
- 检查是否存在"静止势力"（不采取行动的背景板势力）
- 势力之间的动态平衡与失衡触发点

### 3. 社会生态层积
- 经济基础 → 社会结构 → 文化传统 → 日常生活的逻辑链
- 检查"空中楼阁"设定（脱离经济基础的社会形态）

### 4. 设定利用率
- 已引入的世界观设定中，有多少真正驱动了情节？
- 标记"背景板设定"（提到但从未用于推进情节的设定）
- 建议：将利用率最高的设定深化，利用率低的裁剪

请使用 read_architecture 读取世界观设定后给出审计报告。`,
    },
    {
      metadata: {
        name: 'character-arc-designer',
        displayName: '角色弧设计师',
        description: '专业角色弧光设计：成长弧/堕落弧/平稳弧的类型选择、关键转折点设计、角色关系网的弧线协调。',
        whenToUse: '需要设计或优化角色成长轨迹、检查角色弧完整性时',
      },
      content: `# 角色弧设计师

你是角色弧光设计专家。请对指定角色进行完整的弧光分析与设计。

## 角色弧类型
- **成长弧（Positive Arc）**：克服缺陷→获得成长（最常见）
- **堕落弧（Negative Arc）**：一步步走向失败/黑化
- **平稳弧（Flat Arc）**：角色不变但改变周围世界

## 弧光节点设计
### 1. 起点（角色缺陷/谎言）
- 角色相信的核心谎言是什么
- 这个谎言如何保护/限制了他

### 2. 触发（打破平衡的事件）
- 什么事件迫使角色面对谎言
- 初期反应：抗拒还是接受

### 3. 试炼（渐进式考验）
- 每个关键章节对角色信念的冲击
- 失败的代价与成功的奖励

### 4. 至暗时刻（信念崩塌）
- 角色的核心谎言被彻底粉碎
- 旧信念与新生信念的拉锯

### 5. 蜕变（新的自我）
- 角色的新信念是什么
- 用什么具体行动证明蜕变

### 6. 关系弧协调
- 配角的弧线如何与主角呼应（镜像/对比/互补）

请使用 read_characters 和 read_architecture 进行分析。`,
    },
    {
      metadata: {
        name: 'json-output-guard',
        displayName: 'JSON 输出守门',
        description: '★ AI 自检 Skill：强制 LLM 输出规范 JSON 格式，输出后自动校验，发现错误时自我修正。适用于所有需要结构化输出的场景。',
        whenToUse: '任何需要 AI 输出 JSON 格式的场景；Agent 判断输出可能被解析时自动调用',
        allowedTools: [],
      },
      content: `# JSON 输出守门员

你必须在输出 JSON 前进行自我校验。输出 JSON 时严格遵守以下规范：

## 强制规范
1. **双引号**：所有键名和字符串值必须使用英文双引号（"），严禁使用单引号（'）
2. **无尾随逗号**：数组和对象的最后一个元素后不得有逗号
3. **正确闭合**：每个 { 必须有对应的 }，每个 [ 必须有对应的 ]
4. **纯 JSON**：不要包裹在 Markdown 代码块中，不要添加任何说明文字
5. **字段完整**：所有必填字段必须存在且类型正确

## 输出前自检清单
在输出 JSON 之前，请在脑海中逐项检查：
- [ ] 键名是否都用双引号包裹？
- [ ] 字符串值是否都用双引号包裹？
- [ ] 每个对象末尾是否无多余逗号？
- [ ] 花括号和方括号是否成对闭合？
- [ ] 是否只有 JSON（无额外说明文字）？

## 常见错误及修正
| 错误 | 修正 |
|------|------|
| {name: "张三"} | {"name": "张三"} |
| {"name": '张三'} | {"name": "张三"} |
| {"a": 1,} | {"a": 1} |
| \`\`\`json\\n{...}\\n\`\`\` | {...} |

## 输出后自检
输出 JSON 后，立即模拟解析：检查花括号配对、尾随逗号、引号一致性。如果发现任何问题，立即重新输出修正后的版本。`,
    },
    {
      metadata: {
        name: 'self-review',
        displayName: 'AI 自审员',
        description: '★ AI 自检 Skill：在输出章节内容后自动进行多维度自审——检查逻辑矛盾、角色OOC、连贯性问题、水文检测。',
        whenToUse: '章节写作完成后自动触发；Agent 判断输出质量需要自检时',
      },
      content: `# AI 自审员

作为严格的自审员，对你刚刚生成的章节内容进行无情的自我审查。

## 自审维度

### 1. 逻辑一致性
- 情节推进是否合理（因果关系链是否完整）
- 角色能力是否前后一致（无突然开挂或强行降智）
- 时间线是否自洽（事件间隔是否合理）

### 2. 角色一致性（OOC 检测）
- 每个角色的行为是否符合其设定性格
- 对话风格是否与角色卡一致
- 角色决策是否符合其核心动机

### 3. 连贯性
- 与前一章的结尾是否无缝衔接
- 设定的细节是否与之前章节一致（地点描述、道具状态等）
- 是否有未解决的伏笔被遗忘

### 4. 水文检测
- 是否有超过 300 字的纯描述段落（无剧情推进）
- 是否有重复性的"打脸""震惊"桥段
- 对话是否存在无意义的寒暄（超过 3 轮无信息量）

### 5. 读者体验
- 开场 300 字是否有足够的吸引力
- 结尾是否产生"想继续读"的冲动
- 是否有连续 500 字以上的信息密度低谷

## 自审输出格式
对每个维度给出：✅ 通过 / ⚠️ 有问题 / ❌ 严重问题
对 ⚠️ 和 ❌ 项必须说明具体位置和修改建议。

请先使用 read_drafts 读取刚才生成的章节进行自审。`,
    },
    {
      metadata: {
        name: 'genre-compliance',
        displayName: '流派合规官',
        description: '确保小说创作严格符合目标流派的读者期待和写作规范，避免跨流派失误。支持玄幻/仙侠/都市/科幻/历史/悬疑/游戏/军事/奇幻/武侠/现实等。',
        whenToUse: '需要验证创作是否符合流派规范、检查是否有跨流派毒点时',
      },
      content: `# 流派合规官

你是各大小说流派的资深编辑。请确保当前创作严格符合目标流派的规范和读者期待。

## 合规检查框架
### 1. 流派核心爽点确认
- 该流派读者最期待的核心体验是什么？
- 当前内容是否提供了这种体验？
- 例：玄幻=升级快感+越级战斗；都市=身份反转+商战权谋；悬疑=智力博弈+层层揭秘

### 2. 流派禁忌检查
- 玄幻/仙侠：主角不可长期弱于同龄人、不可被绿、不可圣母
- 都市：不可过度意淫、身份不可无故暴露、反派不可降智
- 科幻：设定不可违背基本物理定律（除非有科幻解释）、不可技术万能
- 历史：不可严重违背史实（架空除外）、现代用语不可穿越
- 悬疑：不可过早暴露真凶、线索不可无解、反转不可无铺垫
- 女频：男主不可油腻、女主不可无脑、感情线不可莫名其妙

### 3. 流派融合检查
- 如果有跨流派元素，融合是否自然？
- 不同流派读者期待的冲突如何平衡？

### 4. 商业适配
- 当前内容的爽点密度是否符合该流派的商业标准
- 金手指的使用频率是否合理

请使用 read_project_state 获取流派设定，使用 read_drafts 读取内容进行检查。`,
    },
    {
      metadata: {
        name: 'chapter-hook-designer',
        displayName: '钩子设计师',
        description: '专业设计章节级别的各种钩子（Hook）：开场钩子抓住读者、中场钩子维持注意力、结尾钩子驱动翻页。',
        whenToUse: '需要设计章节钩子、提升读者留存率、优化章节首尾吸引力时',
      },
      content: `# 钩子设计师

你是章节钩子（Hook）设计的专家。钩子是驱动读者持续阅读的核心动力装置。

## 钩子类型库
### 开场钩子（前 200 字）
1. **悬念钩子**："她没想到，这竟是她最后一次见到活着的父亲。"
2. **冲突钩子**："刀锋离喉咙只有三寸时，他终于明白了真相。"
3. **氛围钩子**："这座城已经下了整整三年的雨，每个人的骨缝里都透着霉味。"
4. **反转钩子**："全宗门都以为他是废物——直到护山大阵在他手中如玩具般碎裂。"
5. **对话钩子**：用一句极具冲击力的对话开场

### 中场钩子（章节中段）
1. **信息钩子**：揭示部分真相但保留关键信息
2. **倒计时钩子**：设置时间压力
3. **选择钩子**：角色面临两难抉择

### 结尾钩子（最后 200 字）——最重要！
1. **悬念钩子**：抛出新的未知
2. **期待钩子**：预告即将发生的重大事件
3. **反转钩子**：颠覆当前认知
4. **情感钩子**：触动读者的情感共鸣点
5. **断章钩子**：在最关键处戛然而止

## 钩子质量评估
- 必须有具体内容支撑（不能是空泛的"危险即将来临"）
- 必须与剧情自然衔接（不能为了钩子而强行转折）
- 必须针对目标读者群的爽点设计

请使用 read_drafts 读取章节，分析现有钩子强度并给出优化方案。`,
    },
  ]

  for (const { metadata, content } of builtins) {
    registry.register({
      metadata,
      content,
      source: 'builtin',
      baseDir: '',
      filePath: `builtin://${metadata.name}`,
    })
  }
}
