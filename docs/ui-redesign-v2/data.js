"use strict";
/* NovelForge UI Redesign v2 / Forge Console
   Copy + structured data. UI strings are three-language arrays [zh, en, ru].
   Manuscript sample text is source content, not UI copy.
   All functional names below were taken from the real app (App.tsx,
   LeftToolWindowBar, ProjectTree, EditorArea, CommandPalette,
   SettingsModal, StatusBar, shared/editor-tab.ts). */
window.NF = window.NF || {};
var NF = window.NF;

/* Shared mutable state; app.js extends it. */
NF.state = { locale: 0 };

NF.S = {
  /* ---- review stage ---- */
  stageKicker: ["UI 重设计 / V2 · 评审稿", "UI REDESIGN / V2 · REVIEW BUILD", "РЕДИЗАЙН / V2 · НА РАССМОТРЕНИЕ"],
  stageTitle: ["Forge Console · 锻造控制台", "Forge Console", "Forge Console"],
  stageSubtitle: ["把 NovelForge 真实的 IDE 级功能密度，重新组织成「轨道 / 上下文 / 工作区 / 运行层」四层；暗色工作台里，正文是唯一一张亮着的纸。", "NovelForge's real IDE-level feature density, reorganised into four layers: rail, context, workspace, runtime. In a dark workbench, the manuscript is the only lit sheet.", "Реальная плотность функций NovelForge, перегруппированная в четыре слоя: рельса, контекст, рабочая область, исполнение. В тёмной среде рукопись — единственный светлый лист."],
  stageStatus: ["评审稿 · 未接入生产界面", "Review build · Production UI untouched", "Черновик · Промышленный UI не изменён"],
  briefTitle: ["为什么是另一版，而不是 v1 换皮", "Why this is a different proposal, not a v1 reskin", "Почему это другая версия, а не перекраска v1"],
  brief1Title: ["01 / 功能先于风格", "01 / Features before styling", "01 / Сначала функции"],
  brief1Body: ["v2 的信息架构来自真实代码：四视图侧栏、15 类文档标签、命令面板 5 组命令、设置 10 分区、状态栏 10 段信息、底部任务/日志/收件箱，逐一在原型里有可点的落点。", "The v2 IA comes from real code: four sidebar views, 15 document tab types, five command groups, ten settings sections, ten status segments, and bottom tasks/log/inbox — each with a clickable home in the prototype.", "Структура v2取自 кода: четыре вида боковой панели, 15 типов вкладок, пять групп команд, десять разделов настроек, сегменты строки состояния и нижние панели — у каждого есть точка входа."],
  brief2Title: ["02 / 与 v1 的差异", "02 / How it differs from v1", "02 / Отличия от v1"],
  brief2Body: ["v1 是暖纸感、衬线、杂志式留白的 Editorial Studio，把 IDE 想象成写作空间。v2 反向：冷石墨工作台、等宽数字、24px 结构网格、紧凑多栏，默认深色，稿纸恒亮且不随主题反色。", "v1 (Editorial Studio) imagined the IDE as a warm, serif, magazine-like writing room. v2 inverts it: a cool graphite workbench, tabular numerals, a 24px structural grid, dense columns, dark by default, and a manuscript sheet that never inverts.", "v1 — тёплая журнальная студия с засечками. v2 — наоборот: холодный графитовый стол, моноширинные цифры, структурная сетка 24px, плотные колонки, тёмный режим по умолчанию и всегда светлый лист."],
  brief3Title: ["03 / 状态必须可读", "03 / State must be legible", "03 / Состояние должно читаться"],
  brief3Body: ["运行、待确认、未保存、已定稿都同时用文字与语义色表达；AI 建议永远先进入审阅，不直接写正文；编辑、恢复、冲突保护在原型里都有明确出口。", "Running, awaiting approval, unsaved and finalised are always expressed in words as well as semantic colour. AI proposals always go through review, never straight into the manuscript; edits, restores and conflict guards have explicit exits.", "«Выполняется», «ожидает решения», «не сохранено», «завершено» передаются и словами, и семантическим цветом. Предложения ИИ проходят рецензию, а не пишут в текст напрямую."],
  btnAppearance: ["外观", "Appearance", "Вид"],
  btnMaximize: ["放大窗口", "Maximise window", "Развернуть"],
  btnRestore: ["还原窗口", "Restore window", "Свернуть"],
  btnFeatures: ["功能覆盖", "Feature map", "Карта функций"],
  btnLanguage: ["界面语言", "Interface language", "Язык интерфейса"],
  mapKicker: ["FUNCTIONAL COVERAGE / TRACEABLE TO CODE", "FUNCTIONAL COVERAGE / TRACEABLE TO CODE", "ПОКРЫТИЕ ФУНКЦИЙ / ПО КОДУ"],
  mapTitle: ["真实功能 → v2 落点", "Real features → where they live in v2", "Реальные функции → где они в v2"],
  mapDesc: ["左栏按真实界面分组列出入口，右侧标注 v2 原型中的落点。标记「原型可点」的项目可以直接在上方窗口里试；「弹窗 / 命令」通过命令面板、设置或对话框进入；「后台能力」不设独立界面，避免在重设计里凭空发明入口。", "Groups follow the real interface. 'Clickable' entries can be tried in the window above; 'Dialog / command' entries live in the command palette, settings or a dialog; 'Backend only' capabilities intentionally have no invented surface.", "Группы повторяют реальный интерфейс. «Кликабельно» — доступно в окне выше; «Диалог / команда» — через палитру команд, настройки или диалог; «Только движок» — намеренно без выдуманного входа."],
  legendUI: ["原型可点", "Clickable in prototype", "Доступно в прототипе"],
  legendSpec: ["弹窗 / 命令", "Dialog / command", "Диалог / команда"],
  legendBackend: ["后台能力（无界面）", "Backend only (no UI)", "Только движок (без UI)"],
  backendTitle: ["明确不设界面的后台能力", "Capabilities deliberately left without a UI", "Возможности без отдельного интерфейса"],
  backendDesc: ["以下能力在 README 中是核心卖点，但在现应用里由工作流 / 引擎内部完成，没有独立界面。v2 不为它们编造页面，只在任务、AI 输出与设置里保留状态与开关。", "These are headline features in the README, but in the app they run inside workflows/engines with no standalone screen. v2 invents no pages for them; their state stays visible through tasks, AI output and settings.", "Это ключевые возможности README, но в приложении они работают внутри движка без отдельного экрана. v2 не выдумывает страницы, а показывает их состояние через задачи, вывод ИИ и настройки."],
  footerNote: ["原型数据只存在于页面内存：不读写项目文件、不连模型、不上传图片、刷新即重置。生产界面未被修改。", "Prototype data lives in page memory only: no project files, no model calls, no image uploads; reload resets it. The production UI is unchanged.", "Данные прототипа только в памяти страницы: без файлов проекта, без вызовов модели, без загрузки изображений; перезагрузка сбрасывает. Рабочий UI не изменён."],
  footerFiles: ["独立目录 · docs/ui-redesign-v2", "Standalone folder · docs/ui-redesign-v2", "Отдельная папка · docs/ui-redesign-v2"],

  /* ---- window chrome & app ---- */
  appName: ["NovelForge", "NovelForge", "NovelForge"],
  projectName: ["雾港来信", "Letters from the Fogged Harbor", "Письма из туманного порта"],
  projectTag: ["悬疑 · 近未来 · 12 万字计划", "Mystery · Near future · 120k target", "Детектив · Ближнее будущее · 120 тыс."],
  windowHint: ["原型 · 仅内存数据", "Prototype · In-memory only", "Прототип · Только в памяти"],
  windowMinimized: ["窗口已最小化", "Window minimised", "Окно свёрнуто"],
  windowRestoreHint: ["点击标题栏的还原按钮，或下方按钮重新打开程序窗口。", "Use the restore control in the title bar, or the button below, to reopen the program window.", "Используйте кнопку восстановления в заголовке или кнопку ниже, чтобы снова открыть окно."],
  reopen: ["重新打开窗口", "Reopen window", "Открыть окно снова"],
  cmdPlaceholder: ["搜索命令、章节、设置…", "Search commands, chapters, settings…", "Поиск команд, глав, настроек…"],
  cmdEmpty: ["没有匹配的命令", "No matching commands", "Команды не найдены"],
  cmdHint: ["↑↓ 选择 · Enter 执行 · Esc 关闭", "↑↓ select · Enter run · Esc close", "↑↓ выбор · Enter запуск · Esc закрыть"],
  shortcutHelp: ["快捷键速查", "Keyboard shortcuts", "Горячие клавиши"],
  navHome: ["主页", "Home", "Главная"],
  navProject: ["项目结构", "Project tree", "Структура проекта"],
  navKnowledge: ["知识库", "Knowledge base", "База знаний"],
  navCharacters: ["角色管理", "Characters", "Персонажи"],
  navTasks: ["任务", "Tasks", "Задачи"],
  navLog: ["日志", "Logs", "Журнал"],
  navActivity: ["写作统计", "Writing activity", "Статистика"],
  navSettings: ["设置", "Settings", "Настройки"],
  navProjects: ["历史项目", "Recent projects", "Недавние проекты"],
  railAgent: ["AI 协作", "AI partner", "ИИ-помощник"],
  railOutput: ["AI 输出", "AI output", "Вывод ИИ"],
  railFocus: ["专注写作", "Focus mode", "Режим фокуса"],
  railTheme: ["主题", "Theme", "Тема"],
  railMore: ["更多", "More", "Ещё"],
  refresh: ["刷新", "Refresh", "Обновить"],
  close: ["关闭", "Close", "Закрыть"],
  cancel: ["取消", "Cancel", "Отмена"],
  confirm: ["确认", "Confirm", "Подтвердить"],
  save: ["保存", "Save", "Сохранить"],
  saved: ["已保存", "Saved", "Сохранено"],
  unsaved: ["未保存", "Unsaved", "Не сохранено"],
  focus: ["专注", "Focus", "Фокус"],
  exitFocus: ["退出专注", "Exit focus", "Выйти из фокуса"],
  showAssistant: ["打开 AI 栏", "Open AI column", "Открыть панель ИИ"],
  hideAssistant: ["收起 AI 栏", "Hide AI column", "Скрыть панель ИИ"],
  showContext: ["打开侧栏", "Open sidebar", "Открыть боковую панель"],
  hideContext: ["收起侧栏", "Hide sidebar", "Скрыть боковую панель"],

  /* ---- context / tabs ---- */
  contextTitle: ["项目结构", "Project tree", "Структура проекта"],
  search: ["筛选…", "Filter…", "Фильтр…"],
  treeCount: ["{n} 项", "{n} items", "{n} элементов"],
  chapterShort: ["第 {n} 章", "Ch. {n}", "Гл. {n}"],
  wordsUnit: ["字", "chars", "зн."],
  tabChapter: ["正文", "Manuscript", "Рукопись"],
  tabBlueprint: ["章节蓝图", "Blueprint", "План главы"],
  tabBoard: ["章节看板", "Chapter board", "Доска глав"],
  tabVersions: ["版本历史", "Version history", "История версий"],
  tabReview: ["审阅报告", "Review report", "Рецензия"],
  tabTimeline: ["世界观时间线", "World timeline", "Хронология мира"],
  tabMemory: ["AI 记忆", "AI memory", "Память ИИ"],
  tabKnowledge: ["检索总览", "Retrieval overview", "Обзор поиска"],
  tabCharacter: ["角色档案", "Character card", "Карточка героя"],
  tabConfig: ["小说配置", "Novel config", "Настройки романа"],
  tabDiff: ["三栏合并", "Three-way merge", "Трёхстороннее слияние"],
  tabPublication: ["连载监控", "Serial monitor", "Мониторинг публикаций"],
  tabWelcome: ["欢迎", "Welcome", "Приветствие"],
  tabClose: ["关闭标签", "Close tab", "Закрыть вкладку"],
  tabCloseAll: ["关闭全部", "Close all", "Закрыть всё"],
  tabMenu: ["标签菜单", "Tab menu", "Меню вкладок"],
  draftTools: ["修稿", "Revise", "Правка"],
  reviewTools: ["审稿", "Review", "Рецензия"],
  finalize: ["定稿", "Finalise", "Завершить"],
  rewrite: ["段落改写", "Rewrite selection", "Переписать фрагмент"],
  undo: ["撤销", "Undo", "Отменить"],
  redo: ["重做", "Redo", "Повторить"],
  typewriter: ["打字机滚动", "Typewriter scroll", "Прокрутка печатной машинки"],
  paragraphFocus: ["段落高亮", "Paragraph focus", "Подсветка абзаца"],
  docStatus: ["草稿 · 第 {n} 章", "Draft · Chapter {n}", "Черновик · Глава {n}"],
  viewTab: ["视图", "View", "Вид"],
  listView: ["列表", "List", "Список"],
  cardView: ["卡片", "Cards", "Карточки"],
  outlineView: ["大纲", "Outline", "План"],
  timelineView: ["时间线", "Timeline", "Хронология"],
  newChapter: ["新建章节", "New chapter", "Новая глава"],
  newBlueprint: ["新建蓝图", "New blueprint", "Новый план"],
  openManuscript: ["打开正文", "Open manuscript", "Открыть рукопись"],

  /* ---- assistant ---- */
  agentTitle: ["AI 协作", "AI partner", "ИИ-помощник"],
  agentTab: ["Agent 对话", "Agent chat", "Диалог агента"],
  outputTab: ["AI 输出", "AI output", "Вывод ИИ"],
  newSession: ["新建会话", "New session", "Новый диалог"],
  history: ["历史对话", "History", "История"],
  memoryView: ["记忆查看", "Memory", "Память"],
  mcpServers: ["MCP 服务器", "MCP servers", "Серверы MCP"],
  skills: ["技能列表", "Skills", "Навыки"],
  clearAll: ["清空全部", "Clear all", "Очистить всё"],
  contextBudget: ["上下文占用", "Context budget", "Бюджет контекста"],
  contextBreakdown: ["基础 / 记忆 / 历史 / 当前", "Base / memory / history / current", "База / память / история / текущее"],
  composePlaceholder: ["@ 提及文件 · / 斜杠命令 · 描述一个故事问题…", "@ mention a file · / slash command · describe a story question…", "@ файл · / команда · опишите вопрос к истории…"],
  send: ["发送", "Send", "Отправить"],
  stop: ["停止", "Stop", "Остановить"],
  scriptedReply: ["固定演示回复 · 未连接模型", "Scripted demo reply · No model connected", "Демо-ответ · Модель не подключена"],
  noPrompt: ["请先输入一个问题", "Enter a question first", "Сначала введите вопрос"],
  demoAnswer: ["可以把线索藏进动作：让林澈先摸到信封边缘的盐粒，再意识到它来自海上。这是固定演示回复，不会自动改动正文。", "Hide the clue in an action: Lin feels salt on the envelope before realising it came from the sea. This scripted reply never edits the manuscript.", "Спрячьте улику в действии: Линь нащупывает соль на конверте и понимает, что письмо пришло с моря. Демо-ответ не меняет рукопись."],
  suggestionPacing: ["节奏建议", "Pacing note", "Ритм"],
  suggestionContinuity: ["连续性提醒", "Continuity note", "Непрерывность"],
  suggestionPacingBody: ["第三段直接交代了信封来历。试着留下一个可见的细节，让读者和林澈一起猜。", "The third paragraph explains the letter. A visible detail could let the reader discover it with Lin.", "Третий абзац объясняет письмо. Деталь позволит читателю догадаться вместе с Линем."],
  suggestionContinuityBody: ["第六章末尾，钥匙交给了沈雁。这里可以补一个取回的动作，或让她来开门。", "At the end of chapter 6 Shen holds the key. Add a handover, or let her open the door.", "В конце главы 6 ключ у Шэнь. Добавьте передачу или поручите ей открыть дверь."],
  viewRewrite: ["查看改写", "Preview rewrite", "Посмотреть правку"],
  dismiss: ["暂不采纳", "Dismiss", "Отклонить"],
  applyRewrite: ["采纳到内存草稿", "Apply to in-memory draft", "Применить к черновику"],
  rewriteGuard: ["只替换这一句；原文不匹配时不会覆盖。不访问真实模型或项目数据。", "Only this sentence is replaced; a changed source blocks application. No model or project data is accessed.", "Заменяется только это предложение; изменённый исходник блокирует правку. Модель и данные проекта не используются."],
  applied: ["已采纳到内存草稿", "Applied to in-memory draft", "Применено к черновику в памяти"],
  noNotes: ["建议已处理。继续写作，或提出一个新问题。", "Notes resolved. Keep writing or ask another question.", "Замечания обработаны. Продолжайте или задайте новый вопрос."],
  references: ["本次引用", "Included references", "Источники"],
  referencesBody: ["人物档案 · 林澈 / 世界规则 · 雾港潮汐 / 章节蓝图 · 第 07 章", "Character · Lin Che / World rule · Harbour tides / Blueprint · Ch. 07", "Персонаж · Линь Чэ / Правило мира · Приливы / План · Гл. 07"],
  contextNote: ["真实接入时，引用绑定项目会话与文档版本，避免跨项目旧结果。", "In production, references bind to a project session and document version to avoid stale cross-project results.", "В приложении источники привязаны к сессии проекта и версии документа."],
  outputRunning: ["工作流运行中", "Workflow running", "Конвейер выполняется"],
  abortGeneration: ["中止生成", "Abort generation", "Прервать генерацию"],

  /* ---- runtime / status ---- */
  runtimeTasks: ["任务", "Tasks", "Задачи"],
  runtimeLog: ["日志", "Logs", "Журнал"],
  runtimeInbox: ["收件箱", "Inbox", "Входящие"],
  running: ["运行中", "Running", "Выполняется"],
  awaiting: ["待你确认", "Awaiting approval", "Ожидает решения"],
  completed: ["已完成", "Completed", "Завершено"],
  cancelled: ["已取消", "Cancelled", "Отменено"],
  viewResult: ["查看结果", "View result", "Открыть результат"],
  approve: ["继续", "Continue", "Продолжить"],
  cancelTask: ["取消任务", "Cancel task", "Отменить задачу"],
  unread: ["{n} 未读", "{n} unread", "{n} непрочитанных"],
  clearLog: ["清空日志", "Clear logs", "Очистить журнал"],
  branchMain: ["主线", "Main", "Основная"],
  agentIdle: ["空闲", "Idle", "Свободен"],
  agentBusy: ["生成中", "Generating", "Генерация"],
  sessionCost: ["会话费用", "Session cost", "Стоимость сессии"],
  resetCost: ["重置会话费用？", "Reset the session cost?", "Сбросить стоимость сессии?"],
  resetCostBody: ["仅重置原型内存中的计数，不影响任何真实用量记录。", "Only resets the in-memory prototype counter; no real usage record is touched.", "Сбрасывает только счётчик в памяти прототипа; реальная статистика не изменяется."],
  modelPicker: ["当前模型", "Current model", "Текущая модель"],
  manageModels: ["管理模型…", "Manage models…", "Управление моделями…"],
  thinking: ["思考等级", "Thinking level", "Уровень размышления"],
  notifications: ["通知中心", "Notifications", "Уведомления"],
  zoom: ["缩放", "Zoom", "Масштаб"],
  updateReady: ["有可用更新", "Update available", "Доступно обновление"],

  /* ---- settings / dialogs ---- */
  settingsTitle: ["设置", "Settings", "Настройки"],
  settingsSearch: ["搜索设置…", "Search settings…", "Поиск настроек…"],
  settingsDirty: ["有未保存的改动，确定关闭？", "Unsaved changes. Close anyway?", "Есть несохранённые изменения. Закрыть?"],
  commandGroupGeneral: ["通用", "General", "Общие"],
  commandGroupView: ["视图与面板", "Views & panels", "Виды и панели"],
  commandGroupEditor: ["正文编辑器", "Editor", "Редактор"],
  commandGroupTheme: ["外观与缩放", "Appearance & zoom", "Вид и масштаб"],
  commandGroupHelp: ["帮助", "Help", "Справка"],
  activityTitle: ["写作统计", "Writing activity", "Статистика"],
  heatmapTitle: ["每日活动热力图", "Daily activity heatmap", "Тепловая карта активности"],
  trendTitle: ["月度趋势", "Monthly trend", "Тренд по месяцам"],
  globalStats: ["全局统计", "Global totals", "Общая статистика"],
  totalWords: ["累计正文", "Manuscript length", "Объём рукописи"],
  modelCalls: ["模型调用", "Model calls", "Вызовы модели"],
  tokens: ["Tokens", "Tokens", "Токены"],
  cost: ["费用", "Cost", "Стоимость"],
  devConsole: ["开发者控制台", "Developer console", "Консоль разработчика"],
  devTabs: ["隔离实例 / IPC 指标 / Agent 运行 / 模型表现 / 项目数据库 / 日志 / 性能", "Isolated instances / IPC metrics / Agent runs / Model performance / Project DB / Logs / Performance", "Изолированные инстансы / IPC / Агент / Модели / БД / Журналы / Производительность"],
  newProject: ["新建项目", "New project", "Новый проект"],
  openProject: ["打开项目", "Open project", "Открыть проект"],
  importNovel: ["导入小说", "Import novel", "Импорт романа"],
  importNote: ["原型只演示界面，不读取或上传真实文件。正式导入沿用现有应用用例。", "This demo does not read or upload files. Production import uses the existing application command.", "Демо не читает и не загружает файлы. Импорт использует существующую команду приложения."],
  chapterTitleField: ["章节标题", "Chapter title", "Заголовок главы"],
  createDemo: ["创建示例章节", "Create demo chapter", "Создать демо-главу"],
  requiredTitle: ["请填写标题", "A title is required", "Укажите заголовок"],
  createdDemo: ["已加入内存中的章节目录", "Added to the in-memory chapter list", "Добавлено в список глав в памяти"],
  versionTitle: ["正文版本", "Manuscript versions", "Версии рукописи"],
  initialVersion: ["初稿 v1 · 原型基线", "Initial v1 · Demo baseline", "Черновик v1 · База демо"],
  restore: ["恢复此版本", "Restore version", "Восстановить"],
  restoreTitle: ["恢复初稿？", "Restore the initial draft?", "Восстановить исходник?"],
  restoreBody: ["将替换本章的内存草稿。替换前会保留一份内存备份，可再次恢复。不会修改项目文件。", "This replaces the in-memory draft. A memory backup is kept first. Project files are unaffected.", "Черновик в памяти будет заменён; перед этим создаётся резерв. Файлы проекта не изменяются."],
  restored: ["已恢复初稿，编辑保留为内存备份", "Initial draft restored; edits kept as a memory backup", "Исходник восстановлен; правки сохранены в резерве"],
  backupRecover: ["取回恢复前的编辑", "Recover pre-restore edits", "Вернуть правки до восстановления"],
  backupRecovered: ["已取回恢复前的编辑", "Pre-restore edits recovered", "Правки возвращены"],
  originalKept: ["原稿始终保留", "Your original is retained", "Оригинал сохраняется"],
  conflictError: ["原文已变化，不能直接应用此建议。请重新审阅。", "The original changed; this proposal cannot be applied. Review a fresh one.", "Исходник изменён; правку применить нельзя. Проверьте новое предложение."],
  reviewSummary: ["审阅摘要", "Review summary", "Итоги рецензии"],
  reviewSummaryBody: ["聚焦两件事：减少解释性句子，补齐钥匙的交接。逐条决策，不用整章覆盖。", "Focus on two things: less exposition and a clear key handover. Decide per change, not by replacing the chapter.", "Меньше объяснений и явная передача ключа. Решайте по каждой правке, не заменяя главу."],
  weightedScore: ["加权评分", "Weighted score", "Взвешенная оценка"],
  accept: ["采纳", "Accept", "Принять"],
  reject: ["拒绝", "Reject", "Отклонить"],

  /* ---- appearance ---- */
  appearanceTitle: ["外观与可读性", "Appearance & readability", "Вид и читаемость"],
  appearanceNote: ["只影响本评审页内的程序窗口；所有颜色由语义令牌驱动。", "Affects only the program window in this review page; every colour is token-driven.", "Влияет только на окно программы на этой странице; все цвета заданы токенами."],
  modeLabel: ["明暗模式", "Light / dark", "Светлый / тёмный"],
  modeLight: ["浅色", "Light", "Светлый"],
  modeDark: ["深色", "Dark", "Тёмный"],
  paletteLabel: ["信号配色", "Signal palette", "Сигнальная палитра"],
  densityLabel: ["界面密度", "Density", "Плотность"],
  densityCompact: ["紧凑", "Compact", "Компактно"],
  densityNormal: ["标准", "Normal", "Обычно"],
  densityComfortable: ["舒适", "Comfortable", "Свободно"],
  writingSizeLabel: ["正文字号", "Writing size", "Размер текста"],
  backgroundLabel: ["工作台背景", "Workbench background", "Фон рабочей области"],
  bgPlain: ["纯色", "Plain", "Однотонный"],
  bgGrid: ["网格", "Grid", "Сетка"],
  bgMist: ["渐变", "Gradient", "Градиент"],
  bgUpload: ["选择本地图片（仅内存预览）", "Choose a local image (memory-only preview)", "Выбрать локальное изображение (только в памяти)"],
  bgUploadHint: ["图片不会被上传或写入磁盘", "The image is never uploaded or written to disk", "Изображение не загружается и не записывается на диск"],
  bgRemove: ["移除图片", "Remove image", "Удалить изображение"],
  bgStrength: ["背景强度", "Background strength", "Интенсивность фона"],
  bgVeil: ["可读性遮罩", "Readability veil", "Маска читаемости"],
  bgBlur: ["模糊", "Blur", "Размытие"],
  bgFit: ["铺放方式", "Fit", "Масштабирование"],
  resetAppearance: ["恢复默认", "Reset to defaults", "Сбросить"],
  done: ["完成", "Done", "Готово"],
  themeMenu: ["主题：浅色 / 星空 / 纸质 / 黑夜", "Themes: light / galaxy / paper / dark", "Темы: светлая / галактика / бумага / тёмная"],
  languageMenu: ["界面语言：zh-CN / en-US / ru-RU", "Language: zh-CN / en-US / ru-RU", "Язык: zh-CN / en-US / ru-RU"],

  /* ---- misc ---- */
  tipMemoryOnly: ["修改仅保留在此页内存，刷新即重置", "Edits live in page memory; reload resets them", "Правки в памяти страницы; обновление сбрасывает"],
  autoNoteSafe: ["自动保存 · 仅内存", "Auto-save · In memory", "Автосохранение · В памяти"],
  finalized: ["定稿章节", "Finalised chapters", "Завершённые главы"],
  goReview: ["去审阅建议", "Review proposals", "Проверить предложения"],
  modelRoute: ["分层模型路由", "Tiered model routing", "Многоуровневая маршрутизация"],
  name: ["名称", "Name", "Название"],
  original: ["原文", "Original", "Оригинал"],
  projectProgress: ["创作进度", "Project progress", "Прогресс"],
  replacement: ["建议改写", "Proposed rewrite", "Предложенная правка"],
  safety: ["你的原稿始终保留", "Your original is retained", "Оригинал сохраняется"],
  task1: ["第一卷连续性校检", "Volume I continuity review", "Проверка тома I"],
  sceneGoal: ["本章目标", "Chapter purpose", "Задача главы"],
  conflict: ["核心冲突", "Core conflict", "Конфликт"],
  ending: ["结尾钩子", "Ending hook", "Финальный крючок"],
  prototypeReady: ["原型已就绪", "Prototype ready", "Прототип готов"],
  demoOnly: ["演示操作 · 未写入文件或数据库", "Demo action · No file or database was written", "Демо · Файлы и БД не изменены"],
  pageMemory: ["仅内存", "In memory", "В памяти"],
};

