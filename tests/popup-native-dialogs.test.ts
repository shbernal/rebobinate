import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// On Firefox the action popup is a XUL panel, and an input that opens a native
// chooser opens it as a separate toplevel window. That window takes focus, the
// panel rolls up, and the popup document is destroyed before the user has
// chosen anything — so the `change` event fires on nothing and the choice is
// silently dropped. The popup renders its own controls instead.
// See docs/build-targets.md#no-native-pickers-in-the-popup.
const POPUP_ROOT = resolve(process.cwd(), 'src/popup')
const SOURCE_EXTENSIONS = ['.ts', '.tsx']
const NATIVE_DIALOG_INPUT = /type=\s*\{?\s*['"](?:color|file)['"]/
const COMMENT = /\/\*[\s\S]*?\*\/|\/\/[^\n]*/g

/**
 * The comments are the one place `type="color"` is expected to appear, since
 * that is where the rule is explained. Only code is scanned.
 */
const codeOf = (file: string): string => {
  return readFileSync(file, 'utf8').replace(COMMENT, '')
}

const collectSourceFiles = (directory: string): string[] => {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = join(directory, entry.name)

    if (entry.isDirectory()) {
      return collectSourceFiles(entryPath)
    }

    return SOURCE_EXTENSIONS.some(extension => entry.name.endsWith(extension))
      ? [entryPath]
      : []
  })
}

describe('popup native dialogs', () => {
  it('keeps inputs that open a native chooser out of the popup', () => {
    const sourceFiles = collectSourceFiles(POPUP_ROOT).filter(
      file => !file.endsWith('.test.ts') && !file.endsWith('.test.tsx'),
    )
    const offenders = sourceFiles
      .filter(file => NATIVE_DIALOG_INPUT.test(codeOf(file)))
      .map(file => relative(POPUP_ROOT, file))

    expect(sourceFiles.length).toBeGreaterThan(0)
    expect(offenders).toEqual([])
  })
})
