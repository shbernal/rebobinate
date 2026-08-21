# Code Overview

Three runtime surfaces — the content script (in every frame), the service
worker, and the popup — plus the shared contracts in `src/shared/`.

## Who owns the speed

The service worker does, per tab.

A keystroke only reaches the frame that has focus, and the popup is not a frame
at all. Both send an _intent_ (`increase`, `decrease`, `reset`) to the service
worker, which resolves it against the current tab speed and the user's step, and
broadcasts the result to **every frame of the tab**. That broadcast is what makes
the controls work on a page whose player lives in an iframe.

The map is in memory on purpose. If the service worker is evicted, the next
intent carries the sending frame's own speed (`currentSpeed`), so the tab
resumes from the truth on the page instead of snapping back to 1.0.

A `rebobinate:query` from the top frame (`frameId === 0`) means a new page: the
tab's speed and frame bookkeeping are cleared, and the speed is resolved again
from what the tab's domain is remembered at. Sub-frames use the same query to
inherit a speed that was set before they existed; one that asks before the top
frame has (which happens) resolves from the tab's domain too, rather than
sitting at 1.0 until the broadcast corrects it.

## Per-site speed memory

The speed chosen on a site is written down and applied on the next visit. The
service worker owns it, for the same reason it owns the tab speed: the domain a
page counts as is a property of the tab, not of the frame the keystroke reached.

**The key is the registrable domain**, resolved by `src/shared/domain.ts`, so
`www.youtube.com` and `m.youtube.com` share one setting. Getting that exactly
right needs the public suffix list, which an extension can only have by bundling
it — tens of kilobytes in every build plus a refresh at every release. That is
not worth it here: when the guess is wrong two sites share a speed, and one
keypress fixes it. So the rule is "the last two labels", with a third kept when
the last two are a known multi-part suffix. That table is the part that earns
its keep — without it `bbc.co.uk` keys as `co.uk` and every UK site shares one
speed, which is the one failure anybody would notice. IP literals and
single-label hosts are kept whole; `chrome://`, `about:`, `file://` and `data:`
pages get no key at all and are never written down.

**The domain is the top frame's.** A YouTube embed on a blog follows the blog's
setting, not YouTube's, because the site a page belongs to is the one in the
address bar. It also means one setting covers a site and everything it embeds.

**Writes are debounced by a second, per domain.** Ramping from 1.0 to 2.0 in
twenty keypresses is one write, not twenty. A pending timer dies with the
service worker, but eviction takes thirty seconds of idle, so a second is well
inside the margin.

**`reset` forgets rather than records.** `0` returns to `defaultSpeed` and drops
the entry: it is the "make this site normal again" gesture, and a map full of
entries that only repeat the default would spend the eviction budget on nothing.

**Private windows leave no trace.** The check is `sender.tab.incognito` rather
than `chrome.extension.inIncognitoContext`, which answers for the caller's own
context and is not what a shared background page needs to know.

`rememberPerDomain` turns the whole thing off: no per-domain state is read or
written, and every tab starts at `defaultSpeed`. At its default of `1.0` that is
exactly the behaviour of the first releases.

**A site can also be switched off on its own.** An entry in the map is either a
remembered speed or a `never` marker, and a marker means the site is left out
entirely: its speed is not applied on load and a keystroke on it writes nothing.
That guard lives in `rememberDomain` rather than at its call sites, so every
writer gets it. `forgetDomain` leaves a marker standing, because `0` on such a
site means "back to normal here", not "start watching me again", and the LRU cap
counts the two kinds of entry separately — a profile with 500 remembered speeds
must not quietly evict an opt-out and start remembering the site again.

The Speed tab says when it is writing one of these, and gives the user something
to do about it. `App.tsx` hands `SpeedPane` the resolved domain, whether it is
being remembered — memory on, a domain to hang it on, no marker on this one —
and whether that domain has an entry yet. The row under the presets appears when
the first three hold, and the fourth picks its tense: _"Speeds set here are kept
for X"_ with nothing stored, _"Remembered for X"_ once there is. The split exists
because per-site memory ships on: a receipt issued on a site nothing has ever
been written for is the extension's only claim about where a user's speed goes,
made false on every fresh install. The promise states the rule rather than
describing a state, for the same reason — the Sites tab says _"No sites are
remembered yet"_ at that moment, and both have to be true at once.

