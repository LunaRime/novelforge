import fsPromises from 'node:fs/promises'
import path from 'node:path'

// ===== ZIP 写入器（纯 Node.js 内置模块，零外部依赖） =====

/**
 * 轻量 ZIP 写入器，供章节导出和反馈使用。
 * 使用 Node.js 内置 zlib + Buffer，无需额外依赖。
 *
 * ZIP 文件结构（简化）：
 *   [Local File Header 1][Compressed Data 1]
 *   [Local File Header 2][Compressed Data 2]
 *   ...
 *   [Central Directory Entry 1][Central Directory Entry 2]...
 *   [End of Central Directory Record]
 */
export class ZipWriter {
  private entries: ZipEntry[] = []

  addFile(name: string, content: string | Buffer): void {
    this.entries.push({ name, content: Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8') })
  }

  async writeToFile(outputPath: string): Promise<void> {
    const zlib = await import('node:zlib')
    const localHeaders: Buffer[] = []
    const centralHeaders: Buffer[] = []
    let localOffset = 0

    for (const entry of this.entries) {
      // 压缩内容
      const compressed = zlib.deflateRawSync(entry.content)
      const crc = crc32(entry.content)
      const nameBuffer = Buffer.from(entry.name, 'utf-8')

      // Local File Header
      const localHeader = Buffer.alloc(30 + nameBuffer.length)
      let pos = 0
      localHeader.writeUInt32LE(0x04034b50, pos); pos += 4  // signature
      localHeader.writeUInt16LE(20, pos); pos += 2            // version needed
      localHeader.writeUInt16LE(0x0800, pos); pos += 2        // general purpose bit flag (UTF-8)
      localHeader.writeUInt16LE(8, pos); pos += 2             // compression method (deflate)
      localHeader.writeUInt16LE(0, pos); pos += 2             // last mod time
      localHeader.writeUInt16LE(0, pos); pos += 2             // last mod date
      localHeader.writeUInt32LE(crc, pos); pos += 4           // crc-32
      localHeader.writeUInt32LE(compressed.length, pos); pos += 4  // compressed size
      localHeader.writeUInt32LE(entry.content.length, pos); pos += 4  // uncompressed size
      localHeader.writeUInt16LE(nameBuffer.length, pos); pos += 2  // file name length
      localHeader.writeUInt16LE(0, pos); pos += 2            // 附加字段长度，文件名从固定头部之后开始
      nameBuffer.copy(localHeader, pos)

      localHeaders.push(localHeader, compressed)

      // Central Directory Header
      const centralHeader = Buffer.alloc(46 + nameBuffer.length)
      pos = 0
      centralHeader.writeUInt32LE(0x02014b50, pos); pos += 4  // signature
      centralHeader.writeUInt16LE(20, pos); pos += 2           // version made by
      centralHeader.writeUInt16LE(20, pos); pos += 2           // version needed
      centralHeader.writeUInt16LE(0x0800, pos); pos += 2       // general purpose bit flag (UTF-8)
      centralHeader.writeUInt16LE(8, pos); pos += 2            // compression method
      centralHeader.writeUInt16LE(0, pos); pos += 2            // last mod time
      centralHeader.writeUInt16LE(0, pos); pos += 2            // last mod date
      centralHeader.writeUInt32LE(crc, pos); pos += 4          // crc-32
      centralHeader.writeUInt32LE(compressed.length, pos); pos += 4  // compressed size
      centralHeader.writeUInt32LE(entry.content.length, pos); pos += 4  // uncompressed size
      centralHeader.writeUInt16LE(nameBuffer.length, pos); pos += 2  // file name length
      centralHeader.writeUInt16LE(0, pos); pos += 2            // extra field length
      centralHeader.writeUInt16LE(0, pos); pos += 2            // file comment length
      centralHeader.writeUInt16LE(0, pos); pos += 2            // disk number start
      centralHeader.writeUInt16LE(0, pos); pos += 2            // internal file attributes
      centralHeader.writeUInt32LE(0, pos); pos += 4            // external file attributes
      centralHeader.writeUInt32LE(localOffset, pos)            // relative offset of local header
      nameBuffer.copy(centralHeader, pos)

      centralHeaders.push(centralHeader)
      localOffset += localHeader.length + compressed.length
    }

    // End of Central Directory Record
    const centralOffset = localOffset
    const centralSize = Buffer.concat(centralHeaders).length
    const eocd = Buffer.alloc(22)
    let pos = 0
    eocd.writeUInt32LE(0x06054b50, pos); pos += 4  // signature
    eocd.writeUInt16LE(0, pos); pos += 2            // disk number
    eocd.writeUInt16LE(0, pos); pos += 2            // disk with central directory
    eocd.writeUInt16LE(this.entries.length, pos); pos += 2  // entries on disk
    eocd.writeUInt16LE(this.entries.length, pos); pos += 2  // total entries
    eocd.writeUInt32LE(centralSize, pos); pos += 4  // central directory size
    eocd.writeUInt32LE(centralOffset, pos); pos += 4  // central directory offset
    eocd.writeUInt16LE(0, pos)                      // comment length

    // 写入文件
    const dir = path.dirname(outputPath)
    await fsPromises.mkdir(dir, { recursive: true })
    const parts = [...localHeaders, ...centralHeaders, eocd]
    const totalBuffer = Buffer.concat(parts)
    await fsPromises.writeFile(outputPath, totalBuffer)
  }
}

interface ZipEntry {
  name: string
  content: Buffer
}

/** CRC-32 校验码（多项式 0xEDB88320） */
function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i]
    for (let j = 0; j < 8; j++) {
      if (crc & 1) {
        crc = (crc >>> 1) ^ 0xEDB88320
      } else {
        crc = crc >>> 1
      }
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
