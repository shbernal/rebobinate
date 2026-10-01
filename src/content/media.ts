/**
 * Finds and keeps track of every `<video>` in the frame.
 *
 * Three discovery paths, because no single one is enough on real sites:
 *
 * 1. an initial sweep, for videos already in the document;
 * 2. a `MutationObserver`, for videos added later (SPA navigation, lazy
 *    players, TikTok recycling its element per swipe);
 * 3. capture-phase media events on the document, which catch videos that were
 *    never in a mutation we observed — cheap, and it is how a video buried in
 *    an unexpected place announces itself.
 *
 * Open shadow roots are traversed explicitly. Patching `attachShadow` (what
 * some speed extensions do) is not an option here: a content script runs in an
 * isolated world, so its `Element.prototype` is not the page's. Closed shadow
 * roots are therefore out of reach — an accepted gap.
 */

const MEDIA_EVENTS = [
  'loadstart',
  'loadedmetadata',
  'canplay',
  'play',
  'playing',
  'ratechange',
] as const

/**
 * Walking elements looking for shadow hosts is the expensive part of discovery,
 * so it is batched instead of running on each mutation. Pages like YouTube
 * produce hundreds of mutations a second. A batch walks only the subtrees its
 * mutations added.
 */
const DEEP_SCAN_DEBOUNCE_MS = 250

/**
 * The backstop: how often, at most, a mutating page gets a walk of the whole
 * frame. It catches a shadow root attached to an element that was already in
 * the page, which no mutation of the light DOM reports. An idle page gets
 * none.
 */
const FULL_SCAN_INTERVAL_MS = 5000

type MediaEventName = (typeof MEDIA_EVENTS)[number]

export type MediaRegistryOptions = {
  document: Document
  onAdd: (video: HTMLVideoElement) => void
  onMediaEvent: (video: HTMLVideoElement, eventName: MediaEventName) => void
}

export type MediaRegistry = {
  start: () => void
  stop: () => void
  videos: () => HTMLVideoElement[]
  primary: () => HTMLVideoElement | null
}

const isVideo = (node: unknown): node is HTMLVideoElement => {
  return (
    typeof HTMLVideoElement !== 'undefined' && node instanceof HTMLVideoElement
  )
}

const visibleArea = (video: HTMLVideoElement): number => {
  const rect = video.getBoundingClientRect()

  if (rect.width <= 0 || rect.height <= 0) {
    return 0
  }

  const viewportWidth = window.innerWidth || rect.width
  const viewportHeight = window.innerHeight || rect.height
  const width = Math.max(
    0,
    Math.min(rect.right, viewportWidth) - Math.max(rect.left, 0),
  )
  const height = Math.max(
    0,
    Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, 0),
  )

  return width * height
}

