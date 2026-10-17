# 内置模型目录刷新（pi-ai 1.1.0 / DSH 0.2.1-rc.1，2026-10-17）

> **目标**：把程序内置的模型目录（服务商预设里的「默认模型目录」与逐模型规格）刷新到
> DSH（deepseek-harness）当前锁定版本，尤其是 DeepSeek 官方 V4.1 目录与真实 1M 上下文窗口。
>
> **状态**：✅ 已执行；门禁全绿（tsc 0 / eslint 0 / 240 文件 2901 测试全过）；
> 未推送（本机代理 7890 未运行，GitHub 直连被 reset）。

---

## 一、数据源与取数方式（为什么不是直接读 DSH 仓库）

- DSH `0.2.1-rc.1` 的 `pnpm-lock.yaml` 锁定 **`@earendil-works/pi-ai@1.1.0`**
  （integrity：`sha512-1T7LAkc/5Bvc0v6w4vAGVdCrli0o/E0pEmYKTnixu95vSFArBjvbhS/G4ZwI0RUePgf0Imcu0VyqlM4EcXxqfw==`）。
- 但 `D:\Code\deepseek-harness` 是**纯源码 checkout，没有 `node_modules`**：
  `packages/llm/llm-pi-ai` 只 import 该包，目录数据（`dist/providers/data/*.json`）不在仓库里。
  仓库内的 `provider-data.generated.ts` 只含供应商 endpoint / 环境变量名，不含模型规格。
- 因此按 DSH 锁定的精确版本，从 npm 镜像取包（不安装依赖、不入库）：
  `npm pack @earendil-works/pi-ai@1.1.0` → 解开后按迁移脚本约定的
  `<源根>/node_modules/.pnpm/@earendil-works+pi-ai@1.1.0/node_modules/@earendil-works/pi-ai` 摆放。
- DeepSeek **官方推荐目录**另以 DSH 源码为准：`packages/llm/llm-deepseek/src/models.ts`
  （`deepseek-flash` = DeepSeek-V4.1-Flash、`deepseek-v4-pro` = DeepSeek-V4-Pro，均 1,000,000 窗口），
  与 pi-ai 1.1.0 的 deepseek 数据一致。

## 二、1.1.0 的 schema 变化与脚本适配

旧脚本假设「模型文件只有 `openai-completions` / `anthropic-messages` 两键、键名 = 模型 ID」。
1.1.0 实际 schema 已变（本次第一轮生成暴露：模型 ID 全带 `chat:` 前缀，直接当目录会批量污染）：

| 变化 | 旧（<= 1.0.x） | 新（1.1.0） |
|---|---|---|
| 文件结构 | 按协议键分组（2 键） | 按协议键分组，新增 `openai-responses` / `google-generative-ai` / `mistral-conversations` / `openai-decisions` 等 |
| 条目键 | 模型 ID | `chat:<模型 ID>`（classifier/image 等非 chat 条目同在） |
| 真实模型 ID | 键 | **`entry.id`** |
| 非生成条目 | 无 | `type: classifier` / `image` 等 |

适配后的脚本（`scripts/migrate-pi-ai-catalog.cjs`）：
1. **规格表**：跨全部协议键合并、仅收 `type === 'chat'`（或旧 schema 无 type）、
   真实 ID 取 `entry.id`（兼容旧 schema 回落键名）、按 ID 去重、缺字段互补；
2. **新供应商预设**：仍按 `openai-completions` / `anthropic-messages` 选协议（现有 9 家都命中），
   模型 ID 取 `entry.id`、`baseUrl` 取首个 chat 条目；
3. 生成文件头记录数据版本基准、schema 说明与刷新方式（含 integrity 可追溯）。

## 三、DeepSeek 手写目录（对齐 DSH 官方目录）

`src/shared/provider-presets.ts` 的 deepseek 条目：

| 模型 | 来源 | contextWindow | maxTokens（NF 口径） |
|---|---|---|---|
| `deepseek-flash`（DeepSeek-V4.1-Flash，默认） | DSH `llm-deepseek/src/models.ts` + pi-ai 1.1.0 | 1,000,000 | 131,072 |
| `deepseek-v4-pro`（DeepSeek-V4-Pro） | 同上 | 1,000,000 | 131,072 |
| `deepseek-v4-flash`（旧 ID，保留兼容） | 存量配置可能引用；pi-ai 1.1.0 官方目录已不列 | 1,000,000 | 131,072 |

⚠️ **`contextWindow` 必须显式写**：读取路径对缺字段的条目不按规格兜底，而用 `maxTokens`
兜底（拆分字段时的忠实搬运）——不写就是「窗口 131k」，正是 2026-10-17 真机配置的问题。
`maxTokens` 仍取 `MAX_TOKENS_CAP = 131072`（NF 全局输出上限，设置页与主进程共用同一常量），
不随模型能力抬到 384k；模型真实输出能力记在注释与生成表里。

## 四、改动文件

