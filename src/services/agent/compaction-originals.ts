/**
 * 分卷存储 —— 被压缩对话的原文（B 档第二轮）
 *
 * 为什么不内联在会话 JSON：
 * - 原文会让 archive 无界增长（长对话可达数十 MB），而清理逻辑此前还有 bug（只清下标 0）
 * - 分卷后：会话 JSON 只留引用、原文**永不丢失**、摘要可重生成、展开原文按需读
 *
 * 文件：`<VELA_HOME>/agent-archive/<convId>.originals.json`（与会话 JSON 同目录、不同后缀）。
 * 形状：`{ version: 1, batches: { [batchNumber]: AgentMessage[] } }`。
 * 全程 fail-safe：损坏/缺失一律按"无原文"处理（不抛、不崩）。
 */
import { ipc } from '../ipc-client'
import type { AgentMessage } from '../../stores/agent-store'

interface OriginalsFile {
  version: 1
  batches: Record<string, AgentMessage[]>
}

/** 读取整份分卷（损坏/缺失 → 空） */
async function readAll(convId: string): Promise<OriginalsFile> {
  try {
    const res = await ipc.invoke('fs:agent-archive-original-read', convId) as
      { success?: boolean; content?: string | null } | null
    if (!res?.success || !res.content) return { version: 1, batches: {} }
    const parsed = JSON.parse(res.content) as Partial<OriginalsFile>
    if (!parsed || typeof parsed !== 'object' || !parsed.batches || typeof parsed.batches !== 'object') {
      return { version: 1, batches: {} }
    }
    return { version: 1, batches: parsed.batches }
  } catch {
    return { version: 1, batches: {} }
  }
}

/**
 * 写入某批次原文（**同批次覆盖幂等** —— 重压缩/重生成不叠加）。
 * 返回是否**真的写成功**：主进程写失败返回 `{success:false}` 而非 reject，
 * 不检查返回值会让 `recoverable` 恒为 true、诚实标记失效（评审 I4）。
 */
export async function writeBatchOriginal(
  convId: string,
  batch: number,
  messages: AgentMessage[],
): Promise<boolean> {
  const file = await readAll(convId)
  file.batches[String(batch)] = messages
  const res = await ipc.invoke('fs:agent-archive-original-write', convId, JSON.stringify(file)) as
    { success?: boolean } | null
  return res?.success !== false
}

/**
 * 把分卷整体复制到另一个会话 id（fork / duplicate 用）。
 * ⚠️ 派生会话的原文按会话 id 寻址 —— 不复制的话展开必然 ENOENT（评审 I12）。
 */
export async function copyAllOriginals(fromConvId: string, toConvId: string): Promise<void> {
  const file = await readAll(fromConvId)
  if (Object.keys(file.batches).length === 0) return
  await ipc.invoke('fs:agent-archive-original-write', toConvId, JSON.stringify(file))
}

/** 读取某批次原文（不存在/为空 → null） */
export async function readBatchOriginal(convId: string, batch: number): Promise<AgentMessage[] | null> {
  const file = await readAll(convId)
  const entry = file.batches[String(batch)]
  return Array.isArray(entry) && entry.length > 0 ? entry : null
}

/** 删除会话的全部分卷（会话删除时级联调用） */
export async function deleteAllOriginals(convId: string): Promise<void> {
  await ipc.invoke('fs:agent-archive-original-delete', convId)
}

/**
 * 删除单个批次的分卷（`removeCompaction` 时同步调用）。
 * ⚠️ 必须与批次移除同步 —— 否则批号一旦被复用（C1），同号覆盖会销毁另一批的原文。
 */
export async function deleteBatchOriginal(convId: string, batch: number): Promise<void> {
  const file = await readAll(convId)
  if (!(String(batch) in file.batches)) return
  delete file.batches[String(batch)]
  await ipc.invoke('fs:agent-archive-original-write', convId, JSON.stringify(file))
}

/** 统计分卷体量（批次数 + 字节数），供「原文可用性」展示与诊断 */
export async function countOriginals(convId: string): Promise<{ batches: number; bytes: number }> {
  const file = await readAll(convId)
  return { batches: Object.keys(file.batches).length, bytes: JSON.stringify(file).length }
}
