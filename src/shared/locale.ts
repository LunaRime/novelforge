/**
 * 国际化可扩展层 — Locale 配置与格式化工具
 *
 * 支持 zh-CN / en-US / ru-RU 三语动态切换。
 * 语言偏好保存在 localStorage 中，运行时通过 setCurrentLocale() 切换。
 */

// ===== locale 持久化 =====

const LOCALE_STORAGE_KEY = 'novelforge-locale'

function loadLocalePref(): string | null {
  try { return localStorage.getItem(LOCALE_STORAGE_KEY) }
  catch { return null }
}

function saveLocalePref(locale: string): void {
  try { localStorage.setItem(LOCALE_STORAGE_KEY, locale) }
  catch { /* localStorage 不可用时静默忽略 */ }
}

// ===== 语言配置 =====

/** 备选 locale 列表（UI 可切换的目标语言） */
export const SUPPORTED_LOCALES = ['zh-CN', 'en-US', 'ru-RU'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

/** locale 友好标签（用于语言选择下拉） */
export const LOCALE_LABELS: Record<SupportedLocale, string> = {
  'zh-CN': '中文',
  'en-US': 'English',
  'ru-RU': 'Русский',
}

/** 默认 locale（注意：已废弃，请用 getCurrentLocale()） */
export const DEFAULT_LOCALE: SupportedLocale = 'zh-CN'

let currentLocale: SupportedLocale = (loadLocalePref() as SupportedLocale) || DEFAULT_LOCALE

/** 获取当前运行时 locale */
export function getCurrentLocale(): SupportedLocale {
  return currentLocale
}

/** 切换 locale 并持久化 */
export function setCurrentLocale(locale: SupportedLocale): void {
  if (SUPPORTED_LOCALES.includes(locale)) {
    currentLocale = locale
    saveLocalePref(locale)
  }
}

// ===== 格式化工具 =====

/** 日期格式化（仅日期，无时间） */
export function formatLocaleDate(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleDateString(currentLocale, options)
}

/** 时间格式化（仅时间） */
export function formatLocaleTime(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleTimeString(currentLocale, options)
}

/** 日期+时间格式化 */
export function formatLocaleDateTime(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleString(currentLocale, options)
}

/** 中文友好的字符串比较（用于文件/目录排序） */
export function compareLocaleStrings(
  a: string,
  b: string,
  options?: { numeric?: boolean },
): number {
  return a.localeCompare(b, currentLocale, options)
}

// ===== UI 翻译字典 =====

/** 翻译记录类型 — 每个键必须覆盖所有 SupportedLocale */
type Texts = Record<string, Record<SupportedLocale, string>>

/** 通用 UI 文案字典 — 新增文案时同步添加 en-US + ru-RU 翻译 */
export const UI_TEXTS: Texts = {
  // 通用操作 (ru: инфинитив)
  'action.save': { 'zh-CN': '保存', 'en-US': 'Save', 'ru-RU': 'Сохранить' },
  'action.cancel': { 'zh-CN': '取消', 'en-US': 'Cancel', 'ru-RU': 'Отмена' },
  'action.confirm': { 'zh-CN': '确认', 'en-US': 'Confirm', 'ru-RU': 'Подтвердить' },
  'action.close': { 'zh-CN': '关闭', 'en-US': 'Close', 'ru-RU': 'Закрыть' },
  'action.delete': { 'zh-CN': '删除', 'en-US': 'Delete', 'ru-RU': 'Удалить' },
  'action.export': { 'zh-CN': '导出', 'en-US': 'Export', 'ru-RU': 'Экспорт' },
  'action.import': { 'zh-CN': '导入', 'en-US': 'Import', 'ru-RU': 'Импорт' },
  'action.refresh': { 'zh-CN': '刷新', 'en-US': 'Refresh', 'ru-RU': 'Обновить' },
  'action.retry': { 'zh-CN': '重试', 'en-US': 'Retry', 'ru-RU': 'Повторить' },
  'action.search': { 'zh-CN': '搜索', 'en-US': 'Search', 'ru-RU': 'Поиск' },
  'action.create': { 'zh-CN': '新建', 'en-US': 'Create', 'ru-RU': 'Создать' },
  'action.edit': { 'zh-CN': '编辑', 'en-US': 'Edit', 'ru-RU': 'Изменить' },
  'action.copy': { 'zh-CN': '复制', 'en-US': 'Copy', 'ru-RU': 'Копировать' },

  // 面板标签
  'panel.tasks': { 'zh-CN': '任务', 'en-US': 'Tasks', 'ru-RU': 'Задачи' },
  'panel.log': { 'zh-CN': '日志', 'en-US': 'Log', 'ru-RU': 'Журнал' },
  'panel.models': { 'zh-CN': '模型调用', 'en-US': 'Model Calls', 'ru-RU': 'Вызовы моделей' },
  'panel.sidebar': { 'zh-CN': '导航侧边栏', 'en-US': 'Navigation Sidebar', 'ru-RU': 'Боковая панель' },
  'panel.editor': { 'zh-CN': '主编辑区', 'en-US': 'Editor', 'ru-RU': 'Редактор' },
  'panel.ai': { 'zh-CN': 'AI 对话面板', 'en-US': 'AI Panel', 'ru-RU': 'Панель ИИ' },
  'panel.bottom': { 'zh-CN': '底部任务面板', 'en-US': 'Bottom Panel', 'ru-RU': 'Нижняя панель' },

  // 状态
  'status.loading': { 'zh-CN': '加载中...', 'en-US': 'Loading...', 'ru-RU': 'Загрузка...' },
  'status.saving': { 'zh-CN': '保存中...', 'en-US': 'Saving...', 'ru-RU': 'Сохранение...' },
  'status.noData': { 'zh-CN': '暂无数据', 'en-US': 'No data', 'ru-RU': 'Нет данных' },
  'status.noLogs': { 'zh-CN': '暂无日志', 'en-US': 'No logs', 'ru-RU': 'Нет записей' },
  'status.noRecords': { 'zh-CN': '暂无调用记录', 'en-US': 'No call records', 'ru-RU': 'Нет вызовов' },
  'status.error': { 'zh-CN': '出错', 'en-US': 'Error', 'ru-RU': 'Ошибка' },
  'status.success': { 'zh-CN': '成功', 'en-US': 'Success', 'ru-RU': 'Успешно' },

  // 提示
  'tip.autoScrollOn': { 'zh-CN': '自动滚动: 开', 'en-US': 'Auto-scroll: ON', 'ru-RU': 'Авто-прокрутка: Вкл' },
  'tip.autoScrollOff': { 'zh-CN': '自动滚动: 关', 'en-US': 'Auto-scroll: OFF', 'ru-RU': 'Авто-прокрутка: Выкл' },
  'tip.clearLog': { 'zh-CN': '清空日志', 'en-US': 'Clear log', 'ru-RU': 'Очистить журнал' },
  'tip.repairFinalize': { 'zh-CN': '修复定稿', 'en-US': 'Repair Finalize', 'ru-RU': 'Исправить финал' },
  'tip.skipToContent': { 'zh-CN': '跳到主内容', 'en-US': 'Skip to content', 'ru-RU': 'К содержанию' },

  // 对话
  'dialog.newProject': { 'zh-CN': '新建项目', 'en-US': 'New Project', 'ru-RU': 'Новый проект' },
  'dialog.importNovel': { 'zh-CN': '导入小说', 'en-US': 'Import Novel', 'ru-RU': 'Импорт романа' },
  'dialog.exportNovel': { 'zh-CN': '导出小说', 'en-US': 'Export Novel', 'ru-RU': 'Экспорт романа' },
  'dialog.settings': { 'zh-CN': '设置', 'en-US': 'Settings', 'ru-RU': 'Настройки' },

  // 导航
  'nav.home': { 'zh-CN': '主页', 'en-US': 'Home', 'ru-RU': 'Главная' },
  'nav.projectTree': { 'zh-CN': '项目结构', 'en-US': 'Project Tree', 'ru-RU': 'Структура' },
  'nav.knowledgeBase': { 'zh-CN': '知识库', 'en-US': 'Knowledge Base', 'ru-RU': 'База знаний' },
  'nav.characters': { 'zh-CN': '角色管理', 'en-US': 'Characters', 'ru-RU': 'Персонажи' },

  // 缩放
  'zoom.in': { 'zh-CN': '放大', 'en-US': 'Zoom In', 'ru-RU': 'Увеличить' },
  'zoom.out': { 'zh-CN': '缩小', 'en-US': 'Zoom Out', 'ru-RU': 'Уменьшить' },

  // 状态栏
  'statusbar.cacheHit': { 'zh-CN': '缓存命中', 'en-US': 'Cache hit', 'ru-RU': 'Попадание кэша' },
  'statusbar.clickReset': { 'zh-CN': '点击重置', 'en-US': 'Click to reset', 'ru-RU': 'Сбросить' },
  'statusbar.calls': { 'zh-CN': '次', 'en-US': 'calls', 'ru-RU': 'выз.' },
  'statusbar.unsaved': { 'zh-CN': '有未保存的修改', 'en-US': 'Unsaved changes', 'ru-RU': 'Не сохранено' },

  // 错误
  'error.notElectron': { 'zh-CN': '不在 Electron 环境中', 'en-US': 'Not in Electron environment', 'ru-RU': 'Не в среде Electron' },
  'error.renderFailed': { 'zh-CN': '渲染失败', 'en-US': 'Render failed', 'ru-RU': 'Ошибка рендера' },
  'error.sidebarFailed': { 'zh-CN': '侧边栏渲染失败', 'en-US': 'Sidebar render failed', 'ru-RU': 'Ошибка боковой панели' },
  'error.editorFailed': { 'zh-CN': '编辑区渲染失败', 'en-US': 'Editor render failed', 'ru-RU': 'Ошибка редактора' },
  'error.aiPanelFailed': { 'zh-CN': 'AI 面板渲染失败', 'en-US': 'AI panel render failed', 'ru-RU': 'Ошибка панели ИИ' },
  'error.taskPanelFailed': { 'zh-CN': '任务面板渲染失败', 'en-US': 'Task panel render failed', 'ru-RU': 'Ошибка панели задач' },
  'error.dialogFailed': { 'zh-CN': '对话框渲染失败', 'en-US': 'Dialog render failed', 'ru-RU': 'Ошибка диалога' },
  'error.importCanceled': { 'zh-CN': '已取消生成', 'en-US': 'Generation cancelled', 'ru-RU': 'Генерация отменена' },

  // 字数
  'unit.chars': { 'zh-CN': '字', 'en-US': 'chars', 'ru-RU': 'зн.' },
  'unit.words': { 'zh-CN': '字数', 'en-US': 'Words', 'ru-RU': 'Слов' },
  'unit.chapters': { 'zh-CN': '章', 'en-US': 'ch', 'ru-RU': 'гл.' },

  // 表单
  'form.projectName': { 'zh-CN': '项目名称', 'en-US': 'Project Name', 'ru-RU': 'Название проекта' },
  'form.savePath': { 'zh-CN': '保存路径', 'en-US': 'Save Path', 'ru-RU': 'Путь сохранения' },
  'form.selectFolder': { 'zh-CN': '选择文件夹', 'en-US': 'Select Folder', 'ru-RU': 'Выбрать папку' },
  'form.selectFile': { 'zh-CN': '选择文件', 'en-US': 'Select File', 'ru-RU': 'Выбрать файл' },
  'form.filesSelected': { 'zh-CN': '个文件已选择', 'en-US': 'file(s) selected', 'ru-RU': 'файл(ов) выбрано' },

  // 导出
  'export.plainText': { 'zh-CN': '纯文本', 'en-US': 'Plain Text', 'ru-RU': 'Обычный текст' },
  'export.merged': { 'zh-CN': '合并', 'en-US': 'Merged', 'ru-RU': 'Объединить' },
  'export.perChapter': { 'zh-CN': '分章', 'en-US': 'Per Chapter', 'ru-RU': 'По главам' },
  'export.includeOutline': { 'zh-CN': '包含故事大纲', 'en-US': 'Include Outline', 'ru-RU': 'Включить план' },
  'export.chooseFormat': { 'zh-CN': '选择导出格式和目标目录', 'en-US': 'Choose export format and target directory', 'ru-RU': 'Выберите формат и папку' },
  'export.chooseAndExport': { 'zh-CN': '选择目录并导出', 'en-US': 'Choose directory and export', 'ru-RU': 'Выбрать папку и экспорт' },

  // 项目创建
  'project.createTitle': { 'zh-CN': '填写作品名称和保存位置', 'en-US': 'Enter project name and save location', 'ru-RU': 'Название и путь сохранения' },
  'project.creating': { 'zh-CN': '创建中...', 'en-US': 'Creating...', 'ru-RU': 'Создание...' },
  'project.selectNovelFiles': { 'zh-CN': '选择小说文件', 'en-US': 'Select Novel Files', 'ru-RU': 'Выбрать файлы романа' },
  'project.analyzingChapters': { 'zh-CN': '正在分析并拆分章节...', 'en-US': 'Analyzing and splitting chapters...', 'ru-RU': 'Анализ и разбивка глав...' },
  'project.total': { 'zh-CN': '共', 'en-US': 'Total', 'ru-RU': 'Всего' },
  'project.workName': { 'zh-CN': '作品名称', 'en-US': 'Work Name', 'ru-RU': 'Название' },
  'project.saveLocation': { 'zh-CN': '保存位置', 'en-US': 'Save Location', 'ru-RU': 'Расположение' },
  'project.chooseDir': { 'zh-CN': '选择项目保存目录', 'en-US': 'Choose project save directory', 'ru-RU': 'Папка проекта' },
  'project.creatingBtn': { 'zh-CN': '创建项目', 'en-US': 'Create Project', 'ru-RU': 'Создать проект' },

  // 导入
  'import.title': { 'zh-CN': '导入小说', 'en-US': 'Import Novel', 'ru-RU': 'Импорт романа' },
  'import.importing': { 'zh-CN': '导入中...', 'en-US': 'Importing...', 'ru-RU': 'Импорт...' },
  'import.startImport': { 'zh-CN': '开始导入', 'en-US': 'Start Import', 'ru-RU': 'Начать импорт' },
  'import.fileSelect': { 'zh-CN': '文件选择', 'en-US': 'File Selection', 'ru-RU': 'Выбор файлов' },
  'import.chapterPreview': { 'zh-CN': '拆章预览', 'en-US': 'Chapter Preview', 'ru-RU': 'Предпросмотр глав' },
  'import.autoPreview': { 'zh-CN': '自动拆章预览', 'en-US': 'Auto Chapter Preview', 'ru-RU': 'Авто-разбивка' },
  'import.chapterSplitFailed': { 'zh-CN': '拆章失败', 'en-US': 'Chapter split failed', 'ru-RU': 'Ошибка разбивки' },
  'import.importFailed': { 'zh-CN': '导入失败', 'en-US': 'Import failed', 'ru-RU': 'Ошибка импорта' },
  'import.costEstimate': { 'zh-CN': '成本预估', 'en-US': 'Cost Estimate', 'ru-RU': 'Оценка стоимости' },
  'import.estimatedTime': { 'zh-CN': '预计耗时', 'en-US': 'Estimated Time', 'ru-RU': 'Расчётное время' },
  'import.projectInfo': { 'zh-CN': '项目信息', 'en-US': 'Project Info', 'ru-RU': 'Информация' },
  'import.projectNameAfter': { 'zh-CN': '导入后的项目名称', 'en-US': 'Project name after import', 'ru-RU': 'Название после импорта' },
  'import.selectSavePath': { 'zh-CN': '选择保存路径', 'en-US': 'Select save path', 'ru-RU': 'Путь сохранения' },
  'import.executeImport': { 'zh-CN': '执行导入', 'en-US': 'Execute Import', 'ru-RU': 'Выполнить импорт' },
  'import.createSkeleton': { 'zh-CN': '创建项目骨架', 'en-US': 'Create project skeleton', 'ru-RU': 'Создать каркас' },
  'import.stepMode': { 'zh-CN': '步进模式', 'en-US': 'Step mode', 'ru-RU': 'Пошаговый режим' },
  'import.avgChars': { 'zh-CN': '平均', 'en-US': 'Avg', 'ru-RU': 'Сред.' },
  'import.estimate': { 'zh-CN': '预估', 'en-US': 'Estimate', 'ru-RU': 'Оценка' },
  'import.minutes': { 'zh-CN': '分钟', 'en-US': 'minutes', 'ru-RU': 'мин.' },
  'import.moreChapters': { 'zh-CN': '还有', 'en-US': 'more', 'ru-RU': 'ещё' },
  'import.chapterList': { 'zh-CN': '章节列表', 'en-US': 'Chapter list', 'ru-RU': 'Список глав' },

  // 章节创作表单
  'chapter.number': { 'zh-CN': '章节号', 'en-US': 'Chapter No.', 'ru-RU': '№ главы' },
  'chapter.title': { 'zh-CN': '章节标题', 'en-US': 'Chapter Title', 'ru-RU': 'Название главы' },
  'chapter.wordTarget': { 'zh-CN': '目标字数', 'en-US': 'Word Target', 'ru-RU': 'Цель: знаков' },
  'chapter.role': { 'zh-CN': '章节定位', 'en-US': 'Chapter Role', 'ru-RU': 'Роль главы' },
  'chapter.characters': { 'zh-CN': '出场角色', 'en-US': 'Characters', 'ru-RU': 'Персонажи' },
  'chapter.purpose': { 'zh-CN': '章节目的', 'en-US': 'Purpose', 'ru-RU': 'Цель главы' },
  'chapter.keyEvents': { 'zh-CN': '关键事件', 'en-US': 'Key Events', 'ru-RU': 'Ключевые события' },
  'chapter.authorGuidance': { 'zh-CN': '作者微操指导', 'en-US': 'Author Guidance', 'ru-RU': 'Указания автора' },
  'chapter.kbKeywords': { 'zh-CN': '知识库检索关键词', 'en-US': 'KB Search Keywords', 'ru-RU': 'Ключевые слова БЗ' },
  'chapter.optional': { 'zh-CN': '可选，', 'en-US': 'Optional, ', 'ru-RU': 'Опционально, ' },
  'chapter.pleaseConfigModel': { 'zh-CN': '请先配置 AI 模型', 'en-US': 'Please configure AI model first', 'ru-RU': 'Настройте модель ИИ' },
} as const

export type TextKey = keyof typeof UI_TEXTS

/** 获取当前 locale 下的翻译文本 */
export function t(key: TextKey): string {
  const entry = UI_TEXTS[key]
  if (!entry) return key
  return entry[currentLocale] ?? entry['zh-CN']
}
