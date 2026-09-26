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
}