**Neither tense is only a sentence.** Stepping the speed writes a rule that
applies on every later visit and this is the only screen that says so as it
happens, so each half of the row carries the control its words imply: the
receipt is followed by a **Forget** button sending the same
`rebobinate:forget-domain` the Sites row's ✕ sends, and the promise is itself a
button that switches to the Sites tab, where the rule can be set for this site
and every other one. Undoing the write where it was announced is one click, and
a control appearing is also a louder change of state than a verb changing —
which is what the tense switch alone amounted to. The Sites tab's own
empty state splits on the same question: _"No other site is remembered yet."_
only while this tab's site is the one that is.

The marker only ever appears from the Sites tab, which is also where a
remembered speed can be edited or dropped for any site rather than only the one
in front of the user. **A row is one control.** The select carries every state
the row can be in — `Never remember`, `Use default (N×)` with the user's own
default in it, or a speed — and the ✕ beside it is the one-click version of
that select's `Use default`, named for the same outcome (_"Back to the default
speed for X"_) because it calls the same `clear`. It was three controls once,
and two of them did the same thing: a blank option that meant "no entry", a
`Never` switch, and a ✕ that was disabled
on exactly the rows a marker made unreachable. The select is offered even with
nothing remembered yet, because deciding what a site should start at is what the
tab is for, and requiring a video to be stepped somewhere else first made that
the one thing it could not do.

Clearing a row takes two different messages, which is the one trap in that row.
`forgetDomain` leaves a marker standing on purpose, so `rebobinate:forget-domain`
would be a no-op on a switched-off site; the popup sends
`rebobinate:set-domain-never` with `never: false` for those, which removes the
entry outright. Both paths end with no entry, and both the ✕ and the
`Use default` option go through the same `clear` in `SitesPane.tsx` so they
cannot drift apart. Those edits go through the service worker
(`rebobinate:set-domain-speed`, `rebobinate:set-domain-never`,
`rebobinate:forget-domain`) for the same reason: a speed change on that domain
may still be sitting in the debounce, and only the worker can cancel it. A speed
set for the domain the active tab is on is applied to that tab as well —
editing the row for the site being watched and seeing nothing happen would read
as broken.

## Whether a keystroke is ours

`src/content/keys.ts` listens on `window` in the **capture** phase and, when it
handles a key, calls both `preventDefault()` and `stopPropagation()` — otherwise
YouTube's own `0`-seeks-to-start binding fires as well.

It declines the keystroke when:

- a modifier is held (`Ctrl`/`Cmd`/`Alt` belong to the browser or the page);
- an IME composition is in progress;
- anything in `event.composedPath()` is editable — the composed path, not
  `event.target`, because a search box inside a web component is retargeted to
  its host and would otherwise slip through;
- **no frame in the tab has a video.** Not "this frame": a page whose only
  player is an embed has no video in the focused frame, and requiring a local
  one is exactly how a speed extension ends up feeling broken on embeds. Each
  frame reports its media presence (`rebobinate:media`); the service worker
  tracks which frames of the tab have one and broadcasts the tab-level answer
  (`rebobinate:tab-media`).

Bindings match on `KeyboardEvent.key` _or_ `KeyboardEvent.code`, because `+`
needs Shift on many layouts while the numpad keys are only reliably identified
by code.

## Finding the videos

`src/content/media.ts` uses three discovery paths, because none is sufficient
alone:

1. an initial sweep at `document_start` (plus one at `DOMContentLoaded`);
2. a `MutationObserver` for players added later — SPA navigation, lazy loading,
   and short-form feeds that recycle their element per item;
3. capture-phase media events (`loadstart`, `play`, `ratechange`, …) on the
   document. Media events do not bubble, but a capture listener still sees them
   on the way down, which catches players the observer missed.

