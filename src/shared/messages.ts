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

/** Popup asks for the active tab's speed. */
export type PopupStateMessage = {
  type: 'rebobinate:popup-state'
}

export type RuntimeMessage =
  | SpeedIntentMessage
  | SetSpeedMessage
  | SpeedQueryMessage
  | SpeedStateMessage
  | PopupStateMessage
  | MediaPresenceMessage
  | TabMediaMessage

export type SpeedResponse = {
  speed: number
  hasVideo?: boolean
}

export const isRuntimeMessage = (value: unknown): value is RuntimeMessage => {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (value as { type: string }).type.startsWith('rebobinate:')
  )
}
