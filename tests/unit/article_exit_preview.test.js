// @unit-env browser
import { ArticleExitPreview } from '../../src/js/article_exit_preview';

afterEach(() => {
  vi.restoreAllMocks();
  document.querySelectorAll('[data-preview-test]').forEach(node => node.remove());
});

test.each([1, 1.15, 1.3, 0.85])('copies typography without applying WebView text zoom twice at scale %s', scale => {
  const main = document.createElement('div');
  main.dataset.previewTest = '';
  main.style.cssText = 'position:fixed;left:0;top:0;width:320px;height:100px;font:16px/20px monospace';
  main.innerHTML = '<span type="bbsrow" style="display:block;line-height:1.3em">Article title<span style="display:block;font-size:0.8em;line-height:1.375em">Author and date</span></span>';
  document.body.appendChild(main);
  const sourceNodes = [...main.querySelectorAll('span')];
  const nativeStyle = window.getComputedStyle.bind(window);
  const expected = sourceNodes.map(node => {
    const style = nativeStyle(node);
    return { font: parseFloat(style.fontSize), line: parseFloat(style.lineHeight) };
  });
  const rowBounds = sourceNodes[0].getBoundingClientRect();

  // WebView reports text-zoomed font and line-height pixels in computed styles.
  // Model that browser boundary; keep real DOM layout and the capture lifecycle.
  vi.spyOn(window, 'getComputedStyle').mockImplementation(node => {
    const style = nativeStyle(node);
    if (!main.contains(node)) return style;
    const valueFor = property => {
      const value = style.getPropertyValue(property);
      return ['font-size', 'line-height'].includes(property) && value.endsWith('px')
        ? `${parseFloat(value) * scale}px` : value;
    };
    return new Proxy(style, {
      get(target, property) {
        if (property === 'fontSize') return valueFor('font-size');
        if (property === 'getPropertyValue') return valueFor;
        const value = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
    });
  });
  const core = {
    mobile: true,
    conn: { isConnected: true },
    listSession: { _boardName: 'Test' },
    view: { mainDisplay: main, _articleBoard: 'Test', componentScreen: { hasListViewport: () => true } },
    easyReading: { _articleKey: 'article' }
  };
  const preview = new ArticleExitPreview(core);
  preview.capture();
  preview.enterArticle();
  const underlay = document.createElement('div');
  underlay.dataset.previewTest = '';
  document.body.appendChild(underlay);
  expect(preview.appendTo(underlay)).toBe(true);
  const copies = [...underlay.querySelectorAll('.articleExitListPreview span')];
  expect(copies).toHaveLength(sourceNodes.length);
  copies.forEach((copy, index) => {
    const style = nativeStyle(copy);
    expect(parseFloat(style.fontSize)).toBeCloseTo(expected[index].font, 3);
    expect(parseFloat(style.lineHeight)).toBeCloseTo(expected[index].line, 3);
  });
  const copyBounds = copies[0].getBoundingClientRect();
  expect(copyBounds.left).toBeCloseTo(rowBounds.left, 3);
  expect(copyBounds.top).toBeCloseTo(rowBounds.top, 3);
  expect(copyBounds.width).toBeCloseTo(rowBounds.width, 3);
  expect(copyBounds.height).toBeCloseTo(rowBounds.height, 3);
});