Open shadow roots are traversed explicitly, and each one is observed. The
`attachShadow` patch other speed extensions use is not available here: a content
script runs in an isolated world, so its `Element.prototype` is not the page's.
Closed shadow roots are therefore out of reach — an accepted gap. The shadow
walk is debounced (250 ms) because it visits every element and busy pages
mutate constantly.

The registry drops detached elements lazily, so a recycled player does not leave
stale nodes behind.

## Holding the speed

`src/content/enforcer.ts` sets `playbackRate` (and `defaultPlaybackRate`) on
every known video, and re-asserts on `ratechange` whenever the reported rate is
not the desired one. Setting the rate once is why speed extensions lose it on
sites that reset the player.

A site that rewrites the rate in a loop would turn that into a pegged CPU, so
corrections are capped at 12 within a one-second window per video; after that
the enforcer backs off until the site stops or the user sets a speed again.

## The badge

`src/content/badge.ts` renders a fixed-position host with a shadow root, laid
over the primary video's bounding box and aligned to the configured corner. It
is never inserted into the site's own tree: re-parenting player DOM is what
breaks layouts, and players wipe children they do not own.

Two consequences worth remembering:

- a `position: fixed` element is not painted while another element is
  fullscreen, so the host is moved into `document.fullscreenElement` on
  `fullscreenchange` and back out on exit;
- the position is kept in sync by hand, and one measurement per event is not
  enough to do it.

Everything that can disturb the layout — scroll, resize, `visualViewport`
changes, a `ResizeObserver` on the video, a fullscreen transition, a speed
change — goes through `startBurst`, which measures immediately and then keeps
re-measuring on `requestAnimationFrame` for `REPOSITION_BURST_MS`. The burst is
what makes the badge land where a transition ends rather than where the video
was when the event fired: the page's own handlers run after the extension's, and
a player that slides a panel in reaches its final layout some frames later.

The burst only covers changes something announced. A site that reflows around a
panel it just opened moves the video sideways at an unchanged size, which fires
no resize, no scroll, and no `ResizeObserver` entry — the observer watches the
box's size, and a pure translation does not change it. So while the badge is on
screen it also re-measures every `IDLE_WATCH_MS`, and hands over to a burst when
it finds the video somewhere new. That watch stops as soon as the badge hides,
so a badge that has faded out costs nothing. `/shifting-panel` in
`e2e/fixtures/pages.ts` is that layout, and the e2e test against it waits out
the post-keystroke burst before opening the panel — otherwise the burst alone
would carry it and the test would prove nothing.

The label's opacity transition is dropped when `(prefers-reduced-motion:
reduce)` matches. The query is read each time the label is styled, which is
every time the badge is shown, so changing the system setting takes effect on
the next speed change without a listener the badge would have to tear down. The
popup honours the same preference in `src/popup/App.css`.

The primary video is the one with the largest visible area, with a playing video
scoring double: on a page full of preview players, the one making noise is the
one the user means.

## The speed on the toolbar icon

`src/background/action-badge.ts` owns every `chrome.action` call the extension
makes. The on-video badge answers "what is this video doing"; the action badge
answers "what is this tab at", without opening anything, and it is drawn both
where the icon is pinned and in the puzzle-piece overflow list.

It is two layers, and both are needed for every tab to carry a number:

- the **global** text, set from `defaultSpeed` at every service-worker start, is
  what a tab the extension has never heard from renders — a `chrome://` page,
  the Web Store, the PDF viewer, anywhere the content script cannot run;
- a **per-tab** override sits on top of it, written wherever the service worker
  resolves a speed. Those are the same four places that write `tabSpeeds`, plus
  the sub-frame branch of `rebobinate:query`.

Three things follow from how the browser stores that state:

- A per-tab override **outlives the service worker that wrote it**, while
  `tabSpeeds` does not. That is the right way round: the page is still playing
  at the speed the badge claims, and the next `rebobinate:query` re-asserts it
  anyway. It is also why switching the feature off walks every open tab through
  `chrome.tabs.query` rather than just clearing the global text — otherwise a
  number written by an earlier instance would sit there for the life of the tab.
