# 从定稿正文生成角色档案 — 设计文档

日期:2026-08-07
状态:待审阅
方案:按角色检索上下文 + 逐角色 LLM(方案 A)

## 1. 背景与目标

### 痛点
定稿后处理 `character_cards` 步骤的 NEW 行只登记最小信息(`finalize-chapter.command.ts`:
`gender/age/background/abilities/relationships/arc/notes` 硬编码空),新出场角色的
档案详情大片空白。现有唯一详情较全的渠道是架构后处理提取(数据源=角色图谱,非正文)。

### 目标
在角色管理提供双入口,基于**已定稿章节正文**为角色生成/补全静态档案
(外貌/性格/背景/能力/动机/成长弧/关系/备注 + 标签),**仅填充空白**、不覆盖已有值。

## 2. 需求定型(已与用户确认)

| 维度 | 决策 |
|------|------|
| 生成范围 | 全部角色(侧栏全局)+ 选中角色(CharacterEditor 单角色)双入口 |
| 生成内容 | 静态档案 10 字段 + tags;**不含** cs_* 动态状态(定稿增量专属职责) |
| 覆盖策略 | **仅填充空白**:LLM 输出非空才写入,已有值保留(SQL CASE 写时刻保旧) |
| 入口位置 | CharactersView 顶部操作栏 + CharacterEditor 工具栏 |

## 3. 架构与数据流

### 新文件 `src/services/character-archive.ts`(纯函数,可单测)

```
extractRoleContextSegments(chapters: string[], name: string,
                           windowChars?: number, maxSegments?: number): string[]
  - 按角色名出现位置抽 ±800 字窗口段落
  - 相邻段合并(重叠窗口去重),按段数/字数预算截断(默认 ≤8 段 ≈ 6400 字)
  - 角色名未在正文出现 → 返回 []

hasBlankArchiveFields(char): boolean
  - 档案 10 字段(gender/age/appearance/personality/background/abilities/
    motivation/relationships/arc/notes)任一为空/哨兵 → true(需要生成)
  - 全部非空 → false(前置跳过,省 token)
```

### 写库 `electron/repositories/character-repository.ts` 新增 `mergeFields`

```sql
UPDATE characters SET
  gender        = CASE WHEN ? != '' THEN ? ELSE gender END,
  age           = CASE WHEN ? != '' THEN ? ELSE age END,
  appearance    = CASE WHEN ? != '' THEN ? ELSE appearance END,
  personality   = CASE WHEN ? != '' THEN ? ELSE personality END,
  background    = CASE WHEN ? != '' THEN ? ELSE background END,
  abilities     = CASE WHEN ? != '' THEN ? ELSE abilities END,
  motivation    = CASE WHEN ? != '' THEN ? ELSE motivation END,
  relationships = CASE WHEN ? != '' THEN ? ELSE relationships END,
  arc           = CASE WHEN ? != '' THEN ? ELSE arc END,
  notes         = CASE WHEN ? != '' THEN ? ELSE notes END,
  tags          = COALESCE(?, tags),
  updated_at    = unixepoch() * 1000
WHERE name = ?
```

- 与 `updateState`(块 4)同构:写时刻以 DB 当前值为基准,空值/哨兵保旧列
- 不触碰:cs_*(动态状态)、role/tier、relations、appearChapters、currentState
- IPC:新增 `db:character-merge-fields` 通道(db-controller + ipc-channels 签名;preload 白名单 `db:` 前缀已覆盖)

### 模板 `src/services/prompts/characters.ts` 新增 `extract_from_finalized`

- 输入:角色名 + 相关正文段落(带章节号标记)
- 输出:JSON 档案对象(role 除外;含 gender/age/appearance/personality/background/abilities/motivation/relationships/arc/notes/tags)
- 哨兵纪律:无信息字段输出空字符串(勿用"无/无变化"占位,空值不覆盖已有)
- content 三语(zh-CN/en-US/ru-RU),systemRole 三语,注册到 prompt-templates + i18n desc

### 工作流 `src/services/workflows/character-archive-workflow.ts`(新文件)

仿 `createCharacterExtractSteps` 模式:

- `runCharacterArchive(projectPath, nameFilter?: string)` → post_process 工作流
- 步骤:单步骤 `archive_from_finalized`,executor 内逐角色循环
  (每角色独立 try/catch——单角色失败不阻断,失败计数汇总日志)
- 数据源:`db:draft-get-finalized`(定稿正文)+ `db:character-get-all`
- 前置过滤:`hasBlankArchiveFields` 为假 → 跳过 + 日志
- 完成:critical 步骤通过 → `globalEventBus.emit('REFRESH_RESOURCE', { types: ['characterCards'] })`
  → project-service → character-store.load()

### 入口 UI

| 入口 | 位置 | 行为 |
|------|------|------|
| 全局 | CharactersView 顶部操作栏(RefreshCw/Plus 旁) | 确认弹窗 → runCharacterArchive |
| 单角色 | CharacterEditor 工具栏 | 确认弹窗 → runCharacterArchive(nameFilter: selectedName) |

- 确认弹窗文案说明"仅填充空白,不覆盖已编辑内容"(新 i18n key `character.archiveConfirm*` 三语)
- 执行中按钮 loading 态(仿 extracting 状态)
- 双入口共用同一 executor,单角色传 nameFilter

## 4. 错误处理

| 场景 | 处理 |
|------|------|
| 角色名未命中正文 | 日志跳过(不调用 LLM) |
| 单角色 LLM 失败/解析失败 | try/catch 记录失败计数,继续下一角色 |
| 全部角色失败 | 汇总 error 日志 + 步骤 failed(用户可见) |
| 无定稿章节 | 前置检查 toast 引导(无正文可分析) |
| 全部角色档案已完整 | 日志说明跳过,步骤成功 |

## 5. 成本控制

- 前置跳过:档案已全的角色不调用 LLM
- 段落预算:每角色 ≤8 段 × 800 字(可调参数)
- 逐角色流式 appendText,进度可见、可取消

## 6. 测试计划

| 层 | 测试 |
|----|------|
| 纯函数 | extractRoleContextSegments:位置/窗口/重叠合并/预算截断/无命中 |
| 纯函数 | hasBlankArchiveFields:全空/部分空/全非空/哨兵值 |
| 写库 | mergeFields(node:sqlite 内存 DB mock):非空填充/空不覆盖/字段级独立/tags COALESCE |
| 解析 | 模板输出 JSON 经 robustParseJSON + normalizeTagsValue 归一化(复用现有) |
| i18n | 模板 content 3 语存在性 + 新 key 3 语 |

## 7. 不做的事(YAGNI)

- 不生成动态状态(cs_*)——定稿增量维护
- 不做"混合按编辑状态覆盖"——仅填充空白已满足
- 不做关系检测/出场章节更新——其他子系统职责
- 不做模板市场(项目级 prompt 覆盖机制已有,模板走 getPromptTemplate 自动继承)
