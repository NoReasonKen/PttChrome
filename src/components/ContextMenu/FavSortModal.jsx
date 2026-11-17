import { Modal, Button, Stack, Text } from "@mantine/core";
import { i18n } from "../../js/i18n";
import MobileSheet from "../MobileSheet";

// Reordering the favorites (#221): PTT's `S` on the favorites rewrites their
// saved order, which cannot be undone, so easy reading asks here first. A
// pick goes to board_list_session.reorderFavorites ('name' or 'class');
// cancel or closing sends nothing.
export const FavSortModal = ({ opened, onHide, onPick, mobile, pttchrome }) => {
  const title = i18n("favSort_title");
  const body = (
    <Stack gap="sm" data-fav-sort-choice="">
      <Text size="sm" c="red">
        {i18n("favSort_warning")}
      </Text>
      <Button data-fav-sort="name" color="red" onClick={() => onPick("name")}>
        {i18n("favSort_byName")}
      </Button>
      <Button
        data-fav-sort="class"
        color="red"
        variant="light"
        onClick={() => onPick("class")}
      >
        {i18n("favSort_byClass")}
      </Button>
      <Button
        data-autofocus
        data-fav-sort="cancel"
        variant="default"
        onClick={onHide}
      >
        {i18n("favSort_cancel")}
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
        sheetKey="favSort"
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

export default FavSortModal;
