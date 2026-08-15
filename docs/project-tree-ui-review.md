# 项目结构 UI（ProjectTree 视图）检查报告

> 检查范围：应用侧边栏"项目结构"视图全链路——Sidebar 容器、ProjectTree 根组件、子分组组件（SidebarGroup / WorldBuildingGroup / VolumeGroup / DraftBoxGroup / ManuscriptGroup / PublicationGroup）与共享工具（SidebarShared）。
> 注意：本报告针对**应用界面中的"项目结构"视图**，非仓库目录结构。

---

## 一、视图组成（现状）

```
Sidebar（左侧面板容器，4 视图路由：home/project/knowledge/characters）
└─ ProjectTree（项目结构，sidebarView === 'project'）
   ├─ 项目名 + 刷新
   ├─ ① 小说配置（单行入口，configDone 状态徽标）
   ├─ ② 故事架构（WorldBuildingGroup：折叠组 + 5 个架构子文件，生成状态图标）
   ├─ ③ 章节蓝图（单行入口，blueprintCount/总章数 进度）
   ├─ ④ 分卷（VolumeGroup：卷列表 + 新建/自动划分/编辑/删除 + 定稿进度）
   ├─ ⑤ 连载监控（PublicationGroup：相似度徽标 + 审计告警 + 手动导入弹窗）
   ├─ ⑥ 草稿箱（DraftBoxGroup：按章分组，活跃/已归档，修订数）
   └─ ⑦ 正文章节（ManuscriptGroup：已定稿列表，蓝图标题缓存）
```

整体结构分层清晰（卡片容器统一、右键菜单全局单例、数据驱动列表），无崩溃级问题。

---

## 二、发现的问题（按严重度）

### 🟠 P1 — 规范/正确性

**P1-1 PublicationGroup 相似度徽标用不存在的 `--color-danger`**
- `simColor()` 低相似度（<0.5，平台大幅改稿）返回 `'var(--color-danger)'`——**该 CSS 变量不存在**（主题里是 `--color-error`）；
- 后果：低相似度警告色无效（浏览器忽略未知变量 → 徽标文字色退化），且违反"颜色必须 CSS 变量"约束；
- 修复：`--color-danger` → `--color-error`（与 CharactersView 已修的一致）。

**P1-2 DraftBoxGroup 硬编码中文「第{n}章」前缀判断**
- `DraftChapterGroup` 里 `const chLabelCN = `第${chapterNumber}章`` 用于判断蓝图标题是否已带章节前缀（避免重复拼接）；
- 后果：**英文/俄文界面下标题以 `Chapter 3 ...` 开头时匹配不到中文前缀 → 显示重复前缀**（如「第3章 Chapter 3 xxx」）；
- 修复：用 `t('chapter.label')` 的当前语言值做前缀判断（与显示用同一文案）。

### 🟡 P2 — 性能

**P2-1 ManuscriptGroup 章节标题缓存每次全量失效**
- `useEffect` 在 files 变化时先 `clearChapterTitleCache()` 再 `Promise.all` 全量重建（N 章 = N 次 `db:blueprint-get` IPC + N 次文件首行读取）；
- 每定稿一章（files 变化）→ 全部章节标题重读；章节多时（100+ 章）定稿后侧栏刷新有明显开销；
- 修复：增量更新——只对新增 path 调 `readChapterTitle`，已缓存的跳过（当前 `readChapterTitle` 本身有缓存命中，但外层全量清空抵消了它）。

**P2-2 DraftBoxGroup 每章一次 `db:blueprint-get` IPC**
- 每个 `DraftChapterGroup` 挂载即 `ipc.invoke('db:blueprint-get', n)`（即使组折叠也发）；展开 50 章 = 50 次 IPC；
- 修复：父组件一次 `db:blueprint-get-all` 建 titleMap 传入，子组件零请求。

**P2-3 VolumeGroup 卷章节数据渲染时重复计算**
- `chaptersForVolume` / `finalizedCountForVolume` 每次渲染都 `Object.entries(draftsByChapter)` 全量遍历（N 章 × M 卷）；
- 修复：卷列表与章节映射用 `useMemo` 缓存（依赖 draftsByChapter 引用）。

### 🟢 体验观察（非问题，无需处理）

- 各分组展开状态为组件内部 state，切换视图后重置（可接受，非持久化需求）；
- 空状态/加载状态/右键菜单/标题提示齐全；
- 卡片视觉统一（SidebarGroup 与 VolumeGroup 同构）；
- 数据源设计正确（工作台与项目结构共用 VolumeGroup，章节由调用方注入）。

---

## 三、结论与建议

**"项目结构"视图骨架扎实，本轮价值点集中在 2 个规范缺陷（真实可见）与 3 个性能点（章节多的项目可感知）：**
1. **P1-1 `--color-danger` 修掉**（1 行，规范 + 徽标色恢复）；
2. **P1-2 中文前缀硬编码修掉**（1 行，三语界面标题不重复）；
3. **P2-1/P2-2/P2-3 性能**：章节标题增量缓存 + 蓝图标题一次拉取 + 卷计算 useMemo（定稿后侧栏刷新与草稿箱展开的卡顿源，100+ 章项目收益明显）。

全部改动集中在 `sidebar/` 目录 4 个文件，无架构变更。

---

## 四、修复状态（分点修复记录）

| 编号 | 问题 | 状态 | 落地位置 |
|------|------|------|----------|
| P1-1 | PublicationGroup 相似度徽标用不存在的 `--color-danger` | ✅ 已修 | `simColor()` 低相似度分支 `--color-danger` → `--color-error`（与 CharactersView 已修一致） |
| P1-2 | DraftBoxGroup 硬编码中文「第{n}章」前缀判断 | ✅ 已修 | `chLabelCN` 删除，前缀判断改用 `t('chapter.label')` 当前语言值（与显示同文案；zh-CN 值与原硬编码完全一致，行为不变；en-US `Ch.{n}` / ru-RU `Гл.{n}` 匹配各自前缀标题） |
| P2-1 | ManuscriptGroup 标题缓存每次全量失效 | ✅ 已修 | `prevLocaleRef` 追踪语言切换（仅语言变化时 `clearChapterTitleCache()` 全量重建）；files 变化时走 `readChapterTitle` 内部缓存命中，只对新增 path 发 IPC |
| P2-2 | DraftBoxGroup 每章一次 `db:blueprint-get` IPC | ✅ 已修 | 父组件一次 `db:blueprint-get-all` 建 `bpTitleMap`（章节集合变化时重拉）；`DraftChapterGroup` 改收 `bpTitle` prop，内部 useEffect/IPC 移除 |
| P2-3 | VolumeGroup 卷章节数据渲染时重复计算 | ✅ 已修 | `ProjectTree` 新增 `volumeChapterIndex` useMemo（按章节号预分组排序一次，依赖 `draftsByChapter` 引用）；`chaptersForVolume` / `finalizedCountForVolume` 复用缓存函数 |

> 门禁：typecheck 零错误、lint 零警告（--max-warnings 0）、测试 531 全过。
