#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const [source, output, ...extra] = process.argv.slice(2)
if (!source || !output || extra.length) {
  console.error('Usage: node scripts/verify-storage-export.mjs <offline-db-copy> <pristine-export-directory>')
  process.exitCode = 2
} else {
  try {
    const { outputFiles: [module] } = await build({
      entryPoints: [fileURLToPath(new URL('../src/core/migration/verify-storage-export.ts', import.meta.url))],
      bundle: true, platform: 'node', target: 'node22', format: 'esm', write: false,
    })
    const { verifyStorageExport } = await import(`data:text/javascript;base64,${Buffer.from(module.contents).toString('base64')}`)
    const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
    const report = await verifyStorageExport(source, output)
    console.log(JSON.stringify({ ...report, applicationVersion: version, verifierVersion: 1, nodeVersion: process.version }, null, 2))
  } catch (error) {
    console.error(`Verification failed: ${error.message}`)
    process.exitCode = 1
  }
}