- A tab that **navigates away is showing the previous page's number**, and the
  next page may be one the content script never runs on, so nothing would ever
  correct it. `chrome.tabs.onUpdated` puts the default back on `status:
'loading'`. `status` is delivered whatever the host access is, so this still
  works under "Site access: on click". The tab's _speed_ is deliberately not
  touched there — that is the new top frame's `rebobinate:query` to do, and
  clearing it here would race that.
- Nothing has to be undone when a tab closes: the browser drops a tab's action
  state with the tab.

`formatToolbarSpeed` in `src/shared/speed.ts` is a second formatter rather than
a reuse of `formatSpeedLabel` because roughly four characters fit on an icon
before the browser starts squeezing glyphs. It drops the `×` and, from 10×
upwards, the decimals; below that every value the settings allow already fits.
The full `Rebobinate — 1.05×` goes in the tooltip, which is what carries the
speed in the overflow list where the badge is smallest.

The colours are fixed in the module, not taken from `settings.badge`. Those are
chosen to read over a video frame, which is a different problem, and the badge's
opacity and corner have no meaning in browser chrome. White on `#111827` was
picked against the icon: it is a deep indigo square, so an indigo badge painted
over its corner disappears into it.

## Settings

`src/shared/settings.ts` is the single contract between popup, content script,
and service worker. Every read goes through `normalizeSettings`, which clamps
numbers, rejects unknown corners and non-colors, repairs partial objects, and
stamps `schemaVersion`. Storage can hold a half-written object from an
interrupted write or a shape from an older version, so the rest of the code only
ever sees a complete `Settings`.

Schema `2` added `defaultSpeed` and `rememberPerDomain`. It needed no migration
code: both are new keys, so a stored `1` object has them filled from the
defaults like any other missing field and nothing an installed copy holds is
reset. Schema `3` added `toolbarBadge` on the same terms.

`toolbarBadge` is a flat boolean and deliberately not a field of `badge`: that
object configures the badge drawn over the video down to its corner and
opacity, and none of it means anything on a toolbar icon. Two names that cannot
be confused are worth more than one grouping.

The remembered speeds live under a **second storage key**, in
`src/shared/domains.ts`, rather than inside `Settings`. The two are written by
different owners at very different rates — the popup rewrites the whole settings
object whenever a control moves, while the service worker writes a domain entry
a second after the last keystroke — and in one key those writes clobber each
other: the popup would save a settings object it read before the last speed
change. The same rule applies to both, though. Storage is untrusted input, and
every read of the domain map goes through `normalizeDomains`, which drops
entries that are neither a speed nor a marker, clamps the speeds, and trims the
map to its 500-entry cap by dropping the least recently updated. A map that only
ever grows is a slow leak on a profile that lives for years; a site whose speed
mattered gets visited again and re-remembered on the next keypress.

The domain map carries its own `schemaVersion`, now `2` for the `never` marker.
Like the settings `1` → `2` step it needed no migration code: an entry written
by version `1` has no `never` field, so it normalizes to `false` like any other
missing key and keeps the speed it already held.

Speed arithmetic lives in `src/shared/speed.ts`. Steps land on the multiple of
the step size in the direction of travel, so a site that left the video at 1.07
does not drag that stray 0.02 through every later press.

The step field in the popup — labelled **Speed step**, since the buttons and
keys it moves live on other tabs — is the one setting typed a character at a
time, and
its halfway states are not valid settings: going from `0.2` to `0.15` passes
through `''`, `'0'` and `'0.'`. Normalizing each keystroke back into the field
would rewrite it under the cursor and make those targets unreachable, so
`src/popup/SettingsPane.tsx` holds the raw text in a draft while the field is
being edited. A value that is already a valid step saves as it is typed;
anything else waits for blur, which clamps it through `clampStep` or, for an
empty field, restores the saved step.

## The popup