/* ---------------------------------------------------------------------------
   Structured data: real feature surfaces.
   --------------------------------------------------------------------------- */
NF.D = {};

NF.D.palettes = [
  { id: "cobalt", name: ["钴蓝", "Cobalt", "Кобальт"] },
  { id: "ember", name: ["余烬", "Ember", "Уголь"] },
  { id: "jade", name: ["青玉", "Jade", "Нефрит"] },
  { id: "orchid", name: ["兰紫", "Orchid", "Орхидея"] }
];

NF.D.modes = [
  { id: "light", name: ["浅色", "Light", "Светлый"] },
  { id: "dark", name: ["深色", "Dark", "Тёмный"] }
];

NF.D.densities = [
  { id: "compact", name: ["紧凑", "Compact", "Компактно"] },
  { id: "normal", name: ["标准", "Normal", "Обычно"] },
  { id: "comfortable", name: ["舒适", "Comfortable", "Свободно"] }
];

/* Sidebar groups mirror ProjectTree.tsx, with an explicit AI-memory group:
   the real MemoryGroup component exists but is not mounted in the tree today. */
NF.D.treeGroups = [
  { id: "config", name: ["小说配置", "Novel config", "Настройки романа"], icon: "sliders", badge: ["已完成", "Ready", "Готово"], badgeKind: "success", items: [
    { id: "config-main", name: ["题材 · 视角 · 篇幅", "Genre · POV · length", "Жанр · POV · объём"], icon: "file", tab: "config" },
    { id: "config-prompt", name: ["生成配置", "Generation config", "Настройки генерации"], icon: "spark", tab: "config" }
  ]},
  { id: "architecture", name: ["故事架构", "Story architecture", "Архитектура сюжета"], icon: "layers", badge: ["3 / 4", "3 / 4", "3 / 4"], badgeKind: "info", items: [
    { id: "arch-outline", name: ["总大纲", "Master outline", "Общий план"], icon: "file", tab: "config" },
    { id: "arch-act", name: ["三幕结构", "Three-act structure", "Три акта"], icon: "file", tab: "board" },
    { id: "arch-volume", name: ["分卷划分", "Volume split", "Разбивка на тома"], icon: "file", tab: "board" }
  ]},
  { id: "world", name: ["世界观与时间线", "World & timeline", "Мир и хронология"], icon: "globe", badge: ["12 实体 / 8 事件", "12 entities / 8 events", "12 сущ. / 8 соб."], badgeKind: "info", items: [
    { id: "world-rules", name: ["雾港时间规则", "Harbour time rules", "Правила времени порта"], icon: "file", tab: "timeline" },
    { id: "world-timeline", name: ["事件时间线", "Event timeline", "Хронология событий"], icon: "clock", tab: "timeline" }
  ]},
  { id: "blueprint", name: ["章节蓝图", "Chapter blueprints", "Планы глав"], icon: "cards", badge: ["12 / 12", "12 / 12", "12 / 12"], badgeKind: "brand", items: [
    { id: "bp-board", name: ["章节看板", "Chapter board", "Доска глав"], icon: "board", tab: "board" },
    { id: "bp-07", name: ["第 07 章 · 盐粒与信封", "Ch. 07 · Salt on the envelope", "Гл. 07 · Соль на конверте"], icon: "file", tab: "blueprint" },
    { id: "bp-08", name: ["第 08 章 · 逆流的门", "Ch. 08 · The upstream door", "Гл. 08 · Дверь против течения"], icon: "file", tab: "blueprint" }
  ]},
  { id: "volumes", name: ["分卷", "Volumes", "Тома"], icon: "book", badge: ["2", "2", "2"], badgeKind: "info", items: [
    { id: "vol-1", name: ["第一卷 · 雾的边界", "Vol. I · Edge of the fog", "Том I · Граница тумана"], icon: "book", tab: "board" },
    { id: "vol-2", name: ["第二卷 · 逆流之城", "Vol. II · The upstream city", "Том II · Город против течения"], icon: "book", tab: "board" },
    { id: "vol-auto", name: ["自动划分 / 编辑分卷", "Auto-split / edit volumes", "Авторазбивка / правка томов"], icon: "spark", action: "auto-split" }
  ]},
  { id: "serial", name: ["连载监控", "Serial monitor", "Мониторинг публикаций"], icon: "activity", badge: ["相似度 92%", "Similarity 92%", "Сходство 92%"], badgeKind: "warning", items: [
    { id: "serial-import", name: ["导入平台章节", "Import platform chapters", "Импорт глав с платформы"], icon: "download", tab: "publication" },
    { id: "serial-audit", name: ["相似度审计", "Similarity audit", "Аудит сходства"], icon: "shield", tab: "publication" }
  ]},
  { id: "drafts", name: ["草稿箱", "Drafts", "Черновики"], icon: "edit", badge: ["3 活跃", "3 active", "3 активных"], badgeKind: "brand", items: [
    { id: "ch-05", name: ["第 05 章 · 潮汐表", "Ch. 05 · Tide table", "Гл. 05 · Таблица приливов"], icon: "file", chapter: 5 },
    { id: "ch-06", name: ["第 06 章 · 铜钥匙", "Ch. 06 · The brass key", "Гл. 06 · Латунный ключ"], icon: "file", chapter: 6 },
    { id: "ch-07", name: ["第 07 章 · 盐粒与信封", "Ch. 07 · Salt on the envelope", "Гл. 07 · Соль на конверте"], icon: "file", chapter: 7, active: true },
    { id: "ch-08", name: ["第 08 章 · 逆流的门", "Ch. 08 · The upstream door", "Гл. 08 · Дверь против течения"], icon: "file", chapter: 8 }
  ]},
  { id: "chapters", name: ["正文章节", "Finalised chapters", "Завершённые главы"], icon: "check", badge: ["4 已定稿", "4 finalised", "4 завершено"], badgeKind: "success", items: [
    { id: "fin-01", name: ["第 01 章 · 明天的日期", "Ch. 01 · Tomorrow's date", "Гл. 01 · Завтрашняя дата"], icon: "file", chapter: 1 },
    { id: "fin-04", name: ["第 04 章 · 无人的灯塔", "Ch. 04 · The empty lighthouse", "Гл. 04 · Пустой маяк"], icon: "file", chapter: 4 }
  ]},
  { id: "memory", name: ["AI 记忆", "AI memory", "Память ИИ"], icon: "brain", badge: ["v2 新增入口", "New in v2", "Новое в v2"], badgeKind: "accent", items: [
    { id: "mem-chapter", name: ["章节记忆 · 07", "Chapter memory · 07", "Память главы · 07"], icon: "brain", tab: "memory" },
    { id: "mem-volume", name: ["卷记忆 · 第一卷", "Volume memory · I", "Память тома · I"], icon: "brain", tab: "memory" },
    { id: "mem-book", name: ["全书状态 · 待重建", "Book state · Needs rebuild", "Состояние книги · Требует пересборки"], icon: "brain", tab: "memory" }
  ]}
];

