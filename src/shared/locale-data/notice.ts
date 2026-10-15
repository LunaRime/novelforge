/**
 * 字典分片 · notice —— **本轮六项 UI 改动的新增文案集中区**（2026-10 新增分片）
 *
 * ⚠️ 为什么单独开一个分片：本轮有 5 个并行执行者各自需要新 key，而既有分片
 * （ui.ts / settings.ts / agent.ts / workflow.ts）是**共享文件** —— 同文件并发写会互相覆盖。
 * 新分片按**前缀分区**归属（同一文件内不重叠的区段），每条仍必须三语齐全。
 *
 * 前缀分区（只写自己那段）：
 * - `notice.*`     → 状态栏消息收纳中心
 * - `route.*`      → 模型路由（分层调度）排版与优先级弹窗
 * - `metric.*`     → 指标行（按功能个性化的 chip 行）
 * - `theme.*`      → 仅**新增**主题相关 key（既有 theme.starry/paper/dark/light/label 在 ui.ts，勿重复定义）
 * - `learning.*`   → 仅**新增**自学习压缩相关 key（既有 settings.learning* 在 ui.ts，勿重复定义）
 *
 * 条目形状与其它分片一致（`'key': { 'zh-CN', 'en-US', 'ru-RU' }`），由
 * src/shared/locale-data/index.ts 合并回同一个扁平对象。分片阈值见 i18n-structure-guard.test.ts。
 */
