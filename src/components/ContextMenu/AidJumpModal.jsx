import { useEffect, useState } from "react";
import { Modal, TextInput, Button, Group } from "@mantine/core";
import { i18n } from "../../js/i18n";
import MobileSheet from "../MobileSheet";
import { parseAidJumpInput } from "../../js/aid_jump";
import { AID_INPUT_MAX_LENGTH } from "../../js/aid_codec";

// Jump to an article by its code from the easy-reading article list (#253,
// js/aid_jump.js), presented like the search sheet: a bottom sheet on the
// phone, a modal on the desktop. onConfirm(text) gets the text of a code (any
// form aid_jump.parseAidJumpInput takes); cancelling sends nothing.
export const AidJumpModal = ({
  show,
  onHide,
  onConfirm,
  mobile,
  pttchrome,
}) => {
  const [value, setValue] = useState("");
  // The input starts empty each time it opens.
  useEffect(() => {
    if (show) setValue("");
  }, [show]);
  const valid = !!parseAidJumpInput(value);
  const title = i18n("aidJump_title");
  const form = (
    <form
      data-aid-jump=""
      onSubmit={(event) => {
        event.preventDefault();
        if (valid) onConfirm(value);
      }}
    >
      <TextInput
        data-autofocus
        name="aidCode"
        maxLength={AID_INPUT_MAX_LENGTH}
        label={i18n("aidJump_label")}
        placeholder={i18n("aidJump_placeholder")}
        autoComplete="off"
        autoCapitalize="off"
        spellCheck={false}
        value={value}
        onChange={(event) => setValue(event.currentTarget.value)}
      />
      <Group justify="flex-end" mt="md">
        <Button variant="default" onClick={onHide}>
          {i18n("searchModal_cancel")}
        </Button>
        <Button type="submit" disabled={!valid}>
          {i18n("aidJump_confirm")}
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
        sheetKey="aidJump"
      >
        {form}
      </MobileSheet>
    );
  return (
    <Modal
      opened={show}
      onClose={onHide}
      title={title}
      yOffset="10vh"
      size="lg"
    >
      {form}
    </Modal>
  );
};

export default AidJumpModal;
