import type { Meta, StoryObj } from '@storybook/react'
import { ErrorBoundary } from '../components/ErrorBoundary'

/** 用于触发错误的测试组件 */
function BrokenComponent({ throws }: { throws?: boolean }) {
  if (throws) throw new Error('模拟组件崩溃错误')
  return <div style={{ padding: 20 }}>正常内容</div>
}

const meta = {
  title: 'Vela UI/ErrorBoundary',
  component: ErrorBoundary,
  tags: ['autodocs'],
  argTypes: {
    fallbackLabel: { control: 'text', description: 'Error fallback display label' },
  },
  parameters: {
    docs: {
      description: {
        component: 'Global error boundary that catches component crashes and shows a fallback UI with retry option.',
      },
    },
  },
} satisfies Meta<typeof ErrorBoundary>

export default meta
type Story = StoryObj<typeof meta>

export const NormalContent: Story = {
  args: { fallbackLabel: '错误演示', children: <BrokenComponent /> },
}

export const CustomLabel: Story = {
  args: { fallbackLabel: '侧边栏渲染失败', children: <BrokenComponent throws /> },
}
CustomLabel.parameters = {
  docs: { description: { story: 'When the child component crashes, the error boundary shows a fallback UI with a retry button.' } },
}
