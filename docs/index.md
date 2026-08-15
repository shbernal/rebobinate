# Documentation Index

Contributor-facing notes for the extension internals. Keep user-facing marketing
or installation copy out of this directory.

- [Code Overview](./code-overview.md) — the runtime surfaces and the contracts
  between them, including why the keyboard and video discovery work the way they
  do.
- [Testing](./testing.md) — the Vitest setup, the Chrome API mock, the
  Playwright suite, and where to add coverage.
- [Ad Blockers](./ad-blockers.md) — how element hiding works, what the badge
  does to stay out of its way, and the three tiers that check it: a filter-list
  scan, the real uBlock Origin on Gecko, and the mechanism replayed in CI.
- [Build Targets](./build-targets.md) — the Chrome and Firefox builds, how the
  manifests differ, the callback-only `chrome.*` rule, why the popup cannot use
  a native colour picker, and the crxjs entry-name constraint.
- [Store Listings](./store-listings.md) — the copy and screenshots shared by
  both stores, the per-store metadata, how the AMO listing and its media are
  applied through the API, privacy answers, and the source-submission
  requirement.
- [CI and Release Flow](./ci-release-flow.md) — validation on every push and
  publishing to both stores from a GitHub Release.

When behavior, the settings shape, Chrome API usage, or the test harness
changes, check whether these docs should be updated in the same change.
