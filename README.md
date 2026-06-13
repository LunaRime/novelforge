<div align="center">

# 🌌 Vela — AI Novel Writing IDE / AI 小说创作 IDE

**The next-generation AI-powered novel & fiction writing IDE for web novel authors, indie writers and creative professionals.**

**为网文作者、独立作家与创意写作者设计的下一代 AI 驱动小说创作集成开发环境。**

[![React](https://img.shields.io/badge/React-19-blue.svg)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-41-black.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6.svg)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/Version-1.6.0-green.svg)]()
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-yellow.svg)](https://opensource.org/licenses/GPL-3.0)

[🚀 下载客户端 / Download](#-安装与使用--installation) • [☕ 赞助作者 / Sponsor](#-赞助与支持--sponsor)

</div>

---

> **Vela** 是一款开源、隐私优先、本地优先的 AI 写作 IDE，专为**长篇小说创作 (Novel Writing)**、**网文写手 (Web Fiction)**与**创意写作 (Creative Writing)** 而生。它将大语言模型驱动的全流程工作流（大纲生成、章节起草、智能重写、自动审阅）与本地 RAG 知识库深度融合，为作者提供 IDE 级别的沉浸式创作体验——所有数据和模型调用都运行在您自己的计算机上，使用您自己的 API Key (BYOK)。

---

## 🎨 界面预览 / Screenshots

|<img src="public/screenshot/1.png" width="800" alt="Vela AI Novel Writing IDE - Main Editor Interface"/>|
|:---:|
|*沉浸式写作空间：编辑器 + AI 助手并排布局，支持 JetBrains/VSCode 级窗口管理*|
|*Immersive writing workspace with side-by-side AI panel, IDE-grade window management*|

|<img src="public/screenshot/2.png" width="800" alt="Vela AI Writing Workflow - Outline and Chapter Generation"/>|
|:---:|
|*全自动小说创作工作流：从世界观到正文的端到端 AI 管线*|
|*End-to-end AI novel writing pipeline: from worldbuilding to chapter generation*|

<details>
<summary><b>点击查看更多截图 / More Screenshots 📸</b></summary>
<br>

<img src="public/screenshot/3.png" width="800" alt="Vela AI Writer - Character Management and World Building"/>
<br/><br/>
<img src="public/screenshot/4.png" width="800" alt="Vela Novel IDE - AI Rewrite and Refinement Pipeline"/>
<br/><br/>
<img src="public/screenshot/5.png" width="800" alt="Vela Writing Tool - Local RAG Knowledge Base Search"/>
<br/><br/>
<img src="public/screenshot/6.png" width="800" alt="Vela Creative Writing IDE - Dark Theme Full View"/>

</details>

---

## ✨ 核心特性 / Key Features

### 🧬 AI 小说创作全流程 / AI-Powered Novel Writing Pipeline

| 能力 | 说明 |
|---|---|
| 🌍 世界观与设定管理 | 自定义全局世界观、核心剧情主轴、角色人设档案（含跨章动态状态追踪） |
| 📋 自动大纲与细纲生成 | AI 一键生成「结构骨架 → 章节细纲 → 场景/情绪/节奏段落要求」，支持三幕式、英雄之旅等 |
| 📐 **大纲自动拆章** (v1.6) | AI 分析大纲自动建议章节数、分卷结构和高潮章号 |
| ✍️ 流式章节正文生成 | 单章流式打字机生成，精准响应前文上下文与预设提纲 |
| 🎬 **章节过渡引擎** (v1.6) | 写稿前自动提取前3章场景卡片（地点/时间/情绪/角色/冲突），注入 prompt 确保连贯性 |
| 🔄 AI 智能重写 | 支持**段落级改写**（v1.6）—扩写/缩写/改风格/增强冲突/润色五种模式，非全文重写 |
| ✨ 语病与错别字精修 | AI 自动检测语法错误、错别字、逻辑漏洞 |
| 📝 **编辑部协作审阅** (v1.5) | 5 角色并行评审（主编/情节/文案/连续性/风格），加权评分 + 主编综合裁决 |
| 🎤 **角色声音一致性** (v1.5) | 定稿后自动分析角色对话风格（语气/高频词/句长/正式度），写稿时注入保持一致性 |
| 📊 **多稿对比择优** (v1.5) | 同章并行生成标准版/创意版/紧凑版，AI 自动评分选出最佳 |
| 🔮 **伏笔管理器** (v1.6) | 自动扫描新伏笔 + 检测回收旧伏笔，写稿时注入待回收列表防止遗忘 |
| 🔁 三重后期管线 | 正文入库 → 剧情要点提取 → 角色状态更新 → 伏笔扫描 → 角色声音分析 → 文风学习 |

### 🧠 百万字级本地知识库 + 向量引擎

| 能力 | 说明 |
|---|---|
| 📂 海量设定导入 | 一键导入数百万字参考小说、世界观文档、角色设定集 |
| 🔍 **LLM+向量融合检索** (v1.5) | 语义向量搜索 + 全文检索混合，自动注入相关上下文到 AI prompt |
| 🧬 **LLM 向量化** (v1.5) | 将 LLM 作为向量模型使用，无需专用 Embedding API 也可生成语义向量 |
| ⚙️ **向量配置管理层** (v1.5) | 模块/模型/LLM 向量化三开关 + 连通性测试，灵活控制向量能力 |
| 🔒 纯本地存储 | SQLite + LanceDB 向量引擎，所有数据存储在本地，断网可用 |

### 💰 成本优化引擎 / Cost Optimization

| 能力 | 说明 |
|---|---|
| 🎯 **分层模型路由** (v1.5) | elite/standard/budget 三层自动路由：写作用 elite，审稿用 standard，摘要用 budget |
| ⚡ **Prompt 缓存** (v1.5) | 消息前缀优化 + API 自动缓存命中，输入费用降低 50% |
| 📊 **实时费用追踪** (v1.5) | StatusBar 实时显示会话费用 `$0.42`，按 tier 分类统计 |
| 📐 **Token 预算引擎** (v1.5) | 智能截断替代字符截断，系统提示词 3000 token 上限 |

### 🔌 极致可扩展架构

| 能力 | 说明 |
|---|---|
| 🤖 BYOK 多模型 | 兼容 OpenAI、DeepSeek、Gemini、Claude、Ollama、智谱 GLM 等，支持智能分流 |
| 🔗 MCP 协议 | 原生集成 MCP 协议，随时外挂自定义工具服务器 |
| 🔄 **并发控制** (v1.5) | 信号量 + 优先级队列，maxConcurrent=3，防止 API 限流 |
| 🛰️ **TransferHub 中枢** (v1.5) | 中间件管道 + 消息路由 + 请求响应模式 |

### 🛠️ IDE 级生产力 UI

| 能力 | 说明 |
|---|---|
| 🖥️ 可拖拽四分屏布局 | 文件树 + 编辑器 + AI 面板 + 底部终端，灵活组合 |
| 🎨 四套主题 | 浅色/星空/纸质/黑夜，View Transition API 动画切换 |
| 🔤 字体优化 (v1.5) | 内置中文字体子集化（92MB→20MB），Inter UI 字体 |
| 📋 **蓝图排序+校检** (v1.5) | 章节蓝图按章节号/优先级/定位排序，缺口检测 + AI 补全 |
| ⌨️ 快捷键体系 | Cmd+N 新建、Cmd+O 打开、Cmd+=/- 缩放 |
| 📦 跨平台 | Windows (nsis) / 未来支持 macOS/Linux |

---

## 🚀 安装与使用 / Installation

### 方式一：直接下载

前往 [Releases](https://github.com/heider-x/vela/releases) 下载最新版本：
- **Windows**: `Vela-1.6.0-setup.exe` 安装程序 (NSIS) 或 `Vela-1.6.0-portable.exe` 便携版

### 方式二：源码构建

```bash
# 环境要求：Node.js >= 18
git clone https://github.com/heider-x/vela.git
cd vela
npm install
npm run dev     # 启动开发服务器
npm run build   # 打包分发
```

---

## ⚙️ 模型配置

1. 打开应用 → 左下角 ⚙️ 设置
2. **「AI 生成模型」**：添加写作/审稿模型，配置 API Key
3. **「向量模型」**：配置 Embedding 模型 + **LLM 向量化**（用 LLM 替代专用 Embedding API）
4. 开启 Prompt 缓存 + 分层路由以**节省 50-70% API 费用**

**支持的服务商：** `OpenAI` · `DeepSeek` · `Google Gemini` · `Anthropic Claude` · `Ollama (Local)` · `智谱 GLM` · 任何 OpenAI 兼容 API

---

## 🏗️ 技术架构

| 层级 | 技术 |
|---|---|
| **UI 框架** | React 19 + TypeScript + Zustand |
| **样式** | Tailwind CSS + Radix UI + Lucide Icons |
| **桌面端** | Electron 41 + Vite 8 |
| **本地存储** | better-sqlite3 + LanceDB (向量) |
| **IPC 通信** | 强类型频道契约 (Type-safe IPC Channels) |
| **AI 集成** | OpenAI-compatible + Gemini Protocol + MCP |
| **Agent 架构** | ReAct 循环 + Tool Registry + Skill 系统 |

---

## 📄 开源协议

本项目采用 [GPL-3.0 License](LICENSE) 开源。如需闭源商用授权，请通过微信或邮件联系作者。

---

<div align="center">

**Crafted with 💡 by [heider-x](https://github.com/heider-x)**

*Vela — Your AI-powered novel writing companion. Write smarter, not harder.*

</div>
