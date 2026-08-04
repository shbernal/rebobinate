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
tab's speed and frame bookkeeping are cleared. Sub-frames use the same query to
inherit a speed that was set before they existed.

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
- the position is kept in sync by hand — on scroll, resize, a `ResizeObserver`
  on the video, and a short `requestAnimationFrame` burst after each change,
  because players move the video box when their controls appear.

The label's opacity transition is dropped when `(prefers-reduced-motion:
reduce)` matches. The query is read each time the label is styled, which is
every time the badge is shown, so changing the system setting takes effect on
the next speed change without a listener the badge would have to tear down. The
popup honours the same preference in `src/popup/App.css`.

The primary video is the one with the largest visible area, with a playing video
scoring double: on a page full of preview players, the one making noise is the
one the user means.

## Settings

`src/shared/settings.ts` is the single contract between popup, content script,
and service worker. Every read goes through `normalizeSettings`, which clamps
numbers, rejects unknown corners and non-colors, repairs partial objects, and
stamps `schemaVersion`. Storage can hold a half-written object from an
interrupted write or a shape from an older version, so the rest of the code only
ever sees a complete `Settings`.

Speed arithmetic lives in `src/shared/speed.ts`. Steps land on the multiple of
the step size in the direction of travel, so a site that left the video at 1.07
does not drag that stray 0.02 through every later press.

The step field in the popup is the one setting typed a character at a time, and
its halfway states are not valid settings: going from `0.2` to `0.15` passes
through `''`, `'0'` and `'0.'`. Normalizing each keystroke back into the field
would rewrite it under the cursor and make those targets unreachable, so
`src/popup/App.tsx` holds the raw text in a draft while the field is being
edited. A value that is already a valid step saves as it is typed; anything else
waits for blur, which clamps it through `clampStep` or, for an empty field,
restores the saved step.

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
