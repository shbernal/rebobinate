import { describe, expect, it } from 'vitest'
import { domainKey, domainKeyFromUrl } from './domain'

describe('domainKey', () => {
  it('collapses the subdomains of one site onto one key', () => {
    expect(domainKey('www.youtube.com')).toBe('youtube.com')
    expect(domainKey('m.youtube.com')).toBe('youtube.com')
    expect(domainKey('music.youtube.com')).toBe('youtube.com')
    expect(domainKey('youtube.com')).toBe('youtube.com')
  })

  it('keeps a third label for a multi-part suffix', () => {
    // Without the suffix table this keys as `co.uk`, which puts every UK site
    // in one bucket — the one failure mode anybody would notice.
    expect(domainKey('news.bbc.co.uk')).toBe('bbc.co.uk')
    expect(domainKey('bbc.co.uk')).toBe('bbc.co.uk')
    expect(domainKey('www.globo.com.br')).toBe('globo.com.br')
    expect(domainKey('video.nhk.or.jp')).toBe('nhk.or.jp')
  })

  it('is case- and trailing-dot-insensitive', () => {
    expect(domainKey('WWW.YouTube.COM.')).toBe('youtube.com')
  })

  it('keeps an IP literal whole', () => {
    // `192.168.1.10` would otherwise key as `1.10`, sharing one speed with
    // every other host on the subnet.
    expect(domainKey('192.168.1.10')).toBe('192.168.1.10')
    expect(domainKey('[::1]')).toBe('[::1]')
  })

  it('keeps a single-label host whole', () => {
    expect(domainKey('localhost')).toBe('localhost')
    expect(domainKey('intranet')).toBe('intranet')
  })

  it('has no key for an empty hostname', () => {
    expect(domainKey('')).toBeNull()
    expect(domainKey('   ')).toBeNull()
  })

  // The accepted cost of not bundling a public suffix list: two sites on a
  // shared hosting suffix share a speed. One keypress fixes it.
  it('shares a key across a hosting suffix it does not know', () => {
    expect(domainKey('alice.github.io')).toBe('github.io')
    expect(domainKey('bob.github.io')).toBe('github.io')
  })
})

describe('domainKeyFromUrl', () => {
  it('keys an http(s) page by its registrable domain', () => {
    expect(domainKeyFromUrl('https://www.vimeo.com/12345?x=1')).toBe(
      'vimeo.com',
    )
    expect(domainKeyFromUrl('http://example.org/')).toBe('example.org')
  })

  it('has no key for a page that is not a site', () => {
    expect(domainKeyFromUrl('chrome://extensions')).toBeNull()
    expect(domainKeyFromUrl('about:blank')).toBeNull()
    expect(domainKeyFromUrl('file:///home/user/clip.mp4')).toBeNull()
    expect(domainKeyFromUrl('data:text/html,<video>')).toBeNull()
    expect(domainKeyFromUrl('moz-extension://abc/popup.html')).toBeNull()
  })

  it('has no key for a missing or unparseable URL', () => {
    expect(domainKeyFromUrl(undefined)).toBeNull()
    expect(domainKeyFromUrl('')).toBeNull()
    expect(domainKeyFromUrl('not a url')).toBeNull()
  })
})
