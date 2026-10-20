import { create } from 'zustand'

export type CommandPaletteMode = 'commands' | 'shortcuts'

interface CommandPaletteState {
  open: boolean
  mode: CommandPaletteMode
  openPalette: (mode?: CommandPaletteMode) => void
  closePalette: () => void
  togglePalette: (mode?: CommandPaletteMode) => void
}

/**
 * Cmd+K 命令面板的开关状态。
 *
 * 与 layout-store 分开：面板尺寸/开合需要持久化，命令面板是**瞬时** UI；
 * 混在一起会让「上次没关的命令面板」在重启后自己弹出来。
 */
export const useCommandStore = create<CommandPaletteState>()((set) => ({
  open: false,
  mode: 'commands',
  openPalette: (mode = 'commands') => set({ open: true, mode }),
  closePalette: () => set({ open: false }),
  togglePalette: (mode = 'commands') => set((s) => ({ open: !s.open, mode })),
}))
