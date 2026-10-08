import { expect, it } from 'vitest';
import { movedAwayFromLatest } from '../web/scroll-follow.js';

it.each([
  ['initial rendering', 0, 0, 1000, false],
  ['new content below a followed position', 300, 300, 1000, false],
  ['reader moves upward before a scroll event', 500, 100, 1000, true],
  ['content shrinks and the browser clamps the position', 500, 200, 200, false],
  ['viewport grows but the reader remains near the bottom', 500, 150, 200, false],
  ['reader remains within the follow margin', 1000, 921, 1000, false],
  ['reader leaves the follow margin', 1000, 920, 1000, true],
] as const)('%s', (_name, previous, scrollTop, maximum, expected) => {
  expect(movedAwayFromLatest({ scrollTop, scrollHeight: maximum + 600, clientHeight: 600 }, previous)).toBe(expected);
});