`src/popup/App.tsx` is a shell rather than a screen. It owns the state every
pane reads — settings, the tab's speed, the domain the tab counts as, the domain
map — and renders one of `SpeedPane`, `SitesPane` or `SettingsPane`. Only the
selected pane is mounted, so nothing off screen holds state or listens for keys.

Two things about it are load-bearing:

- **The first paint does not wait on storage.** Both reads answer on a callback,
  and a popup that gates its first render on them flashes an empty box every
  time it is opened. The defaults render immediately and the stored values
  arrive underneath.
- **The tab strip follows the ARIA tab pattern**, including the part that is
  easy to skip: only the selected tab is in the focus order and the arrow keys
  move between them. Without that a keyboard user tabs through every tab to
  reach the pane. The selected tab is not persisted — the popup opens on Speed.

The strip is data-driven (`TABS` in `App.tsx`), which is what makes the Stats
tab the metrics feature will need one entry rather than a rewrite. It is not
there yet because a tab that opens onto a placeholder is worse than one that is
not there.

The pane scrolls rather than the popup window, so the header and the strip stay
put on the long Settings pane. The popup is still fixed at 320px wide.

`src/popup/speeds.ts` holds the handful of speeds the popup offers directly:
`SPEEDS`, behind the Sites pane's selects and the default speed, and
`SPEED_PRESETS`, the chip row under the Speed pane's readout. The chips are a
shortcut past the step grid — at the default 0.05 step, 1.0× to 2.0× is twenty
presses — and they send the same `rebobinate:set` a frame does, so
`resolveSpeed` clamps them like anything else. With a non-default step a chip
can land off the grid; `stepSpeed` snaps back on the next press.

Three things about the panes follow from that width:

- **`Toggle` names itself only to a screen reader.** `src/popup/Toggle.tsx`
  puts its `label` prop on the checkbox's `aria-label` and renders a bare track,
  so every switch needs a visible caption of its own in the row around it —
  the `Enabled` span in the header, the label column of a `.field`. A switch added without one is a coloured track that
  says nothing.
- **The badge block pins its own header.** `.badge-settings` wraps everything
  the preview previews; `.badge-header` leads that block, holds the On-video
  badge switch and the `.preview` canvas, and is `position: sticky; top: 0` on
  an opaque `Canvas`. Scoping the containing block to the block is what makes it
  release at the end rather than covering the Backup section below; sticking it
  to the _top_ is what stops it covering Size, Opacity and the colour rows,
  since a top-stuck element only ever paints over what has already scrolled
  past it. The switch travels with the canvas rather than scrolling away,
  because a master switch off screen while its block is being edited leaves no
  way to turn the block off, and half of one under the pane's 18px scroll cue
  reads as a rendering fault. With the badge off, `.preview[hidden]` collapses
  the header to the switch alone.

  Its opaque `Canvas` has to reach past its own content. `.badge-settings`
  separates its children with `gap: 8px`, a flex gap belongs to no child and so
  paints nothing, and whatever was scrolling underneath showed through an 8px
  band right below the sample — the top of the corner grid, the Size slider's
  filled track, the middle of a sentence, all of which read as a rendering
  fault rather than as a scroll. `padding-bottom: 7px` plus a 1px hairline
  extends the background across the band and `margin-bottom: -8px` gives the
  space back, so nothing moves and the content passing under it stops at an
  edge instead of being cut.

- **Selected is a fill, focused is an outline.** `outline: 2px solid Highlight`
  used to mark the open Export panel, the chosen corner, the matching preset
  chip, the open swatch _and_ `:focus-visible`, so three different meanings were
  one ring and a focused selected control could not show both. Selection is now
  an accent border over `color-mix(in srgb, AccentColor 18%, Canvas)` and the
  outline belongs to the focus ring alone. The colour presets keep their own
  inline background, so on those it is the border that carries it — and the open
  swatch is the one place where a border could not: 44x24 of a user-chosen
  colour with a 1px accent edge was the entire signal that this row's panel was
  the one open, and the fill the rule set never rendered on it, because an
  inline `style` beats a stylesheet. `.swatch.active` is split out of that rule
  block for an offset `outline: 2px solid AccentColor`, a ring no inline
  background can paint over.
