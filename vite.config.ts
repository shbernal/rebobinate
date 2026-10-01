import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { crx } from '@crxjs/vite-plugin'
import type { ManifestV3Export } from '@crxjs/vite-plugin'
import react from '@vitejs/plugin-react'
import { build, defineConfig } from 'vite'
import type { Plugin, PluginOption, UserConfig } from 'vite'
import manifest from './manifest.config.ts'

// crxjs still emits both `rollupOptions` and `rolldownOptions` on Vite 8, which
// makes Vite warn on every build. Drop the rolldown half of the pair.
function fixCrxVite8Warning(pluginOption: PluginOption): PluginOption {
  if (Array.isArray(pluginOption)) {
    return pluginOption.map(fixCrxVite8Warning)
  }

  if (
    !pluginOption ||
    typeof pluginOption !== 'object' ||
    !('name' in pluginOption)
  ) {
    return pluginOption
  }

  const plugin = pluginOption as Plugin

  if (plugin.name !== 'crx:content-scripts' || plugin.apply !== 'build') {
    return plugin
  }

  const originalConfig = plugin.config

  if (typeof originalConfig !== 'function') {
    return plugin
  }

  return {
    ...plugin,
    async config(config, env) {
      const result = await originalConfig.call(this, config, env)

      if (
        result?.build &&
        'rollupOptions' in result.build &&
        'rolldownOptions' in result.build
      ) {
        const { rolldownOptions: _rolldownOptions, ...build } = result.build
        return { ...result, build } satisfies Omit<UserConfig, 'plugins'>
      }

      return result
    },
  }
}

type ContentScript = { js?: string[] } & Record<string, unknown>

const alias = { '@': path.resolve(import.meta.dirname, 'src') }

/**
 * crxjs ships a content script as a small loader that `import()`s the real
 * chunk, which only works if that chunk and everything it imports are listed
 * in `web_accessible_resources` for `<all_urls>`, at a stable URL. Any page
 * can then fetch one of them to learn the extension is installed, and which
 * build. So a build hands crxjs the manifest without its content scripts and
 * bundles each one here instead, as a single self-contained IIFE nothing has
 * to fetch. `pnpm dev` keeps the crxjs path for its hot reload.
 */
function bundleContentScripts(
  contentScripts: ContentScript[],
  outDir: string,
): Plugin {
  return {
    name: 'rebobinate:content-scripts',
    apply: 'build',
    async closeBundle() {
      const bundled = await Promise.all(
        contentScripts.map(async script => ({
          ...script,
          js: await Promise.all((script.js ?? []).map(bundleScript)),
        })),
      )

      const manifestPath = path.join(outDir, 'manifest.json')
      const emitted = JSON.parse(await readFile(manifestPath, 'utf8'))
      emitted.content_scripts = bundled
      await writeFile(manifestPath, `${JSON.stringify(emitted, null, 2)}\n`)
    },
  }

  async function bundleScript(entry: string) {
    const result = await build({
      configFile: false,
      logLevel: 'warn',
      resolve: { alias },
      build: {
        outDir,
        emptyOutDir: false,
        copyPublicDir: false,
        rolldownOptions: {
          input: path.resolve(import.meta.dirname, entry),
          output: {
            format: 'iife',
            entryFileNames: `assets/${path.basename(entry, '.ts')}-[hash].js`,
          },
        },
      },
    })
    const outputs = Array.isArray(result) ? result : [result]
    const chunk = outputs
      .flatMap(output => ('output' in output ? output.output : []))
      .find(file => file.type === 'chunk' && file.isEntry)

    if (!chunk) {
      throw new Error(`No bundle came out of ${entry}`)
    }

    return chunk.fileName
  }
}

/** The manifest crxjs builds from: everything but the content scripts. */
async function withoutContentScripts(
  source: ManifestV3Export,
): Promise<{ crxManifest: ManifestV3Export; contentScripts: ContentScript[] }> {
  const resolved =
    typeof source === 'function'
      ? await source({ command: 'build', mode: 'production' })
      : await source
  const { content_scripts: contentScripts = [], ...rest } = resolved

  return { crxManifest: rest, contentScripts }
}

// `EXT_TARGET=firefox` builds the AMO package into `dist-firefox/`. Any other
// value, including none, builds the Chrome package into `dist/`.
const isFirefox = process.env.EXT_TARGET === 'firefox'
const outDir = isFirefox ? 'dist-firefox' : 'dist'
const browser = isFirefox ? 'firefox' : 'chrome'

export default defineConfig(async ({ command }) => {
  const plugins: PluginOption[] = [react()]

  if (command === 'build') {
    const { crxManifest, contentScripts } =
      await withoutContentScripts(manifest)

    plugins.push(
      fixCrxVite8Warning(crx({ manifest: crxManifest, browser })),
      bundleContentScripts(contentScripts, outDir),
    )
  } else {
    plugins.push(fixCrxVite8Warning(crx({ manifest, browser })))
  }

  return {
    resolve: { alias },
    plugins,
    build: { outDir },
    server: {
      cors: {
        origin: isFirefox ? [/moz-extension:\/\//] : [/chrome-extension:\/\//],
      },
    },
  }
})
