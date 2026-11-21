const { includesDevConsole } = require('./dev-console-policy.cjs')
const CLI = ['scripts/dev-instance.mjs', 'scripts/dev-instance-lib.mjs']
const { auditPublicConsole } = require('./public-console-audit.cjs')
module.exports = async function beforePack(context) {
  const config = context.packager.config
  const enabled = includesDevConsole('build', context.packager.appInfo.version)
  const files = [...(config.files || [])]
  const root = files.findIndex(entry => typeof entry === 'object' && (!entry.from || entry.from === '.') && (!entry.to || entry.to === '.'))
  const rules = enabled ? CLI : CLI.map(name => `!${name}`)
  const update = patterns => [...patterns.filter(pattern => !CLI.includes(pattern.replace(/^!/, ''))), ...rules]
  // electron-builder 已把 files 规范化成 FileSet。另加纯排除字符串会隐式启用 **/*。
  if (root >= 0) {
    files[root] = { ...files[root], filter: update(files[root].filter || []) }
    config.files = files
  } else {
    config.files = update(files)
  }
  const unpack = (Array.isArray(config.asarUnpack) ? config.asarUnpack : [config.asarUnpack].filter(Boolean)).filter(entry => !CLI.includes(entry))
  config.asarUnpack = [...unpack, ...(enabled ? CLI : [])]
  if (context.packager.projectDir) auditPublicConsole(context.packager.projectDir, context.packager.appInfo.version)
}
