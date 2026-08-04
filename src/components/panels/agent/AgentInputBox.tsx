import { useRef, useState, useEffect, useCallback } from 'react'
import {
  Plus,
  ChevronDown,
  ArrowRight,
  Square,
  FileText,
  AtSign,
  Workflow,
  BrainCircuit,
  Zap,
  Gauge,
  Flame,
} from 'lucide-react'
import type { TextKey } from '../../../shared/locale'
import { useAgentStore, type AgentMode } from '../../../stores/agent-store'
import { useLLMStore } from '../../../stores/llm-store'
import type { ModelProfile } from '../../../shared/ipc-channels'
import { useOutsideClick } from '../../../hooks/useOutsideClick'
import { useTranslation } from '../../../hooks/useTranslation'
import SlashCommandMenu from './SlashCommandMenu'
import MentionMenu from './MentionMenu'
import FilePickerMenu from './FilePickerMenu'
import type { SlashCommand, MentionTarget } from '../../../services/agent/intent-router'

/** 输入框最大高度（px），超出后框内滚动 */
const MAX_HEIGHT = 200

/**
 * 思考等级（Claude Code effort 风格：六个独立等级胶囊，选中高亮）
 * 每个等级是独立 AgentMode（quick/swift/balanced/reflective/deep/max）——
 * 引擎提示词六分支，等级之间行为有真实差异
 */
const DEPTH_LEVELS: Array<{
  level: number
  mode: AgentMode
  labelKey: TextKey
  descKey: TextKey
}> = [
  { level: 1, mode: 'quick', labelKey: 'agent.depthL1', descKey: 'agent.depthL1Desc' },
  { level: 2, mode: 'swift', labelKey: 'agent.depthL2', descKey: 'agent.depthL2Desc' },
  { level: 3, mode: 'balanced', labelKey: 'agent.depthL3', descKey: 'agent.depthL3Desc' },
  { level: 4, mode: 'reflective', labelKey: 'agent.depthL4', descKey: 'agent.depthL4Desc' },
  { level: 5, mode: 'deep', labelKey: 'agent.depthL5', descKey: 'agent.depthL5Desc' },
  { level: 6, mode: 'max', labelKey: 'agent.depthL6', descKey: 'agent.depthL6Desc' },
]

/** 等级图标（输入框工具栏按钮；低档闪电 → 高档火焰） */
function depthIcon(mode: AgentMode): React.ReactNode {
  if (mode === 'max') {
    return <Flame size={13} strokeWidth={1.5} className="flex-shrink-0" style={{ color: 'var(--color-warning)' }} />
  }
  if (mode === 'deep' || mode === 'reflective') {
    return <BrainCircuit size={13} strokeWidth={1.5} className="flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
  }
  if (mode === 'balanced' || mode === 'swift') {
    return <Gauge size={13} strokeWidth={1.5} className="flex-shrink-0" style={{ color: 'var(--color-accent)' }} />
  }
  return <Zap size={13} strokeWidth={1.5} className="flex-shrink-0" style={{ color: 'var(--color-warning, #eab308)' }} />
}

/**
 * Agent 输入框组件（参考 agent1.html 第 69-155 行）
 * 卡片式圆角容器，底部工具栏含模式/模型/发送
 */
