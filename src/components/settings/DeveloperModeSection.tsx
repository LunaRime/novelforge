/**
 * DeveloperModeSection — 开发者模式设置
 *
 * 接入外部程序 API（如本地浏览器服务）：配置基础地址 + 请求头 + 超时。
 * 启用后程序内 AI 可通过工具 call_external_api 调用该 API。
 * 安全：base URL 由主进程读取（LLM 只能传相对 path）；仅 http/https；响应 1MB 截断。
 */
import { useState, useEffect } from 'react'
import { Save, Loader2, Plug, ShieldAlert, HelpCircle } from 'lucide-react'
import { useTranslation } from '../../hooks/useTranslation'
import type { TextKey } from '../../shared/locale'
import { ipc } from '../../services/ipc-client'
import { Button } from '../ui/Button'
import { Input } from '../ui/Input'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../ui/Dialog'
import { toast } from '../ui/Toast'
import { renderLog } from '../../services/render-logger'
import type { GlobalConfig } from '../../shared/ipc-channels'

/** 默认超时（ms） */
const DEFAULT_TIMEOUT = 15000

export default function DeveloperModeSection() {
  const { t } = useTranslation()
  const [enabled, setEnabled] = useState(false)
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [headersText, setHeadersText] = useState('{}')
  const [timeoutMs, setTimeoutMs] = useState(DEFAULT_TIMEOUT)
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null)
  const [guideOpen, setGuideOpen] = useState(false)

  useEffect(() => {
    ipc.invoke('config:get').then((cfg) => {
      const dev = (cfg as GlobalConfig | null)?.devMode
      if (dev) {
        setEnabled(dev.enabled ?? false)
        setApiBaseUrl(dev.apiBaseUrl ?? '')
        setHeadersText(dev.headers ? JSON.stringify(dev.headers, null, 2) : '{}')
        setTimeoutMs(dev.timeoutMs ?? DEFAULT_TIMEOUT)
      }
    }).catch(() => { })
  }, [])

  /** 保存配置（JSON headers 校验） */
  const handleSave = async () => {
    let headers: Record<string, string> = {}
    try {
      const parsed = JSON.parse(headersText || '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        // 值类型校验：fetch 要求字符串值（数字/布尔会导致 undici 报错，难定位）
        if (Object.values(parsed).every(v => typeof v === 'string')) {
          headers = parsed as Record<string, string>
        } else {
          throw new Error('headers 值必须是字符串')
        }
      } else {
        throw new Error('headers 需为 JSON 对象')
      }
    } catch {
      toast.error(t('dev.headersInvalid'))
      return
    }
    const t0 = Date.now()
    setSaving(true)
    try {
      await ipc.invoke('config:set', {
        devMode: { enabled, apiBaseUrl: apiBaseUrl.trim(), headers, timeoutMs: timeoutMs || DEFAULT_TIMEOUT },
      })
      renderLog('info', 'Save:Settings', `开发者模式配置保存成功（${Date.now() - t0}ms）`)
      toast.success(t('save.success'))
    } catch (e) {
      renderLog('error', 'Save:Settings', `开发者模式配置保存失败: ${String(e)}`)
      toast.error(t('save.failed').replace('{error}', String(e)))
    }
    setSaving(false)
  }

  /** 测试连接 */
  const handleTest = async () => {
    setTesting(true)
    setTestResult(null)
    const res = await ipc.invoke('dev:test')
    setTesting(false)
    setTestResult(res.success
      ? { success: true }
      : { success: false, error: res.error })
  }

  return (
    <div className="space-y-4">
      {/* 启用开关 */}
      <div className="flex items-center justify-between p-3 rounded-xl" style={{ border: '1px solid var(--color-border)', backgroundColor: 'var(--color-panel)' }}>
        <div className="flex items-center gap-2 min-w-0">
          <Plug size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
          <span className="text-sm font-medium" style={{ color: 'var(--color-text)' }}>{t('dev.enabled')}</span>
        </div>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => setEnabled(e.target.checked)}
          className="w-4 h-4 accent-[var(--color-accent)] cursor-pointer flex-shrink-0"
        />
      </div>

      {/* 安全提示 */}
      <div className="flex items-start gap-2 p-3 rounded-xl text-xs" style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text-muted)' }}>
        <ShieldAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>{t('dev.hint')}</span>
      </div>

      {/* 配置表单 */}
      <div className="space-y-3">
        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('dev.apiBaseUrl')}</label>
          <Input
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
            placeholder="http://localhost:9223"
            className="h-8 text-xs"
          />
        </div>

        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('dev.headers')}</label>
          <textarea
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
            rows={4}
            className="w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-panel)] px-3 py-2 text-xs font-mono outline-none focus:border-[var(--color-accent)] resize-y"
            style={{ color: 'var(--color-text)' }}
            spellCheck={false}
          />
        </div>

        <div>
          <label className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>{t('dev.timeout')}</label>
          <Input
            type="number"
            value={timeoutMs}
            onChange={(e) => setTimeoutMs(Number(e.target.value))}
            className="h-8 text-xs w-40"
          />
        </div>
      </div>

      {/* 操作按钮 */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleTest} disabled={testing || !enabled}>
          {testing ? <Loader2 size={12} className="animate-spin" /> : <Plug size={12} />}
          {t('dev.test')}
        </Button>
        <Button variant="default" size="sm" onClick={handleSave} disabled={saving}>
          <Save size={12} />
          {t('action.save')}
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setGuideOpen(true)} title={t('dev.guide')}>
          <HelpCircle size={12} />
          {t('dev.guide')}
        </Button>
      </div>

      {/* 使用说明弹窗 */}
      <DevGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />

      {/* 测试结果 */}
      {testResult && (
        <div
          className={`text-xs p-2 rounded break-all ${
            testResult.success
              ? 'border border-[var(--color-success)]/20 text-[var(--color-success)]'
              : 'border border-[var(--color-error)]/20 text-[var(--color-error)]'
          }`}
          style={{ backgroundColor: testResult.success ? 'color-mix(in srgb, var(--color-success) 8%, transparent)' : 'color-mix(in srgb, var(--color-error) 8%, transparent)' }}
        >
          {testResult.success ? `✅ ${t('dev.testSuccess')}` : `❌ ${t('dev.testFailed').replace('{error}', testResult.error ?? '')}`}
        </div>
      )}
    </div>
  )
}

