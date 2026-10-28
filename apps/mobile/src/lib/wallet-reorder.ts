// Reorder movement is separate from the card-selection spring.
export const reorderSpring = { damping: 32, stiffness: 300, mass: 0.9 };
export const liftSpring = { damping: 24, stiffness: 320, mass: 0.7 };

/** A small dead band keeps tiny finger reversals from swapping neighbors twice. */
export function reorderIndex(
  y: number,
  index: number,
  count: number,
  stride: number,
) {
  "worklet";
  if (count < 1 || stride <= 0) return 0;
  const margin = Math.min(10, stride * 0.1);
  let next = Math.max(0, Math.min(count - 1, index));
  while (next < count - 1 && y > (next + 0.5) * stride + margin) next++;
  while (next > 0 && y < (next - 0.5) * stride - margin) next--;
  return next;
}

/** Points per second, easing into edge scrolling instead of stepping by frames. */
export function reorderScrollSpeed(finger: number, top: number, bottom: number) {
  "worklet";
  const edge = 70;
  if (finger < top + edge) {
    const depth = Math.min(1, Math.max(0, (top + edge - finger) / edge));
    return -480 * depth * depth;
  }
  if (finger > bottom - edge) {
    const depth = Math.min(1, Math.max(0, (finger - (bottom - edge)) / edge));
    return 480 * depth * depth;
  }
  return 0;
}
