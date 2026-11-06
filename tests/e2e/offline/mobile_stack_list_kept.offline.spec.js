// Back to an article list keeps it as the reader left it (#120). While the
// reader is in an article, PTT's list changes: scores, read marks, a title and
// new articles. Back reveals the list's live layer, and the real list that
// takes over carries the layer's rows: only the article just read reads as
// read. Rows the reader scrolls to later, and a refresh, show PTT's list now.
const { test, expect } = require('@playwright/test');
const ptt = require('../helpers/ptt');
const { bootThreadBoard, listActive } = require('../helpers/thread_jump');
const { recordHints, recordedHints } = require('../helpers/stack_routes');
const { revealArticleDrawer } = require('../helpers/article_gestures');

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

// A refresh of the article read reopens it through the board's list on PTT
// (`s<board>`, `#AID`, Enter); the list left is still the one Back shows (#127).
test('Back after a refresh of the article read shows the list as it was left', async ({ page }) => {
  const before = await readReply(page);
  await ptt.applyPrefs(page, { refreshMinIntervalSec: 0 });
  const from = await page.evaluate(() => window.__threadSent.length);
  await page.locator('#mobileToolbar [data-key="__refresh"]').tap();
  await expect.poll(() => page.evaluate(from => window.__threadSent.slice(from).join(''), from)).toMatch(/#[\w-]{8}\r/);
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.aidNavigation.active &&
    window.__threadServer.state.surface)).toBe('article');
  await expect.poll(() => page.locator(MAIN).first().innerText()).toContain(`Body of article ${OPEN} by`);
  await back(page);
  expect(await cards(page)).toEqual(asLeft(before.cards));
  expect(await topEntry(page)).toEqual(before.top);
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
  // `b`, a key the list sends PTT as it is; the controlled PTT redraws the list.
  await ptt.sendKey(page, 'b');
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

// PTT's answer to Back already lists the page around the article read; when
// it lists articles newer than the newest the list holds, a brief notice says
// so (#128), without asking PTT for anything more.
const NEW_ARTICLES = 'New articles';

// Opens hana's reply again from the list shown after Back.
async function openAgain(page) {
  await page.locator(`${MAIN} .listCard`).filter({ has: page.locator('.listCardNum', { hasText: new RegExp(`^${OPEN}$`) }) }).tap();
  await expect.poll(() => page.locator(MAIN).first().innerText()).toContain(`Body of article ${OPEN} by`);
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
}

// Back, then what was sent to PTT once it rests.
async function sentOnBack(page) {
  const from = await page.evaluate(() => window.__threadSent.length);
  await back(page);
  await page.waitForTimeout(500); // sleep-ok: anything sent after Back has been sent by now
  await listActive(page);
  return page.evaluate(from => window.__threadSent.slice(from), from);
}

// More articles posted on PTT from `from` to `to`.
const postArticles = (page, from, to) => page.evaluate(({ from, to }) => {
  const { articles } = window.__threadServer;
  for (let num = from; num <= to; num++) articles.push({ num, author: 'newbie', title: '[Talk] New ' + num, date: '12/01' });
}, { from, to });

test('a landing page listing newer articles shows a brief notice once, and nothing more is sent to PTT', async ({ page }) => {
  await bootThreadBoard(page, { open: OPEN, size: 1190, fromList: true, thread: THREAD });
  await recordHints(page);
  // Nothing changed on PTT: no notice.
  const quiet = await sentOnBack(page);
  expect(await recordedHints(page)).not.toContain(NEW_ARTICLES);
  await openAgain(page);
  await postArticles(page, 1191, 1195);
  expect(await sentOnBack(page)).toEqual(quiet);
  await expect(page.locator('.ListHint')).toHaveText(NEW_ARTICLES);
  expect((await recordedHints(page)).filter(text => text === NEW_ARTICLES)).toHaveLength(1);
  // The list still holds what it showed; more new articles say nothing again.
  expect((await cards(page)).some(c => c.num === '1191')).toBe(false);
  await openAgain(page);
  await postArticles(page, 1196, 1198);
  await sentOnBack(page);
  expect((await recordedHints(page)).filter(text => text === NEW_ARTICLES)).toHaveLength(1);
});

test('search results shown again from their layer show no new-articles notice', async ({ page }) => {
  const thread = [
    { num: 1100, author: 'dave', title: 'Re: ' + SUBJECT, date: '11/28' },
    { num: 1120, author: 'dave', title: 'Re: ' + SUBJECT, date: '11/29' },
    { num: 1150, author: 'dave', title: 'Re: ' + SUBJECT, date: '11/30' }
  ];
  // Under the legacy caption, as an ordinary list can show: only the verified
  // search tells the results apart.
  await bootThreadBoard(page, { open: 1100, fromList: true, legacy: true, thread });
  // dave's author results, from the article opened.
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="author"]').tap();
  await expect.poll(() => page.evaluate(() => window.__threadServer.state.byAuthor)).toBe('dave');
  await listActive(page);
  await page.locator(`${MAIN} .listCard[data-list-author="dave"]`).nth(1).tap();
  await expect.poll(() => page.locator(MAIN).first().innerText()).toContain('Body of article 1120 by');
  await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle)).toBe(true);
  await recordHints(page);
  // dave posts again: PTT's results list more than the results shown.
  await page.evaluate(() => window.__threadServer.articles.push({ num: 1201, author: 'dave', title: '[Talk] Later', date: '12/01' }));
  await back(page);
  await expect.poll(() => page.evaluate(() => window.__threadServer.state)).toMatchObject({ byAuthor: 'dave', surface: 'list' });
  await page.waitForTimeout(500); // sleep-ok: proves no notice follows the swap
  expect(await recordedHints(page)).not.toContain(NEW_ARTICLES);
});

// A search from the article read gives up the list's own rows; the list
// rebuilt on Back still tells of articles newer than its layer showed.
test('Back to the list through a search from the article read shows the new-articles notice', async ({ page }) => {
  await bootThreadBoard(page, { open: OPEN, size: 1190, fromList: true, thread: THREAD });
  await recordHints(page);
  // hana's author results, from the article opened.
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="author"]').tap();
  await expect.poll(() => page.evaluate(() => window.__threadServer.state.byAuthor)).toBe('hana');
  await listActive(page);
  await postArticles(page, 1191, 1195);
  // Back to the article the search started from, then Back to the list.
  for (const surface of ['article', 'list']) {
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.articleGestures.stack.handingOff &&
      window.__threadServer.state.surface)).toBe(surface);
  }
  await listActive(page);
  await expect.poll(() => recordedHints(page)).toContain(NEW_ARTICLES);
});

// The same route keeps the list's own rows too (#127): the search results
// reuse the list session and replace its rows and board, and the list Back
// shows again is the one its layer kept.
test('Back to the list through a search from the article read shows the list as it was left', async ({ page }) => {
  const before = await readReply(page);
  await revealArticleDrawer(page);
  await page.locator('[data-article-shortcut="author"]').tap();
  await expect.poll(() => page.evaluate(() => window.__threadServer.state.byAuthor)).toBe('hana');
  await listActive(page);
  for (const surface of ['article', 'list']) {
    await page.goBack();
    await expect.poll(() => page.evaluate(() => window.__app.commandQueue.idle && !window.__app.articleGestures.stack.handingOff &&
      window.__threadServer.state.surface)).toBe(surface);
  }
  await listActive(page);
  expect(await cards(page)).toEqual(asLeft(before.cards));
  expect(await topEntry(page)).toEqual(before.top);
});
