// Back to an article list keeps it as the reader left it (#120). While the
// reader is in an article, PTT's list changes: scores, read marks, a title and
// new articles. Back reveals the list's live layer, and the real list that
// takes over carries the layer's rows: only the article just read reads as
// read. Rows the reader scrolls to later, and a refresh, show PTT's list now.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootThreadBoard, listActive } = require('../helpers/thread_jump');

const MAIN = '.main:not([data-stack-layer])';
const UNDERLAY = '[data-article-exit-underlay]';
const SUBJECT = '[Talk] Kept topic';
const OPEN = 1185;

// A thread on the page of the article read: its first article 1182 by gina,
// and hana's reply 1185, which ends with its AID line and 12 pushes, as many
// as its list score.
const THREAD = [
  { num: 1182, author: 'gina', title: SUBJECT, date: '11/27', score: 3 },
  {
    num: OPEN, author: 'hana', title: 'Re: ' + SUBJECT, date: '11/28', score: 12, url: true,
    comments: Array.from({ length: 12 }, (_, i) => `推 fan${i}: nice`)
  }
];

// Every card of the list in `root`, in order.
const cards = (page, root = MAIN) => page.locator(root).evaluate(el => [...el.querySelectorAll('.listCard')].map(card => {
  const text = cls => card.querySelector('.' + cls)?.textContent ?? '';
  return {
    num: text('listCardNum'), author: text('listCardAuthor'), title: text('listCardTitleText'),
    push: text('listCardPush'), mark: text('listCardMark'), date: text('listCardDate'),
    selected: card.querySelector('.listCardTitle .listCardCursor')?.textContent === '>',
    badge: card.querySelector('.listNewPush')?.dataset.newPush ?? null
  };
}));

// The card at the top of the list's view and its offset from that top.
const topEntry = page => page.locator(`${MAIN} .listBodyView`).evaluate(el => {
  const top = el.getBoundingClientRect().top;
  const card = [...el.querySelectorAll('.listCard')].find(c => c.getBoundingClientRect().bottom > top + 1);
  return { num: card.querySelector('.listCardNum').textContent, offset: Math.round(card.getBoundingClientRect().top - top) };
});

const titleColor = (page, num) => page.locator(MAIN).evaluate((el, num) => {
  const card = [...el.querySelectorAll('.listCard')].find(c => c.querySelector('.listCardNum')?.textContent === num);
  return getComputedStyle(card.querySelector('.listCardTitleText [class^="q"]')).color;
}, String(num));

// hana's reply was read to its 4th push before, with the score 4 then: the
// list shows 8 new recommendations on it.
async function rememberEarlierRead(page) {
  await page.evaluate(async ({ num, title }) => {
    const { saveSeen } = await import('/src/js/new_comments.js');
    const { subjectKey } = await import('/src/js/long_push_anchor.js');
    const server = window.__threadServer;
    const aid = server.aidOf(server.articles[num - 1]);
    saveSeen(localStorage, 'test/' + aid, 4, Date.now(), null, { score: 4, author: 'hana', subject: subjectKey(title) });
    // Storage is fixture setup; render the list again without a server edit.
    window.__app.view.redraw(true);
  }, { num: OPEN, title: 'Re: ' + SUBJECT });
}

// While the reader is in the article, PTT's list changes: three more pushes
// on hana's reply, a score on every other article, another reader's view of
// what is read, an edited title and five new articles.
async function changeListOnPtt(page) {
  await page.evaluate(open => {
    const { articles } = window.__threadServer;
    for (const article of articles) if (article.num !== open) article.score = 20;
    articles[open - 1].score = 15;
    articles[1181 - 1].mark = 'M';
    articles[1184 - 1].title = '[Talk] Edited title';
    for (let num = articles.length + 1; num <= 1195; num++) {
      articles.push({ num, author: 'newbie', title: '[Talk] New ' + num, date: '12/01' });
    }
  }, OPEN);
}

// Opens hana's reply from the list, after reading the list as it was then.
async function readReply(page) {
  let before = null;
  await bootThreadBoard(page, {
    open: OPEN, size: 1190, fromList: true, thread: THREAD,
    beforeOpen: async page => {
      await rememberEarlierRead(page);
      await expect.poll(async () => (await cards(page)).find(c => c.num === String(OPEN))?.badge).toBe('+8');
      before = { cards: await cards(page), top: await topEntry(page), color: await titleColor(page, 1182) };
    }
  });
  await changeListOnPtt(page);
  return before;
}

async function back(page) {
  await ptt.sendKey(page, 'ArrowLeft');
  await expect(page.locator(UNDERLAY)).toHaveCount(0, { timeout: 10000 });
  await listActive(page);
  await expect.poll(() => page.evaluate(() => window.__app.articleGestures.stack.handingOff)).toBe(false);
}

// The list as it was, with the article just read now read: no unread mark,
// and no new recommendations since it was read to its end.
const asLeft = cardsBefore => cardsBefore.map(card => card.num === String(OPEN) ? { ...card, mark: '', badge: null } : card);

