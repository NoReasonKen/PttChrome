import PhotoSwipe from 'photoswipe';

// Own the viewer's modal lifetime; the screen only supplies a loaded image.
// Gesture recognition, zoom bounds, panning, and focus containment belong to PhotoSwipe.
export class ImageViewer {
  constructor(app) {
    this.app = app;
    this._viewer = null;
    this._onPreview = (event) => {
      if (!app.modalShown) this.open(event.detail);
    };
    this._onSettled = () => {
      if (this.isOpen && (app.view._articleInstanceId !== this._articleId ||
          app.buf.settledPageState !== 3)) this.close();
    };
    app.view.screenRoot.addEventListener('previewimage', this._onPreview);
    app.buf.addEventListener('screenSettled', this._onSettled);
  }

  get isOpen() {
    return this._viewer !== null;
  }

  open(image) {
    if (this.isOpen || !image?.src || !(image.width > 0 && image.height > 0)) return false;
    const { app } = this;
    const { src, width, height, alt = '', referrerPolicy = '', trigger } = image;
    const viewer = new PhotoSwipe({
      dataSource: [{ src, width, height, alt }],
      initialZoomLevel: 'fit',
      secondaryZoomLevel: (levels) => levels.fit * 2,
      // Even a tiny or very tall image can grow wider than the viewport.
      maxZoomLevel: (levels) => Math.max(levels.fit * 8,
        levels.panAreaSize.x / levels.elementSize.x * 2),
      doubleTapAction: 'zoom',
      imageClickAction: 'zoom',
      tapAction: false,
      pinchToClose: false,
      closeOnVerticalDrag: false,
      allowPanToNext: false,
      loop: false,
      counter: false,
      arrowPrev: false,
      arrowNext: false,
      returnFocus: false,
      showHideAnimationType: 'none',
      bgOpacity: 1,
      closeTitle: 'Close image viewer',
      zoomTitle: 'Zoom image',
      errorMsg: 'The image could not be loaded.',
      mainClass: 'imageViewer',
    });
    this._viewer = viewer;
    this._articleId = app.view._articleInstanceId;
    const background = new Map();
    const unregister = app.registerSheetDismiss(() => this.close());
    app.setModalOpen('imageViewer', true);

    viewer.on('firstUpdate', () => {
      viewer.element.setAttribute('aria-label', 'Image viewer');
      viewer.element.setAttribute('aria-modal', 'true');
      for (const child of document.body.children) {
        if (child === viewer.element) continue;
        background.set(child, child.inert);
        child.inert = true;
      }
    });
    viewer.on('contentLoadImage', ({ content }) => {
      content.element.referrerPolicy = referrerPolicy;
    });
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      for (const [child, inert] of background) child.inert = inert;
      unregister();
      this._viewer = null;
      app.setModalOpen('imageViewer', false);
      if (trigger?.isConnected && !app.modalShown) trigger.focus({ preventScroll: true });
      window.dispatchEvent(new CustomEvent('imageviewerchange', { detail: { open: false } }));
    };
    viewer.on('destroy', release);
    try {
      viewer.init();
      window.dispatchEvent(new CustomEvent('imageviewerchange', { detail: { open: true } }));
      return true;
    } catch (error) {
      // Initialization failures must release terminal input and background focus.
      viewer.element?.remove();
      viewer.events.removeAll();
      release();
      throw error;
    }
  }

  close() {
    this._viewer?.close();
  }

  destroy() {
    this.close();
    this.app.view.screenRoot.removeEventListener('previewimage', this._onPreview);
    this.app.buf.removeEventListener('screenSettled', this._onSettled);
  }
}
