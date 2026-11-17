/** 角色卡动态状态 */
export interface CharacterStateData {
    location: string
    powerLevel: string
    physicalState: string
    mentalState: string
    keyItems: string
    recentEvents: string
    updatedAtChapter: number
}

/** 角色卡完整数据（前端驼峰接口） */
export interface CharacterData {
    name: string
    /** v23: 稳定实体 ID；改名不破链接 */
    uid?: string
    role: string
    gender: string
    age: string
    appearance: string
    personality: string
    background: string
    abilities: string
    motivation: string
    relationships: string
    arc: string
    notes: string
    /** v7: 戏份等级 1=核心 2=配角 3=龙套 */
    tier: number
    /** v7: 标签 JSON 数组 */
    tags: string
    /** v7: 出场章节 JSON 数组 [1,5,10] */
    appearChapters: string
    /** v7: 结构化关系 JSON 数组 */
    relations: string
    /** v14: 别名/称呼注册表 JSON 数组（昵称/称号/曾用名，角色名匹配的变体形态） */
    aliases?: string
    /** v15: 出场章数统计（定稿时维护） */
    appearCount?: number
    /** v15: 首次出场章号（0=未记录） */
    firstChapter?: number
    /** v15: 最近出场章号（0=未记录） */
    lastChapter?: number
    /** v15: 生命周期状态 active=活跃 / departed=退场 / dead=死亡移除（dead 退出关系检测候选） */
    status?: string
    currentState?: CharacterStateData
}
