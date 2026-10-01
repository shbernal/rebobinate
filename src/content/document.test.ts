import { describe, expect, it, vi } from 'vitest'
import { isControllableDocument } from './document'

const documentOfType = (contentType: string) => {
  vi.spyOn(document, 'contentType', 'get').mockReturnValue(contentType)
  return document
}

describe('isControllableDocument', () => {
  it.each([
    ['text/html', true],
    ['application/xhtml+xml', true],
    // A video opened on its own is a document wrapping one `<video>`.
    ['video/mp4', true],
    ['video/webm', true],
    ['text/xml', false],
    ['application/xml', false],
    ['image/svg+xml', false],
    ['image/png', false],
    ['text/plain', false],
  ])('%s → %s', (contentType, expected) => {
    expect(isControllableDocument(documentOfType(contentType))).toBe(expected)
  })
})
