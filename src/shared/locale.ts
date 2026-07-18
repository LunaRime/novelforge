/**
 * 国际化可扩展层 — Locale 配置与格式化工具
 *
 * 当前默认使用 zh-CN（中文网文市场），未来可通过全局配置切换。
 * 所有日期/时间/数字/字符串比较的格式化都应通过此模块，而非硬编码 locale。
 *
 * 扩展方式：
 *   1. 修改 DEFAULT_LOCALE 或从 GlobalConfig.themeLocale 读取
 *   2. 新增翻译文案 → 使用 i18n 框架（react-i18next / 自建）
 *   3. 日期格式偏好 → 为每个 locale 预设 DateTimeFormat 默认值
 */

/** 当前默认 locale，未来可从用户配置读取 */
export const DEFAULT_LOCALE = 'zh-CN'

/** 备选 locale 列表（UI 可切换的目标语言） */
export const SUPPORTED_LOCALES = ['zh-CN', 'en-US'] as const
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number]

// ===== 格式化工具 =====

/** 日期格式化（仅日期，无时间） */
export function formatLocaleDate(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleDateString(DEFAULT_LOCALE, options)
}

/** 时间格式化（仅时间） */
export function formatLocaleTime(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleTimeString(DEFAULT_LOCALE, options)
}

/** 日期+时间格式化 */
export function formatLocaleDateTime(
  timestamp: number | string | Date,
  options?: Intl.DateTimeFormatOptions,
): string {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp)
  return date.toLocaleString(DEFAULT_LOCALE, options)
}

/** 中文友好的字符串比较（用于文件/目录排序） */
export function compareLocaleStrings(
  a: string,
  b: string,
  options?: { numeric?: boolean },
): number {
  return a.localeCompare(b, DEFAULT_LOCALE, options)
}

// ===== UI 翻译字典 =====

/** 翻译记录类型 */
type Texts = Record<string, Record<SupportedLocale, string>>