/** 使用说明弹窗（三步 + 示例 + 要点） */
function DevGuideDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation()
  const exampleBase = 'http://localhost:9223'
  const example1 = t('dev.guideEx1')
  const example2 = t('dev.guideEx2')
  const example3 = t('dev.guideEx3')

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader className="pr-10">
          <DialogTitle>{t('dev.guideTitle')}</DialogTitle>
        </DialogHeader>
        <div className="px-6 pb-5 space-y-4 text-xs leading-relaxed max-h-[60vh] overflow-y-auto" style={{ color: 'var(--color-text-secondary)' }}>
          {/* 步骤 1 */}
          <div>
            <div className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{t('dev.guideStep1Title')}</div>
            <div>{t('dev.guideStep1')}</div>
          </div>

          {/* 步骤 2：示例代码块 */}
          <div>
            <div className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{t('dev.guideStep2Title')}</div>
            <div className="mb-1">{t('dev.guideStep2')}</div>
            <pre
              className="p-2 rounded-lg font-mono text-[0.7rem] overflow-x-auto"
              style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-accent)' }}
            >
              {`API 基础地址: ${exampleBase}\n请求头: {}`}
            </pre>
          </div>

          {/* 步骤 3：AI 对话示例 */}
          <div>
            <div className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{t('dev.guideStep3Title')}</div>
            <div className="mb-1">{t('dev.guideStep3')}</div>
            <div className="space-y-1">
              {[example1, example2, example3].map((ex, i) => (
                <pre
                  key={i}
                  className="p-2 rounded-lg font-mono text-[0.7rem] overflow-x-auto whitespace-pre-wrap break-all"
                  style={{ backgroundColor: 'var(--color-hover)', color: 'var(--color-text)' }}
                >
                  {ex}
                </pre>
              ))}
            </div>
          </div>

          {/* 要点 */}
          <div>
            <div className="font-semibold mb-1" style={{ color: 'var(--color-text)' }}>{t('dev.guideTipsTitle')}</div>
            <ul className="space-y-1 list-disc pl-4">
              {[1, 2, 3, 4, 5].map(n => (
                <li key={n}>{t(`dev.guideTip${n}` as TextKey)}</li>
              ))}
            </ul>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
