/**
 * NovelForge 流派特化引擎 — 根据小说类型注入专业术语、禁忌词、推荐句式
 *
 * 不同流派需要完全不同的写作风格：
 * - 玄幻: 境界突破、战斗场面、修炼体系
 * - 都市: 现代感对话、职场/校园场景
 * - 悬疑: 线索铺设、节奏控制、氛围营造
 */

// ===== 类型定义 =====

export interface GenreOverride {
  /** 流派名 */
  genre: string
  /** 核心术语表（AI 必须理解的概念） */
  terminology: string
  /** 推荐写作技巧 */
  writingTips: string
  /** 禁忌词汇（AI 应避免的表述） */
  forbiddenPhrases: string
  /** 推荐句式/节奏 */
  sentencePatterns: string
  /** 子类型特殊配置 */
  subGenre?: Record<string, Partial<GenreOverride>>
}

// ===== 流派配置 =====

export const GENRE_OVERRIDES: Record<string, GenreOverride> = {
  '玄幻': {
    genre: '玄幻',
    terminology: `修炼体系术语：练气→筑基→金丹→元婴→化神→炼虚→合体→大乘→渡劫（可自定义）
功法等级：黄级→玄级→地级→天级→仙级→神级
丹药：聚气丹、筑基丹、破境丹、九转还魂丹
常见设定：秘境、洞天福地、灵脉、传送阵、储物戒`,
    writingTips: `1. 战斗描写占 20-30% 篇幅，要有层次感（试探→全力→底牌）
2. 境界突破必须有仪式感（天地异象、心魔考验）
3. 金手指要有代价/限制，不能无脑无敌
4. 每 3-5 章一个小爽点（打脸/突破/获得宝物）
5. 世界构建要有"三维"：物理维度（地域）、权力维度（势力）、资源维度（灵脉）`,
    forbiddenPhrases: `禁止使用现代网络用语（如"老铁""牛逼""卧槽"除非是现代穿越）
禁止让主角无代价轻松突破（必须有挣扎感）
禁止反派智商过低（要有来有回的对抗）`,
    sentencePatterns: `短句为主（8-15字），战斗时更短（5-10字）制造紧迫感
突破场景用对仗句式增强仪式感
对话占比 25-35%，主角对话要有性格`,
  },

  '都市': {
    genre: '都市',
    terminology: `职场术语：CEO、CTO、KPI、融资、上市、并购、对赌协议
校园术语：GPA、学生会、社团、考研、保研、毕业答辩
常见场景：办公室、会议室、咖啡厅、高档餐厅、校园`,
    writingTips: `1. 对话占比 40-50%，要有现代感和生活气息
2. 人物关系要复杂（同事/朋友/恋人/竞争对手多线交织）
3. 爽点类型：打脸装逼犯、职场逆袭、身份反转
4. 细节描写要真实（品牌名、地名、价格）增强代入感
5. 节奏：日常铺垫→冲突升级→爽点释放→余韵`,
    forbiddenPhrases: `避免过于古风的用词（如"阁下""本座""仙子"）
避免玄幻式的等级体系表述
避免过度使用网络梗（容易过时）
禁止不合理的"金手指"设定（如突然获得超能力）`,
    sentencePatterns: `中句为主（12-20字），对话短而有力
叙述与对话比例 6:4
多用具体数字和细节增强真实感`,
  },

  '悬疑': {
    genre: '悬疑',
    terminology: `推理术语：不在场证明、密室杀人、叙诡、暴风雪山庄、本格/社会派
刑侦术语：DNA、指纹、监控、法医、弹道分析、侧写
常见结构：倒叙、插叙、多视角、不可靠叙述者`,
    writingTips: `1. 信息释放节奏：每章给一点线索但要留新疑问
2. 红鲱鱼（误导线索）必须足够迷惑但不能突兀
3. 凶手动机必须合理（不能最后突然冒出个陌生人）
4. 氛围营造：环境描写+心理描写占比 25%
5. 章节结尾必须留钩子（新线索/反转/危险逼近）`,
    forbiddenPhrases: `禁止过早暴露核心诡计
避免非逻辑驱动的"巧合"（除非是精心设计的）
禁止凶手行为不符合其身份设定`,
    sentencePatterns: `长短句交替（短句制造紧张，长句铺设线索）
心理描写用第一人称视角增强代入感
环境描写用冷色调词汇（阴冷、潮湿、昏暗、寂静）`,
  },

  '科幻': {
    genre: '科幻',
    terminology: `硬科幻术语：熵增、奇点、戴森球、费米悖论、量子纠缠、光速壁垒
软科幻术语：赛博朋克、基因编辑、意识上传、星际联邦、时间悖论
常见设定：太空殖民、AI统治、废土生存、虚拟现实`,
    writingTips: `1. 科技设定要自洽（可以不科学但要逻辑自圆其说）
2. 人文思考占 20%（技术对社会/人性的影响）
3. 世界观构建要宏大但细节要具体
4. 节奏：设定展示→冲突引发→技术解决问题→新疑问
5. 避免"黑科技万能"（每种技术要有局限性）`,
    forbiddenPhrases: `禁止科学概念明显错误（如"超越光速就能回到过去"）
避免技术术语堆砌（每章新术语不超过3个）
禁止人物行为不符合科技设定`,
    sentencePatterns: `叙述偏长句（15-25字）适应复杂概念
技术描写要精确，人文描写要温暖
对话中技术术语要自然，不要让角色"念说明书"`,
  },

  '历史': {
    genre: '历史',
    terminology: `历史术语：朝堂、科举、六部、藩王、党争、变法、和亲、岁币
官职系统：尚书、侍郎、巡抚、总督、知府、知县
古代生活：时辰、银两、驿站、镖局、书院、祠堂`,
    writingTips: `1. 历史考据要严谨（年份/官职/礼仪不能出错）
2. 人物行为要符合时代背景（不能有超前的思想）
3. 权谋斗争要有层次（明争→暗斗→朝堂→后宫）
4. 节奏：铺垫→权谋交锋→反转→反思
5. 语言要有古风但不刻意（适度使用文言词汇）`,
    forbiddenPhrases: `禁止现代词汇（如"手机""网络""OK"）
避免不符合时代的物品/思想
禁止随意篡改重大历史事件（架空历史除外）`,
    sentencePatterns: `偏长句（15-25字），有文言韵味但不拗口
对话可适度使用古语（"阁下""本官""臣""殿下"）
描写要有画面感（像古画展开）`,
  },
}

// ===== 匹配与格式化 =====

/**
 * 根据流派获取特化配置（支持子类型）
 */
export function getGenreOverride(
  genre: string,
  subGenre?: string,
): GenreOverride | null {
  const main = GENRE_OVERRIDES[genre]
  if (!main) return null

  if (subGenre && main.subGenre?.[subGenre]) {
    return { ...main, ...main.subGenre[subGenre] }
  }

  return main
}

/**
 * 将流派特化格式化为 prompt 注入文本
 */
export function formatGenreOverrideForPrompt(
  override: GenreOverride | null,
): string {
  if (!override) return ''

  const parts = ['## 流派特化写作指导']

  if (override.terminology) {
    parts.push(`### 核心术语\n${override.terminology}`)
  }
  if (override.writingTips) {
    parts.push(`### 写作技巧\n${override.writingTips}`)
  }
  if (override.sentencePatterns) {
    parts.push(`### 推荐句式\n${override.sentencePatterns}`)
  }
  if (override.forbiddenPhrases) {
    parts.push(`### ⚠️ 禁忌\n${override.forbiddenPhrases}`)
  }

  return parts.join('\n\n')
}
