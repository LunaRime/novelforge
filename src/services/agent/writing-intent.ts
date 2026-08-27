/**
 * 意图预路由（阶段 A）——本地零 LLM 成本的自然语言意图识别。
 * 判定原则：只拦截「执行成本/破坏性」高的意图（写稿/修稿/角色/大纲——都会触发工作流或写库）；
 * 查询类（文风/设定/聊天）不预路由，留给 ReAct 兜底。
 */

export type WritingIntent =
  | { kind: 'chapter_creation'; chapter: number | { from: number; to: number } | null }
  | { kind: 'refine'; chapter: number | null }
  | { kind: 'character'; name: string; action: 'create' | 'update' }
  | { kind: 'architecture'; target: 'blueprint' | 'architecture' }
  | { kind: 'ambiguous'; hint: string }
  | { kind: 'none' }

/** 章节号：阿拉伯/中文数字「第3章」「第三章」；支持 1-99（十位组合——评审覆盖缺口修订：原 1-10 与十一~十九，10-99 全缺） */
const CN_DIGIT: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }
const CN_TENS: Record<string, number> = { 十: 10, 二十: 20, 三十: 30, 四十: 40, 五十: 50, 六十: 60, 七十: 70, 八十: 80, 九十: 90 }
function parseChapterNum(s: string): number | null {
  const a = parseInt(s, 10)
  if (!Number.isNaN(a) && a > 0) return a
  if (s in CN_DIGIT) return CN_DIGIT[s]               // 一~九
  if (s in CN_TENS) return CN_TENS[s]                 // 十/二十~九十
  const m = s.match(/^([一二三四五六七八九]?)(十)([一二三四五六七八九]?)$/)
  if (m) {
    const tens = m[1] ? CN_DIGIT[m[1]] : 0            // 十一~十九（无十位）→ 10 + 个位；二十一~九十九 → 十位×10 + 个位
    return (tens ? tens * 10 : 10) + (m[3] ? CN_DIGIT[m[3]] : 0)
  }
  return null
}

export function detectWritingIntent(input: string): WritingIntent {
  // @提及由既有链路处理（parseMentions），预路由不抢
  if (input.includes('@')) return { kind: 'none' }

  // ==== 角色（先判定——角色名可能与写稿动词共现） ====
  // 评审覆盖缺口修订：「创建角色」无名字（原名捕获组需 1-10 字）→ ambiguous 澄清，不再静默 none
  // brief 修订：捕获组排除「的」（原「创建一个叫苏晚晴的角色」贪心误捕获「苏晚晴的」）
  const charCreate = input.match(/(?:创建|新建|添加|新增)(?:一个|一位|个)?(?:叫|名为|叫做)?\s*([^\s，。！？；：、（）《》【】·—""''的]{1,10})\s*(?:的)?角色/)
  if (charCreate) return { kind: 'character', name: charCreate[1].trim(), action: 'create' }
  if (/(?:创建|新建|添加|新增).{0,4}角色/.test(input)) return { kind: 'ambiguous', hint: 'character' }
  // brief 修订：补 character/update 分支（spec §4.2「新建 vs 修改分支」；brief 遗漏，plan 文档含此行）
  // 评审二次修订：动词组 `(?:下|一下)?` 消费助词 + 捕获组负向前瞻——名与「角色/人设/设定」后缀间有前缀助词或空名时绝不命中。
  //   前置守护前瞻 (?!下|一下…后缀) 闭合并回溯孔（助词组回溯为空的二次尝试仍会以「一下」开头捕获），
  //   且保留「的」排除（否则贪心捕获吞入后缀导致 name=「苏晚晴的角色」）。
  // 评审修复（M1）：守卫前瞻内先行 `\s?` 容忍「修改 一下角色设定」空格变体——空格使原前瞻与助词组
  //   错位，捕获组会以「一下」开头误命 name（实测 name=「一下角色」）。
  const charUpdate = input.match(/(?:修改|更新|调整|改)(?!\s?(?:下|一下)\s*(?:的)?\s*(?:角色|人设|设定))(?:下|一下)?\s*(?!角色|人设|设定)([^\s，。！？；：、（）《》【】·—""''的]{1,10})\s*(?:的)?(?:角色|人设|设定)/)
  if (charUpdate) return { kind: 'character', name: charUpdate[1].trim(), action: 'update' }

  // ==== 大纲/架构 ====
  if (/(?:生成|重新|创建|帮我)?\s*(?:大纲|蓝图)/.test(input)) return { kind: 'architecture', target: 'blueprint' }
  if (/(?:重新)?\s*(?:规划|设计|搭建|写)\s*(?:剧情|架构|世界观|剧情架构)/.test(input)) return { kind: 'architecture', target: 'architecture' }

  // ==== 修稿 ====
  // 第 与 数字 之间允许空格（评审覆盖缺口修订：「润色第 2 章」此前退化成 refine(null)）
  // brief 修订：章号可位于动词之前（「把第2章润色一下」），原正则只跟动词后会把「一下」的「一」误当章号
  // 评审二次修订：数字分支 `章?` → `章`——「润色一下/修改一下/优化一下」不得把「一下」的「一」当章号（refine(1) 误触发）
  const refinePreM = input.match(/第?\s*(\d+|[一二三四五六七八九十]+)\s*章\s*(?:的)?\s*(?:润色|修改|改写|打磨|优化|修(?:一下|改)?)/)
  const refineM = input.match(/(?:润色|修改|改写|打磨|优化|修(?:一下|改)?)(?:第?\s*(\d+|[一二三四五六七八九十]+)\s*章|这段|这段文字|这一段)?/)
  if (/(?:润色|修改|改写|打磨|优化|修(?:一下|改)?)/.test(input)) {
    const chapRaw = refinePreM?.[1] ?? refineM?.[1]
    const chap = chapRaw ? parseChapterNum(chapRaw) : null
    return { kind: 'refine', chapter: chap }
  }

  // ==== 写稿（最后判定——「写」是最宽动词） ====
  const writeVerb = /(?:写|创作|生成|起草|接着写|继续写|产出)/
  if (writeVerb.test(input)) {
    const range = input.match(/(\d+)\s*[-–至到]\s*(\d+)\s*章/)
    if (range) {
      const from = parseInt(range[1], 10), to = parseInt(range[2], 10)
      if (from > 0 && to >= from) return { kind: 'chapter_creation', chapter: { from, to } }
    }
    // \s* 支持「第 3 章」带空格（评审覆盖缺口修订：`第?(\d+)` 后无空格容忍时「第 3 章」匹配失败）
    const single = input.match(/第?\s*(\d+|[一二三四五六七八九十]+)\s*章/)
    if (single) {
      const n = parseChapterNum(single[1])
      if (n !== null) return { kind: 'chapter_creation', chapter: n }
    }
    // 评审修复（I3）查询护栏：宽「写」动词命中后、ambiguous 返回前——查询/聊天类不预路由
    //（「写作风格是什么」「怎么写出更精彩的对话」此前被永久拦截为 ambiguous，无 ReAct 兜底）。
    //   写作/写法/写得/写好/写作风格 形态 或 含疑问词（什么/怎么/如何/？/?）→ 查询类留给 ReAct；
    //   祈使句「帮我写」不含这些形态 → 仍 ambiguous；带章号「写第3章」已先于护栏返回。
    if (/(写作|写法|写得|写好|写作风格|怎么写)/.test(input) || /(什么|怎么|如何|？|\?)/.test(input)) {
      return { kind: 'none' }
    }
    return { kind: 'ambiguous', hint: 'chapter' }
  }

  return { kind: 'none' }
}
