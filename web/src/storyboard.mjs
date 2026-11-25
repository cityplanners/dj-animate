export const STORYBOARD_SLOTS = 4;
export const defaultStoryboard = () => ({
  loop: true,
  frames: Array.from({ length: STORYBOARD_SLOTS }, () => ({ transition: 0, hold: 1 })),
});

export function storyboardTiming(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1800) throw new Error('Enter a time from 0 to 1800 seconds.');
  return Math.round(value * 1000) / 1000;
}

export function formatStoryboard(frames) {
  return frames.map(({ transition, hold }) => `(${transition}) ${hold}`).join(' | ');
}

export function parseStoryboard(text) {
  const pairs = text.trim().split(/\s*\|\s*/);
  if (pairs.length !== STORYBOARD_SLOTS) throw new Error('Enter four (transition) hold pairs separated by |.');
  return pairs.map(pair => {
    const match = /^\(\s*(\d+(?:\.\d+)?|\.\d+)\s*\)\s*(\d+(?:\.\d+)?|\.\d+)$/.exec(pair.trim());
    if (!match) throw new Error('Use (transition) hold in seconds, for example (0.5) 2.');
    return { transition: storyboardTiming(Number(match[1])), hold: storyboardTiming(Number(match[2])) };
  });
}

export function storyboardDuration(frames) {
  return frames.reduce((sum, frame) => sum + frame.transition + frame.hold, 0);
}

// The clock supplies absolute source time, including when scrubbing and exporting.
export function storyboardAt(frames, time) {
  let elapsed = Math.round(time * 1e6) / 1e6;
  let previous;
  for (const frame of frames) {
    if (elapsed < frame.transition) {
      const x = elapsed / frame.transition;
      return { previous, current: frame.image, mix: x * x * (3 - 2 * x) };
    }
    elapsed = Math.round((elapsed - frame.transition) * 1e6) / 1e6;
    if (elapsed < frame.hold) return { current: frame.image, mix: 1 };
    elapsed = Math.round((elapsed - frame.hold) * 1e6) / 1e6;
    if (frame.transition || frame.hold) previous = frame.image;
  }
  return null;
}