export const createMediaRegistry = ({
  document: doc,
  onAdd,
  onMediaEvent,
}: MediaRegistryOptions): MediaRegistry => {
  const known = new Set<HTMLVideoElement>()
  // A `MutationObserver` holds what it observes strongly, so a weak set here
  // would not let a detached root go. `pruneRoots` is what does.
  const observedRoots = new Set<Node>()
  const pendingScans = new Set<Node>()
  let observer: MutationObserver | null = null
  let deepScanTimer: ReturnType<typeof setTimeout> | null = null
  let lastFullScan = 0
  let running = false

  const register = (video: HTMLVideoElement) => {
    if (known.has(video)) {
      return
    }

    known.add(video)
    onAdd(video)
  }

  const observeRoot = (root: Node) => {
    if (!observer || observedRoots.has(root)) {
      return
    }

    observedRoots.add(root)
    observer.observe(root, { childList: true, subtree: true })
  }

  /** Cheap pass: the node itself plus any `<video>` in its light DOM. */
  const collectVideos = (node: Node) => {
    if (isVideo(node)) {
      register(node)
      return
    }

    const scope = node as Element | Document | DocumentFragment

    if (typeof scope.querySelectorAll !== 'function') {
      return
    }

    scope.querySelectorAll('video').forEach(register)
  }

  const enterShadow = (element: Element) => {
    const shadowRoot = element.shadowRoot

    if (!shadowRoot) {
      return
    }

    observeRoot(shadowRoot)
    deepScan(shadowRoot)
  }

  /** Expensive pass: descend into every open shadow root under `root`. */
  const deepScan = (root: Node = doc) => {
    collectVideos(root)

    const scope = root as Element | Document | DocumentFragment

    if (typeof scope.querySelectorAll !== 'function') {
      return
    }

    if ('shadowRoot' in scope) {
      enterShadow(scope)
    }

    scope.querySelectorAll('*').forEach(enterShadow)
  }

  /**
   * Re-observes only the roots still on the page. `MutationObserver` has no
   * per-node unobserve, so this is a disconnect and a fresh start. A host that
   * comes back is an added node, and its root is picked up again from there.
   */
  const pruneRoots = () => {
    const detached = Array.from(observedRoots).filter(
      root => root !== doc && !(root as ShadowRoot).host?.isConnected,
    )

    if (!observer || detached.length === 0) {
      return
    }

    handleMutations(observer.takeRecords())
    observer.disconnect()

    const kept = Array.from(observedRoots).filter(
      root => !detached.includes(root),
    )
    observedRoots.clear()
    kept.forEach(observeRoot)
  }

  const fullScan = () => {
    lastFullScan = Date.now()
    pendingScans.clear()
    pruneRoots()
    deepScan()
  }

  const flushScans = () => {
    deepScanTimer = null

    if (!running) {
      return
    }

    if (Date.now() - lastFullScan >= FULL_SCAN_INTERVAL_MS) {
      fullScan()
      return
    }

    const roots = Array.from(pendingScans)
    pendingScans.clear()
    roots.filter(root => root.isConnected).forEach(root => deepScan(root))
  }

  const scheduleDeepScan = () => {
    if (deepScanTimer === null) {
      deepScanTimer = setTimeout(flushScans, DEEP_SCAN_DEBOUNCE_MS)
    }
  }

  function handleMutations(mutations: MutationRecord[]) {
    mutations.forEach(mutation => {
      mutation.addedNodes.forEach(node => {
        collectVideos(node)

        if (node.nodeType === Node.ELEMENT_NODE) {
          pendingScans.add(node)
        }
      })
    })

    if (mutations.length > 0) {
      scheduleDeepScan()
    }
  }

  const handleMediaEvent = (event: Event) => {
    const target = event.target

    if (!isVideo(target)) {
      return
    }

    register(target)
    onMediaEvent(target, event.type as MediaEventName)
  }

  const rescan = () => {
    fullScan()
  }

  const start = () => {
    if (running) {
      return
    }

    running = true
    observer = new MutationObserver(handleMutations)
    observeRoot(doc)

    MEDIA_EVENTS.forEach(eventName => {
      // Media events do not bubble, but capture-phase listeners on the document
      // still see them on their way down to the element.
      doc.addEventListener(eventName, handleMediaEvent, { capture: true })
    })

    rescan()

    // At `document_start` the body does not exist yet.
    if (doc.readyState === 'loading') {
      doc.addEventListener('DOMContentLoaded', rescan, { once: true })
    }
  }

  const stop = () => {
    if (!running) {
      return
    }

    running = false
    observer?.disconnect()
    observer = null
    observedRoots.clear()
    pendingScans.clear()
    // Still armed if this runs before the document finished parsing, which is
    // exactly when an extension reload can land.
    doc.removeEventListener('DOMContentLoaded', rescan)

    if (deepScanTimer !== null) {
      clearTimeout(deepScanTimer)
      deepScanTimer = null
    }

    MEDIA_EVENTS.forEach(eventName => {
      doc.removeEventListener(eventName, handleMediaEvent, { capture: true })
    })

    known.clear()
  }

  const videos = () => {
    // Detached elements are dropped lazily. Sites that recycle a player would
    // otherwise leave us holding nodes that are no longer on the page.
    known.forEach(video => {
      if (!video.isConnected) {
        known.delete(video)
      }
    })

    return Array.from(known)
  }

  const primary = () => {
    const candidates = videos()

    if (candidates.length === 0) {
      return null
    }

    let best = candidates[0]
    let bestScore = -1

    for (const video of candidates) {
      // A playing video wins over a bigger paused one: on a page full of
      // preview players, the one making noise is the one the user means.
      const score = visibleArea(video) * (video.paused ? 1 : 2)

      if (score > bestScore) {
        bestScore = score
        best = video
      }
    }

    return best
  }

  return { start, stop, videos, primary }
}
