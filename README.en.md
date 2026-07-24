<div align="center">

# 🔥 NovelForge — AI Novel Writing IDE

**An AI-powered integrated development environment built for web novel authors.**

[![React](https://img.shields.io/badge/React-19-blue.svg)](https://reactjs.org/)
[![Electron](https://img.shields.io/badge/Electron-41-black.svg)](https://www.electronjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6.svg)](https://www.typescriptlang.org/)
[![Version](https://img.shields.io/badge/Version-2.5.2-green.svg)]()
[![CI](https://github.com/LunaRime/novelforge/actions/workflows/build.yml/badge.svg)](https://github.com/LunaRime/novelforge/actions/workflows/build.yml)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-yellow.svg)](https://opensource.org/licenses/GPL-3.0)

[🇬🇧 English] &nbsp; [🇨🇳 中文](README.md)

</div>

---

> **NovelForge** is an open-source, privacy-first AI writing IDE. It deeply integrates LLM-driven full workflows with a local RAG knowledge base, delivering an IDE-grade immersive writing experience. Supports **zh-CN / en-US / ru-RU** trilingual interface.

---

## Why NovelForge?

Writing a web novel is not just about typing words — it's about managing a complex system of characters, plot threads, worldbuilding rules, and chapter-level pacing across hundreds of chapters. Traditional writing tools treat this like a text document. NovelForge treats it like a software project.

| Pain Point | NovelForge Solution |
|------------|---------------------|
| Losing track of characters across 100+ chapters | Character cards with cross-chapter dynamic tracking + voice consistency analysis |
| Forgetting foreshadowing planted 50 chapters ago | Automatic foreshadowing scanner + resolution detector |
| Spending $200+/month on AI API calls | Tiered model routing saves 50-70% + prompt caching cuts input costs by 50% |
| Copy-pasting context between AI chat and editor | AI agent directly reads/writes your project — context is automatic |
| No way to compare draft versions | Multi-draft parallel generation with AI auto-scoring |
| Privacy concerns with cloud writing tools | 100% local storage: SQLite + LanceDB, works offline |

## How It Works

```
┌─────────────────────────────────────────────────────┐
│                    NovelForge                        │
│                                                     │
│  📋 Blueprint → ✍️ Draft → 🔍 Review → ✨ Finalize   │
│       │            │           │           │         │
│       ▼            ▼           ▼           ▼         │
│  AI generates  AI writes  5 reviewers  Post-process  │
│  chapter plan  chapter    score draft   pipeline     │
│       │            │           │           │         │
│       └────────────┴───────────┴───────────┘         │
│                        │                             │
│                  📚 Local RAG                        │
│            (SQLite + LanceDB Vector)                 │
└─────────────────────────────────────────────────────┘
```

## ✨ Key Features

### 🧬 AI Writing Pipeline

| Feature | Description |
|---------|-------------|
| 🌍 World & Setting Management | Global worldbuilding, plot backbone, character profiles (cross-chapter dynamic tracking) |
| 📋 Auto Outline & Beats | AI generates structural skeleton → chapter beats → scene/emotion/pacing requirements |
| 📐 Auto Chapter Splitting | AI analyzes outline and suggests chapter count, volume structure, and climax positions |
| ✍️ Streaming Chapter Generation | Per-chapter streaming typewriter generation with precise context awareness |
| 🎬 Chapter Transition Engine | Extracts scene cards from previous 3 chapters and injects into prompts for continuity |
| 🔄 Paragraph-Level Rewriting | Expand / condense / style shift / conflict enhance / polish — five modes, no full rewrite |
| 📝 Editorial Board Review | 5-role parallel review (editor-in-chief / plot / prose / continuity / style) + weighted scoring |
| 🎤 Character Voice Consistency | Analyzes character dialogue style post-finalization, auto-injects for consistency |
| 📊 Multi-Draft Comparison | Parallel generation of multiple versions per chapter, AI auto-scoring |
| 🔮 Foreshadowing Manager | Auto-scans for new foreshadowing + detects resolution of existing threads |
| 🔁 Post-Process Pipeline | Ingest → plot extraction → character update → foreshadowing scan → voice analysis → style learning (DAG parallel) |

### 🧠 Million-Word Local Knowledge Base + Vector Engine

| Feature | Description |
|---------|-------------|
| 🔍 LLM + Vector Hybrid Retrieval | Semantic search + full-text search, auto-injected into AI prompts |
| 🧬 LLM-as-Vectorization | Use your LLM as the embedding model — no dedicated embedding API needed |
| 📊 IVF_PQ Vector Index | LanceDB ANN index for large-scale vector search acceleration |
| 🔒 100% Local Storage | SQLite + LanceDB, works offline |

### 💰 Cost Optimization Engine

| Feature | Description |
|---------|-------------|
| 🎯 Tiered Model Routing | elite / standard / budget — three tiers, saves 50-70% |
| ⚡ Prompt Caching | Automatic cache hits, cuts input costs by 50% |
| 📊 Real-Time Cost Tracking | Live session cost display in the status bar |
| 📐 Token Budget Engine | Intelligent truncation with system prompt size control |

### 🛡️ Privacy & Security

| Feature | Description |
|---------|-------------|
| 🔒 Electron Sandbox | `sandbox: true` + IPC allowlist + path sandbox |
| 🔑 API Key Encryption | Electron safeStorage encrypted storage |
| 🔄 Exponential Backoff Retry | Auto-retry for 429/503/5xx + streaming retry |
| ✅ Database Integrity | SQLite PRAGMA checks + unified timestamps + CHECK constraints |

---

## 🚀 Installation

### 📦 Pre-built Releases (Recommended)

Download the latest from [Releases](https://github.com/LunaRime/novelforge/releases):
- **Windows**: `NovelForge-{version}-Installer.exe` (NSIS installer)
- **Windows**: `NovelForge-{version}-Portable.zip` (portable, extract and run)

### 🔨 Build from Source

#### Requirements

| Tool | Version | Notes |
|------|---------|-------|
| **Node.js** | `>= 22.x` | Matches Electron 41's bundled version |
| **pnpm** | `>= 9.x` | Package manager |
| **Python** | `>= 3.10` | Required to compile native modules (`better-sqlite3`, `lancedb`) |
| **C++ Toolchain** | — | Windows: Visual Studio Build Tools · macOS: Xcode CLT · Linux: `build-essential` |

#### Quick Start

```bash
# 1. Clone
git clone https://github.com/LunaRime/novelforge.git
cd novelforge

# 2. Install dependencies
pnpm install

# 3. Development mode (Vite HMR)
pnpm run dev

# 4. Type check
pnpm run typecheck

# 5. Run tests
pnpm run test

# 6. Full build
npm_config_user_agent="pnpm/9.15.4" \
CSC_IDENTITY_AUTO_DISCOVERY=false \
ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/" \
pnpm run build
```

> **Build environment variables**:
> - `npm_config_user_agent` — Forces electron-builder to detect pnpm
> - `CSC_IDENTITY_AUTO_DISCOVERY=false` — Skips code signing (not needed for local builds)
> - `ELECTRON_BUILDER_BINARIES_MIRROR` — Mirror for faster downloads (essential in China; optional elsewhere)
>
> Build output at `release/{version}/`:
> - `NovelForge-{version}-Portable/` — Portable edition
> - `NovelForge-{version}-Installer/NovelForge-{version}-Installer.exe` — NSIS installer

#### Windows Build Issues

| Issue | Solution |
|-------|----------|
| winCodeSign 7z symlink download failure | Manually extract to `%LOCALAPPDATA%/electron-builder/Cache/winCodeSign/` |
| NSIS 7z symlink download failure | Extract to `%LOCALAPPDATA%/electron-builder/Cache/nsis/` |
| pnpm not detected | Set `npm_config_user_agent=pnpm/9.15.4` |
| GitHub download timeout | Set `ELECTRON_BUILDER_BINARIES_MIRROR` mirror |

#### Native Modules

The project depends on two native modules: `better-sqlite3` and `@lancedb/lancedb`.

```bash
# Rebuild native modules for Electron's bundled Node version
pnpm run rebuild
```

---

## ⚙️ Model Configuration

Supports `OpenAI` · `DeepSeek` · `Gemini` · `Claude` · `Ollama` · `Zhipu GLM` · any OpenAI-compatible API.

Configure your AI generation model and vector model in Settings. Enable tiered routing and prompt caching to save costs.

---

## 🏗️ Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript + Zustand + Tailwind CSS + Radix UI |
| Desktop | Electron 41 + Vite 8 |
| Data | better-sqlite3 (relational) + LanceDB (vector) |
| AI | OpenAI Protocol + Gemini Protocol + MCP + ReAct Agent |
| Testing | Vitest + Storybook |
| CI/CD | GitHub Actions (ubuntu / windows / macos matrix) |

---

## 📄 License

GPL-3.0 open source. Originally forked from [Vela](https://github.com/heider-x/vela) by heider-x, maintained and developed by LunaRime.

---

<div align="center">
<b>NovelForge — Forge your novel with AI.</b>
</div>
