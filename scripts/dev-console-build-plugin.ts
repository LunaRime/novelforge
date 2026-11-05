import type { Plugin } from 'vite'

/** Public builds must exclude implementation modules, even if minification renames symbols. */
export function devConsoleBuildGuard(enabled: boolean): Plugin {
  return {
    name: 'novelforge-public-console-boundary',
    generateBundle(_options, bundle) {
      if (enabled) return
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue
        for (const [id, module] of Object.entries(chunk.modules)) {
          if (module.renderedLength > 0 && /\/(?:electron\/dev\/|src\/components\/dev\/|electron\/controllers\/console-controller\.)/.test(id.replace(/\\/g, '/'))) {
            this.error(`Public developer-console implementation leak: ${id}`)
          }
        }
      }
    },
  }
}
