// The motion between stacked pages (#25): the real screen and its title bar
// slide over an underlay that shows the lower page, while the bottom toolbar
// stays fixed. Leaving an article slides them away (#20, #28); opening a page
// slides them in (#36).
import { ARTICLE_SETTLE_MS } from './article_horizontal_gesture';

export const slideDuration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ARTICLE_SETTLE_MS;

// What shows under the real screen while it slides: the lower page's live
// layer under that page's title, or the dark fallback without one.
export function createUnderlay(core, layer, title) {
  const underlay = document.createElement('div');
  underlay.className = 'stackUnderlay';
  underlay.setAttribute('aria-hidden', 'true');
  underlay.inert = true;
  if (layer) {
    // The title bar slides with the real screen; the lower page's title stays.
    const bar = document.getElementById('mobileAppBar');
    const heading = document.createElement('div');
    heading.className = 'stackUnderlayTitle';
    heading.textContent = title;
    heading.style.height = (bar?.getBoundingClientRect().height || 0) + 'px';
    underlay.appendChild(heading);
    layer.show(false);
  }
  const toolbar = document.getElementById('mobileToolbar');
  underlay.style.height = (toolbar?.getBoundingClientRect().top ?? window.innerHeight) + 'px';
  core.view.mainDisplay.parentNode.appendChild(underlay);
  return underlay;
}

// The real screen and its title bar, raised over the underlay to slide.
export function holdSurfaces(core) {
  const surfaces = [core.view.mainDisplay, document.getElementById('mobileAppBar')].filter(Boolean).map(node => ({
    node, translate: node.style.translate, transition: node.style.transition, zIndex: node.style.zIndex
  }));
  for (const { node } of surfaces) {
    node.classList.add('stackMoving');
    node.style.zIndex = '152';
  }
  return surfaces;
}

export function releaseSurfaces(surfaces) {
  for (const surface of surfaces) {
    surface.node.style.translate = surface.translate;
    surface.node.style.transition = surface.transition;
    surface.node.style.zIndex = surface.zIndex;
    surface.node.classList.remove('stackMoving');
  }
}

export function paintSurfaces(surfaces, distance) {
  for (const { node } of surfaces) node.style.translate = `${distance}px 0`;
}
