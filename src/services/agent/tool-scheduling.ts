/**
 * Agent 工具调度常量（唯一来源）
 *
 * 语义澄清：引擎**不限制**一条回复里的工具调用个数，也没有「每轮只能调一个」的规则。
 * 真正受约束的是「同一步内最多同时运行多少个可并行的调用」：
 * - 连续只读工具（isReadOnly = true）归入同一只读批，批内 Promise.all 并发执行；
 * - 一个只读批最多 `MAX_PARALLEL_READ_TOOLS` 个调用，超出自动分拆到下一批；
 * - 写入型 / 需用户确认的工具不进只读批，按解析顺序串行执行。
 *
 * 该常量同时用于：
 * 1. `agent-engine.ts` 的只读批封批判定；
 * 2. 系统提示词 `{maxParallel}` 占位符注入（见 `tool-registry.ts::generateToolPrompt`），
 *    让模型知道「同一批最多放多少个」。
 */
export const MAX_PARALLEL_READ_TOOLS = 10