NF.D.knowledgeDocs = [
  { name: ["雾港潮汐观测记录", "Harbour tide observations", "Наблюдения за приливами"], type: ["研究资料", "Research", "Исследование"], refs: 6, chunks: 24 },
  { name: ["近未来城市设定笔记", "Near-future city notes", "Заметки о городе будущего"], type: ["设定笔记", "World note", "Заметка о мире"], refs: 4, chunks: 18 },
  { name: ["信封上的盐粒", "Salt on the envelope", "Соль на конверте"], type: ["灵感片段", "Inspiration", "Идея"], refs: 2, chunks: 6 },
  { name: ["角色对话风格样本", "Dialogue style samples", "Образцы диалогов"], type: ["研究资料", "Research", "Исследование"], refs: 3, chunks: 11 },
  { name: ["第一卷伏笔清单", "Volume I foreshadowing", "Намёки первого тома"], type: ["设定笔记", "World note", "Заметка о мире"], refs: 5, chunks: 9 }
];

NF.D.characters = [
  { name: ["林澈", "Lin Che", "Линь Чэ"], tier: ["主角", "Protagonist", "Главный герой"], role: ["档案已建立", "Profile ready", "Профиль готов"], desc: ["沿着潮汐留下的线索，寻找被城市遗忘的过去。", "Follows the tides toward a past the city forgot.", "Идёт по следам прилива к забытому прошлому."] },
  { name: ["沈雁", "Shen Yan", "Шэнь Янь"], tier: ["关键配角", "Supporting", "Второй план"], role: ["档案已建立", "Profile ready", "Профиль готов"], desc: ["第六章末接过铜钥匙，掌握开门的主动权。", "Holds the brass key since chapter six.", "С шестой главы держит латунный ключ."] },
  { name: ["守塔人", "The keeper", "Смотритель"], tier: ["对立角色", "Antagonist", "Антагонист"], role: ["档案待补全", "Profile incomplete", "Профиль неполон"], desc: ["从不解释雾从何来，只在涨潮时熄灯。", "Never explains the fog; only douses the light at high tide.", "Никогда не объясняет туман, гасит свет в прилив."] }
];

