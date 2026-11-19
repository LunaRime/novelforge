const messages = {
  'zh-CN': {
    loading: ['正在打开工作台…'],
    slow: ['正在打开工作台…', '这次启动比平时稍长。'],
    failed: ['工作台未能打开', '可以重新尝试载入应用。'],
    retry: '重新尝试',
  },
  'en-US': {
    loading: ['Opening the workspace…'],
    slow: ['Opening the workspace…', 'This is taking a little longer than usual.'],
    failed: ['Unable to open the workspace', 'Try loading the app again.'],
    retry: 'Try again',
  },
  'ru-RU': {
    loading: ['Открываем рабочее пространство…'],
    slow: ['Открываем рабочее пространство…', 'Запуск занимает больше времени, чем обычно.'],
    failed: ['Не удалось открыть рабочее пространство', 'Попробуйте загрузить приложение ещё раз.'],
    retry: 'Повторить попытку',
  },
}

const stage = document.querySelector('.program-window')
const paper = document.querySelector('.startup-paper')
const statusLine = document.querySelector('.startup-state')
const detail = document.querySelector('.startup-detail')
const progress = document.querySelector('.startup-progress')
const retry = document.querySelector('.startup-retry')
const mark = document.querySelector('.startup-mark img')
const fallback = document.querySelector('.startup-mark span')
const stateSelect = document.querySelector('#preview-state')
const themeSelect = document.querySelector('#preview-theme')
const languageSelect = document.querySelector('#preview-language')

function render() {
  const state = stateSelect.value
  const locale = languageSelect.value
  const copy = messages[locale]
  const [title, description = ''] = copy[state]
  const failed = state === 'failed'

  stage.dataset.mode = themeSelect.value
  stage.lang = locale
  paper.dataset.state = state
  statusLine.textContent = title
  detail.textContent = description
  detail.hidden = description === ''
  progress.hidden = failed
  retry.hidden = !failed
  retry.textContent = copy.retry
}

// 评审稿的 Logo 独立维护，单独打开启动样板时仍可看见字标占位。
function showMark() {
  if (mark.naturalWidth === 0) return
  mark.hidden = false
  fallback.hidden = true
}
mark.addEventListener('load', showMark)
if (mark.complete) showMark()

for (const control of [stateSelect, themeSelect, languageSelect]) {
  control.addEventListener('change', render)
}
retry.addEventListener('click', () => {
  stateSelect.value = 'loading'
  render()
  stateSelect.focus()
})
render()
