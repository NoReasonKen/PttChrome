import { useEffect, useRef, useState } from "react";
import { Modal, Button, Group, Stack, Text } from "@mantine/core";
import { i18n } from "../../js/i18n";
import { HINT_ERROR } from "../../js/status_hint";
import { formatArticleCode } from "../../js/article_link_target";
import MobileSheet from "../MobileSheet";

// Article information (js/post_info.js, #261): the box PTT's `Q` drew, read
// into { aid, board, url, urlNote, details }. The article code and the web
// address can be copied; null = closed. PTT's box is already dismissed, so
// closing this sends nothing.
export const PostInfoModal = ({ info: opened, onHide, mobile, pttchrome }) => {
  const [copied, setCopied] = useState(null);
  useEffect(() => setCopied(null), [opened]);
  // The last information stays drawn while the sheet slides away.
  const last = useRef(null);
  if (opened) last.current = opened;
  const info = opened || last.current;
  const code = info ? formatArticleCode(info) : null;
  const copy = (field, text) => {
    Promise.resolve(pttchrome.doCopy(text)).then((ok) => {
      if (ok) setCopied(field);
      else
        pttchrome.view?.flashListHint?.(
          i18n("postInfo_copyFailed"),
          3000,
          HINT_ERROR,
        );
    });
  };
  const field = (name, label, value, copyLabel) => (
    <Stack gap={4} data-post-info-field={name}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="sm" style={{ wordBreak: "break-all" }} data-post-info-value>
        {value}
      </Text>
      <Group>
        <Button
          size="xs"
          variant="light"
          data-post-info-copy={name}
          onClick={() => copy(name, value)}
        >
          {copied === name ? i18n("postInfo_copied") : copyLabel}
        </Button>
      </Group>
    </Stack>
  );
  const body = info ? (
    // The open puts focus on the information itself, not on its first copy
    // button: opened by a key (`Q`), that button would show the keyboard's
    // focus ring, which no other entrance shows (HelpMenu's list does the
    // same). Tab still moves into the buttons, Escape still closes.
    <Stack
      gap="md"
      data-post-info={info.aid}
      tabIndex={-1}
      data-autofocus
      style={{ outline: "none" }}
    >
      {field("code", i18n("postInfo_code"), code, i18n("postInfo_copyCode"))}
      {info.url ? (
        field("url", i18n("postInfo_url"), info.url, i18n("postInfo_copyUrl"))
      ) : info.urlNote ? (
        <Text size="sm" c="dimmed" data-post-info-field="urlNote">
          {info.urlNote}
        </Text>
      ) : null}
      {info.details.map((line, i) => (
        <Text key={i} size="sm" data-post-info-field="detail">
          {line}
        </Text>
      ))}
    </Stack>
  ) : null;

  if (mobile)
    return (
      <MobileSheet
        pttchrome={pttchrome}
        opened={!!opened}
        onClose={onHide}
        title={i18n("postInfo_title")}
        sheetKey="postInfo"
      >
        {body}
      </MobileSheet>
    );
  return (
    <Modal
      opened={!!opened}
      onClose={onHide}
      title={i18n("postInfo_title")}
      centered
    >
      {body}
    </Modal>
  );
};

export default PostInfoModal;
