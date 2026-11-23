import { useState, useEffect, useCallback, useRef } from "react";
import {
  Modal,
  TextInput,
  Checkbox,
  SegmentedControl,
  Button,
  Group,
  Text,
  ScrollArea,
} from "@mantine/core";
import { i18n } from "../../js/i18n";
import MobileSheet from "../MobileSheet";
import { normalizeSearchText as normalizeArticleSearch } from "../../js/article_search";
import { USER_QUERY_ID_RE } from "../../js/user_query";
import {
  sanitizeBoardQuery,
  resolvedBoardName,
  interimCandidates,
} from "../../js/board_search_bridge";
import {
  readSearchHistory,
  searchHistoryKind,
  searchHistoryOrder,
  SEARCH_KIND_LABEL_KEY,
} from "../../js/search_history";
import { SearchKindControl } from "./SearchKindControl";
import "./SearchModal.css";

// 搜尋彈窗（docs/article-search.md）。取代 PTT 原生的 / ? a Z s prompt：
//   - ↑／↓ 在輸入框裡循環**這個種類**的搜尋紀錄（釘選的先、再從最新的往舊的，
//     跟搜尋紀錄區同一個順序；回到最底就還原自己打到一半的字）。
//   - 下方的搜尋紀錄區列出這一類的全部紀錄，點了就搜尋（手機軟鍵盤沒有方向鍵）。
//     這裡只用來搜尋：刪除、釘選都在設定裡的管理視窗（SearchHistoryManager.jsx）。
//   - 看板種類比照 PTT 原生補全（board_search_bridge.js）：createBoardSearch 開出背景的
//     原生 `s` prompt，打字即查、沒有這個開頭的看板就把那個字退回並提示、空白鍵
//     自動完成、下方列出符合的看板可直接點。沒給 createBoardSearch（或 prompt 開不出來）
//     ＝退回普通輸入框。
// 送出交給呼叫端（ContextMenu → bridge.submit／article_search.submitSearch），這裡只管輸入。
const KIND_PLACEHOLDER_KEY = {
  title: "searchModal_placeholderTitle",
  author: "searchModal_placeholderAuthor",
  push: "searchModal_placeholderPush",
  board: "searchModal_placeholderBoard",
  price: "searchModal_placeholderPrice",
  exclude: "searchModal_placeholderExclude",
};
// 種類 user＝查詢網友（user_query.js，#199）：同一個輸入外殼，標題、欄位名、
// 送出鈕換成查詢網友的字，只收 PTT 的帳號格式，沒有搜尋紀錄。
const USER_KIND = "user";
// 文章列表其餘的篩選（#298）：這些種類不打字，在彈窗裡選好就送。
const NO_TEXT_KINDS = ["mark", "newPost"];
const NO_TEXT_HINT_KEY = {
  mark: "searchModal_markHint",
  newPost: "searchModal_newPostHint",
};
function normalizeSearchText(kind, text) {
  if (kind !== USER_KIND) return normalizeArticleSearch(kind, text);
  const t = String(text == null ? "" : text).trim();
  return USER_QUERY_ID_RE.test(t) ? t : "";
}
// 搜尋紀錄區：compact-sm 按鈕高 26px，最多三行。
const HISTORY_GAP = 8;
const HISTORY_AREA_MAX_HEIGHT = 3 * 26 + 2 * HISTORY_GAP;
// mobile：手機版面改用 bottom sheet 外殼（components/MobileSheet，系統返回＝收起），
// 內容（表單、記憶、送出）完全相同。
export const SearchModal = ({
  show,
  kind,
  kinds,
  onHide,
  onConfirm,
  mobile,
  pttchrome,
  createBoardSearch,
  aidTarget,
  switchBoard,
  exclude,
  excludeAllowed,
  sameTitle,
}) => {
  // aidTarget＝{ aid, token }：沒寫看板的 #AID 要跳到哪個看板（aid_board_choice.js）。
  // 輸入與原生補全跟一般的看板搜尋完全相同，只有標題／送出鈕的字不同，送出後
  // 由呼叫端在進板之後接著跑 AID 跳轉。
  const [currentKind, setCurrentKind] = useState(kind || "title");
  const [value, setValue] = useState("");
  const [history, setHistory] = useState(() => readSearchHistory());
  // -1 ＝ 正在編輯自己的字；0.. ＝ 正顯示記憶的第幾筆。
  const indexRef = useRef(-1);
  const draftRef = useRef("");
  const inputRef = useRef(null);
  // 看板補全：bridge 只在看板種類＋彈窗開著時存在；board＝它最近一次回報的
  // { status, result }。boardRejected＝最近被 PTT 退回的那串（提示用）。
  const bridgeRef = useRef(null);
  const [board, setBoard] = useState(null);
  const [boardRejected, setBoardRejected] = useState("");
  // 標題種類的「排除」（!）與標記種類的 m／s（G）。
  const [excludeChecked, setExcludeChecked] = useState(false);
  const [markChoice, setMarkChoice] = useState("mark");

  // 每次打開都重新讀（元件常駐，初值會過期），種類跟著觸發的按鍵。
  useEffect(() => {
    if (!show) return;
    setCurrentKind(kind || "title");
    setExcludeChecked(!!exclude && !!excludeAllowed);
    setMarkChoice("mark");
    setValue("");
    setHistory(readSearchHistory());
    indexRef.current = -1;
    draftRef.current = "";
  }, [show, kind, exclude, excludeAllowed]);

  const isBoard = currentKind === "board";
  // Same title (S) sends PTT's own S, which works on the cursor row: the input
  // only shows that row's title, and Search needs nothing else.
  const isSameTitle = currentKind === "sameTitle";
  const noText = NO_TEXT_KINDS.includes(currentKind) || isSameTitle;
  // 排除（!）只有搜尋結果裡 PTT 才收；關掉時要打勾也勾不了。
  const excluding =
    currentKind === "title" && excludeChecked && !!excludeAllowed;
  const valueRef = useRef(value);
  valueRef.current = value;
  useEffect(() => {
    if (!show || !isBoard || !createBoardSearch) return undefined;
    const bridge = createBoardSearch((next) => setBoard(next));
    bridgeRef.current = bridge;
    setBoard({ status: bridge.status, result: bridge.result });
    setBoardRejected("");
    bridge.query(valueRef.current);
    return () => {
      bridgeRef.current = null;
      setBoard(null);
      bridge.cancel(); // 已送出時是 noop
    };
  }, [show, isBoard, createBoardSearch]);
  useEffect(() => {
    if (bridgeRef.current) bridgeRef.current.query(value);
  }, [value]);

  const boardQuery = isBoard ? sanitizeBoardQuery(value) : "";
  const boardResult =
    board &&
    board.result &&
    board.result.query.toLowerCase() === boardQuery.toLowerCase()
      ? board.result
      : null;
  // 上一份收下的清單：查詢在飛時拿它本地篩選先顯示（interimCandidates），清單不會
  // 每打一個字就先清空再長回來。
  const lastAcceptedRef = useRef(null);
  if (!board) lastAcceptedRef.current = null;
  else if (board.result && !board.result.rejected && !board.result.unknown)
    lastAcceptedRef.current = board.result;
  // PTT 收不下的字（沒有看板以這串開頭）：退回到收得下的前綴，同原生的 bell＋丟字。
  const latestResult = board && board.result;
  // 使用者在回應回來前又多打了字也一樣（那些字接在被拒的字後面，一起丟）。
  useEffect(() => {
    if (!latestResult || !latestResult.rejected) return;
    const cur = sanitizeBoardQuery(valueRef.current);
    if (cur.toLowerCase().indexOf(latestResult.query.toLowerCase()) !== 0)
      return;
    const kept = cur.slice(0, latestResult.accepted);
    setBoardRejected(latestResult.query.slice(0, latestResult.accepted + 1));
    setValue(kept);
    indexRef.current = -1;
    draftRef.current = kept;
  }, [latestResult]);

  const boardResolved = boardResult
    ? resolvedBoardName(boardResult, boardQuery)
    : "";
  // 查到了而且 Enter 進不了板（多個符合）＝擋下送出，跟原生一樣什麼都不會發生。
  // unknown（PTT 沒回出可判的畫面）不擋：交給 PTT 自己判。
  const boardBlocks =
    isBoard &&
    !!boardResult &&
    !boardResult.unknown &&
    !!boardQuery &&
    !boardResolved;

  const list = searchHistoryOrder(history, currentKind);
  const pinnedCount = searchHistoryKind(history, currentKind).pinned.length;
  const valid =
    (noText || !!normalizeSearchText(currentKind, value)) && !boardBlocks;

  const onKindChange = useCallback((k) => {
    setCurrentKind(k);
    setValue("");
    indexRef.current = -1;
    draftRef.current = "";
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const onChange = useCallback(
    (event) => {
      let next = event.target.value;
      if (currentKind === "board" && /\s/.test(next)) {
        // 空白鍵＝PTT 的「自動搜尋」：補到所有符合者的共同前綴（唯一就補完整名）。
        // 手機軟鍵盤沒有可靠的 keydown，所以在 onChange 看結果。
        next = next.replace(/\s+/g, "");
        const r = bridgeRef.current && bridgeRef.current.result;
        if (
          r &&
          !r.rejected &&
          r.query.toLowerCase() === next.toLowerCase() &&
          r.completion.length > next.length
        )
          next = r.completion;
      }
      setValue(next);
      setBoardRejected("");
      indexRef.current = -1;
      draftRef.current = next;
    },
    [currentKind],
  );

  const onKeyDown = useCallback(
    (event) => {
      if (event.nativeEvent && event.nativeEvent.isComposing) return;
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      if (!list.length) return;
      event.preventDefault();
      let i = indexRef.current + (event.key === "ArrowUp" ? 1 : -1);
      if (i >= list.length) i = list.length - 1;
      if (i < -1) i = -1;
      indexRef.current = i;
      setValue(i < 0 ? draftRef.current : list[i]);
    },
    [list],
  );

  const submit = useCallback(
    (text) => {
      if (noText)
        return onConfirm({
          kind: currentKind === "mark" ? markChoice : currentKind,
          text: "",
        });
      if (!normalizeSearchText(currentKind, text)) return;
      if (currentKind === USER_KIND)
        return onConfirm({
          kind: currentKind,
          text: normalizeSearchText(currentKind, text),
        });
      if (currentKind !== "board")
        return onConfirm({ kind: excluding ? "exclude" : currentKind, text });
      // 唯一符合時 PTT 會進那個板：記憶裡存完整板名，不存打到一半的字。
      const bridge = bridgeRef.current;
      const resolved = resolvedBoardName(
        bridge && bridge.result,
        sanitizeBoardQuery(text),
      );
      const payload = { kind: currentKind, text: resolved || text };
      if (bridge) payload.bridge = bridge;
      if (aidTarget) payload.aidTarget = aidTarget;
      if (switchBoard) payload.switchBoard = true;
      onConfirm(payload);
    },
    [
      currentKind,
      onConfirm,
      aidTarget,
      switchBoard,
      noText,
      markChoice,
      excluding,
    ],
  );

  const onSubmit = useCallback(
    (event) => {
      event.preventDefault();
      if (!valid) return; // Enter 跟停用的「搜尋」鈕同一個判準
      submit(value);
    },
    [submit, value, valid],
  );

  const shownKinds = kinds && kinds.length ? kinds : [currentKind];
  const isUser = currentKind === USER_KIND;
  const title = aidTarget
    ? i18n("aidBoardChoice_pickTitle").replace("{0}", "#" + aidTarget.aid)
    : switchBoard
      ? i18n("switchBoard_title")
      : i18n(isUser ? "userQuery_title" : "searchModal_title");

  const form = (
    <form onSubmit={onSubmit} data-search-modal>
      {shownKinds.length > 1 && (
        <SearchKindControl
          kinds={shownKinds}
          mb="sm"
          value={currentKind}
          onChange={onKindChange}
        />
      )}
      {noText && (
        <div data-search-notext={currentKind}>
          {currentKind === "mark" && (
            <SegmentedControl
              fullWidth
              mb="xs"
              value={markChoice}
              onChange={setMarkChoice}
              data={[
                { value: "mark", label: i18n("searchModal_markM") },
                { value: "solved", label: i18n("searchModal_markS") },
              ]}
            />
          )}
          {currentKind === "sameTitle" ? (
            <TextInput
              name="sameTitle"
              data-search-same-title
              disabled
              readOnly
              aria-label={i18n("searchModal_kindSameTitle")}
              placeholder={i18n("searchModal_sameTitlePlaceholder")}
              value={sameTitle || ""}
            />
          ) : (
            <Text size="sm" c="dimmed">
              {i18n(NO_TEXT_HINT_KEY[currentKind])}
            </Text>
          )}
        </div>
      )}
      {!noText && (
        <TextInput
          data-autofocus
          ref={inputRef}
          name="searchKeyword"
          label={
            shownKinds.length > 1
              ? undefined
              : i18n(
                  isUser
                    ? "userQuery_label"
                    : SEARCH_KIND_LABEL_KEY[currentKind],
                )
          }
          placeholder={i18n(
            isUser
              ? "userQuery_placeholder"
              : KIND_PLACEHOLDER_KEY[currentKind],
          )}
          inputMode={
            currentKind === "push" || currentKind === "price"
              ? "numeric"
              : undefined
          }
          autoCapitalize={isUser ? "none" : undefined}
          autoCorrect={isUser ? "off" : undefined}
          spellCheck={isUser ? false : undefined}
          autoComplete="off"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
        />
      )}
      {currentKind === "title" && (
        <div data-search-exclude>
          <Checkbox
            mt="xs"
            size="sm"
            label={i18n("searchModal_excludeLabel")}
            checked={excluding}
            disabled={!excludeAllowed}
            onChange={(event) => setExcludeChecked(event.currentTarget.checked)}
          />
        </div>
      )}
      {isBoard && board && (
        <BoardSuggestions
          board={board}
          query={boardQuery}
          result={boardResult}
          rejected={boardRejected}
          blocks={boardBlocks}
          ascii={!value || !!normalizeSearchText("board", value)}
          interim={
            boardResult
              ? null
              : interimCandidates(lastAcceptedRef.current, boardQuery)
          }
          mobile={mobile}
          onPick={submit}
        />
      )}
      {list.length > 0 && (
        <div data-search-history>
          <Text size="xs" c="dimmed" mt="sm" mb={4}>
            {i18n("searchModal_history")}
          </Text>
          {/* 超過三行就固定三行高、框內捲動。type="auto"：有得捲時捲軸一直在，
              不像手機原生捲軸只在滑動時閃一下，看不出下面還有。 */}
          <ScrollArea.Autosize
            type="auto"
            mah={HISTORY_AREA_MAX_HEIGHT}
            offsetScrollbars="y"
            className="searchHistoryArea"
          >
            <Group gap={HISTORY_GAP}>
              {list.map((it, i) => (
                <Button
                  key={it}
                  size="compact-sm"
                  variant={i < pinnedCount ? "light" : "default"}
                  className="searchHistoryItem"
                  data-search-history-item={it}
                  onClick={() => submit(it)}
                >
                  {it}
                </Button>
              ))}
            </Group>
          </ScrollArea.Autosize>
        </div>
      )}
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onHide}>
          {i18n("searchModal_cancel")}
        </Button>
        <Button type="submit" disabled={!valid}>
          {i18n(
            aidTarget
              ? "aidBoardChoice_jump"
              : switchBoard
                ? "switchBoard_confirm"
                : isUser
                  ? "userQuery_confirm"
                  : "searchModal_confirm",
          )}
        </Button>
      </Group>
    </form>
  );

  if (mobile)
    return (
      <MobileSheet
        pttchrome={pttchrome}
        opened={show}
        onClose={onHide}
        title={title}
        sheetKey="search"
      >
        {form}
      </MobileSheet>
    );
  return (
    <Modal
      opened={show}
      onClose={onHide}
      title={title}
      // 貼頂不置中：置中時內容一變高（切種類）輸入框就跟著上下跳。
      yOffset="10vh"
      size="lg"
    >
      {form}
    </Modal>
  );
};

// 看板補全的狀態列＋符合清單（PTT「相關資訊一覽表」的第一頁）。
// 版面固定（SearchModal.css）：狀態列恆佔一行、清單框恆定高度、「還有更多」放在框內，
// 打字時彈窗不跟著結果長縮（使用者回報：邊打字視窗邊抖動）。
// interim：查詢在飛時先顯示的清單（上一份本地篩選，淡化），result 回來就換掉。
const BoardSuggestions = ({
  board,
  query,
  result,
  rejected,
  blocks,
  ascii,
  interim,
  mobile,
  onPick,
}) => {
  let status = null;
  if (!ascii) status = i18n("searchModal_boardAscii");
  else if (rejected)
    status = i18n("searchModal_boardNoMatch").replace("{0}", rejected);
  else if (board.status === "opening")
    status = i18n("searchModal_boardOpening");
  else if (board.status === "unavailable")
    status = i18n("searchModal_boardUnavailable");
  else if (query && !result) status = i18n("searchModal_boardPending");
  else if (blocks) status = i18n("searchModal_boardAmbiguous");
  const pending = !result && !!interim && interim.length > 0;
  const names = result ? result.candidates || [] : pending ? interim : [];
  return (
    <div
      className="searchBoardSuggest"
      data-mobile={mobile ? "" : undefined}
      data-board-suggest={board.status}
    >
      <Text
        size="xs"
        c={rejected || !ascii ? "red" : "dimmed"}
        className="searchBoardStatus"
        title={status || undefined}
        data-board-status={status ? "" : undefined}
      >
        {status}
      </Text>
      {/* 一頁最多約 60 個（PTT 三欄×20 列）：框內捲動，不把表單撐出畫面。 */}
      <div
        className="searchBoardCandidates"
        data-board-candidates
        data-board-interim={pending ? "" : undefined}
      >
        <Group gap={4}>
          {names.map((name) => (
            <Button
              key={name}
              size="compact-xs"
              variant="default"
              data-board-candidate={name}
              onClick={() => onPick(name)}
            >
              {name}
            </Button>
          ))}
        </Group>
        {result && result.more && (
          <Text size="xs" c="dimmed" mt={4} data-board-more>
            {i18n("searchModal_boardMore")}
          </Text>
        )}
      </div>
    </div>
  );
};

export default SearchModal;
