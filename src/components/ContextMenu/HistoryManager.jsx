import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Badge,
  Button,
  Checkbox,
  Group,
  ScrollArea,
  Stack,
  Text,
} from "@mantine/core";
import { i18n } from "../../js/i18n";
import {
  HISTORY_PINNED_LIMIT,
  normalizeHistory,
  pinRoom,
  pinHistoryEntries,
  unpinHistoryEntries,
  moveHistoryEntries,
  removeHistoryEntries,
} from "../../js/history_entries";
import "./HistoryManager.css";

// Stores own persistence and visit/search counting. Both settings pages share
// these sections, selection rules and batch actions.
export default function HistoryManager({
  history,
  onChange,
  helpKey,
  emptyKey = "searchHistoryManager_empty",
  caseInsensitive = false,
  selectionKey = null,
  toolbarTarget = null,
  children,
  ...rootProps
}) {
  const options = { caseInsensitive };
  const { pinned, recent } = normalizeHistory(history, options);
  const [selected, setSelected] = useState([]);
  const keyOf = (text) => (caseInsensitive ? text.toLowerCase() : text);
  const isSelected = (text) =>
    selected.some((item) => keyOf(item) === keyOf(text));
  const selectedPinned = pinned.filter((item) => isSelected(item.text));
  const selectedRecent = recent.filter((item) => isSelected(item.text));
  const pinFull = selectedRecent.length > pinRoom(history, options);

  // Keep the kind controls mounted (and their keyboard focus) while changing
  // which history owns the selection.
  useEffect(() => setSelected([]), [selectionKey]);

  useEffect(() => {
    const entries = normalizeHistory(history, { caseInsensitive });
    const key = (text) => (caseInsensitive ? text.toLowerCase() : text);
    const available = new Set(
      [...entries.pinned, ...entries.recent].map((item) => key(item.text)),
    );
    setSelected((current) => {
      const remaining = current.filter((text) => available.has(key(text)));
      return remaining.length === current.length ? current : remaining;
    });
  }, [history, caseInsensitive]);

  const canMove = (delta) => {
    const moved = moveHistoryEntries(history, selected, delta, options);
    return moved.pinned.some((item, index) => item.text !== pinned[index].text);
  };
  const toggle = (text) =>
    setSelected((current) =>
      current.some((item) => keyOf(item) === keyOf(text))
        ? current.filter((item) => keyOf(item) !== keyOf(text))
        : [...current, text],
    );
  const toggleAll = (texts) =>
    setSelected((current) => {
      const keys = new Set(texts.map(keyOf));
      const picked = new Set(current.map(keyOf));
      return texts.every((text) => picked.has(keyOf(text)))
        ? current.filter((text) => !keys.has(keyOf(text)))
        : [...current, ...texts.filter((text) => !picked.has(keyOf(text)))];
    });
  const sectionHeader = (name, labelKey, entries) => {
    const texts = entries.map((item) => item.text);
    const checked = texts.length > 0 && texts.every(isSelected);
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
          indeterminate={texts.some(isSelected) && !checked}
          disabled={!texts.length}
          onChange={() => toggleAll(texts)}
          data-manager-select-all={name}
        />
      </Group>
    );
  };
  const entryRow = (text, info) => (
    <div
      key={keyOf(text)}
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
  const toolbar = (
    <div className="searchHistoryManagerActions">
      <Group gap={8}>
        <Button
          size="compact-sm"
          variant="default"
          disabled={!selectedPinned.length || !canMove(-1)}
          onClick={() =>
            onChange((current) =>
              moveHistoryEntries(current, selected, -1, options),
            )
          }
          data-manager-action="up"
        >
          {i18n("searchHistoryManager_moveUp")}
        </Button>
        <Button
          size="compact-sm"
          variant="default"
          disabled={!selectedPinned.length || !canMove(1)}
          onClick={() =>
            onChange((current) =>
              moveHistoryEntries(current, selected, 1, options),
            )
          }
          data-manager-action="down"
        >
          {i18n("searchHistoryManager_moveDown")}
        </Button>
        <Button
          size="compact-sm"
          variant="default"
          disabled={!selectedRecent.length || pinFull}
          onClick={() =>
            onChange((current) => pinHistoryEntries(current, selected, options))
          }
          data-manager-action="pin"
        >
          {i18n("searchHistoryManager_pin")}
        </Button>
        <Button
          size="compact-sm"
          variant="default"
          disabled={!selectedPinned.length}
          onClick={() =>
            onChange((current) =>
              unpinHistoryEntries(current, selected, options),
            )
          }
          data-manager-action="unpin"
        >
          {i18n("searchHistoryManager_unpin")}
        </Button>
        <Button
          size="compact-sm"
          color="red"
          ml="auto"
          disabled={!selected.length}
          onClick={() => {
            onChange((current) =>
              removeHistoryEntries(current, selected, options),
            );
            setSelected([]);
          }}
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
            HISTORY_PINNED_LIMIT,
          )}
        </Text>
      )}
    </div>
  );
  return (
    <Stack gap="sm" {...rootProps}>
      {children}
      <Text size="xs" c="dimmed">
        {i18n(helpKey)}
      </Text>
      {!pinned.length && !recent.length && (
        <Text size="sm" c="dimmed" ta="center" data-manager-empty>
          {i18n(emptyKey)}
        </Text>
      )}
      <div data-manager-section="pinned">
        {sectionHeader("pinned", "searchHistoryManager_pinned", pinned)}
        {pinned.map((item) =>
          entryRow(
            item.text,
            item.auto ? (
              <Badge size="sm" variant="light" data-manager-auto>
                {i18n("searchHistoryManager_auto")}
              </Badge>
            ) : null,
          ),
        )}
      </div>
      <div data-manager-section="recent">
        {sectionHeader("recent", "searchHistoryManager_recent", recent)}
        {recent.map((item) =>
          entryRow(
            item.text,
            <Text size="sm" c="dimmed" data-manager-uses>
              {item.uses}
            </Text>,
          ),
        )}
      </div>
      {toolbarTarget ? createPortal(toolbar, toolbarTarget) : toolbar}
    </Stack>
  );
}