export default function AgentInputBox() {
  const [inputText, setInputText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { t } = useTranslation()
  const { generating, sendMessage, cancelGeneration, getActiveConversation, setMode, setModelId } = useAgentStore()
  const defaultMode = useAgentStore(s => s.defaultMode)
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)

  // 过滤出非仅限 embedding 专用的模型
  const chatModels = models.filter(m => !(m.purposes.length === 1 && m.purposes[0] === 'embedding'))

  const activeConv = getActiveConversation()
  // 无会话时回退 defaultMode（setMode 无会话只更新 defaultMode）——
  // 否则无会话时拉条拖动后 value 不变（拉不动）
  const currentMode = activeConv?.mode ?? defaultMode
  const currentModelId = activeConv?.modelId ?? defaultModelId

  // 找到当前模型信息
  const currentModel = models.find(m => m.id === currentModelId)

  // 下拉菜单状态
  const [showContextMenu, setShowContextMenu] = useState(false)
  const [showModeMenu, setShowModeMenu] = useState(false)
  const [showModelMenu, setShowModelMenu] = useState(false)
  // 可视化添加文件选择器（+ 菜单 → 添加文件）
  const [showFilePicker, setShowFilePicker] = useState(false)

  // / 命令和 @ 提及菜单状态
  const [showSlashMenu, setShowSlashMenu] = useState(false)
  const [slashQuery, setSlashQuery] = useState('')
  const [showMentionMenu, setShowMentionMenu] = useState(false)
  const [mentionQuery, setMentionQuery] = useState('')

  // 检测输入是否触发 / 或 @ 菜单
  const handleInputChange = useCallback((value: string) => {
    setInputText(value)

    // 检测 / 命令
    if (value.startsWith('/')) {
      const q = value.slice(1).split(' ')[0] ?? ''
      setSlashQuery(q)
      setShowSlashMenu(true)
      setShowMentionMenu(false)
    } else {
      setShowSlashMenu(false)
    }

    // 检测 @ 提及（在光标位置前面找 @）
    const lastAt = value.lastIndexOf('@')
    if (lastAt >= 0) {
      const afterAt = value.slice(lastAt + 1)
      // @ 后跟空格或中文标点（如"@世界观.md，帮我看看"）视为提及已结束——
      // 只按空格判断会误触发空结果菜单并吞掉回车导致无法发送
      if (!/[\s，。！？；：、（）]/.test(afterAt)) {
        setMentionQuery(afterAt)
        setShowMentionMenu(true)
        setShowSlashMenu(false)
      } else {
        setShowMentionMenu(false)
      }
    } else {
      setShowMentionMenu(false)
    }
  }, [])

  // 选择 / 命令
  const handleSlashSelect = useCallback((cmd: SlashCommand) => {
    setShowSlashMenu(false)
    if (cmd.source === 'skill') {
      // Skill 命令：替换为 /skill-name 后面可以加参数
      setInputText(`/${cmd.name} `)
    } else {
      // 内置命令：直接发送
      setInputText('')
      sendMessage(`/${cmd.name}`)
    }
    textareaRef.current?.focus()
  }, [sendMessage])

  // 选择 @ 提及
  const handleMentionSelect = useCallback((target: MentionTarget) => {
    setShowMentionMenu(false)
    // 替换最后一个 @ 及其后面的文字为 @提及文本
    // （固定目标用 displayName；文件目标用相对路径，发送时可解析回文件）
    const lastAt = inputText.lastIndexOf('@')
    if (lastAt >= 0) {
      const before = inputText.slice(0, lastAt)
      setInputText(`${before}@${target.insertText ?? target.displayName} `)
    }
    textareaRef.current?.focus()
  }, [inputText])

  const contextRef = useRef<HTMLDivElement>(null)
  const modeRef = useRef<HTMLDivElement>(null)
  const modelRef = useRef<HTMLDivElement>(null)
  const filePickerRef = useRef<HTMLDivElement>(null)

  // 调整文本框高度的通用函数
  const adjustHeight = useCallback(() => {
    const ta = textareaRef.current
    if (!ta) return
    // 先重置为 0px，让 scrollHeight 正确反映内容高度，避免 flex 布局拉伸导致计算出很大的初始高度
    ta.style.height = '0px'
    const next = Math.min(Math.max(ta.scrollHeight, 36), MAX_HEIGHT)
    ta.style.height = next + 'px'
    // 超出最大高度时框内滚动，否则隐藏滚动条
    ta.style.overflowY = ta.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden'
  }, [])

  // 监听尺寸变化以重新计算高度，避免刚挂载时宽度未稳定导致的 placeholder 异常换行撑起高度
  useEffect(() => {
    const ta = textareaRef.current
    if (!ta) {
      adjustHeight()
      return
    }
    const ro = new ResizeObserver(() => {
      adjustHeight()
    })
    ro.observe(ta)
    
    // 初始化调用一次即可
    adjustHeight()

    return () => ro.disconnect()
  }, [adjustHeight])

  // 内容变化时重新调整高度
  useEffect(() => {
    adjustHeight()
  }, [inputText, adjustHeight])

  // 点击外部关闭下拉（用 useOutsideClick 统一管理三个 ref）
  useOutsideClick(contextRef, () => setShowContextMenu(false), showContextMenu)
  useOutsideClick(modeRef, () => setShowModeMenu(false), showModeMenu)
  useOutsideClick(modelRef, () => setShowModelMenu(false), showModelMenu)
  useOutsideClick(filePickerRef, () => setShowFilePicker(false), showFilePicker)

  /** 可视化选择文件后追加 "@路径 " 到输入框（与 @ 提及同解析/预取链路） */
  const handleFileSelect = useCallback((path: string) => {
    setShowFilePicker(false)
    setInputText(prev => `${prev.trimEnd()}${prev.trimEnd() ? ' ' : ''}@${path} `)
    textareaRef.current?.focus()
  }, [setShowFilePicker])

  /** 发送或停止 */
  const handleSendOrStop = useCallback(async () => {
    if (generating) {
      await cancelGeneration()
      return
    }
    if (!inputText.trim()) return
    const text = inputText
    setInputText('')
    await sendMessage(text)
  }, [generating, inputText, sendMessage, cancelGeneration])

  /** 键盘事件：Enter 发送，Shift+Enter 换行 */
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // / 或 @ 菜单打开时，由菜单组件处理键盘事件
    if (showSlashMenu || showMentionMenu) {
      if (['ArrowUp', 'ArrowDown', 'Enter'].includes(e.key)) {
        return // 让菜单组件通过 window 事件处理
      }
      if (e.key === 'Escape') {
        setShowSlashMenu(false)
        setShowMentionMenu(false)
        return
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendOrStop()
    }
  }

  const canSend = !generating && inputText.trim().length > 0

  return (
    <div
      className="relative flex flex-col gap-0 p-1.5"
      style={{
        backgroundColor: 'var(--color-hover)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',  /* 4px 方正风格 */
      }}
    >
      {/* / 命令菜单 */}
      {showSlashMenu && (
        <SlashCommandMenu
          query={slashQuery}
          onSelect={handleSlashSelect}
          onClose={() => setShowSlashMenu(false)}
        />
      )}

      {/* @ 提及菜单 */}
      {showMentionMenu && (
        <MentionMenu
          query={mentionQuery}
          onSelect={handleMentionSelect}
          onClose={() => setShowMentionMenu(false)}
        />
      )}

      {/* 可视化文件选择器（+ 菜单 → 添加文件） */}
      {showFilePicker && (
        <div ref={filePickerRef}>
          <FilePickerMenu
            onSelect={handleFileSelect}
            onClose={() => setShowFilePicker(false)}
          />
        </div>
      )}

      {/* 输入区域 */}
      <div className="relative w-full">
          <textarea
            ref={textareaRef}
            value={inputText}
            onChange={e => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('agent.placeholder')}
            rows={1}
            className="w-full resize-none outline-none bg-transparent text-xs leading-relaxed px-2 py-2"
            style={{
              color: 'var(--color-text)',
              minHeight: 36,
              maxHeight: MAX_HEIGHT,
              overflowY: 'hidden',
              display: 'block',
            }}
          />
        {/* 占位文字颜色已通过 tailwind placeholder 设置 */}
      </div>

      {/* 底部工具栏 */}
      <div className="flex items-center justify-between gap-1 px-1 mt-0.5">

        {/* 左侧工具按钮组 */}
        <div className="flex items-center gap-0.5 min-w-0 flex-1">

          {/* + 添加上下文（菜单必须包裹在 contextRef 内——否则点击菜单项时
              mousedown 被 useOutsideClick 判定为外部点击并卸载菜单，
              浏览器不再派发 click，菜单项 onClick 永不执行） */}
          <div ref={contextRef} className="relative">
            <ToolbarIconBtn
              title={t('tip.addContext')}
              onClick={() => {
                setShowModeMenu(false)
                setShowModelMenu(false)
                setShowFilePicker(false)
                setShowContextMenu(v => !v)
              }}
            >
              <Plus size={14} />
            </ToolbarIconBtn>

            {/* 上下文菜单（+ 按钮弹出） */}
            {showContextMenu && (
              <div
                className="absolute bottom-[calc(100%+8px)] left-0 z-[var(--z-dropdown)] py-1 rounded-lg shadow-lg"
                style={{
                  width: 180,
                  backgroundColor: 'var(--color-sidebar)',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                }}
              >
                <div className="text-[0.7rem] px-3 pb-1 pt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {t('tip.addContext')}
                </div>
                {/* 可视化添加文件：打开文件选择器，选择后以 @路径 追加到输入框 */}
                <ContextMenuItem icon={<FileText size={13} />} label={t('agent.addFile')} onClick={() => {
                  setShowContextMenu(false)
                  setShowFilePicker(true)
                }} />
                <ContextMenuItem icon={<AtSign size={13} />} label={t('agent.atMention')} onClick={() => {
                  setShowContextMenu(false)
                  // 插入 @ 字符并触发 MentionMenu（handleInputChange 与 setInputText 用同源值，
                  // 避免闭包旧值在连续点击时丢字符）
                  const next = inputText + '@'
                  setInputText(next)
                  handleInputChange(next)
                  textareaRef.current?.focus()
                }} />
                <ContextMenuItem icon={<Workflow size={13} />} label={t('agent.workflowCmd')} onClick={() => {
                  setShowContextMenu(false)
                  // 插入 / 字符并触发 SlashCommandMenu
                  const next = '/'
                  setInputText(next)
                  handleInputChange(next)
                  textareaRef.current?.focus()
                }} />
              </div>
            )}
          </div>

          {/* 思考等级选择（图标式：档位图标 + 等级名 + 下拉；弹出六档拉条面板） */}
          <div ref={modeRef} className="relative">
            <button
              onClick={() => {
                setShowContextMenu(false)
                setShowModelMenu(false)
                setShowFilePicker(false)
                setShowModeMenu(v => !v)
              }}
              className="flex items-center gap-1 py-1 pl-1 pr-1.5 rounded-md text-xs transition-colors"
              style={{
                color: 'var(--color-text-secondary)',
                opacity: 0.75,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = 'var(--color-hover)'
                e.currentTarget.style.opacity = '1'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.opacity = '0.75'
              }}
            >
              {depthIcon(currentMode)}
              <span className="select-none font-medium">
                {t((DEPTH_LEVELS.find(l => l.mode === currentMode) ?? DEPTH_LEVELS[0]).labelKey)}
              </span>
              <ChevronDown size={12} strokeWidth={1.5} className="flex-shrink-0 opacity-60" />
            </button>

            {/* 思考等级面板（温度滑块式：等比例紧凑 + 首末节点被条包裹 + 适度特效） */}
            {showModeMenu && (() => {
              const currentLv = DEPTH_LEVELS.find(l => l.mode === currentMode) ?? DEPTH_LEVELS[0]
              // 滑块条高 = 大圆直径（thumb 上下限与条贴齐内嵌）
              const TRACK_H = 18
              // 大圆半径：大圆端点与条边完全贴合（内切）；首末节点小点仍被条包裹（4px 点在 9px 处，左缘 7px）
              const INSET = TRACK_H / 2
              const isMax = currentLv.level === 6
              // 含内缩的档位位置（大圆圆心）：calc(9px + (100% - 18px) * frac)
              const posCalc = (level: number, minusHalf?: boolean) =>
                `calc(${INSET}px + ((100% - ${INSET * 2}px) * ${((level - 1) / 5).toFixed(3)})${minusHalf ? ' - 2px' : ''})`
              // 温度计填充宽度 = 大圆圆心位置（填充延伸进大圆左半，大圆作为填充的球头——
              // 填充层 z 高于大圆 → 半透明渐变罩住大圆左半 → "深度绑定"一体视觉）
              const fillWidth = `calc(${INSET}px + ((100% - ${INSET * 2}px) * ${((currentLv.level - 1) / 5).toFixed(3)}))`

              return (
                <div
                  className="absolute bottom-full left-0 mb-1 z-[var(--z-dropdown)] p-2.5 rounded-lg shadow-lg"
                  style={{
                    width: 210,
                    backgroundColor: 'var(--color-sidebar)',
                    border: '1px solid var(--color-border)',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                  }}
                >
                  {/* 标题行：思考等级 + 当前档位名 */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[0.7rem] font-medium" style={{ color: 'var(--color-text)' }}>
                      {t('agent.depthTitle')}
                    </span>
                    <span className="text-[0.7rem] font-semibold" style={{ color: isMax ? 'var(--color-warning)' : 'var(--color-accent)' }}>
                      {t(currentLv.labelKey)} · {currentLv.level}/6
                    </span>
                  </div>

                  {/* 温度滑块：轨道条 + 温度计填充（延伸进大圆）+ 六节点小点 + 自定义大圆（球头） */}
                  <div className="relative" style={{ height: TRACK_H }}>
                    {/* 轨道条（纯背景） */}
                    <div
                      className="absolute inset-0 rounded-full"
                      style={{ backgroundColor: 'var(--color-border)' }}
                    />

                    {/* 已滑过区域（温度计填充：右端 = 大圆圆心，盖住大圆左半 → 与大圆一体；
                        拖动时由 onChange 直接写 DOM 同帧） */}
                    <div
                      className="depth-fill absolute left-0 top-0 bottom-0"
                      style={{
                        width: fillWidth,
                        borderRadius: '999px 0 0 999px',
                        zIndex: 1,
                        background: isMax
                          ? 'linear-gradient(to right, rgba(var(--color-warning-rgb), 0.15), rgba(var(--color-warning-rgb), 0.55))'
                          : 'linear-gradient(to right, rgba(var(--color-accent-rgb), 0.12), rgba(var(--color-accent-rgb), 0.5))',
                      }}
                    />

                    {/* 六节点（未滑到 = 缩小点；已滑过 = accent 淡点；当前档被大圆覆盖 → 隐藏；首末点被条包裹） */}
                    {DEPTH_LEVELS.map(lv => {
                      const lit = lv.level <= currentLv.level
                      const hidden = lv.level === currentLv.level
                      return (
                        <span
                          key={lv.level}
                          className="absolute top-1/2 -translate-y-1/2 rounded-full pointer-events-none"
                          style={{
                            left: posCalc(lv.level, true),
                            width: 4,
                            height: 4,
                            zIndex: 2,
                            backgroundColor: lit ? 'var(--color-accent)' : 'var(--color-text-muted)',
                            opacity: hidden ? 0 : (lit ? 0.85 : 0.4),
                            boxShadow: lit ? '0 0 3px rgba(var(--color-accent-rgb), 0.6)' : undefined,
                          }}
                        />
                      )
                    })}

                    {/* 自定义大圆（球头：位置 JS 精确计算——圆心 = INSET + (100%-2*INSET)×frac，
                        端点圆心 = INSET = 半径 → 外缘与条边完全贴合；z 低于填充 →
                        左半被填充半透明渐变罩住（深度绑定一体视觉）；拖动时 onChange 同帧直写） */}
                    <div
                      className={`depth-thumb absolute rounded-full pointer-events-none ${isMax ? 'depth-thumb--max' : ''}`}
                      style={{
                        width: TRACK_H,
                        height: TRACK_H,
                        left: `calc(${INSET}px + ((100% - ${INSET * 2}px) * ${((currentLv.level - 1) / 5).toFixed(3)}) - ${TRACK_H / 2}px)`,
                        top: 0,
                        zIndex: 0,
                        backgroundColor: isMax ? 'var(--color-warning)' : 'var(--color-accent)',
                        // 边框与中心同色（不再用 sidebar 白/浅色外圈），仅保留 1px 外描边定界
                        border: `2px solid ${isMax ? 'var(--color-warning)' : 'var(--color-accent)'}`,
                        boxShadow: '0 0 0 1px var(--color-border), 0 2px 6px rgba(0,0,0,0.25)',
                      }}
                    />

                    {/* 交互层：透明 range（仅捕获拖动/点击；opacity 0 不影响交互） */}
                    <input
                      type="range"
                      min={1}
                      max={6}
                      step={1}
                      value={currentLv.level}
                      onChange={e => {
                        const lv = DEPTH_LEVELS[parseInt(e.target.value, 10) - 1]
                        setMode(lv.mode)
                        // 同帧 DOM 直写：大圆 + 填充跟随（不经 React 渲染，无帧延迟）
                        const wrap = e.currentTarget.parentElement
                        const thumb = wrap?.querySelector<HTMLElement>('.depth-thumb')
                        const fill = wrap?.querySelector<HTMLElement>('.depth-fill')
                        const frac = ((lv.level - 1) / 5).toFixed(3)
                        if (thumb) {
                          thumb.style.left = `calc(${INSET}px + ((100% - ${INSET * 2}px) * ${frac}) - ${TRACK_H / 2}px)`
                        }
                        if (fill) {
                          fill.style.width = `calc(${INSET}px + ((100% - ${INSET * 2}px) * ${frac}))`
                        }
                      }}
                      className="depth-slider absolute top-0 bottom-0"
                      style={{ left: `${INSET}px`, right: `${INSET}px`, opacity: 0, zIndex: 3 }}
                    />
                  </div>

                  {/* 当前等级说明（固定 2 行高度 + 截断 → 面板高度恒定，滑块不上下跳动） */}
                  <div
                    className="mt-2 text-[0.6rem] leading-relaxed overflow-hidden"
                    style={{
                      color: 'var(--color-text-muted)',
                      minHeight: 31,
                      display: '-webkit-box',
                      WebkitBoxOrient: 'vertical',
                      WebkitLineClamp: 2,
                    }}
                  >
                    {t(currentLv.descKey)}
                  </div>
                </div>
              )
            })()}
          </div>

          {/* 模型选择 */}
          <div ref={modelRef} className="relative min-w-0">
            <button
              onClick={() => {
                setShowContextMenu(false)
                setShowModeMenu(false)
                setShowFilePicker(false)
                setShowModelMenu(v => !v)
              }}
              className="flex items-center gap-0.5 py-1 pl-0.5 pr-1.5 rounded-md text-xs min-w-0 transition-colors"
              style={{
                color: 'var(--color-text-secondary)',
                opacity: 0.75,
                maxWidth: 140,
              }}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = 'var(--color-hover)'
                e.currentTarget.style.opacity = '1'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.opacity = '0.75'
              }}
            >
              <ChevronDown size={13} strokeWidth={1.5} className="flex-shrink-0" />
              <span className="truncate select-none">
                {currentModel?.name ?? (chatModels.length === 0 ? t('statusbar.noModel') : t('agent.selectModel'))}
              </span>
            </button>

            {/* 模型选择下拉 */}
            {showModelMenu && (
              <div
                className="absolute bottom-full left-0 mb-1 z-[var(--z-dropdown)] py-1 rounded-lg shadow-lg"
                style={{
                  width: 220,
                  backgroundColor: 'var(--color-sidebar)',
                  border: '1px solid var(--color-border)',
                  boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
                  maxHeight: 280,
                  overflowY: 'auto',
                }}
              >
                <div className="text-[0.7rem] px-3 py-1" style={{ color: 'var(--color-text-muted)' }}>
                  {t('agent.selectModel')}
                </div>
                {chatModels.length === 0 ? (
                  <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('agent.noModel')}
                  </div>
                ) : (
                  chatModels.map(model => (
                    <ModelMenuItem
                      key={model.id}
                      model={model}
                      isActive={model.id === currentModelId}
                      onClick={() => {
                        setModelId(model.id)
                        setShowModelMenu(false)
                      }}
                    />
                  ))
                )}
              </div>
            )}
          </div>
        </div>

        {/* 右侧：发送/停止 */}
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleSendOrStop}
            disabled={!generating && !canSend}
            className="flex items-center justify-center w-6 h-6 transition-all duration-150"
            style={{
              borderRadius: 'var(--radius-md)',
              backgroundColor: generating
                ? 'var(--color-text-secondary)'
                : canSend
                ? 'var(--color-accent)'
                : 'rgba(128,128,128,0.3)',
              color: 'var(--color-text)',
              cursor: !generating && !canSend ? 'not-allowed' : 'pointer',
              opacity: !generating && !canSend ? 0.5 : 1,
            }}
            title={generating ? t('agent.stopGen') : t('agent.sendMsg')}
          >
            {generating ? (
              <Square size={10} fill="currentColor" />
            ) : (
              <ArrowRight size={13} strokeWidth={2.5} />
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ===== 子组件 =====

/** 工具栏图标按钮 */
function ToolbarIconBtn({
  children,
  title,
  onClick,
}: {
  children: React.ReactNode
  title: string
  onClick?: () => void
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex items-center justify-center p-1 rounded-full transition-colors"
      style={{ color: 'var(--color-text-secondary)', opacity: 0.75 }}
      onMouseEnter={e => {
        e.currentTarget.style.backgroundColor = 'var(--color-hover)'
        e.currentTarget.style.opacity = '1'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = 'transparent'
        e.currentTarget.style.opacity = '0.75'
      }}
    >
      {children}
    </button>
  )
}

/** 上下文菜单项 */
function ContextMenuItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  return (
    <button
      onClick={!disabled ? onClick : undefined}
      disabled={disabled}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors"
      style={{
        color: disabled ? 'var(--color-text-muted)' : 'var(--color-text)',
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={e => {
        if (!disabled) e.currentTarget.style.backgroundColor = 'var(--color-hover)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      <span style={{ color: 'var(--color-text-secondary)' }}>{icon}</span>
      {label}
      {disabled && <span className="ml-auto text-[0.7rem] opacity-40">{t('agent.comingSoon')}</span>}
    </button>
  )
}

/** 模型菜单项 */
function ModelMenuItem({
  model,
  isActive,
  onClick,
}: {
  model: ModelProfile
  isActive: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-3 py-1.5 text-xs transition-colors"
      style={{
        backgroundColor: isActive ? 'var(--color-hover)' : 'transparent',
      }}
      onMouseEnter={e => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'var(--color-hover)'
      }}
      onMouseLeave={e => {
        if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      <span
        className="font-medium truncate"
        style={{ color: 'var(--color-text)' }}
      >
        {model.name}
      </span>
      {model.provider && (
        <span
          className="ml-2 text-[0.7rem] px-1.5 py-0.5 rounded-full flex-shrink-0"
          style={{
            backgroundColor: 'var(--color-border)',
            color: 'var(--color-text-muted)',
          }}
        >
          {model.provider}
        </span>
      )}
    </button>
  )
}