| 文件 | 改动 |
|---|---|
| `scripts/migrate-pi-ai-catalog.cjs` | 适配 pi-ai 1.1.0 schema（跨协议键/`entry.id`/`type=chat` 过滤/去重）；头部记录版本基准与 integrity |
| `src/shared/model-specs.generated.ts` | 重新生成：**11 家 / 554 个模型规格**；9 家新供应商预设按其 1.1.0 数据更新（模型清单、baseUrl） |
| `src/shared/provider-presets.ts` | DeepSeek 目录对齐 V4.1（新增 deepseek-flash；v4-pro 补 1M 窗口；旧 v4-flash 标兼容） |
| `src/shared/provider-presets.test.ts` | 生成表补全用例改为跨 provider 动态取样本（不再写死 deepseek 未收录项——pi-ai 升级后该前提消失）；新增 DeepSeek 官方目录 + 1M 窗口锁定用例 |
| `src/shared/provider-accounts.test.ts` | 继承目录名序断言改用 `builtinCatalogFor` 同款去重 + 生成表键；「生成表带来新键」改为动态找 provider（数据漂移不再误报） |
| `src/components/settings/ModelCatalogEditor.test.tsx` | 容量 placeholder 用例不再假设「目录末行是 embedding」，按模型名定位行并用 `formatCapacity(继承规格)` 断言 |

## 五、`pi-ai` 能否作为本项目依赖？（评估结论）

**结论：可以（许可/引擎都兼容），但本轮不建议作为运行时依赖；只作为构建期数据源。**

支撑事实（`@earendil-works/pi-ai@1.1.0`）：

| 维度 | 事实 | 影响 |
|---|---|---|
| 许可 | MIT（Copyright Mario Zechner）；NF 为 GPL-3.0 | MIT 与 GPL 兼容；必须保留版权/许可声明（生成文件头已注明） |
| 模块格式 | `"type": "module"`，exports 仅 `import` 条件（**ESM-only**） | NF 主进程/预加载为 CJS（`package.json` `type: commonjs`），接入需打包器转换或动态 import，preload 侧尤其受限 |
| 引擎 | `node >= 22.19.0` | Electron 41（Node 24）满足 |
| 依赖体积 | 运行依赖含 `@anthropic-ai/sdk`、`@aws-sdk/client-bedrock-runtime`、`@google/genai`、`openai`、`typebox`、telemetry、proxy agents | 显著增加安装/打包体积与供应链面；NF 已有自己的 `electron/llm/*` provider 层 |
| DSH 用法 | DSH 用 `llm-pi-ai` 适配器包一层（且打补丁修流式 tool-call partial JSON）；官方 DeepSeek 路由反而走自研 `llm-deepseek`（Messages API） | 直接拿 pi-ai 当 provider 要同时补适配层 + 跟进补丁，不属于「更新内置模型」 |
| 产品需求 | NF 需要自己的代理设置、重试、并发、凭据 ref、thinking 参数、IPC 流式契约 | 替换 provider 层是一次独立架构工程，风险与收益需单独立项 |

**采用方式**：保留「快照入库、运行时不依赖」的既有设计——用 DSH 锁定的精确版本取数据、
生成 `model-specs.generated.ts` 入库；刷新是显式动作（可复跑脚本），线上无新增依赖。
若将来要换 provider 运行时（原生 tool calling / 多协议统一），建议先出一份架构设计
（ESM/CJS 边界、bundle/asar、代理与凭据、DeepSeek 补丁跟进、回归面），再动核心链路。

## 六、验证

| 项 | 结果 |
|---|---|
| `npx tsc --noEmit` | ✅ 0 错误 |
| `npx eslint . --ext ts,tsx --max-warnings 0` | ✅ 0 错误 0 警告 |
| `npx vitest run` | ✅ **240 文件 / 2901 测试全过** |
| 迁移脚本幂等 | ✅ 重跑生成结果逐字节稳定；`node --check` 通过 |
| 数据完整性 | 11 家规格 / 554 模型；9 家新供应商模型非空；生成文件无空 `baseUrl` |
| DeepSeek 锁定 | `deepseek-flash` / `deepseek-v4-pro` → window 1,000,000、maxTokens 131,072（新增用例） |

## 七、已知遗留（不在本轮范围）

1. **`MAX_TOKENS_CAP = 131072`**：DeepSeek V4.1 实际输出能力 384,000，NF 全局输出上限仍 131k。
   是否抬上限是独立决策（设置页钳制 + 主进程运行时钳制共用该常量，需评估超限 API 400 风险）。
2. **存量用户模型配置不自动迁移**：内置目录只影响「继承态账户」与新建条目；已手动保存的
   `models.json` 条目是用户权威值（其 `contextWindow` 仍可能是旧的 131k，需要用户在设置里
   改窗口或在账户目录里「恢复默认模型」）。是否做一次性迁移需单独裁决。
3. **价格表未更新**：`model-router.ts` / `prompt-cache.ts` 的估算价按型号硬编码，`deepseek-flash`
   暂无价格键（会落到默认价）；DSH 明确不消费 pi-ai 的成本元数据，缺权威价格源，故不动。
4. **pi-ai 的 DSH 补丁未跟进**：DSH 对 1.1.0 打了「流式 tool-call partial JSON」补丁；
   本轮只用其静态目录数据，不涉及该行为。
