export interface CardFrame {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function validCardFrame(frame: CardFrame): boolean {
  return (
    [frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) &&
    frame.width > 0 &&
    frame.height > 0
  );
}
export function spatialCardMotion(
  frame: CardFrame,
  reduceMotion: boolean,
  fontScale: number,
): boolean {
  return validCardFrame(frame) && !reduceMotion && fontScale <= 1.25;
}
export function reverseDuration(progress: number, spatial: boolean): number {
  const fraction = Number.isFinite(progress)
    ? Math.min(1, Math.max(0, progress))
    : 0;
  return Math.max(60, Math.round((spatial ? 260 : 140) * fraction));
}

/** Reverse only when every edge of the current hero remains visible and stable. */
export function canReverseCard(
  frame: CardFrame | null,
  viewport: CardFrame,
  keyboardVisible: boolean,
): boolean {
  if (
    keyboardVisible ||
    !frame ||
    !validCardFrame(frame) ||
    !validCardFrame(viewport)
  )
    return false;
  const tolerance = 1;
  return (
    frame.x >= viewport.x - tolerance &&
    frame.y >= viewport.y - tolerance &&
    frame.x + frame.width <= viewport.x + viewport.width + tolerance &&
    frame.y + frame.height <= viewport.y + viewport.height + tolerance
  );
}
