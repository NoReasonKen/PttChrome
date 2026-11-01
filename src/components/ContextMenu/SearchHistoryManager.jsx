import { useState, useCallback } from "react";
import {
  Button,
  Group,
  Stack,
  SegmentedControl,
  Text,
  Checkbox,
  Badge,
  ScrollArea,
} from "@mantine/core";
import { i18n } from "../../js/i18n";
import {
  readSearchHistory,
  updateSearchHistory,
  searchHistoryKind,
  searchPinRoom,
  pinSearchEntries,
  unpinSearchEntries,
  moveSearchEntries,
  removeSearchEntries,
  MAX_PINNED_SEARCH_HISTORY,
  SEARCH_KINDS,
  SEARCH_KIND_LABEL_KEY,
} from "../../js/search_history";
import "./SearchHistoryManager.css";

// 搜尋紀錄的管理頁（#70）：設定「本機」底下的一頁，進出由 PrefModal 管（返回、系統返回）。
// 搜尋視窗下方的搜尋紀錄區只用來搜尋；釘選、排序、刪除都在這裡。
//   - 每一列只有勾選框、關鍵字、次數；操作都在下方那排按鈕，對勾到的一起做。
//   - 每個變更立刻寫回本機紀錄，沒有取消。
//   - 釘選的排序用上移／下移：沒有拖曳套件，拖曳也會跟捲動打架。
//   - 勾選只對目前的種類有效，切換種類或刪除就清掉；其他操作保留，才能連按上移。
// 只在這一頁開著時掛載，所以一掛上就讀一次紀錄。
export const SearchHistoryManager = () => {
  const [kind, setKind] = useState("title");
  const [history, setHistory] = useState(readSearchHistory);
  const [selected, setSelected] = useState([]);

  const { pinned, recent } = searchHistoryKind(history, kind);
  const isSelected = (text) => selected.indexOf(text) >= 0;
  const selectedPinned = pinned.filter((it) => isSelected(it.text));
  const selectedRecent = recent.filter((it) => isSelected(it.text));
  const pinFull = selectedRecent.length > searchPinRoom(history, kind);
  // 移得動才啟用：試著移一次，看釘選的順序有沒有變。
  const canMove = (delta) => {
    const moved = searchHistoryKind(
      moveSearchEntries(history, kind, selected, delta),
      kind,
    );
    return moved.pinned.some((it, i) => it.text !== pinned[i].text);
  };

  const applyAndSave = useCallback(
    (change) => setHistory(updateSearchHistory(change)),
    [],
  );

  const onKindChange = useCallback((k) => {
    setKind(k);
    setSelected([]);
  }, []);

  const toggle = useCallback(
    (text) =>
      setSelected((cur) =>
        cur.indexOf(text) >= 0 ? cur.filter((t) => t !== text) : [...cur, text],
      ),
    [],
  );
  // 全選：這一段全都勾了就全部取消，否則補勾。
  const toggleAll = useCallback(
    (texts) =>
      setSelected((cur) =>
        texts.every((t) => cur.indexOf(t) >= 0)
          ? cur.filter((t) => texts.indexOf(t) < 0)
          : [...cur, ...texts.filter((t) => cur.indexOf(t) < 0)],
      ),
    [],
  );

  const onDelete = () => {
    applyAndSave((h) => removeSearchEntries(h, kind, selected));
    setSelected([]);
  };

  const isEmpty = !pinned.length && !recent.length;

  const sectionHeader = (name, labelKey, texts) => {
    const checked = texts.length > 0 && texts.every(isSelected);
    const some = texts.some(isSelected);
    return (
      <Group justify="space-between" className="searchHistoryManagerHeading">
        <Text fw={600} size="sm">
          {i18n(labelKey)}
        </Text>
        <Checkbox
          size="sm"
          labelPosition="left"
          label={i18n("searchHistoryManager_selectAll")}
          checked={checked}
          indeterminate={some && !checked}
          disabled={!texts.length}
          onChange={() => toggleAll(texts)}
          data-manager-select-all={name}
        />
      </Group>
    );
  };

  // 關鍵字框在固定寬度裡，太長就在框內左右捲（捲軸一直在；只有出現捲軸的框才留它的高度），
  // 次數固定在右邊。
  const entryRow = (text, info) => (
    <div
      key={text}
      className="searchHistoryManagerEntry"
      data-manager-entry={text}
    >
      <Checkbox
        size="sm"
        aria-label={text}
        checked={isSelected(text)}
        onChange={() => toggle(text)}
      />
      <ScrollArea
        type="auto"
        scrollbars="x"
        offsetScrollbars="present"
        className="searchHistoryManagerText"
        data-manager-text
        onClick={() => toggle(text)}
      >
        <span className="searchHistoryManagerTextLabel">{text}</span>
      </ScrollArea>
      <div className="searchHistoryManagerInfo">{info}</div>
    </div>
  );

  return (
    <Stack gap="sm" data-search-history-manager>
      <SegmentedControl
        fullWidth
        value={kind}
        onChange={onKindChange}
        data={SEARCH_KINDS.map((k) => ({
          value: k,
          label: i18n(SEARCH_KIND_LABEL_KEY[k]),
        }))}
      />
      <Text size="xs" c="dimmed">
        {i18n("searchHistoryManager_help")}
      </Text>
      {isEmpty && (
        <Text size="sm" c="dimmed" ta="center" data-manager-empty>
          {i18n("searchHistoryManager_empty")}
        </Text>
      )}
      <div data-manager-section="pinned">
        {sectionHeader(
          "pinned",
          "searchHistoryManager_pinned",
          pinned.map((it) => it.text),
        )}
        {pinned.map((it) =>
          entryRow(
            it.text,
            it.auto ? (
              <Badge size="sm" variant="light" data-manager-auto>
                {i18n("searchHistoryManager_auto")}
              </Badge>
            ) : null,
          ),
        )}
      </div>
      <div data-manager-section="recent">
        {sectionHeader(
          "recent",
          "searchHistoryManager_recent",
          recent.map((it) => it.text),
        )}
        {recent.map((it) =>
          entryRow(
            it.text,
            <Text size="sm" c="dimmed" data-manager-uses>
              {it.uses}
            </Text>,
          ),
        )}
      </div>
      {/* 操作列貼在設定捲動區的底部：清單再長也按得到。 */}
      <div className="searchHistoryManagerActions">
        <Group gap={8}>
          <Button
            variant="default"
            disabled={!selectedPinned.length || !canMove(-1)}
            onClick={() =>
              applyAndSave((h) => moveSearchEntries(h, kind, selected, -1))
            }
            data-manager-action="up"
          >
            {i18n("searchHistoryManager_moveUp")}
          </Button>
          <Button
            variant="default"
            disabled={!selectedPinned.length || !canMove(1)}
            onClick={() =>
              applyAndSave((h) => moveSearchEntries(h, kind, selected, 1))
            }
            data-manager-action="down"
          >
            {i18n("searchHistoryManager_moveDown")}
          </Button>
          <Button
            variant="default"
            disabled={!selectedRecent.length || pinFull}
            onClick={() =>
              applyAndSave((h) => pinSearchEntries(h, kind, selected))
            }
            data-manager-action="pin"
          >
            {i18n("searchHistoryManager_pin")}
          </Button>
          <Button
            variant="default"
            disabled={!selectedPinned.length}
            onClick={() =>
              applyAndSave((h) => unpinSearchEntries(h, kind, selected))
            }
            data-manager-action="unpin"
          >
            {i18n("searchHistoryManager_unpin")}
          </Button>
          <Button
            color="red"
            disabled={!selected.length}
            onClick={onDelete}
            data-manager-action="delete"
          >
            {selected.length
              ? i18n("searchHistoryManager_delete").replace(
                  "{0}",
                  selected.length,
                )
              : i18n("searchHistoryManager_deleteNone")}
          </Button>
        </Group>
        {pinFull && (
          <Text size="xs" c="dimmed" mt={4} data-manager-pin-full>
            {i18n("searchHistoryManager_pinFull").replace(
              "{0}",
              MAX_PINNED_SEARCH_HISTORY,
            )}
          </Text>
        )}
      </div>
    </Stack>
  );
};

export default SearchHistoryManager;
