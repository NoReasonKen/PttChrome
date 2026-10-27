// @unit-env browser
// real-input: tests/e2e/offline/mobile_article_rotation.offline.spec.js
import { ArticleResizeAnchor } from '../../src/js/article_resize_anchor';

describe('ArticleResizeAnchor reading position ownership', () => {
  let originalWidth;
  let originalHeight;
  let scroller;
  let article;
  let record;
  let core;
  let anchor;
  let capture;

  function setViewport(width, height) {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  }

  function resize(width = 800, height = 390) {
    setViewport(width, height);
    window.dispatchEvent(new Event('resize'));
  }

  function scrollToLine(lineIndex) {
    article.lineIndex = lineIndex;
    scroller.scrollTop = lineIndex * 20;
    scroller.dispatchEvent(new Event('scroll'));
  }

  function readerInput(type) {
    const event = type === 'keydown'
      ? new KeyboardEvent('keydown', { key: 'PageDown', bubbles: true })
      : type === 'wheel'
        ? new WheelEvent('wheel', { deltaY: 80, bubbles: true })
        : type === 'pointerdown'
          ? new PointerEvent('pointerdown', { pointerType: 'touch', bubbles: true })
          : new Event('touchstart', { bubbles: true });
    scroller.dispatchEvent(event);
  }

  beforeEach(() => {
    originalWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
    originalHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
    setViewport(390, 800);
    scroller = document.createElement('div');
    scroller.style.cssText = 'height:200px;width:300px;overflow:auto;';
    const content = document.createElement('div');
    content.style.height = '10000px';
    scroller.append(content);
    document.body.append(scroller);
    article = { board: 'Test', easy: true, lineIndex: 42.5, atBottom: false };
    record = {
      current: vi.fn(() => ({ article })),
      begin: vi.fn(feature => ({ feature, article: { ...article } })),
      end: vi.fn(),
    };
    core = {
      readingRecord: record,
      view: { mainDisplay: scroller },
      easyReading: { _advanceScrollRestore: vi.fn() },
    };
    anchor = new ArticleResizeAnchor(core);
    capture = vi.fn(() => anchor.capture());
    anchor.attach(capture);
    anchor.remember();
  });

  afterEach(() => {
    anchor.destroy();
    scroller.remove();
    if (originalWidth) Object.defineProperty(window, 'innerWidth', originalWidth);
    else delete window.innerWidth;
    if (originalHeight) Object.defineProperty(window, 'innerHeight', originalHeight);
    else delete window.innerHeight;
    vi.restoreAllMocks();
  });

  test('restores the last stable article row before wrapping and image height change', () => {
    scrollToLine(57.25);
    article.lineIndex = 19.5;
    resize();

    const item = anchor.take();
    expect(item.bookmark.article).toEqual({
      board: 'Test', easy: true, lineIndex: 57.25, atBottom: false,
    });
    anchor.finish(item, 'done');
    expect(record.end).toHaveBeenCalledWith(item.bookmark, 'done');
    expect(core.easyReading._advanceScrollRestore).toHaveBeenCalledOnce();
  });

  test('a scroll emitted after viewport geometry changes cannot replace the previous reading position', () => {
    setViewport(800, 390);
    scrollToLine(18);
    window.dispatchEvent(new Event('resize'));

    expect(anchor.take().bookmark.article.lineIndex).toBe(42.5);
  });

  test('coalesces repeated layout and visual viewport notifications into one bookmark', () => {
    resize();
    window.visualViewport.dispatchEvent(new Event('resize'));
    resize(820, 390);
    const item = anchor.take();
    resize(840, 390);

    expect(capture).toHaveBeenCalledTimes(4);
    expect(record.begin).toHaveBeenCalledExactlyOnceWith('article-resize');
    expect(item.bookmark.article.lineIndex).toBe(42.5);
    anchor.finish(item, 'done');
    expect(record.end).toHaveBeenCalledOnce();
  });

  test('take retains the initial capture rather than measuring later article geometry', () => {
    resize();
    article.lineIndex = 8;
    article.atBottom = true;
    anchor.remember();

    const item = anchor.take();
    expect(item.bookmark.article.lineIndex).toBe(42.5);
    expect(item.bookmark.article.atBottom).toBe(false);
    expect(record.begin).toHaveBeenCalledOnce();
  });

  test('take can start ownership without a preceding viewport notification', () => {
    article.lineIndex = 61.75;
    const item = anchor.take();

    expect(record.begin).toHaveBeenCalledExactlyOnceWith('article-resize');
    expect(item.bookmark.article.lineIndex).toBe(61.75);
    anchor.finish(item, 'done');
    expect(record.end).toHaveBeenCalledExactlyOnceWith(item.bookmark, 'done');
  });

  test.each(['wheel', 'pointerdown', 'touchstart', 'keydown'])(
    '%s between capture and terminal resize relinquishes the captured reading position',
    type => {
      resize();
      readerInput(type);
      const item = anchor.take();
      anchor.finish(item, 'done');

      expect(record.end).toHaveBeenCalledExactlyOnceWith(item.bookmark, 'cancel');
      expect(core.easyReading._advanceScrollRestore).not.toHaveBeenCalled();
    },
  );

  test.each(['wheel', 'pointerdown', 'keydown'])(
    '%s while the resize owns its bookmark prevents a later restore',
    type => {
      resize();
      const item = anchor.take();
      readerInput(type);
      anchor.finish(item, 'done');

      expect(record.end).toHaveBeenCalledExactlyOnceWith(item.bookmark, 'cancel');
      expect(core.easyReading._advanceScrollRestore).not.toHaveBeenCalled();
    },
  );

  test('finishLocal restores the captured row when the viewport changes without a terminal row change', () => {
    resize(390, 780);
    anchor.finishLocal();
    anchor.finishLocal();
    anchor.cancel();

    expect(record.end).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ article: expect.objectContaining({ lineIndex: 42.5 }) }),
      'done',
    );
    expect(core.easyReading._advanceScrollRestore).toHaveBeenCalledOnce();
  });

  test('finishLocal leaves an active terminal resize for its owner to finish', () => {
    resize();
    const item = anchor.take();
    anchor.finishLocal();

    expect(record.end).not.toHaveBeenCalled();
    anchor.finish(item, 'done');
    expect(record.end).toHaveBeenCalledExactlyOnceWith(item.bookmark, 'done');
  });

  test.each(['captured', 'owned'])('cancel closes a %s bookmark exactly once', phase => {
    resize();
    if (phase === 'owned') anchor.take();
    anchor.cancel();
    anchor.cancel();
    anchor.finishLocal();

    expect(record.end).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ feature: 'article-resize' }),
      'cancel',
    );
    expect(core.easyReading._advanceScrollRestore).not.toHaveBeenCalled();

    scrollToLine(75);
    resize(390, 800);
    expect(anchor.take().bookmark.article.lineIndex).toBe(75);
    expect(record.begin).toHaveBeenCalledTimes(2);
  });

  test('destroy removes viewport, scroll, and reader input listeners', () => {
    anchor.destroy();
    anchor.destroy();
    scrollToLine(90);
    resize();
    window.visualViewport.dispatchEvent(new Event('resize'));
    expect(capture).not.toHaveBeenCalled();
    expect(record.begin).not.toHaveBeenCalled();

    anchor.capture();
    const item = anchor.take();
    readerInput('wheel');
    anchor.finish(item, 'done');

    expect(item.bookmark.article.lineIndex).toBe(42.5);
    expect(record.end).toHaveBeenCalledExactlyOnceWith(item.bookmark, 'done');
  });
});
