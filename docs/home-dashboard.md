# 首頁儀表板（`home_dashboard.js`）

動 `home_dashboard.js`、`components/HomeDashboard` 前先讀。

## 是什麼

主功能表（`【主功能表】`）上蓋一層面板：我的最愛的看板卡片（有新文章的標「有新文章」）、最近去過的看板、新信提示（`你有新信件`）。點卡片進看板。沒有自己的開關：好讀開著就出現，關著一律原生主功能表；好讀開關是唯一回到原生主功能表的方法，在首頁切換時面板立刻跟著收起／出現（`evaluateNow`）。

## 規則

- **不讓使用者盲操作背後的原生主功能表（#191）**：焦點留在 `#t`，但好讀開著、面板畫在主功能表上時，鍵與字只放行好讀有呈現的入口：
  - `h`、`H`、`?`（主功能表的說明鍵，底列只寫 `(h)說明`）：照送 PTT，同時 `helpMenu.expect(this)`；說明頁讀完後彈窗在背後送 `q` 與 PTT 分離（#222，`docs/help-menu.md`），彈窗裡只有首頁收的鍵可點（`wouldRefuse`：`s`／`S` 看板搜尋，其餘列變暗），點了就經 `sendKeyAsUser` 交給 `takeKey`；說明選單整趟（hold 期間）面板留在 sheet 底下，`_onSettled` 看到說明畫面也不收（每 `HOME_TRANSIT_RECHECK_MS` 重看一次，hold 一解除——關掉回主功能表、交給原生、等不到說明選單——就照常判定）。抓我的最愛途中的 `h` 擋下。
  - `s`、`S`（PTT 的「選擇看板」）：開看板搜尋 sheet，鍵被吞掉、不提示（PTT 收到的是搜尋自己送的 `s`，不是 `S`）（`s` 由 `term_view.onKeyDown` 的 `tryOpenSearchModal` 在面板判定之前接走；`S` 由 `takeKey` 以同一個入口開）。sheet 開不了或正在抓我的最愛時擋下。
  - app 自己的快捷鍵（F 鍵：返回原文、複製連結、跳未讀、指令面板；F5／⌘R 重新整理）、瀏覽器組合鍵（Ctrl+C／A／V、⌘ 組合、Alt 組合）、送不出 byte 的鍵（修飾鍵、CapsLock）：不是指令，照舊。
  - 面板上的按鈕（卡片、更新、新信）：直接呼叫入口，不經鍵盤。
  - 其餘一律擋下、什麼都不送，給與文章／列表相同的「好讀模式目前不支援…」錯誤提示（`unsupported_hint.js`）：PTT 說明畫面列的其他指令（進入看板 `r`／`R`、未讀文章 Ctrl-Y／Ctrl-N、Ctrl-Z／Ctrl-U／Ctrl-R）、移動選單游標的鍵（方向鍵、Enter、`e`／`E`／`q`／`Q`、Home／End／PgUp／PgDn、選單項目字母）、數字、其他 Ctrl 組合、Alt remap、手機工具列／鍵盤列的鍵（`sendKeyAsUser` 走同一條分派）。輸入法或軟鍵盤上的單一 ASCII 字元當成它代表的鍵（`term_view.onTextInput`），其餘上字與貼上擋下（「…在首頁輸入文字／貼上文字」）。
  - 分類是純函式 `homeKeyAction`（同 `easy_reading.articleLeftoverKey` 的形狀），`takeKey`／`refuseText` 由 `term_view` 呼叫。說明選單開著（phase 不是 idle 或 hold 中）時鍵歸說明選單。好讀關著＝原生主功能表，所有鍵照送。