NF.D.reviewRoles = [
  { name: ["主编", "Editor-in-chief", "Главный редактор"], score: "8.4", note: ["结构完整，转折略早。", "Solid structure, the turn comes early.", "Структура цельная, поворот ранний."] },
  { name: ["情节", "Plot", "Сюжет"], score: "8.8", note: ["线索咬合准确。", "Clues interlock well.", "Улики связаны точно."] },
  { name: ["文案", "Prose", "Текст"], score: "7.9", note: ["第三段解释偏多。", "Third paragraph over-explains.", "Третий абзац слишком объясняет."] },
  { name: ["连续性", "Continuity", "Непрерывность"], score: "7.2", note: ["铜钥匙归属需要补写。", "Brass-key handover is missing.", "Не указана передача ключа."] },
  { name: ["风格", "Voice", "Стиль"], score: "9.1", note: ["克制、稳定。", "Restrained and consistent.", "Сдержанно и устойчиво."] }
];

NF.D.tasks = [
  { name: ["第一卷连续性校检", "Volume I continuity review", "Проверка непрерывности тома I"], state: "awaiting", scope: ["第 01—07 章 · 只读分析", "Ch. 01–07 · Read-only", "Гл. 01–07 · Только чтение"], progress: 100 },
  { name: ["人物档案提取", "Character profile extraction", "Извлечение профилей героев"], state: "running", scope: ["3 位人物 · 示例记录", "3 characters · Demo records", "3 персонажа · Демо"], progress: 62 },
  { name: ["第八章蓝图生成", "Chapter 8 blueprint", "План восьмой главы"], state: "running", scope: ["第八章 · 未写入正文", "Ch. 08 · Not written", "Гл. 08 · Не записано"], progress: 35 },
  { name: ["文风学习（后期管线）", "Style learning (post pipeline)", "Обучение стилю (конвейер)"], state: "completed", scope: ["已完成 · 4 步", "Done · 4 steps", "Готово · 4 шага"], progress: 100 }
];