test('Back shows every row, the selection and the reading position as they were, with the article just read read', async ({ page }) => {
  const before = await readReply(page);
  expect(before.cards.find(c => c.num === String(OPEN))).toMatchObject({ mark: '+', push: '12', selected: true });
  await back(page);
  expect(await cards(page)).toEqual(asLeft(before.cards));
  expect(await topEntry(page)).toEqual(before.top);
  // PTT colours the read article's subject: gina's first article now has it.
  expect(await titleColor(page, 1182)).not.toBe(before.color);
});

test('rows loaded after Back show PTT\'s list now, and the rows kept stay as they were', async ({ page }) => {
  const before = await readReply(page);
  await back(page);
  const kept = new Set(before.cards.map(c => c.num));
  const loaded = async () => (await cards(page)).filter(c => !kept.has(c.num));
  for (let i = 0; i < 20 && !(await loaded()).length; i++) {
    await ptt.sendKey(page, 'PageUp');
    await listActive(page);
  }
  const fresh = await loaded();
  expect(fresh.length).toBeGreaterThan(0);
  for (const card of fresh) expect(Number(card.num)).toBeLessThan(Math.min(...[...kept].map(Number)));
  for (const card of fresh) expect(card.push).toBe('20');
  const now = await cards(page);
  const expected = asLeft(before.cards);
  for (const card of expected) {
    expect(now.find(c => c.num === card.num)).toEqual({ ...card, selected: expect.any(Boolean) });
  }
});

test('a refresh after Back shows PTT\'s list now', async ({ page }) => {
  await readReply(page);
  await back(page);
  await ptt.applyPrefs(page, { refreshMinIntervalSec: 0 });
  await page.locator('#mobileToolbar [data-key="__refresh"]').tap();
  await expect.poll(async () => (await cards(page)).find(c => c.num === String(OPEN))?.push).toBe('15');
  await listActive(page);
  const now = await cards(page);
  expect(now.find(c => c.num === '1184')).toMatchObject({ title: '□ [Talk] Edited title' });
  expect(now.find(c => c.num === '1181')).toMatchObject({ mark: 'M', push: '20' });
  expect(now.some(c => c.num === '1195')).toBe(true);
});

test('opening a kept row whose article PTT lists differently now stays on the list and says so', async ({ page }) => {
  await readReply(page);
  await back(page);
  await page.locator(`${MAIN} .listCard`).filter({ has: page.locator('.listCardNum', { hasText: /^1184$/ }) }).tap();
  await expect(page.locator('.ListHint')).toContainText('這個位置已經不是剛剛點的文章');
  await listActive(page);
  expect(await page.evaluate(() => window.__threadServer.state.surface)).toBe('list');
  expect((await cards(page)).find(c => c.num === '1184')).toMatchObject({ title: '□ [Talk] Edited title' });
});

// Which actions spend the live layer the list was shown from (#125): asking
// PTT for the list anew does, and its rows then show PTT's list now; using
// the list as it is does not.
const shownNow = async (page, num) => (await cards(page)).find(c => c.num === String(num));

test('a number jump beyond the rows loaded shows PTT\'s list now', async ({ page }) => {
  await readReply(page);
  await back(page);
  await ptt.sendKey(page, '1');
  await page.locator('[data-list-input]').fill('100');
  await page.locator('[data-list-input]').press('Enter');
  await expect.poll(async () => (await shownNow(page, 100))?.push).toBe('20');
  await listActive(page);
  expect(await shownNow(page, 100)).toMatchObject({ selected: true });
});

test('a key sent in native mode shows PTT\'s list now once the list takes over again', async ({ page }) => {
  await readReply(page);
  await back(page);
  // `Z`, a key the list sends PTT as it is; the controlled PTT redraws the list.
  await ptt.sendKey(page, 'Z');
  await expect.poll(async () => (await shownNow(page, 1181))?.mark, { timeout: 15000 }).toBe('M');
  await listActive(page);
  expect(await shownNow(page, 1181)).toMatchObject({ push: '20' });
});

test('tagging keeps the rows as they were, except the row tagged', async ({ page }) => {
  const before = await readReply(page);
  await back(page);
  await ptt.sendKey(page, 't');
  await expect.poll(async () => (await shownNow(page, OPEN))?.mark).toBe('D');
  await listActive(page);
  const now = await cards(page);
  // The tagged row is PTT's now; its score came with it.
  expect(now.find(c => c.num === String(OPEN))).toMatchObject({ push: '15' });
  for (const card of asLeft(before.cards).filter(c => c.num !== String(OPEN))) {
    expect(now.find(c => c.num === card.num)).toEqual({ ...card, selected: expect.any(Boolean) });
  }
});

test('opening another article from the list and coming back keeps the rows as they were', async ({ page }) => {
  const before = await readReply(page);
  await back(page);
  await page.locator(`${MAIN} .listCard`).filter({ has: page.locator('.listCardNum', { hasText: /^1182$/ }) }).tap();
  await expect.poll(() => page.locator('.main').first().innerText()).toContain('Body of article 1182 by');
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
  await back(page);
  const now = await cards(page);
  for (const card of asLeft(before.cards).filter(c => !['1182', String(OPEN)].includes(c.num))) {
    expect(now.find(c => c.num === card.num)).toEqual({ ...card, selected: expect.any(Boolean) });
  }
  expect(await shownNow(page, 1182)).toMatchObject({ push: '3', selected: true });
});
