/**
 * 字典分片 · automation —— 写作自动化（D 档：触发器 / 收件箱 / 设置）
 *
 * ⚠️ 条目形状与其他分片一致（`'key': { 'zh-CN', 'en-US', 'ru-RU' }`），由
 * src/shared/locale-data/index.ts 用对象展开合并回同一个扁平对象。
 */
export const automationTexts = {
  // ===== 触发器产出的标题 / 摘要（收件箱卡片直接展示） =====
  'automation.schedule.hourly': { 'zh-CN': '每 {n} 小时', 'en-US': 'every {n} hours', 'ru-RU': 'каждые {n} ч' },
  'automation.schedule.daily': { 'zh-CN': '每天 {time}', 'en-US': 'daily at {time}', 'ru-RU': 'ежедневно в {time}' },
  'automation.schedule.weekly': { 'zh-CN': '每周第 {day} 天 {time}', 'en-US': 'weekly on day {day} at {time}', 'ru-RU': 'еженедельно в день {day} в {time}' },
  'automation.schedule.monthly': { 'zh-CN': '每月 {day} 日 {time}', 'en-US': 'monthly on day {day} at {time}', 'ru-RU': 'ежемесячно {day} числа в {time}' },
  'automation.trigger.scheduleTitle': { 'zh-CN': '定时：{desc}', 'en-US': 'Scheduled: {desc}', 'ru-RU': 'По расписанию: {desc}' },
  'automation.trigger.scheduleSummary': { 'zh-CN': '{desc} 到点（{time}）', 'en-US': '{desc} came due ({time})', 'ru-RU': 'Сработало {desc} ({time})' },
  'automation.trigger.chapterBatchTitle': { 'zh-CN': '第 {from}-{to} 章已成批', 'en-US': 'Chapters {from}-{to} are ready as a batch', 'ru-RU': 'Главы {from}-{to} готовы как пакет' },
  'automation.trigger.chapterBatchSummary': { 'zh-CN': '第 {from}-{to} 章已成批（{count} 章 / {words} 字），可运行后续处理', 'en-US': 'Chapters {from}-{to} form a batch ({count} chapters / {words} words) — ready for post-processing', 'ru-RU': 'Главы {from}-{to} образуют пакет ({count} глав / {words} слов) — готово к постобработке' },
  'automation.trigger.manualTitle': { 'zh-CN': '手动运行：{name}', 'en-US': 'Manual run: {name}', 'ru-RU': 'Ручной запуск: {name}' },
  'automation.trigger.manualSummary': { 'zh-CN': '由「立即运行」触发', 'en-US': 'Triggered by "Run now"', 'ru-RU': 'Запущено кнопкой «Запустить сейчас»' },
  'automation.trigger.semanticTitle': { 'zh-CN': '条件成立', 'en-US': 'Condition matched', 'ru-RU': 'Условие выполнено' },

  // ===== 收件箱 =====
  'automation.inbox.tab': { 'zh-CN': '收件箱', 'en-US': 'Inbox', 'ru-RU': 'Входящие' },
  'automation.inbox.confirmRun': { 'zh-CN': '确认运行', 'en-US': 'Run it', 'ru-RU': 'Запустить' },
  'automation.inbox.dismiss': { 'zh-CN': '忽略', 'en-US': 'Dismiss', 'ru-RU': 'Отклонить' },
  'automation.inbox.notifyOnly': { 'zh-CN': '仅提醒', 'en-US': 'Notice only', 'ru-RU': 'Только уведомление' },
  'automation.inbox.moreEvidence': { 'zh-CN': '还有 {n} 条', 'en-US': '{n} more', 'ru-RU': 'ещё {n}' },
  'automation.inbox.empty': { 'zh-CN': '暂无自动化提醒', 'en-US': 'No automation notices', 'ru-RU': 'Нет уведомлений автоматизации' },

  // ===== 设置页 =====
  'automation.settings.title': { 'zh-CN': '自动化', 'en-US': 'Automation', 'ru-RU': 'Автоматизация' },
  'automation.settings.desc': { 'zh-CN': '按触发器自动执行工作流或 Agent 任务；产出可入收件箱等待确认、直接运行、或仅提醒', 'en-US': 'Run workflows or Agent tasks on triggers; results can wait in the inbox, run directly, or just notify', 'ru-RU': 'Запуск workflow или задач агента по триггерам; результат может ждать во входящих, выполняться сразу или только уведомлять' },
  'automation.settings.empty': { 'zh-CN': '还没有自动化任务', 'en-US': 'No automation tasks yet', 'ru-RU': 'Задач автоматизации пока нет' },
  'automation.settings.newTask': { 'zh-CN': '新建自动化', 'en-US': 'New automation', 'ru-RU': 'Новая автоматизация' },
  'automation.settings.runNow': { 'zh-CN': '立即运行', 'en-US': 'Run now', 'ru-RU': 'Запустить' },
  'automation.settings.edit': { 'zh-CN': '编辑', 'en-US': 'Edit', 'ru-RU': 'Изменить' },
  'automation.settings.name': { 'zh-CN': '名称', 'en-US': 'Name', 'ru-RU': 'Название' },
  'automation.settings.namePlaceholder': { 'zh-CN': '如：每 3 章跑后处理', 'en-US': 'e.g. post-process every 3 chapters', 'ru-RU': 'напр. постобработка каждые 3 главы' },
  'automation.settings.targetType': { 'zh-CN': '执行目标', 'en-US': 'Target', 'ru-RU': 'Цель' },
  'automation.settings.targetWorkflow': { 'zh-CN': '运行工作流', 'en-US': 'Run a workflow', 'ru-RU': 'Запустить workflow' },
  'automation.settings.targetAgent': { 'zh-CN': '发起 Agent 任务', 'en-US': 'Start an Agent task', 'ru-RU': 'Задача агента' },
  'automation.settings.workflowRef': { 'zh-CN': '工作流（JSON：{type, params}）', 'en-US': 'Workflow (JSON: {type, params})', 'ru-RU': 'Workflow (JSON: {type, params})' },
  'automation.settings.workflowRefPlaceholder': { 'zh-CN': '{"type":"post_process"}', 'en-US': '{"type":"post_process"}', 'ru-RU': '{"type":"post_process"}' },
  'automation.settings.prompt': { 'zh-CN': '任务提示词', 'en-US': 'Task prompt', 'ru-RU': 'Промпт задачи' },
  'automation.settings.promptPlaceholder': { 'zh-CN': '如：根据大纲续写下一章', 'en-US': 'e.g. continue the next chapter from the outline', 'ru-RU': 'напр. продолжить следующую главу по плану' },
  'automation.settings.triggerType': { 'zh-CN': '触发器', 'en-US': 'Trigger', 'ru-RU': 'Триггер' },
  'automation.settings.trigger_chapter_batch': { 'zh-CN': '每 N 章', 'en-US': 'Every N chapters', 'ru-RU': 'Каждые N глав' },
  'automation.settings.trigger_schedule': { 'zh-CN': '定时', 'en-US': 'Schedule', 'ru-RU': 'Расписание' },
  'automation.settings.trigger_semantic': { 'zh-CN': '语义条件', 'en-US': 'Semantic condition', 'ru-RU': 'Семантическое условие' },
  'automation.settings.trigger_manual': { 'zh-CN': '仅手动', 'en-US': 'Manual only', 'ru-RU': 'Только вручную' },
  'automation.settings.batchSize': { 'zh-CN': '每批章节数', 'en-US': 'Chapters per batch', 'ru-RU': 'Глав в пакете' },
  'automation.settings.scheduleHour': { 'zh-CN': '每天触发时刻（小时）', 'en-US': 'Daily hour', 'ru-RU': 'Час запуска' },
  'automation.settings.semanticCondition': { 'zh-CN': '条件（自然语言）', 'en-US': 'Condition (natural language)', 'ru-RU': 'Условие (естественный язык)' },
  'automation.settings.semanticPlaceholder': { 'zh-CN': '如：未回收伏笔超过 20 条', 'en-US': 'e.g. more than 20 unresolved foreshadowings', 'ru-RU': 'напр. более 20 неразрешённых предвестий' },
  'automation.settings.actionPolicy': { 'zh-CN': '处置方式', 'en-US': 'Action policy', 'ru-RU': 'Политика действия' },
  'automation.settings.policy_auto_run': { 'zh-CN': '直接运行', 'en-US': 'Run automatically', 'ru-RU': 'Запускать сразу' },
  'automation.settings.policy_confirm': { 'zh-CN': '入收件箱待确认', 'en-US': 'Ask in inbox', 'ru-RU': 'Спрашивать во входящих' },
  'automation.settings.policy_notify_only': { 'zh-CN': '仅提醒不执行', 'en-US': 'Notify only', 'ru-RU': 'Только уведомлять' },
  'automation.settings.save': { 'zh-CN': '保存', 'en-US': 'Save', 'ru-RU': 'Сохранить' },
  'automation.settings.cancel': { 'zh-CN': '取消', 'en-US': 'Cancel', 'ru-RU': 'Отмена' },
  'automation.settings.batchSummary': { 'zh-CN': '每 {n} 章', 'en-US': 'every {n} chapters', 'ru-RU': 'каждые {n} глав' },
  'automation.settings.scheduleSummary': { 'zh-CN': '定时', 'en-US': 'scheduled', 'ru-RU': 'по расписанию' },
  'automation.settings.semanticSummary': { 'zh-CN': '语义条件', 'en-US': 'semantic condition', 'ru-RU': 'семантическое условие' },
  'automation.settings.manualSummary': { 'zh-CN': '仅手动', 'en-US': 'manual only', 'ru-RU': 'только вручную' },
}
