import { useRef } from "react";
import { Modal, Stack, Group, Text } from "@mantine/core";
import { i18n } from "../../js/i18n";
import MobileSheet from "../MobileSheet";

// Where the board is (js/whereami.js, #293): the screen PTT's Ctrl-W drew, read
// into { levels: [{ board, description, moderators }], path }, every level as
// PTT prints it, the root first and the board last, then the 位置 path. The
// root's board is '' (PTT prints only its description). Read-only; null =
// closed. PTT's pause is already answered, so closing this sends nothing.
export const WhereAmIModal = ({ where: opened, onHide, mobile, pttchrome }) => {
  // The last answer stays drawn while the sheet slides away.
  const last = useRef(null);
  if (opened) last.current = opened;
  const where = opened || last.current;
  const body = where ? (
    // The open puts focus on the card itself (opened by a key): Escape still
    // closes.
    <Stack
      gap="sm"
      data-whereami
      tabIndex={-1}
      data-autofocus
      style={{ outline: "none" }}
    >
      <Stack gap={8}>
        {where.levels.map((level, i) => (
          <Stack
            key={i}
            gap={2}
            data-whereami-level={i}
            style={{ paddingLeft: `${i * 12}px` }}
          >
            <Group gap="xs" wrap="nowrap" align="baseline">
              {level.board ? (
                <Text size="sm" fw={600} data-whereami-board>
                  {level.board}
                </Text>
              ) : null}
              <Text
                size="sm"
                style={{ wordBreak: "break-word" }}
                data-whereami-description
              >
                {level.description}
              </Text>
            </Group>
            <Text size="xs" c="dimmed" data-whereami-moderators>
              {i18n("boardInfo_moderators")}
              {": "}
              {level.moderators || i18n("boardInfo_noModerators")}
            </Text>
          </Stack>
        ))}
      </Stack>
      <Stack gap={2} data-whereami-path-field>
        <Text size="xs" c="dimmed">
          {i18n("whereAmI_path")}
        </Text>
        <Text size="sm" style={{ wordBreak: "break-word" }} data-whereami-path>
          {where.names.join(" > ")}
        </Text>
      </Stack>
    </Stack>
  ) : null;

  if (mobile)
    return (
      <MobileSheet
        pttchrome={pttchrome}
        opened={!!opened}
        onClose={onHide}
        title={i18n("whereAmI_title")}
        sheetKey="whereAmI"
      >
        {body}
      </MobileSheet>
    );
  return (
    <Modal
      opened={!!opened}
      onClose={onHide}
      title={i18n("whereAmI_title")}
      centered
    >
      {body}
    </Modal>
  );
};

export default WhereAmIModal;
