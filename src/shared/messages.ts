import type { DomainStore } from './domains'
import type { SpeedAction } from './keys'

/**
 * A keystroke only reaches the frame that has focus, but the video is often in
 * another one — a YouTube embed inside a blog, a player iframe on a news site.
 * Every frame therefore forwards intents to the background, which owns the
 * tab-wide speed and broadcasts it back to all frames.
 */
export type SpeedIntentMessage = {
  type: 'rebobinate:intent'
  action: SpeedAction
  /**
   * The sender's current speed. The service worker can be evicted between
   * keystrokes, and this lets it resume from the truth on the page instead of
   * snapping back to 1.0.
   */
  currentSpeed: number
}

export type SetSpeedMessage = {
  type: 'rebobinate:set'
  speed: number
}

/** Sent by a frame on load to pick up a speed set before it existed. */
export type SpeedQueryMessage = {
  type: 'rebobinate:query'
}

/**
 * A frame reporting whether it currently holds a video.
 *
 * The tab-wide answer is what decides whether a keystroke belongs to the
 * extension: on a page whose only player is in an iframe, the focused frame has
 * no video of its own but the keystroke is still meant for us.
 */
export type MediaPresenceMessage = {
  type: 'rebobinate:media'
  hasVideo: boolean
}

/** Broadcast to every frame when the tab gains or loses its last video. */
export type TabMediaMessage = {
  type: 'rebobinate:tab-media'
  hasVideo: boolean
}

/** Broadcast to every frame of a tab after the speed changes. */
export type SpeedStateMessage = {
  type: 'rebobinate:state'
  speed: number
}

/** Popup asks for the active tab's speed and which domain it counts as. */
export type PopupStateMessage = {
  type: 'rebobinate:popup-state'
}

/**
 * Popup asks the service worker to drop a remembered speed.
 *
 * It goes through the service worker rather than writing storage from the popup
 * because a speed change on that domain may still be sitting in the debounce,
 * and only the service worker can cancel it. Forgetting from the popup while a
 * write was pending would otherwise re-add the entry a second later.
 */
export type ForgetDomainMessage = {
  type: 'rebobinate:forget-domain'
  domain: string
}

/**
 * Popup edits the speed remembered for a domain from the Sites list.
 *
 * It goes through the service worker for the reason above, and because the
 * domain may be the one in front of the user: editing the speed of the site
 * being watched applies to it now, not on the next visit.
 */
export type SetDomainSpeedMessage = {
  type: 'rebobinate:set-domain-speed'
  domain: string
  speed: number
}

/** Popup switches a site out of the per-site memory, or back into it. */
export type SetDomainNeverMessage = {
  type: 'rebobinate:set-domain-never'
  domain: string
  never: boolean
}

/**
 * Popup restores a whole site list from a backup.
 *
 * It replaces the map rather than merging into it — a restore says "this is
 * what the memory is now" — and it goes through the service worker for the
 * reason a single edit does, several times over: any debounced write still
 * pending would land on top of the restored map a second later.
 */
export type ImportDomainsMessage = {
  type: 'rebobinate:import-domains'
  store: DomainStore
}

export type RuntimeMessage =
  | SpeedIntentMessage
  | SetSpeedMessage
  | SpeedQueryMessage
  | SpeedStateMessage
  | PopupStateMessage
  | ForgetDomainMessage
  | SetDomainSpeedMessage
  | SetDomainNeverMessage
  | ImportDomainsMessage
  | MediaPresenceMessage
  | TabMediaMessage

export type SpeedResponse = {
  speed: number
  hasVideo?: boolean
  /**
   * The registrable domain the active tab counts as, or `null` when the page is
   * not one a speed can be remembered against. Only sent to the popup.
   */
  domain?: string | null
}

export const isRuntimeMessage = (value: unknown): value is RuntimeMessage => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type.startsWith('rebobinate:')
  )
}
