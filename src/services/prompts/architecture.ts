import type { PromptTemplate } from "../prompt-templates";

export const architecturePrompts: PromptTemplate[] = [
  {
    key: 'premise',
    name: '故事前提',
    description: '故事架构第一步：提炼故事前提（Story Premise），浓缩全书的核心卖点与冲突链',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      genre: '小说类型',
      sub_genre: '细分类型',
      topic: '核心主题/故事简介',
      target_audience: '目标受众',
      number_of_chapters: '总章数',
      word_number: '每章字数',
      core_setting: '世界观基盘设定',
      golden_finger: '核心金手指/卖点',
      protagonist_profile: '主角人设',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
      reference_works: '参考作品（可选）',
    },
    content: `请提炼本书的故事前提（Story Premise）。这是一本【{{genre}}】（细分类别：{{sub_genre}}）小说。

【核心设定参数】
- 核心大纲：{{topic}}
- 目标受众：{{target_audience}}
- 预期篇幅：约{{number_of_chapters}}章（每章{{word_number}}字）
- 世界观基盘：{{core_setting}}
- 核心金手指/系统：{{golden_finger}}
- 主角核心人设：{{protagonist_profile}}
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
请生成一份 300-500 字的结构化故事前提，严格按以下四个小节输出：

## 一句话前提（Logline）
用 30-50 字极度浓缩全书核心："当 [主角身份] 遭遇 [触发事件]，必须 [核心行动] 否则 [灾难后果]。"

## 核心冲突链
展开描述：主角的初始困境 → 打破平衡的触发事件 → 核心主线目标 → 主要阻碍势力。（约 100 字）

## 金手指定位
详细说明：金手指的获取方式 → 核心机制与功能 → 与世界观规则的交互点 → 进阶路线与限制/代价。（约 100-150 字）

## 悬念骨架
描述：显性冲突线（当前最大威胁）+ 隐藏主线暗示（终极悬念/深层真相）。（约 100 字）

【要求】
1. 金手指必须是推动情节的核心手段，要具体描述其独特机制，不要泛泛而谈。
2. 必须体现主角基于设定的核心欲望或执念。
3. 冲突链必须包含显性敌人与深层危机两个层次。
4. 严格避开全局写作要求与禁忌中的毒点。
5. 使用上述 Markdown 小节标题分隔，不要添加额外解释。

【参考作品风格（如有，调性与节奏可参考以下作品）】
{{reference_works}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
  },
  {
    key: 'character_dynamics',
    name: '角色图谱',
    description: '故事架构第二步：构建核心角色关系网与角色弧光',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      genre: '小说类型',
      protagonist_profile: '主角人设',
      golden_finger: '金手指体系',
      world_building: '世界观设定',
      number_of_chapters: '总章数',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
      reference_works: '参考作品（可选）',
    },
    content: `请基于故事前提为本书塑造一个极具戏剧张力的核心角色图谱。

【参考参数】
- 小说类型：{{genre}}
- 故事前提：{{premise}}
- 主角预设档案：{{protagonist_profile}}
- 金手指体系：{{golden_finger}}
- 世界观背景：{{world_building}}
- 预期篇幅：约{{number_of_chapters}}章
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
围绕主角，根据小说篇幅（{{number_of_chapters}}章）设计合理数量的核心角色（短篇3-4人，中长篇4-6人）。角色切忌脸谱化。请生成包含以下结构的角色图谱：

1. 【第一核心：主角】
- 表面追求与终极渴望（根据档案补全性格的明暗两面）
- 标志性外貌特征（衣着、气质、独特标志等）
- 金手指使用风格（基于「{{golden_finger}}」的具体机制，设计独特的使用习惯或战斗/升级策略）
- 灵魂软肋与蜕变预期（角色弧光起始点 → 终点）

2. 【核心角色阵营】
为每位角色提供：姓名/代号、身份背景、标志性外貌特征、与主角的关系张力、暗藏秘密。
角色设计原则（非固定模板，根据故事需要灵活配置）：
- 至少 1 位与主角有深度羁绊的盟友/伙伴（互补而非附庸）
- 至少 1 位与主角理念对立的竞争者/对手（有自己的正当动机）
- 可选：1 位隐藏变数/灰色角色（立场不定，可能带来反转）
- 可选：根据故事需要增加导师、阴谋家、势力代言人等

3. 【核心矛盾交织网】
简述所有角色如何因为世界观下的生存压力、资源争夺或信念冲突产生不可避免的碰撞。

【要求】
1. 主角必须严格符合主角档案基调，不可偏离。
2. 所有角色的设计必须贴合「{{genre}}」类型的读者期待。
3. 默认避免圣母、降智反派或纯工具人（除非作者明确要求）。
4. 仅返回角色图谱文本，不要任何客套话。

【参考作品风格（如有，调性与节奏可参考以下作品）】
{{reference_works}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
  },
  {
    key: 'world_building',
    name: '世界观构建',
    description: '故事架构第三步：构建自带冲突引擎的世界观矩阵',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      genre: '小说类型',
      core_setting: '世界观基盘',
      golden_finger: '金手指体系',
      protagonist_profile: '主角人设',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
    },
    content: `请将基础设定转化为能直接引发冲突的"剧情游乐场"。

【参考参数】
- 小说类型：{{genre}}
- 故事前提：{{premise}}
- 核心世界观设定：{{core_setting}}
- 金手指体系：{{golden_finger}}
- 主角定位：{{protagonist_profile}}
- 全局写作要求与禁忌：{{global_guidance}}

【生成任务】
请基于核心世界观，根据「{{genre}}」类型的特点，构建以下三个维度的世界观设定。每个设定都必须"自带冲突点"，能直接驱动情节。

1. 【核心规则与体系漏洞】
- 本世界运转的核心规则是什么？（根据类型可以是：修炼体系、科技等级、社会制度、超自然法则等）
- 规则中的绝对优势是什么？主角的金手指「{{golden_finger}}」如何在这套规则下占据独特的非对称优势？

2. 【阶层断层与资源战场】
- 这个世界里存在哪些不可调和的势力/阶层/阵营对立？
- 最稀缺的核心资源是什么？它是如何分配的？主角处于什么位置，需要向谁争夺？

3. 【隐喻与深层危机】
- 世界背后的终极灾变或最大谜团是什么？
- 有什么流传的禁忌、历史谎言或被掩盖的真相，恰好与主角的命运产生交汇？

【要求】
1. 所有设定必须围绕「{{genre}}」题材的核心看点，不要写无法融入正文的废话设定。
2. 金手指与世界规则的交互必须具体、可操作，避免泛泛而谈。
3. 严格遵循全局写作要求与禁忌，禁止崩坏。
4. 仅返回世界观设定文本，不要生成任何无关代码或解释。

`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
  },
  {
    key: 'synopsis',
    name: '情节大纲',
    description: '故事架构第四步：整合所有碎片，按用户选择的故事结构模式生成情节大纲',
    systemRole: '你是一位顶尖的网络小说策划专家与故事架构师。',
    variables: {
      premise: '故事前提',
      character_dynamics: '角色图谱',
      world_building: '世界观',
      genre: '小说类型',
      number_of_chapters: '总章数',
      word_number: '每章字数',
      plot_structure_guide: '故事结构详细指导（由系统根据用户选择的结构模式动态注入）',
      narrative_pov: '叙事视角描述',
      global_guidance: '全局写作要求',
      step_guidance: '作者对本步骤的补充指导（可选）',
    },
    content: `请将前序生成的所有碎片整合为全书的情节大纲。

【核心资产】
- 小说类型：{{genre}}
- 叙事视角：{{narrative_pov}}
- 故事前提：{{premise}}
- 角色图谱：{{character_dynamics}}
- 世界观矩阵：{{world_building}}
- 全局写作要求与禁忌：{{global_guidance}}

【篇幅参数（极其重要！结构节点必须严格基于此）】
- 计划总章数：{{number_of_chapters}} 章
- 每章字数：{{word_number}} 字
- 全书总字数约：{{number_of_chapters}} × {{word_number}} 字

【故事结构模式——严格按以下结构组织大纲】
{{plot_structure_guide}}

【生成任务】
严密推演涵盖全书的情节大纲。写"结构拐点"而非细纲。请根据「{{genre}}」类型的核心看点调整节奏策略。

【要求】
1. 结构节点的章节区间必须基于【{{number_of_chapters}}章】的实际规模标注具体范围，禁止使用与实际章数不符的数字。
2. 每个结构节点都要提到"具体会发生什么事"，不能泛泛而谈。
3. 节奏策略要匹配「{{genre}}」类型（如爽文侧重打脸与升级节奏，悬疑侧重线索与反转，言情侧重情感与误会）。
4. 叙事视角为「{{narrative_pov}}」，大纲设计时需考虑视角限制对信息揭露、悬念制造的影响。
5. 绝不能触碰全局写作要求与禁忌中的毒点。
6. 仅返回情节大纲纯文本，禁止一切废话或旁白。

`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{step_guidance}}`,
  },
  {
    key: 'chapter_blueprint',
    name: '章节蓝图生成（全量）',
    description: '基于全书架构一次性生成所有章节的详细蓝图',
    systemRole: '你是一位经验丰富的网文架构师，擅长设计精密的章节蓝图。',
    variables: {
      novel_architecture: '完整故事架构（故事前提+角色图谱+世界观+情节大纲）',
      number_of_chapters: '总章数',
      global_guidance: '全局写作要求',
      genre: '小说类型',
      pacing_guidance: '节奏/风格指导（可选）',
    },
    content: `请基于我们此前推演出的【全书架构引擎】，为本书生成从第1章到第{{number_of_chapters}}章的具体"保姆级执行目录细纲"。

