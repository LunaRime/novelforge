# 项目结构检查报告

> 检查范围：顶层目录、src/ 与 electron/ 的目录树、文件归属、命名规范、空目录/死代码。
> 关注点：文件是否放对位置、目录策略是否一致、有没有明显错放与结构噪音。

---

## 一、总体结论

**目录组织整体健康，分层策略一致（"域大则建子目录"），命名规范统一**：
- 组件目录（dialogs/editor/layout/pages/panels/settings/ui）边界清晰；
- services 下 agent/audit/llm/prompts/workflows 已按域建子目录，根级保留通用服务；
- 命名规范一致（组件 PascalCase / 服务与 store kebab-case / hooks use*）；
- 无死代码目录（vector-utils 被 embedding-controller 使用、tokens/ 是 `gen:tokens` 自动生成产物）。

发现的问题分两类：**3 处明确错放（低风险可修）** 与 **3 处结构性噪音（改动面大，建议不动）**。

---

## 二、目录树（现状）

```
electron/
  controllers/  repositories/  llm/  mcp/  utils/
  + 根级 10 个服务文件（main/preload/database/embedding*/knowledge-base/vector-store/...）
src/
  components/  dialogs/editor/layout/pages/panels/settings/ui
  services/    agent/audit/llm/prompts/workflows + 根级 36 个服务
  stores/  shared/  hooks/  lib/  utils/  tokens/  styles/  stories/
顶层：build/  docs/  public/  scripts/  src/  electron/  screenshots/  tools/
```

---

## 三、明确错放（低风险，建议修复）

### 🟠 S-1 `workflow-guards.ts` 在 services 根，应属 workflows/ 域
- `services/workflows/` 子目录已存在，但 `workflow-guards.ts`（guard 系列守卫）平铺在 services 根；
- 被 5 个组件引用（`ChapterCardEditor` / `DraftEditor` / `ArchitectureConfirmDialog` / `ChapterCreationDialog` / `CodeMirrorEditor`），import 路径 `../../services/workflow-guards` → `../../services/workflows/workflow-guards`；
- 纯移动 + 5 处路径替换，机械且低风险。

### 🟠 S-2 `health-check.ts` 是 controller 却不在 controllers/
- `registerHealthCheckIPC` 的注册模式与其余 15 个 controller 完全一致，但文件放在 electron 根；
- 仅 `ipc-handlers.ts` 一处 import，移动成本 1 行。

### 🟠 S-3 `tools/` 空目录
- 顶层 `tools/` 无任何文件（git 不跟踪空目录，但结构上冗余），可删除。

---

## 四、结构性噪音（改动面大、无功能收益，建议保持现状）

### 🟡 S-4 electron 知识库/向量 5 文件平铺根级，与 llm/、mcp/ 不对称
- `knowledge-base.ts` / `vector-store.ts` / `embedding.ts` / `embedding-service.ts` / `llm-embedding-optimizer.ts` 构成完整"知识库/向量"子系统，却都平铺在 electron 根，而 llm/、mcp/ 有子目录；
- 归入 `electron/knowledge/` 子目录可改善对称性，但涉及 10+ 文件 import 路径改动（controllers/repositories/渲染层 ipc-channels 引用）——**纯移动无功能收益**，建议在下次大重构时一并处理。

### 🟡 S-5 services 根级 36 个文件，角色域 7 个可分组
- `character-*.ts` 已有 7 个（normalize/archive/card-merge/duplicates/name-repair/voice-analyzer/appearance-scan），`blueprint-*` 3 个——可建 `characters/`、`blueprints/` 子目录；
- 根级仍会保留 ~29 个通用服务，且改动面大（每个被多文件引用）——**建议仅在新服务落位时按域归位，不批量迁移存量**。

### 🟡 S-6 `src/lib/` 与 `src/utils/` 双工具目录
- `lib/utils.ts`（cn 工具，被 15+ UI 组件引用）与 `utils/`（id/time/frontmatter）职责不同、**无重复函数**；
- 命名易混淆（两个"utils"），但合并需改 20+ 处 import——**不建议动**，可在目录内补注释说明职责边界。

---

## 五、做得好的（无需处理）

| 项 | 说明 |
|----|------|
| 组件目录 7 分 | dialogs/editor/layout/pages/panels/settings/ui 边界清晰无交叉 |
| services 子目录策略 | "域大则建子目录"（agent/audit/llm/prompts/workflows），根级保留通用服务 |
| 命名规范 | 组件 PascalCase / 服务与 store kebab-case / hooks use* / 测试 *.test.ts 就近 |
| 生成产物隔离 | `src/tokens/` 由 `scripts/extract-tokens.cjs` 自动生成并标注"勿手动编辑" |
| 工具函数归位 | `vector-utils` 在主进程 utils/（被 embedding-controller 使用）；`lib/utils` 与 `utils/` 无重复 |
| 构建脚本独立 | `scripts/`（11 个 CJS/PS1/mjs）与业务代码完全隔离 |

---

## 六、建议

1. **S-1/S-2/S-3（30 分钟内）**：workflow-guards 移入 workflows/、health-check 移入 controllers/、删除空 tools/——机械低风险，立即改善一致性；
2. **S-4/S-5/S-6（保持现状）**：纯移动无功能收益且改动面大，建议在下次涉及这些模块的大重构时顺带归位，或对新增文件按目标域落位。

> 一句话结论：**项目结构无伤大雅的问题，仅 3 处明确错放值得立即修正（纯移动），其余为结构对称性噪音——不建议为移动而移动。**

---

## 七、修复状态（分点修复记录）

| 编号 | 问题 | 状态 | 落地位置 |
|------|------|------|----------|
| S-1 | `workflow-guards.ts` 在 services 根 | ✅ 已修 | `git mv` 至 `services/workflows/workflow-guards.ts`；7 处 import 路径更新（ChapterCardEditor / ArchitectureConfirmDialog / ChapterCreationDialog / DraftEditor + start-workflow.tool 动态 import ×3）；文件内部 4 处相对 import 同步调整 |
| S-2 | `health-check.ts` 是 controller 却不在 controllers/ | ✅ 已修 | `git mv` 至 `electron/controllers/health-check.ts`；内部 4 处相对 import（`./database` → `../database` 等）+ ipc-handlers.ts 引用更新 |
| S-3 | 顶层 `tools/` 空目录 | ✅ 已修 | 已删除（git 不跟踪空目录，rmdir 移除） |
| S-4 | electron 知识库/向量 5 文件平铺根级 | ⏸️ 未动 | 纯移动无功能收益，待下次大重构顺带归位 |
| S-5 | services 根级角色域 7 文件可分组 | ⏸️ 未动 | 存量不批量迁移，仅新服务按域落位 |
| S-6 | `src/lib/` 与 `src/utils/` 双工具目录 | ⏸️ 未动 | 职责不同无重复，合并需改 20+ 处 import，不值得 |

> 门禁：typecheck 零错误、lint 零警告（--max-warnings 0）。
