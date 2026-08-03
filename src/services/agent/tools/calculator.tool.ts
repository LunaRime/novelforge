/**
 * calculator — 数学计算工具
 *
 * LLM 遇到数值运算（如"每章 3000 字 × 30 章"）时直接调用，避免心算错误。
 * 安全：仅允许数字与四则运算符的白名单表达式，禁用 eval/函数调用。
 */
import { buildAgentTool } from '../tool-registry'

/** 表达式白名单：数字、四则、括号、小数点、百分号、空格 */
const SAFE_EXPR_REGEX = /^[0-9+\-*/().%\s]+$/

/** 安全求值：白名单预检 + Function 构造（无 eval、无作用域注入） */
function safeEvaluate(expression: string): { ok: true; value: number } | { ok: false; error: string } {
  if (!SAFE_EXPR_REGEX.test(expression)) {
    return { ok: false, error: '表达式包含非法字符（仅支持数字与 + - * / ( ) . %）' }
  }
  try {
    // 白名单已过滤，Function 仅用于把表达式解析为数值；不传入任何作用域变量
    const result = new Function(`"use strict"; return (${expression})`)() as unknown
    if (typeof result !== 'number' || !isFinite(result)) {
      return { ok: false, error: '表达式结果无效（可能除零或溢出）' }
    }
    return { ok: true, value: result }
  } catch (e) {
    return { ok: false, error: `表达式求值失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

export const calculatorTool = buildAgentTool({
  name: 'calculator',
  description: '精确数学计算。当需要计算数字（字数×章节数、百分比、加减乘除）时调用，返回精确结果。不要心算。',
  source: 'builtin',
  inputSchema: {
    type: 'object',
    properties: {
      expression: {
        type: 'string',
        description: '数学表达式，如 "3000 * 30" 或 "(12000 + 800) / 2"。仅支持数字与 + - * / ( ) . %',
      },
    },
    required: ['expression'],
  },
  requiresConfirmation: false,
  execute: async (args) => {
    const expression = String(args.expression ?? '').trim()
    if (!expression) {
      // 工具内部错误注入给 LLM 的 observation，不走 UI i18n
      return { success: false, content: '', error: 'calculator 需要提供 expression 参数' }
    }
    const result = safeEvaluate(expression)
    if (!result.ok) {
      return { success: false, content: '', error: result.error }
    }
    // 整数去尾零显示
    const value = Math.round(result.value * 1e6) / 1e6
    return {
      success: true,
      content: `✅ ${expression} = ${value}`,
    }
  },
})
