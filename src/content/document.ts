/**
 * Whether a document is one the content script should start in.
 *
 * It matches `<all_urls>`, which reaches documents that are not pages at all,
 * and starting there costs a mutation observer, seven listeners and a round
 * trip to the service worker for nothing. In: HTML, XHTML, and a media file
 * opened on its own, which the browser shows as a document wrapping one
 * `<video>`. Out: XML, SVG (whose root would take the badge's HTML host), images
 * and plain text, none of which can hold a video.
 */
export const isControllableDocument = (doc: Document): boolean => {
  if (!doc.documentElement) {
    return false
  }

  const type = doc.contentType

  return (
    type === 'text/html' ||
    type === 'application/xhtml+xml' ||
    type.startsWith('video/')
  )
}
