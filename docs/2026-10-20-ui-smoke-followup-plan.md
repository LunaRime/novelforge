# UI 冒烟后续修复计划书

> 日期：2026-10-20  
> 基线：`2b031c4`（UI 冒烟整改已推送，CI run 39387351711 三平台绿）  
> 当前 Schema：v19  
> 状态：计划书，未开始实现  
> 范围：只修 UI 冒烟确认的三类真实缺口，不用假 UI 冒充分支/快照。

---

## 0. 冒烟实证

1. Agent 的 `read_drafts` 能读数据库草稿；`edit_file` / `write_file` 只面向物理文件。实测让 Agent 改第 1 章草稿时，它试了 6 个物理路径后正确拒绝硬写，没有制造副本。
2. 当前没有实验分支：状态栏只有“主线”；VersionHistory 能对比、回滚和手动快照，但没有隔离分支、合并分支或分支级 diff。
3. 自动快照不存在：只有手动“创建快照”，且快照是复制成新 draft 版本，语义是线性历史。
4. 章节活页夹没有拖拽；卷→章→场景里的“场景”没有独立数据模型。
5. 角色仍以 `name` 为唯一主键；关系图按名字连边；改名靠 `renameMap` 级联重写，没有跨实体稳定 ID。
6. 流式期间 XML `<tool_call>…</tool_call>` 只做了 chunk 级正则清理：未闭合块会先上屏；确认卡出现前可能短暂看到原始 JSON。最终 `onDone` 会清洗，但流式 UI 仍违反“工具调用显式、不黑盒”的要求。

已在本批修掉、不要重复做：计划重复清单导致 4 步/进度分母翻倍；计划停在 0/2；工具耗时未记录；初次打开草稿状态栏字数为空。

---

## 1. 总原则

1. 数据库是草稿唯一真相源：不让 Agent 把 DB 草稿复制成物理文件再改。
2. 追加式历史：快照、分支、回滚都创建新版本/新节点，不覆盖旧内容。
3. 稳定 ID：章节号、角色名不再承担跨实体外键职责；显示名可改，ID 不变。
4. 迁移幂等：每一步可重复执行，`user_version` 只在全部步骤成功后递增。
5. 每阶段独立可交付：一个 PR 只做一条工作流，附迁移、测试、真机冒烟。
6. UI 不先于数据模型：分支切换、拖拽、时间线必须先有可回滚的数据结构。

---

## 2. 工作流 A：流式工具协议状态机（先做，独立）

### 现状

- `src/services/agent/agent-engine.ts` 流式路径只用 `createDsmlStreamFilter()` 处理 DSML。
- `src/stores/agent-store.ts` 的 `onTextChunk` 对 `<tool_call>` 是 chunk 级正则：完整对能删，未闭合块删不掉；下一个 chunk 的 JSON 残片可能继续上屏。
- 最终 `onDone` 会全文清洗，所以问题只发生在流式/确认等待窗口。

### 目标

新增有状态过滤 `src/services/agent/tool-protocol-stream-filter.ts`：

- 识别 `<tool_call>` … `</tool_call>`、`<tool_result …>` … `</tool_result>`、DSML 标记。
- `text` / `potentialTag` / `toolCallBlock` / `toolResultBlock` 状态机；跨 chunk 扣住半截标签。
- 工具块整块吞掉，直到闭标签；`flush()` 丢弃未闭合块。
- 不误伤正文中的 `<`、代码块里被展示的标签文本。

### 改动

- `agent-engine.ts`：组合 `xmlFilter.push()` → `dsmlFilter.push()` → `onTextChunk()`。
- `contentOffset` 以已输出可见文本长度为准，不以原始 chunk 长度为准。
- `agent-store.ts` 保留最终清洗兜底；流式不再依赖它。
- 单测：同一段含 XML/DSML 的文本，在每个字符位置切 chunk，拼接输出必须与全文清洗结果一致；覆盖未闭合块、跨 chunk 闭标签、多个工具块、正文 `<`。

### 验收

- 发起写盘请求，确认卡出现前 Agent 区域不出现 `<tool_call>` 或 JSON 残片。
- 工具块仍正常显示名称、参数、耗时、结果。
- 普通正文的 `<` 与代码块标签不被吞。

---

## 3. 工作流 B：快照底座（Schema v20）

