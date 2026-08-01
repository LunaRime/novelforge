import type { PromptTemplate } from "../prompt-templates";

export const configPrompts: PromptTemplate[] = [
  {
    key: 'generate_global_config',
    name: '全文配置生成',
    description: '根据用户一句话灵感，生成完整的小说配置 JSON',
    systemRole: '你是一位入行十年的顶尖网文主编与白金大神作家，擅长从一句话灵感中提炼完整的商业小说配置。',
    variables: {
      user_idea: '用户输入的灵感/想法',
      number_of_chapters: '计划总章数',
      word_number: '每章计划字数',
    },
    content: `基于作者提供的一句话点子或初步脑洞，请按照当今最成熟、最具商业霸榜潜力的网文核心结构，扩展并补全一部小说的全局爆款设定。

作者初步脑洞：
{{user_idea}}

小说规模（重要！请严格根据此参数设计节奏）：
- 计划总章数：{{number_of_chapters}} 章
- 每章字数：{{word_number}} 字
- 全书总字数约：{{number_of_chapters}} × {{word_number}} 字

【核心任务要求】
1. 深度挖掘商业价值：提取强烈的"爽点"、"情绪痛点"，构建极具张力的起承转合。
2. 专业化设定：应用"角色图谱"和"三维世界观"理念，杜绝假大空，所有设定必须为推动情节和产生直接冲突服务。
3. 契合市场：如果作者未指定基础类型，请推断一个最契合的爆火类型。
4. 节奏定制：globalGuidance 中的前/中/后期章节区间、小/中/大高潮频率，必须严格基于【{{number_of_chapters}} 章】的实际规模推算，禁止使用与实际章数不符的数字。
5. 智能推荐：根据类型和题材推荐最合适的故事结构和叙事视角。`,
    systemSuffix: `【输出格式限制】
- 必须以标准的 JSON 格式返回，确保匹配以下结构。

【JSON 字段结构】
{
    "genre": "主类型（玄幻/仙侠/都市/科幻/历史/悬疑/游戏/军事/奇幻/武侠/现实/其他）",
    "targetAudience": "受众目标（男频/女频/通用/短篇）",
    "subGenre": "细分子类型及核心标签（如：末日废土、苟道流、权谋、大女主逆袭）",
    "plotStructure": "故事结构（three_act=三幕结构 / heros_journey=英雄之旅 / save_the_cat=节拍表 / kishotenketsu=起承转合 / multi_thread=多线叙事 / freeform=自由结构，根据类型推荐最合适的）",
    "narrativePOV": "叙事视角（third_limited=第三人称有限视角 / first_person=第一人称 / third_omniscient=第三人称全知视角 / multi_pov=多视角轮换，根据类型推荐最合适的）",
    "coreOutline": "核心大纲（不少于150字，含：主角的致命危机/开局困境、必须完成的核心目标、终极大危机、主要爽点起伏）",
    "worldSetting": "独特的背景设定（物理维度、权力断层、核心资源争夺机制）",
    "goldenFinger": "核心卖点与金手指体系（获取方式、具体功能、进阶成长路径、副作用/限制）",
    "protagonistProfile": "主角人设档案（极具反差的性格弱点、表面伪装标签、核心驱动力：物质目标+深层灵魂渴望）",
    "globalGuidance": "全局写作指导与核心禁忌（严格基于{{number_of_chapters}}章规模：前/中/后期各占多少章、小/中/大高潮的具体章节频率、严禁触碰的毒点）",
    "writingStyle": "文风配置（不少于100字，涵盖：叙述节奏快慢与场景切换频率、描写密度偏好、对话风格与口语化程度、用词偏好古风/现代/专业术语、情感基调热血/冷峻/诙谐/沉重、标志性修辞手法与过渡技巧。请根据类型和受众推荐最匹配的写作风格）"
}`,
  },
  {
    key: 'infer_novel_config',
    name: '逆向推演全局配置',
    description: '从已有小说内容（知识库采样片段）反推出小说配置、四段架构和主角色卡，用于旧作续写场景',
    systemRole: '你是一位顶级网文主编和资深阅读分析师，擅长从已有作品中逆向推演设定体系。',
    variables: {
      sample_content: '知识库代表性采样内容（开头+中段+结尾）',
    },
    content: `请根据以下已有小说内容片段，逆向推演出这部小说的完整设定体系，用于支持续写工作。

【已有内容样本】
{{sample_content}}

---

请严格按照以下 JSON 格式返回分析结果：

{
  "novelConfig": {
    "genre": "主类型（玄幻/仙侠/都市/科幻/历史/悬疑/游戏/军事/奇幻/武侠/现实/其他）",
    "targetAudience": "受众（男频/女频/通用）",
    "subGenre": "细分类型及标签",
    "coreOutline": "核心大纲（150字以上，含主线目标、核心冲突、故事走向）",
    "worldSetting": "世界观背景与力量体系",
    "goldenFinger": "主角金手指/核心能力体系",
    "protagonistProfile": "主角人设（性格、背景、核心驱动力）",
    "globalGuidance": "根据已有内容归纳的全局写作风格与节奏要求"
  },
  "architectureFiles": {
    "premise": "核心故事前提文本（200字以内的高度浓缩核心）",
    "characters": "已知主要角色的关系网与动力学分析",
    "worldbuilding": "世界观矩阵（力量体系、阶层结构、重要场景）",
    "synopsis": "已知的情节走向分析（含已完成的部分和推测的后续走向）"
  },
  "characterCards": [
    {
      "name": "角色名",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "性别",
      "age": "年龄或阶段",
      "appearance": "外貌描写",
      "personality": "性格特征",
      "background": "背景故事",
      "abilities": "能力/技能",
      "motivation": "核心动机",
      "relationships": "关系网",
      "arc": "已知成长轨迹",
      "notes": "其他注意事项",
      "currentState": {
        "location": "最后已知位置",
        "powerLevel": "当前境界/能力等级",
        "physicalState": "当前身体状态",
        "mentalState": "当前心理状态",
        "keyItems": "当前持有的关键道具",
        "recentEvents": "最近发生的重要事件",
        "updatedAtChapter": 0
      }
    }
  ]
}

要求：
1. characterCards 仅包含主角和重要配角（3-8人），不要填写次要龙套
2. 所有字段基于内容推断，未能确定的字段填写"（待确认）"
3. currentState 应基于最新内容（结尾采样）推断，不是初始状态`,
  },
  {
    key: 'infer_novel_config_with_vectors',
    name: '向量采样增强推演',
    description: '利用向量检索采样的精确内容片段，增强全局配置推演的准确度',
    systemRole: '你是一位顶级网文主编和资深阅读分析师，擅长从已有作品中逆向推演设定体系。',
    variables: {
      sampled_worldview: '向量检索：世界观与力量体系相关片段',
      sampled_protagonist: '向量检索：主角设定与金手指相关片段',
      sampled_conflict: '向量检索：核心矛盾与敌对势力相关片段',
      sampled_style: '向量检索：写作风格与叙事视角相关片段',
      first_chapter: '第一章正文（开局风格参考）',
      latest_chapter: '最新一章正文（当前进度参考）',
      total_chapters: '已有总章数',
    },
    content: `请根据以下从小说中精准提取的关键片段，逆向推演出这部小说的完整设定体系。

【第一章正文（开局风格参考）】
{{first_chapter}}

【最新一章正文（当前进度参考）】
{{latest_chapter}}

【总章数】{{total_chapters}} 章

【向量检索精选片段 — 世界观与力量体系】
{{sampled_worldview}}

【向量检索精选片段 — 主角设定与金手指】
{{sampled_protagonist}}

【向量检索精选片段 — 核心矛盾与敌对势力】
{{sampled_conflict}}

【向量检索精选片段 — 写作风格与叙事手法】
{{sampled_style}}

---

请严格按照以下 JSON 格式返回分析结果：

{
  "novelConfig": {
    "genre": "主类型（玄幻/仙侠/都市/科幻/历史/悬疑/游戏/军事/奇幻/武侠/现实/其他）",
    "targetAudience": "受众（男频/女频/通用）",
    "subGenre": "细分类型及标签",
    "plotStructure": "故事结构（three_act/heros_journey/save_the_cat/kishotenketsu/multi_thread/freeform）",
    "narrativePOV": "叙事视角（third_limited/first_person/third_omniscient/multi_pov）",
    "coreOutline": "核心大纲（150字以上，含主线目标、核心冲突、故事走向）",
    "worldSetting": "世界观背景与力量体系",
    "goldenFinger": "主角金手指/核心能力体系",
    "protagonistProfile": "主角人设（性格、背景、核心驱动力）",
    "globalGuidance": "根据已有内容归纳的全局写作风格与节奏要求"
  },
  "architectureFiles": {
    "premise": "核心故事前提文本（200字以内的高度浓缩核心）",
    "characters": "已知主要角色的关系网与动力学分析",
    "worldbuilding": "世界观矩阵（力量体系、阶层结构、重要场景）",
    "synopsis": "已知的情节走向分析（含已完成的部分和推测的后续走向）"
  },
  "characterCards": [
    {
      "name": "角色名",
      "role": "protagonist/antagonist/supporting/minor",
      "gender": "性别",
      "age": "年龄或阶段",
      "appearance": "外貌描写",
      "personality": "性格特征",
      "background": "背景故事",
      "abilities": "能力/技能",
      "motivation": "核心动机",
      "relationships": "关系网",
      "arc": "已知成长轨迹",
      "notes": "其他注意事项",
      "currentState": {
        "location": "最后已知位置",
        "powerLevel": "当前境界/能力等级",
        "physicalState": "当前身体状态",
        "mentalState": "当前心理状态",
        "keyItems": "当前持有的关键道具",
        "recentEvents": "最近发生的重要事件",
        "updatedAtChapter": 0
      }
    }
  ]
}

要求：
1. characterCards 仅包含主角和重要配角（3-8人），不要填写次要龙套
2. 所有字段基于检索片段推断，未能确定的填写"（待确认）"
3. currentState 应基于最新章节推断当前状态，而非初始状态
4. plotStructure 和 narrativePOV 请根据实际叙事特征判断，而非猜测`,
  },
]
