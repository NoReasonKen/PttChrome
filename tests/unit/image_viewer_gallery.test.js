// @unit-env browser
// real-input: tests/e2e/offline/mobile_image_viewer.offline.spec.js
import { ImageViewer } from '../../src/js/image_viewer';
import photoSwipeCss from 'photoswipe/style.css?raw';

let host;
let style;
let adapter;
let app;
let images;

beforeEach(async () => {
  style = document.createElement('style');
  style.textContent = photoSwipeCss;
  document.head.appendChild(style);
  host = document.createElement('div');
  host.className = 'main';
  host.style.cssText = 'position:relative;height:400px;width:390px;overflow:auto;';
  const article = document.createElement('div');
  article.id = 'mainContainer';
  host.appendChild(article);
  document.body.appendChild(host);
  images = [];
  for (const color of ['red', 'green', 'blue']) {
    const image = document.createElement('img');
    image.className = 'hyperLinkPreview';
    image.tabIndex = 0;
    image.style.cssText = 'display:block;width:200px;height:200px;margin-bottom:600px;';
    image.src = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="${color}"/></svg>`)}`;
    article.appendChild(image);
    await image.decode();
    images.push(image);
  }
  const buf = new EventTarget();
  buf.settledPageState = 3;
  app = {
    view: { screenRoot: host, mainContainer: article, _articleInstanceId: 1 },
    buf,
    connectState: 1,
    modalShown: false,
    setModalOpen(_source, open) { this.modalShown = open; },
    registerSheetDismiss: () => () => {},
  };
  adapter = new ImageViewer(app);
});

afterEach(async () => {
  adapter.destroy();
  await vi.waitFor(() => expect(adapter.isOpen).toBe(false));
  host.remove();
  style.remove();
});

function open(index = 0) {
  const image = images[index];
  expect(adapter.open({ src: image.src, width: 200, height: 200, trigger: image })).toBe(true);
  return adapter._viewer;
}

test('starts at the activated image and closes after the final image without looping', async () => {
  const viewer = open(1);
  expect(viewer.currSlide.data.src).toBe(images[1].src);
  viewer.next();
  expect(viewer.currSlide.data.src).toBe(images[2].src);
  viewer.next();
  await vi.waitFor(() => expect(adapter.isOpen).toBe(false));
  expect(app.modalShown).toBe(false);
  await vi.waitFor(() => expect(host.scrollTop).toBeGreaterThan(1000));
});

test('loading a neighboring image preserves the current zoom', async () => {
  const viewer = open();
  const zoom = viewer.currSlide.zoomLevels.fit * 2;
  viewer.currSlide.zoomTo(zoom, undefined, 0);
  const entry = viewer.options.dataSource[2];
  entry.load = async () => ({ src: entry.src, width: 200, height: 200 });
  await adapter._loadEntry(entry, viewer);
  expect(viewer.currSlide.data.src).toBe(images[0].src);
  expect(viewer.currSlide.currZoomLevel).toBeCloseTo(zoom);
});

test('expanding a previous album preserves the selected image and zoom', () => {
  const viewer = open(1);
  const selected = viewer.currSlide.data;
  const zoom = viewer.currSlide.zoomLevels.fit * 2;
  viewer.currSlide.zoomTo(zoom, undefined, 0);
  const previous = viewer.options.dataSource[1];
  adapter._replaceEntry(viewer, previous, [{ ...previous }, { ...previous }]);
  expect(viewer.currIndex).toBe(3);
  expect(viewer.currSlide.data).toBe(selected);
  expect(viewer.currSlide.currZoomLevel).toBeCloseTo(zoom);
});

test('a pending image cannot refresh slides after the viewer closes', async () => {
  const viewer = open();
  let resolve;
  let signal;
  const entry = viewer.options.dataSource[2];
  entry.load = (options) => {
    signal = options.signal;
    return new Promise(done => { resolve = done; });
  };
  const task = adapter._loadEntry(entry, viewer);
  const refresh = vi.spyOn(viewer, 'refreshSlideContent');
  adapter.close();
  expect(signal.aborted).toBe(true);
  resolve({ src: images[1].src, width: 200, height: 200 });
  await task;
  expect(refresh).not.toHaveBeenCalled();
});

test('an album resolved during a slide transition preserves the committed next image', async () => {
  const viewer = open(1);
  const previous = viewer.options.dataSource[1];
  const replacements = [{ ...previous }, { ...previous }];
  let resolve;
  previous.resolve = () => new Promise(done => { resolve = done; });
  const task = adapter._loadEntry(previous, viewer);
  viewer.mainScroll.moveIndexBy(1, true, 0.7);
  expect(viewer.mainScroll.isShifted()).toBe(true);
  resolve(replacements);
  await task;
  expect(viewer.currSlide.data.src).toBe(images[2].src);
  expect(viewer.currIndex).toBe(4);
});

test('album expansion waits for the current zoom animation to finish', async () => {
  const viewer = open(1);
  const selectedSlide = viewer.currSlide;
  const previous = viewer.options.dataSource[1];
  const replacements = [{ ...previous }, { ...previous }];
  previous.resolve = async () => replacements;
  const zoom = selectedSlide.zoomLevels.fit * 2;
  selectedSlide.zoomTo(zoom, undefined, 400);
  expect(viewer.animations.isPanRunning()).toBe(true);
  const task = adapter._loadEntry(previous, viewer);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  expect(viewer.currSlide).toBe(selectedSlide);
  await task;
  expect(viewer.currSlide.data.src).toBe(images[1].src);
  expect(viewer.currSlide.currZoomLevel).toBeCloseTo(zoom);
});

test('PhotoSwipe close releases queued updates without retaining the closed gallery', async () => {
  const viewer = open();
  viewer.currSlide.zoomTo(viewer.currSlide.zoomLevels.fit * 2, undefined, 400);
  // A library-owned close (Close button or Escape) bypasses adapter.close().
  const update = vi.fn();
  const task = adapter._whenIdle(viewer, update);
  viewer.close();
  expect(adapter._controller.signal.aborted).toBe(true);
  expect(adapter._updates).toHaveLength(0);
  await vi.waitFor(() => expect(adapter.isOpen).toBe(false));
  expect(adapter._updates).toHaveLength(0);
  expect(adapter._updateFrame).toBe(0);
  await task;
  expect(update).not.toHaveBeenCalled();
});

test('a different article never receives the previous viewer reading position', async () => {
  const viewer = open();
  viewer.next();
  app.view._articleInstanceId++;
  app.buf.dispatchEvent(new Event('screenSettled'));
  await vi.waitFor(() => expect(adapter.isOpen).toBe(false));
  expect(host.scrollTop).toBe(0);
});

test('manual reading input cancels deferred image centering', async () => {
  const viewer = open();
  viewer.next();
  adapter.close();
  await vi.waitFor(() => expect(adapter.isOpen).toBe(false));
  window.dispatchEvent(new Event('wheel'));
  expect(adapter._restoreController.signal.aborted).toBe(true);
});