NF.D.logs = [
  { time: "17:22:08", level: "info", text: "[Save:Draft] chapter 07 · in-memory draft confirmed" },
  { time: "17:21:54", level: "info", text: "[Workflow] continuity.review → awaiting_approval" },
  { time: "17:21:30", level: "warn", text: "[LLM] JSON parse retry 1/2 · payload kept in log" },
  { time: "17:20:11", level: "info", text: "[Retrieval] hybrid search · topK=6 · 3 references injected" },
  { time: "17:19:48", level: "error", text: "[Vector] local model unavailable → fell back to FTS" }
];

NF.D.inbox = [
  { name: ["审阅结果已就绪 · 第一卷", "Review result ready · Volume I", "Готов результат рецензии · Том I"], unread: true, tag: ["待确认", "Pending", "Ожидает"] },
  { name: ["自动化任务完成 · 文风学习", "Automation finished · Style learning", "Автоматизация завершена · Стиль"], unread: true, tag: ["已完成", "Done", "Готово"] },
  { name: ["向量索引重建完成", "Vector index rebuilt", "Векторный индекс пересобран"], unread: false, tag: ["已完成", "Done", "Готово"] }
];

NF.D.settingsSections = [
  { id: "llm", name: ["AI 模型", "AI models", "Модели ИИ"], icon: "spark", desc: ["供应商账户、模型目录、分层路由与并发控制。", "Provider accounts, model catalogue, tiered routing, concurrency.", "Учётные записи, каталог моделей, маршрутизация, параллелизм."], rows: [
    { label: ["供应商账户", "Provider accounts", "Учётные записи"], value: ["OpenAI / DeepSeek / Ollama", "OpenAI / DeepSeek / Ollama", "OpenAI / DeepSeek / Ollama"] },
    { label: ["elite 创意写作", "elite · creative", "elite · креатив"], value: ["gpt-class", "gpt-class", "gpt-class"] },
    { label: ["standard 标准分析", "standard · analysis", "standard · анализ"], value: ["deepseek-class", "deepseek-class", "deepseek-class"] },
    { label: ["budget 轻量处理", "budget · light tasks", "budget · лёгкие задачи"], value: ["local-class", "local-class", "local-class"] },
    { label: ["动态路由", "Dynamic routing", "Динамическая маршрутизация"], toggle: true },
    { label: ["最大并发 / 排队上限", "Max concurrency / queue", "Параллелизм / очередь"], value: ["4 / 40", "4 / 40", "4 / 40"] },
    { label: ["写作自动化", "Writing automation", "Автоматизация письма"], toggle: true },
    { label: ["自学习压缩", "Adaptive compaction", "Адаптивное сжатие"], toggle: true }
  ]},
  { id: "usage", name: ["用量统计", "Usage", "Статистика"], icon: "activity", desc: ["调用记录、Tokens、费用与趋势图。", "Calls, tokens, cost and trend charts.", "Вызовы, токены, стоимость и графики."], rows: [
    { label: ["模型调用", "Model calls", "Вызовы модели"], value: ["1,284", "1,284", "1,284"] },
    { label: ["Tokens", "Tokens", "Токены"], value: ["2.41M", "2.41M", "2,41 млн"] },
    { label: ["本月费用", "Cost this month", "Стоимость за месяц"], value: ["¥ 38.60", "¥ 38.60", "¥ 38,60"] },
    { label: ["缓存命中率", "Cache hit rate", "Попадания в кэш"], value: ["46%", "46%", "46%"] }
  ]},
  { id: "embedding", name: ["向量检索", "Vector retrieval", "Векторный поиск"], icon: "search", desc: ["工作模式、Embedding 模型、本地模型与索引维护。", "Mode, embedding model, local download and index maintenance.", "Режим, модель, локальная загрузка и обслуживание индекса."], rows: [
    { label: ["检索模式", "Retrieval mode", "Режим поиска"], value: ["混合 / BM25 / FTS+向量", "Hybrid / BM25 / FTS+vector", "Гибрид / BM25 / FTS+вектор"] },
    { label: ["LLM 向量化", "LLM-as-embedder", "LLM как эмбеддер"], toggle: true },
    { label: ["本地 Ollama / bge-m3", "Local Ollama / bge-m3", "Локальный Ollama / bge-m3"], toggle: true },
    { label: ["重建向量索引 / 回填分词", "Rebuild index / backfill tokens", "Пересобрать индекс / токены"], value: ["操作入口", "Action", "Действие"] }
  ]},
  { id: "proxy", name: ["网络代理", "Network proxy", "Прокси"], icon: "globe", desc: ["HTTP / SOCKS5 代理配置。", "HTTP / SOCKS5 proxy configuration.", "Настройка HTTP / SOCKS5 прокси."], rows: [
    { label: ["启用代理", "Enable proxy", "Включить прокси"], toggle: false },
    { label: ["类型", "Type", "Тип"], value: ["HTTP", "HTTP", "HTTP"] },
    { label: ["主机 / 端口", "Host / port", "Хост / порт"], value: ["127.0.0.1 : 7890", "127.0.0.1 : 7890", "127.0.0.1 : 7890"] }
  ]},
  { id: "editor", name: ["编辑器", "Editor", "Редактор"], icon: "edit", desc: ["主题、语言、字体、字号、栏宽与阅读开关。", "Theme, language, fonts, size, measure and reading switches.", "Тема, язык, шрифты, размер, ширина и переключатели чтения."], rows: [
    { label: ["界面主题", "UI theme", "Тема интерфейса"], value: ["浅色 / 星空 / 纸质 / 黑夜", "Light / galaxy / paper / dark", "Светлая / галактика / бумага / тёмная"] },
    { label: ["界面语言", "Interface language", "Язык интерфейса"], value: ["zh-CN / en-US / ru-RU", "zh-CN / en-US / ru-RU", "zh-CN / en-US / ru-RU"] },
    { label: ["正文字号 / 栏宽", "Writing size / measure", "Размер / ширина"], value: ["17px / 720px", "17px / 720px", "17px / 720px"] },
    { label: ["打字机滚动", "Typewriter scroll", "Прокрутка печатной машинки"], toggle: true },
    { label: ["当前段落高亮", "Paragraph focus", "Подсветка абзаца"], toggle: false },
    { label: ["快捷键录制 / 恢复默认", "Shortcuts · record / reset", "Клавиши · запись / сброс"], value: ["操作入口", "Action", "Действие"] }
  ]},
  { id: "prompts", name: ["提示词模板", "Prompt templates", "Шаблоны промптов"], icon: "file", desc: ["内置 / 自定义模板编辑，19 模板 + 系统约束 + 角色定位。", "Built-in / custom templates: 19 prompts, system constraints, roles.", "Встроенные и свои шаблоны: 19 промптов, ограничения, роли."], rows: [
    { label: ["内置模板", "Built-in templates", "Встроенные шаблоны"], value: ["19", "19", "19"] },
    { label: ["输出语言", "Output language", "Язык вывода"], value: ["跟随界面", "Follows UI locale", "Зависит от языка UI"] },
    { label: ["恢复默认 / 删除自定义", "Restore defaults / delete", "Сбросить / удалить"], value: ["操作入口", "Action", "Действие"] }
  ]},
  { id: "skills", name: ["技能库", "Skills", "Навыки"], icon: "layers", desc: ["内置 / 用户 / 项目三级 SKILL.md，兼容 Cursor 生态。", "Built-in / user / project SKILL.md, Cursor-compatible.", "Встроенные / пользовательские / проектные SKILL.md."], rows: [
    { label: ["内置技能", "Built-in skills", "Встроенные навыки"], value: ["12", "12", "12"] },
    { label: ["用户 / 项目技能", "User / project skills", "Навыки пользователя / проекта"], value: ["3 / 2", "3 / 2", "3 / 2"] },
    { label: ["添加 / 删除", "Add / remove", "Добавить / удалить"], value: ["操作入口", "Action", "Действие"] }
  ]},
  { id: "mcp", name: ["MCP 服务器", "MCP servers", "Серверы MCP"], icon: "plug", desc: ["服务器列表、连接状态与推荐芯片。", "Server list, connection state and suggestions.", "Список серверов, состояние и рекомендации."], rows: [
    { label: ["已连接服务器", "Connected servers", "Подключённые серверы"], value: ["2", "2", "2"] },
    { label: ["连接 / 断开", "Connect / disconnect", "Подключить / отключить"], value: ["操作入口", "Action", "Действие"] },
    { label: ["推荐芯片", "Suggested servers", "Рекомендации"], value: ["3", "3", "3"] }
  ]},
  { id: "dev", name: ["开发者选项", "Developer", "Разработчику"], icon: "terminal", desc: ["开发者控制台开关、隔离实例、运行测试。", "Developer console, isolated instances, run tests.", "Консоль разработчика, изолированные инстансы, тесты."], rows: [
    { label: ["开发者控制台", "Developer console", "Консоль разработчика"], toggle: false },
    { label: ["控制台分区", "Console tabs", "Вкладки консоли"], value: ["7", "7", "7"] },
    { label: ["隔离实例 / 运行测试", "Isolated instances / tests", "Изоляция / тесты"], value: ["操作入口", "Action", "Действие"] }
  ]},
  { id: "about", name: ["关于与支持", "About & support", "О программе"], icon: "info", desc: ["版本、更新、发布页与退出应用。", "Version, updates, release page and quit.", "Версия, обновления, страница релизов и выход."], rows: [
    { label: ["版本", "Version", "Версия"], value: ["v0.1.7-beta.3 · Schema v23", "v0.1.7-beta.3 · Schema v23", "v0.1.7-beta.3 · Schema v23"] },
    { label: ["检查更新", "Check for updates", "Проверить обновления"], value: ["操作入口", "Action", "Действие"] },
    { label: ["发布页 / 退出 / 卸载", "Release page / quit / uninstall", "Релизы / выход / удаление"], value: ["二次确认", "Confirmation", "Подтверждение"] }
  ]}
];

