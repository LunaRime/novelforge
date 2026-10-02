# 线①「命令审查」真机测试计划（2026-10-02）

> **授权单元声明**：本档是**一整份**测试文档。**批准本档 = 授权执行档内全部用例**，执行中不再逐条请示；档外操作一律不碰，要碰须重新申请。
> **路线**：CDP 驱动（`~/.claude/skills/computer-use/cdp.mjs`）——DOM/状态级定位、不移动真实鼠标、不截整屏。
> **预算**：涉及 AI key——见 §7；按约束需**先申请预算并由你分配**后才开跑。
> **背景**：线① 已实施（直出退场 + 区间扩展 + 终审修复 pass，提交 `f8bf031`/`39df86e`/`026459b`/`ff069f9`；spec 见 `docs/superpowers/specs/2026-10-02-command-review-design.md` §6）。本档验证四个用户可见用例 + 一个 C1 回归点。

---

## 0. 一句话任务

修复后的对话里——「列出小说大纲」不再误启动、「写第一章」经**确认卡**后启动且**不报超时**、角色澄清/增强不变；并抽验区间与部分失败清单。

## 1. 范围

**测**：AI 面板对话（`sendMessage` 链路）的四个用例 + C1 超时回归点 +（可选）区间一例。
**不测**：工作流内部的写作质量、模型路由、UI 视觉（属其它批次/线）。

## 2. 环境与准备

### 2.1 调试端口（**执行前**）

先查 `electron/main.ts` 是否已带 remote-debugging 注入；**没有则**在顶部 import 之后插入（带标记，验完删除）：

```ts
app.commandLine.appendSwitch('remote-debugging-port', '9222') // RM-TEMP: 2026-10-02 线①真机，验完删除
```

### 2.2 启动与连通

```bash
cd E:/vela/11/vela-1 && pnpm run dev          # 沙箱外执行（Electron 子进程）
node ~/.claude/skills/computer-use/cdp.mjs ls    # 列出 target
node ~/.claude/skills/computer-use/cdp.mjs text  # 能看到界面文本即通
```

### 2.3 前置条件

- 应用已配置**至少一个可用模型**（默认模型可对话）——预算见 §7；
- **夹具项目** `RM-CMD-2026-10-02`（一次性，勿在真实创作项目上执行）：只需「小说配置 + 章节蓝图 ≥ 第 1 章」——「写第 1 章」的 guard 只需蓝图（无前置章节要求）；
- 开跑前清残留：`body.click()` + Esc（关掉可能残留的菜单/浮层）。

### 2.4 证据目录

`C:\Users\0\AppData\Local\Temp\nf-rm-2026-10-02\`（截图 + 文本快照；不进仓库）

## 3. 判定工具（每次断言前先取基线）

```bash
D=~/.claude/skills/computer-use/cdp.mjs
# 基线：当前 run 数 + 对话文本
node "$D" eval "const m = await import('/src/stores/workflow-store.ts'); return m.useWorkflowStore.getState().activeRuns.length"
node "$D" eval "return document.body.innerText.length"
```

输入用 `cdp.mjs type`（真实键盘事件）；点击用 `cdp.mjs click <selector>`（选择器以 §5 标定为准）。

## 4. 用例矩阵

| # | 输入 | 判定（预期） | 结果 |
|---|---|---|---|
| **T1** | 说「列出小说大纲」 | **不再启动任何东西**：run 数不增、无确认卡、无 `workflow_started` 产物；模型正常文字回答（ReAct，1 次 LLM 往返） | |
| **T2** | 说「写第一章」 | ① 模型调 `start_workflow` → **确认卡出现**；② **允许前** run 数不增；③ 点「允许一次」→ run 数 +1、出现「已启动」、任务/AI 输出面板可见；④ **C1 检点：确认后 30 秒内不得出现「工具执行超时」**；⑤ 验证后**立即取消**该 run（避免 LLM 费用，见 §7） | |
| **T3** | 说「创建角色」 | 本地**澄清**文案（「请…」），run 数不增、**0 次 LLM** | |
| **T4** | 说「创建角色：苏晚」 | 消息以**增强形态**进模型（用户消息显示为「创建角色：苏晚\n\n创建角色：苏晚」类）；走 ReAct | |
| **T5**（可选） | 说「写第1到2章」 | 模型带 `chapter_end` 调工具 → 确认 → 第 1 章启动；第 2 章若因 guard（前章未定稿）失败 → 错误含**「已启动：第 1 章」**（I3 部分失败清单）；随后取消 | |

**失败单要求**：每条失败附：现象 / 复现步骤 / 证据（截图或 eval 输出）/ 涉及提交。

## 5. 标定（**执行一次**）

对话输入框与确认卡的选择器现场标定；先在页面注入探测属性（示例，按实际 DOM 调整）：

```bash
node "$D" eval "
const ta = document.querySelector('textarea');
ta?.setAttribute('data-rm-probe','input');
const btns=[...document.querySelectorAll('button')].filter(b=>/允许|拒绝|取消/.test(b.textContent||''));
btns.forEach((b,i)=>b.setAttribute('data-rm-probe','card.'+i));
return {input: !!ta, cardButtons: btns.map(b=>b.textContent.trim())};"
```

**记录这张输出**——后续用例全靠 `data-rm-probe` 定位。

## 6. 收尾

- 删除 §2.1 的临时注入（`RM-TEMP` 标记行）；
- 关闭测试会话（如需留证：证据目录内快照）；
- 结果回填本档 §4 表格 + 一句话结论。

## 7. 预算（**先申请后开跑**）

- 涉及调用：T1（ReAct 回答 1-3 次）/ T2（工具规划 1 次 + 取消前少量流式；**不允许跑完整章**）/ T4（1-2 次）/ T5 可选（+1-2 次）；T3 为本地澄清 0 次。
- **申请**：预计 **≤ 10 次调用 / ≤ 30k tokens**（按默认模型估算）——具体额度由你分配；如临时超预期，**停下再申请**。

## 8. 档外与已知边界

- 不验证 §6 之外行为；「写第三章」型用例因夹具成本改用「写第一章」（guard 只需蓝图）；
- 若 dev 构建启动即崩/连不上 CDP：先按 `windows-env-tooling` 记忆排查（沙箱需 `dangerouslyDisableSandbox`），**不即兴改代码**；
- 执行中如发现与本档预期不符：记入 §4 失败单，**档内不做修复**（修复另立）。
