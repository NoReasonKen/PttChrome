// @unit-env browser
// real-input: tests/e2e/offline/mobile_pixiv_lookup.offline.spec.js
import { mountScreen, unmountAll } from './helpers/mount_screen';
import { computeAnnotations, PAGE_READING, PAGE_LIST } from '../../src/js/screen_annotations';
import { annotationsKey, sameKey } from '../../src/js/screen_annotate_cache';
import { applyWrapUrlRange } from '../../src/js/body_wrap';
import { seg as chars } from './helpers/screen_fixtures';

afterEach(unmountAll);
const base = { pageState: PAGE_READING, easyReading: true, enablePixivLookup: true };

test('numeric annotations are opt-in, article-only, and do not annotate headers', () => {
  const lines = ['author123 65964428', '時間 Mon Nov 6 2026', '※ 12345678', '65964428'].map(chars);
  const onPixivClick = vi.fn();
  const run = enhance => computeAnnotations(lines, enhance).annotations;
  expect(run({ ...base, onPixivClick })[3].pixivIds[0].query).toBe('65964428');
  expect(run({ ...base, onPixivClick })[1]?.pixivIds).toBeUndefined();
  expect(run({ ...base, onPixivClick })[2]?.pixivIds).toBeUndefined();
  expect(run({ ...base, onPixivClick, enablePixivLookup: false })[3]?.pixivIds).toBeUndefined();
  expect(run({ ...base, onPixivClick, pageState: PAGE_LIST })[3]?.pixivIds).toBeUndefined();
  expect(onPixivClick).not.toHaveBeenCalled();
});

test('changing the setting or callback invalidates cached annotations', () => {
  const enhance = { ...base, onPixivClick: () => {} };
  const key = annotationsKey({ enhance });
  expect(sameKey(key, annotationsKey({ enhance: { ...enhance, enablePixivLookup: false } }))).toBe(false);
  expect(sameKey(key, annotationsKey({ enhance: { ...enhance, onPixivClick: () => {} } }))).toBe(false);
});

test('article annotations require whitespace or row edges on both sides of an ID', () => {
  const lines = ['65964428', 'ID 65847159 end', '(65964428)', '65964428,', '字65964428', '65964428字',
    ' 105176734 ', '[ 117918634 ]'].map(chars);
  const annotations = computeAnnotations(lines, { ...base, onPixivClick: vi.fn() }).annotations;
  expect(annotations.map(ann => ann?.pixivIds?.map(item => item.query) || [])).toEqual([
    ['65964428'], ['65847159'], [], [], [], [], ['105176734'], ['117918634'],
  ]);
});

test('cross-line URLs remove overlapping numeric candidates', () => {
  const ann = { pixivIds: [{ startCol: 1, endCol: 9, query: '65964428' }] };
  expect(applyWrapUrlRange(ann, { startCol: 0, endCol: 10 }).pixivIds).toBeUndefined();
});

test('numeric giveaway codes retain their existing destination', () => {
  const lines = ['steamgifts.com', '12345'].map(chars);
  const annotations = computeAnnotations(lines, { ...base, onPixivClick: vi.fn() }).annotations;
  expect(annotations[1]?.giveaways?.[0].href).toContain('steamgifts.com/giveaway/12345');
  expect(annotations[1]?.pixivIds).toBeUndefined();
});

test('a numeric continuation of a reconstructed article code stays an article link', () => {
  const prefix = '推 reader: ';
  const left = prefix + 'x'.repeat(66 - (prefix.length + 1) - 6) + ' #1gU3';
  const lines = [chars(left.padEnd(67) + '11/06 12:34'), chars(prefix + '1234'.padEnd(67 - prefix.length) + '11/06 12:34')];
  const annotations = computeAnnotations(lines, { ...base, mergeSameAuthorComments: true,
    onAidClick: vi.fn(), onPixivClick: vi.fn() }).annotations;
  const merged = annotations[0]?.mergeCommentRun;
  expect(merged?.aids?.map(item => item.aid)).toEqual(['1gU31234', '1gU31234']);
  expect(merged?.pixivIds).toBeUndefined();
});

test.each(['ID 65964428 end', '65964428'])('rendering preserves original text and cell ranges: %s', text => {
  const onPixivClick = vi.fn();
  const lines = [chars(text)];
  const screen = mountScreen({ lines, enhance: { ...base, onPixivClick } });
  const a = screen.container.querySelector('[data-pixiv-id="65964428"]');
  expect(a?.textContent).toBe('65964428');
  expect(screen.container.textContent).toContain(text);
  expect(a.closest('[data-type="bbsline"]')).not.toBeNull();
  expect(onPixivClick).not.toHaveBeenCalled();
  screen.update({ lines, enhance: { ...base, onPixivClick, enablePixivLookup: false } });
  expect(screen.container.querySelector('[data-pixiv-id]')).toBeNull();
});

test('a number at the start of a mobile comment card renders without a prefix segment', () => {
  const lines = [chars('推 reader: 65847159                                         11/06 12:34')];
  const screen = mountScreen({ lines, enhance: { ...base, commentCards: true, onPixivClick: vi.fn() } });
  expect(screen.container.querySelector('.commentCard [data-pixiv-id="65847159"]')?.textContent).toBe('65847159');
});
