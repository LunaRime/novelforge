// eslint-disable-next-line storybook/no-renderer-packages
import type { Meta, StoryObj } from '@storybook/react'
import { Badge } from '../components/ui/Badge'

const meta = {
  title: 'NovelForge UI/Badge',
  component: Badge,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['default', 'success', 'warning', 'error', 'info', 'accent', 'outline', 'muted', 'solid'],
      description: 'Badge visual style',
    },
  },
  parameters: {
    docs: {
      description: {
        component: 'NovelForge badge component for status indicators and labels. Supports 9 semantic variants.',
      },
    },
  },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    variant: 'default',
    children: 'Badge',
  },
}

export const AllVariants: Story = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Badge variant="default">Default</Badge>
      <Badge variant="success">Success</Badge>
      <Badge variant="warning">Warning</Badge>
      <Badge variant="error">Error</Badge>
      <Badge variant="info">Info</Badge>
      <Badge variant="accent">Accent</Badge>
      <Badge variant="outline">Outline</Badge>
      <Badge variant="muted">Muted</Badge>
      <Badge variant="solid">Solid</Badge>
    </div>
  ),
}

export const InContext: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <span className="text-xs text-[var(--color-text-secondary)]">Status:</span>
      <Badge variant="success">Published</Badge>
      <Badge variant="warning">Draft</Badge>
      <Badge variant="error">Failed</Badge>
    </div>
  ),
}
