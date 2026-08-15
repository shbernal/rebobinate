// Checks the badge against the cosmetic filters ad blockers actually ship.
//
// A cosmetic filter is a CSS selector: a blocker collects the ones in scope for
// the page and injects `selector { display: none !important }` at user origin.
// So "will an ad blocker hide our badge?" is a question with an exact answer —
// does any shipped selector match the element the extension puts on the page —
// and this script asks it, in a real Chromium, against a real run of the built
// extension rather than against a hand-copied idea of what it builds.
//
// It reports two things:
//
//   hits    selectors matching the badge host as it exists today. Any hit is a
//           failure: on the sites that filter is scoped to, the badge is gone.
//   bait    selectors matching a deliberately overlay-shaped decoy — a fixed,
//           high-z-index, inline-styled div. These are the filters the badge
//           has to keep not looking like, and they are what gets vendored into
//           `e2e/fixtures/blocker/filters.json` so the e2e tier can replay them
//           offline.
//
// See docs/ad-blockers.md.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { printHelpAndExit } from './help.mjs'
import {
  extensionPath,
  launchWithExtension,
  requireBuild,
  showBadge,
} from './chromium.mjs'

printHelpAndExit(`
Usage: pnpm check:filters [--refresh] [--write-fixture] [--json] [--help]

Matches every cosmetic filter in uBlock Origin's default list set, plus AdGuard
Base, against the badge the built extension actually renders. Run after
\`pnpm build\`.

  --refresh        re-download the filter lists instead of using the cached
                   copies under node_modules/.tmp/filter-lists
  --write-fixture  rewrite e2e/fixtures/blocker/filters.json from this run
  --json           print the full report as JSON

Exit code is 1 when a filter matches the badge host, which is what "an ad
blocker hides the badge on these sites" looks like from here.
`)

const LISTS = {
  'ublock-filters':
    'https://ublockorigin.github.io/uAssets/filters/filters.txt',
  'ublock-badware':
    'https://ublockorigin.github.io/uAssets/filters/badware.txt',
  'ublock-privacy':
    'https://ublockorigin.github.io/uAssets/filters/privacy.txt',
  'ublock-unbreak':
    'https://ublockorigin.github.io/uAssets/filters/unbreak.txt',
  'ublock-quick-fixes':
    'https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt',
  easylist: 'https://ublockorigin.github.io/uAssets/thirdparties/easylist.txt',
  easyprivacy:
    'https://ublockorigin.github.io/uAssets/thirdparties/easyprivacy.txt',
  // Not part of uBO's default set, and included anyway. AdGuard has its own
  // base list and its own generic rules, and "ad blockers" is the question, not
  // "uBlock Origin"; the annoyances lists are opt-in but widely turned on, and
  // they are where the aggressive overlay-killing filters live. The
  // uBlock-flavoured AdGuard build is used so one parser covers both.
  'adguard-base': 'https://filters.adtidy.org/extension/ublock/filters/2.txt',
  'ublock-annoyances-cookies':
    'https://ublockorigin.github.io/uAssets/filters/annoyances-cookies.txt',
  'ublock-annoyances-others':
    'https://ublockorigin.github.io/uAssets/filters/annoyances-others.txt',
}

/**
 * Sites where being hidden is accepted rather than a failure.
 *
 * Some filters are not aimed at anything in particular: they hide every element
 * the site is not known to own, to stop a page rebuilding its popunder under a
 * new name. There is no shape the badge could take that would survive one, and
 * the only way around it is to ask the list maintainers for an exception. Keyed
 * by filter scope, so a rule being rewritten does not silently un-accept it.
 */
const ACCEPTED_SCOPES = {
  'hotcleaner.com':
    'AdGuard hides every empty div there; the host is empty in the light DOM ' +
    'because everything it shows lives in its shadow root',
  'japscan.*':
    'uBO quick-fix hides every div with an id that is not on their allowlist; ' +
    'a manga reader, so no video to control anyway',
}

const cacheDir = path.resolve(process.cwd(), 'node_modules/.tmp/filter-lists')
const fixturePath = path.resolve(
  process.cwd(),
  'e2e/fixtures/blocker/filters.json',
)
const profilePath = path.resolve(
  process.cwd(),
  'node_modules/.tmp/filter-check-profile',
)

const argv = process.argv.slice(2)
const refresh = argv.includes('--refresh')
const writeFixture = argv.includes('--write-fixture')
const asJson = argv.includes('--json')

const readList = async (name, url) => {
  const cached = path.join(cacheDir, `${name}.txt`)

  if (!refresh && fs.existsSync(cached)) {
    return fs.readFileSync(cached, 'utf8')
  }

  const response = await fetch(url)

  if (!response.ok) {
    throw new Error(`${name}: ${response.status} ${response.statusText}`)
  }

  const text = await response.text()
  fs.mkdirSync(cacheDir, { recursive: true })
  fs.writeFileSync(cached, text)

  return text
}

/**
 * Cosmetic filters are `scope##selector`. An empty scope makes the filter
 * generic — it applies to every site, which is the class that would take the
 * badge down everywhere rather than on a handful of hostnames.
 *
 * `#@#` exceptions are skipped (they only ever un-hide), and so are `+js(...)`
 * scriptlets, which are code injected into the page's main world and cannot
 * touch a content script's DOM from there.
 */
