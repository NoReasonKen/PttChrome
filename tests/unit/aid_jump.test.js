import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/js/i18n', () => ({ i18n: (key) => key + ' {0}' }));

import { AID_INPUT_MAX_LENGTH } from '../../src/js/aid_codec';
import { parseAidJumpInput, parseArticlePaste, requestAidJump, startAidJump } from '../../src/js/aid_jump';

describe('parseAidJumpInput', () => {
  it('takes the longest real form and nothing longer than the input limit', () => {
    const real = '#1AbCdEfG (' + 'a'.repeat(12) + ')';
    expect(real.length).toBeLessThanOrEqual(AID_INPUT_MAX_LENGTH);
    expect(parseAidJumpInput(real)).toEqual({ aid: '1AbCdEfG', board: 'a'.repeat(12) });
    const long = '#1AbCdEfG' + ' '.repeat(AID_INPUT_MAX_LENGTH) + 'Test';
    expect(parseAidJumpInput(long)).toBeNull();
    expect(parseAidJumpInput('  ' + real + '  ')).not.toBeNull(); // trimmed first
  });
  it('reads a code with or without #', () => {
    expect(parseAidJumpInput('#1AbCdEfG')).toEqual({ aid: '1AbCdEfG', board: null });
    expect(parseAidJumpInput(' 1AbCdEfG\n')).toEqual({ aid: '1AbCdEfG', board: null });
  });
  it('reads the code with another board in both of PTT\'s spellings', () => {
    expect(parseAidJumpInput('#1AbCdEfG (Gossiping)')).toEqual({ aid: '1AbCdEfG', board: 'Gossiping' });
    expect(parseAidJumpInput('Gossiping #1AbCdEfG')).toEqual({ aid: '1AbCdEfG', board: 'Gossiping' });
  });
  it('takes no other text: words, URLs, wrong lengths', () => {
    for (const text of ['', 'keyboard', 'hello world', '#1AbCdEf', '#1AbCdEfGh', 'https://www.ptt.cc/bbs/Test/M.1783270974.A.0CA.html'])
      expect(parseAidJumpInput(text)).toBeNull();
  });
});

function coreWith(over = {}) {
  return {
    view: { flashListHint: vi.fn() },
    listSession: { aidJumpBoard: () => 'Test' },
    aidNavigation: { selectArticle: vi.fn(() => true), active: false },
    deepLinkController: { request: vi.fn(() => 'navigating') },
    openAidJumpModal: vi.fn(() => true),
    ...over
  };
}

describe('requestAidJump', () => {
  it('opens the input when the list can take a jump', () => {
    const core = coreWith();
    expect(requestAidJump(core)).toBe(true);
    expect(core.openAidJumpModal).toHaveBeenCalled();
  });
  it('tells the reader when it cannot', () => {
    const core = coreWith({ listSession: { aidJumpBoard: () => null } });
    expect(requestAidJump(core)).toBe(false);
    expect(core.openAidJumpModal).not.toHaveBeenCalled();
    expect(core.view.flashListHint).toHaveBeenCalled();
  });
});

describe('startAidJump', () => {
  it('selects on the list\'s board when no board is written or it is the same one', () => {
    for (const text of ['#1AbCdEfG', '#1AbCdEfG (test)']) {
      const core = coreWith();
      expect(startAidJump(core, text)).toBe(true);
      expect(core.aidNavigation.selectArticle.mock.calls[0].slice(0, 2)).toEqual(['Test', '1AbCdEfG']);
      expect(core.deepLinkController.request).not.toHaveBeenCalled();
    }
  });
  it('sends another board through the deep-link navigation', () => {
    const core = coreWith();
    startAidJump(core, '#1AbCdEfG (Gossiping)');
    expect(core.deepLinkController.request).toHaveBeenCalledWith({ board: 'Gossiping', aid: '1AbCdEfG' });
    expect(core.aidNavigation.selectArticle).not.toHaveBeenCalled();
  });
  it('says a miss and a failure, and nothing when it works', () => {
    const core = coreWith();
    startAidJump(core, '1AbCdEfG');
    const end = core.aidNavigation.selectArticle.mock.calls[0][2];
    end({ ok: true });
    expect(core.view.flashListHint).not.toHaveBeenCalled();
    end({ ok: false, missed: true });
    expect(core.view.flashListHint.mock.calls[0][0]).toContain('#1AbCdEfG');
  });
  it('starts nothing for text that is no code, or while the list cannot take it', () => {
    const core = coreWith();
    expect(startAidJump(core, 'hello')).toBe(false);
    const held = coreWith({ listSession: { aidJumpBoard: () => null } });
    expect(startAidJump(held, '1AbCdEfG')).toBe(false);
    expect(held.aidNavigation.selectArticle).not.toHaveBeenCalled();
  });
});

// #281: the same entrance and transaction from an easy-reading article. The
// list has no say then (it waits suspended behind the article); the article's
// board is the one PTT's `#` would search.
function articleCore(over = {}) {
  return coreWith({
    listSession: { aidJumpBoard: () => null },
    easyReading: { aidJumpBoard: () => 'Test' },
    aidNavigation: { selectArticle: vi.fn(() => true), jumpFromArticle: vi.fn(() => true), active: false },
    ...over
  });
}

