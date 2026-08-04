/**
 * Turning a page URL into the key its remembered speed is stored under.
 *
 * The target is the registrable domain, so that `www.youtube.com` and
 * `m.youtube.com` share one setting. Resolving that exactly needs the public
 * suffix list, which an extension can only have by bundling it — tens of
 * kilobytes in every build plus a refresh at every release. That trade is not
 * worth it here: when this guess is wrong, two sites share a speed, and the
 * user corrects it with one keypress.
 *
 * So the rule is "the last two labels", with a third kept when the last two are
 * a known multi-part suffix. That table is the part that earns its keep:
 * without it `bbc.co.uk` keys as `co.uk` and every UK site shares one speed,
 * which is the one failure anybody would notice. It does not need to be
 * complete, only to cover the suffixes people actually browse.
 */
const MULTI_PART_SUFFIXES = new Set([
  'ac.jp',
  'ac.uk',
  'co.id',
  'co.il',
  'co.in',
  'co.jp',
  'co.kr',
  'co.nz',
  'co.th',
  'co.uk',
  'co.za',
  'com.ar',
  'com.au',
  'com.bd',
  'com.br',
  'com.cn',
  'com.co',
  'com.eg',
  'com.hk',
  'com.mx',
  'com.my',
  'com.ng',
  'com.pe',
  'com.ph',
  'com.pk',
  'com.pl',
  'com.sa',
  'com.sg',
  'com.tr',
  'com.tw',
  'com.ua',
  'com.uy',
  'com.ve',
  'com.vn',
  'edu.au',
  'go.jp',
  'gov.uk',
  'govt.nz',
  'ne.jp',
  'net.au',
  'net.br',
  'net.nz',
  'net.uk',
  'or.jp',
  'org.au',
  'org.br',
  'org.il',
  'org.nz',
  'org.uk',
  'org.za',
])

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/

/**
 * The registrable domain for a hostname, or `null` when there is nothing to
 * key on. Exported on its own so the rule is testable without building URLs.
 */
export const domainKey = (hostname: string): string | null => {
  const host = hostname.trim().toLowerCase().replace(/\.$/, '')

  if (host === '') {
    return null
  }

  // An IP literal has no registrable domain to find. `192.168.1.1` would
  // otherwise key as `1.1`, putting every host on that subnet in one bucket.
  // IPv6 arrives bracketed from `URL.hostname`.
  if (IPV4.test(host) || host.startsWith('[')) {
    return host
  }

  const labels = host.split('.')

  // `localhost` and intranet single-label names are already the whole key.
  if (labels.length < 3) {
    return labels.join('.')
  }

  if (MULTI_PART_SUFFIXES.has(labels.slice(-2).join('.'))) {
    return labels.slice(-3).join('.')
  }

  return labels.slice(-2).join('.')
}

/**
 * Only a real site gets a key. `chrome://`, `about:`, `file://`, `data:` and
 * the extension's own pages have nothing stable to remember a speed against,
 * and a `null` here is what keeps them out of the stored map entirely.
 */
export const domainKeyFromUrl = (url: string | undefined): string | null => {
  if (!url) {
    return null
  }

  try {
    const parsed = new URL(url)

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }

    return domainKey(parsed.hostname)
  } catch {
    return null
  }
}