/** 通用 UI 文案字典 — 新增文案时同步添加 en-US 翻译 */
export const UI_TEXTS: Texts = {
  // 通用操作
  'action.save': { 'zh-CN': '保存', 'en-US': 'Save' },
  'action.cancel': { 'zh-CN': '取消', 'en-US': 'Cancel' },
  'action.confirm': { 'zh-CN': '确认', 'en-US': 'Confirm' },
  'action.close': { 'zh-CN': '关闭', 'en-US': 'Close' },
  'action.delete': { 'zh-CN': '删除', 'en-US': 'Delete' },
  'action.export': { 'zh-CN': '导出', 'en-US': 'Export' },
  'action.import': { 'zh-CN': '导入', 'en-US': 'Import' },
  'action.refresh': { 'zh-CN': '刷新', 'en-US': 'Refresh' },
  'action.retry': { 'zh-CN': '重试', 'en-US': 'Retry' },
  'action.search': { 'zh-CN': '搜索', 'en-US': 'Search' },
  'action.create': { 'zh-CN': '新建', 'en-US': 'Create' },
  'action.edit': { 'zh-CN': '编辑', 'en-US': 'Edit' },
  'action.copy': { 'zh-CN': '复制', 'en-US': 'Copy' },

  // 面板标签
  'panel.tasks': { 'zh-CN': '任务', 'en-US': 'Tasks' },
  'panel.log': { 'zh-CN': '日志', 'en-US': 'Log' },
  'panel.models': { 'zh-CN': '模型调用', 'en-US': 'Model Calls' },
  'panel.sidebar': { 'zh-CN': '导航侧边栏', 'en-US': 'Navigation Sidebar' },
  'panel.editor': { 'zh-CN': '主编辑区', 'en-US': 'Editor' },
  'panel.ai': { 'zh-CN': 'AI 对话面板', 'en-US': 'AI Panel' },
  'panel.bottom': { 'zh-CN': '底部任务面板', 'en-US': 'Bottom Panel' },

  // 状态
  'status.loading': { 'zh-CN': '加载中...', 'en-US': 'Loading...' },
  'status.saving': { 'zh-CN': '保存中...', 'en-US': 'Saving...' },
  'status.noData': { 'zh-CN': '暂无数据', 'en-US': 'No data' },
  'status.noLogs': { 'zh-CN': '暂无日志', 'en-US': 'No logs' },
  'status.noRecords': { 'zh-CN': '暂无调用记录', 'en-US': 'No call records' },
  'status.error': { 'zh-CN': '出错', 'en-US': 'Error' },
  'status.success': { 'zh-CN': '成功', 'en-US': 'Success' },

  // 提示
  'tip.autoScrollOn': { 'zh-CN': '自动滚动: 开', 'en-US': 'Auto-scroll: ON' },
  'tip.autoScrollOff': { 'zh-CN': '自动滚动: 关', 'en-US': 'Auto-scroll: OFF' },
  'tip.clearLog': { 'zh-CN': '清空日志', 'en-US': 'Clear log' },
  'tip.repairFinalize': { 'zh-CN': '修复定稿', 'en-US': 'Repair Finalize' },
  'tip.skipToContent': { 'zh-CN': '跳到主内容', 'en-US': 'Skip to content' },

  // 对话
  'dialog.newProject': { 'zh-CN': '新建项目', 'en-US': 'New Project' },
  'dialog.importNovel': { 'zh-CN': '导入小说', 'en-US': 'Import Novel' },
  'dialog.exportNovel': { 'zh-CN': '导出小说', 'en-US': 'Export Novel' },
  'dialog.settings': { 'zh-CN': '设置', 'en-US': 'Settings' },

  // 导航
  'nav.home': { 'zh-CN': '主页', 'en-US': 'Home' },
  'nav.projectTree': { 'zh-CN': '项目结构', 'en-US': 'Project Tree' },
  'nav.knowledgeBase': { 'zh-CN': '知识库', 'en-US': 'Knowledge Base' },
  'nav.characters': { 'zh-CN': '角色管理', 'en-US': 'Characters' },

  // 缩放
  'zoom.in': { 'zh-CN': '放大', 'en-US': 'Zoom In' },
  'zoom.out': { 'zh-CN': '缩小', 'en-US': 'Zoom Out' },

  // 状态栏
  'statusbar.cacheHit': { 'zh-CN': '缓存命中', 'en-US': 'Cache hit' },
  'statusbar.clickReset': { 'zh-CN': '点击重置', 'en-US': 'Click to reset' },
  'statusbar.calls': { 'zh-CN': '次', 'en-US': 'calls' },
  'statusbar.unsaved': { 'zh-CN': '有未保存的修改', 'en-US': 'Unsaved changes' },

  // 错误
  'error.notElectron': { 'zh-CN': '不在 Electron 环境中', 'en-US': 'Not in Electron environment' },
  'error.renderFailed': { 'zh-CN': '渲染失败', 'en-US': 'Render failed' },
  'error.sidebarFailed': { 'zh-CN': '侧边栏渲染失败', 'en-US': 'Sidebar render failed' },
  'error.editorFailed': { 'zh-CN': '编辑区渲染失败', 'en-US': 'Editor render failed' },
  'error.aiPanelFailed': { 'zh-CN': 'AI 面板渲染失败', 'en-US': 'AI panel render failed' },
  'error.taskPanelFailed': { 'zh-CN': '任务面板渲染失败', 'en-US': 'Task panel render failed' },
  'error.dialogFailed': { 'zh-CN': '对话框渲染失败', 'en-US': 'Dialog render failed' },
  'error.importCanceled': { 'zh-CN': '已取消生成', 'en-US': 'Generation cancelled' },

  // 字数
  'unit.chars': { 'zh-CN': '字', 'en-US': 'chars' },
  'unit.words': { 'zh-CN': '字数', 'en-US': 'Words' },
  'unit.chapters': { 'zh-CN': '章', 'en-US': 'ch' },

  // 表单
  'form.projectName': { 'zh-CN': '项目名称', 'en-US': 'Project Name' },
  'form.savePath': { 'zh-CN': '保存路径', 'en-US': 'Save Path' },
  'form.selectFolder': { 'zh-CN': '选择文件夹', 'en-US': 'Select Folder' },
  'form.selectFile': { 'zh-CN': '选择文件', 'en-US': 'Select File' },
  'form.filesSelected': { 'zh-CN': '个文件已选择', 'en-US': 'file(s) selected' },

  // 导出
  'export.plainText': { 'zh-CN': '纯文本', 'en-US': 'Plain Text' },
  'export.merged': { 'zh-CN': '合并', 'en-US': 'Merged' },
  'export.perChapter': { 'zh-CN': '分章', 'en-US': 'Per Chapter' },
  'export.includeOutline': { 'zh-CN': '包含故事大纲', 'en-US': 'Include Outline' },
  'export.chooseFormat': { 'zh-CN': '选择导出格式和目标目录', 'en-US': 'Choose export format and target directory' },
  'export.chooseAndExport': { 'zh-CN': '选择目录并导出', 'en-US': 'Choose directory and export' },

  // 项目创建
  'project.createTitle': { 'zh-CN': '填写作品名称和保存位置', 'en-US': 'Enter project name and save location' },
  'project.creating': { 'zh-CN': '创建中...', 'en-US': 'Creating...' },
  'project.selectNovelFiles': { 'zh-CN': '选择小说文件', 'en-US': 'Select Novel Files' },
  'project.analyzingChapters': { 'zh-CN': '正在分析并拆分章节...', 'en-US': 'Analyzing and splitting chapters...' },
  'project.total': { 'zh-CN': '共', 'en-US': 'Total' },
  'project.workName': { 'zh-CN': '作品名称', 'en-US': 'Work Name' },
  'project.saveLocation': { 'zh-CN': '保存位置', 'en-US': 'Save Location' },
  'project.chooseDir': { 'zh-CN': '选择项目保存目录', 'en-US': 'Choose project save directory' },
  'project.creatingBtn': { 'zh-CN': '创建项目', 'en-US': 'Create Project' },

  // 导入
  'import.title': { 'zh-CN': '导入小说', 'en-US': 'Import Novel' },
  'import.importing': { 'zh-CN': '导入中...', 'en-US': 'Importing...' },
  'import.startImport': { 'zh-CN': '开始导入', 'en-US': 'Start Import' },
  'import.fileSelect': { 'zh-CN': '文件选择', 'en-US': 'File Selection' },
  'import.chapterPreview': { 'zh-CN': '拆章预览', 'en-US': 'Chapter Preview' },
  'import.autoPreview': { 'zh-CN': '自动拆章预览', 'en-US': 'Auto Chapter Preview' },
  'import.chapterSplitFailed': { 'zh-CN': '拆章失败', 'en-US': 'Chapter split failed' },
  'import.importFailed': { 'zh-CN': '导入失败', 'en-US': 'Import failed' },
  'import.costEstimate': { 'zh-CN': '成本预估', 'en-US': 'Cost Estimate' },
  'import.estimatedTime': { 'zh-CN': '预计耗时', 'en-US': 'Estimated Time' },
  'import.projectInfo': { 'zh-CN': '项目信息', 'en-US': 'Project Info' },
  'import.projectNameAfter': { 'zh-CN': '导入后的项目名称', 'en-US': 'Project name after import' },
  'import.selectSavePath': { 'zh-CN': '选择保存路径', 'en-US': 'Select save path' },
  'import.executeImport': { 'zh-CN': '执行导入', 'en-US': 'Execute Import' },
  'import.createSkeleton': { 'zh-CN': '创建项目骨架', 'en-US': 'Create project skeleton' },
  'import.stepMode': { 'zh-CN': '步进模式', 'en-US': 'Step mode' },
  'import.avgChars': { 'zh-CN': '平均', 'en-US': 'Avg' },
  'import.estimate': { 'zh-CN': '预估', 'en-US': 'Estimate' },
  'import.minutes': { 'zh-CN': '分钟', 'en-US': 'minutes' },
  'import.moreChapters': { 'zh-CN': '还有', 'en-US': 'more' },
  'import.chapterList': { 'zh-CN': '章节列表', 'en-US': 'Chapter list' },

  // 章节创作表单
  'chapter.number': { 'zh-CN': '章节号', 'en-US': 'Chapter No.' },
  'chapter.title': { 'zh-CN': '章节标题', 'en-US': 'Chapter Title' },
  'chapter.wordTarget': { 'zh-CN': '目标字数', 'en-US': 'Word Target' },
  'chapter.role': { 'zh-CN': '章节定位', 'en-US': 'Chapter Role' },
  'chapter.characters': { 'zh-CN': '出场角色', 'en-US': 'Characters' },
  'chapter.purpose': { 'zh-CN': '章节目的', 'en-US': 'Purpose' },
  'chapter.keyEvents': { 'zh-CN': '关键事件', 'en-US': 'Key Events' },
  'chapter.authorGuidance': { 'zh-CN': '作者微操指导', 'en-US': 'Author Guidance' },
  'chapter.kbKeywords': { 'zh-CN': '知识库检索关键词', 'en-US': 'KB Search Keywords' },
  'chapter.optional': { 'zh-CN': '可选，', 'en-US': 'Optional, ' },
  'chapter.pleaseConfigModel': { 'zh-CN': '请先配置 AI 模型', 'en-US': 'Please configure AI model first' },
} as const

export type TextKey = keyof typeof UI_TEXTS

/**
 * 获取当前 locale 下的翻译文本
 * @param key 翻译键
 * @param locale 可选覆盖，默认使用 DEFAULT_LOCALE
 */
export function t(key: TextKey, locale?: SupportedLocale): string {
  const entry = UI_TEXTS[key]
  if (!entry) return key
  return entry[locale ?? DEFAULT_LOCALE as SupportedLocale] ?? entry['zh-CN']
}