NF.D.commands = [
  { group: "commandGroupGeneral", items: [
    { name: ["新建项目", "New project", "Новый проект"], icon: "plus", hint: "action:new-project" },
    { name: ["打开项目", "Open project", "Открыть проект"], icon: "folder", hint: "action:open-project" },
    { name: ["导入小说", "Import novel", "Импорт романа"], icon: "download", hint: "action:import-novel" },
    { name: ["新建章节", "New chapter", "Новая глава"], icon: "plus", hint: "action:new-chapter", kbd: "Ctrl+N" },
    { name: ["开发者控制台", "Developer console", "Консоль разработчика"], icon: "terminal", hint: "action:dev-console" },
    { name: ["写作统计", "Writing activity", "Статистика"], icon: "activity", hint: "action:activity" },
    { name: ["版本历史", "Version history", "История версий"], icon: "clock", hint: "action:versions" },
    { name: ["世界观 / 时间线", "World / timeline", "Мир / хронология"], icon: "globe", hint: "tab:timeline" },
    { name: ["章节看板", "Chapter board", "Доска глав"], icon: "board", hint: "tab:board" },
    { name: ["设置", "Settings", "Настройки"], icon: "settings", hint: "action:settings", kbd: "Ctrl+," }
  ]},
  { group: "commandGroupView", items: [
    { name: ["切换侧栏", "Toggle sidebar", "Переключить панель"], icon: "sidebar", hint: "action:toggle-context" },
    { name: ["显示项目结构", "Show project tree", "Показать структуру"], icon: "folder", hint: "view:project" },
    { name: ["显示知识库", "Show knowledge base", "Показать базу знаний"], icon: "book", hint: "view:knowledge" },
    { name: ["显示角色管理", "Show characters", "Показать персонажей"], icon: "users", hint: "view:characters" },
    { name: ["切换 Agent 面板", "Toggle agent panel", "Переключить агента"], icon: "spark", hint: "action:toggle-assistant" },
    { name: ["切换底部面板", "Toggle bottom panel", "Переключить нижнюю панель"], icon: "layers", hint: "action:toggle-runtime" },
    { name: ["专注模式", "Focus mode", "Режим фокуса"], icon: "focus", hint: "action:focus", kbd: "F11" }
  ]},
  { group: "commandGroupEditor", items: [
    { name: ["打字机滚动", "Typewriter scroll", "Прокрутка печатной машинки"], icon: "edit", hint: "setting:typewriter" },
    { name: ["当前段落高亮", "Paragraph focus", "Подсветка абзаца"], icon: "edit", hint: "setting:paragraphFocus" },
    { name: ["正文字号 17px", "Writing size 17px", "Размер текста 17px"], icon: "edit", hint: "size:17" },
    { name: ["正文字号 18px", "Writing size 18px", "Размер текста 18px"], icon: "edit", hint: "size:18" },
    { name: ["栏宽 720px", "Measure 720px", "Ширина 720px"], icon: "edit", hint: "measure:720" },
    { name: ["栏宽 760px", "Measure 760px", "Ширина 760px"], icon: "edit", hint: "measure:760" },
    { name: ["栏宽 800px", "Measure 800px", "Ширина 800px"], icon: "edit", hint: "measure:800" }
  ]},
  { group: "commandGroupTheme", items: [
    { name: ["主题 · 浅色", "Theme · Light", "Тема · Светлая"], icon: "sun", hint: "theme:light" },
    { name: ["主题 · 星空", "Theme · Galaxy", "Тема · Галактика"], icon: "moon", hint: "theme:galaxy" },
    { name: ["主题 · 纸质", "Theme · Paper", "Тема · Бумага"], icon: "book", hint: "theme:paper" },
    { name: ["主题 · 黑夜", "Theme · Dark", "Тема · Тёмная"], icon: "moon", hint: "theme:dark" },
    { name: ["放大", "Zoom in", "Увеличить"], icon: "plus", hint: "zoom:+" },
    { name: ["缩小", "Zoom out", "Уменьшить"], icon: "minus", hint: "zoom:-" },
    { name: ["重置缩放 100%", "Reset zoom 100%", "Сбросить масштаб 100%"], icon: "refresh", hint: "zoom:reset" }
  ]},
  { group: "commandGroupHelp", items: [
    { name: ["快捷键速查", "Keyboard shortcuts", "Горячие клавиши"], icon: "keyboard", hint: "action:shortcuts" },
    { name: ["外观与可读性", "Appearance & readability", "Вид и читаемость"], icon: "palette", hint: "action:appearance" }
  ]}
];