> 先做快照，因为 DB 编辑和分支都需要“编辑前可恢复”的底座。

### 数据模型

新增 `draft_snapshots`：

```sql
CREATE TABLE IF NOT EXISTS draft_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_number INTEGER NOT NULL,
  draft_id INTEGER NOT NULL,
  branch_id INTEGER,                 -- v21 起使用
  label TEXT DEFAULT '',
  kind TEXT NOT NULL,                -- auto/manual/pre-agent/pre-restore/branch-base
  content_id INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  word_count INTEGER DEFAULT 0,
  created_by TEXT DEFAULT 'user',    -- user/agent/system
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  FOREIGN KEY (draft_id) REFERENCES drafts(id) ON DELETE CASCADE,
  FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE RESTRICT
);
```

`drafts` 增加：

- `content_hash TEXT DEFAULT ''`：CAS 与快照去重。
- `last_auto_snapshot_at INTEGER DEFAULT 0`：自动快照节流。

### 迁移 v20

- `CURRENT_SCHEMA_VERSION = 20`；`createTables()` 同步。
- `safeAddColumn` 两列；主进程逐行读 `contents.body` 计算 SHA-256，只填空值，可重复执行。
- 建 `idx_snapshots_chapter`、`idx_snapshots_draft`。
- 迁移前备份 `.novelforge/vela.db` 到 `.novelforge/backups/vela-v19-<ts>.db`。
- 非关键步骤失败只 `logger.warn`。

### 服务/API

`electron/repositories/draft-snapshot-repository.ts`：

- `create({chapterNumber,draftId,label,kind,content,contentHash,wordCount,createdBy})`
- `listByChapter`、`getFull`、`pruneAuto`

IPC：`db:draft-snapshot-create/list/get-full/prune`。

### 自动快照规则

- 手动保存成功后调用 `maybeCreateAutoSnapshot(draftId)`。
- 条件：内容 hash 与最近快照不同 + 距 `last_auto_snapshot_at` ≥ 5 分钟。
- 插入 `kind='auto'`，更新节流时间。
- 保留：每章最近 50 个 auto + 全部 manual/pre-agent/branch-base；清理快照与不再被引用 contents 同事务。

### UI

- VersionHistory 列表分“版本 / 快照”两段。
- 快照显示 label、kind、时间、字数、来源。
- 操作：对比、恢复为新版本、重命名 manual。
- 现有“创建快照”改为真正写 `draft_snapshots`。

### 验收

- 连续 Ctrl+S 不堆节点；5 分钟内只一个 auto 快照。
- 手动快照可命名，重启后仍在。
- 恢复快照创建新 draft，不覆盖旧版本。
- v19 旧库升级后 `content_hash` 全部非空；重复迁移不重复回填。

---

## 4. 工作流 C：Agent 直接编辑数据库草稿（依赖 v20）

### 路径语义

| 路径 | 读 | 写 | 规则 |
|---|---|---|---|
| 相对路径 | 既有 | 既有 | 物理文件不变 |
| `vela://draft/{id}` | `db:draft-get-full` | CAS 写 DB | 允许，必须先快照 |
| `vela://manuscript/{id}` | 允许 | 拒绝 | 定稿只读 |
| `vela://core/{field}` | 现有 | 后续单独接 | 不混入本阶段 |
| 其他 `vela://` | 拒绝 | 拒绝 | 明确错误 |

### `edit_file` 流程

1. 识别 `vela://draft/{id}`，解析纯数字 id。
2. 读 `db:draft-get-full`，拿 content/hash/updatedAt/status。
3. `status === 'finalized'` → 拒绝。
4. 复用现有 `findEditMatch` 三层匹配与引号回填。
5. 无实质变化 → 不写。
6. 调 `db:draft-apply-content`（CAS）：draftId、expectedHash、expectedUpdatedAt、newContent、wordCount、reason、old/new 审计摘要。
7. 成功返回新 hash/updatedAt；失败返回 conflict 或错误。

### `write_file`

- 同一 `vela://draft/{id}` 判定与 CAS；整篇替换同样要求确认卡 diff。
- 不得写 `vela://manuscript/{id}`。

### CAS 事务

`db:draft-apply-content` 主进程事务：

