import { fileURLToPath } from 'node:url'
import type { BrowserContext, Route } from '@playwright/test'

export const FIXTURE_ORIGIN = 'https://player.test'
export const EMBED_ORIGIN = 'https://embed.test'

const mediaDir = fileURLToPath(new URL('./media/', import.meta.url))

const MEDIA_TYPES: Record<string, string> = {
  '/media/clip.mp4': 'video/mp4',
  '/media/clip.webm': 'video/webm',
}

const shell = (title: string, body: string) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; }
      video { width: 640px; height: 360px; background: #222; display: block; }
      iframe { width: 660px; height: 380px; border: 0; }
      .spacer { height: 1400px; }
    </style>
  </head>
  <body>${body}</body>
</html>
`

const PAGES: Record<string, string> = {
  '/simple': shell('Simple player', '<video id="player"></video>'),
  '/with-search': shell(
    'Player and search box',
    '<input id="search" type="search" /><video id="player"></video>',
  ),
  '/scrolling': shell(
    'Player above the fold',
    '<video id="player"></video><div class="spacer"></div>',
  ),
  '/no-video': shell('No video here', '<p id="text">nothing to speed up</p>'),
  // Served with a CSP that forbids stylesheets entirely. The badge styles
  // itself from a `<style>` element it puts in its own shadow root, and a
  // content script's DOM lives in an isolated world with its own CSP — this is
  // the fixture that proves it, because a page that blocked it would leave the
  // badge unstyled and invisible rather than absent.
  '/strict-csp': shell('Strict CSP', '<video id="player"></video>'),
  '/shadow': shell(
    'Player inside a web component',
    `<div id="host"></div>
     <script>
       const shadow = document.getElementById('host').attachShadow({ mode: 'open' })
       shadow.innerHTML = '<video id="player" style="width:640px;height:360px"></video>'
     </script>`,
  ),
  '/embedder': shell(
    'Third-party embed',
    `<h1>An article</h1><iframe src="${EMBED_ORIGIN}/simple"></iframe>`,
  ),
  // The only fixture with real media behind it. `muted` is what lets it play
  // without a user gesture, and it deliberately does not loop — a test that
  // watches `currentTime` cannot tell a wrap-around from a stall.
  '/playing': shell(
    'Player with real media',
    `<video id="player" src="/media/clip.mp4" muted playsinline
            preload="auto"></video>`,
  ),
}

const STRICT_CSP = "default-src 'self'; style-src 'none'; script-src 'self'"

const fulfillPage = (route: Route, pathname: string) => {
  const contentType = MEDIA_TYPES[pathname]

  if (contentType) {
    // Served whole, with no range support. Chromium only needs byte ranges to
    // seek efficiently, and at 30 KB there is nothing to seek through.
    return route.fulfill({
      status: 200,
      contentType,
      path: `${mediaDir}${pathname.slice('/media/'.length)}`,
    })
  }

  const body = PAGES[pathname]

  if (!body) {
    return route.fulfill({ status: 404, body: 'not a fixture' })
  }

  return route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
    headers:
      pathname === '/strict-csp'
        ? { 'content-security-policy': STRICT_CSP }
        : {},
    body,
  })
}

/**
 * The fixtures are served by intercepting requests to two invented origins.
 * Content scripts still inject on those navigations, which `file://` URLs
 * would not do without an extra Chrome permission.
 */
export const installFixtureRoutes = async (context: BrowserContext) => {
  await context.route(`${FIXTURE_ORIGIN}/**`, route => {
    return fulfillPage(route, new URL(route.request().url()).pathname)
  })

  await context.route(`${EMBED_ORIGIN}/**`, route => {
    return fulfillPage(route, new URL(route.request().url()).pathname)
  })
}