/* Functional coverage matrix: real feature → v2 landing point.
   kind: ui = clickable in the window, spec = dialog / command / settings,
   backend = no standalone UI in the app. */
NF.D.featureGroups = [
  { title: ["导航与框架", "Navigation & shell", "Навигация и каркас"], items: [
    ["左图标栏 · 主页/项目/知识库/角色", "Activity rail · Home/Project/Knowledge/Characters", "Рельса · Главная/Проект/База/Персонажи", "轨道栏", "Rail", "Рельса", "ui"],
    ["历史项目方块列表", "Recent project squares", "Квадраты недавних проектов", "轨道栏中部", "Rail middle", "Середина рельсы", "ui"],
    ["右图标栏 · Agent / AI 输出 / 专注 / 主题", "Right rail · Agent / AI output / Focus / Theme", "Правая рельса · Агент / Вывод / Фокус / Тема", "AI 栏与标题栏", "AI column & title bar", "Панель ИИ и заголовок", "ui"],
    ["底部面板 · 任务 / 日志 / 收件箱", "Bottom panel · Tasks / Logs / Inbox", "Нижняя панель · Задачи / Журнал / Входящие", "运行层", "Runtime layer", "Слой исполнения", "ui"],
    ["状态栏 10 段信息（字数/费用/模型/缩放等）", "Status bar (words/cost/model/zoom…)", "Строка состояния (объём/стоимость/модель…)", "状态栏", "Status bar", "Строка состояния", "ui"],
    ["命令面板与快捷键速查", "Command palette & shortcut sheet", "Палитра команд и список клавиш", "Ctrl+K 弹窗", "Ctrl+K dialog", "Диалог Ctrl+K", "spec"]
  ]},
  { title: ["项目与章节", "Project & chapters", "Проект и главы"], items: [
    ["项目树 8 个分组（配置/架构/世界观/蓝图/分卷/监控/草稿/正文）", "Project tree: 8 real groups", "Дерево проекта: 8 реальных групп", "上下文栏", "Context column", "Колонка контекста", "ui"],
    ["分卷 · 新建/编辑/自动划分", "Volumes · create / edit / auto-split", "Тома · создать / править / авторазбивка", "上下文栏 + 对话框", "Context + dialog", "Контекст + диалог", "spec"],
    ["草稿箱与已定稿章节", "Drafts and finalised chapters", "Черновики и завершённые главы", "上下文栏", "Context column", "Колонка контекста", "ui"],
    ["章节看板 · 列表/卡片/大纲/时间线", "Chapter board · list/card/outline/timeline", "Доска глав · список/карточки/план/хронология", "工作区标签", "Workspace tab", "Вкладка рабочей области", "ui"],
    ["新建章节 / 新建项目 / 导入小说", "New chapter / project / import novel", "Новая глава / проект / импорт", "命令 + 对话框", "Command + dialog", "Команда + диалог", "spec"],
    ["连载监控 · 导入平台章节 / 相似度审计", "Serial monitor · import / similarity audit", "Мониторинг · импорт / аудит сходства", "工作区标签", "Workspace tab", "Вкладка рабочей области", "ui"]
  ]},
  { title: ["正文编辑与审阅", "Writing & review", "Текст и рецензия"], items: [
    ["多标签编辑区 · 15 类文档", "Multi-tab editor · 15 document types", "Мультивкладки · 15 типов документов", "标签条", "Tab bar", "Панель вкладок", "ui"],
    ["草稿工具栏 · 修稿 / 审稿 / 定稿", "Draft toolbar · revise / review / finalise", "Панель черновика · правка / рецензия / финал", "文档工具栏", "Document toolbar", "Панель документа", "ui"],
    ["段落级改写 · 扩写/缩写/改风格/增强冲突/润色", "Paragraph rewrite · 5 modes", "Переписывание абзаца · 5 режимов", "选区气泡", "Selection bubble", "Меню выделения", "ui"],
    ["编辑部审阅 · 5 角色加权评分", "Editorial board · 5 roles + weighted score", "Редколлегия · 5 ролей и оценка", "审阅报告标签", "Review tab", "Вкладка рецензии", "ui"],
    ["版本历史 / 三栏合并 / 恢复与冲突保护", "Version history / three-way merge / restore", "История версий / слияние / восстановление", "标签 + 对话框", "Tab + dialog", "Вкладка + диалог", "spec"],
    ["撤销/重做 · 打字机 · 段落聚焦 · 字号栏宽", "Undo/redo · typewriter · paragraph focus · measure", "Отмена/повтор · прокрутка · подсветка · ширина", "工具栏 + 命令", "Toolbar + commands", "Панель + команды", "ui"]
  ]},
  { title: ["设定、角色与知识库", "World, cast & knowledge", "Мир, герои и база знаний"], items: [
    ["小说配置 / 故事架构文件", "Novel config / architecture files", "Настройки романа / файлы архитектуры", "上下文栏", "Context column", "Колонка контекста", "ui"],
    ["世界观与时间线", "World building & timeline", "Мир и хронология", "工作区标签", "Workspace tab", "Вкладка рабочей области", "ui"],
    ["角色卡 / 关系图谱 / 反向链接 / 从定稿生成档案", "Character cards / graph / backlinks / extract", "Карточки / граф / обратные ссылки / извлечение", "角色视图", "Characters view", "Вид персонажей", "ui"],
    ["知识库 · 文档/切片统计、语义检索、AI 总结", "Knowledge base · docs/chunks, semantic search, summary", "База знаний · документы, поиск, резюме", "知识库视图", "Knowledge view", "Вид базы знаний", "ui"],
    ["检索模式 / Top K / 重建索引 / 回填分词", "Retrieval mode / Top K / rebuild / token backfill", "Режим / Top K / пересборка / токенизация", "检索总览 + 设置", "Overview + settings", "Обзор + настройки", "spec"],
    ["AI 记忆 · 查看/编辑/删除/重建（现应用未挂到树）", "AI memory · view/edit/delete/rebuild (not mounted today)", "Память ИИ · просмотр/правка/пересборка (не в дереве)", "v2 新增树分组", "New v2 tree group", "Новая группа v2", "ui"]
  ]},
  { title: ["AI 协作与任务", "AI partner & tasks", "ИИ и задачи"], items: [
    ["Agent 对话 · 新建会话 / 历史 / 分支 fork / rewind", "Agent chat · sessions / history / fork / rewind", "Диалог · сессии / история / ответвления", "AI 栏", "AI column", "Панель ИИ", "ui"],
    ["@ 提及文件 / 斜杠命令 / 模型 / 深度 / 思考等级", "@ mentions / slash commands / model / thinking", "@ файлы / команды / модель / размышление", "输入区", "Compose box", "Поле ввода", "ui"],
    ["工具调用 / 计划步骤 / 产物卡 / 确认卡", "Tool calls / plan steps / artifacts / confirm cards", "Вызовы инструментов / план / артефакты", "AI 栏消息", "AI messages", "Сообщения ИИ", "ui"],
    ["上下文占用环与费用明细", "Context budget ring & cost breakdown", "Кольцо контекста и детали стоимости", "AI 栏 + 状态栏", "AI column + status", "Панель ИИ + статус", "ui"],
    ["AI 输出面板 · 流式步骤 / 中止生成 / 历史运行", "AI output · streaming steps / abort / run history", "Вывод ИИ · шаги / прерывание / история", "AI 栏第二页", "AI second tab", "Вторая вкладка ИИ", "ui"],
    ["任务中心 · 等待确认 / 继续 / 取消 / 收件箱", "Task center · approval / continue / cancel / inbox", "Задачи · подтверждение / отмена / входящие", "运行层", "Runtime layer", "Слой исполнения", "ui"]
  ]},
  { title: ["模型、成本与系统", "Models, cost & system", "Модели, стоимость и система"], items: [
    ["供应商账户 · 自动拉取模型列表", "Provider accounts · auto model discovery", "Учётные записи · автосписок моделей", "设置 → AI 模型", "Settings → AI models", "Настройки → Модели", "spec"],
    ["elite / standard / budget 分层路由 + 动态路由", "Three-tier routing + dynamic routing", "Трёхуровневая маршрутизация", "设置 → AI 模型", "Settings → AI models", "Настройки → Модели", "spec"],
    ["并发控制 / 上下文压缩 / 写作自动化", "Concurrency / compaction / automation", "Параллелизм / сжатие / автоматизация", "设置 → AI 模型", "Settings → AI models", "Настройки → Модели", "spec"],
    ["用量统计 / 会话费用 / 缓存命中", "Usage stats / session cost / cache hit", "Статистика / стоимость / кэш", "设置 + 状态栏", "Settings + status", "Настройки + статус", "ui"],
    ["设置 10 分区（含提示词/技能/MCP/代理/开发者）", "10 settings sections incl. prompts/skills/MCP/proxy/dev", "10 разделов настроек: промпты/навыки/MCP/прокси", "设置模态", "Settings modal", "Окно настроек", "ui"],
    ["写作统计 · 热力图 / 月度趋势 / 全局统计", "Writing activity · heatmap / trend / totals", "Статистика · теплокарта / тренд / итоги", "统计弹窗", "Activity dialog", "Диалог статистики", "ui"],
    ["开发者控制台 7 分区 / 检查更新 / 关于", "Dev console 7 tabs / updates / about", "Консоль 7 вкладок / обновления / о программе", "命令 + 设置", "Command + settings", "Команда + настройки", "spec"],
    ["三语界面 zh-CN / en-US / ru-RU", "Three-language UI", "Трёхъязычный интерфейс", "全局切换", "Global switch", "Глобальный переключатель", "ui"]
  ]}
];

