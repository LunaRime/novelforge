"use strict";

// UI strings are routed through t(). Manuscripts and fictional research are source content.
const strings = {
  workspace: ["创作空间", "Workspace", "Пространство"],
  overview: ["概览", "Overview", "Обзор"], writing: ["写作", "Writing", "Текст"],
  planning: ["故事规划", "Story planning", "План сюжета"], characters: ["人物与世界", "Cast & world", "Герои и мир"],
  review: ["审阅", "Review", "Рецензия"], library: ["资料库", "Library", "Материалы"], tasks: ["任务中心", "Task center", "Задачи"],
  tokens: ["设计系统", "Design system", "Дизайн-система"], project: ["长篇小说 · 项目原型", "Novel · Demo project", "Роман · Демо"],
  goal: ["今日写作目标", "Daily writing goal", "Цель на сегодня"], words: ["字", "chars", "знаков"],
  demo: ["设计原型 · 仅内存数据", "UI prototype · In-memory only", "Прототип · Только в памяти"],
  command: ["搜索与命令", "Search & commands", "Поиск и команды"], close: ["关闭", "Close", "Закрыть"],
  language: ["切换语言", "Switch language", "Сменить язык"], languageName: ["中文", "EN", "RU"],
  focus: ["专注写作", "Focus mode", "Режим фокуса"], exitFocus: ["退出专注", "Exit focus", "Выйти из фокуса"],
  showAI: ["打开写作搭档", "Open writing partner", "Открыть помощника"], hideAI: ["收起写作搭档", "Hide writing partner", "Скрыть помощника"],
  menu: ["打开导航", "Open navigation", "Открыть навигацию"],
  memory: ["修改仅保留在此页内存，刷新即重置", "Edits live in page memory; reload resets them", "Правки в памяти страницы; обновление сбрасывает их"],
  localReady: ["原型已就绪", "Prototype ready", "Прототип готов"], unsaved: ["编辑待确认 · 仅内存", "Unconfirmed edits · In memory", "Правки не подтверждены · В памяти"],
  saved: ["已确认 · 仅内存", "Confirmed · In memory", "Подтверждено · В памяти"], confirm: ["确认编辑", "Confirm edits", "Подтвердить правки"],
  confirmed: ["已确认本次编辑；未写入文件或数据库", "Edits confirmed; no file or database was written", "Правки подтверждены; файлы и БД не изменены"],
  outline: ["章节目录", "Chapters", "Главы"], searchChapters: ["查找章节…", "Find a chapter…", "Найти главу…"],
  volume1: ["第一卷 · 雾的边界", "Vol. I · Edge of the fog", "Том I · Граница тумана"],
  volume2: ["第二卷 · 逆流之城", "Vol. II · The upstream city", "Том II · Город против течения"],
  draft: ["正文", "Manuscript", "Рукопись"], blueprint: ["蓝图", "Blueprint", "План главы"], versions: ["版本", "Versions", "Версии"],
  drafting: ["写作中", "In progress", "В работе"], done: ["已定稿", "Finalized", "Завершено"], planned: ["待创作", "Planned", "Запланировано"],
  chapterLabel: ["第 {n} 章", "Chapter {n}", "Глава {n}"], act2: ["第二幕 / 真相的裂缝", "Act II / A fracture in truth", "Акт II / Трещина в правде"],
  act1: ["第一幕 / 信的来处", "Act I / Where the letter began", "Акт I / Истоки письма"],
  reading: ["约 {n} 分钟阅读", "~{n} min read", "~{n} мин чтения"], pov: ["视角", "POV", "Точка зрения"],
  currentDraft: ["当前草稿", "Current draft", "Текущий черновик"], autoNote: ["原型可编辑；切页保留，刷新重置", "Editable demo; navigation keeps edits, reload resets", "Правки сохраняются при переходе, не при обновлении"],
  draftHint: ["写下去，故事会找到它的岸。", "Keep writing. The story will find its shore.", "Пишите дальше. История найдёт свой берег."],
  binderHint: ["先找到这一章的情绪，再找到它的结尾。", "Find the emotion of this chapter before its ending.", "Найдите чувство главы прежде её финала."],
  partner: ["写作搭档", "Writing partner", "Помощник автора"], suggestions: ["建议", "Suggestions", "Советы"], context: ["上下文", "Context", "Контекст"],
  connectedContext: ["已引用 3 项故事上下文", "3 story references included", "3 источника контекста"],
  partnerTitle: ["让悬念留在字里，\n而不是说明里。", "Let the words carry\nthe mystery.", "Пусть загадка живёт\nмежду строк."],
  partnerIntro: ["这章的氛围已经很完整。我留意到两处可以更有力量的地方，供你决定。", "The atmosphere is strong. Here are two editorial notes for you to consider.", "Атмосфера уже выразительна. Вот два замечания — решение за вами."],
  pacing: ["节奏建议", "Pacing note", "Ритм"], noteTitle: ["让“发现”替代“解释”", "Reveal rather than explain", "Покажите, не объясняйте"],
  noteBody: ["第三段直接交代了信封的来历。试着留下一个可见的细节，让读者和林澈一起猜。", "The third paragraph explains the letter. A concrete detail could let the reader discover it with Lin.", "Третий абзац объясняет письмо. Деталь позволит читателю догадаться вместе с Линем."],
  continuity: ["连续性提醒", "Continuity note", "Последовательность"], continuityTitle: ["铜钥匙还在谁手里？", "Who has the brass key?", "У кого латунный ключ?"],
  continuityBody: ["第六章末尾，钥匙交给了沈雁。这里可以补一个取回的动作，或让她来开门。", "At the end of chapter 6, Shen holds the key. Add a handover, or let her open the door.", "В конце главы 6 ключ у Шэнь. Добавьте передачу ключа или поручите ей открыть дверь."],
  viewRewrite: ["查看改写", "Preview rewrite", "Посмотреть правку"], dismiss: ["暂不采纳", "Dismiss", "Отклонить"],
  openReference: ["查看人物档案", "Open character profile", "Открыть героя"], proposal: ["建议文本 · 尚未写入正文", "Proposed text · Not applied", "Предложение · Не применено"],
  applied: ["已采纳到内存草稿", "Applied to in-memory draft", "Применено к черновику в памяти"],
  noNotes: ["建议已处理。继续写作，或提出一个新问题。", "Notes resolved. Keep writing or ask a question.", "Замечания обработаны. Продолжайте или задайте вопрос."],
  noteDeferred: ["节奏建议已暂缓，仍可在审阅中决定。", "Pacing note deferred; you can still decide in Review.", "Замечание о ритме отложено; решение доступно в рецензии."],
  ask: ["一起打磨这一段，或问一个故事问题…", "Refine a passage, or ask about your story…", "Уточните фрагмент или задайте вопрос о сюжете…"],
  send: ["发送示例问题", "Send demo prompt", "Отправить демо-запрос"], attachContext: ["查看引用上下文", "View references", "Посмотреть источники"],
  modelDemo: ["本地演示", "Local demo", "Локальное демо"], aiDemo: ["固定示例回复 · 未连接模型", "Scripted response · No model connected", "Демо-ответ · Модель не подключена"],
  aiAnswer: ["可以把线索藏进动作：让林澈先摸到信封边缘的盐粒，再意识到它来自海上。这里是固定演示回复，不会自动改动正文。", "Try hiding the clue in an action: Lin feels salt on the envelope before realizing it came from the sea. This is a scripted demo, not an automatic edit.", "Спрячьте улику в действии: Линь замечает соль на конверте и понимает, что он прибыл с моря. Это демо-ответ, рукопись не меняется."],
  emptyPrompt: ["请先输入一个问题", "Enter a question first", "Сначала введите вопрос"],
  references: ["本次引用", "Included references", "Источники"], profile: ["人物档案", "Character profile", "Профиль героя"],
  worldRule: ["世界规则", "World rule", "Правила мира"], chapterBlueprint: ["章节蓝图", "Chapter blueprint", "План главы"],
  contextNote: ["真实接入时，引用将绑定项目会话与文档版本，避免跨项目旧结果。", "In production, references must bind to project sessions and document versions.", "В приложении источники привязываются к сессии проекта и версии документа."],
  welcome: ["今天，也给故事留一点时间。", "Make a little room for your story today.", "Оставьте сегодня немного времени истории."],
  overviewDesc: ["从上次停下的地方开始，不必从头寻找。", "Pick up where you left off.", "Продолжите с того места, где остановились."],
  novelTag: ["悬疑 · 近未来 · 12 万字计划", "Mystery · Near future · 120k-char target", "Тайна · Ближнее будущее · План 120 тыс."],
  novelSynopsis: ["一座被雾隔绝的海港，一封写着明天日期的信。林澈沿着潮汐留下的线索，寻找一段被整座城市遗忘的过去。", "A fogbound harbor. A letter dated tomorrow. Lin follows the tides toward a past the city has forgotten.", "Порт за туманом. Письмо с завтрашней датой. Линь идёт по следам прилива к забытому прошлому города."],
  continueWriting: ["继续写第七章", "Continue chapter seven", "Продолжить главу 7"],
  totalWords: ["累计正文", "Manuscript length", "Объём рукописи"], finalized: ["定稿章节", "Finalized chapters", "Завершённые главы"],
  projectProgress: ["创作进度", "Project progress", "Прогресс"], targetWords: ["目标 120,000 字", "Target: 120,000 chars", "Цель: 120 000 знаков"],
  recent: ["最近打开", "Recently opened", "Недавнее"], allChapters: ["全部章节", "All chapters", "Все главы"],
  nextStep: ["接下来", "Up next", "Далее"], finishChapter: ["完成第七章的转折", "Finish chapter 7's turn", "Завершить поворот главы 7"],
  finishChapterDesc: ["让那封信改变林澈的选择，而不只是增加一个谜。", "Let the letter change Lin's choice, not just add a mystery.", "Пусть письмо меняет выбор Линя, а не просто добавляет загадку."],
  reviewTask: ["审阅第一卷连续性", "Review volume I continuity", "Проверить непрерывность тома I"],
  reviewTaskDesc: ["1 条线索衔接建议等待确认", "1 continuity note awaiting approval", "1 замечание ожидает решения"],
  worldTask: ["补全雾港的时间规则", "Complete the harbor's time rules", "Уточнить правила времени порта"],
  worldTaskDesc: ["已有设定，可从人物与世界进入", "Open the existing world notes", "Открыть существующие заметки о мире"],
  planningDesc: ["把结构放在眼前，让每一章都有自己的任务。", "Give every chapter a purpose.", "Дайте каждой главе свою задачу."],
  structure: ["故事结构", "Story structure", "Структура"], board: ["章节看板", "Chapter board", "Доска глав"],
  addBlueprint: ["新建蓝图", "New blueprint", "Новый план"], filter: ["筛选蓝图…", "Filter blueprints…", "Фильтр планов…"],
  act1Name: ["信的来处", "The letter's origin", "Истоки письма"], act2Name: ["真相的裂缝", "A fracture in truth", "Трещина в правде"],
  act3Name: ["潮汐之后", "After the tide", "После прилива"], act1Range: ["01—04 章 · 建立谜题", "Ch. 01–04 · The mystery", "Главы 01–04 · Загадка"],
  act2Range: ["05—09 章 · 改变选择", "Ch. 05–09 · The choice", "Главы 05–09 · Выбор"],
  act3Range: ["10—12 章 · 兑现线索", "Ch. 10–12 · The reveal", "Главы 10–12 · Разгадка"],
  sceneGoal: ["本章目标", "Chapter purpose", "Задача главы"], conflict: ["核心冲突", "Core conflict", "Конфликт"],
  ending: ["结尾钩子", "Ending hook", "Финальный крючок"], participants: ["登场人物", "Cast", "Участники"],
  openManuscript: ["打开正文", "Open manuscript", "Открыть рукопись"], cancel: ["取消", "Cancel", "Отмена"],
  create: ["创建示例蓝图", "Create demo blueprint", "Создать демо-план"], title: ["标题", "Title", "Заголовок"],
  requiredTitle: ["请填写标题", "A title is required", "Укажите заголовок"], created: ["示例蓝图已加入规划；仅保留在内存中", "Demo blueprint added to planning; memory only", "Демо-план добавлен; только в памяти"],
  characterDesc: ["人物不是资料卡。他们的选择，才是故事的结构。", "A story is shaped by its characters' choices.", "Историю формируют решения героев."],
  cast: ["人物", "Characters", "Герои"], world: ["世界设定", "World notes", "Мир"], protagonist: ["主角 · 档案已建立", "Protagonist · Profile ready", "Главный герой · Профиль готов"],
  supporting: ["关键配角 · 档案已建立", "Supporting · Profile ready", "Второй план · Профиль готов"],
  antagonist: ["对立角色 · 档案已建立", "Antagonist · Profile ready", "Противник · Профиль готов"],
  motivation: ["内在动机", "Motivation", "Мотивация"], weakness: ["性格裂缝", "Inner conflict", "Слабость"],
  currentState: ["当前状态 · 第七章", "Current state · Chapter 7", "Состояние · Глава 7"],
  arc: ["人物弧线", "Character arc", "Арка героя"], relations: ["人物关系", "Relationships", "Связи"],
  related: ["关联章节", "Related chapters", "Связанные главы"],
  libraryDesc: ["资料有出处，灵感有归处。", "Sources for research. A home for ideas.", "Источники для фактов. Дом для идей."],
  searchLibrary: ["搜索资料标题或内容…", "Search titles or content…", "Поиск по названию или тексту…"],
  import: ["导入资料", "Import", "Импорт"], name: ["资料名称", "Document", "Материал"], kind: ["类型", "Type", "Тип"],
  relatedUse: ["引用于", "Referenced by", "Используется"], updated: ["更新时间", "Updated", "Обновлено"],
  research: ["研究资料", "Research", "Исследование"], setting: ["设定笔记", "World note", "Заметка о мире"],
  clip: ["灵感片段", "Inspiration", "Идея"], source: ["来源", "Source", "Источник"],
  demoImport: ["此版只演示界面，不读取或上传真实文件。正式导入沿用现有应用用例。", "This UI demo does not read or upload files. Production import uses existing application commands.", "Демо не читает и не загружает файлы. Импорт использует существующие команды приложения."],
  reviewDesc: ["看清每一次改动，再决定故事往哪里走。", "See each change before deciding where the story goes.", "Изучите каждую правку и решите, куда ведёт история."],
  pendingReview: ["{n} 条建议待决定", "{n} proposals pending", "Ожидают решения: {n}"],
  baseline: ["原稿 v1 → 编辑建议", "Draft v1 → Editorial proposal", "Черновик v1 → Предложение"],
  accept: ["采纳", "Accept", "Принять"], reject: ["拒绝", "Reject", "Отклонить"],
  reviewSummary: ["审阅摘要", "Review summary", "Итоги рецензии"],
  reviewSummaryBody: ["聚焦两件事：减少解释性句子，补齐钥匙的交接。逐条决策，不用整章覆盖。", "Focus on two things: less exposition and a clear key handover. Decide per change, not by replacing the chapter.", "Меньше объяснений и явная передача ключа. Решайте по каждой правке, не заменяя главу целиком."],
  safety: ["你的原稿始终保留", "Your original is retained", "Оригинал сохраняется"],
  safetyBody: ["采纳仅改变演示内存草稿。可在“版本”里查看初稿并确认恢复；真实接入需保留撤销与冲突检测。", "Acceptance only changes the in-memory demo. Restore the initial text from Versions. Production must retain undo and conflict checks.", "Принятие меняет только демо-черновик. Оригинал доступен в версиях. В приложении нужны отмена и проверка конфликтов."],
  accepted: ["已采纳", "Accepted", "Принято"], rejected: ["已拒绝", "Rejected", "Отклонено"],
  conflictError: ["原文已变化，不能直接应用此建议。请保留当前编辑并重新审阅。", "The original changed. Keep your edits and review a fresh proposal.", "Исходный текст изменён. Сохраните правки и проверьте новое предложение."],
  taskDesc: ["AI 做了什么、准备做什么，都在这里说清楚。", "Know what AI has done, and what it wants to do next.", "Знайте, что ИИ сделал и что намерен сделать."],
  approvalTitle: ["有一项操作需要你的决定", "One action needs your approval", "Одно действие требует решения"],
  approvalBody: ["第一卷连续性校检已完成，产出 1 条修改建议。尚未写入任何正文。", "Volume I continuity review produced one proposal. No manuscript has been changed.", "Проверка тома I создала одно предложение. Рукопись не изменена."],
  viewResult: ["查看结果", "View result", "Открыть результат"],
  taskName: ["任务", "Task", "Задача"], state: ["状态", "Status", "Состояние"], scope: ["作用范围", "Scope", "Область"],
  pending: ["待你确认", "Awaiting approval", "Ожидает решения"], completed: ["已完成", "Completed", "Завершено"],
  cancelled: ["已取消", "Cancelled", "Отменено"], task1: ["第一卷连续性校检", "Volume I continuity review", "Проверка тома I"],
  task2: ["人物档案提取", "Character extraction", "Извлечение героев"], task3: ["第八章蓝图生成", "Chapter 8 blueprint", "План главы 8"],
  taskScope1: ["第 01—07 章 · 只读分析", "Chapters 01–07 · Read-only", "Главы 01–07 · Только чтение"],
  taskScope2: ["3 位人物 · 示例记录", "3 characters · Demo data", "3 героя · Демо"],
  taskScope3: ["第八章 · 未写入", "Chapter 8 · Not written", "Глава 8 · Не записано"],
  approvalModal: ["查看连续性校检结果", "Continuity review result", "Результат проверки"],
  permissionNote: ["校检结果本身不等于已保存正文。此按钮仅打开审阅，不自动采纳任何修改。", "A result is not a saved manuscript. This button opens review without accepting changes.", "Результат не равен сохранённой рукописи. Кнопка открывает рецензию, не применяя правки."],
  goReview: ["去审阅建议", "Review proposals", "Проверить предложения"],
  versionTitle: ["正文版本", "Manuscript versions", "Версии рукописи"], initialVersion: ["初稿 v1 · 原型基线", "Initial v1 · Demo baseline", "Версия v1 · База демо"],
  initialVersionBody: ["此版本只读，用于展示回溯路径。当前编辑保留在页面内存。", "Read-only baseline. Current edits remain in page memory.", "Исходная версия доступна только для чтения. Правки находятся в памяти страницы."],
  restore: ["恢复此版本", "Restore version", "Восстановить"], restoreTitle: ["恢复初稿？", "Restore the initial draft?", "Восстановить исходник?"],
  restoreBody: ["将替换本章当前的内存草稿。替换前会保留一份内存备份，可再次恢复。不会修改项目文件。", "This replaces this chapter's in-memory draft. A memory backup is retained first. Project files are unaffected.", "Черновик в памяти будет заменён. Перед заменой создаётся резерв в памяти. Файлы проекта не меняются."],
  restored: ["已恢复初稿，当前编辑已保留为内存备份", "Initial draft restored; edits retained in a memory backup", "Исходник восстановлен; правки сохранены в резерве памяти"],
  backup: ["恢复前备份 · 仅内存", "Pre-restore backup · In memory", "Резерв до восстановления · В памяти"],
  restoreBackup: ["取回恢复前的编辑", "Recover pre-restore edits", "Вернуть предыдущие правки"],
  backupRecovered: ["已取回恢复前的编辑", "Pre-restore edits recovered", "Предыдущие правки возвращены"],
  rewriteTitle: ["确认局部改写", "Confirm a local rewrite", "Подтвердить правку"], original: ["原文", "Original", "Оригинал"],
  replacement: ["建议改写", "Proposed rewrite", "Предложенная правка"], applyRewrite: ["采纳到内存草稿", "Apply to memory draft", "Применить к черновику"],
  rewriteGuard: ["只替换这一句。原文不匹配时不会覆盖；不访问真实模型或项目数据。", "Only this sentence is replaced. A changed source blocks application. No model or project data is accessed.", "Заменяется лишь это предложение. Изменённый исходник блокирует правку. Модель и данные проекта не используются."],
  tokenDesc: ["一套安静、可组合、能落地的视觉语言。", "A quiet, composable visual language.", "Спокойный, гибкий визуальный язык."],
  tokenProposal: ["提案 v1 · 浅色主题", "Proposal v1 · Light theme", "Предложение v1 · Светлая тема"],
  colors: ["01 / 语义色彩", "01 / Semantic color", "01 / Семантика цвета"], typography: ["02 / 字体与阅读", "02 / Type & reading", "02 / Типографика"],
  scale: ["03 / 间距与形状", "03 / Spacing & shape", "03 / Интервалы и формы"], components: ["04 / 控件与状态", "04 / Controls & states", "04 / Элементы и состояния"],
  canvasColor: ["画布", "Canvas", "Холст"], paperColor: ["正文纸面", "Manuscript", "Бумага"], inkColor: ["标题与正文", "Ink", "Текст"],
  brandColor: ["主操作", "Primary action", "Основное действие"], brandSoftColor: ["选中与采纳", "Selected / accepted", "Выбрано / принято"],
  accentColor: ["编辑批注", "Editorial note", "Замечание"], lineColor: ["结构分隔", "Divider", "Разделитель"], mutedColor: ["次要信息", "Secondary text", "Вторичный текст"],
  warningColor: ["待确认", "Pending", "Ожидание"], dangerColor: ["失败与删除", "Error / destructive", "Ошибка / удаление"],
  infoColor: ["引用信息", "References", "Источники"], surfaceColor: ["控件表面", "Control surface", "Поверхность"],
  colorNote: ["主操作跟随配色主题；成功保持绿色、待确认保持琥珀色、错误保持红色。颜色不替代文字状态，明暗均使用语义令牌。", "Primary actions follow the palette. Success stays green, approval amber, errors red. Always include a text label; both modes use semantic tokens.", "Основные действия следуют палитре. Успех зелёный, ожидание янтарное, ошибка красная. Цвет сопровождается текстом в обоих режимах."],
  uiType: ["界面 / Inter + 思源黑体", "UI / Inter + Noto Sans SC", "Интерфейс / Inter + Noto Sans SC"],
  writingType: ["正文 / 思源宋体", "Writing / Noto Serif SC", "Рукопись / Noto Serif SC"],
  writingSample: ["潮水从不解释自己的来处。", "The tide never explains where it came from.", "Прилив не объясняет, откуда он пришёл."],
  typeNote: ["界面 13–14px，正文 17px / 2.15 行高，章标题 28px。界面与正文分工明确，不把小说排成代码。", "UI: 13–14px. Writing: 17px / 2.15. Chapter title: 28px. Manuscripts should not look like code.", "Интерфейс: 13–14px. Рукопись: 17px / 2,15. Заголовок: 28px. Роман не должен выглядеть как код."],
  spacingNote: ["4px 基础单位；卡片 10px 圆角，控件 6px 圆角。桌面目标 36px，窄屏触控 44px。正文最大宽度 660px。", "4px base. Cards: 10px radius; controls: 6px. Targets: 36px desktop / 44px touch. Manuscript max: 660px.", "Шаг 4px. Радиус: карточки 10px, кнопки 6px. Цели: 36px / 44px. Ширина рукописи: 660px."],
  primaryAction: ["主要操作", "Primary action", "Основное действие"], secondaryAction: ["次要操作", "Secondary action", "Вторичное действие"],
  quietAction: ["轻量操作", "Quiet action", "Тихое действие"], savedSpecimen: ["正文已保存", "Manuscript saved", "Рукопись сохранена"],
  errorSpecimen: ["保存失败 · 输入保留", "Save failed · Edits retained", "Ошибка · Правки сохранены"],
  layerNote: ["7 级语义层级；弹窗使用浏览器顶层。可见焦点、Esc 退出、焦点返回，尊重减少动效设置。", "7 semantic stacking levels. Dialogs use the top layer, visible focus, Escape and focus restoration. Reduced motion is respected.", "7 уровней. Диалоги в верхнем слое, видимый фокус, Escape и возврат фокуса. Поддержка уменьшения анимации."],
  downloadCSS: ["查看 CSS 令牌", "Open CSS tokens", "Открыть CSS"], downloadJSON: ["查看 JSON 令牌", "Open JSON tokens", "Открыть JSON"],
  projectModal: ["当前示例项目", "Current demo project", "Текущий демо-проект"],
  projectModalBody: ["本版使用虚构的《雾海来信》来呈现完整写作流程。没有连接真实项目、数据库、文件或 AI。", "This proposal uses the fictional novel Letters from the Fog. No real project, database, file or AI connection is made.", "Прототип использует вымышленный роман. Реальные проекты, файлы, БД и ИИ не подключены."],
  previewNote: ["界面行为为演示，不代表后端已接入", "UI behavior is a demo, not a backend integration", "Поведение интерфейса — демо, не подключение сервера"],
  noResults: ["没有匹配内容", "No matches", "Нет совпадений"], searchCommands: ["输入页面、章节或操作…", "Search pages, chapters or actions…", "Найти страницу, главу или действие…"],
  noWriting: ["这章尚未开始。在下面写下第一句。", "This chapter is unwritten. Start with a first sentence.", "Глава ещё не написана. Начните с первого предложения."],
  localOnly: ["仅内存", "Memory only", "В памяти"], worldDesc: ["雾不是天气，而是这座城市对记忆的选择。", "The fog is not weather. It is the city's choice about memory.", "Туман — не погода. Это выбор города о памяти."],
  relationAlly: ["同盟 / 隐瞒着共同的过去", "Ally / A hidden shared past", "Союзник / Скрытое общее прошлое"],
  relationOpposed: ["对立 / 线索的掌控者", "Opposed / Controls the clues", "Противник / Контролирует улики"],
  unitReference: ["{n} 处引用", "{n} references", "Ссылок: {n}"],
  tokenBtnDemo: ["控件示例；不执行真实操作", "Control specimen; no real action", "Образец элемента; без действия"],
  desktopPreview: ["桌面程序 · 交互设计预览", "Desktop app · Interactive preview", "Приложение · Интерактивный прототип"],
  stageNote: ["此处是评审页；下方窗口才是 NovelForge 程序界面。", "This is the review page; the window below is NovelForge.", "Это страница просмотра; окно ниже — NovelForge."],
  appearance: ["外观", "Appearance", "Оформление"], appearanceTitle: ["让工作台成为你的空间", "Make this space yours", "Ваше пространство"],
  appearanceNote: ["实时预览，不打断正文编辑。", "Live preview, without interrupting your draft.", "Предпросмотр без потери правок."],
  lightMode: ["浅色", "Light", "Светлый"], darkMode: ["暗色", "Dark", "Тёмный"], modeLabel: ["明暗模式", "Mode", "Режим"],
  paletteLabel: ["颜色主题", "Color palette", "Палитра"], moss: ["苔绿", "Moss", "Мох"], ocean: ["海蓝", "Ocean", "Океан"], plum: ["暮紫", "Plum", "Слива"], amber: ["麦金", "Amber", "Янтарь"],
  paletteNote: ["配色与明暗独立切换。成功、待确认和错误仍有各自的语义色。", "Palette and mode are independent. Success, approval and errors retain their semantic colors.", "Палитра и режим независимы. Успех, ожидание и ошибки сохраняют свои цвета."],
  backgroundLabel: ["程序背景", "App background", "Фон приложения"], noBackground: ["纯色", "Solid", "Без фона"], mist: ["雾色", "Mist", "Туман"], dusk: ["晚霞", "Dusk", "Сумерки"],
  chooseImage: ["选择本地图片", "Choose a local image", "Выбрать изображение"], imageHint: ["JPG / PNG / WebP · 最大 12 MB", "JPG / PNG / WebP · Up to 12 MB", "JPG / PNG / WebP · До 12 МБ"],
  imagePrivacy: ["图片只在本页内存预览，不上传、不保存；刷新后重置。", "Your image stays in page memory. No upload or persistence; reload resets it.", "Изображение только в памяти страницы. Без загрузки и сохранения; обновление сбрасывает его."],
  removeImage: ["移除图片", "Remove image", "Удалить изображение"], useImage: ["使用此图片", "Use this image", "Применить изображение"],
  imageLoaded: ["图片已应用到程序背景；仅在本页预览", "Image applied to app background; page preview only", "Изображение применено к фону; только в этой странице"],
  imageInvalid: ["请选择不超过 12 MB 的有效 JPG、PNG 或 WebP 图片。原背景未改变。", "Choose a valid JPG, PNG or WebP up to 12 MB. The previous background is unchanged.", "Выберите JPG, PNG или WebP до 12 МБ. Предыдущий фон не изменён."],
  imageStrength: ["图片强度", "Image strength", "Интенсивность"], imageBlur: ["背景模糊", "Blur", "Размытие"], surfaceOpacity: ["侧栏遮罩", "Panel opacity", "Плотность панелей"],
  imageFit: ["图片适配", "Image fit", "Масштабирование"], imageCover: ["铺满窗口", "Cover window", "Заполнить окно"], imageContain: ["完整显示", "Show entire image", "Показать целиком"],
  imagePosition: ["垂直位置", "Vertical position", "Положение по вертикали"],
  paperProtected: ["正文纸面保留 97% 遮罩，阅读不被背景干扰。", "The manuscript retains 97% opacity for comfortable reading.", "Рукопись сохраняет плотность 97% для удобного чтения."],
  resetAppearance: ["重置外观", "Reset", "Сбросить"], appearanceReset: ["外观已重置，正文编辑仍保留", "Appearance reset; your draft is intact", "Оформление сброшено; правки сохранены"],
  minimizeWindow: ["最小化演示窗口", "Minimize demo window", "Свернуть демо-окно"], maximizeWindow: ["最大化演示窗口", "Expand demo window", "Развернуть демо-окно"], restoreWindow: ["恢复演示窗口", "Restore demo window", "Восстановить демо-окно"], closeWindow: ["关闭演示窗口", "Close demo window", "Закрыть демо-окно"],
  windowMinimized: ["程序窗口已最小化", "Window minimized", "Окно свёрнуто"], windowClosed: ["演示窗口已关闭", "Demo window closed", "Демо-окно закрыто"], windowKept: ["只是界面演示，正文与外观仍在内存中。", "UI simulation only. Your draft and appearance stay in memory.", "Только демонстрация. Правки и оформление остаются в памяти."],
  frameFooter: ["独立程序窗口 / 编辑与外观仅内存 / 无真实项目写入", "App window / In-memory draft & appearance / No project writes", "Окно приложения / Правки и оформление в памяти / Без записи"],
  multiThemeProposal: ["提案 v1.1 · 4 配色 × 明暗双模式", "Proposal v1.1 · 4 palettes × 2 modes", "Версия v1.1 · 4 палитры × 2 режима"]
};
const locales = ["zh-CN", "en-US", "ru-RU"];
let localeIndex = 0;
function t(key, values = {}) {
  if (!strings[key]) throw new Error(`Missing UI translation: ${key}`);
  return strings[key][localeIndex].replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""));
}
const e = (value) => String(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const iconPaths = {
  overview: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  writing: '<path d="m15 4 5 5M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15l-1 5Z"/><path d="M13 21h8"/>',
  planning: '<path d="M4 5h16M4 12h16M4 19h16"/><circle cx="8" cy="5" r="2"/><circle cx="15" cy="12" r="2"/><circle cx="10" cy="19" r="2"/>',
  characters: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6M18 15a5 5 0 0 1 3 4v2"/>',
  review: '<path d="M8 3H5v18h14V3h-3M9 2h6v4H9zM8 12l2 2 5-5M8 18h8"/>',
  library: '<path d="M3 4h5v16H3zM10 4h5v16h-5zM17 5l4-1 3 16-4 1zM3 8h5M10 8h5"/>',
  tasks: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m6 9 1 1 2-2M12 9h5m-11 6 1 1 2-2M12 15h5"/>',
  tokens: '<path d="m12 2 9 5-9 5-9-5 9-5ZM3 12l9 5 9-5M3 17l9 5 9-5"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>', down: '<path d="m6 9 6 6 6-6"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>', plus: '<path d="M12 5v14M5 12h14"/>',
  arrow: '<path d="M4 12h16m-6-6 6 6-6 6"/>', up: '<path d="M12 20V4m-6 6 6-6 6 6"/>',
  focus: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  ai: '<path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3ZM20 2v4m-2-2h4"/>',
  check: '<path d="m5 12 4 4L19 6"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  file: '<path d="M14 2H5v20h14V7l-5-5Zm0 0v5h5M8 12h8M8 16h6"/>',
  book: '<path d="M12 5c-3-2-6-2-9-1v16c3-1 6-1 9 1m0-16c3-2 6-2 9-1v16c-3-1-6-1-9 1V5Z"/>',
  link: '<path d="m9 15 6-6m-7 8-1 1a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m0 0 1-1a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0"/>',
  shield: '<path d="M12 2 3 6v6c0 5 9 10 9 10s9-5 9-10V6l-9-4Z"/><path d="m8 12 3 3 5-6"/>',
  alert: '<path d="m12 3 10 18H2L12 3ZM12 9v5m0 3v.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>', dots: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  history: '<path d="M3 11a9 9 0 1 1 3 8M3 4v7h7M12 7v5l3 2"/>',
  note: '<path d="M4 3h16v14l-4 4H4V3Zm12 18v-4h4M8 8h8M8 12h5"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  moon: '<path d="M20 14.5A9 9 0 0 1 9.5 4a9 9 0 1 0 10.5 10.5Z"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 6-6 4 4 3-3 5 5"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18h1a2 2 0 0 0 0-4h-1a2 2 0 0 1 0-4h4a5 5 0 0 0 0-10h-4Z"/><circle cx="7" cy="9" r=".8"/><circle cx="10" cy="6" r=".8"/><circle cx="6" cy="13" r=".8"/><circle cx="15" cy="6" r=".8"/>',
  minimize: '<path d="M5 16h14"/>', maximize: '<rect x="5" y="5" width="14" height="14" rx="1"/>', restore: '<path d="M8 5V3h13v13h-2M3 8h13v13H3z"/>'
};
const icon = (name, small = false) => `<svg class="icon${small ? " small" : ""}" viewBox="0 0 24 24" aria-hidden="true">${iconPaths[name] || iconPaths.file}</svg>`;
const btn = (key, action, name = "", css = "") => `<button class="button ${css}" data-action="${action}">${name ? icon(name, true) : ""}${e(t(key))}</button>`;
const ib = (key, action, name, active = false) => `<button class="icon-button${active ? " is-on" : ""}" aria-label="${e(t(key))}" title="${e(t(key))}" data-action="${action}">${icon(name)}</button>`;
const badge = (key, css = "", values = {}) => `<span class="pill ${css}">${e(t(key, values))}</span>`;
const navPages = ["overview", "writing", "planning", "characters", "review", "library", "tasks"];
const paragraphSource = [
  "雾是在凌晨四点漫上来的。先是港口的灯塔，接着是沿海街道的路牌，最后，连窗外那株歪斜的榕树也只剩下一团模糊的影子。林澈站在窗前，看着城市一点一点隐去轮廓。",
  "楼下传来邮差的铃声。这不合常理。雾港的邮差只在午后出门，而此刻，整条街道还沉在睡梦里。他披上外套，下楼时没有开灯。",
  "信封来自那艘三年前沉没的船。这件事让他感到十分惊讶。没有邮戳，没有寄件人，只有收信处写着他的名字。字迹很轻，像是写信的人怕惊动什么。",
  "他翻过信封。背面贴着一片干枯的银杏叶，叶脉里夹着细细的盐粒。那是秋天才有的叶子。可雾港已经有三年没有过秋天了。",
  "“你也收到了？”沈雁的声音从身后传来。她站在楼梯转角，手里握着另一封信。两个人都没有继续说话，只有墙上的钟还在走。",
  "林澈把信封揣进外套内袋。纸面贴着胸口，微微发凉。他拿起铜钥匙，打开了门。街道深处的雾忽然分开了一线，像有人在另一头拉开了一扇帘。",
  "远处的灯塔闪了三下。两短，一长。这是他们小时候约好的信号：不要相信你看见的海。"
];
const chapters = [
  {id:1,title:"没有地址的信",status:"done",volume:1,words:2860,goal:"让林澈收到第一封来自未来的信。",text:["林澈第一次看见那封信，是在一场没有声音的雨里。邮差把它放在窗台上，没有按铃，也没有留下脚印。", "信纸上的日期，是明天。"]},
  {id:2,title:"灯塔熄灭以后",status:"done",volume:1,words:3120,goal:"建立灯塔与城市记忆之间的关系。",text:["灯塔在午夜熄灭了。城里的人第二天醒来，都不记得海是什么颜色。", "只有沈雁记得。她在笔记本上画了一条蓝色的线。"]},
  {id:3,title:"失踪者的房间",status:"done",volume:1,words:2950,goal:"发现三年前失踪者留下的房间。",text:["房间比林澈想象的干净。床铺整齐，水杯里甚至还有半杯温水。", "桌上的日历停在三年前。"]},
  {id:4,title:"雾中的渡船",status:"done",volume:1,words:2840,goal:"找到进入雾区的方式。",text:["渡船每个星期只出现一次，没有人知道它从哪里来。", "船上的乘客都闭着眼睛，像在等待一个迟到的梦。"]},
  {id:5,title:"记忆的背面",status:"done",volume:1,words:3210,goal:"揭示林澈的记忆也存在缺口。",text:["他在旧照片里看见了自己。照片的背面，却写着另一个人的名字。", "沈雁把照片转过来，指尖停在右下角的日期上。"]},
  {id:6,title:"钥匙与守门人",status:"done",volume:1,words:3380,goal:"让沈雁获得铜钥匙。",text:["守门人把铜钥匙交给沈雁的时候，钟楼正好敲了十二下。", "“下一次开门，”他说，“你们会忘掉一个名字。”"]},
  {id:7,title:"潮汐带来的回信",status:"drafting",volume:1,words:0,goal:"让来自沉船的信迫使林澈在追寻真相与保护沈雁之间做出选择。",text:paragraphSource},
  {id:8,title:"城里没有星期三",status:"planned",volume:2,words:0,goal:"用消失的星期三揭示雾港的时间规则。",text:[]},
  {id:9,title:"被遗忘的人",status:"planned",volume:2,words:0,goal:"揭示沈雁与失踪者的关系。",text:[]}
];
const people = [
  {name:"林澈",initial:"澈",tone:"",role:"protagonist",quote:"“如果记忆也会说谎，我该相信什么？”",motivation:"找到失踪的父亲，并证明自己的记忆没有被改写。",weakness:"习惯用事实替代情感，却无法解释自己对沈雁的信任。",currentState:"收到来自三年前沉船的信。怀疑自己的调查早已被人安排。",arc:"从依赖记录的旁观者，成为愿意承担选择后果的人。"},
  {name:"沈雁",initial:"雁",tone:"clay",role:"supporting",quote:"“有些事，不记得才是代价。”",motivation:"保护林澈，同时守住与灯塔有关的秘密。",weakness:"把保护误认成隐瞒，因此逐渐失去对方的信任。",currentState:"保管铜钥匙，也收到一封信。准备承认自己曾登上那艘船。",arc:"从替别人决定，转向允许彼此共同承担真相。"},
  {name:"顾舟",initial:"舟",tone:"blue",role:"antagonist",quote:"“城市只记得它被允许记得的事。”",motivation:"维持雾港的秩序，避免被封存的事故再次发生。",weakness:"相信一切损失都可以被计算，忽略了人对记忆的依恋。",currentState:"发现林澈正在调查沉船，决定主动交出一条真假混杂的线索。",arc:"从秩序的维护者，面对自己也是被改写者的事实。"}
];
const resources = [
  {title:"潮汐与沿海气候笔记",kind:"research",use:4,date:"11 / 09",source:"虚构研究资料 · 界面示例",body:"半日潮常见于港口环境。可将涨落潮作为章节节奏的隐喻，而非直接解释世界规则。"},
  {title:"雾港时间规则",kind:"setting",use:7,date:"11 / 10",source:"作者设定笔记 · 虚构",body:"雾出现时，城市会遗失一段共同记忆。灯塔的信号是唯一没有被改写的时间锚点。"},
  {title:"旧邮政档案的语言风格",kind:"research",use:2,date:"11 / 07",source:"虚构风格资料 · 界面示例",body:"短句、地点缩写、编号，以及反复出现的“投递未果”。通过文本形式让线索可信。"},
  {title:"那些没有寄出的句子",kind:"clip",use:1,date:"11 / 08",source:"作者灵感片段 · 虚构",body:"“潮水替我回了信，而我从来没有写过。” 可用于卷末回扣。"}
];
const proposals = [
  {old:"信封来自那艘三年前沉没的船。这件事让他感到十分惊讶。",next:"信封右下角印着一枚褪色的船徽。他的指尖停在那里——那艘船，三年前就沉了。",type:"pacing",decision:null},
  {old:"他拿起铜钥匙，打开了门。",next:"沈雁将铜钥匙放进他掌心。钥匙上还带着她的体温。他握了一下，然后打开了门。",type:"continuity",decision:null}
];
const state = {page:"writing",chapter:7,tab:"draft",aiOpen:document.querySelector("#program-window").clientWidth >= 1100,inspectorTab:"suggestions",focus:false,navOpen:false,character:0,world:false,drafts:new Map(),dirty:new Set(),confirmed:new Set(),backups:new Map(),dismissed:false,chat:[],composer:"",extraBlueprints:[],taskSeen:false};
const palettes = ["moss", "ocean", "plum", "amber"];
const appearance = {mode:"light",palette:"moss",background:"none",imageURL:"",imageName:"",strength:75,blur:0,opacity:88,fit:"cover",position:50};
const windowState = {display:"open",maximized:false,appearanceOpen:false};
const app = document.querySelector("#app");
const programWindow = document.querySelector("#program-window");
const appearancePanel = document.querySelector("#appearance-panel");
let appearanceTrigger = null;
let imageRequest = 0;
const modal = document.querySelector("#modal");
let modalTrigger = null;
let toastTimer;
let commandMatches = [];
const currentChapter = () => chapters.find(c => c.id === state.chapter);
const textOf = (chapter) => state.drafts.get(chapter.id) ?? chapter.text.join("\n\n");
const countOf = (chapter) => textOf(chapter).replace(/\s/g, "").length;
const chapterWords = (chapter) => chapter.id <= 6 ? chapter.words : countOf(chapter);
function proseHTML(text, note = false) {
  return text.split(/\n\s*\n/).filter(Boolean).map(p => {
    let html = e(p).replace(/\n/g,"<br>");
    if (note && !state.dismissed && !proposals[0].decision) html = html.replace(e(proposals[0].old), `<span class="note-anchor">${e(proposals[0].old)}</span>`);
    return `<p>${html}</p>`;
  }).join("");
}
function captureEditor() {
  const prose = document.querySelector("#draft-prose");
  if (prose && state.tab === "draft" && windowState.display === "open") {
    const text = prose.innerText.trim().replace(/\n{3,}/g,"\n\n");
    if (text !== textOf(currentChapter())) state.drafts.set(state.chapter, text);
  }
  const composer = document.querySelector("#ai-input");
  if (composer) state.composer = composer.value;
}
function navigation() {
  return `<aside class="navigation" aria-label="${e(t("workspace"))}">
    <div class="brand"><svg class="brand-mark" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 26V6l22 20V6M5 16h22" stroke="currentColor" stroke-width="1.8" fill="var(--nf-color-transparent)"/></svg><span>novelforge</span></div>
    <button class="project-button" data-action="project"><span class="project-monogram">雾</span><span class="project-label"><strong>雾海来信</strong><small>${e(t("project"))}</small></span>${icon("down",true)}</button>
    <nav class="nav-group"><div class="nav-label">${e(t("workspace"))}</div>${navPages.map(p=>`<button class="nav-item ${state.page===p?"active":""}" data-page="${p}" ${state.page===p?'aria-current="page"':""}>${icon(p)}<span>${e(t(p))}</span>${p==="review"?`<span class="count">${proposals.filter(p=>!p.decision).length}</span>`:p==="tasks"?'<span class="count">3</span>':""}</button>`).join("")}</nav>
    <div class="nav-bottom"><div class="goal-card"><div class="row"><span>${e(t("goal"))}</span>${icon("writing",true)}</div><div class="row small-text"><span id="goal-count">${countOf(chapters[6]).toLocaleString(locales[localeIndex])}<span class="muted"> / 2,000</span></span><span class="tiny muted">${e(t("words"))}</span></div><div class="progress-track" style="margin-top:var(--nf-space-3)"><span id="goal-progress" style="width:${Math.min(countOf(chapters[6])/20,100)}%"></span></div></div>
    <button class="nav-item ${state.page==="tokens"?"active":""}" data-page="tokens" ${state.page==="tokens"?'aria-current="page"':""}>${icon("tokens")}<span>${e(t("tokens"))}</span><span class="count">v1</span></button><div class="nav-bottom-note">${e(t("demo"))}</div></div>
  </aside>`;
}
function topbar() {
  return `<header class="topbar"><div class="breadcrumbs">${ib("menu","menu","menu")}<span class="muted">雾海来信</span><span class="slash subtle">/</span><span class="breadcrumb-current">${e(t(state.page))}</span></div><div class="top-actions"><button class="command-button" data-action="command" title="${e(t("command"))}">${icon("search",true)}<span>${e(t("command"))}</span><kbd>Ctrl K</kbd></button><button class="button quiet small language-button" data-action="language" aria-label="${e(t("language"))}">${e(t("languageName"))}</button>${state.page==="writing"?`${ib(state.focus?"exitFocus":"focus","focus","focus",state.focus)}${ib(state.aiOpen?"hideAI":"showAI","toggle-ai","ai",state.aiOpen)}`:""}${ib("appearance","appearance","palette")}<span class="avatar" aria-hidden="true">L</span></div></header>`;
}
function statusbar() {
  return `<footer class="statusbar"><div><span class="status-dot"></span><span>${e(t("demo"))}</span><span class="status-hint">${e(t("previewNote"))}</span></div><div class="status-secondary"><button data-page="tokens">${icon("tokens",true)}Editorial Studio / 1.1</button><span>${e(t("languageName"))}</span></div></footer>`;
}
function binder() {
  return `<aside class="binder" aria-label="${e(t("outline"))}"><div class="row binder-heading"><strong>${e(t("outline"))}</strong>${ib("addBlueprint","new-blueprint","plus")}</div><label class="field">${icon("search",true)}<input id="chapter-search" type="search" aria-label="${e(t("searchChapters"))}" placeholder="${e(t("searchChapters"))}"></label><div id="chapter-list">${chapterList("")}</div><div class="binder-note">${e(t("binderHint"))}</div></aside>`;
}
function chapterList(query) {
  const q=query.toLowerCase();
  const list=chapters.filter(c=>(c.title+" "+c.id).toLowerCase().includes(q));
  if(!list.length)return `<div class="empty-state tiny">${e(t("noResults"))}</div>`;
  return [1,2].map(v=>{const group=list.filter(c=>c.volume===v);return group.length?`<div class="volume-title">${icon("down",true)}${e(t(v===1?"volume1":"volume2"))}</div>${group.map(c=>`<button class="chapter-button ${state.chapter===c.id?"active":""}" data-chapter="${c.id}" ${state.chapter===c.id?'aria-current="true"':""}><span class="chapter-number">${String(c.id).padStart(2,"0")}</span><span><strong>${e(c.title)}</strong><small><span>${e(t(c.status))}</span>${chapterWords(c)?`<span>${chapterWords(c).toLocaleString(locales[localeIndex])} ${e(t("words"))}</span>`:""}</small></span></button>`).join("")}`:"";}).join("");
}
function documentContent() {
  const c=currentChapter();
  if(state.tab==="blueprint")return `<div class="manuscript"><div class="chapter-overline">${e(t("chapterBlueprint"))}</div><h1>${e(c.title)}</h1><div class="blueprint-summary"><div class="eyebrow">${e(t("sceneGoal"))}</div><p>${e(c.goal)}</p></div><div class="blueprint-summary"><div class="eyebrow">${e(t("conflict"))}</div><p>追查真相意味着打破沈雁一直守护的秘密。</p></div><div class="blueprint-summary"><div class="eyebrow">${e(t("ending"))}</div><p>灯塔发出两短一长的信号：不要相信你看见的海。</p></div>${btn("openManuscript","switch-draft","writing","primary")}</div>`;
  if(state.tab==="versions")return `<div class="manuscript"><div class="chapter-overline">${e(t("versionTitle"))}</div><h1>${e(c.title)}</h1><div class="note-card stack"><div class="row"><strong>${e(t("initialVersion"))}</strong>${badge("localOnly")}</div><p>${e(t("initialVersionBody"))}</p><div>${btn("restore","restore","history")}</div></div>${state.backups.has(c.id)?`<div class="note-card stack" style="margin-top:var(--nf-space-4)"><strong>${e(t("backup"))}</strong><div>${btn("restoreBackup","recover-backup","history")}</div></div>`:""}<div class="divider"></div><article class="prose" aria-label="${e(t("initialVersion"))}">${proseHTML(c.text.join("\n\n"))}</article></div>`;
  return `<div class="manuscript"><div class="chapter-overline">${e(t(c.id<=4?"act1":"act2"))}</div><h1>${e(c.title)}</h1><div class="chapter-meta"><span>${e(t("chapterLabel",{n:String(c.id).padStart(2,"0")}))}</span><span>·</span><span>${e(t("pov"))} / 林澈</span>${badge(c.status,c.status==="drafting"?"green":"")}</div><article id="draft-prose" class="prose" contenteditable="${c.status!=="done"}" role="textbox" aria-multiline="true" aria-readonly="${c.status==="done"}" aria-label="${e(t("draft"))}" spellcheck="false">${proseHTML(textOf(c),c.id===7)}</article>${!textOf(c)?`<p class="muted small-text" id="empty-draft-hint" style="margin-top:var(--nf-space-4)">${e(t("noWriting"))}</p>`:""}<div class="scene-break" aria-hidden="true"><span></span><span></span><span></span></div><p class="tiny muted" style="text-align:center">${e(t("draftHint"))}</p></div>`;
}
function writingPage() {
  const c=currentChapter();
  return `<section class="writing-layout ${state.aiOpen?"":"ai-hidden"}">${binder()}<main class="manuscript-area"><div class="document-toolbar"><div class="segment" role="group" aria-label="${e(t("draft"))}">${["draft","blueprint","versions"].map(tab=>`<button class="${state.tab===tab?"active":""}" data-tab="${tab}" aria-pressed="${state.tab===tab}">${e(t(tab))}</button>`).join("")}</div><div class="document-tools">${badge("currentDraft")}${ib("versions","show-versions","history")}<button class="button small" data-action="save" ${c.status==="done"?'disabled aria-disabled="true"':""}>${icon("check",true)}<span class="save-label">${e(t("confirm"))}</span></button></div></div><div class="manuscript-scroll">${documentContent()}</div><div class="writing-footer"><div><span id="save-dot" class="status-dot ${state.dirty.has(c.id)?"pending":""}"></span><span id="save-state">${e(t(state.dirty.has(c.id)?"unsaved":state.confirmed.has(c.id)?"saved":"localReady"))}</span></div><div><span id="word-count">${countOf(c).toLocaleString(locales[localeIndex])} ${e(t("words"))}</span><span class="reading-time muted" id="read-time">${e(t("reading",{n:Math.max(1,Math.ceil(countOf(c)/450))}))}</span></div></div></main>${inspector()}</section>`;
}
function inspector() {
  return `<aside class="inspector" aria-label="${e(t("partner"))}"><div class="inspector-header"><h2><span class="assistant-mark">${icon("ai")}</span>${e(t("partner"))}</h2>${ib("hideAI","toggle-ai","close")}</div><div class="inspector-tabs" role="group" aria-label="${e(t("partner"))}">${["suggestions","context"].map(tab=>`<button class="${state.inspectorTab===tab?"active":""}" data-inspector-tab="${tab}" aria-pressed="${state.inspectorTab===tab}">${e(t(tab))}</button>`).join("")}</div><div class="inspector-content" id="inspector-content">${state.inspectorTab==="context"?contextPanel():suggestionsPanel()}</div><form class="composer-wrap" id="ai-form"><div class="composer"><textarea id="ai-input" rows="2" placeholder="${e(t("ask"))}" aria-label="${e(t("ask"))}">${e(state.composer)}</textarea><div class="row"><button class="text-button" type="button" data-action="context">${icon("link",true)}@ ${e(t("context"))}</button><span class="tiny muted">${e(t("modelDemo"))}</span><button class="send-button" type="submit" aria-label="${e(t("send"))}">${icon("up",true)}</button></div></div><div class="composer-note">${e(t("aiDemo"))}</div></form></aside>`;
}
function suggestionsPanel() {
  const notes=state.chapter===7;
  return `<div class="assistant-intro"><div class="ai-context-label"><span class="status-dot"></span>${e(t("connectedContext"))}</div><h3>${e(t("partnerTitle")).replace(/\n/g,"<br>")}</h3><p>${e(t("partnerIntro"))}</p></div>${notes && !state.dismissed && !proposals[0].decision?`<div class="note-card"><div class="note-type">${icon("note",true)}${e(t("pacing"))}</div><h3>${e(t("noteTitle"))}</h3><p>${e(t("noteBody"))}</p><blockquote>“${e(proposals[0].old)}”</blockquote><div class="ai-actions"><button class="button small" data-proposal="0">${icon("writing",true)}${e(t("viewRewrite"))}</button><button class="button quiet small" data-action="dismiss-note">${e(t("dismiss"))}</button></div></div>`:""}${notes && !proposals[1].decision?`<div class="note-card"><div class="note-type">${icon("link",true)}${e(t("continuity"))}</div><h3>${e(t("continuityTitle"))}</h3><p>${e(t("continuityBody"))}</p><button class="text-button" data-action="reference-character">${e(t("openReference"))}${icon("arrow",true)}</button></div>`:""}${notes && state.dismissed && !proposals[0].decision?`<p class="small-text muted">${e(t("noteDeferred"))}</p>`:""}${(!notes || proposals.every(p=>p.decision))?`<p class="small-text muted">${e(t("noNotes"))}</p>`:""}${state.chat.map(q=>`<div class="ai-question">${e(q)}</div><div class="ai-answer">${e(t("aiAnswer"))}</div>`).join("")}`;
}
function contextPanel() {
  return `<div><div class="eyebrow">${e(t("references"))}</div><button class="context-item wide" data-action="reference-character">${icon("characters")}<span>林澈 / 沈雁</span>${badge("profile")}</button><button class="context-item wide" data-resource="1">${icon("book")}<span>雾港时间规则</span>${badge("worldRule")}</button><button class="context-item wide" data-action="switch-blueprint">${icon("planning")}<span>${e(t("chapterLabel",{n:state.chapter}))}</span>${badge("blueprint")}</button></div><div class="note-card"><p>${e(t("contextNote"))}</p></div>`;
}
function pageHead(titleKey, descKey, action="", overline="雾海来信 / Editorial Studio") {
  return `<div class="page-heading"><div><div class="eyebrow">${e(overline)}</div><h1>${e(t(titleKey))}</h1><p>${e(t(descKey))}</p></div>${action}</div>`;
}
function overviewPage() {
  return `<main class="page"><div class="page-inner">${pageHead("welcome","overviewDesc")}<section class="overview-hero"><div><div class="eyebrow">${e(t("novelTag"))}</div><h2>雾海来信</h2><p>${e(t("novelSynopsis"))}</p><button class="button primary" data-chapter="7">${e(t("continueWriting"))}${icon("arrow",true)}</button></div><div class="book-art" aria-hidden="true"><div class="book-cover"><div class="tiny">NOVELFORGE / 01</div><h3>雾海<br>来信</h3><div class="cover-lines"></div><span class="tiny">A STORY BY LUNA</span></div></div></section><div class="metrics"><div class="metric"><span>${e(t("totalWords"))}</span><strong>18,360</strong><span>${e(t("targetWords"))}</span></div><div class="metric"><span>${e(t("finalized"))}</span><strong>6 <span>/ 12</span></strong><span>${e(t("volume1"))}</span></div><div class="metric"><span>${e(t("projectProgress"))}</span><strong>15.3<span>%</span></strong><div class="progress-track"><span style="width:15.3%"></span></div></div></div><div class="overview-grid"><section><div class="section-heading"><h2>${e(t("recent"))}</h2><button class="text-button" data-page="planning">${e(t("allChapters"))}${icon("arrow",true)}</button></div>${[7,6,5].map(id=>{const c=chapters.find(c=>c.id===id);return `<button class="recent-row" data-chapter="${id}"><span class="doc-icon">${icon("file")}</span><span class="info"><strong>${e(c.title)}</strong><small>${e(t("chapterLabel",{n:id}))} · ${e(t("draft"))}</small></span>${badge(c.status,c.status==="drafting"?"green":"")}${icon("chevron",true)}</button>`;}).join("")}</section><section class="panel"><div class="section-heading"><h2>${e(t("nextStep"))}</h2>${icon("planning")}</div>${[["finishChapter","finishChapterDesc","writing"],["reviewTask","reviewTaskDesc","review"],["worldTask","worldTaskDesc","characters"]].map(([title,desc,page])=>`<div class="timeline-entry"><span class="line"></span><div><button class="text-button" data-page="${page}"><strong>${e(t(title))}</strong></button><p>${e(t(desc))}</p></div></div>`).join("")}</section></div></div></main>`;
}
function planningPage() {
  return `<main class="page"><div class="page-inner">${pageHead("planning","planningDesc",btn("addBlueprint","new-blueprint","plus","primary"))}<div class="arc-strip">${[1,2,3].map(n=>`<div class="arc-step ${n===2?"active":""}"><strong>0${n}</strong><div><h3>${e(t(`act${n}Name`))}</h3><p>${e(t(`act${n}Range`))}</p></div></div>`).join("")}</div><div class="planning-toolbar"><div class="section-heading" style="margin:0"><h2>${e(t("board"))}</h2>${badge("localOnly")}</div><label class="field">${icon("search",true)}<input type="search" id="planning-search" placeholder="${e(t("filter"))}" aria-label="${e(t("filter"))}"></label></div><div class="board" id="chapter-board">${boardHTML("")}</div></div></main>`;
}
function boardHTML(query) {
  const groups=["planned","drafting","done"];
  const cards=[...chapters.filter(c=>[5,6,7,8,9].includes(c.id)),...state.extraBlueprints].filter(c=>(c.title+" "+c.goal).toLowerCase().includes(query.toLowerCase()));
  return groups.map(status=>`<section class="board-column"><div class="board-title"><div><span class="status-dot ${status==="drafting"?"":"pending"}"></span>${e(t(status))}</div><span class="count">${cards.filter(c=>c.status===status).length}</span></div>${cards.filter(c=>c.status===status).map(c=>`<button class="board-card ${status==="drafting"?"featured":""}" data-blueprint="${c.id}"><div class="eyebrow">${e(t("chapterLabel",{n:String(c.id).padStart(2,"0")}))}</div><h3>${e(c.title)}</h3><p>${e(c.goal)}</p><div class="row"><span>${e(t("pov"))} / 林澈</span>${status==="drafting"?badge("drafting","green"):icon("chevron",true)}</div></button>`).join("")||`<div class="empty-state tiny">${e(t("noResults"))}</div>`}</section>`).join("");
}
function charactersPage() {
  const p=people[state.character];
  return `<main class="page"><div class="page-inner">${pageHead("characters","characterDesc")}<div class="planning-toolbar"><div class="segment" role="group" aria-label="${e(t("characters"))}"><button class="${!state.world?"active":""}" data-action="cast-tab" aria-pressed="${!state.world}">${e(t("cast"))} / 3</button><button class="${state.world?"active":""}" data-action="world-tab" aria-pressed="${state.world}">${e(t("world"))}</button></div></div>${state.world?worldPage():`<div class="character-layout"><div class="character-list">${people.map((person,i)=>`<button class="character-row ${state.character===i?"active":""}" data-character="${i}" aria-pressed="${state.character===i}"><span class="character-avatar ${person.tone}">${e(person.initial)}</span><span><strong>${e(person.name)}</strong><small>${e(t(person.role))}</small></span></button>`).join("")}</div><section class="character-detail"><div class="profile-head"><span class="character-avatar ${p.tone}">${e(p.initial)}</span><div class="info"><h2>${e(p.name)}</h2><span class="small-text muted">${e(t(p.role))}</span></div>${badge("profile","green")}</div><div class="profile-quote">${e(p.quote)}</div><div class="profile-grid">${["motivation","weakness","currentState","arc"].map(key=>`<div class="profile-field"><h3>${e(t(key))}</h3><p>${e(p[key])}</p></div>`).join("")}</div><div class="divider"></div><div class="section-heading"><h2>${e(t("relations"))}</h2><span class="tiny muted">${e(t("related"))}</span></div>${people.filter(other=>other!==p).map(other=>`<div class="relation-row"><span class="character-avatar ${other.tone}">${e(other.initial)}</span><strong>${e(other.name)}</strong><span class="muted">${e(t(other.name==="顾舟"?"relationOpposed":"relationAlly"))}</span><button class="text-button" data-chapter="7">07 ${icon("arrow",true)}</button></div>`).join("")}</section></div>`}</div></main>`;
}
function worldPage() {
  return `<section class="character-detail"><div class="eyebrow">${e(t("worldRule"))} / 01</div><h2 style="font-family:var(--nf-font-writing);font-size:var(--nf-font-size-heading);margin:var(--nf-space-3) 0">雾港</h2><div class="profile-quote">${e(t("worldDesc"))}</div><div class="profile-grid"><div class="profile-field"><h3>${e(t("worldRule"))}</h3><p>雾出现时，城市会遗失一段共同记忆。灯塔是唯一不会被改写的时间锚点。</p></div><div class="profile-field"><h3>${e(t("conflict"))}</h3><p>离开雾港的人，会忘记所有仍留在城里的人。真相与离开，不能同时拥有。</p></div><div class="profile-field"><h3>${e(t("source"))}</h3><p>雾港时间规则 / 设定笔记 v1</p></div><div class="profile-field"><h3>${e(t("related"))}</h3><button class="text-button" data-chapter="8">08 / 城里没有星期三 ${icon("arrow",true)}</button></div></div></section>`;
}
function libraryPage() {
  return `<main class="page"><div class="page-inner">${pageHead("library","libraryDesc",btn("import","import","plus"))}<div class="library-top"><label class="field">${icon("search")}<input id="library-search" type="search" placeholder="${e(t("searchLibrary"))}" aria-label="${e(t("searchLibrary"))}"></label>${badge("unitReference","blue",{n:14})}</div><div class="table-scroll"><table class="library-table"><thead><tr><th>${e(t("name"))}</th><th>${e(t("kind"))}</th><th>${e(t("relatedUse"))}</th><th>${e(t("updated"))}</th><th><span class="tiny">${e(t("viewResult"))}</span></th></tr></thead><tbody id="library-rows">${libraryRows("")}</tbody></table></div><p class="token-note">${e(t("contextNote"))}</p></div></main>`;
}
function libraryRows(query) {
  const list=resources.map((r,i)=>({...r,index:i})).filter(r=>(r.title+r.body).includes(query));
  return list.map(r=>`<tr><td><div class="table-name">${icon(r.kind==="clip"?"note":"file")}<div><strong>${e(r.title)}</strong><p>${e(r.source)}</p></div></div></td><td>${badge(r.kind,r.kind==="setting"?"green":"")}</td><td class="small-text muted">${e(t("unitReference",{n:r.use}))}</td><td class="small-text muted">${r.date}</td><td><div class="table-action"><button class="icon-button" data-resource="${r.index}" aria-label="${e(t("viewResult"))}: ${e(r.title)}">${icon("arrow",true)}</button></div></td></tr>`).join("")||`<tr><td colspan="5" class="empty-state">${e(t("noResults"))}</td></tr>`;
}
function reviewPage() {
  return `<main class="page"><div class="page-inner">${pageHead("review","reviewDesc",`<button class="button" data-chapter="7">${icon("writing",true)}${e(t("openManuscript"))}</button>`)}<div class="review-layout"><section class="review-document"><div class="review-document-head"><div><strong class="small-text">潮汐带来的回信</strong><p class="tiny muted">${e(t("baseline"))}</p></div>${badge("pendingReview","amber",{n:proposals.filter(p=>!p.decision).length})}</div><div class="review-prose"><p>${e(paragraphSource[1])}</p>${proposals.map((p,i)=>`<section style="margin-bottom:var(--nf-space-6)"><div class="review-note">0${i+1} / ${e(t(p.type))}</div>${p.decision==="accept"?`<span class="diff-new">${e(p.next)}</span>`:p.decision==="reject"?e(p.old):`<span class="diff-old">${e(p.old)}</span><br><span class="diff-new">${e(p.next)}</span>`}<div class="diff-controls">${p.decision?badge(p.decision==="accept"?"accepted":"rejected",p.decision==="accept"?"green":""):`<button class="button quiet small" data-reject="${i}">${e(t("reject"))}</button><button class="button small" data-proposal="${i}">${icon("check",true)}${e(t("accept"))}</button>`}</div></section>`).join("")}<p>${e(paragraphSource[6])}</p></div></section><aside class="review-sidebar"><section class="panel"><div class="eyebrow">EDITORIAL / 02</div><h3 style="margin-top:var(--nf-space-3)">${e(t("reviewSummary"))}</h3><p>${e(t("reviewSummaryBody"))}</p></section><section class="panel"><div class="assistant-mark">${icon("shield")}</div><h3 style="margin-top:var(--nf-space-3)">${e(t("safety"))}</h3><p>${e(t("safetyBody"))}</p><button class="text-button" data-action="review-versions">${e(t("versions"))}${icon("arrow",true)}</button></section></aside></div></div></main>`;
}
function tasksPage() {
  return `<main class="page"><div class="page-inner">${pageHead("tasks","taskDesc")}<section class="task-banner">${icon("alert")}<div><h3>${e(t("approvalTitle"))}</h3><p>${e(t("approvalBody"))}</p></div>${btn("viewResult","task-result","arrow")}</section><div class="table-scroll"><table class="task-table"><thead><tr><th>${e(t("taskName"))}</th><th>${e(t("state"))}</th><th>${e(t("scope"))}</th><th>${e(t("viewResult"))}</th></tr></thead><tbody>${[1,2,3].map((n)=>`<tr><td><div class="table-name">${icon(n===1?"review":n===2?"characters":"planning")}<div><strong>${e(t(`task${n}`))}</strong><p>${e(t("modelDemo"))} / 0${n}</p></div></div></td><td>${badge(n===1?"pending":n===2?"completed":"cancelled",n===1?"amber":n===2?"green":"")}</td><td class="small-text muted">${e(t(`taskScope${n}`))}</td><td><button class="icon-button" data-action="${n===1?"task-result":n===2?"reference-character":"cancelled-result"}" aria-label="${e(t("viewResult"))}: ${e(t(`task${n}`))}">${icon("arrow",true)}</button></td></tr>`).join("")}</tbody></table></div><p class="token-note">${e(t("permissionNote"))}</p></div></main>`;
}
const colorSpec=[ ["canvasColor","canvas"],["paperColor","paper"],["surfaceColor","surface"],["inkColor","ink"],["brandColor","brand"],["brandSoftColor","brand-soft"],["accentColor","accent"],["mutedColor","muted"],["lineColor","line"],["warningColor","warning"],["dangerColor","danger"],["infoColor","info"] ];
function tokensPage() {
  return `<main class="page"><div class="page-inner">${pageHead("tokens","tokenDesc",badge("multiThemeProposal","green"),"NOVELFORGE / EDITORIAL STUDIO")}<section class="token-section"><div class="section-heading"><h2>${e(t("colors"))}</h2><div class="specimen-buttons"><a class="text-button" href="./tokens.css" target="_blank" rel="noopener">${e(t("downloadCSS"))}${icon("arrow",true)}</a><a class="text-button" href="./tokens.json" target="_blank" rel="noopener">${e(t("downloadJSON"))}${icon("arrow",true)}</a></div></div><div class="swatch-grid">${colorSpec.map(([name,key])=>`<div class="swatch"><div class="swatch-color" style="background:var(--nf-color-${key})"></div><div class="swatch-info"><strong>${e(t(name))}</strong><code>--nf-color-${key}</code><div class="tiny muted" data-color-value="${key}">${e(getComputedStyle(programWindow).getPropertyValue(`--nf-color-${key}`).trim())}</div></div></div>`).join("")}</div><p class="token-note">${e(t("colorNote"))}</p></section><section class="token-section"><div class="section-heading"><h2>${e(t("typography"))}</h2></div><div class="specimen-grid"><div class="panel type-specimen"><div class="eyebrow">${e(t("uiType"))}</div><div class="display" style="font-family:var(--nf-font-ui)">A quieter place to write.</div><p>${e(t("partner"))} / ${e(t("currentDraft"))} / ${e(t("versions"))}</p><code class="tiny muted">13 / 14 / 16 / 20 / 28 / 36 px</code></div><div class="panel type-specimen"><div class="eyebrow">${e(t("writingType"))}</div><div class="display">${e(t("writingSample"))}</div><p class="body-sample">${e(paragraphSource[0])}</p></div></div><p class="token-note">${e(t("typeNote"))}</p></section><section class="token-section"><div class="section-heading"><h2>${e(t("scale"))}</h2></div><div class="panel"><div class="token-scale">${[1,2,3,4,5,6,8,10,12,16].map(n=>`<div class="scale-item"><div style="width:var(--nf-space-${n});height:var(--nf-space-${n})"></div><span>${n*4}px</span></div>`).join("")}</div><p class="token-note">${e(t("spacingNote"))}</p></div></section><section class="token-section"><div class="section-heading"><h2>${e(t("components"))}</h2></div><div class="specimen-grid"><div class="panel stack"><div class="specimen-buttons">${btn("primaryAction","specimen","check","primary")}${btn("secondaryAction","specimen","writing")}${btn("quietAction","specimen","","quiet")}</div><label class="field">${icon("search",true)}<input placeholder="${e(t("searchCommands"))}" aria-label="${e(t("searchCommands"))}"></label><p class="token-note">${e(t("layerNote"))}</p></div><div class="panel semantic-list"><div>${badge("savedSpecimen","green")}${icon("check",true)}</div><div>${badge("pending","amber")}${icon("clock",true)}</div><div>${badge("proposal","clay")}${icon("note",true)}</div><div><span class="pill" style="color:var(--nf-color-danger);background:var(--nf-color-danger-soft)">${e(t("errorSpecimen"))}</span>${icon("alert",true)}</div></div></div></section></div></main>`;
}
const pageRenderers={overview:overviewPage,writing:writingPage,planning:planningPage,characters:charactersPage,review:reviewPage,library:libraryPage,tasks:tasksPage,tokens:tokensPage};

function modeOptions() {
  return ["light","dark"].map(mode=>`<button data-mode="${mode}" class="${appearance.mode===mode?"active":""}" aria-pressed="${appearance.mode===mode}">${icon(mode==="light"?"sun":"moon",true)}${e(t(`${mode}Mode`))}</button>`).join("");
}
function renderWindowChrome() {
  // Updating review controls must not drop keyboard focus from a select/button.
  const active=document.activeElement;
  const chromeRoot=active?.closest?.("#showcase-header,#window-titlebar,#showcase-footer");
  const focusKey=chromeRoot&&["setting","mode","action"].find(key=>active.dataset[key]);
  const focusValue=focusKey?active.dataset[focusKey]:null;
  const rootId=chromeRoot?.id;
  document.querySelector("#showcase-header").innerHTML=`<div class="showcase-heading"><strong>NOVELFORGE <span>/ EDITORIAL STUDIO 1.1</span></strong><span>${e(t("stageNote"))}</span></div><div class="showcase-controls"><div class="segment" role="group" aria-label="${e(t("modeLabel"))}">${modeOptions()}</div><select data-setting="palette" aria-label="${e(t("paletteLabel"))}">${palettes.map(p=>`<option value="${p}" ${appearance.palette===p?"selected":""}>${e(t(p))}</option>`).join("")}</select><button class="button" data-action="appearance" aria-expanded="${windowState.appearanceOpen}" aria-controls="appearance-panel">${icon("palette",true)}${e(t("appearance"))}</button>${windowState.display!=="open"?btn("restoreWindow","window-open","restore"):""}</div>`;
  document.querySelector("#window-titlebar").innerHTML=`<div class="window-app-title">${icon("writing")}<strong>NovelForge</strong><span class="window-title-note">/ 雾海来信 · ${e(t("desktopPreview"))}</span></div><div class="window-controls"><button class="window-control ${windowState.appearanceOpen?"is-active":""}" data-action="appearance" aria-label="${e(t("appearance"))}" title="${e(t("appearance"))}" aria-expanded="${windowState.appearanceOpen}" aria-controls="appearance-panel">${icon("palette")}</button><span class="titlebar-sep"></span><button class="window-control" data-action="window-minimize" aria-label="${e(t("minimizeWindow"))}" title="${e(t("minimizeWindow"))}">${icon("minimize")}</button><button class="window-control" data-action="window-maximize" aria-label="${e(t(windowState.maximized?"restoreWindow":"maximizeWindow"))}" title="${e(t(windowState.maximized?"restoreWindow":"maximizeWindow"))}">${icon(windowState.maximized?"restore":"maximize")}</button><button class="window-control close-control" data-action="window-close" aria-label="${e(t("closeWindow"))}" title="${e(t("closeWindow"))}">${icon("close")}</button></div>`;
  document.querySelector("#showcase-footer").innerHTML=`<span>${e(t("frameFooter"))}</span><code>DESKTOP WINDOW / ${e(t(appearance.palette))} · ${e(t(`${appearance.mode}Mode`))}</code><button class="text-button" data-action="show-token-system">${e(t("tokens"))}${icon("arrow",true)}</button>`;
  const hidden=windowState.display!=="open";
  document.querySelector("#window-content").hidden=hidden;
  const placeholder=document.querySelector("#window-placeholder");
  placeholder.hidden=!hidden;
  placeholder.innerHTML=hidden?`${icon("writing")}<strong>${e(t(windowState.display==="minimized"?"windowMinimized":"windowClosed"))}</strong><p class="small-text">${e(t("windowKept"))}</p>${btn("restoreWindow","window-open","restore","primary")}`:"";
  programWindow.classList.toggle("is-hidden",hidden);
  document.querySelector("#review-stage").classList.toggle("is-maximized",windowState.maximized);
  if(rootId&&focusKey)document.querySelector(`#${rootId} [data-${focusKey}="${focusValue}"]`)?.focus({preventScroll:true});
}
function rangeControl(key, setting, min, max, unit="%") {
  return `<label class="range-control"><span class="row"><span>${e(t(key))}</span><output data-output="${setting}">${appearance[setting]}${unit}</output></span><input type="range" min="${min}" max="${max}" step="1" value="${appearance[setting]}" data-setting="${setting}" aria-label="${e(t(key))}" ${appearance.background==="none"?"disabled":""}></label>`;
}
function renderAppearancePanel() {
  appearancePanel.innerHTML=`<div class="appearance-header"><h2 id="appearance-title">${e(t("appearanceTitle"))}</h2>${ib("close","close-appearance","close")}</div><div class="appearance-body"><p class="appearance-description">${e(t("appearanceNote"))}</p><section class="appearance-section"><h3>${e(t("modeLabel"))}</h3><div class="segment" role="group" aria-label="${e(t("modeLabel"))}">${modeOptions()}</div></section><section class="appearance-section"><h3>${e(t("paletteLabel"))}</h3><div class="palette-options" role="group" aria-label="${e(t("paletteLabel"))}">${palettes.map(p=>`<button class="palette-option ${appearance.palette===p?"active":""}" data-palette="${p}" aria-pressed="${appearance.palette===p}"><span class="palette-dot" style="background:var(--nf-palette-${p})">${appearance.palette===p?icon("check",true):""}</span><span>${e(t(p))}</span></button>`).join("")}</div><p class="appearance-description">${e(t("paletteNote"))}</p></section><section class="appearance-section"><h3>${e(t("backgroundLabel"))}</h3><div class="background-options" role="group" aria-label="${e(t("backgroundLabel"))}">${["none","mist","dusk"].map(bg=>`<button class="background-option ${appearance.background===bg?"active":""}" data-background="${bg}" aria-pressed="${appearance.background===bg}"><span class="background-sample ${bg}">${bg==="none"?icon("image",true):""}</span><span>${e(t(bg==="none"?"noBackground":bg))}</span></button>`).join("")}</div><label class="upload-area">${icon("image")}<span>${e(t("chooseImage"))}</span><small>${e(t("imageHint"))}</small><input type="file" id="background-file" accept="image/jpeg,image/png,image/webp" aria-label="${e(t("chooseImage"))}"></label>${appearance.imageURL?`<div class="image-current"><img src="${e(appearance.imageURL)}" alt=""><span><button class="text-button" data-background="custom">${e(t("useImage"))}</button><br>${e(appearance.imageName)}</span>${ib("removeImage","remove-image","close")}</div>`:""}<p class="appearance-description">${e(t("imagePrivacy"))}</p></section><section class="appearance-section">${rangeControl("imageStrength","strength",20,100)}${rangeControl("imageBlur","blur",0,16,"px")}${rangeControl("surfaceOpacity","opacity",75,100)}<label class="range-control"><span>${e(t("imageFit"))}</span><select data-setting="fit" ${appearance.background==="none"?"disabled":""}><option value="cover" ${appearance.fit==="cover"?"selected":""}>${e(t("imageCover"))}</option><option value="contain" ${appearance.fit==="contain"?"selected":""}>${e(t("imageContain"))}</option></select></label>${rangeControl("imagePosition","position",0,100)}<p class="appearance-description">${e(t("paperProtected"))}</p></section></div><div class="appearance-footer">${btn("resetAppearance","reset-appearance","history","quiet small")}${btn("close","close-appearance","check","small")}</div>`;
}
function syncAppearanceControls() {
  document.querySelectorAll("[data-mode]").forEach(el=>{if(el.tagName!=="BUTTON")return;const active=el.dataset.mode===appearance.mode;el.classList.toggle("active",active);el.setAttribute("aria-pressed",String(active));});
  document.querySelectorAll("button[data-palette]").forEach(el=>{const active=el.dataset.palette===appearance.palette;el.classList.toggle("active",active);el.setAttribute("aria-pressed",String(active));el.querySelector(".palette-dot").innerHTML=active?icon("check",true):"";});
  document.querySelectorAll("button[data-background]").forEach(el=>{const active=el.dataset.background===appearance.background;el.classList.toggle("active",active);el.setAttribute("aria-pressed",String(active));});
  document.querySelectorAll("[data-setting]").forEach(el=>{const setting=el.dataset.setting;el.value=String(appearance[setting]);if(setting!=="palette")el.disabled=appearance.background==="none";});
  document.querySelectorAll("[data-output]").forEach(el=>{const key=el.dataset.output;el.textContent=`${appearance[key]}${key==="blur"?"px":"%"}`;});
  document.querySelectorAll('[data-action="appearance"]').forEach(el=>el.setAttribute("aria-expanded",String(windowState.appearanceOpen)));
}
function applyAppearance() {
  programWindow.dataset.mode=appearance.mode;
  programWindow.dataset.palette=appearance.palette;
  const styles=programWindow.style;
  let background="none";
  if(appearance.background==="mist")background="linear-gradient(135deg,var(--nf-bg-mist-a),var(--nf-bg-mist-b) 52%,var(--nf-bg-mist-c))";
  if(appearance.background==="dusk")background="linear-gradient(145deg,var(--nf-bg-dusk-a),var(--nf-bg-dusk-b) 48%,var(--nf-bg-dusk-c))";
  if(appearance.background==="custom"&&appearance.imageURL)background=`url("${appearance.imageURL}")`;
  styles.setProperty("--nf-bg-image",background);
  styles.setProperty("--nf-bg-strength",String(appearance.strength/100));
  styles.setProperty("--nf-bg-blur",`${appearance.blur}px`);
  styles.setProperty("--nf-bg-surface-opacity",`${appearance.opacity}%`);
  styles.setProperty("--nf-bg-fit",appearance.fit);
  styles.setProperty("--nf-bg-position",`50% ${appearance.position}%`);
  programWindow.classList.toggle("has-wallpaper",background!=="none");
  syncAppearanceControls();
  document.querySelectorAll("[data-color-value]").forEach(el=>{el.textContent=getComputedStyle(programWindow).getPropertyValue(`--nf-color-${el.dataset.colorValue}`).trim();});
  renderWindowChrome();
  if(windowState.appearanceOpen)appearancePanel.hidden=false;
  positionWindowDialog();
}
function setAppearance(setting,value) {
  if(setting==="mode"&&["light","dark"].includes(value))appearance.mode=value;
  else if(setting==="palette"&&palettes.includes(value))appearance.palette=value;
  else if(setting==="fit"&&["cover","contain"].includes(value))appearance.fit=value;
  else if(setting==="background"&&["none","mist","dusk","custom"].includes(value)){
    if(value==="custom"&&!appearance.imageURL)return;
    imageRequest++;
    appearance.background=value;
  } else if(["strength","blur","opacity","position"].includes(setting)) {
    const ranges={strength:[20,100],blur:[0,16],opacity:[75,100],position:[0,100]};
    const n=Number(value);if(!Number.isFinite(n))return;appearance[setting]=Math.max(ranges[setting][0],Math.min(ranges[setting][1],n));
  } else return;
  applyAppearance();
}
function showAppearance() {
  captureEditor();
  if(windowState.display!=="open"){windowState.display="open";renderWindowChrome();}
  if(!windowState.appearanceOpen)appearanceTrigger=document.activeElement;
  windowState.appearanceOpen=true;
  renderAppearancePanel();appearancePanel.hidden=false;applyAppearance();
  appearancePanel.querySelector('[data-action="close-appearance"]').focus();
}
function closeAppearance() {
  windowState.appearanceOpen=false;appearancePanel.hidden=true;renderWindowChrome();
  if(appearanceTrigger?.isConnected)appearanceTrigger.focus();else document.querySelector('.window-controls [data-action="appearance"]')?.focus();
}
function removeBackgroundImage() {
  imageRequest++;
  if(appearance.imageURL)URL.revokeObjectURL(appearance.imageURL);
  appearance.imageURL="";appearance.imageName="";
  if(appearance.background==="custom")appearance.background="none";
  if(windowState.appearanceOpen)renderAppearancePanel();applyAppearance();
}
async function loadBackgroundImage(file) {
  const request=++imageRequest;
  if(!file||!file.size||file.size>12*1024*1024||!["image/jpeg","image/png","image/webp"].includes(file.type)){
    toast(t("imageInvalid"));return;
  }
  const previewURL=URL.createObjectURL(file);
  try {
    const img=new Image();img.src=previewURL;await img.decode();
    if(!img.naturalWidth||!img.naturalHeight||img.naturalWidth*img.naturalHeight>40000000)throw new Error("Invalid image dimensions");
    if(request!==imageRequest){URL.revokeObjectURL(previewURL);return;}
    const oldURL=appearance.imageURL;
    appearance.imageURL=previewURL;appearance.imageName=file.name;appearance.background="custom";
    if(oldURL)URL.revokeObjectURL(oldURL);
    if(windowState.appearanceOpen)renderAppearancePanel();applyAppearance();toast(t("imageLoaded"));
  } catch {
    URL.revokeObjectURL(previewURL);
    if(request===imageRequest)toast(t("imageInvalid"));
  }
}
function positionWindowDialog() {
  if(!modal.open)return;
  const rect=programWindow.getBoundingClientRect();
  modal.style.left=`${rect.left+rect.width/2}px`;
  modal.style.top=`${rect.top+rect.height/2}px`;
  modal.style.maxWidth=`${Math.max(200,Math.min(620,rect.width-32))}px`;
  modal.style.maxHeight=`${Math.min(window.innerHeight-32,rect.height-32)}px`;
}
function simulateWindow(display) {
  captureEditor();windowState.display=display;
  windowState.appearanceOpen=false;appearancePanel.hidden=true;
  if(modal.open)closeModal();renderWindowChrome();
  const target=display==="open"?document.querySelector('.window-controls [data-action="window-minimize"]'):document.querySelector('#window-placeholder [data-action="window-open"]');
  target?.focus();
}
new ResizeObserver(positionWindowDialog).observe(programWindow);
window.addEventListener("resize",positionWindowDialog);
window.addEventListener("scroll",positionWindowDialog,{passive:true});
window.addEventListener("pagehide",()=>{if(appearance.imageURL)URL.revokeObjectURL(appearance.imageURL);});

function render() {
  document.documentElement.lang=locales[localeIndex];
  document.title=`NovelForge · ${t(state.page)} / Editorial Studio v1.1`;
  app.innerHTML=`<div class="app-shell ${state.focus?"focus-mode":""} ${state.navOpen?"nav-open":""}"><button class="nav-backdrop" data-action="menu" aria-label="${e(t("close"))}"></button>${navigation()}<div class="work-area">${topbar()}<div class="content-body">${pageRenderers[state.page]()}</div>${statusbar()}</div></div>`;
  document.querySelector(".mobile-menu")?.classList.add("mobile-menu");
  // Only the topbar menu button is a responsive navigation trigger.
  document.querySelector('.topbar [data-action="menu"]')?.classList.add("mobile-menu");
  if(windowState.appearanceOpen)renderAppearancePanel();
  applyAppearance();
}
function navigate(page) {captureEditor();state.page=page;state.navOpen=false;if(page!=="writing")state.focus=false;render();}
function openChapter(id, tab="draft") {captureEditor();state.chapter=Number(id);state.page="writing";state.tab=tab;state.navOpen=false;render();}
function toast(message) {
  clearTimeout(toastTimer);const el=document.querySelector("#toast");el.textContent=message;el.classList.add("visible");toastTimer=setTimeout(()=>el.classList.remove("visible"),4200);
}
function openModal(title, body, footer="") {
  if(!modal.open)modalTrigger=document.activeElement;
  modal.innerHTML=`<div class="modal-header"><h2 id="modal-title">${e(title)}</h2>${ib("close","close-modal","close")}</div><div class="modal-body">${body}</div>${footer?`<div class="modal-footer">${footer}</div>`:""}`;
  if(!modal.open)modal.showModal();
  positionWindowDialog();
}
function closeModal() {if(modal.open)modal.close();}
modal.addEventListener("close",()=>{if(modalTrigger?.isConnected)modalTrigger.focus();else document.querySelector('[aria-current="page"]')?.focus();});
modal.addEventListener("click",ev=>{if(ev.target===modal){const rect=modal.getBoundingClientRect();if(ev.clientX<rect.left||ev.clientX>rect.right||ev.clientY<rect.top||ev.clientY>rect.bottom)closeModal();}});
function showProposal(index) {
  captureEditor();const p=proposals[index];
  openModal(t("rewriteTitle"),`<div class="eyebrow">${e(t("original"))}</div><blockquote class="blueprint-summary" style="margin:var(--nf-space-3) 0 var(--nf-space-5)">${e(p.old)}</blockquote><div class="eyebrow">${e(t("replacement"))}</div><blockquote class="blueprint-summary" style="background:var(--nf-color-brand-soft);margin:var(--nf-space-3) 0">${e(p.next)}</blockquote><p class="tiny muted">${e(t("rewriteGuard"))}</p>`,`${btn("cancel","close-modal")}${btn("applyRewrite",`apply-${index}`,"check","primary")}`);
}
function applyProposal(index) {
  captureEditor();const p=proposals[index];const c=chapters[6];const before=textOf(c);
  // A document-version guard, not a global substring match. Other accepted
  // proposals are the only permitted changes to this proposal's baseline.
  const expected=proposals.reduce((text,item)=>item.decision==="accept"?text.replace(item.old,item.next):text,paragraphSource.join("\n\n"));
  if(p.decision||before!==expected||before.split(p.old).length!==2){closeModal();toast(t("conflictError"));return;}
  state.drafts.set(7,before.replace(p.old,p.next));state.dirty.add(7);state.confirmed.delete(7);p.decision="accept";closeModal();render();toast(t("applied"));
}
function showBlueprint(id) {
  const c=[...chapters,...state.extraBlueprints].find(c=>c.id===Number(id));if(!c)return;
  openModal(`${t("chapterLabel",{n:c.id})} / ${c.title}`,`<div class="modal-facts"><div><span>${e(t("state"))}</span>${badge(c.status,c.status==="drafting"?"green":"")}</div><div><span>${e(t("participants"))}</span><strong>林澈 / 沈雁</strong></div></div><div class="eyebrow">${e(t("sceneGoal"))}</div><p style="margin-top:var(--nf-space-3)">${e(c.goal)}</p><p class="tiny muted">${e(t("memory"))}</p>`,`${btn("close","close-modal")}${chapters.some(item=>item.id===c.id)?`<button class="button primary" data-open-chapter="${c.id}">${e(t("openManuscript"))}${icon("arrow",true)}</button>`:""}`);
}
function newBlueprint() {
  openModal(t("addBlueprint"),`<form id="blueprint-form"><label class="modal-field"><span>${e(t("title"))}</span><input id="blueprint-title" name="title" required maxlength="80" autocomplete="off"></label><label class="modal-field"><span>${e(t("sceneGoal"))}</span><textarea id="blueprint-goal" name="goal" maxlength="500"></textarea></label><p class="tiny muted">${e(t("memory"))}</p></form>`,`${btn("cancel","close-modal")}<button class="button primary" type="submit" form="blueprint-form">${icon("plus",true)}${e(t("create"))}</button>`);
}
function commandPalette() {
  if(!modal.open)modalTrigger=document.activeElement;
  modal.innerHTML=`<div class="modal-header"><h2 id="modal-title">${e(t("command"))}</h2>${ib("close","close-modal","close")}</div><div class="command-search"><input id="command-input" type="search" aria-label="${e(t("searchCommands"))}" placeholder="${e(t("searchCommands"))}" autocomplete="off"></div><div class="command-results" id="command-results"></div><div class="modal-footer"><span class="tiny muted">Esc / ${e(t("close"))}</span><kbd>Ctrl K</kbd></div>`;
  modal.showModal();positionWindowDialog();filterCommands("");document.querySelector("#command-input").focus();
}
function filterCommands(query) {
  const commands=[...navPages,"tokens"].map(page=>({title:t(page),icon:page,page}));
  commands.push(...chapters.map(c=>({title:`${t("chapterLabel",{n:c.id})} / ${c.title}`,icon:"file",chapter:c.id})));
  commands.push({title:t("focus"),icon:"focus",action:"focus"});
  commandMatches=commands.filter(c=>c.title.toLowerCase().includes(query.toLowerCase()));
  document.querySelector("#command-results").innerHTML=commandMatches.map((c,i)=>`<button class="command-row" data-command="${i}">${icon(c.icon)}<span>${e(c.title)}</span>${icon("arrow",true)}</button>`).join("")||`<p class="empty-state">${e(t("noResults"))}</p>`;
}
function resourceModal(index) {
  const r=resources[index];openModal(r.title,`${badge(r.kind,r.kind==="setting"?"green":"")}<p style="margin-top:var(--nf-space-4)">${e(r.body)}</p><div class="modal-facts"><div><span>${e(t("source"))}</span><span>${e(r.source)}</span></div><div><span>${e(t("relatedUse"))}</span><span>${e(t("unitReference",{n:r.use}))}</span></div></div>`,btn("close","close-modal"));
}
function updateDraftStatus() {
  const c=currentChapter();const count=countOf(c);
  document.querySelector("#word-count").textContent=`${count.toLocaleString(locales[localeIndex])} ${t("words")}`;
  document.querySelector("#read-time").textContent=t("reading",{n:Math.max(1,Math.ceil(count/450))});
  document.querySelector("#save-state").textContent=t("unsaved");document.querySelector("#save-dot").classList.add("pending");
  document.querySelector("#empty-draft-hint")?.remove();
  document.querySelector("#goal-count").innerHTML=`${countOf(chapters[6]).toLocaleString(locales[localeIndex])}<span class="muted"> / 2,000</span>`;
  document.querySelector("#goal-progress").style.width=`${Math.min(countOf(chapters[6])/20,100)}%`;
}
function action(name) {
  if(name.startsWith("apply-")){applyProposal(Number(name.split("-")[1]));return;}
  switch(name){
    case "close-modal":closeModal();break;
    case "appearance":if(windowState.appearanceOpen)closeAppearance();else showAppearance();break;
    case "close-appearance":closeAppearance();break;
    case "remove-image":removeBackgroundImage();break;
    case "reset-appearance":removeBackgroundImage();Object.assign(appearance,{mode:"light",palette:"moss",background:"none",strength:75,blur:0,opacity:88,fit:"cover",position:50});if(windowState.appearanceOpen)renderAppearancePanel();applyAppearance();toast(t("appearanceReset"));break;
    case "window-minimize":simulateWindow("minimized");break;
    case "window-close":simulateWindow("closed");break;
    case "window-open":simulateWindow("open");break;
    case "window-maximize":if(windowState.display!=="open")simulateWindow("open");windowState.maximized=!windowState.maximized;renderWindowChrome();positionWindowDialog();break;
    case "show-token-system":if(windowState.display!=="open")simulateWindow("open");navigate("tokens");break;
    case "menu":captureEditor();state.focus=false;state.navOpen=!state.navOpen;render();break;
    case "project":openModal(t("projectModal"),`<h3 style="font-family:var(--nf-font-writing);font-size:var(--nf-font-size-heading);margin-bottom:var(--nf-space-4)">雾海来信</h3><p>${e(t("projectModalBody"))}</p><p class="tiny muted">${e(t("memory"))}</p>`,btn("close","close-modal"));break;
    case "language":captureEditor();localeIndex=(localeIndex+1)%3;render();break;
    case "command":captureEditor();commandPalette();break;
    case "focus":captureEditor();if(state.page!=="writing"){state.page="writing";state.tab="draft";}state.focus=!state.focus;state.navOpen=false;render();break;
    case "toggle-ai":captureEditor();if(state.focus)state.focus=false;state.aiOpen=!state.aiOpen;render();break;
    case "save":if(currentChapter().status==="done"||state.tab!=="draft")break;captureEditor();state.dirty.delete(state.chapter);state.confirmed.add(state.chapter);render();toast(t("confirmed"));break;
    case "show-versions":captureEditor();state.tab="versions";render();break;
    case "switch-draft":captureEditor();state.tab="draft";render();break;
    case "switch-blueprint":captureEditor();state.tab="blueprint";render();break;
    case "context":captureEditor();state.inspectorTab="context";render();break;
    case "dismiss-note":captureEditor();state.dismissed=true;render();break;
    case "reference-character":state.character=1;state.world=false;closeModal();navigate("characters");break;
    case "review-versions":closeModal();openChapter(7,"versions");break;
    case "cast-tab":state.world=false;render();break;
    case "world-tab":state.world=true;render();break;
    case "new-blueprint":captureEditor();newBlueprint();break;
    case "import":openModal(t("import"),`<p>${e(t("demoImport"))}</p>`,btn("close","close-modal"));break;
    case "task-result":openModal(t("approvalModal"),`<p>${e(t("approvalBody"))}</p><div class="modal-facts"><div><span>${e(t("scope"))}</span><span>${e(t("taskScope1"))}</span></div><div><span>${e(t("state"))}</span>${badge("pending","amber")}</div></div><p class="tiny muted">${e(t("permissionNote"))}</p>`,`${btn("close","close-modal")}${btn("goReview","go-review","arrow","primary")}`);break;
    case "go-review":state.taskSeen=true;closeModal();navigate("review");break;
    case "cancelled-result":openModal(t("task3"),`<p>${e(t("taskScope3"))}</p>${badge("cancelled")}<p class="token-note">${e(t("previewNote"))}</p>`,btn("close","close-modal"));break;
    case "restore":captureEditor();openModal(t("restoreTitle"),`<p>${e(t("restoreBody"))}</p>`,`${btn("cancel","close-modal")}${btn("restore","confirm-restore","history","primary")}`);break;
    case "confirm-restore":{const c=currentChapter();state.backups.set(c.id,{text:textOf(c),decisions:proposals.map(p=>p.decision),dismissed:state.dismissed});state.drafts.set(c.id,c.text.join("\n\n"));state.dirty.add(c.id);state.confirmed.delete(c.id);if(c.id===7){proposals.forEach(p=>p.decision=null);state.dismissed=false;}closeModal();render();toast(t("restored"));break;}
    case "recover-backup":{const c=currentChapter();if(state.backups.has(c.id)){const backup=state.backups.get(c.id);state.backups.set(c.id,{text:textOf(c),decisions:proposals.map(p=>p.decision),dismissed:state.dismissed});state.drafts.set(c.id,backup.text);state.dirty.add(c.id);state.confirmed.delete(c.id);if(c.id===7){proposals.forEach((p,i)=>p.decision=backup.decisions[i]);state.dismissed=backup.dismissed;}render();toast(t("backupRecovered"));}break;}
    case "specimen":toast(t("tokenBtnDemo"));break;
  }
}
document.addEventListener("click",ev=>{
  const target=ev.target.closest("button,a");if(!target)return;
  if(target.dataset.mode){setAppearance("mode",target.dataset.mode);return;}
  if(target.dataset.palette){setAppearance("palette",target.dataset.palette);return;}
  if(target.dataset.background){setAppearance("background",target.dataset.background);return;}
  if(target.dataset.page){if(modal.open)closeModal();navigate(target.dataset.page);return;}
  if(target.dataset.chapter){openChapter(target.dataset.chapter);return;}
  if(target.dataset.openChapter){closeModal();openChapter(target.dataset.openChapter);return;}
  if(target.dataset.tab){captureEditor();state.tab=target.dataset.tab;render();return;}
  if(target.dataset.inspectorTab){captureEditor();state.inspectorTab=target.dataset.inspectorTab;render();return;}
  if(target.dataset.character!==undefined){state.character=Number(target.dataset.character);render();return;}
  if(target.dataset.blueprint){showBlueprint(target.dataset.blueprint);return;}
  if(target.dataset.resource!==undefined){captureEditor();resourceModal(Number(target.dataset.resource));return;}
  if(target.dataset.proposal!==undefined){showProposal(Number(target.dataset.proposal));return;}
  if(target.dataset.reject!==undefined){captureEditor();proposals[Number(target.dataset.reject)].decision="reject";render();toast(t("rejected"));return;}
  if(target.dataset.command!==undefined){const c=commandMatches[Number(target.dataset.command)];closeModal();if(c.page)navigate(c.page);else if(c.chapter)openChapter(c.chapter);else action(c.action);return;}
  if(target.dataset.action)action(target.dataset.action);
});
document.addEventListener("input",ev=>{
  const target=ev.target;
  if(target.id==="draft-prose"||target.closest?.("#draft-prose")){captureEditor();state.dirty.add(state.chapter);state.confirmed.delete(state.chapter);updateDraftStatus();}
  if(target.id==="ai-input")state.composer=target.value;
  if(target.id==="chapter-search")document.querySelector("#chapter-list").innerHTML=chapterList(target.value);
  if(target.id==="planning-search")document.querySelector("#chapter-board").innerHTML=boardHTML(target.value);
  if(target.id==="library-search")document.querySelector("#library-rows").innerHTML=libraryRows(target.value.trim());
  if(target.id==="command-input")filterCommands(target.value);
  if(target.matches('input[type="range"][data-setting]'))setAppearance(target.dataset.setting,target.value);
});
document.addEventListener("change",ev=>{
  const target=ev.target;
  if(target.id==="background-file")loadBackgroundImage(target.files[0]);
  if(target.matches('select[data-setting]'))setAppearance(target.dataset.setting,target.value);
});
document.addEventListener("submit",ev=>{
  if(ev.target.id==="ai-form"){ev.preventDefault();captureEditor();const text=state.composer.trim();if(!text){toast(t("emptyPrompt"));return;}state.chat.push(text.slice(0,2000));state.composer="";state.inspectorTab="suggestions";render();const content=document.querySelector("#inspector-content");content.scrollTop=content.scrollHeight;document.querySelector("#ai-input").focus();}
  if(ev.target.id==="blueprint-form"){ev.preventDefault();const title=document.querySelector("#blueprint-title").value.trim();const goal=document.querySelector("#blueprint-goal").value.trim();if(!title){toast(t("requiredTitle"));return;}state.extraBlueprints.push({id:10+state.extraBlueprints.length,title,goal:goal||t("planned"),status:"planned"});closeModal();navigate("planning");toast(t("created"));}
});
document.addEventListener("keydown",ev=>{
  const shortcut=ev.ctrlKey||ev.metaKey;
  if(shortcut&&ev.key.toLowerCase()==="k"){ev.preventDefault();if(modal.open)closeModal();else if(windowState.display==="open"){if(windowState.appearanceOpen)closeAppearance();captureEditor();commandPalette();}}
  if(shortcut&&ev.key.toLowerCase()==="s"){ev.preventDefault();if(!modal.open&&windowState.display==="open"&&state.page==="writing")action("save");}
  if(ev.key==="F11"){ev.preventDefault();if(!modal.open&&windowState.display==="open"){if(windowState.appearanceOpen)closeAppearance();action("focus");}}
  if(ev.key==="Escape"&&!modal.open){if(windowState.appearanceOpen)closeAppearance();else if(state.focus)action("focus");else if(state.navOpen)action("menu");else if(state.aiOpen&&programWindow.clientWidth<1100)action("toggle-ai");}
  if(ev.target.id==="command-input"&&ev.key==="ArrowDown"){ev.preventDefault();document.querySelector(".command-row")?.focus();}
  if(ev.target.id==="command-input"&&ev.key==="Enter"&&commandMatches.length){ev.preventDefault();document.querySelector(".command-row")?.click();}
  if(ev.target.classList.contains("command-row")&&["ArrowDown","ArrowUp"].includes(ev.key)){ev.preventDefault();const next=ev.key==="ArrowDown"?ev.target.nextElementSibling:ev.target.previousElementSibling;(next||document.querySelector("#command-input"))?.focus();}
  if(ev.target.id==="ai-input"&&shortcut&&ev.key==="Enter"){ev.preventDefault();document.querySelector("#ai-form").requestSubmit();}
});
// Paste is plain text; the demo never inserts user-supplied HTML.
document.addEventListener("paste",ev=>{if(ev.target.closest?.("#draft-prose")){ev.preventDefault();const text=ev.clipboardData.getData("text/plain");const selection=window.getSelection();if(selection.rangeCount){const range=selection.getRangeAt(0);range.deleteContents();const node=document.createTextNode(text);range.insertNode(node);range.setStartAfter(node);range.collapse(true);selection.removeAllRanges();selection.addRange(range);document.querySelector("#draft-prose").dispatchEvent(new Event("input",{bubbles:true}));}}});
render();
