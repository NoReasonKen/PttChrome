// Only fixed categories leave this module; DOM text, attributes and URLs never do.
export function contextTargetKind(target) {
  const el = target?.nodeType === 1 ? target : target?.parentElement;
  if (!el?.closest) return 'other';
  if (el.closest('[data-stack-layer] .listCard')) return 'revealed-list-card';
  if (el.closest('[data-stack-layer="article"]')) return 'revealed-article';
  if (el.closest('.listCard')) return 'list-card';
  if (el.closest('.main')) return 'main';
  return 'other';
}

export function watchContextMenus(rec, win) {
  let contact = null;
  let active = true;
  const clear = () => {
    if (!contact) return;
    contact.observer?.disconnect();
    clearTimeout(contact.hold);
    clearTimeout(contact.expiry);
    clearTimeout(contact.finish);
    contact = null;
  };
  const emit = (current, phase) => {
    if (contact !== current || !rec.isRecording) return;
    rec.log('contextMenu.contact', {
      phase, target: current.target, durationMs: Math.round(performance.now() - current.start),
      targetConnected: !!current.node.isConnected,
      ancestorsConnected: current.ancestors.every(node => node.isConnected),
      removedDuringContact: current.removed,
      preventedEvents: [...current.prevented],
      pointerCancelled: current.pointerCanceled,
      touchCancelled: current.touchCanceled,
      selectionCollapsed: win.getSelection?.()?.isCollapsed ?? true,
    });
  };
  const start = event => {
    if (!rec.isRecording || event.pointerType !== 'touch' || event.isPrimary === false) return;
    clear();
    const node = event.target;
    if (!node || !win.MutationObserver) return;
    const ancestors = [];
    for (let parent = node.parentNode; parent; parent = parent.parentNode) ancestors.push(parent);
    const current = contact = {
      node, ancestors, pointerId: event.pointerId, touchId: null, target: contextTargetKind(node), start: performance.now(),
      removed: false, prevented: new Set(), pointerCanceled: false, touchCanceled: false,
    };
    current.observer = new win.MutationObserver(records => {
      for (const record of records) for (const removed of record.removedNodes) {
        if ([node, ...ancestors].some(original => removed === original || removed.contains?.(original))) current.removed = true;
      }
    });
    current.observer.observe(win.document, { childList: true, subtree: true });
    current.hold = setTimeout(() => { if (!rec.isRecording) clear(); else emit(current, 'hold'); }, 700);
    current.expiry = setTimeout(() => { emit(current, 'timeout'); clear(); }, 5000);
  };
  const input = event => {
    const current = contact;
    if (!current) return;
    if (!rec.isRecording) return clear();
    if (event.type.startsWith('pointer') && event.pointerId !== current.pointerId) return;
    if (event.type.startsWith('touch') && event.changedTouches?.length) {
      if (current.touchId == null) current.touchId = event.changedTouches[0].identifier;
      if (!Array.from(event.changedTouches).some(touch => touch.identifier === current.touchId)) return;
    }
    if (event.type === 'pointercancel') current.pointerCanceled = true;
    if (event.type === 'touchcancel') current.touchCanceled = true;
    // Run after dispatch, so later listeners' preventDefault calls are included.
    setTimeout(() => {
      if (contact === current && event.defaultPrevented) current.prevented.add(event.type);
    }, 0);
    if (event.type === 'touchend' || event.type === 'touchcancel' || (event.type === 'pointerup' && !current.pointerCanceled)) {
      clearTimeout(current.finish);
      current.finish = setTimeout(() => {
        if (current.touchCanceled || performance.now() - current.start >= 700) emit(current, 'end');
        clear();
      }, 30);
    }
  };
  const listener = event => {
    if (!rec.isRecording) return;
    const info = {
      target: contextTargetKind(event.target),
      pointer: ['touch', 'mouse', 'pen'].includes(event.pointerType) ? event.pointerType : 'unknown',
      touchSource: !!event.sourceCapabilities?.firesTouchEvents,
      cancelable: event.cancelable,
      preventedAtCapture: event.defaultPrevented,
    };
    // A task runs after dispatch, including listeners that stop propagation.
    setTimeout(() => { if (active && rec.isRecording) rec.log('contextMenu.dispatch', { ...info, preventedFinal: event.defaultPrevented }); }, 0);
  };
  win.addEventListener('contextmenu', listener, true);
  win.addEventListener('pointerdown', start, true);
  const types = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel'];
  for (const type of types) win.addEventListener(type, input, true);
  return () => {
    active = false;
    clear();
    win.removeEventListener('contextmenu', listener, true);
    win.removeEventListener('pointerdown', start, true);
    for (const type of types) win.removeEventListener(type, input, true);
  };
}