- **認不出 ⇒ 原生**：只在「標題列是主功能表＋畫面上有 `(F)avorite` 選單項＋游標不在輸入欄」時出現（`isHomeScreen`）。
- **主功能表的第一幀就蓋著（#187，arrival hold）**：面板在 settle（最後一筆資料後約 50 ms）才判定，而終端機畫面是資料一到就畫。所以好讀開著、面板還沒出現時，只要一幀的標題列是主功能表（`_onFrame` 掛在 buffer 的 `change`，比畫面重畫早，只讀第 0 列），面板就握住畫面（`holding`，`term_view._navigationHeld` 的一員）：PTT 的幀不畫，上一個畫面（登入／歡迎畫面、原生子選單…）留著。settle 的判定（`_onSettled`，任何一條路徑）結束握住：是首頁 ⇒ 面板先出現（`flushSync` 同步畫），再放開，主功能表第一次畫出來就在面板底下；不是首頁（主功能表上有 prompt、路過（`_inTransit`）、說明選單、看板搜尋握住…）⇒ 放開，照舊畫出來。等不到 settle 時 `ARRIVAL_HOLD_MS` 自己放開。好讀關著、面板已經畫著（抓我的最愛途中、說明選單 hold）都不握。斷線重連／開站回到原處經過主功能表時由 `reconnect_resume.js` 自己的 hold 接手（#188，見 [reading-record.md](reading-record.md)「回到原處途中畫面不換」）：面板這裡只放開自己的。開站接回的倒數不算路過：倒數中面板照常出現在提示底下（只是不抓我的最愛，線路留給回到原處）；倒數完出發後，面板在回到原處握住的期間一直蓋著（同說明選單 hold），放開時 `recheck` 重新判定。
  - 握住期間游標底色也不能重畫畫面：`ScreenController` 套底色的慢路徑會用活的 buffer 整幅重畫，所以 `term_view.applyCursorHighlight` 在 `_heldFrame` 時不動，`term_buf.notify` 清滑鼠列也只清狀態（`clearHighlight({ paintLater: true })`），由接著的 redraw 套用。這兩條對所有 hold（說明選單、看板搜尋…）都成立。
