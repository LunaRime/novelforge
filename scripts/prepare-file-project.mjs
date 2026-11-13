#!/usr/bin/env node
import { cp, lstat, mkdir, mkdtemp, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DatabaseSync } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { build } from 'esbuild'

async function assertAbsent(path) {
  try { await lstat(path) }
  catch (error) {
    if (error.code === 'ENOENT') return
    throw error
  }
  throw new Error('Candidate directory already exists')
}

async function prepare(source, exportPath, outputPath) {
  const pristine = await realpath(exportPath)
  const requested = resolve(outputPath)
  const parent = await realpath(dirname(requested))
  const output = join(parent, basename(requested))
  const inside = relative(pristine, output)
  if (!inside || (!isAbsolute(inside) && !inside.startsWith(`..${sep}`))) {
    throw new Error('Candidate must be outside the verified export')
  }
  await assertAbsent(output)
  const { outputFiles: [module] } = await build({
    stdin: {
      contents: `
        export { verifyStorageExport } from './src/core/migration/verify-storage-export'
        export { freezeLegacyFileDrafts } from './electron/services/freeze-legacy-file-drafts'
      `,
      resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    },
    bundle: true, platform: 'node', target: 'node22', format: 'esm', write: false,
  })
  const { verifyStorageExport, freezeLegacyFileDrafts } =
    await import(`data:text/javascript;base64,${Buffer.from(module.contents).toString('base64')}`)
  const temporary = await mkdtemp(join(parent, '.nf-file-candidate-'))
  const staging = join(temporary, 'candidate')
  try {
    await cp(pristine, staging, { recursive: true, errorOnExist: true, force: false })
    // Verify the exact bytes that will be published, including the copy of the original backup.
    const report = await verifyStorageExport(source, staging)
    const internal = join(staging, '.novelforge')
    await mkdir(internal)
    // Older applications open this exact path as a database. A directory blocks that attempt.
    await mkdir(join(internal, 'vela.db'))
    const retained = join(internal, 'retained.db')
    await cp(join(staging, 'legacy.db'), retained, { errorOnExist: true, force: false })
    const db = new DatabaseSync(retained)
    try {
      db.exec('PRAGMA journal_mode = DELETE')
      freezeLegacyFileDrafts(db)
    } finally { db.close() }
    const mapping = JSON.stringify(report.identityMap, null, 2)
    const identityHash = createHash('sha256').update(mapping).digest('hex')
    await writeFile(join(internal, 'draft-identity.json'), mapping, { flag: 'wx' })
    await writeFile(join(internal, 'file-editor.json'), JSON.stringify({
      format: 1, projectId: report.projectId, identityHash, lifecycle: 1,
    }), { flag: 'wx' })
    // The candidate becomes visible only after the descriptor, database and barrier are in place.
    await assertAbsent(output)
    await rename(staging, output)
    return { projectId: report.projectId, output, chapters: report.counts.current, drafts: report.identityMap.entries.length }
  } finally {
    // Clean up only the private directory allocated for this run.
    await rm(temporary, { recursive: true, force: true })
  }
}

const [source, exported, output, ...extra] = process.argv.slice(2)
if (!source || !exported || !output || extra.length) {
  console.error('Usage: node scripts/prepare-file-project.mjs <offline-db-copy> <pristine-export-directory> <new-candidate-directory>')
  process.exitCode = 2
} else {
  try { console.log(JSON.stringify(await prepare(source, exported, output), null, 2)) }
  catch (error) { console.error(`Preparation failed: ${error.message}`); process.exitCode = 1 }
}
