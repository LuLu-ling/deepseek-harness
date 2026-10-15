import { clientBundle } from '../tsdown.client.ts'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'

const bundle = clientBundle(import.meta.dirname, ['lib/types/index.js'])

export default ((options) => bundle(options).map(config => ({
  ...config,
  plugins: [...(config.plugins ?? []), {
    name: 'settings-sounds-audio',
    resolveId(source: string) {
      if (!/^\.\/assets\/[^/]+\.aac$/.test(source)) return null
      const url = new URL(`./src/client/assets/${basename(source)}`, import.meta.url)
      return fileURLToPath(url)
    },
    async load(id: string) {
      if (!/\/ui-settings-sounds\/src\/client\/assets\/[^/]+\.aac$/.test(id.replaceAll('\\', '/'))) return null
      this.addWatchFile(id)
      const data = await readFile(id)
      return `export default ${JSON.stringify(`data:audio/aac;base64,${data.toString('base64')}`)}`
    },
  }],
}))) satisfies typeof bundle
