// Shared `--help` handling for the scripts under `scripts/`. These scripts are
// reached through `pnpm run`, and pnpm forwards trailing flags to the last
// command in the script, so `pnpm package:source --help` arrives here intact.
// People also type the npm-style `pnpm package:source -- --help`, which leaves a
// bare `--` in argv; both spellings have to mean the same thing.
import process from 'node:process'

export const helpRequested = process.argv
  .slice(2)
  .filter(argument => argument !== '--')
  .some(argument => argument === '--help' || argument === '-h')

// Called before the script does any work, so help never launches a browser,
// writes a profile, or touches the network.
export const printHelpAndExit = text => {
  if (!helpRequested) {
    return
  }

  console.log(text.trim())
  process.exit(0)
}

const isFlag = argument => argument.startsWith('-') && argument !== '--'

/**
 * Exits 1 on any flag the script does not know, and on any positional argument
 * when it takes none. Reading flags with `includes` alone turns a typo into the
 * default path, and for `publish:amo` the default path is an irreversible
 * submission: `--dryrun` must stop here, not upload.
 *
 * Called right after `printHelpAndExit`, before any credential is read or any
 * network call made.
 */
export const rejectUnknownArguments = ({ flags = [], positionals = true }) => {
  const known = new Set([...flags, '--help', '-h'])
  const args = process.argv.slice(2)
  const unknown = [
    ...args.filter(argument => isFlag(argument) && !known.has(argument)),
    ...(positionals
      ? []
      : args.filter(argument => !isFlag(argument) && argument !== '--')),
  ]

  if (unknown.length === 0) {
    return
  }

  console.error(`unknown argument: ${unknown.join(', ')} (see --help)`)
  process.exit(1)
}
