# 搜尋彈窗（`article_search.js`）

## Article shortcut searches

The mobile article drawer can search the whole current board for the article's
author or thread without an editable dialog. `article_shortcut_search.js` owns identity
capture, the serialized search and its return route. It reuses the native `a`
search semantics, including case-insensitive substring author matching.

Capture the source reading bookmark before entering native mode. Reuse
`AidNavigation.resolvePostAid` and its `boxOpen` metadata; only a Q response needs
the information box dismissed. `AidNavigation.selectArticle(board, aid, onEnd)`
then selects that identity in the full board list without opening it, leaving
any previous subset before searching. The author query is sent only after the
actual native author prompt is recognized.

Same-thread search uses native uppercase `S` after selecting the source AID in
the full board list. Unlike slash keyword search, this needs no prompt and uses
PTT's `subject` semantics. Verified upstream `read.c` (`read_cmd_search_title`,
`ask_filter_predicate`) supplies the selected header's normalized subject;
`common/bbs/search.c` compares subjects case-insensitively. No client-side title
normalization or whole-title keyword approximation is used. The completed drawer
orders these five equal-height actions: same-thread search, previous, first,
next, then same-author search. Coverage is in
`mobile_article_thread_search.offline.spec.js`.

Back from a result article first returns natively to its results. Back from that
matching result list reopens the source by AID and restores its reading bookmark.
Searching again from a result article extends a bounded search return history
(`search_return_history.js`): at most eight lightweight origins (board, AID,
author/title, query kind/value and a sanitized reading bookmark), oldest evicted
first. Rebuilding a query resets PTT's cursor to the newest result, so the route
never reopens an article inside reconstructed results. Instead, a reopened source
stays in the full board list; its next Back resubmits the parent query (native
`S` after selecting the parent's AID, or the author prompt), and the Back after
that reopens the parent by AID. Mixed author/thread chains therefore unwind
article -> results -> source at each level.

A deleted source stops on the verified full board list with an explanation and
consumes only its own origin; Back from that list continues with the parent's
results. Other failures keep origins only when they stop on the verified full
board list, and a failed forward search adds none. Another search (key or search
sheet submission), a user board change or the main menu clears the route; a
matching board name never reattaches it. Leaving a reopened source for
another article also ends its claim on Back. Missing identities never fall back to
an article number. Empty searches restore the source with a notice; unknown
screens stop visibly without blind retries. Real-app controlled-response coverage
lives in `mobile_article_shortcut_search.offline.spec.js` and
`mobile_article_nested_search.offline.spec.js` (native list and easy-reading list
cards); exact bound and transition rules in `tests/unit/search_return_history.test.js`.

While the easy-reading list shows cards, Back judges results versus the full list
from the list session's own board and numbering space: its background fill keeps
rewriting the terminal behind the cards (blank footers after number jumps, rows
not yet decoded), so reading the raw screen at that moment sent Back natively.

### Recovery after disconnection, reload or reopen

The route recovers only through reconnect resume (`reconnect_resume.js`), never by
board name. When the connection closes after login, `capture` hands the route its
resume plan (`suspendForRecovery`); when the page is hidden or closed,
`saveSnapshot` stores it beside the resume snapshot under the separate local key
`pttchrome.searchReturn.v1` (`persistForRecovery`), outside the preference
document, so it is never synchronized or exported. Startup reads it once and
deletes it; records older than twelve hours (the open-resume limit) or damaged
are dropped silently. A suspended route ignores every screen until that plan's
own `startResume` transaction ends, so login, the main menu and board entry are
not board switches.

The route reactivates only when the resume succeeded on exactly its stored
target (`search_return_history.recovered`):

- article target: the same verified AID with the same author and title. A
  result article or reopened source becomes a reopened member of the newest
  origin's results, so Back rebuilds them and the next Back reopens the origin
  at its reading position. Articles reopened by AID (resume or search return)
  are now remembered by `aidNavigation.currentPostAid`, so a later interruption
  resumes the article itself rather than its board.
- list target (results, URL-less result articles, fallbacks): the full board list
  of the route's board, treated as a fallback whose Back rebuilds the results.

Anything else (no plan, superseded or canceled resume, the reader moving first,
a deleted article, another screen) leaves the route inactive with the notice
`articleShortcutSearch_recoveryInactive` and no retry; logout clears it silently.
Origins that disappear later follow the ordinary deleted-source fallback.
Coverage: `mobile_article_search_recovery.offline.spec.js` (real socket close and
reconnect, real reload with the stored state), `search_return_history.test.js`
(expiry, validation) and `search_return_storage.test.js` (local-only storage).
After a reload the browser's own Back can traverse an older back-guard entry, so
the reload cases use the keyboard Back; installed Android close/reopen remains
device acceptance.

動 `article_search.js`、`search_history.js`、`SearchModal.jsx`、term_view 的搜尋鍵攔截前先讀。

## 為什麼

- pttbbs 輸入記憶＝**整個登入 session 一份**：`mbbsd/vtuikit.c` `static InputHistory ih`（508 bytes、≥2 bytes 才存、只有 `VGET_NOECHO` 不存；`vgetstring` 結尾 `InputHistoryAdd`）。所有 `getdata`／`namecomplete` 共用。CONFIRMED。
- 跳號 prompt ` 跳至第幾項: `（`stuff.c#search_num`，NUMECHO＝`VGET_DIGITS`）只關掉**該 prompt 內**的 ↑↓，照樣存檔 ⇒ 列表好讀／看板列表送的 `N\r`（`list_session.js` 的 sync／fetch／open／anchor jump、`board_list_session.js` 同類）把真正的關鍵字擠出 508 bytes。client 端無法關閉 ⇒ 改由 client 記關鍵字。

## 攔截決策

| 入口 | 位置 | 條件 |
|---|---|---|
| 鍵盤 | `term_view.onKeyDown`，長推文攔截之後、easyReading／keyOwner 之前 | `tryOpenSearchModal` 回 true 才 `preventDefault` |
| IME／Android 軟鍵盤 | `term_view.onTextInput`（非貼上、單一字元） | 同上 |
| 手機工具列「搜尋」 | `MobileToolbar` → ContextMenu `openSearch(context.search[0])`，**直接開彈窗、無子選單**（使用者定案：種類在彈窗上方切）。手機上 `SearchModal` 外殼換成 bottom sheet（`mobile` prop → `components/MobileSheet`，表單相同；系統返回＝收起） | 不看 pref |

`shouldInterceptSearchKey`：key ∈ `/ ? a Z s`、無 Ctrl/Alt/Meta、pref `searchKeyOpensModal`（預設 true，**會同步**）、`availableSearchKinds(facts)` 含該種類。
`availableSearchKinds`（工具列共用）：游標在輸入欄（`buf.isCursorOnInputField`）⇒ 無；文章列表（`listRenderOwner==='article-list'` 或 `boardListContextKind==='article-list'`）⇒ title/author/push/board；看板列表、主功能表 ⇒ board；其他 ⇒ 無。
- 看板列表的 `/` 是「看板中文關鍵字」（`board.c:2063`），**不攔**。
- `s`＝board，只在可用種類含 board 的畫面攔（文章列表／看板列表／主功能表）；看板列表的 `a`／`Z` 不攔。小寫 `z` 是精華區（`bbs.c:4406`），不是推文數。
- e2e 的 `helpers/ptt.js#gotoBoard` 兩條路都吃（彈窗出現就填彈窗並等 `searchInFlight` 收尾，否則原生 prompt）。
- 主功能表只有 MMENU/TMENU/XMENU 的 `s` 是選擇看板（`menu.c#menu_on_key`）；目前只認 `主功能表` 標題。

## prompt 指紋（`isSearchPromptFrame`，出處 `read.c#ask_filter_predicate`）

| 種類 | 鍵 | 列 | 前綴 |
|---|---|---|---|
| title | `/` | b_lines | `搜尋標題: `／`增加條件 標題: `（MODE_SELECT） |
| author | `a` | b_lines | `搜尋作者: `／`增加條件 作者: ` |
| push | `Z` | b_lines | `搜尋推文數高於多少`（CONFIG_OLD_RECOMMEND 少了「 (<0則搜噓文數) 」）／`增加條件 推文數: `；LCECHO 欄寬 7，`atoi==0` 當取消 |
| board | `s` | 1（兩段式，row0 是反白標題） | `請輸入看板名稱(按空白鍵自動搜尋)`（`common.h` MSG_SELECT_BOARD；看板列表 `board_cmd_search_global` 同字串）；`VGET_ASCII_ONLY` |

收尾：Enter 送出；取消＝Ctrl-C 或空字串（`vtuikit.c` 只認這兩個，**ESC 不是取消鍵**：KEY_ESC 非可列印 ⇒ bell）。

## 送出（`submitSearch`）

兩步，第二步只在第一步 `expect`（prompt 幀）成立後才排；prompt 沒出現 ⇒ `onFail`，關鍵字**絕不送**（字母會落回列表按鍵）。
- `activeListSession()` 有值 ⇒ `session._beginPassthroughBytes(steps, {kind:'search', resumeOnLanding:true})`（列表好讀：凍結交易＋cursor sync 腿，結果列表一落地就回好讀，找不到的 vmsg／進板畫面認不出 ⇒ 停原生鏡像交給探針，見 `docs/easy-reading-list.md`「落地即回好讀」；看板列表 session 2026-10 起也收陣列，kind 自動帶 `brd-` 前綴＝佇列所有權）。第二步的落地＝prompt 消失（打字回顯那一幀 prompt 還在，不算），預算 `aid_navigation.SLOW_STEP_BUDGET`（要等 server 的搜尋服務／進板）。session `opening`／`functionMode+frozen` ⇒ 回 false，呼叫端提示。
- 否則直接 `commandQueue.enqueue`（`list_session._onScreenSettled` 驅動 onSettle）。
- 關鍵字 `ansiHalfColorConv(u2b(text))`（queue 綁 raw `conn.send`）。
- **在途閘門 `core.searchInFlight`**（`serialized_op_gate` 讀，期間吞鍵＋提示「搜尋中」）：少了它，搜尋鍵已上線、prompt 未到時按的 Enter 會把空 prompt 送出（＝取消），關鍵字落到列表變指令（live 錄製檔實證）。解除＝第二步 onDone／任一步 onFail／onFlushed（兩個 session 的 `_enqueuePassthroughStep` 都轉送 `onFlushed`）＋保底 `SEARCH_INFLIGHT_MAX_MS`。e2e 等搜尋完成一律等它（`core.spec.js#gotoLatestThread`），不可只看「列表＋游標不在輸入欄」。
- **閱讀紀錄**：送出前領書籤（決策表 `article-search`；看板 `s` 走這條時是 `board-search`），prompt 沒開出來＝`fail`、第二步 onDone＝`done`。找不到符合條件時 PTT `vmsg` 後 `READ_REDRAW` 回原列表 ⇒ 列表好讀回原處；有結果時落在搜尋結果（MODE_SELECT），列表端比對編號空間不符自動丟棄。見 `docs/reading-record.md`。
- 錄製工具（`record-cassette`／`record-scenarios` 的 aid-back-search）與重放原生 `/` 的 offline spec 明設 `searchKeyOpensModal:false`：卷裡錄的是原生 prompt 逐字打。

## 看板：原生補全橋接（`board_search_bridge.js`）

比照 PTT 原生的看板名稱補全（`mbbsd/name.c#generalnamecomplete`，`CompleteBoard` 巨集）：
- 逐字：`gnc_cb_data` 用 `SHM->bsorted` 二分搜「有沒有**看得到的**看板以這串開頭」（`completeboard_permission`：非 symbolic、非群組、有權限），沒有就 bell＋丟字。
- 空白鍵：輸入延伸到所有符合者的共同前綴（唯一就補完整名），第 2 列畫「相關資訊一覽表」、第 3 列起逐欄列出；還有下一頁時底列「按空白鍵可列出更多項目」。欄寬＝輸入欄長＋2（`do_select` 22、看板列表 `s` 15），解析不寫死欄寬，依起始欄再依列排序。
- Enter：唯一符合或完全相符才進板，否則字串清空（什麼都不做）。

看板清單只在 server（含權限，因人而異），client 沒有可信的離線來源 ⇒ **彈窗切到看板種類就在背景開原生 `s` prompt**（`submitSearch` 同一條路：有列表 session 走它的 passthrough，否則直接排佇列），之後每次輸入排一趟 `退格×輸入欄長 ＋ 字 ＋ 空白 ＋ \f`（`\f` 必要：被拒的字 PTT 只回 bell 不重畫），讀回輸入欄與清單。一次只一趟在飛、最新輸入勝出（不必 debounce）；退格數在 `onSend` 當下量畫面（量不到才用上一幀記的）。

| 結論 | 判準 | 彈窗 |
|---|---|---|
| 被拒 | 輸入欄與查詢字串（大小寫不分）的共同前綴 < 查詢長度 | 退回到收得下的前綴＋紅字「沒有以「…」開頭的看板」 |
| 收下 | 清單每一項都以輸入欄開頭（排掉還掛著上一趟清單的中間幀） | 列出可點的看板；空白鍵＝補成輸入欄（延伸後）；多個符合時 Enter／搜尋鈕停用 |
| unknown | 逾時且當下畫面判不出（server 沒回） | 不擋送出、不顯示「查詢中」 |

逾時後回頭量畫面時**只收「整串被收下」的幀**：沒回應時畫面停在上一趟（輸入欄較短），會被誤讀成被拒而把使用者的字砍掉。

收尾都在**同一個** prompt 上、都握 `searchInFlight` 直到 prompt 消失：送出＝`退格＋板名＋\r`（不加 `\f`，同 `submitSearch` 第二步）；取消（Esc／切種類／關彈窗）＝`Ctrl-C`＋`\f`（ESC 不是 vgetstring 的取消鍵）。prompt 還沒開出來就送出／取消 ⇒ 排在開啟之後。prompt 開不出來 ⇒ `unavailable`，送出改走 `submitSearch`；開出來後被別的擁有者 `flush`（離板、開文）⇒ 不再送任何鍵。

### 彈窗版面

打字時彈窗高度不可跟著補全結果變（手機 sheet 貼底、桌機彈窗，高度一變輸入框就被推動 ⇒ 邊打邊抖）：
- 補全區固定高度（`SearchModal.css`）：狀態列恆佔一行（單行省略）、清單框恆定高度內捲（桌機 160px、手機 112px，留給軟鍵盤）、「只列出前一部分」放在框內。
- 查詢在飛時先顯示上一份收下的清單本地篩選的結果（`interimCandidates`，淡化），不先清空再長回來；以 q 開頭的板必以 q 的前綴開頭，篩下來不會多出錯的板，只是可能少列（上一份被截斷時），不拿來判送出。
- 桌機 Modal 貼頂（`yOffset`）不置中：切種類、刪記憶這類高度變化時輸入框也不動。

守護 `search_modal.test.jsx`「看板補全區高度固定」（真 Chromium 量表單高度，桌機／手機各一）。

## 記憶（`search_history.js`）

localStorage `pttchrome.searchHistory.v1` = `{title,author,push,board}`，各 MRU 去重、上限 20。**不在 `pttchrome.pref.v1`** ⇒ 不同步、不進匯出（使用者要求）。彈窗內 ↑ 從最新開始、↓ 回草稿；下方列最近 6 筆可點（手機沒有方向鍵）。刪除：每筆旁 ×（`forgetSearch`）；「全部清除」（`forgetSearchKind`）**只清目前這一類**，其他種類不動。刪除後 ↑ 游標歸零。

## 測試

unit：`article_search.test.js`（判準／指紋／兩條送出路徑／看板列表 session 多步）、`board_search_bridge.test.js`（畫面解析／鍵序／被拒／最新勝出／逾時／收尾閘門）、`search_history.test.js`、`search_modal.test.jsx`（看板補全用假橋接）、`search_key_intercept.test.js`。offline e2e：`article_search.offline.spec.js`（線上 bytes＝`/\f` → prompt 幀 → `關鍵字\r`、↑ 叫回、Esc 零 byte、pref 關＝原生、已有 prompt 時不攔；看板補全用頁內照 `name.c` 寫的迷你 namecomplete 模擬）；`board_note_skip.offline.spec.js` 的主選單 `s` 卷含一趟合成的補全回應；手機入口在 `mobile_toolbar.offline.spec.js`。
