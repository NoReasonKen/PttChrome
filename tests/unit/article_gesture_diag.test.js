// @unit-env browser
// real-input: tests/e2e/offline/mobile_gesture_latency.offline.spec.js
import { DrawerDiagnostics } from '../../src/js/article_gesture_diag';
import { ArticleHorizontalGesture } from '../../src/js/article_horizontal_gesture';

describe('recording-only gesture startup timing', () => {
  let frames;
  let now;
  beforeEach(() => {
    frames = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { frames.push(callback); return frames.length; });
    now = vi.spyOn(performance, 'now').mockReturnValue(100);
  });
  afterEach(() => vi.restoreAllMocks());

  const contact = () => ({ gesture: new ArticleHorizontalGesture({ width: 400, opened: false, x: 300, y: 100, t: 80 }) });
  const event = { clientX: 296, clientY: 100, timeStamp: 90 };
  const setup = (isRecording = true) => {
    const recorder = { isRecording, log: vi.fn() };
    const diag = new DrawerDiagnostics({ core: { debugRecorder: recorder }, frame: 1 });
    return { diag, recorder };
  };

  it('does no timing or scheduling when recording is off', () => {
    const { diag, recorder } = setup(false);
    diag.endMove(diag.beginMove(event, contact()));
    expect(now).not.toHaveBeenCalled();
    expect(frames).toHaveLength(0);
    expect(recorder.log).not.toHaveBeenCalled();
  });

  it('separates event delivery, preparation, handler and frame scheduling', () => {
    const { diag, recorder } = setup();
    const track = contact();
    const timing = diag.beginMove(event, track);
    track.gesture.move(event.clientX, event.clientY, event.timeStamp);
    timing.prepareMs = 2;
    now.mockReturnValue(105);
    diag.endMove(timing);
    now.mockReturnValue(116);
    frames.shift()();
    expect(recorder.log).toHaveBeenCalledWith('[DEBUG-69-latency]', {
      move: 1, eventLagMs: 10, contactMs: 10, dx: -4, dy: 0, prepareMs: 2,
      axis: 'horizontal', operation: 'open', distance: 4,
      handlerMs: 5, frameWaitMs: 11, pendingPaint: true
    });
  });

  it('bounds each contact independently and drops callbacks after recording stops', () => {
    const { diag, recorder } = setup();
    const track = contact();
    for (let i = 0; i < 10; i++) diag.endMove(diag.beginMove(event, track));
    expect(frames).toHaveLength(3);
    expect(diag.beginMove(event, contact()).move).toBe(1);
    recorder.isRecording = false;
    frames.forEach(callback => callback());
    expect(recorder.log).not.toHaveBeenCalled();
  });
});
