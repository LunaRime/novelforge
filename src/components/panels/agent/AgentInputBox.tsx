import { useRef, useState, useEffect, useCallback } from 'react'
import {
  Plus,
  ChevronDown,
  ArrowRight,
  Square,
  FileText,
  AtSign,
  Workflow,
  Sparkles,
  BrainCircuit,
  Zap,
  Gauge,
  Flame,
  type LucideIcon,
} from 'lucide-react'
import { useAgentStore } from '../../../stores/agent-store'
import { useLLMStore } from '../../../stores/llm-store'
import { useThinkingStore } from '../../../stores/thinking-store'
import { thinkingLevelSpec, type ThinkingLevel } from '../../../shared/thinking-level'
import { useOutsideClick } from '../../../hooks/useOutsideClick'
import { useEscapeKey } from '../../../hooks/useEscapeKey'
import { useFloatingPosition } from '../../../hooks/useFloatingPosition'
import { useTranslation } from '../../../hooks/useTranslation'
import { Badge } from '../../ui/Badge'
import { MenuItem } from '../../ui/MenuItem'
import SlashCommandMenu from './SlashCommandMenu'
import MentionMenu from './MentionMenu'
import FilePickerMenu from './FilePickerMenu'
import { PopoverSurface } from '../../ui/PopoverSurface'
import ThinkingLevelSlider from '../../ui/ThinkingLevelSlider'
import {
  getAllSlashCommands,
  type SlashCommand,
  type MentionTarget,
} from '../../../services/agent/intent-router'

/** 输入框最大高度（px），超出后框内滚动 */
const MAX_HEIGHT = 200

/** 档位图标（触发器徽章；与共享滑块一致：低档闪电 → 高档火焰） */
const LEVEL_ICONS: Record<ThinkingLevel, LucideIcon> = {
  off: Zap,
  low: Gauge,
  high: BrainCircuit,
  max: Flame,
}

/**
 * Agent 输入框组件（参考 agent1.html 第 69-155 行）
 * 卡片式圆角容器，底部工具栏含模式/模型/发送
 */
