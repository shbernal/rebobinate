// AMO requires the source of any bundled or minified add-on, and reviewers
// rebuild it and diff the result against the submitted package. `git archive`
// is the right producer: it emits exactly the tracked tree at a ref, so
// node_modules, build output, and untracked scratch files are excluded by
// construction rather than by a maintained exclude list.
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { execFileSync } from 'node:child_process'
import { printHelpAndExit } from './help.mjs'

printHelpAndExit(`
Usage: pnpm package:source [ref] [--help]

Writes release/rebobinate-source-<version>.zip from the tracked tree at ref,
which is what an AMO reviewer rebuilds and diffs against the submitted package.

  ref   git ref to archive (default: HEAD, or SOURCE_REF)

Release builds must archive the tag, not HEAD. Archiving a dirty HEAD warns,
because the archive holds committed state only.

See amo/source-submission.md.
`)

// Flags are skipped rather than taken positionally, so `--help` cannot reach
// `git archive` as a ref.
const ref =
  process.argv.slice(2).find(argument => !argument.startsWith('-')) ??
  process.env.SOURCE_REF ??
  'HEAD'
const releaseDir = path.resolve(process.cwd(), 'release')

const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim()

const version = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'),
).version

const output = path.join(releaseDir, `rebobinate-source-${version}.zip`)

// The archive is what reviewers build. Archiving a stale HEAD while the fix is
// still in the working tree is the failure this warning exists to catch.
if (ref === 'HEAD' && git(['status', '--porcelain']) !== '') {
  console.warn(
    'warning: working tree is dirty; the archive holds committed state only',
  )
}

fs.mkdirSync(releaseDir, { recursive: true })
git(['archive', '--format=zip', `--output=${output}`, ref])

const files = git(['ls-tree', '-r', '--name-only', ref]).split('\n').length
const size = fs.statSync(output).size

console.log(`${path.relative(process.cwd(), output)}`)
console.log(
  `ref ${git(['rev-parse', '--short', ref])} — ${files} files, ${size} bytes`,
)
