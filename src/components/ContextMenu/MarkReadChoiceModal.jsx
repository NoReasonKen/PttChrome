import { Modal, Button, Stack, Text } from "@mantine/core";
import { i18n } from "../../js/i18n";
import MobileSheet from "../MobileSheet";

// PTT's `v` question on the article list (#299, js/mark_all_read.js): set
// every article unread (U), every article read (V), or read up to the article
// under the cursor and the rest unread (W). Nothing is sent until a pick;
// cancel or closing sends nothing. A pick goes to MarkAllRead.startAnswer.
export const MarkReadChoiceModal = ({
  opened,
  onHide,
  onPick,
  mobile,
  pttchrome,
}) => {
  const title = i18n("markReadChoice_title");
  const body = (
    <Stack gap="sm" data-mark-read-choice="">
      <Text size="sm" c="dimmed">
        {i18n("markReadChoice_hint")}
      </Text>
      <Button data-mark-read="U" variant="light" onClick={() => onPick("U")}>
        {i18n("markReadChoice_allUnread")}
      </Button>
      <Button data-mark-read="V" variant="light" onClick={() => onPick("V")}>
        {i18n("markReadChoice_allRead")}
      </Button>
      <Button data-mark-read="W" variant="light" onClick={() => onPick("W")}>
        {i18n("markReadChoice_readBefore")}
      </Button>
      <Button
        data-autofocus
        data-mark-read="cancel"
        variant="default"
        onClick={onHide}
      >
        {i18n("markReadChoice_cancel")}
      </Button>
    </Stack>
  );

  if (mobile)
    return (
      <MobileSheet
        pttchrome={pttchrome}
        opened={opened}
        onClose={onHide}
        title={title}
        sheetKey="markReadChoice"
      >
        {body}
      </MobileSheet>
    );
  return (
    <Modal opened={opened} onClose={onHide} title={title} centered>
      {body}
    </Modal>
  );
};

export default MarkReadChoiceModal;
