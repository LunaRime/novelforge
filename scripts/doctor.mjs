#!/usr/bin/env node
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const [directory, ...extra] = process.argv.slice(2)
if (!directory || directory.startsWith('-') || extra.length) {
  console.error('Usage: node scripts/doctor.mjs <offline-project-directory>')
  process.exitCode = 2
} else {
  try {
    const { outputFiles: [module] } = await build({
      stdin: {
        contents: `
          export { inspectProject } from './src/core/application/inspect-project'
          export { openProjectInspection } from './src/core/adapters/file-project-inspection'
        `,
        resolveDir: fileURLToPath(new URL('..', import.meta.url)),
      },
      bundle: true, platform: 'node', target: 'node22', format: 'esm', write: false,
    })
    const { inspectProject, openProjectInspection } = await import(`data:text/javascript;base64,${Buffer.from(module.contents).toString('base64')}`)
    const report = await inspectProject(await openProjectInspection(directory))
    console.log(JSON.stringify(report, null, 2))
    process.exitCode = report.ok ? 0 : 1
  } catch {
    console.error('Inspection failed. Provide an accessible offline project directory.')
    process.exitCode = 2
  }
}