【核心防偏离守则】
- 小说题材：{{genre}}
- 全局写作要求与禁忌：{{global_guidance}}（这是绝对不能触碰的底线！）

【全书架构数据池】
{{novel_architecture}}

【商业网文节奏设计原则】
1. 黄金三章法则：第1章极速抛出"生存/高压困境"，第2章激活金手指/最大反差变量，第3章完成首次"小型打脸/破局"，留钩子。
2. 小高潮循环：严格执行"3-5章一个小循环"。
3. 拒绝水文与流水账：每一章都必须发生"实质性的事件变动"。
4. 悬念钩子机制：每章结尾必须有一个让读者想连续翻页的变数。

【输出格式规定】
严格且仅按以下 Markdown 表格格式输出每一章（不要输出 JSON，不要用代码块包裹）：

| chapterNumber | title | role | purpose | characters | keyEvents | suspenseHook |
|--------------|-------|------|---------|------------|-----------|-------------|
| 1 | 引人入胜的标题 | 建置 | 本章主角最想解决的一件事 | 角色A, 角色B | 主角做了什么，遭遇了什么反转，金手指怎么用的。100字左右具体说明 | 一句话说明结尾留了什么悬念 |
| 2 | ... | ... | ... | ... | ... | ... |

要求：
- role 取值：建置、铺垫、发展、冲突、高潮、转折、收尾
- 每章的 keyEvents 控制在 100-150 字以内，信息密度必须极高。
- characters 用中文逗号或英文逗号分隔角色名。
- 仅给出最终的 Markdown 表格，不要任何客套解释，不要用代码块包裹。

