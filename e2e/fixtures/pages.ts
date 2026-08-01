import type { BrowserContext, Route } from '@playwright/test'

export const FIXTURE_ORIGIN = 'https://player.test'
export const EMBED_ORIGIN = 'https://embed.test'

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
}

const fulfillPage = (route: Route, pathname: string) => {
  const body = PAGES[pathname]

  if (!body) {
    return route.fulfill({ status: 404, body: 'not a fixture' })
  }

  return route.fulfill({
    status: 200,
    contentType: 'text/html; charset=utf-8',
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
