// The motion between stacked pages (#25): the real screen and its title bar
// slide over an underlay that shows the lower page, while the bottom toolbar
// stays fixed. Leaving an article slides them away (#20, #28); opening a page
// slides them in (#36).
import { ARTICLE_SETTLE_MS } from './article_horizontal_gesture';

export const slideDuration = () => matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : ARTICLE_SETTLE_MS;

// The lines of the App Bar `appBar` ({ subtitle, time, byline }) under its
// title, as MobileAppBar lays them out.
function appBarLines(heading, appBar) {
  const line = (tag, className, text) => {
    const node = document.createElement(tag);
    node.className = className;
    node.textContent = text;
    return node;
  };
  if (appBar?.subtitle || appBar?.time) {
    const subline = line('div', 'mobileAppBarSubline', '');
    subline.appendChild(line('span', 'mobileAppBarSubtitle', appBar.subtitle || ''));
    if (appBar.time) subline.appendChild(line('span', 'mobileAppBarTime', appBar.time));
    heading.appendChild(subline);
  }
  if (appBar?.byline) heading.appendChild(line('div', 'mobileAppBarByline', appBar.byline));
}

// What shows under the real screen while it slides: the lower page's live
// layer under that page's title and the rest of its App Bar, or the dark
// fallback without one.
export function createUnderlay(core, layer, title, appBar = null) {
  const underlay = document.createElement('div');
  underlay.className = 'stackUnderlay';
  underlay.setAttribute('aria-hidden', 'true');
  underlay.inert = true;
  if (layer) {
    // The title bar slides with the real screen; the lower page's stays, until
    // its page takes over.
    const bar = document.getElementById('mobileAppBar');
    const heading = document.createElement('div');
    heading.className = 'stackUnderlayTitle';
    const text = document.createElement('div');
    text.className = 'mobileAppBarText';
    const titleLine = document.createElement('div');
    titleLine.className = 'mobileAppBarTitle';
    titleLine.textContent = title;
    text.appendChild(titleLine);
    appBarLines(text, appBar);
    heading.appendChild(text);
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
  return raiseSurfaces([core.view.mainDisplay, document.getElementById('mobileAppBar')]);
}

// `nodes`, raised over the underlay to slide.
export function raiseSurfaces(nodes) {
  const surfaces = nodes.filter(Boolean).map(node => ({
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
