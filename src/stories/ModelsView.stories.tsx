import type { Meta, StoryObj } from '@storybook/react'
import ModelsView from '../components/panels/ModelsView'

const meta = {
  title: 'Vela Panels/ModelsView',
  component: ModelsView,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component: 'Bottom panel model call statistics view showing LLM usage history and cost tracking.',
      },
    },
  },
} satisfies Meta<typeof ModelsView>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  name: 'Empty State',
}

export const WithData: Story = {
  name: 'With Data (simulated)',
  render: () => <ModelsView />,
}