NF.D.backendList = [
  ["章节过渡引擎（前 3 章场景卡片注入）", "Chapter transition engine (last 3 chapter scene cards)", "Движок переходов (карточки 3 глав)"],
  ["角色声音一致性 / 文风学习", "Character voice consistency / style learning", "Единый голос персонажей / обучение стилю"],
  ["多稿对比择优 / 伏笔扫描与回收", "Multi-draft scoring / foreshadowing scan & payoff", "Сравнение черновиков / сканирование намёков"],
  ["后期管线 DAG（入库→剧情→角色→伏笔→声音→文风）", "Post-write DAG pipeline", "Пост-конвейер DAG"],
  ["LLM 向量化 / 本地向量模型四级降级链", "LLM vectorisation / 4-level embedding fallback", "LLM-векторизация / 4 уровня деградации"],
  ["jieba 中文分词 / FTS 索引 / IVF_PQ 索引", "jieba tokenisation / FTS / IVF_PQ index", "jieba / FTS / индекс IVF_PQ"],
  ["AI 记忆三级摘要与失效重建", "Three-level memory summarisation & invalidation", "Трёхуровневые сводки памяти"],
  ["意图预路由 / 工具结果写盘引用 / 自适应压缩", "Intent pre-routing / tool-result file refs / adaptive compaction", "Предмаршрутизация / ссылки на файлы / сжатие"],
  ["Prompt 缓存 / Token 预算 / 安全沙箱与密钥加密", "Prompt cache / token budget / sandbox & safeStorage", "Кэш промптов / бюджет / песочница и ключи"],
  ["双环境日志流 / 保存行为反馈 / 指数退避重试", "Dual log streams / save feedback / retry backoff", "Два потока логов / отзыв о сохранении / ретраи"]
];

/* Sample manuscript source content (Chinese only, like v1). */
NF.D.prose = [
  "潮水退到防波堤以外的时候，林澈才看见那封信。信封压在湿漉漉的石缝里，边缘结着一层细白的盐粒，像谁把海留了一夜。",
  "他本来不该在今天来这里。雾港的规矩写得清楚：涨潮之后，灯塔以西不许有人。可邮戳上是明天的日期，墨迹还没完全干。",
  "「你终于来了。」守塔人没有回头，只把灯罩往下压了压，「它比昨天晚了三分钟。」林澈把信翻过来，背面什么也没有，只有指腹上一点咸味。",
  "沈雁说钥匙在她那里。她没说为什么，也没说那扇门后面有什么。林澈想起第六章末尾递出去的铜钥匙，忽然明白自己一直漏写了那个动作。",
  "远处传来第二声汽笛。雾从海面慢慢立起来，把整座港口折成一张没有写字的纸。"
];

NF.D.blueprints = [
  { chapter: 7, title: ["盐粒与信封", "Salt on the envelope", "Соль на конверте"], goal: ["让那封信改变林澈的选择", "Let the letter change Lin's choice", "Письмо меняет выбор Линя"], conflict: ["明天的邮戳 / 今天的港口", "Tomorrow's postmark / today's harbour", "Завтрашний штемпель / сегодняшний порт"], hook: ["守塔人知道他会来", "The keeper expected him", "Смотритель ждал его"], state: "drafting" },
  { chapter: 8, title: ["逆流的门", "The upstream door", "Дверь против течения"], goal: ["把钥匙交还给沈雁", "Return the key to Shen", "Вернуть ключ Шэнь"], conflict: ["门只在退潮时开启", "The door opens only at low tide", "Дверь открывается в отлив"], hook: ["门后是第七章的原件", "Behind it: the original of chapter 7", "За ней — оригинал седьмой главы"], state: "planned" },
  { chapter: 6, title: ["铜钥匙", "The brass key", "Латунный ключ"], goal: ["完成交接", "Complete the handover", "Завершить передачу"], conflict: ["谁有权开门", "Who may open the door", "Кто вправе открыть дверь"], hook: ["钥匙留下的划痕", "A scratch on the key", "Царапина на ключе"], state: "done" }
];
