import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { inflateRawSync } from 'node:zlib'
import { expect, it } from 'vitest'
import { ZipWriter } from './zip-writer'

it('本地文件头保留附加字段长度，解压器能按头部定位两个文件', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'novelforge-zip-test-'))
  const target = path.join(directory, 'bundle.zip')
  try {
    const zip = new ZipWriter()
    const expected = [['error-log.txt', '示例日志'], ['diagnostics.json', '{}']]
    for (const [name, content] of expected) zip.addFile(name, content)
    await zip.writeToFile(target)
    const bytes = await fs.readFile(target)
    let offset = 0
    for (const [name, content] of expected) {
      expect(bytes.readUInt32LE(offset)).toBe(0x04034b50)
      const nameSize = bytes.readUInt16LE(offset + 26)
      const extraSize = bytes.readUInt16LE(offset + 28)
      const nameStart = offset + 30
      expect(extraSize).toBe(0)
      expect(bytes.subarray(nameStart, nameStart + nameSize).toString('utf8')).toBe(name)
      const dataStart = nameStart + nameSize + extraSize
      offset = dataStart + bytes.readUInt32LE(offset + 18)
      expect(inflateRawSync(bytes.subarray(dataStart, offset)).toString('utf8')).toBe(content)
    }
    expect(bytes.readUInt32LE(offset)).toBe(0x02014b50)
  } finally {
    await fs.rm(target, { force: true })
    await fs.rmdir(directory)
  }
})
