// Gesture constants are initial calibration values, pending Android feedback.
export const ARTICLE_GESTURE_SLOP = 10;
export const ARTICLE_FLING_WINDOW_MS = 100;
export const ARTICLE_FLING_SPEED = 0.65;
export const ARTICLE_LONG_PRESS_MS = 450;
export const ARTICLE_SETTLE_MS = 180;

export class ArticleHorizontalGesture {
  // `allowOpen` is false where there is no drawer: a left swipe then owns the
  // contact without an operation.
  constructor({ width, opened, x, y, t, allowExit = false, allowOpen = true }) {
    this.width = width;
    this.opened = opened;
    this.start = { x, y, t };
    this.samples = [{ x, t }];
    this.axis = null;
    this.operation = null;
    this.distance = 0;
    this.allowExit = allowExit;
    this.allowOpen = allowOpen;
  }

  move(x, y, t) {
    const dx = x - this.start.x;
    const dy = y - this.start.y;
    if (!this.axis) {
      if (t - this.start.t >= ARTICLE_LONG_PRESS_MS) this.axis = 'vertical';
      else if (Math.max(Math.abs(dx), Math.abs(dy)) >= ARTICLE_GESTURE_SLOP) {
        this.axis = Math.abs(dx) > Math.abs(dy) ? 'horizontal' : 'vertical';
        if (this.axis === 'horizontal') {
          if (this.opened) this.operation = 'close';
          else if (dx < 0) this.operation = this.allowOpen ? 'open' : null;
          else this.operation = this.allowExit ? 'exit' : null;
        }
      }
    }
    this.samples.push({ x, t });
    this.samples = this.samples.filter(sample => t - sample.t <= ARTICLE_FLING_WINDOW_MS);
    const limit = this.operation === 'exit' ? this.width : this.width * 0.75;
    this.distance = Math.min(limit, Math.max(0, this.operation === 'open' ? -dx : dx));
    return this.snapshot();
  }

  snapshot() {
    return {
      axis: this.axis,
      operation: this.operation,
      distance: this.distance,
      reveal: this.operation === 'open' ? this.distance : this.opened ? this.width * 0.75 - this.distance : 0
    };
  }

  release(t, canceled = false) {
    if (canceled || !this.operation) return { opened: this.opened, exit: false };
    const samples = this.samples.filter(sample => t - sample.t <= ARTICLE_FLING_WINDOW_MS);
    const latest = this.samples[this.samples.length - 1];
    if (latest && latest.t < t) samples.push({ x: latest.x, t });
    const first = samples[0];
    const last = samples[samples.length - 1];
    const velocity = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const fling = Math.abs(velocity) >= ARTICLE_FLING_SPEED;
    const committed = fling
      ? this.operation === 'open' ? velocity < 0 : velocity > 0
      : this.distance > this.width * (this.operation === 'close' ? 0.375 : 0.5);
    return {
      opened: this.operation === 'open' ? committed : this.operation === 'close' ? !committed : false,
      exit: this.operation === 'exit' && committed
    };
  }
}
