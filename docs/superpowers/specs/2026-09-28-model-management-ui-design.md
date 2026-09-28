# 模型管理 UI 改进设计（对照 deepseek-harness）

> 2026-09-28 · 状态：待审 · 依据：用户指令（"学习 D:\Code\deepseek-harness 的添加模型 UI…改进 NF 的模型管理 UI"）+ 四工作项经用户全选确认
> 参照物：`D:\Code\deepseek-harness`（DeepSeek 官方 harness）`packages/client/ui-settings-models`

## 一、背景与目标

NF 的模型管理 UI 分布在两处：**供应商账户区**（`ProviderAccountsSection`：凭据 + 获取模型勾选）与**模型列表**（`SettingsModal` 内联：`ModelCard` 列表 + `ModelForm` 编辑）。对照 dsh 后确定四个工作项（用户全选）：

1. **操作按钮规范化** —— `ModelCard` 的设默认/编辑/删除当前是 hover 才显形（违反 NF 自家不变量「操作按钮常驻」）、热区 24.5px、缺 aria-label；
2. **行内编辑** —— 点「编辑」现在整列表被 `ModelForm` 替换，改为**原地展开**；
3. **拉取体验对齐** —— 供应商区候选清单加搜索/全选；模型编辑表单接入"用当前表单值探测端点"（dsh 招牌交互）；
4. **视觉/刻度** —— 按 NF 自身刻度体系核对（不照搬 dsh 字号）。

### 总原则：搬交互与视觉，不搬领域模型

dsh 是「供应商档（凭据/地址）挂模型数组」两段式；NF 是 `ModelProfile` 自带凭据 + 独立供应商账户层。**数据层、IPC、`llm-store` 全部不动**——`listProviderModels({ provider, protocol, apiKey, baseUrl })` 已存在（供应商区在用），本次只是把它接进模型表单。

## 二、结构拆分（为 ② 铺路）

新建 `src/components/settings/ModelListSection.tsx`：

- 迁出 `SettingsModal.tsx` 的「模型列表区 + `ModelCard` + `ModelForm`」（现约 226–413、627–1033 段，~600 行），props 化（`purposes` 等由外层传入），行为不变；
- `SettingsModal` 变薄（1460 → ~860 行）后 import 使用；
- 两个组件**目前零测试**；拆出后按 `ModelRoutingSection` 先例（export 单测）获得独立测试。

## 三、① 操作按钮规范化（`ModelCard`）

| 项 | 现状 | 改为 |
|---|---|---|
| 显隐 | `opacity-0 group-hover:opacity-100`（hover 才显形） | **常驻**（spec 不变量「操作按钮常驻」） |
| 热区 | `w-7 h-7`（24.5px） | **32×32**（ui-interaction-standard 唯一来源） |
| 无障碍 | 仅 `title` | 补 `aria-label`（title 保留） |
| 删除确认 | 已有二次确认 | 保持 |

## 四、② 行内编辑（核心改动）

### 状态模型

```ts
// 旧：editingModel: ModelProfile | null —— 存在时整列表被表单替换
// 新：列表常驻，编辑器在对应位置原地展开
editing: { draft: ModelProfile; isNew: boolean } | null
```

### 交互契约

- **编辑**：点某卡「编辑」→ 该位置渲染 `ModelForm`（保留其 accent 外框作为编辑态标识与标题「编辑配置 {name}」）；其余卡**保持可见**
- **添加**：点「添加{label}」→ 在**列表头部**插入渲染 `ModelForm`（draft = 现 `handleAdd` 的默认值构造，`isNew: true`；**不入 store**，取消即消失）；保存成功后转为正式卡
- **同时只允许一张展开**：点另一张卡的「编辑」时，若当前草稿**有改动**（与进入编辑时的快照做 JSON 对比）→ `confirm` 拦一道（"放弃未保存的修改？"，文案走 i18n）
- **保存/取消/删除逻辑全部保持现状**：`saveModel` + 该分类首个自动设默认 + `renderLog`/`toast` + 防连点（`saving`/`deleting`）；失败 toast 文案不变

### 渲染规则

```
列表位置渲染：
  isNew 且无匹配卡 → 列表头部一张 ModelForm（新）
  某卡 id === editing.draft.id → 该位置 ModelForm（替代 ModelCard）
  其余 → 普通 ModelCard（按钮常驻 32×32）
```

## 五、③ 拉取体验对齐

### 供应商区候选清单（`ProviderAccountsSection`）

- 清单上方加一行：**搜索框**（`Input`，过滤候选名）+ **全选/反选**按钮（对**过滤后可见项**生效，dsh 同款）
- 手工补充输入框、拉取失败/空列表文案、`selected` 计数逻辑全部不动

### 模型编辑表单（`ModelForm`「模型标识」行）

- 在「手动输入 / 从列表选择」切换旁加**获取模型**入口（`Download` 图标 + `provider.fetchModels` 文案，与供应商区一致）
- 点击 → `listProviderModels({ provider, protocol, apiKey, baseUrl })`（**当前表单值，含未保存的 key**）
- 成功 → 弹 `PopoverSurface` 小面板：搜索框 + 候选列表（点选）→ 选中填入 `modelName`（只填 name；不携带 token 规格——拉取结果无此数据，`maxTokens` 保持不动）
- 失败/空 → 面板内错误/空态文案（不是死路，仍可手填）

## 六、④ 视觉/刻度

- 按 **NF 自身刻度体系**核对（两档字号 / 五档图标 / 令牌圆角 / 32×32 热区）——**不照搬 dsh 的 12/14/16 字号**，冲突处 NF 体系优先
- 只借 dsh 的成熟细节：卡片图标容器固定 **32×32**（现 `w-9 h-9` = 31.5px，半像素修正）；候选行高与清单容器观感对照（`px-2 py-1` 行、`max-h-56` 滚动保持）
- 卡片间距、圆角沿用现值（`space-y-2` / `rounded-xl`），不引入新档位

## 七、测试与验收

- **i18n**：本次新增的用户可见文案（候选搜索 placeholder、全选/反选、放弃未保存修改的确认、获取模型面板的空态/错误）一律走 `locale-data` 三语（zh-CN / en-US / ru-RU），不硬编码
- 新建 `ModelListSection.test.tsx`：
  - **列表不被替换**（点击编辑后其余卡仍在 DOM）
  - 卡位展开（编辑态出现在该 id 的位置；新增出现在头部）
  - 保存/取消收回；新增取消后不产生卡
  - 单展开 + 有改动时切换被 confirm 拦截
  - 操作按钮**常驻**（className 不含 `opacity-0`）+ `aria-label` 存在
- `ProviderAccountsSection` 补最小契约测试：搜索过滤、全选/反选（对可见项）
- 三门禁保持全绿（typecheck / lint --max-warnings 0 / vitest run）

## 八、非目标

- 不动数据层 / IPC / `llm-store` / `ModelProfile` 结构
- 不搬 dsh 的两段式（provider → models[]）领域模型
- 不动模型路由区（`ModelRoutingSection` 已有独立测试）
- 不改 `ModelForm` 的字段集与校验逻辑（`tokenSpec`/钳制/`customModelName` 切换全部保持）