- **看板搜尋握住面板（#190）**：搜尋彈窗的看板補全／打字送出看板握著 PTT 的 `s` prompt 期間（`core.boardSearchHold`），面板不因 prompt 幀收起，照原樣蓋在主功能表上；握住結束時由 `recheck()` 重看畫面（回到主功能表就留著，進了看板就收起）。規則見 [article-search.md](article-search.md)「prompt 是資料，不畫出來」。
- **抓我的最愛＝原生鍵**（`fetchFavorites`）：`Ctrl+Z f`（menu.c#ZA_Select 的「我的最愛」，任何畫面都能進根目錄、不動主功能表的游標）→ 讀頁 →（進來不在第 1 頁就跳 `1⏎`）→ 一頁滿 20 個就跳 `<最後一號+1>⏎`，被夾回同一頁＝沒有下一頁（stuff.c#search_num）→ 跳回進來時的游標 → `q`。最多 `FAV_MAX_PAGES` 頁。每一步落地不符就停手（`fail`），人留在 PTT 給的畫面上。
- **什麼時候抓**：面板出現後等 `AUTO_FETCH_DELAY_MS`，快取超過 `FAV_TTL_MS` 才抓；中間送出了 `h`、首頁上開著 sheet（`modalShown`，例：看板搜尋）、說明選單 hold 中、線路有別人的事（`serializedOpHint`、CommandQueue 不閒、deep link／斷線回到原處還在排程或倒數中）就不抓。失敗後 TTL 內不重試。
- **手動更新＝重新整理**：面板的「更新」、F5／⌘R、手機工具列「重整」、手機下拉，全部走 `screen_refresh` 的 `home` target（面板畫著才算；好讀關著的原生主功能表不接，F5 交還瀏覽器），同一道冷卻、同一套忙碌提示，最後落到 `fetchFavorites`。下拉在整片卡片按鈕上也能起手（`pull_refresh.ignoredTarget` 對 `#homeDashboard` 放行）；點一下不會走出 slop，拉過門檻也不會變成點卡片。
- **逛完看板回來的「有新文章」不重抓**（`newestArticleUnread`）：看板的未讀旗標是 `board.c#check_newpost` ＝ `brc_unread_time(lastposttime)`，`lastposttime` 是 `.DIR` 最後一筆（最新一篇、不含置底）的建立時間（`cache.c#setbtotal`）⇒ **只看最新一篇讀了沒**，與讀過其他哪幾篇無關。文章列表 settle 時，最新一篇看得出來（它下面接置底 ★ 或空白列）就讀 cell 8 的已讀標記（`bbs.c#readdoent`）：`+`／`M` 未讀；` `／`m`／`~`／`=`／`s`／`*` 已讀（`check_newpost` 傳 modified 0，有新推文不算）；`S`／`#`（分不出 1／2）、`!`／`D`（蓋掉未讀資訊）、刪除文、最新一篇剛好在條目區最後一列、搜尋結果／文摘 ⇒ 看不出來，不動。只在那個板是我的最愛時才讀滿整頁（每次 settle 都跑）。使用者自己開原生我的最愛時照抄那一頁的 ˇ（`withFavPageUnread`，只改已有的板）。兩者都寫回快取、一個 byte 都不送。
- **列的讀法**（`parseFavRow`，board.c#brdlist_renderer）：編號（`%6d`／舊版 `%7d`）→ 未讀「ˇ」→ 板名 → 類別 → `◎Σ☆` → 中文敘述 34 格。未讀看「編號與板名之間有沒有 ˇ」，不靠欄位位置。分隔線、目錄、禁入不收。按 `y` 列全部看板（variant `all`）不收；按 `c` 的新文章模式（row2「總數」）只收那一頁、不翻。
- **進看板**＝搜尋彈窗的「前往看板」同一條（`submitSearch(core, 'board', name)`，`s<板>⏎`，閱讀紀錄 `board-search`）。**開信箱**＝`Ctrl+Z m`。
  Known dashboard destinations opt into a single batch from the verified main
  menu: `s`, board name, Enter and backtick. A normal entry pause consumes the
  backtick; a list ignores it. Remaining notices use the existing skip owner.
  The queued search entry point and reading record stay shared; unsupported or
  busy contexts retain the prompt-verified route. See [board entry](board-note-skip.md).
- **手機**：標題「首頁」放在 App Bar（`MobileAppBar` 訂 `homeDashboard.onChange`，面板開著就把標題換成「首頁」）；面板自己不再畫那一行大標題，只有新信時留一行放「開信箱」。理由：App Bar 寫「主功能表」、底下又一行「首頁」，兩行標題吃掉一排卡片。桌機照舊。
- 閱讀紀錄：面板的捲動位置是 `home` 紀錄（`readingPosition`：面板頂端那張卡片＋離上緣幾 px，只存身分不存像素）。從面板出發的交易——點看板／最近看板（`board-search`）、抓最愛（`home-favorites`）、開信箱（`home-mail`）——不論結果都交回待還原錨，面板下一次畫出來（或更新完重畫）時由外殼的 `useLayoutEffect` 呼叫 `applyPendingViewport` 套用；那張卡片不在了就不動。debug 錄製檔 `homeDashboard.viewportRestore`（saved／applied／dropped）。
- The dashboard is always found through its controller: the view registers its root with `attachRoot` after rendering, and `readingPosition` and the App Bar's scroll-to-top use `rootElement()` instead of looking up `#homeDashboard` in the document, because a stacked-page layer (#25) carries another dashboard with the same id. `#homeDashboard` is only used by `closest`-style checks that walk up from an event target.
- 快取：`pttchrome.homeFavorites.v1`（清單＋時間，跨重整保留只為了先畫出來；已讀標記只對這次登入有意義，所以「新鮮」只算這一頁抓過的）、`pttchrome.homeRecentBoards.v2`（最近看板紀錄，實際進入看板時記）。
- 滑鼠：面板在 `#BBSWindow` 外。App 的滑鼠入口在 window（滾輪是 capture），`_onUploadLayer` 認 `#homeDashboard` 放過；按鈕 mousedown `preventDefault`（不搶 `#t` 焦點）＋ stopPropagation。
- 好讀行為：好讀開著就有面板，沒有自己的開關。e2e 畫主功能表又要量送出 byte 的 spec，在面板出現後把我的最愛標成剛抓過（`homeDashboard._state.fetchedAt = Date.now()`），面板就不會自己送 `^Z f`。