1. 读当前 hash/updated_at；不一致 → `{success:false, conflict:true, currentHash, currentUpdatedAt}`。
2. 一致 → 先创建 `pre-agent` 快照（createdBy=`agent`）。
3. 更新 contents.body、drafts.word_count/content_hash/updated_at。
4. 返回新状态。

Agent 遇 conflict 不重试写入，返回“draft changed since read; re-read before editing”，下一轮重新读。

### 编辑器同步

成功写入后发 `REFRESH_RESOURCE {resources:['drafts']}` 和新事件 `DRAFT_CONTENT_UPDATED {draftId,content,hash,updatedAt}`。

EditorStore：

- 找到 `filePath === vela://draft/{id}` 的 tab；
- `syncTabContent` 新内容，不标 dirty；
- 若 tab 有 inlineSession，安全关闭/重建，禁止旧 hunk 应用到新文本。

### ConfirmCard

- 现有 diff 预览已支持 `vela://`；补“数据库草稿”标识。
- 冲突时显示“草稿已变化，请重读”，禁止批准。
- 批准后 toast + `Save:Draft` 日志。

### 测试

- 正常局部替换：其余字节不变。
- stale hash：编辑期间用户改草稿 → conflict，DB 不变。
- finalized 草稿拒绝。
- 拒绝确认：无快照、无写入。
- 批准：生成 pre-agent 快照，内容/字数/更新时间正确。
- 编辑器同步；inlineSession 安全关闭。

---

## 5. 工作流 D：实验分支（Schema v21，依赖 v20）

### 数据模型

`draft_branches`：

```sql
CREATE TABLE IF NOT EXISTS draft_branches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_number INTEGER NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active', -- active/merged/archived
  base_snapshot_id INTEGER,
  head_draft_id INTEGER,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000),
  merged_at INTEGER,
  UNIQUE(chapter_number, name)
);
```

`drafts` 增加 `branch_id INTEGER`（NULL = 主线）。

索引：`idx_drafts_chapter_branch (chapter_number, branch_id, version DESC)`、`idx_branches_chapter`。

### 查询语义

- `getLatestByChapter(chapter, branchId?)`：缺省 = 主线（branch_id IS NULL）；显式 = 分支 head。
- `getNextVersion(chapter, branchId)` 按分支内最大 version + 1。
- 全仓改调用点；不保留“全章最大版本”作为默认。

### 分支操作

- 创建：branch-base 快照 → 插入 branch → 复制 head 成新 draft（branch_id=新分支）→ 打开。
- 切换：状态栏选分支 → 打开 head draft。
- 合并：diff branch head vs 主线 head；生成新主线 draft（不覆盖）；分支置 merged；记录 merged_at 与合并快照。
- 归档：只改 status，不删内容。

### UI

- StatusBar “主线”改为分支选择器：主线 / 实验分支 / 新建分支。
- VersionHistory 增加分支树/筛选。
- Tab 标题显示 `第N章 · 分支名`。
- 保存写入当前 tab 分支，不写主线。

### 测试

- 分支修改不影响主线。
- 切换内容隔离。
- 合并生成新主线版本，旧主线可回滚。
- 分支名唯一；归档分支不出现在切换器。
- v20→v21 旧草稿 `branch_id=NULL`，默认走主线。

---

## 6. 工作流 E：活页夹拖拽 + 场景（Schema v22）

### 数据模型

`blueprints` 增加 `volume_number INTEGER`（NULL = 未分卷）。

`scene_cards`：

```sql
CREATE TABLE IF NOT EXISTS scene_cards (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chapter_number INTEGER NOT NULL,
  title TEXT DEFAULT '',
  summary TEXT DEFAULT '',
  status TEXT DEFAULT 'planned',     -- planned/writing/done
  sort_order INTEGER DEFAULT 0,
  word_count INTEGER DEFAULT 0,
  content_id INTEGER,
  created_at INTEGER DEFAULT (unixepoch() * 1000),
  updated_at INTEGER DEFAULT (unixepoch() * 1000)
);
```

### 迁移 v22

- `volume_number` 按现有 volumes.chapter_start/end 回填；匹配不到为 NULL。
- 不删 volumes 起止列：继续用于进度/自动划分展示。
- 以 `blueprints.volume_number` 作为卷成员唯一真相；拖拽后重算区间。

### 拖拽 API

`db:binder-reorder`：