describe('parseArticlePaste', () => {
  it('takes a code in any form the input takes, and a PTT article link', () => {
    expect(parseArticlePaste('#1AbCdEfG')).toEqual({ aid: '1AbCdEfG', board: null });
    expect(parseArticlePaste(' https://www.ptt.cc/bbs/Test/M.1783270974.A.0CA.html\n')).toEqual({ aid: '1gIeu-3A', board: 'Test' });
  });
  it('takes no other text, and no link to another site', () => {
    for (const text of ['hello world', 'https://example.com/bbs/Test/M.1783270974.A.0CA.html', 'https://www.ptt.cc/bbs/Test/index.html'])
      expect(parseArticlePaste(text)).toBeNull();
  });
});

describe('the jump by code from an article', () => {
  it('# opens the same input as on the list', () => {
    const core = articleCore();
    expect(requestAidJump(core)).toBe(true);
    expect(core.openAidJumpModal).toHaveBeenCalled();
  });
  it('runs on the article\'s board, never as a list selection', () => {
    for (const text of ['#1AbCdEfG', '#1AbCdEfG (test)', 'https://www.ptt.cc/bbs/Test/M.1783270974.A.0CA.html']) {
      const core = articleCore();
      expect(startAidJump(core, text)).toBe(true);
      expect(core.aidNavigation.jumpFromArticle).toHaveBeenCalledTimes(1);
      expect(core.aidNavigation.jumpFromArticle.mock.calls[0][0]).toBe('Test');
      expect(core.aidNavigation.selectArticle).not.toHaveBeenCalled();
      expect(core.deepLinkController.request).not.toHaveBeenCalled();
    }
  });
  it('sends a code of another board through the deep-link navigation, as the list does', () => {
    const core = articleCore();
    startAidJump(core, 'https://www.ptt.cc/bbs/Gossiping/M.1783270974.A.0CA.html');
    expect(core.deepLinkController.request).toHaveBeenCalledWith({ board: 'Gossiping', aid: '1gIeu-3A' });
    expect(core.aidNavigation.jumpFromArticle).not.toHaveBeenCalled();
  });
  it('a miss brought back to the article says so; a landing says nothing', () => {
    const core = articleCore();
    startAidJump(core, '1AbCdEfG');
    const end = core.aidNavigation.jumpFromArticle.mock.calls[0][2];
    end({ ok: true });
    expect(core.view.flashListHint).not.toHaveBeenCalled();
    end({ ok: false, missed: true, returned: true });
    expect(core.view.flashListHint.mock.calls[0][0]).toContain('aidJump_notFoundArticle');
    expect(core.view.flashListHint.mock.calls[0][0]).toContain('#1AbCdEfG');
  });
  // The run leaves the article and opens it, or another, again: easy reading
  // repaints it on the way, so a copy of it covers the reading area from the
  // start (ArticleHold's run cover) and the reader sees it stay still.
  describe('the article left stays still', () => {
    const coveredCore = (started = true) => {
      const order = [];
      const core = articleCore({
        articleHold: {
          run: vi.fn((source, opts) => order.push(['run', source, opts]) > 0),
          done: vi.fn((source, opts) => order.push(['done', source, opts])),
        },
        articleGestures: {
          captureArticleLayer: vi.fn(() => (order.push(['capture']), { layer: {} })),
          landJump: vi.fn((left, landed) => order.push(['land', landed])),
        },
      });
      core.aidNavigation.jumpFromArticle = vi.fn(() => (order.push(['jump']), started));
      return { core, order };
    };
    it('is covered before the run leaves it, after its live layer is captured', () => {
      const { core, order } = coveredCore();
      startAidJump(core, '1AbCdEfG');
      expect(order).toEqual([['capture'], ['run', 'articleAidJump', { cover: true }], ['jump']]);
    });
    it('the article found slides in from the uncovered copy at once', () => {
      const { core, order } = coveredCore();
      startAidJump(core, '1AbCdEfG');
      order.length = 0;
      core.aidNavigation.jumpFromArticle.mock.calls[0][2]({ ok: true });
      expect(order).toEqual([['land', true], ['done', 'articleAidJump', { uncover: true }]]);
    });
    it('the article returned to after a miss is uncovered once its position is back', () => {
      const { core, order } = coveredCore();
      startAidJump(core, '1AbCdEfG');
      order.length = 0;
      core.aidNavigation.jumpFromArticle.mock.calls[0][2]({ ok: false, missed: true, returned: true });
      expect(order).toEqual([['land', false], ['done', 'articleAidJump', undefined]]);
    });
    it('a run that never started uncovers it', () => {
      const { core, order } = coveredCore(false);
      expect(startAidJump(core, '1AbCdEfG')).toBe(false);
      expect(order.at(-1)).toEqual(['done', 'articleAidJump', undefined]);
    });
  });
  // The list takes what the article takes, so both places behave the same.
  it('a link pasted over the list selects its article there, as its code does', () => {
    const core = coreWith();
    expect(startAidJump(core, 'https://www.ptt.cc/bbs/Test/M.1783270974.A.0CA.html')).toBe(true);
    expect(core.aidNavigation.selectArticle.mock.calls[0].slice(0, 2)).toEqual(['Test', '1gIeu-3A']);
    expect(core.deepLinkController.request).not.toHaveBeenCalled();
  });
  it('a link to another board pasted over the list takes the deep-link navigation', () => {
    const core = coreWith();
    startAidJump(core, 'https://www.ptt.cc/bbs/Gossiping/M.1783270974.A.0CA.html');
    expect(core.deepLinkController.request).toHaveBeenCalledWith({ board: 'Gossiping', aid: '1gIeu-3A' });
    expect(core.aidNavigation.selectArticle).not.toHaveBeenCalled();
  });
});
