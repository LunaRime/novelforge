/** Build-time decision; deliberately ignores mode, environment and runtime config. */
function includesDevConsole(command, version) {
  return command === 'serve' || /^\d+\.\d+\.\d+-alpha\.\d+$/.test(version)
}
module.exports = { includesDevConsole }
