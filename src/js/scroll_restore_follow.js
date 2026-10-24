// Keep a restored row fraction while its lazy preview changes height. Like
// BottomStick, ownership lasts until reader input or the article owner's cleanup;
// neither a fixed delay nor a scroll event proves that the reader took over.
export function followScrollRestore({ scroller, target, measure, isCurrent }) {
  if (!scroller?.isConnected || typeof ResizeObserver !== 'function') return null;
  let released = false;
  let frame = 0;
  let observed = null;
  const controller = new AbortController();
  const observer = new ResizeObserver(schedule);

  function update() {
    frame = 0;
    if (released) return;
    if (!scroller.isConnected || !isCurrent()) return release();
    const row = target();
    if (!row?.isConnected) return release();
    if (row !== observed) {
      if (observed) observer.unobserve(observed);
      observed = row;
      observer.observe(row);
    }
    const top = measure();
    if (Number.isFinite(top)) scroller.scrollTop = top;
  }

  function schedule() {
    if (!released && !frame) frame = requestAnimationFrame(update);
  }

  function release() {
    if (released) return;
    released = true;
    controller.abort();
    observer.disconnect();
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  for (const type of ['wheel', 'pointerdown', 'touchstart', 'keydown']) {
    window.addEventListener(type, release, { capture: true, passive: true, signal: controller.signal });
  }
  observer.observe(scroller);
  schedule();
  return { update: schedule, release };
}
