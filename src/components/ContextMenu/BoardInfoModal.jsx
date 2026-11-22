import { useRef } from "react";
import { Modal, Group, Stack, Text } from "@mantine/core";
import { i18n } from "../../js/i18n";
import MobileSheet from "../MobileSheet";

// Board information (js/board_info.js, #288): the rows PTT's `i` drew, read
// into { board, moderators, items: [{ num, label, value }] }, every row as PTT
// prints it, in its order. Read-only; null = closed. PTT's screen is already
// left, so closing this sends nothing.
export const BoardInfoModal = ({ info: opened, onHide, mobile, pttchrome }) => {
  // The last information stays drawn while the sheet slides away.
  const last = useRef(null);
  if (opened) last.current = opened;
  const info = opened || last.current;
  const field = (name, label, value) => (
    <Stack gap={2} data-board-info-field={name}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" style={{ wordBreak: "break-all" }} data-board-info-value>
        {value}
      </Text>
    </Stack>
  );
  const body = info ? (
    // The open puts focus on the information itself (opened by a key, as
    // PostInfoModal): Escape still closes.
    <Stack
      gap="sm"
      data-board-info={info.board}
      tabIndex={-1}
      data-autofocus
      style={{ outline: "none" }}
    >
      <Group gap="xl" align="flex-start">
        {field("board", i18n("boardInfo_board"), info.board)}
        {field(
          "moderators",
          i18n("boardInfo_moderators"),
          info.moderators || i18n("boardInfo_noModerators"),
        )}
      </Group>
      <Stack gap={6}>
        {info.items.map((item) => (
          <Group
            key={item.num}
            gap="xs"
            wrap="nowrap"
            align="flex-start"
            justify="space-between"
            data-board-info-row={item.num}
          >
            <Group gap={6} wrap="nowrap" align="flex-start">
              <Text
                size="sm"
                c="dimmed"
                style={{ minWidth: "2ch", textAlign: "right" }}
              >
                {item.num}.
              </Text>
              <Text size="sm" data-board-info-label>
                {item.label}
              </Text>
            </Group>
            <Text
              size="sm"
              style={{ textAlign: "right", wordBreak: "break-word" }}
              data-board-info-value
            >
              {item.value}
            </Text>
          </Group>
        ))}
      </Stack>
    </Stack>
  ) : null;

  if (mobile)
    return (
      <MobileSheet
        pttchrome={pttchrome}
        opened={!!opened}
        onClose={onHide}
        title={i18n("boardInfo_title")}
        sheetKey="boardInfo"
      >
        {body}
      </MobileSheet>
    );
  return (
    <Modal
      opened={!!opened}
      onClose={onHide}
      title={i18n("boardInfo_title")}
      centered
    >
      {body}
    </Modal>
  );
};

export default BoardInfoModal;
