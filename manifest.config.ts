import { defineManifest } from '@crxjs/vite-plugin'
import pkg from './package.json'

// Gecko needs an explicit add-on id and an up-front data-collection answer.
// Chrome has no use for either key, so they are only emitted for the Firefox
// build and the default build stays exactly as it ships to the Chrome Web
// Store.
const isFirefox = process.env.EXT_TARGET === 'firefox'

export default defineManifest({
  manifest_version: 3,
  name: 'Rebobinate',
  version: pkg.version,
  description: pkg.description,
  permissions: ['storage'],
  host_permissions: ['<all_urls>'],
  // Gecko has no extension service workers, and crxjs reads the background
  // entry straight off this manifest rather than rewriting it per target.
  background: isFirefox
    ? { scripts: ['src/background/service-worker.ts'] }
    : { service_worker: 'src/background/service-worker.ts', type: 'module' },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/content-script.ts'],
      // `document_start` is required: the shadow-root hook has to be installed
      // before page scripts create their players, or videos inside web
      // components stay invisible to the registry.
      run_at: 'document_start',
      all_frames: true,
      match_about_blank: true,
    },
  ],
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'Rebobinate',
  },
  icons: {
    16: 'icons/icon16.png',
    48: 'icons/icon48.png',
    128: 'icons/icon128.png',
  },
  ...(isFirefox
    ? {
        browser_specific_settings: {
          gecko: {
            id: 'rebobinate@shbernal.github.io',
            // 140 is the floor for `data_collection_permissions`; below it the
            // key is ignored and the disclosure never reaches the user.
            strict_min_version: '140.0',
            // The extension reads and writes nothing but its own settings.
            data_collection_permissions: { required: ['none'] },
          },
        },
      }
    : {}),
})