- **`.pane` carries a scroll cue at each edge** as a pair of gradients apiece —
  an opaque cover at `background-attachment: local` over a shadow at `scroll` —
  so a fading edge appears only while there is more pane past it, with no
  scroll listener. Each cover turns fully opaque a third of the way in rather
  than at its last pixel: two gradients ramping over the same rows do not
  cancel, and the leftover shadow shows as a grey band on every pane too short
  to scroll. Fractional layout leaves such a pane a pixel of scrollable
  overflow, which is also why each shadow fades back out before its edge
  instead of running into it.

The badge preview shows the styling and says the rest. It renders whenever the
on-video badge is on, which cannot be made to demonstrate `autoHideMs` or
`hideAtNormalSpeed`: a preview that vanishes two seconds after a slider moves is
not a preview, and honouring "show at 1.0×" would blank it for most users at
rest, since it previews the tab's current speed. So `visibilityNote` in
`SettingsPane.tsx` composes both settings into a sentence —
_"Shown for 2 seconds after a speed change, and hidden at 1.0×."_ — which
updates as the controls move.

**It is rendered last in the block**, under both controls it reads. Under the
sample it was the first thing to pass beneath the pinned header, so at any
scroll position that reached "Hide after" and "Show at 1.0×" the sentence
describing what they had just done was off screen — and feedback out of reach
at the moment it is needed cannot be told apart from no feedback at all. Last in
the block, the two settings and their result are on screen together.

That switch is asked as **"Show at 1.0×"** while the stored key stays
`hideAtNormalSpeed`. Every other switch on the pane means "more visible" when it
is on, and the block asked the user to change reading direction halfway down.
The inversion is in the `checked` and `onChange` props only; installed copies
hold the stored key and the content script reads it. "Hide after" is left alone,
because "Show for" would make its `Never` option read backwards.

One cascade trap lives with them: the badge rows and the preview are hidden with
the `hidden` attribute, whose UA rule loses to any author `display`. `.field`
and `.preview` both set `display: flex`, so `App.css` matches the attribute
explicitly (`.field[hidden]`) to put the author rule on the winning side.

## Rebinding a key

`src/popup/KeyEditor.tsx` captures a keystroke and writes it into
`settings.keys`, which the content script already follows live.

Which of `key` and `code` to store is decided by `bindingToken` in
`src/shared/keys.ts`. The numpad is stored as its `code` — its `key` is the same
`0` as the digit row's, so binding one would bind both — and everything else as
its `key`, which is the character on the cap the user pressed. Storing
`Semicolon` would bind whatever that physical key types on another layout, which
is not what somebody who pressed `;` asked for.

`captureBinding` decides what a press means, and its rules follow
`resolveAction`: a keystroke the matcher would never accept must not be offered
as a binding. A modifier held alone leaves the capture open, `Escape` cancels,
`Tab` is refused because it is how a keyboard user leaves the row, and a
modified keystroke is refused because the content script deliberately hands
those to the browser — binding one would produce a key that silently never
fires. A key already bound to another action is refused too, since the content
script resolves the actions in a fixed order and a duplicate would silently
belong to whichever is checked first.

The defaults hold both forms of the same key (`=` and `Equal`), so the editor
groups the chips by `formatBinding` label and removes a whole group at once. The
last chip of an action cannot be removed: `normalizeSettings` reads an empty
binding list as a missing one and fills it from the defaults, so the key would
come straight back.

## The badge colours

