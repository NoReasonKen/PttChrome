import { ArticleHorizontalGesture } from '../../src/js/article_horizontal_gesture';

const start = (opened = false) => new ArticleHorizontalGesture({ width: 400, opened, x: 350, y: 200, t: 0 });
const confirmedDrag = (opened = false) => {
  const gesture = new ArticleHorizontalGesture({ width: 400, opened, x: opened ? 334 : 366, y: 200, t: 0 });
  gesture.move(350, 200, 1);
  return gesture;
};

describe('article horizontal gesture release', () => {
  it('reserves 80-degree horizontal sectors and gives the remaining diagonals to scrolling', () => {
    for (const sx of [-1, 1]) {
      for (const sy of [-1, 1]) {
        for (const [dy, axis] of [[70, 'horizontal'], [83, 'horizontal'], [84, 'vertical'], [100, 'vertical']]) {
          const gesture = new ArticleHorizontalGesture({ width: 400, opened: false, allowExit: true, x: 0, y: 0, t: 0 });
          expect(gesture.move(sx * 100, sy * dy, 20).axis).toBe(axis);
          if (axis === 'vertical') {
            expect(gesture.move(sx * 250, 0, 40).operation).toBe(null);
            expect(gesture.release(40)).toEqual({ opened: false, exit: false });
          }
        }
      }
    }
  });

  it('gives the exact 40-degree boundary to vertical scrolling, including an open drawer', () => {
    for (const opened of [false, true]) {
      const gesture = new ArticleHorizontalGesture({ width: 400, opened, allowExit: true, x: 0, y: 0, t: 0 });
      expect(gesture.move(100, 100 * Math.tan(40 * Math.PI / 180), 20)).toMatchObject({ axis: 'vertical', operation: null });
      expect(gesture.release(20)).toEqual({ opened, exit: false });
    }
  });

  it('requires strictly more than half the viewport to open', () => {
    for (const [distance, expected] of [[199, false], [200, false], [201, true]]) {
      const gesture = confirmedDrag();
      gesture.move(350 - distance, 200, 50);
      expect(gesture.release(700).opened).toBe(expected);
    }
  });

  it('requires strictly more than half the open panel to close', () => {
    for (const [distance, expected] of [[149, true], [150, true], [151, false]]) {
      const gesture = confirmedDrag(true);
      gesture.move(350 + distance, 200, 50);
      expect(gesture.release(700).opened).toBe(expected);
    }
  });

  it('uses a recent fling and forgets an early fast segment after a pause', () => {
    const gesture = confirmedDrag();
    gesture.move(300, 200, 20);
    expect(gesture.release(20).opened).toBe(true);
    expect(gesture.release(200).opened).toBe(false);
  });

  it('includes stationary release time in the recent velocity', () => {
    const gesture = confirmedDrag();
    gesture.move(310, 200, 20);
    expect(gesture.release(90).opened).toBe(false);
  });

  it('uses the final reversal instead of the first fast segment', () => {
    const gesture = confirmedDrag();
    gesture.move(100, 200, 50);
    gesture.move(80, 200, 150);
    gesture.move(150, 200, 170);
    expect(gesture.release(170).opened).toBe(false);
  });

  it('keeps diagonal ties and established vertical scrolling out of the drawer', () => {
    const gesture = start();
    expect(gesture.move(330, 220, 20).axis).toBe('vertical');
    expect(gesture.move(20, 220, 40).operation).toBe(null);
    expect(gesture.release(40).opened).toBe(false);
  });

  it('keeps stationary contacts undecided and preserves long press ownership', () => {
    const gesture = start();
    expect(gesture.move(350, 200, 10).axis).toBe(null);
    expect(gesture.move(50, 200, 500).operation).toBe(null);
  });

  it('waits for 16px of travel, then follows from the confirmation point without a jump', () => {
    const gesture = start();
    for (const distance of [1, 4, 12, 15.99]) {
      expect(gesture.move(350 - distance, 200, 10)).toMatchObject({ axis: null, operation: null, distance: 0, reveal: 0 });
    }
    expect(gesture.move(334, 200, 20)).toMatchObject({ axis: 'horizontal', operation: 'open', distance: 0, reveal: 0 });
    expect(gesture.move(333, 200, 30).reveal).toBe(1);
    expect(gesture.move(330, 200, 40).reveal).toBe(4);
  });

  it('measures the confirmation distance radially in both axes', () => {
    const gesture = start();
    expect(gesture.move(362, 210, 10).axis).toBe(null);
    expect(gesture.move(362, 212, 20)).toMatchObject({ axis: 'vertical', operation: null });
  });

  it('lets a shallow touch-down drift turn into vertical scrolling before direction confirmation', () => {
    const gesture = start();
    expect(gesture.move(348.6, 199.8, 20).axis).toBe(null);
    expect(gesture.move(340, 192, 40).axis).toBe(null);
    expect(gesture.move(337.4, 187.9, 60)).toMatchObject({ axis: 'vertical', operation: null });
    expect(gesture.move(223.5, 78.3, 200).operation).toBe(null);
    expect(gesture.release(300)).toEqual({ opened: false, exit: false });
  });

  it('preserves taps, cancellation and an open drawer inside the confirmation distance', () => {
    for (const opened of [false, true]) {
      const gesture = start(opened);
      expect(gesture.move(360, 205, 20).axis).toBe(null);
      expect(gesture.release(30)).toEqual({ opened, exit: false });
      expect(gesture.release(30, true)).toEqual({ opened, exit: false });
    }
  });

  it('restores the initial state on cancellation and cannot chain close into exit', () => {
    const gesture = start(true);
    gesture.move(750, 200, 50);
    expect(gesture.release(50, true)).toEqual({ opened: true, exit: false });
    expect(gesture.release(50)).toEqual({ opened: false, exit: false });
  });

  it('uses net displacement with one-to-one progress even after reversal', () => {
    const gesture = confirmedDrag();
    expect(gesture.move(100, 200, 20).reveal).toBe(250);
    expect(gesture.move(300, 200, 150).reveal).toBe(50);
    expect(gesture.release(350).opened).toBe(false);
  });

  it('requires strictly more than half the viewport to retract an article', () => {
    for (const [distance, expected] of [[199, false], [200, false], [201, true]]) {
      const gesture = new ArticleHorizontalGesture({ width: 400, opened: false, allowExit: true, x: 20, y: 200, t: 0 });
      gesture.move(36, 200, 1);
      expect(gesture.move(36 + distance, 200, 50).distance).toBe(distance);
      expect(gesture.release(700)).toEqual({ opened: false, exit: expected });
    }
  });

  it('uses final article-exit velocity and restores on reversal or interruption', () => {
    const gesture = new ArticleHorizontalGesture({ width: 400, opened: false, allowExit: true, x: 20, y: 200, t: 0 });
    gesture.move(70, 200, 20);
    expect(gesture.release(20).exit).toBe(true);
    expect(gesture.release(200).exit).toBe(false);
    gesture.move(300, 200, 300);
    gesture.move(240, 200, 320);
    expect(gesture.release(320).exit).toBe(false);
    expect(gesture.release(700, true)).toEqual({ opened: false, exit: false });
  });

  it('owns a left swipe without a drawer, opening nothing, and still retracts on a right swipe', () => {
    const left = new ArticleHorizontalGesture({ width: 400, opened: false, allowExit: true, allowOpen: false, x: 350, y: 200, t: 0 });
    expect(left.move(100, 200, 50)).toMatchObject({ axis: 'horizontal', operation: null, reveal: 0 });
    expect(left.release(50)).toEqual({ opened: false, exit: false });
    const right = new ArticleHorizontalGesture({ width: 400, opened: false, allowExit: true, allowOpen: false, x: 20, y: 200, t: 0 });
    right.move(36, 200, 1);
    expect(right.move(250, 200, 50).operation).toBe('exit');
    expect(right.release(700)).toEqual({ opened: false, exit: true });
  });
});
