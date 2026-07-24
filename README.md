<div align="center">

# 🔥 NovelForge — AI 小说创作 IDE

**AI 深度驱动的小说创作集成开发环境，为网文作者而生。**

[![React](https://img.shields.io/badge/React-19-blue.svg)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-41-black.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6.svg)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/Version-2.5.2-green.svg)]()
[![CI](https://github.com/LunaRime/novelforge/actions/workflows/build.yml/badge.svg)](https://github.com/LunaRime/novelforge/actions/workflows/build.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-yellow.svg)](https://opensource.org/licenses/GPL-3.0)

[🇨🇳 中文] &nbsp; [🇬🇧 English](README.en.md)

</div>

---

> **NovelForge** 是一款开源、隐私优先的 AI 写作 IDE。将大语言模型驱动的全流程工作流与本地 RAG 知识库深度融合，为作者提供 IDE 级别的沉浸式创作体验。支持 **zh-CN / en-US / ru-RU** 三语界面。

---

## ✨ 核心特性

### 🧬 AI 小说创作全流程

| 能力 | 说明 |
|---|---|
| 🌍 世界观与设定管理 | 全局世界观、剧情主轴、角色人设档案（跨章动态追踪） |
| 📋 自动大纲与细纲生成 | AI 生成结构骨架 → 章节细纲 → 场景/情绪/节奏要求 |
| 📐 大纲自动拆章 | AI 分析大纲自动建议章节数、分卷结构和高潮章号 |
| ✍️ 流式章节正文生成 | 单章流式打字机生成，精准响应前文上下文 |
| 🎬 章节过渡引擎 | 写稿前提取前3章场景卡片注入 prompt，确保连贯性 |
| 🔄 段落级改写 | 扩写/缩写/改风格/增强冲突/润色五种模式，非全文重写 |
| 📝 编辑部协作审阅 | 5 角色并行评审（主编/情节/文案/连续性/风格）+ 加权评分 |
| 🎤 角色声音一致性 | 定稿后分析角色对话风格，写稿时自动注入保持一致性 |
| 📊 多稿对比择优 | 同章并行生成多版本，AI 自动评分选出最佳 |
| 🔮 伏笔管理器 | 自动扫描新伏笔 + 检测回收旧伏笔，防止遗忘 |
| 🔁 后期管线 | 正文入库 → 剧情提取 → 角色更新 → 伏笔扫描 → 声音分析 → 文风学习（DAG 并行） |
| ↩️ 撤销/重做 | Ctrl+Z/Y 快捷键 + 工具栏按钮，CodeMirror 6 原生支持 |

### 🧠 百万字级本地知识库 + 向量引擎

| 能力 | 说明 |
|---|---|
| 🔍 LLM+向量融合检索 | 语义搜索 + 全文检索混合，自动注入 AI prompt |
| 🧬 LLM 向量化 | 将 LLM 作为向量模型使用，无需专用 Embedding API |
| 📊 IVF_PQ 向量索引 | LanceDB ANN 索引加速大规模向量检索 |
| 🔒 纯本地存储 | SQLite + LanceDB，断网可用 |

### 💰 成本优化引擎

| 能力 | 说明 |
|---|---|
| 🎯 分层模型路由 | elite/standard/budget 三层自动路由，节省 50-70% |
| ⚡ Prompt 缓存 | API 自动缓存命中，输入费用降低 50% |
| 📊 实时费用追踪 | StatusBar 实时显示会话费用 |
| 📐 Token 预算引擎 | 智能截断，系统提示词上限控制 |

### 🛡️ 安全加固（v2.3.0）

| 能力 | 说明 |
|---|---|
| 🔒 Electron 沙箱 | `sandbox: true` + IPC 通道白名单 + 路径沙箱 |
| 🔑 API 密钥加密 | Electron safeStorage 加密存储 |
| 🔄 LLM 指数退避重试 | 429/503/5xx 自动重试 + 流式重试 |
| ✅ 数据库完整性 | SQLite PRAGMA 检查 + 时间字段统一 + CHECK 约束 |

---

## 🚀 安装

### 📦 预构建版本（推荐）

前往 [Releases](https://github.com/LunaRime/novelforge/releases) 下载最新安装包：
- **Windows**: `NovelForge-{version}-Installer.exe`（NSIS 安装程序）
- **Windows**: `NovelForge-{version}-Portable.zip`（绿色便携版，解压即用）

### 🔨 源码构建

#### 环境要求

| 工具 | 版本 | 说明 |
|------|------|------|
| **Node.js** | `>= 22.x` | Electron 41 内置版本 |
| **pnpm** | `>= 9.x` | 包管理器（项目使用 pnpm workspace） |
| **Python** | `>= 3.10` | 编译 `better-sqlite3` / `lancedb` 等原生模块 |
| **C++ 工具链** | — | Windows: Visual Studio Build Tools · macOS: Xcode CLT · Linux: `build-essential` |

#### 快速开始

```bash
# 1. 克隆仓库
git clone https://github.com/LunaRime/novelforge.git
cd novelforge

# 2. 安装依赖（使用 pnpm）
pnpm install

# 3. 开发模式（Vite HMR 热更新）
pnpm run dev

# 4. 类型检查
pnpm run typecheck

# 5. 运行测试
pnpm run test

# 6. 完整构建（Windows 下需设置镜像环境变量加速下载）
npm_config_user_agent="pnpm/9.15.4" \
CSC_IDENTITY_AUTO_DISCOVERY=false \
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
pnpm run build
```

> **构建环境变量说明**：
> - `npm_config_user_agent` — 强制 electron-builder 识别 pnpm 包管理器
> - `CSC_IDENTITY_AUTO_DISCOVERY=false` — 跳过代码签名（本地构建无需证书）
> - `ELECTRON_BUILDER_BINARIES_MIRROR` — npmmirror 镜像加速（国内网络必需，避免 GitHub 下载超时）
>
> 构建产物位于 `release/{version}/`：
> - `NovelForge-{version}-Portable/` — 绿色便携版
> - `NovelForge-{version}-Installer/NovelForge-{version}-Installer.exe` — NSIS 安装程序

#### 构建卡点（Windows）

| 卡点 | 解决方案 |
|------|---------|
| winCodeSign 7z symlink 下载失败 | 手动下载解压到 `%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/` |
| NSIS 7z symlink 下载失败 | 同上，解压到 `%LOCALAPPDATA%/electron-builder/Cache/nsis/` |
| pnpm 包管理器未检测 | 设置 `npm_config_user_agent=pnpm/9.15.4` |
| GitHub 下载慢/超时 | 设置 `ELECTRON_BUILDER_BINARIES_MIRROR` 镜像 |

#### 原生模块说明

项目依赖 `better-sqlite3` 和 `@lancedb/lancedb` 两个原生模块：

```bash
# 针对 Electron 内置 Node 版本重新编译原生模块
pnpm run rebuild
```

---

## ⚙️ 模型配置

支持 `OpenAI` · `DeepSeek` · `Gemini` · `Claude` · `Ollama` · `智谱 GLM` · 任何 OpenAI 兼容 API。

在设置中配置 AI 生成模型 + 向量模型，开启分层路由和 Prompt 缓存以节省费用。

---

## 🏗️ 技术架构

| 层 | 技术栈 |
|----|--------|
| 前端 | React 19 + TypeScript + Zustand + Tailwind CSS + Radix UI |
| 桌面 | Electron 41 + Vite 8 |
| 数据 | better-sqlite3 (关系型) + LanceDB (向量) |
| AI | OpenAI Protocol + Gemini Protocol + MCP + ReAct Agent |
| 测试 | Vitest + Storybook |
| CI/CD | GitHub Actions (ubuntu/windows/macos 矩阵) |

---

## 📄 协议

基于 GPL-3.0 开源。原始项目 [Vela](https://github.com/heider-x/vela) by heider-x，由 LunaRime 持续开发维护。

---

<div align="center">
<b>NovelForge — Forge your novel with AI.</b>
</div>