```ts
{ kind:'chapter', chapterNumber, fromVolume, toVolume, targetChapterNumber?, position:'before'|'after' }
```

主进程事务：更新 volume_number → 目标卷内重排 sort_order（步长 10）→ 重算受影响卷区间 → 返回 binder 数据。

章节号不变；场景拖拽 `kind:'scene'` 只动 scene_cards.sort_order。

### UI

- 侧栏 VolumeGroup 章节行加拖拽把手（桌面 32×32，移动 44×44）。
- 卷间拖拽更新成员；卷内拖拽更新顺序。
- 键盘替代：右键“上移/下移/移到上一卷/移到下一卷”。
- 活页夹层级：卷→章→场景；场景行显示状态/字数。
- 章节看板复用同一 binder 数据，不建第二套顺序。

### 测试

- 卷内换序重启保持，章节号不变。
- 跨卷拖拽两卷区间重算，记忆失效标记触发。
- 键盘移动与拖拽结果一致。
- v21→v22 旧库卷成员按区间回填；无匹配进“未分卷”。

---

## 7. 工作流 F：世界观实体稳定 ID + 时间线（Schema v23）

### 角色稳定 ID

`characters` 增加 `uid TEXT`（16 字节 hex，唯一索引）。

迁移：safeAddColumn → 为空行生成 uid → 建唯一索引。`name` 仍 UNIQUE，显示名仍可改；跨实体引用改用 uid。

关系 JSON 兼容：

```json
{ "target":"林岚", "targetUid":"ab12…", "type":"ally", "label":"" }
```

- 读路径无 targetUid 时按名字补全（只读）。
- 写路径一律写 targetUid。
- renameMap 只改显示名；已有 targetUid 不重写；旧数据继续 renameMap 兜底。

### 世界实体

`world_entities`：uid、kind（place/faction/item/concept）、name、aliases、description、metadata、时间戳；UNIQUE(kind,name)。

`entity_relations`：from_uid、to_uid、type、label，UNIQUE 三元组。

### 时间线

`timeline_events`：uid、title、lane、time_value、time_label、chapter_number、description、entity_uids、location_uid、时间戳。

### UI

- 世界观页签：实体卡片 / 关系图 / 时间线。
- 实体卡片显示可复制 uid。
- 关系图节点 key 改 uid，显示名来自实体表。
- 时间线多泳道：按卷/角色/地点切换；事件卡显示关联实体与章节。
- 点击事件跳章节；点击实体打开卡片。

### 测试

- 角色改名后关系图边不断、时间线链接不断。
- 旧关系 JSON 读取正常，保存后补齐 targetUid。
- place/item 同名允许；同 kind 同名拒绝。
- v22→v23 uid 全部非空唯一；重复迁移幂等。

---

## 8. Schema 迁移矩阵

| 版本 | 内容 | 回填 | 风险 | 回滚 |
|---|---|---|---|---|
| v20 | draft_snapshots、drafts.content_hash、last_auto_snapshot_at | hash 回填 | 大表逐行 hash | 不删列；版本不递增则下次重试 |
| v21 | draft_branches、drafts.branch_id | 全部 NULL | 查询点遗漏 branch | 分支表保留，NULL=主线 |
| v22 | blueprints.volume_number、scene_cards | 按卷区间回填 | 区间重叠/空洞 | 未匹配进“未分卷” |
| v23 | characters.uid、world_entities、entity_relations、timeline_events | uid + targetUid | 关系 JSON 兼容 | 无 uid 时沿用 renameMap |

每个版本必须：迁移前备份；createTables 与 migration 同步；safeAddColumn；rowToData 加默认值；重复启动两次不报错；降级哨兵继续生效。

---

## 9. IPC / API 清单

| 通道 | 用途 | 阶段 |
|---|---|---|
| db:draft-apply-content | CAS 写草稿正文 + pre-agent 快照 | C |
| db:draft-snapshot-create/list/get-full/prune | 快照 CRUD | B |
| db:draft-branch-create/list/switch/merge/archive | 分支 | D |
| db:binder-reorder | 卷/章/场景重排 | E |
| world:entity-list/upsert/delete | 世界实体 | F |
| world:relation-list/upsert/delete | 实体关系 | F |
| timeline:event-list/upsert/delete | 时间线 | F |

