/**
 * vela-protocol — 统一管理 vela:// 伪协议路径解析
 *
 * 所有 vela:// 路径的常量映射和解析逻辑集中在此，
 * 新增架构字段或路径协议时只需修改此文件。
 */

import { ipc } from './ipc-client'

// ===== vela:// URI 协议常量 =====

/** NovelForge 伪协议前缀常量 — 集中定义，消除 58+ 处硬编码 */
export const VELA = {
  DRAFT: 'vela://draft/',
  MANUSCRIPT: 'vela://manuscript/',
  CORE: 'vela://core/',
  REVISION: 'vela://revision/',
  REVIEW: 'vela://review/',
} as const

// ===== vela://core/ 架构字段映射 =====

/** 路径 key → ProjectCoreData 中的驼峰字段名 */
export const CORE_FIELD_MAP: Record<string, string> = {
    premise: 'premise',
    worldbuilding: 'worldbuilding',
    characters: 'charactersArch',
    synopsis: 'synopsis',
}

/** 从 vela://core/ 路径中解析出 DB 字段名 */
export function parseCoreField(velaPath: string): string | null {
    if (!velaPath.startsWith(VELA.CORE)) return null
    const key = velaPath.replace(VELA.CORE, '')
    return CORE_FIELD_MAP[key] ?? null
}

/** 从 DB 读取 vela://core/ 路径对应的内容 */
export async function readCoreContent(velaPath: string): Promise<string> {
    const key = velaPath.replace(VELA.CORE, '')
    const core = await ipc.invoke('db:project-core-get')
    if (!core) return ''
    const fieldMap: Record<string, string> = {
        premise: core.premise || '',
        worldbuilding: core.worldbuilding || '',
        characters: core.charactersArch || '',
        synopsis: core.synopsis || '',
    }
    return fieldMap[key] || ''
}

/** 将内容写入 vela://core/ 对应的 DB 字段 */
export async function writeCoreContent(velaPath: string, content: string): Promise<boolean> {
    const dbField = parseCoreField(velaPath)
    if (!dbField) return false
    const res = await ipc.invoke('db:project-core-update', { [dbField]: content })
    return res.success !== false
}

// ===== vela://draft/ | vela://revision/ | vela://review/ 内容读取 =====

/** 读取 vela:// 伪协议路径的内容（统一入口） */
export async function readVelaContent(filePath: string): Promise<string> {
    if (filePath.startsWith(VELA.DRAFT) || filePath.startsWith(VELA.MANUSCRIPT)) {
        const prefix = filePath.startsWith(VELA.DRAFT) ? VELA.DRAFT : VELA.MANUSCRIPT
        const draftId = parseInt(filePath.replace(prefix, ''))
        const full = await ipc.invoke('db:draft-get-full', draftId)
        return full?.content ?? ''
    }

    if (filePath.startsWith(VELA.REVISION)) {
        const revId = parseInt(filePath.replace(VELA.REVISION, ''))
        const full = await ipc.invoke('db:revision-get-full', revId)
        return full?.content ?? ''
    }

    if (filePath.startsWith(VELA.REVIEW)) {
        const revId = parseInt(filePath.replace(VELA.REVIEW, ''))
        const full = await ipc.invoke('db:review-get-full', revId)
        return full?.content ?? ''
    }

    if (filePath.startsWith(VELA.CORE)) {
        return readCoreContent(filePath)
    }

    console.warn('[readVelaContent] 不支持的路径协议:', filePath)
    return ''
}

/** 判断路径是否为 vela:// 伪协议 */
/** 所有 vela:// 协议前缀 */
const VELA_PREFIX = 'vela://'

export function isVelaProtocol(path: string): boolean {
    return path.startsWith(VELA_PREFIX)
}