export default function AgentInputBox() {
  const [inputText, setInputText] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const { t } = useTranslation()
  // 原子 selector：action/原始值引用稳定，流式期间不随整 store 每 50ms 重渲染
  const generating = useAgentStore(s => s.generating)
  const sendMessage = useAgentStore(s => s.sendMessage)
  const cancelGeneration = useAgentStore(s => s.cancelGeneration)
  const setModelId = useAgentStore(s => s.setModelId)
  const models = useLLMStore(s => s.models)
  const defaultModelId = useLLMStore(s => s.defaultModelId)
  // 思考等级是全局配置（所有对话与 AI 调用共用），不随会话切换
  const level = useThinkingStore(s => s.level)
  const setLevel = useThinkingStore(s => s.setLevel)

  // 过滤出非仅限 embedding 专用的模型
  const chatModels = models.filter(m => !(m.purposes.length === 1 && m.purposes[0] === 'embedding'))

  // 活跃会话的 modelId（原始值 selector，流式期间值稳定，不触发重渲染）
  const activeModelId = useAgentStore(s => s.conversations.find(c => c.id === s.activeConversationId)?.modelId)
  const currentModelId = activeModelId ?? defaultModelId

  // 找到当前模型信息
  const currentModel = models.find(m => m.id === currentModelId)

  // 当前档位规格 + 图标（触发器徽章与滑块同源）
  const levelSpec = thinkingLevelSpec(level)
  const LevelIcon = LEVEL_ICONS[levelSpec.id]

  // 下拉菜单状态
  const [showContextMenu, setShowContextMenu] = useState(false)
  // 模型 + 思考等级合并弹窗（单一入口）
  const [showModelThinkingMenu, setShowModelThinkingMenu] = useState(false)
  // 可视化添加文件选择器（+ 菜单 → 添加文件）
  const [showFilePicker, setShowFilePicker] = useState(false)
  // + 菜单 → 工作流命令展开态（分组列出内置命令 / Skill）
  const [showCommands, setShowCommands] = useState(false)

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
  const modelThinkingRef = useRef<HTMLDivElement>(null)
  const filePickerRef = useRef<HTMLDivElement>(null)
  /** 输入区容器 = 三个辅助菜单（@提及 / 斜杠命令 / 文件选择）的定位锚点 */
  const inputAreaRef = useRef<HTMLDivElement>(null)

  // 上下文菜单浮在整个窗口之上（锚点：+ 按钮容器；须在 contextRef 之后声明）
  const contextMenuRef = useFloatingPosition<HTMLDivElement>(contextRef, showContextMenu, { placement: 'above', align: 'start' })

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
  // 关闭 + 菜单时同时收起工作流命令展开态——下次打开从折叠状态开始
  useOutsideClick(contextRef, () => {
    setShowContextMenu(false)
    setShowCommands(false)
  }, showContextMenu)
  useOutsideClick(modelThinkingRef, () => setShowModelThinkingMenu(false), showModelThinkingMenu)
  useOutsideClick(filePickerRef, () => setShowFilePicker(false), showFilePicker)
  // Esc 与点击外部成对：四个自绘浮层此前只有后者（同应用内 Radix 系/右键菜单/气泡菜单都有 Esc）
  useEscapeKey(() => {
    setShowContextMenu(false)
    setShowCommands(false)
  }, showContextMenu)
  useEscapeKey(() => setShowModelThinkingMenu(false), showModelThinkingMenu)
  useEscapeKey(() => setShowFilePicker(false), showFilePicker)

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
      // focus-within：textarea 自身写了 outline-none（去掉默认环以避免与外框叠成双层），
      // 但此前**没有任何替代焦点样式** → 键盘用户看不到焦点落在 AI 主输入框（全应用最主要的输入入口）。
      // 焦点落到内部任意元素时，把容器边框点亮。
      className="relative flex flex-col gap-0 p-1.5 transition-colors focus-within:border-[var(--color-accent)]"
      style={{
        backgroundColor: 'var(--color-hover)',
        border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-md)',  /* 4px 方正风格 */
      }}
    >
      {/* 输入区域 — 同时是 @提及 / 斜杠命令 / 文件选择三个辅助菜单的定位锚点
          （三个菜单渲染在本容器内部，各自用 useFloatingPosition 算 fixed 坐标） */}
      <div className="relative w-full" ref={inputAreaRef}>
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

        {/* 三个辅助菜单：一律浮在整个窗口之上（useFloatingPosition 以输入区容器为锚点计算坐标） */}
        {showSlashMenu && (
          <SlashCommandMenu
            query={slashQuery}
            onSelect={handleSlashSelect}
            onClose={() => setShowSlashMenu(false)}
            anchorRef={inputAreaRef}
          />
        )}
        {showMentionMenu && (
          <MentionMenu
            query={mentionQuery}
            onSelect={handleMentionSelect}
            onClose={() => setShowMentionMenu(false)}
            anchorRef={inputAreaRef}
          />
        )}
        {showFilePicker && (
          <div ref={filePickerRef}>
            <FilePickerMenu
              onSelect={handleFileSelect}
              onClose={() => setShowFilePicker(false)}
              anchorRef={inputAreaRef}
            />
          </div>
        )}
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
                setShowModelThinkingMenu(false)
                setShowFilePicker(false)
                setShowCommands(false)
                setShowContextMenu(v => !v)
              }}
            >
              <Plus size={14} />
            </ToolbarIconBtn>

            {/* 上下文菜单（+ 按钮弹出） */}
            {showContextMenu && (
              <PopoverSurface
                ref={contextMenuRef}
                className="py-1"
                style={{ width: 240, maxWidth: 'calc(100vw - 32px)' }}
              >
                <div className="text-micro px-3 pb-1 pt-1" style={{ color: 'var(--color-text-muted)' }}>
                  {t('tip.addContext')}
                </div>
                {/* 可视化添加文件：打开文件选择器，选择后以 @路径 追加到输入框 */}
                <MenuItem icon={<FileText size={13} />} label={t('agent.addFile')} onClick={() => {
                  setShowContextMenu(false)
                  setShowCommands(false)
                  setShowFilePicker(true)
                }} />
                <MenuItem icon={<AtSign size={13} />} label={t('agent.atMention')} onClick={() => {
                  setShowContextMenu(false)
                  setShowCommands(false)
                  // 插入 @ 字符并触发 MentionMenu（handleInputChange 与 setInputText 用同源值，
                  // 避免闭包旧值在连续点击时丢字符）
                  const next = inputText + '@'
                  setInputText(next)
                  handleInputChange(next)
                  textareaRef.current?.focus()
                }} />
                {/* 工作流命令：原地展开（不关闭菜单），列表按来源分组，内容高度变化由
                    useFloatingPosition 的 ResizeObserver 重新定位 */}
                <MenuItem
                  icon={<Workflow size={13} />}
                  label={t('agent.workflowCmd')}
                  trailing={
                    <ChevronDown
                      size={12}
                      strokeWidth={1.5}
                      className="flex-shrink-0 transition-transform duration-150 motion-reduce:transition-none"
                      style={{
                        color: 'var(--color-text-muted)',
                        transform: showCommands ? 'rotate(180deg)' : undefined,
                      }}
                    />
                  }
                  onClick={() => setShowCommands(v => !v)}
                />
                {showCommands && (() => {
                  const commands = getAllSlashCommands()
                  const builtin = commands.filter(c => c.source === 'builtin_command')
                  const skills = commands.filter(c => c.source === 'skill')
                  const selectCommand = (cmd: SlashCommand) => {
                    setShowContextMenu(false)
                    setShowCommands(false)
                    handleSlashSelect(cmd)
                  }
                  return (
                    <div
                      style={{
                        maxHeight: 240,
                        overflowY: 'auto',
                        marginTop: 4,
                        paddingTop: 4,
                        borderTop: '1px solid var(--color-border)',
                      }}
                    >
                      {builtin.length > 0 && (
                        <>
                          <div className="text-micro px-3 py-1" style={{ color: 'var(--color-text-muted)' }}>
                            {t('agent.commandsBuiltin')}
                          </div>
                          {builtin.map(cmd => (
                            <CommandMenuItem key={cmd.name} command={cmd} onSelect={selectCommand} />
                          ))}
                        </>
                      )}
                      {skills.length > 0 && (
                        <>
                          <div className="text-micro px-3 py-1" style={{ color: 'var(--color-text-muted)' }}>
                            {t('agent.commandsSkills')}
                          </div>
                          {skills.map(cmd => (
                            <CommandMenuItem key={cmd.name} command={cmd} onSelect={selectCommand} />
                          ))}
                        </>
                      )}
                    </div>
                  )
                })()}
              </PopoverSurface>
            )}
          </div>

          {/* 模型 + 思考等级合并入口：模型按对话选择，思考等级全局共用。
              触发器 = 模型名（truncate）+ 当前档位徽章，不再用「·」拆分两段 meta。 */}
          <div ref={modelThinkingRef} className="relative min-w-0">
            <button
              onClick={() => {
                setShowContextMenu(false)
                setShowFilePicker(false)
                setShowModelThinkingMenu(v => !v)
              }}
              className="flex items-center gap-1.5 py-1 pl-1 pr-1.5 rounded-md text-xs min-w-0 transition-colors"
              style={{
                color: 'var(--color-text-secondary)',
                opacity: 0.75,
                // 与旧模型触发器同一条约束：button 即使 display:flex 也是 shrink-to-fit，
                // 固定宽度会顶出窄面板；min(...) 兜住上限，模型名再靠 truncate 收进剩余空间
                maxWidth: 'min(220px, 100%)',
                anchorName: '--menu-model-thinking',
              } as React.CSSProperties}
              onMouseEnter={e => {
                e.currentTarget.style.backgroundColor = 'var(--color-hover)'
                e.currentTarget.style.opacity = '1'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.backgroundColor = 'transparent'
                e.currentTarget.style.opacity = '0.75'
              }}
            >
              {/* min-w-0 + truncate：flex item 默认 min-width:auto 不收缩到内容以下，
                  只写 truncate 时模型名会顶出容器（俄语下实测 71px 容器装 98px 内容） */}
              <span className="truncate select-none min-w-0">
                {currentModel?.name ?? (chatModels.length === 0 ? t('statusbar.noModel') : t('agent.selectModel'))}
              </span>
              <Badge variant="muted" className="gap-1 px-1.5 font-normal flex-shrink-0">
                <LevelIcon
                  size={11}
                  strokeWidth={2}
                  style={{ color: levelSpec.id === 'max' ? 'var(--color-warning)' : 'var(--color-accent)' }}
                />
                {t(levelSpec.labelKey)}
              </Badge>
              <ChevronDown size={12} strokeWidth={1.5} className="flex-shrink-0 opacity-60" />
            </button>

            {/* 合并弹窗：上半「本对话模型」（按会话），下半「全局思考等级」（全局共用） */}
            {showModelThinkingMenu && (
              <PopoverSurface
                anchorName="--menu-model-thinking"
                className="py-1"
                style={{ width: 260, maxWidth: 'calc(100vw - 32px)' }}
              >
                <div className="text-micro px-3 py-1" style={{ color: 'var(--color-text-muted)' }}>
                  {t('agent.modelSectionTitle')}
                </div>
                {chatModels.length === 0 ? (
                  <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-muted)' }}>
                    {t('agent.noModel')}
                  </div>
                ) : (
                  chatModels.map(model => (
                    <MenuItem
                      key={model.id}
                      label={model.name}
                      selected={model.id === currentModelId}
                      trailing={
                        model.provider ? (
                          <Badge variant="muted" className="px-1.5 font-normal flex-shrink-0">
                            {model.provider}
                          </Badge>
                        ) : undefined
                      }
                      onClick={() => {
                        setModelId(model.id)
                        setShowModelThinkingMenu(false)
                      }}
                    />
                  ))
                )}

                <div style={{ borderTop: '1px solid var(--color-border)', margin: '4px 0' }} />

                <div className="text-micro px-3 pb-1" style={{ color: 'var(--color-text-muted)' }}>
                  {t('agent.thinkingGlobalTitle')}
                </div>
                <div className="px-3">
                  <ThinkingLevelSlider value={level} onChange={setLevel} showDescription />
                </div>
                <div className="px-3 pt-1 text-micro" style={{ color: 'var(--color-text-muted)' }}>
                  {t('agent.thinkingGlobalHint')}
                </div>
              </PopoverSurface>
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

/** `+` 菜单里的工作流命令行：`/name` + 显示名 + 描述（点击走既有的 handleSlashSelect 语义） */
function CommandMenuItem({
  command,
  onSelect,
}: {
  command: SlashCommand
  onSelect: (command: SlashCommand) => void
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(command)}
      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-focus-ring)]"
      style={{ color: 'var(--color-text)', backgroundColor: 'transparent' }}
      onMouseEnter={e => {
        e.currentTarget.style.backgroundColor = 'var(--color-hover)'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.backgroundColor = 'transparent'
      }}
    >
      <span className="flex-shrink-0" style={{ color: 'var(--color-accent)' }}>
        {command.source === 'skill' ? <Sparkles size={13} /> : <Zap size={13} />}
      </span>
      <span className="flex-1 min-w-0">
        <span className="flex items-baseline gap-1.5 min-w-0">
          <span className="font-medium flex-shrink-0">/{command.name}</span>
          <span className="text-micro truncate" style={{ color: 'var(--color-text-muted)' }}>
            {command.displayName}
          </span>
        </span>
        <span className="block text-micro truncate" style={{ color: 'var(--color-text-muted)' }}>
          {command.description}
        </span>
      </span>
    </button>
  )
}

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
