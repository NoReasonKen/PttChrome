import { describe, it, expect, vi } from 'vitest';
vi.mock('../../src/js/i18n', () => ({ i18n: (key) => key + ' {0}' }));

import { AID_INPUT_MAX_LENGTH } from '../../src/js/aid_codec';
import { parseAidJumpInput, requestAidJump, startAidJump } from '../../src/js/aid_jump';

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
