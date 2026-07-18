import { type Meta, type StoryObj } from '@storybook/react'
import { useEffect } from 'react'
import LogsView from '../components/panels/LogsView'
import { useWorkflowStore } from '../stores/workflow-store'

/** 预填充日志数据的 Story 装饰器 */
function withSampleLogs(Story: React.ComponentType) {
  useEffect(() => {
    useWorkflowStore.setState({
      globalLogs: [
        { time: '14:30:01', level: 'info', message: '知识库导入完成 (12 块)' },
        { time: '14:30:05', level: 'info', message: '章节剧情要点提取中...' },
        { time: '14:30:12', level: 'info', message: '✅ 角色状态更新完成' },
        { time: '14:30:15', level: 'warn', message: '伏笔扫描超时，已跳过' },
        { time: '14:30:20', level: 'error', message: 'LLM 调用失败 (429): rate limit' },
      ],
    })
    return () => { useWorkflowStore.setState({ globalLogs: [] }) }
  }, [])
  return <Story />
}

const meta = {
  title: 'Vela Panels/LogsView',
  component: LogsView,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: 'Bottom panel log view showing workflow execution logs with auto-scroll and clear functionality.',
      },
    },
  },
} satisfies Meta<typeof LogsView>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {}

export const WithSampleLogs: Story = {
  decorators: [withSampleLogs],
}

export const LongLogList: Story = {
  decorators: [
    (Story) => {
      useEffect(() => {
        const logs = Array.from({ length: 50 }, (_, i) => ({
          time: `14:${String(30 + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}`,
          level: (['info', 'info', 'info', 'warn', 'error'][i % 5]) as string,
          message: `日志条目 ${i + 1}: ${'操作 '.repeat((i % 3) + 1)}${i % 2 === 0 ? '成功' : '进行中...'}`,
        }))
        useWorkflowStore.setState({ globalLogs: logs })
        return () => { useWorkflowStore.setState({ globalLogs: [] }) }
      }, [])
      return <Story />
    },
  ],
}
