import { useState, useEffect, useCallback, useRef } from "react";
import { Modal, Button, Group, Text } from "@mantine/core";
import { i18n } from "../../js/i18n";
import MobileSheet from "../MobileSheet";
import "./HelpMenu.css";

// 說明選單好讀（docs/help-menu.md）：PTT 新版 `h` 說明（分頁的游標選單）由
// js/help_menu.js#HelpMenuController 認出、背景補齊全部頁，這裡一次列出來，點一下＝
// 執行（控制器送 Home → PgDn… → ↓… → Enter，等同原生在那一項上按 Enter）。
// 桌機＝Mantine Modal（↑↓／Home／End 移動、Enter 執行、q／←／Esc 離開，同原生鍵位）；
// 手機＝bottom sheet（系統返回＝離開，同原生 q）。
// 從好讀頁要求的說明選單（#222）：每項帶 available；那個頁面不收的鍵、說明本身、
// 沒有單一鍵的項目畫成不可用（變暗、disabled、鍵盤跳過），小天使不出現。
// 開著＝modal：桌機經 App.setModalOpen("helpMenu")；手機 MobileSheet 自己登記。
const EMPTY = {
  open: false,
  caption: "",
  angel: false,
  items: [],
  loading: false,
};

export const HelpMenu = ({ pttchrome, mobile }) => {
  const ctrl = pttchrome ? pttchrome.helpMenu : null;
  const [snap, setSnap] = useState(() => (ctrl ? ctrl.snapshot() : EMPTY));
  const [active, setActive] = useState(0);
  const itemRefs = useRef([]);

  useEffect(() => {
    if (!ctrl) return undefined;
    ctrl.onChange = setSnap;
    setSnap(ctrl.snapshot());
    return () => {
      if (ctrl.onChange === setSnap) ctrl.onChange = null;
    };
  }, [ctrl]);

  useEffect(() => {
    if (mobile || !pttchrome || typeof pttchrome.setModalOpen !== "function")
      return undefined;
    pttchrome.setModalOpen("helpMenu", snap.open);
    return () => pttchrome.setModalOpen("helpMenu", false);
  }, [pttchrome, mobile, snap.open]);

  // The rows the reader can pick (#222: a detachable visit marks the others
  // unavailable). Keyboard moves skip the others.
  const pickable = useCallback(
    (i) => !!snap.items[i] && snap.items[i].available !== false,
    [snap.items],
  );
  const firstPickable = snap.items.findIndex(
    (item) => item.available !== false,
  );

  useEffect(() => {
    if (snap.open) setActive(Math.max(0, firstPickable));
    // Only when the sheet opens: rows arriving later do not move the reader.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.open]);

  const onClose = useCallback(() => ctrl && ctrl.close(), [ctrl]);
  const onAngel = useCallback(() => ctrl && ctrl.callAngel(), [ctrl]);
  const onSelect = useCallback((i) => ctrl && ctrl.select(i), [ctrl]);

  const focusItem = useCallback((i) => {
    setActive(i);
    const el = itemRefs.current[i];
    if (el) {
      el.focus();
      if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }
  }, []);

  // 鍵位比照原生說明選單（psb.c#cmd_show_help_layers_inner）。Esc 由 Modal 自己收。
  const onKeyDown = useCallback(
    (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      const n = snap.items.length;
      // The nearest pickable row from `from` in direction `dir`; -1 if none.
      const seek = (from, dir) => {
        for (let i = from; i >= 0 && i < n; i += dir) if (pickable(i)) return i;
        return -1;
      };
      const move = (i) => {
        if (i >= 0) focusItem(i);
      };
      let handled = true;
      switch (e.key) {
        case "ArrowDown":
          move(seek(active + 1, 1));
          break;
        case "ArrowUp":
          move(seek(active - 1, -1));
          break;
        case "Home":
          move(seek(0, 1));
          break;
        case "End":
          move(seek(n - 1, -1));
          break;
        case "Enter":
        case "ArrowRight":
          if (pickable(active)) onSelect(active);
          break;
        case "q":
        case "Q":
        case "ArrowLeft":
          onClose();
          break;
        case "h":
        case "H":
          if (snap.angel) onAngel();
          else handled = false;
          break;
        default:
          handled = false;
      }
      if (handled) e.preventDefault();
    },
    [
      snap.items.length,
      pickable,
      snap.angel,
      active,
      focusItem,
      onSelect,
      onClose,
      onAngel,
    ],
  );

  const title = snap.caption
    ? i18n("helpMenu_titleWith").replace("{0}", snap.caption)
    : i18n("helpMenu_title");

  const list = (
    <div
      className="helpMenuList"
      data-help-menu-list
      data-mobile={mobile ? "" : undefined}
      role="listbox"
      aria-label={title}
    >
      {snap.items.map((item, i) => {
        const unavailable = item.available === false;
        return (
          <button
            type="button"
            key={item.keysText + "\t" + item.label}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className="helpMenuItem"
            role="option"
            aria-selected={i === active && !unavailable}
            // Unavailable on this page (#222): not focusable, not pickable.
            disabled={unavailable}
            aria-disabled={unavailable ? true : undefined}
            data-unavailable={unavailable ? "" : undefined}
            data-help-item={i}
            data-active={i === active && !unavailable ? "" : undefined}
            // Modal 開的當下焦點落在第一個可選的項目：鍵盤使用者直接 ↑↓／Enter。
            data-autofocus={i === firstPickable ? true : undefined}
            onClick={() => onSelect(i)}
            onFocus={() => setActive(i)}
          >
            <span className="helpMenuKeys">
              {item.keys.map((k, j) => (
                <kbd key={j} className="helpMenuKey">
                  {k}
                </kbd>
              ))}
            </span>
            <span className="helpMenuLabel">{item.label}</span>
            <span className="helpMenuDesc">{item.help}</span>
          </button>
        );
      })}
      {snap.loading ? (
        <Text
          size="xs"
          c="dimmed"
          className="helpMenuLoading"
          data-help-loading
        >
          {i18n("helpMenu_loading")}
        </Text>
      ) : null}
    </div>
  );

  const footer = (
    <Group gap="xs" justify="flex-end" className="helpMenuFooter">
      {snap.angel ? (
        <Button
          variant="default"
          size={mobile ? "sm" : "xs"}
          onClick={onAngel}
          data-help-angel
        >
          {i18n("helpMenu_angel")}
        </Button>
      ) : null}
      <Button
        variant="default"
        size={mobile ? "sm" : "xs"}
        onClick={onClose}
        data-help-close
      >
        {i18n("helpMenu_close")}
      </Button>
    </Group>
  );

  if (mobile)
    return (
      <MobileSheet
        pttchrome={pttchrome}
        opened={snap.open}
        onClose={onClose}
        title={title}
        sheetKey="help"
        footer={footer}
      >
        {list}
      </MobileSheet>
    );
  return (
    <Modal
      opened={snap.open}
      onClose={onClose}
      title={title}
      size="lg"
      yOffset="5vh"
    >
      <div onKeyDown={onKeyDown} data-help-menu>
        {list}
        {footer}
      </div>
    </Modal>
  );
};

export default HelpMenu;
