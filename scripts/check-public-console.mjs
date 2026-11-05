import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
const require = createRequire(import.meta.url)
const { auditPublicConsole } = require('./public-console-audit.cjs')
const root = fileURLToPath(new URL('../', import.meta.url))
const { version } = require('../package.json')
const result = auditPublicConsole(root, version)
console.log(result.skipped ? 'Alpha console audit skipped' : 'Public artifacts contain no developer console implementation')
