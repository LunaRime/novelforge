/**
 * NumberInput — 语义化的数字输入（等价于 <Input type="number">）
 *
 * 自动隐藏原生 spinner，显示一致的 +/- 步进按钮。
 */

import * as React from 'react'
import { Input } from './Input'

const NumberInput = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  (props, ref) => <Input ref={ref} type="number" {...props} />
)
NumberInput.displayName = 'NumberInput'

export { NumberInput }
