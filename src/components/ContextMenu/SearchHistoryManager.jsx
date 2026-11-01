import { useState, useEffect, useCallback } from "react";
import {
  Modal,
  Button,
  Group,
  Stack,
  SegmentedControl,
  Text,
  Checkbox,
  ActionIcon,
  Badge,
} from "@mantine/core";
import {
  IconArrowUp,
  IconArrowDown,
  IconPin,
  IconPinnedOff,
} from "@tabler/icons-react";
import { i18n } from "../../js/i18n";
import MobileSheet, { SHEET_Z_INDEX } from "../MobileSheet";
import {
  readSearchHistory,
  updateSearchHistory,
  searchHistoryKind,
  isSearchPinFull,
  pinSearchEntry,
  unpinSearchEntry,
  moveSearchEntry,
  removeSearchEntries,
  SEARCH_KINDS,
  SEARCH_KIND_LABEL_KEY,
} from "../../js/search_history";
import "./SearchHistoryManager.css";

// 搜尋紀錄的管理視窗（#70），從設定的「本機」分頁打開，疊在設定上面。
// 搜尋視窗下方的搜尋紀錄區只用來搜尋；釘選、排序、刪除都在這裡。
//   - 每個變更立刻寫回本機紀錄，所以只有「完成」，沒有取消。
//   - 釘選的排序用上移／下移：沒有拖曳套件，sheet 裡拖曳也會跟捲動打架。
//   - 勾選只對目前的種類有效，切換種類就清掉。
// 系統返回＝關閉這個視窗（registerBack，同 AboutPanels 的更新視窗），不關設定。

export const SearchHistoryManager = ({
  opened,
  onClose,
  mobile,
  registerBack,
}) => {
  const [kind, setKind] = useState("title");
  const [history, setHistory] = useState(() => readSearchHistory());
  const [selected, setSelected] = useState([]);

  useEffect(() => {
    if (!opened) return;
    setHistory(readSearchHistory());
    setSelected([]);
  }, [opened]);

  useEffect(() => {
    if (opened) return registerBack?.(onClose);
  }, [opened, registerBack, onClose]);

  const { pinned, recent } = searchHistoryKind(history, kind);
  const pinFull = isSearchPinFull(history, kind);

  const apply = useCallback(
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

  const onDelete = useCallback(() => {
    apply((h) => removeSearchEntries(h, kind, selected));
    setSelected([]);
  }, [apply, kind, selected]);

  const isEmpty = !pinned.length && !recent.length;

  const sectionHeader = (name, labelKey, texts) => {
    const checked =
      texts.length > 0 && texts.every((t) => selected.indexOf(t) >= 0);
    const some = texts.some((t) => selected.indexOf(t) >= 0);
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

  const entryRow = (text, extra, actions) => (
    <Group
      key={text}
      gap="xs"
      wrap="nowrap"
      className="searchHistoryManagerEntry"
      data-manager-entry={text}
    >
      <Checkbox
        size="sm"
        className="searchHistoryManagerText"
        label={text}
        checked={selected.indexOf(text) >= 0}
        onChange={() => toggle(text)}
      />
      {extra}
      <Group gap={4} wrap="nowrap">
        {actions}
      </Group>
    </Group>
  );

  const body = (
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
        {pinned.map((it, i) =>
          entryRow(
            it.text,
            it.auto ? (
              <Badge size="sm" variant="light" data-manager-auto>
                {i18n("searchHistoryManager_auto")}
              </Badge>
            ) : null,
            <>
              <ActionIcon
                variant="default"
                size="lg"
                aria-label={i18n("searchHistoryManager_moveUp")}
                data-manager-up
                disabled={i === 0}
                onClick={() =>
                  apply((h) => moveSearchEntry(h, kind, it.text, -1))
                }
              >
                <IconArrowUp size={18} />
              </ActionIcon>
              <ActionIcon
                variant="default"
                size="lg"
                aria-label={i18n("searchHistoryManager_moveDown")}
                data-manager-down
                disabled={i === pinned.length - 1}
                onClick={() =>
                  apply((h) => moveSearchEntry(h, kind, it.text, 1))
                }
              >
                <IconArrowDown size={18} />
              </ActionIcon>
              <ActionIcon
                variant="light"
                size="lg"
                aria-label={i18n("searchHistoryManager_unpin")}
                data-manager-unpin
                onClick={() => apply((h) => unpinSearchEntry(h, kind, it.text))}
              >
                <IconPinnedOff size={18} />
              </ActionIcon>
            </>,
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
            <ActionIcon
              variant="default"
              size="lg"
              aria-label={i18n("searchHistoryManager_pin")}
              data-manager-pin
              disabled={pinFull}
              onClick={() => apply((h) => pinSearchEntry(h, kind, it.text))}
            >
              <IconPin size={18} />
            </ActionIcon>,
          ),
        )}
      </div>
      <Group justify="space-between" mt="xs">
        <Button
          color="red"
          variant="light"
          disabled={!selected.length}
          onClick={onDelete}
          data-manager-delete
        >
          {selected.length
            ? i18n("searchHistoryManager_delete").replace(
                "{0}",
                selected.length,
              )
            : i18n("searchHistoryManager_deleteNone")}
        </Button>
        <Button onClick={onClose} data-manager-done>
          {i18n("searchHistoryManager_done")}
        </Button>
      </Group>
    </Stack>
  );

  const title = i18n("searchHistoryManager_title");
  // 系統返回已經由 registerBack 接住：sheet 不再自己登記（不傳 pttchrome）。
  if (mobile)
    return (
      <MobileSheet
        opened={opened}
        onClose={onClose}
        title={title}
        sheetKey="searchHistory"
      >
        {body}
      </MobileSheet>
    );
  return (
    // 疊在設定（Mantine 預設層級）上面，跟手機 sheet 同一層。
    <Modal
      opened={opened}
      onClose={onClose}
      title={title}
      size="lg"
      zIndex={SHEET_Z_INDEX}
    >
      {body}
    </Modal>
  );
};

export default SearchHistoryManager;
