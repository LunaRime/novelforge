// eslint-disable-next-line storybook/no-renderer-packages
import { type Meta, type StoryObj } from '@storybook/react'
import { useEffect } from 'react'
import CharacterEditor from '../components/editor/CharacterEditor'
import { useCharacterStore, EMPTY_CARD, EMPTY_STATE, type CharacterCard } from '../stores/character-store'
import { useProjectStore } from '../stores/project-store'

/** 造一张角色卡（默认值来自 EMPTY_CARD，只覆盖本 story 要展示的字段） */
function card(name: string, extra: Partial<CharacterCard> = {}): CharacterCard {
  return { ...EMPTY_CARD, name, ...extra }
}

/** 预填充角色的 Story 装饰器（模式同 LogsView.stories） */
function withCharacters(chars: CharacterCard[], selected: string, dirty = false) {
  return (Story: React.ComponentType) => {
    function Seeded() {
      useEffect(() => {
        useProjectStore.setState({ currentProject: { name: '长夜将明', path: 'E:/novels/长夜将明' } as never })
        useCharacterStore.setState({
          characters: chars,
          selectedName: selected,
          saving: false,
          dirty,
        })
        return () => { useCharacterStore.setState({ characters: [], selectedName: null }) }
      }, [])
      return <Story />
    }
    return <Seeded />
  }
}

const FULL_CARD = card('林晚照', {
  tier: 1,
  role: 'protagonist',
  gender: '女',
  age: '19',
  appearance: '身形清瘦，惯穿靛青短打；左耳垂有一枚缺角的银坠，是母亲留下的唯一物件。',
  personality: '对外冷硬、对内极护短。习惯用沉默代替解释，被逼到墙角时会突然变得极其锋利。',
  background: '出身城南药铺，十三岁那年铺子被焚，师父死于火中。此后三年以替人抄书为生，暗中查访火因。',
  abilities: '嗅觉异常敏锐（辨药、辨毒、辨人身上的火油味）；一手短刃，师承不明。',
  motivation: '查明城南药铺纵火案的真正主使，并让师父的名字重新写回医册。',
  arc: '从"只想复仇"到"发现复仇会伤及无辜"，最终选择把证据交给官府而非亲手了断。',
  relations: JSON.stringify([
    { target: '沈砚', type: 'ally', label: '同门', sinceChapter: 3 },
    { target: '裴无咎', type: 'enemy', label: '杀师疑凶', sinceChapter: 7 },
  ]),
  tags: '["主角","复仇","药铺"]',
  appearChapters: '[1,2,3,5,7,9,12]',
  aliases: '["晚照","丫头","林姑娘"]',
  status: 'active',
  appearCount: 27,
  firstChapter: 1,
  lastChapter: 12,
  currentState: { ...EMPTY_STATE, location: '城北·废盐仓', updatedAtChapter: 12 },
})

const MINOR_CARD = card('茶棚老板', {
  tier: 3,
  role: 'minor',
  gender: '男',
  tags: '["路人","信息源"]',
  notes: '只出现两场，负责给主角递消息。',
  status: 'departed',
})

const OTHER_CARDS = [
  card('沈砚', { tier: 1, role: 'supporting' }),
  card('裴无咎', { tier: 1, role: 'antagonist' }),
  card('林小满', { tier: 2, role: 'supporting' }),
]

const meta = {
  title: 'NovelForge Editors/CharacterEditor',
  component: CharacterEditor,
  tags: ['autodocs'],
  parameters: {
    docs: {
      description: {
        component:
          '角色卡编辑器：工具栏（保存 + 更多菜单）/ 四视图分段条 / 分区表单。'
          + ' 2026-09-25 排布重构前，这条 36px 工具栏里塞了 9 个控件，编辑区下限 320px 时必然溢出。',
      },
    },
  },
} satisfies Meta<typeof CharacterEditor>

export default meta
type Story = StoryObj<typeof meta>

/** tier 1 主角：走完整字段分支（16 个字段 + 三个分区标题） */
export const FullProfile: Story = {
  decorators: [withCharacters([FULL_CARD, ...OTHER_CARDS], '林晚照')],
}

/** 有未保存修改：保存键点亮 + 标题旁出现未保存标记 */
export const UnsavedChanges: Story = {
  decorators: [withCharacters([FULL_CARD, ...OTHER_CARDS], '林晚照', true)],
}

/** tier 3 配角：只有基础设定 + 备注（无档案分区） */
export const MinorCharacter: Story = {
  decorators: [withCharacters([MINOR_CARD, ...OTHER_CARDS], '茶棚老板')],
}

/** 未选中任何角色：只剩图谱入口 */
export const NoSelection: Story = {
  decorators: [withCharacters(OTHER_CARDS, '')],
}
