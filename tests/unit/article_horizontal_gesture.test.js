import { ArticleHorizontalGesture } from '../../src/js/article_horizontal_gesture';

const start = (opened = false) => new ArticleHorizontalGesture({ width: 400, opened, x: 350, y: 200, t: 0 });

describe('article horizontal gesture release', () => {
  it('requires strictly more than half the viewport to open', () => {
    for (const [distance, expected] of [[199, false], [200, false], [201, true]]) {
      const gesture = start();
      gesture.move(350 - distance, 200, 50);
      expect(gesture.release(700).opened).toBe(expected);
    }
  });

  it('requires strictly more than half the open panel to close', () => {
    for (const [distance, expected] of [[149, true], [150, true], [151, false]]) {
      const gesture = start(true);
      gesture.move(350 + distance, 200, 50);
      expect(gesture.release(700).opened).toBe(expected);
    }
  });

  it('uses a recent fling and forgets an early fast segment after a pause', () => {
    const gesture = start();
    gesture.move(300, 200, 20);
    expect(gesture.release(20).opened).toBe(true);
    expect(gesture.release(200).opened).toBe(false);
  });

  it('includes stationary release time in the recent velocity', () => {
    const gesture = start();
    gesture.move(310, 200, 20);
    expect(gesture.release(90).opened).toBe(false);
  });

  it('uses the final reversal instead of the first fast segment', () => {
    const gesture = start();
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

  it('preserves long press ownership and ignores contact jitter', () => {
    const gesture = start();
    expect(gesture.move(345, 200, 10).operation).toBe(null);
    expect(gesture.move(50, 200, 500).operation).toBe(null);
  });

  it('restores the initial state on cancellation and cannot chain close into exit', () => {
    const gesture = start(true);
    gesture.move(750, 200, 50);
    expect(gesture.release(50, true)).toEqual({ opened: true, exit: false });
    expect(gesture.release(50)).toEqual({ opened: false, exit: false });
  });

  it('uses net displacement with one-to-one progress even after reversal', () => {
    const gesture = start();
    expect(gesture.move(100, 200, 20).reveal).toBe(250);
    expect(gesture.move(300, 200, 150).reveal).toBe(50);
    expect(gesture.release(350).opened).toBe(false);
  });

  it('requires strictly more than half the viewport to retract an article', () => {
    for (const [distance, expected] of [[199, false], [200, false], [201, true]]) {
      const gesture = new ArticleHorizontalGesture({ width: 400, opened: false, allowExit: true, x: 20, y: 200, t: 0 });
      expect(gesture.move(20 + distance, 200, 50).distance).toBe(distance);
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
    expect(right.move(250, 200, 50).operation).toBe('exit');
    expect(right.release(700)).toEqual({ opened: false, exit: true });
  });
});