const parseCosmeticFilters = (text, listName, into) => {
  for (const raw of text.split('\n')) {
    const line = raw.trim()

    if (!line || line.startsWith('!') || line.startsWith('[')) {
      continue
    }

    const match = /^(.*?)(#@?\??#)(.+)$/.exec(line)

    if (!match) {
      continue
    }

    const [, scope, separator, selector] = match

    if (separator === '#@#' || selector.startsWith('+js(')) {
      continue
    }

    const entry = into.get(selector) ?? { scopes: new Set(), lists: new Set() }
    entry.scopes.add(scope || '*')
    entry.lists.add(listName)
    into.set(selector, entry)
  }
}

const filters = new Map()

for (const [name, url] of Object.entries(LISTS)) {
  parseCosmeticFilters(await readList(name, url), name, filters)
}

const selectors = [...filters.keys()]

requireBuild()
fs.rmSync(profilePath, { recursive: true, force: true })

const context = await launchWithExtension({ profilePath })

// A page with a video, so the content script has something to anchor to, on an
// origin no filter list has ever heard of — the scoped filters are applied here
// by hand afterwards, rather than left to whatever the hostname happens to hit.
await context.route('https://player.test/**', route =>
  route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><title>filter check</title></head>
      <body><video id="player" style="width:640px;height:360px"></video></body>
      </html>`,
  }),
)

const page = context.pages()[0] ?? (await context.newPage())
await page.goto('https://player.test/simple')

if (!(await showBadge(context, page))) {
  console.error('the badge never appeared — is dist/ current?')
  await context.close()
  process.exit(2)
}

const report = await page.evaluate(list => {
  const host = document.getElementById('rebobinate-speed-host')

  // The shapes the badge must never drift back into: an overlay that announces
  // itself through an inline style attribute. Filter lists hunt these to kill
  // popunders, and they are indifferent to what the overlay is for. Four of
  // them, because the parent and the presence of an id or class each change
  // what matches — `body > div[style*="z-index:"]` is a real filter, and so is
  // `div[style]:not([class])`.
  const overlayStyle =
    'position:fixed;z-index:2147483647;display:flex;top:0;left:0'
  const bait = [
    { parent: 'html', id: 'overlay-badge', className: 'overlay-badge' },
    { parent: 'body', id: 'overlay-badge', className: 'overlay-badge' },
    { parent: 'html', id: 'rebobinate-speed-host', className: '' },
    { parent: 'body', id: '', className: '' },
  ].map(shape => {
    const element = document.createElement('div')

    if (shape.id) {
      element.id = shape.id
    }

    if (shape.className) {
      element.className = shape.className
    }

    element.setAttribute('style', overlayStyle)
    ;(shape.parent === 'html'
      ? document.documentElement
      : document.body
    ).append(element)

    return element
  })

  const hits = []
  const baited = []
  const unsupported = []

  for (const selector of list) {
    try {
      if (host.matches(selector)) {
        hits.push(selector)
      }

      if (bait.some(element => element.matches(selector))) {
        baited.push(selector)
      }
    } catch {
      // Procedural filters (`:has-text`, `:matches-css`, `:style`) are uBO
      // extensions to CSS, not selectors a browser can evaluate.
      unsupported.push(selector)
    }
  }

  bait.forEach(element => element.remove())

  return {
    hits,
    baited,
    unsupported: unsupported.length,
    hostHtml: host.cloneNode(false).outerHTML,
  }
}, selectors)

await context.close()

const describe = selector => ({
  selector,
  scopes: [...filters.get(selector).scopes],
  lists: [...filters.get(selector).lists],
})

const isAccepted = hit =>
  hit.scopes.every(scope => ACCEPTED_SCOPES[scope] !== undefined)

const allHits = report.hits.map(describe)

const result = {
  extensionPath,
  lists: Object.keys(LISTS),
  selectorsChecked: selectors.length,
  proceduralSkipped: report.unsupported,
  badgeHost: report.hostHtml,
  hits: allHits.filter(hit => !isAccepted(hit)),
  accepted: allHits.filter(isAccepted),
  bait: report.baited.map(describe),
}

if (writeFixture) {
  fs.writeFileSync(
    fixturePath,
    `${JSON.stringify(
      {
        comment:
          'Generated by `pnpm check:filters --write-fixture`. Cosmetic filters from uBlock Origin default lists that hide an overlay-shaped element and that the badge is expected to survive. e2e/specs/ad-blockers.spec.ts replays them as user-origin CSS.',
        lists: Object.keys(LISTS),
        // Anything that matches the badge as it stands is left out: those are
        // the accepted losses (`ACCEPTED_SCOPES`), and the e2e tier asserts
        // survival. A selector cannot be both.
        selectors: report.baited.filter(
          selector => !report.hits.includes(selector),
        ),
      },
      null,
      2,
    )}\n`,
  )
}

if (asJson) {
  console.log(JSON.stringify(result, null, 2))
} else {
  console.log(`badge host: ${result.badgeHost}`)
  console.log(
    `checked ${result.selectorsChecked} cosmetic selectors from ${result.lists.length} lists ` +
      `(${result.proceduralSkipped} procedural, not evaluable as CSS)`,
  )
  console.log(`overlay-shaped bait matched by ${result.bait.length} of them`)

  for (const hit of result.accepted) {
    console.log(
      `accepted on ${hit.scopes.join(', ')}: ${ACCEPTED_SCOPES[hit.scopes[0]]}`,
    )
  }

  if (writeFixture) {
    console.log(`wrote ${path.relative(process.cwd(), fixturePath)}`)
  }

  if (result.hits.length === 0) {
    console.log('\nno shipped cosmetic filter matches the badge host')
  } else {
    console.log(`\n${result.hits.length} filters match the badge host:`)

    for (const hit of result.hits) {
      console.log(`  ${hit.selector}`)
      console.log(`      sites: ${hit.scopes.join(', ')}`)
      console.log(`      lists: ${hit.lists.join(', ')}`)
    }
  }
}

process.exit(result.hits.length === 0 ? 0 : 1)
