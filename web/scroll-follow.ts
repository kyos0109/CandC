/** Distinguish an upward reading move from growth or browser position clamping. */
export function movedAwayFromLatest(viewport: { scrollTop: number; scrollHeight: number; clientHeight: number }, followedPosition: number) {
  const maximum = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
  return maximum - viewport.scrollTop >= 80 && viewport.scrollTop + 1 < Math.min(followedPosition, maximum);
}
