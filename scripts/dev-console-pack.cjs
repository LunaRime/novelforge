const { includesDevConsole } = require('./dev-console-policy.cjs')
const CLI = ['scripts/dev-instance.mjs', 'scripts/dev-instance-lib.mjs']
const { auditPublicConsole } = require('./public-console-audit.cjs')
module.exports = async function beforePack(context) {
  const config = context.packager.config
  const enabled = includesDevConsole('build', context.packager.appInfo.version)
  const files = (config.files || []).filter(entry => typeof entry !== 'string' || !CLI.includes(entry))
  const unpack = (Array.isArray(config.asarUnpack) ? config.asarUnpack : [config.asarUnpack].filter(Boolean)).filter(entry => !CLI.includes(entry))
  config.files = [...files, ...(enabled ? CLI : CLI.map(name => `!${name}`))]
  config.asarUnpack = [...unpack, ...(enabled ? CLI : [])]
  if (context.packager.projectDir) auditPublicConsole(context.packager.projectDir, context.packager.appInfo.version)
}