★【作者节奏/风格指导（如有，最高优先级）】★：
{{pacing_guidance}}`,
  },
  {
    key: 'chapter_blueprint_chunk',
    name: '章节蓝图续写（分块）',
    description: '在已有目录基础上续写后续章节蓝图，支持分块生成',
    systemRole: '你是一位经验丰富的网文架构师，擅长设计精密的章节蓝图。',
    variables: {
      novel_architecture: '完整故事架构（故事前提+角色图谱+世界观+情节大纲）',
      chapter_list: '已生成的章节列表（最近100章）',
      number_of_chapters: '总章数',
      n: '起始章节号',
      m: '结束章节号',
      global_guidance: '全局写作要求',
      genre: '小说类型',
      pacing_guidance: '节奏/风格指导（可选）',
    },
    content: `请基于【全书架构引擎】与【已生成的目录进度】，为接下来的 第{{n}}章到第{{m}}章 生成极其严密的"保姆级执行目录细纲"。

【核心防偏离守则】
- 小说题材：{{genre}}
- 全书规模：共 {{number_of_chapters}} 章
- 全局写作要求与禁忌：{{global_guidance}}（这是绝对不能触碰的底线！）

【全书架构数据池】
{{novel_architecture}}

【前置剧情进度与连贯性检查】
以下是前置章节（简略截取，以防遗忘主线进度）：
{{chapter_list}}