`src/popup/ColorPicker.tsx` is a colour picker written out by hand — preset
swatches, hue/saturation/lightness sliders, and a hex field — because
`<input type="color">` cannot be used in the popup at all. On Firefox the native
chooser is a separate toplevel window whose focus closes the popup, so the
choice is dropped before it can be saved; see
[Build Targets](./build-targets.md#no-native-pickers-in-the-popup) for the trace
and the upstream bugs.

The conversions live in `src/shared/color.ts` for the same reason the speed
arithmetic does — they are load-bearing and testable without a DOM. `toHex` also
reads the `rgb()` and `rgba()` forms, because `normalizeSettings` still accepts
them and a value written before this picker existed need not be hex.

One detail is not obvious from the component: the picker holds its HSL in state
rather than deriving it from the stored hex on every render. Whole degrees and
percents cannot round-trip through eight bits per channel, so re-deriving would
make a dragged slider drift under the cursor. It re-seeds when the hex changes
from anywhere other than the sliders themselves.

The hex field repeats the step field's draft pattern above: `#ff88` is not a
colour, so the raw text is held while it is typed, a complete six-digit value
saves as it is typed, and blur expands a three-digit one.

`SettingsPane` renders both swatch rows and then one picker beneath the pair,
not one under whichever row is open. A badge's legibility is the contrast
between its text and its background, so both swatches have to stay on screen
while either is being picked. The `key={openColor}` on that single element keeps
what the per-row mount was buying: React remounts the panel when the open field
changes, so a half-typed hex cannot travel from one colour to the other.

Because the panel's position cannot say which row it edits, **it captions
itself**: `label` is rendered at the top of `.color-picker` as well as going
into the group's `aria-label`, so the answer is on screen and not only in the
accessibility tree. That plus the open swatch's accent ring and `aria-expanded`
is what carries ownership.

## Backup and restore

`src/shared/backup.ts` turns both stores into one JSON document and back.
`src/popup/Backup.tsx` is the panel at the bottom of the Settings pane: **Export**
shows the document in a read-only textarea with a Copy button, **Import** takes a
pasted one and replaces what is stored. The two are one two-way switch over a
single slot rather than two actions, so they are drawn as one joined segmented
pair with the open half filled — they stay `<button>`s carrying `aria-expanded`,
because opening and closing a region is what they do. The switch arrives on
**Export**, so the pair reads as a switch with a side chosen rather than as two
untouched buttons at the bottom of a long scroll; Export is the safe half to
land on, being read-only and the one needed first, and nothing sits below Backup
for its panel to push down. Pressing the open half still closes it. The button that overwrites
both stores is disabled until `parseBackup` accepts what is in the box — it is
parsed as the box changes and `restore` reads that same result rather than
parsing twice — and the note under it either says why the button is dead or
counts what pressing it would replace. Both branches stay one statement about
the loss — _"Replaces your settings. You have no remembered sites to lose."_ on
a profile with nothing stored, rather than counting zero sites or reporting the
profile's present state alongside the warning. There is no confirmation step by design: on
Gecko the popup autohides on focus loss, so an extra step is another way to lose
the paste.

It is text in a textarea on both engines because of the same Gecko constraint
the colour picker works around: an `<input type="file">` opens a native chooser,
whose focus closes the XUL panel the popup is, so the file would be picked into
a document that no longer exists. See
[Build Targets](./build-targets.md#no-native-pickers-in-the-popup). Once import
has to be a paste, export being a copy keeps the pair symmetrical — and neither
half needs a permission the extension does not already hold.

The document is wrapped in a `{ format: 'rebobinate-backup', version }`
envelope, and that envelope is the safety property rather than decoration.
`normalizeSettings` turns _anything_ into a complete `Settings`, so pointing it
straight at pasted text would make `{}` a successful restore that silently
replaces everything with the defaults. `parseBackup` refuses text without the
marker, refuses an envelope whose `version` is newer than this build understands
— that one could carry a settings shape this version would normalize away — and
otherwise runs both normalizers over what it found. It restores only the keys
the document actually carries, so a hand-written settings-only backup does not
wipe the site list to make its point.

The two halves are then written by their usual owners: the popup saves the
settings object itself, and the domain map goes to the service worker as
`rebobinate:import-domains`. That is not ceremony — a debounced per-domain write
may still be pending, and only the service worker can cancel it. It cancels
_every_ pending write, not one domain's, since a restore replaces the whole map.
Nothing is applied to the tab in front of the user: a restored map is a
statement about the next visit to each site.
