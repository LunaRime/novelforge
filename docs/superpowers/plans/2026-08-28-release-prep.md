# 发版准备实施计划（v0.2.0——Agent 对话升级三大功能群）

> **For agentic workers:** REQUIRED SUB-SKILL: 参照 `.claude/skills/novelforge-release.md`（三版本制 + 发版 checklist）；执行方式按 Superpowers SDD 或 Inline（改动面小，可 Inline）。

**Goal:** 将 2026-08-26~28 的 Agent 对话升级全链（Agent 循环加固 / .novelforge 目录改名 / 意图预路由 + fork-rewind 分支）发布为 **v0.2.0 正式版**（0.1.5 → 0.2.0：minor bump——3 大功能群，无 breaking，符合 SemVer）。

**Architecture:** ① CHANGELOG 三大功能群条目 ② README 功能表/架构更新 ③ 版本 5 文件 ④ 完整构建 ⑤ dev 冒烟清单（本次功能实操验证）⑥ 发布（tag + Release 双语 Notes）。

**Tech Stack:** 版本流程（novelforge-release skill）+ 构建流水线（build-process）

**Spec:** `.claude/skills/novelforge-release.md`（正式版流程）+ 记忆 build-process（构建卡点清单）

## Global Constraints

- 版本号只在此窗口改（package.json / build/app-package.json / CHANGELOG.md / README.md / README.en.md 5 文件——正式版规则）
- 构建必须：3 个环境变量（npm_config_user_agent / CSC_IDENTITY_AUTO_DISCOVERY / ELECTRON_BUILDER_BINARIES_MIRROR）
- 构建后必查：package.json 被覆盖（第 12 次坑——git checkout 恢复）、latest.yml 默认名（sed 修正 url/path）
- 发布前全量门禁：`pnpm run test && pnpm run typecheck && pnpm run lint`（当前 799/799）
- README 徽章更新为最新正式版

---

### Task R1: CHANGELOG 三大功能群条目

**Files:**
- Modify: `CHANGELOG.md`（新增 v0.2.0 正式版条目）

**内容结构**（三功能群 + 质量）：

```
## [0.2.0] - 2026-08-28

### Agent 对话升级（对话即生成 + 分支能力）
- 意图预路由：本地零 LLM 成本识别「写第三章」「润色第2章」「生成大纲」等意图，强命中直接触发创作工作流、弱命中澄清追问（writing-intent 模式库 + workflow-starter 统一错误语义）
- 对话分支：任意消息 hover fork 派生新会话 / rewind 回退可恢复（历史面板分支层级标注）
- Agent 循环加固：工具解析失败逐条反馈（不再静默）、read_file 读去重（file_unchanged 桩省 token）、注入上限 + offset/limit 分页（大文件不全量进上下文）

### .novelforge 目录改名
- 项目数据目录 `.vela/` → `.novelforge/`（全局 ~/.vela 与项目目录自动迁移，双路径兜底；vela.db/vela:///velaAPI 保留）
- 迁移安全：config.json 哨兵重试 + auto 形态清理 + 旧路径回读兜底

### 质量与修复
- 799 测试全绿；意图路由正则修复（章号 1-99/空格容忍/查询护栏）等
```

### Task R2: README 更新

**Files:**
- Modify: `README.md` / `README.en.md`（功能特性表补三大功能群；版本徽章 0.1.5 → 0.2.0；若提及 `.vela` 目录同步 `.novelforge`——V3 已确认 README 零提及 .vela，只需功能表与徽章）

### Task R3: 版本号 5 文件

- `package.json` / `build/app-package.json` / `CHANGELOG.md`（版本行）/ `README.md` / `README.en.md`：`0.1.5` → `0.2.0`

### Task R4: 完整构建 + 产物归位

- 三环境变量 + `pnpm run build`（verify-contract → tsc → vite → electron-builder → verify-asar → organize-release）
- 构建后：git status 查 package.json 覆盖（第 12 次坑——`git checkout -- package.json` 或合并恢复）；latest.yml url/path sed 修正（`NovelForge-0.2.0-Installer.exe`）
- 产物落位 `release/stable/0.2.0/`（正式版 + 7z 自动压缩）

### Task R5: dev 冒烟清单（发版前必跑）

| # | 验证项 | 操作 |
|---|--------|------|
| 1 | 意图预路由强命中 | 输入「写第三章」→ 直接触发写稿工作流 + 已开始消息 |
| 2 | 意图预路由弱命中/查询 | 「帮我写」→ 澄清追问；「写作风格是什么」→ 走 ReAct |
| 3 | fork 分支 | hover 消息 → fork 按钮 → 新会话 + 历史面板分支层级 |
| 4 | rewind 回退 | hover 消息 → 回退按钮 → 确认弹窗 → 截断 |
| 5 | 读去重桩 | @文件 重复读 → file_unchanged 桩（日志验证） |
| 6 | 分页读取 | 大文件 offset/limit（LLM 驱动或工具直调） |
| 7 | 改名迁移后项目 | 打开 `E:\vale\小说\*`（已迁移 .novelforge）→ 数据完整 |
| 8 | 全局配置 | 模型列表/最近项目从 ~/.novelforge 读取正常 |

### Task R6: 发布

- 全量门禁确认 + `git push` + tag `v0.2.0` + `gh release create`（正式版非 prerelease，中英双语 Notes 含三功能群）+ 4 资产上传（Installer.exe / blockmap / latest.yml / Portable.7z）
- 发布后：README 徽章核对、CHANGELOG 顶部核对

---

## Self-Review 记录

**范围**：v0.2.0 正式版全流程（文档 → 版本 → 构建 → 冒烟 → 发布）。
**风险**：package.json 第 12 次覆盖坑（构建后必查）、latest.yml 默认名坑（sed 修正）、产物归位 EPERM（复制回退兜底）——见 build-process 记忆。
**依赖**：本次 5 计划（C/H/V/A/B）全部已完成且推送；冒烟清单为人工验证项（用户执行或指导执行）。
**版本裁决**：0.1.5 → 0.2.0（minor——3 大功能群新增；无 breaking change；不跳 1.x——项目早期阶段按 0.y.z 递增惯例）。