【本次生成任务：接力推演】
请紧密承接上面最后一章的情节，继续严密推演 第{{n}}章 到 第{{m}}章。
1. 连续小高潮法则：维持每 3-5 章一个小高潮的节奏。
2. 伏笔强制回收与释放：如果前面章节留下了危机，这里必须引爆或解决。
3. 拒绝水文：每一章都必须有实质性进展。

【输出格式规定】
严格且仅按以下 Markdown 表格格式输出每一章（不要输出 JSON，不要用代码块包裹）：

| chapterNumber | title | role | purpose | characters | keyEvents | suspenseHook |
|--------------|-------|------|---------|------------|-----------|-------------|
| {{n}} | 引人入胜的标题 | 发展 | 本章主角最想解决的一件事 | 角色A, 角色B | 具体发生了什么，金手指怎么运作的。100字左右 | 结尾留的钩子 |
| {{n+1}} | ... | ... | ... | ... | ... | ... |

要求：
- role 取值：建置、铺垫、发展、冲突、高潮、转折、收尾
- 严格遵循上下文连贯，不要前后矛盾。
- characters 用中文逗号或英文逗号分隔角色名。
- 仅给出最终的 Markdown 表格，不要任何客套解释，不要用代码块包裹。

★【作者节奏/风格指导（如有，最高优先级）】★：
{{pacing_guidance}}`,
  },
  {
    key: 'infer_single_chapter_blueprint',
    name: '逆向推演单章蓝图',
    description: '从已有小说章节正文高精度反推出该章的结构化蓝图信息，用于导入旧作场景',
    systemRole: '你是一位专业的网文结构分析师，擅长从正文中提取结构化蓝图信息。',
    variables: {
      chapter_content: '本章正文全文',
      chapter_number: '本章序号',
      chapter_title: '本章标题（来自拆章）',
      novel_config_summary: '全局配置脱水版',
    },
    content: `请阅读以下已有章节正文，从中提取结构化蓝图信息。

【全局小说设定概要】
{{novel_config_summary}}

【章节信息】
- 章节序号：第 {{chapter_number}} 章
- 拆章标题：{{chapter_title}}

【本章正文】
{{chapter_content}}

---

请严格按以下 JSON 格式输出本章蓝图：

{
  "chapterNumber": {{chapter_number}},
  "title": "从正文内容中提炼的精准章节标题（如果拆章标题已经不错可保留）",
  "role": "本章在全书中的角色（起、承、转、合、伏笔、高潮、过渡 等）",
  "purpose": "本章主角最想解决的核心问题（一句话）",
  "characters": ["本章出场的重要角色名"],
  "keyEvents": "本章核心事件概述（100-150字，包含因果关系和结果）",
  "suspenseHook": "章末留下的悬念或钩子（一句话）"
}

要求：
1. keyEvents 必须基于正文实际内容提取，不可臆造。
2. characters 只列主要互动角色名（3-5个），不要列龙套。
3. role 从正文的叙事功能判断（建置/发展/转折/高潮/结局/过渡等）。
4. 仅输出 JSON，不要任何额外文字。`,
  },
]