所有新通道：进 ipc-channels 类型表、preload 白名单、主进程参数二次校验、返回 `{success:false,error}`。

---

## 10. 实施顺序与 PR 拆分

| PR | 内容 | 依赖 | 预计 |
|---|---|---|---|
| 1 | 流式协议状态机 + 切块 fuzz 测试 | 无 | 0.5–1 天 |
| 2 | Schema v20 快照底座 + VersionHistory | 无 | 1.5–2 天 |
| 3 | vela://draft 读写 + CAS + 编辑器同步 | PR2 | 2–3 天 |
| 4 | Schema v21 分支 + 状态栏切换/合并 | PR2 | 2–3 天 |
| 5 | Schema v22 活页夹拖拽 + 场景 | 无（可与 4 并行） | 2–3 天 |
| 6 | Schema v23 实体 UID + 时间线 | PR4/PR5 | 3–4 天 |

每笔 PR：只做一条工作流；迁移与 Repository 同提交；带 vN→vN+1/重复迁移/fresh DB 测试；本地 typecheck/lint/test/vite build 全绿；推送后核对三平台 CI。

---

## 11. 真机验收清单

### Agent 编辑数据库草稿

1. 打开第 1 章草稿。
2. 让 Agent 把第一段 X 改成 Y，只改这一处。
3. 确认卡显示行级 diff。
4. 拒绝：DB 不变、无快照。
5. 批准：DB 更新、编辑器同步、状态栏已保存。
6. 版本历史出现 pre-agent 快照，可对比/恢复。
7. Agent 等待期间手动改草稿再批准 → 冲突提示，不覆盖用户修改。

### 快照与分支

1. 连续自动保存 3 次：5 分钟内只一个 auto 快照。
2. 手动命名快照并重启：名称保留。
3. 建分支改第一段 → 主线不变。
4. 切回主线 → 内容不变。
5. 合并分支 → 主线新版本，旧版本仍可回滚。

### 活页夹与实体

1. 卷内拖拽章节 → 重启后顺序保持，章节号不变。
2. 跨卷拖拽 → 两卷区间正确，记忆失效标记触发。
3. 键盘移动与拖拽结果一致。
4. 角色改名 → 关系图/时间线/章节关联不断。
5. 新建地点实体 → 时间线事件可关联地点与角色，点击跳转。

### 流式协议

1. 发起 write_file 请求。
2. 确认卡出现前无 `<tool_call>`/JSON 残片。
3. 最终消息无协议标签。
4. 普通正文 `<` 与代码块标签不被吞。

---

## 12. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 快照/contents 外键导致删除失败 | 快照删除与 contents 清理同事务；被引用内容不删 |
| branch-aware 查询遗漏旧调用点 | 全仓搜 getLatestByChapter/getNextVersion；默认参数强制主线 |
| 卷区间与显式成员双真相 | volume_number 唯一真相；区间每次重算，仅作展示 |
| 角色 uid 迁移破坏旧关系 | 读时按名字补 uid；旧 JSON 不丢；renameMap 兜底 |
| 拖拽只剩鼠标 | 每个拖拽操作必须有右键/命令面板键盘替代 |
| 迁移中断 | 备份 + user_version 末尾递增 + 每步幂等 |
| Agent 写入覆盖用户编辑 | hash CAS；冲突即拒绝并让模型重读 |

---

## 13. 非目标

- 不把数据库草稿导出成物理文件再改。
- 不用“复制一份 draft”冒充分支；分支必须有名字、基线、head、合并状态。
- 不在拖拽时重编号章节号（会破坏所有引用）。
- 不删除旧版本/旧快照来实现“回滚”。
- 不为时间线先做假卡片；先有稳定 uid 与事件表。

---

## 14. 完成定义

同时满足才叫修复完成：

- Agent 能读、能改数据库草稿，确认卡有 diff，批准/拒绝/冲突三条路径可验证。
- 快照自动+手动可用，分支隔离可切换可合并，主线历史不被覆盖。
- 活页夹卷→章→场景可拖拽且有键盘替代，重启后顺序保持。
- 角色/地点/事件有稳定 uid，改名不破链接，时间线多泳道可跳转。
- 流式 UI 无原始工具协议残片。
- v19→v23 迁移全部通过 fresh/upgrade/repeat/降级哨兵测试，三平台 CI 绿。
