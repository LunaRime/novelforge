import type { PromptTemplate } from "../prompt-templates";

export const editingPrompts: PromptTemplate[] = [
  {
    key: 'refine_chapter',
    name: '大神级修稿',
    description: '将草稿提升到大神级质量',
    systemRole: '你是一位功力深厚的文学编辑，擅长将普通文稿精修为白金品质力作。',
    variables: {
      draft_content: '章节草稿内容',
      chapter_info: '章节信息',
      global_guidance: '写作要求',
      global_summary: '近章要点（蓝图摘要）',
      short_summary: '近章摘要',
      word_number: '目标字数',
      user_refine_prompt: '用户自定义修稿指导（可选）',
      writing_style: '文风描述（可选）',
    },
    content: `请对章节草稿进行【精修与细节填充】。

【剧情上下文】
- 全书目前进度摘要：{{global_summary}}
- 近期章节回顾：{{short_summary}}

【本章信息】
{{chapter_info}}

【精修要求】
1. 画面感（Sense of Presence）：通过"五感"细节（视觉、听觉、嗅觉、触觉）强化环境描写，拒绝干瘪的白开水叙事。
2. 设定咬合：巧妙地将金手指的使用细节融入战斗或博弈中，体现主角的差异化优势。
3. 情绪张力：强化反派的压迫感与主角的回击力度。遵循"欲扬先抑"法则，但在高潮处必须给足爽感。
4. 词汇升级：使用更精准、更具镜头感的动作词汇。用动作和细节来展示情绪（Show, Don't Tell）。
5. 钩子与节奏：检查结尾处是否有强力钩子（Hook），确保读者有强烈的追读欲望。
6. 防注水平替制：精修的本质是词汇平替、提升画面感，绝非拉长篇幅和增注冗长旁白。目标字数控制在 {{word_number}} 字左右。如果发现原文有啰嗦的动作描写或说教式科普，请果断删减，严禁无限扩写把节奏拖慢。

【全局写作禁忌】
{{global_guidance}}

【待精修原稿】
{{draft_content}}

【文风要求（如有，精修时严格向此风格靠拢）】
{{writing_style}}`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_refine_prompt}}

请直接输出精修后的全文章节内容。强制要求纯文本，禁止使用任何 Markdown 语法符号，严禁剧本式对话。【严禁】任何开场白或解释文字。
**【强制排版底线】：段落与段落之间必须保留一个空行作为分隔，绝不允许不留空行的连续长段落。**`,

  },
  {
    key: 'refine_from_review',
    name: '审稿驱动修稿',
    description: '根据审稿报告中的问题精准修复草稿',
    systemRole: '你是一位严谨的小说编辑，擅长精准修复文本中的具体问题而不过度改写。',
    variables: {
      review_report: '审稿报告内容',
      draft_content: '待修稿内容',
      global_guidance: '全局写作要求',
      user_refine_prompt: '用户额外修稿指导（可选）',
    },
    content: `请根据【审稿报告】中列出的问题，对草稿进行**精准修复**。

【审稿报告】
{{review_report}}

【待修稿内容】
{{draft_content}}

【全局写作要求】
{{global_guidance}}

【修复原则】
1. 只修复审稿报告中明确指出的问题，一条一条逐项解决
2. 不要进行审稿报告未提及的润色或改写
3. 保持原文的风格、节奏和字数体量
4. 对每处修改保持最小变化原则——改得越少越好，只解决问题本身`,
    systemSuffix: `★【作者对本步骤的额外指导（如有，最高优先级）】★：
{{user_refine_prompt}}

请直接输出修复后的全文章节内容。强制要求纯文本，严禁剧本式格式，【严禁】任何开场白、解释文字。
**【强制排版底线】：段落与段落之间必须保留一个空行作为分隔，绝对不允许连续文本不留空行。**`,
  },
]