Recent-board history is managed under Settings → Local → Manage recent boards.
It uses the same `HistoryManager` component, stylesheet and immutable entry rules
(`history_entries.js`) as search history: pinned/recent sections with separate
select-all controls, entry text boxes, counts or an automatic badge, and a shared
bottom toolbar for moving, pinning, unpinning and deleting the selection. Back
returns to Local settings and preserves the parent's scroll position.

Each section holds at most 10 entries. Recent entries count actual visits; the
10th visit pins an entry automatically when there is room. Pinned entries keep
their order and do not count visits; unpinning returns them to the front of recent
entries with zero visits. A full pinned section blocks the entire selected batch
and never evicts existing pins. Board identity is case-insensitive, while search
keywords retain their existing case-sensitive matching.

`HomeDashboard.updateRecentHistory(change)` persists an immutable update and
notifies the existing controller subscribers, including the home live layer.
The dashboard and command palette keep their name-array interface, ordered pins
first and recent visits afterwards. PTT favorites remain independent. Deleting
the current board survives background replies, article reading and intermediate
screens within that visit; verified departure or entry to another board ends it.

Pinned recent-board buttons use the search-history area's light background and
text colors. Buttons retain their original border, pill shape and dimensions,
including the mobile 40px minimum height and the home live layer.

Feature data remains outside preferences, cloud sync and exports. The v2 local
key stores `{pinned:[{text,auto}],recent:[{text,uses}]}`. `recent_board_history.js`
migrates the old v1 name array once, preserving its order with zero historical
counts. An existing v2 value, including an empty or damaged value, prevents a
second import from restoring entries the reader already deleted.

## 測試

unit：`home_dashboard.test.js`（主功能表指紋、列的讀法、最新一篇的已讀標記、送鍵序列與翻頁／夾回、首頁按鍵分類表與擋下、`h` 的說明選單 hold、切好讀開關、主功能表第一幀的 arrival hold、自動抓時機、逛完看板更新未讀、更新鈕接 screen_refresh）、`term_view_text_input.test.js`／`term_view_send_key_as_user.test.js`（首頁的字與工具列鍵）、`home_dashboard_ui.test.jsx`（外殼照 state 畫、按鈕接到控制器、不搶焦點、滑鼠不外洩、真版面的捲動位置還原）、`screen_refresh.test.js`／`mobile_toolbar.test.js`（`home` target）、`reading_record.test.js`（`home` 欄）。offline e2e：`home_dashboard.offline.spec.js`（自動抓 → 卡片、點卡片送 `s`、真鍵盤與輸入法打不支援的鍵／字被擋下、什麼都不送、沒有原生主選單鈕、pref 關、逛完看板不再標有新文章、F5 重抓）、`mobile_home_dashboard.offline.spec.js`（在卡片上下拉重抓、工具列重整、捲到中段點看板回來捲回原處、App Bar 標題＝首頁、沒有原生主選單鈕、軟鍵盤打 `h` 開說明選單時逐幀面板都在且原生說明畫面從未畫出；登入後到主功能表、從原生子選單回主功能表、從看板回主功能表，逐幀都沒有沒被蓋住的原生主功能表）。`term_buf_mouse_refresh.test.js` 守「changed 幀不在畫之前套底色」。
