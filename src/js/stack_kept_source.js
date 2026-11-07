// A deleted source article kept shown over its board list (#121): search
// backtracking could not reopen it, so the article the reader left stays until
// Back. Input on it stays on it.
import { LOCAL_INPUT, stopLocal } from './stack_layer';

export class KeptSource {
  // `handoff`: the ended handoff that revealed the source; its layer, App Bar
  // and post are kept.
  constructor(handoff) {
    this.layer = handoff.layer;
    this.appBar = handoff.appBar;
    this.post = handoff.post;
    for (const type of LOCAL_INPUT) this.layer.el.addEventListener(type, stopLocal);
  }

  // Back from it: PTT already shows the board list, so the article only goes
  // away.
  leave() {
    for (const type of LOCAL_INPUT) this.layer.el.removeEventListener(type, stopLocal);
    this.layer.destroy();
  }
}
