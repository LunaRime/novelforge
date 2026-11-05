const fs = require('node:fs')
const path = require('node:path')
const { includesDevConsole } = require('./dev-console-policy.cjs')
const forbidden = ['DevConsoleDialog', 'registerConsoleController', 'registerInstanceController', 'isReadOnlySql', "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE", 'scripts/dev-instance.mjs']
function auditPublicConsole(root, version) {
  if (includesDevConsole('build', version)) return { skipped: true }
  function scan(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name)
      if (entry.isDirectory()) scan(full)
      else if (/\.(?:js|cjs|mjs)$/.test(entry.name)) {
        const text = fs.readFileSync(full, 'utf8')
        if (/(?:console-controller|instance-controller|DevConsoleDialog|db-inspector|perf-snapshot)/i.test(entry.name)) throw new Error(`Stale console chunk: ${full}`)
        for (const marker of forbidden) if (text.includes(marker)) throw new Error(`Public console leak: ${marker} in ${full}`)
      }
    }
  }
  scan(path.join(root, 'dist')); scan(path.join(root, 'dist-electron'))
  return { skipped: false }
}
module.exports = { auditPublicConsole }
