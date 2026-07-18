import type { Meta, StoryObj } from '@storybook/react'
import { EmptyState } from '../components/ui/EmptyState'
import { FileText, FolderOpen, Search } from 'lucide-react'

const meta = {
  title: 'Vela UI/EmptyState',
  component: EmptyState,
  tags: ['autodocs'],
  argTypes: {
    message: { control: 'text', description: 'Display message' },
    opacity: { control: { type: 'range', min: 0, max: 1, step: 0.05 }, description: 'Opacity level' },
  },
  parameters: {
    docs: {
      description: {
        component: 'Empty state placeholder used for empty views (no data, no results, no files).',
      },
    },
  },
} satisfies Meta<typeof EmptyState>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { message: '暂无数据' },
}

export const WithIcon: Story = {
  args: { message: '暂无文件', icon: <FileText size={32} /> },
}

export const NoResults: Story = {
  args: { message: '未找到匹配结果', icon: <Search size={32} />, opacity: 0.5 },
}

export const EmptyFolder: Story = {
  args: { message: '此文件夹为空', icon: <FolderOpen size={32} />, opacity: 0.2 },
}