export const noticeTexts = {
  // ===== notice.* —— 状态栏「消息收纳」入口与弹层 =====
  'notice.bell': { 'zh-CN': '通知中心：{n} 条未读', 'en-US': 'Notifications: {n} unread', 'ru-RU': 'Уведомления: {n} непрочитанных' },
  'notice.bellNone': { 'zh-CN': '通知中心', 'en-US': 'Notifications', 'ru-RU': 'Уведомления' },
  'notice.title': { 'zh-CN': '通知中心', 'en-US': 'Notification center', 'ru-RU': 'Центр уведомлений' },
  'notice.runningSection': { 'zh-CN': '正在执行', 'en-US': 'Running now', 'ru-RU': 'Выполняется' },
  'notice.resultSection': { 'zh-CN': '任务结果', 'en-US': 'Task results', 'ru-RU': 'Результаты задач' },
  'notice.updateSection': { 'zh-CN': '应用更新', 'en-US': 'App updates', 'ru-RU': 'Обновления' },
  'notice.empty': { 'zh-CN': '暂无通知', 'en-US': 'No notifications', 'ru-RU': 'Уведомлений нет' },
  'notice.emptyHint': { 'zh-CN': '任务开始、结束与应用更新提醒会出现在这里', 'en-US': 'Running tasks, finished tasks and app updates show up here', 'ru-RU': 'Здесь появятся задачи, их результаты и обновления' },
  'notice.markAllRead': { 'zh-CN': '全部已读', 'en-US': 'Mark all read', 'ru-RU': 'Прочитать все' },
  'notice.dismiss': { 'zh-CN': '移除该通知', 'en-US': 'Dismiss', 'ru-RU': 'Убрать' },
  'notice.markRead': { 'zh-CN': '标记已读', 'en-US': 'Mark as read', 'ru-RU': 'Отметить прочитанным' },
  'notice.viewOutput': { 'zh-CN': '查看输出', 'en-US': 'View output', 'ru-RU': 'Открыть вывод' },
  'notice.viewTasks': { 'zh-CN': '任务面板', 'en-US': 'Tasks panel', 'ru-RU': 'Панель задач' },
  'notice.step': { 'zh-CN': '{done}/{total} 步', 'en-US': '{done}/{total} steps', 'ru-RU': '{done}/{total} шагов' },
  'notice.runFailed': { 'zh-CN': '任务失败：{title}', 'en-US': 'Task failed: {title}', 'ru-RU': 'Задача не выполнена: {title}' },
  'notice.runDone': { 'zh-CN': '任务完成：{title}', 'en-US': 'Task finished: {title}', 'ru-RU': 'Задача завершена: {title}' },
  'notice.runDoneLabel': { 'zh-CN': '已完成', 'en-US': 'Done', 'ru-RU': 'Готово' },
  'notice.runFailedLabel': { 'zh-CN': '失败', 'en-US': 'Failed', 'ru-RU': 'Ошибка' },
  'notice.runStatusRunning': { 'zh-CN': '执行中', 'en-US': 'Running', 'ru-RU': 'Выполняется' },
  'notice.runStatusWaiting': { 'zh-CN': '等待确认', 'en-US': 'Waiting', 'ru-RU': 'Ожидание' },
  'notice.runStatusPaused': { 'zh-CN': '已暂停', 'en-US': 'Paused', 'ru-RU': 'Приостановлено' },
  'notice.updateAvailable': { 'zh-CN': '发现新版本 v{version}', 'en-US': 'New version v{version} available', 'ru-RU': 'Доступна новая версия v{version}' },
  'notice.updateDownloaded': { 'zh-CN': 'v{version} 已下载，重启后安装', 'en-US': 'v{version} downloaded — restart to install', 'ru-RU': 'v{version} загружена — перезапустите для установки' },
  'notice.updateFailed': { 'zh-CN': '更新检查失败', 'en-US': 'Update check failed', 'ru-RU': 'Не удалось проверить обновления' },
  'notice.download': { 'zh-CN': '下载', 'en-US': 'Download', 'ru-RU': 'Скачать' },
  'notice.downloading': { 'zh-CN': '下载中 {percent}%', 'en-US': 'Downloading {percent}%', 'ru-RU': 'Загрузка {percent}%' },
  'notice.restartInstall': { 'zh-CN': '重启安装', 'en-US': 'Restart & install', 'ru-RU': 'Перезапустить и установить' },
  'notice.openRelease': { 'zh-CN': '查看版本说明', 'en-US': 'Release notes', 'ru-RU': 'Описание версии' },
  'notice.unreadMany': { 'zh-CN': '99+', 'en-US': '99+', 'ru-RU': '99+' },

  // ===== route.* —— 模型路由（分层调度） =====
  'route.editPriority': { 'zh-CN': '编辑优先级', 'en-US': 'Edit priority', 'ru-RU': 'Изменить приоритет' },
  'route.tierCount': { 'zh-CN': '{n} 个模型', 'en-US': '{n} models', 'ru-RU': '{n} моделей' },
  'route.tierEmpty': { 'zh-CN': '未指定（回退默认模型）', 'en-US': 'Unset (falls back to the default model)', 'ru-RU': 'Не задано (используется модель по умолчанию)' },
  // ⚠️ 原 `route.tierFirst`（首选 {name}）与 `route.moreCount`（+{n}）已删除（2026-10-16 用户要求）：
  //    卡片上**不再显示模型型号与优先级序号**，名单/顺序一律进「编辑优先级」弹窗看。不要再加回来。
  'route.dialogTitle': { 'zh-CN': '设置「{tier}」层的模型与优先级', 'en-US': 'Models and priority for the "{tier}" tier', 'ru-RU': 'Модели и приоритет уровня «{tier}»' },
  'route.dialogHint': { 'zh-CN': '勾选加入该层；序号 1 最先尝试，失败或超限时按序号依次回退。一个都不勾 = 该层回退到默认模型。', 'en-US': 'Tick to add a model to this tier. Number 1 is tried first; on failure or limit the next number is used. None ticked = this tier falls back to the default model.', 'ru-RU': 'Отметьте модели для этого уровня. Номер 1 пробуется первым, далее по порядку. Если ничего не отмечено — уровень использует модель по умолчанию.' },
  'route.selectedTitle': { 'zh-CN': '已选（顺序即优先级）', 'en-US': 'Selected (order = priority)', 'ru-RU': 'Выбрано (порядок = приоритет)' },
  'route.candidatesTitle': { 'zh-CN': '可选模型', 'en-US': 'Available models', 'ru-RU': 'Доступные модели' },
  'route.moveUp': { 'zh-CN': '上移一位', 'en-US': 'Move up', 'ru-RU': 'Вверх' },
  'route.moveDown': { 'zh-CN': '下移一位', 'en-US': 'Move down', 'ru-RU': 'Вниз' },
  'route.removeModel': { 'zh-CN': '从该层移除', 'en-US': 'Remove from tier', 'ru-RU': 'Убрать из уровня' },
  'route.noCandidates': { 'zh-CN': '没有可用的生成模型（先在「AI 模型」里添加）', 'en-US': 'No generation models available (add one under AI models first)', 'ru-RU': 'Нет доступных моделей генерации (сначала добавьте в «AI-модели»)' },
  'route.priority': { 'zh-CN': '优先级 {n}', 'en-US': 'Priority {n}', 'ru-RU': 'Приоритет {n}' },

  // ===== metric.* —— 指标行（按功能个性化的 chip） =====
  'metric.compactions': { 'zh-CN': '压缩', 'en-US': 'compactions', 'ru-RU': 'сжатий' },
  'metric.skipped': { 'zh-CN': '跳过', 'en-US': 'skipped', 'ru-RU': 'пропущено' },
  'metric.truncations': { 'zh-CN': '截断', 'en-US': 'truncated', 'ru-RU': 'обрезано' },
  'metric.fidelityWarns': { 'zh-CN': '保真告警', 'en-US': 'fidelity warnings', 'ru-RU': 'предупреждений' },
  'metric.reverts': { 'zh-CN': '移除', 'en-US': 'removed', 'ru-RU': 'удалено' },
  'metric.regenerations': { 'zh-CN': '重生成', 'en-US': 'regenerations', 'ru-RU': 'перегенераций' },
  'metric.compactionsHint': { 'zh-CN': '自学习开启后实际完成的历史压缩次数', 'en-US': 'Compactions actually performed since learning was enabled', 'ru-RU': 'Сколько сжатий выполнено с момента включения обучения' },
  'metric.skippedHint': { 'zh-CN': '因降幅低于阈值而跳过的次数（本轮历史按预算截断）', 'en-US': 'Times compaction was skipped because the reduction was below the threshold (history was truncated to budget)', 'ru-RU': 'Сколько раз сжатие пропущено из-за малого сокращения (история обрезана по бюджету)' },
  'metric.truncationsHint': { 'zh-CN': '注入上下文时被硬截断的消息数（说明预算偏紧）', 'en-US': 'Messages hard-truncated when injecting context (budget is tight)', 'ru-RU': 'Сообщений жёстко обрезано при сборке контекста (бюджет тесен)' },
  'metric.fidelityWarnsHint': { 'zh-CN': '摘要可能丢失了关键信息的告警数', 'en-US': 'Warnings that a summary may have lost key information', 'ru-RU': 'Предупреждений о возможной потере важной информации' },
  'metric.revertsHint': { 'zh-CN': '你手动移除压缩批次的次数（学习系统据此调低激进程度）', 'en-US': 'Times you manually removed a compaction batch (learning becomes less aggressive)', 'ru-RU': 'Сколько раз вы вручную удалили сжатый пакет (обучение станет осторожнее)' },
  'metric.regenerationsHint': { 'zh-CN': '摘要重生成的次数（会话级失效后重建）', 'en-US': 'Summary regenerations (rebuilds after invalidation)', 'ru-RU': 'Перегенераций сводки после инвалидации' },
  'metric.workflowSteps': { 'zh-CN': '步骤', 'en-US': 'steps', 'ru-RU': 'шагов' },
  'metric.workflowStepsHint': { 'zh-CN': '所有运行中任务的已完成 / 总步骤数', 'en-US': 'Completed / total steps across running tasks', 'ru-RU': 'Выполнено / всего шагов во всех задачах' },
  'metric.runningTasks': { 'zh-CN': '运行中', 'en-US': 'running', 'ru-RU': 'выполняется' },
  'metric.runningTasksHint': { 'zh-CN': '当前并发执行的任务数', 'en-US': 'Tasks running concurrently', 'ru-RU': 'Задач выполняется одновременно' },

  // ===== ccr.* 明细面板（DSH ContextMeter 同款形态，2026-10-16）=====
  // ⚠️ 既有 `ccr.*` key 在 locale-data/agent.ts（同一前缀、不同分片）—— 本段只放这次新增的。
  'ccr.panelTitle': { 'zh-CN': '上下文已用 {percent}', 'en-US': '{percent} of context used', 'ru-RU': 'Использовано {percent} контекста' },
  'ccr.usedOf': { 'zh-CN': '已用 / 上限', 'en-US': 'used / limit', 'ru-RU': 'использовано / лимит' },
  'ccr.barHint': { 'zh-CN': '色条按四段占比着色，总长即占用百分比', 'en-US': 'The bar is tinted by the four sections; its length is the occupancy percentage', 'ru-RU': 'Полоса окрашена по четырём секциям; её длина — процент заполнения' },
  'ccr.moreSegments': { 'zh-CN': '其它 {n} 段', 'en-US': '{n} more sections', 'ru-RU': 'Ещё секций: {n}' },

  // ===== theme.* / learning.* —— 仅新增（既有 key 在 ui.ts） =====
  'theme.appearance': { 'zh-CN': '界面主题', 'en-US': 'Appearance', 'ru-RU': 'Оформление' },
  'theme.appearanceDesc': { 'zh-CN': '选中即生效；与右侧图标栏底部的主题菜单同源，改一处两处同步', 'en-US': 'Applies immediately; same source as the theme menu at the bottom of the right activity bar', 'ru-RU': 'Применяется сразу; тот же источник, что и меню темы на правой панели' },
  'theme.applied': { 'zh-CN': '当前主题', 'en-US': 'Current', 'ru-RU': 'Текущая' },
  'theme.palettePreview': { 'zh-CN': '当前主题的配色预览', 'en-US': 'Palette preview in the current theme', 'ru-RU': 'Предпросмотр палитры в текущей теме' },
  'learning.summaryShort': { 'zh-CN': '默认关闭；只影响之后的压缩，可随时重置。', 'en-US': 'Off by default; affects future compactions only and can be reset anytime.', 'ru-RU': 'По умолчанию выключено; влияет только на будущие сжатия и сбрасывается в любой момент.' },
  'learning.signals': { 'zh-CN': '学习信号：跳过 / 硬截断 / 保真缺失 / 用户移除', 'en-US': 'Signals: skips / hard truncations / fidelity misses / user reverts', 'ru-RU': 'Сигналы: пропуски / обрезка / потери точности / отмены' },
  'learning.effect': { 'zh-CN': '调整范围：仅「最小有效降幅」的倍率（±50% 以内），并把学到的保留/省略要求追加到摘要提示。', 'en-US': 'Scope: only the minimum-reduction multiplier (within ±50%), plus learned keep/omit requirements appended to the summary prompt.', 'ru-RU': 'Область: только множитель минимального сокращения (±50%) и выученные требования к сводке.' },
  'learning.noTraining': { 'zh-CN': '不训练模型、不额外调用 LLM；所有调整写日志、可一键重置。', 'en-US': 'No model training, no extra LLM calls; every adjustment is logged and resettable.', 'ru-RU': 'Без обучения модели и лишних вызовов LLM; все изменения журналируются и сбрасываются.' },
  'learning.resetScope': { 'zh-CN': '重置只清空学习到的偏好（统计 / 规则 / 倍率），原始文稿与已压缩历史不受影响。', 'en-US': 'Reset clears learned preferences only (stats / rules / multiplier); drafts and compacted history are untouched.', 'ru-RU': 'Сброс очищает только выученные предпочтения (статистика / правила / множитель); тексты и сжатая история не затрагиваются.' },
} as const
