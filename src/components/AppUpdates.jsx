import { useEffect, useState, useSyncExternalStore } from "react";
import { Button, Modal, Text } from "@mantine/core";
import { i18n } from "../js/i18n";
import {
  getUpdateState,
  subscribeUpdates,
  updateAction,
  startUpdateRuntime,
  openUpdateAbout,
  updateBlocksInteraction,
} from "../js/app_updates";
import "./AppUpdates.css";

export function AppUpdates({ pttchrome }) {
  const state = useSyncExternalStore(subscribeUpdates, getUpdateState);
  const [error, setError] = useState("");
  const blocking = updateBlocksInteraction(state);
  useEffect(() => startUpdateRuntime(pttchrome), [pttchrome]);
  useEffect(() => {
    pttchrome.setModalOpen("appUpdate", blocking);
    const releaseBack = blocking
      ? pttchrome.registerSheetDismiss(() => {})
      : undefined;
    return () => {
      releaseBack?.();
      pttchrome.setModalOpen("appUpdate", false);
    };
  }, [pttchrome, blocking]);
  useEffect(() => {
    if (!blocking) return;
    const stopEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    window.addEventListener("keydown", stopEscape, true);
    window.addEventListener("keyup", stopEscape, true);
    return () => {
      window.removeEventListener("keydown", stopEscape, true);
      window.removeEventListener("keyup", stopEscape, true);
    };
  }, [blocking]);
  const act = async (action) => {
    setError("");
    try {
      await updateAction(
        action,
        action === "skip" ? { releaseId: state.release?.id } : {},
      );
    } catch (failure) {
      setError(failure.message);
    }
  };
  const { downloaded = 0, total = 0 } = state.progress || {};
  return (
    <>
      {state.supported && state.prompt && !blocking && (
        <aside className="AppUpdatePrompt" data-app-update-prompt role="status">
          <Text>
            {i18n("about_update_available")}: {state.release?.version}
          </Text>
          <div className="AppUpdateActions">
            <Button
              onClick={() => {
                openUpdateAbout();
                void act("later");
              }}
            >
              {i18n("about_update_view")}
            </Button>
            <Button variant="default" onClick={() => void act("later")}>
              {i18n("about_update_postpone")}
            </Button>
            <Button variant="subtle" onClick={() => void act("skip")}>
              {i18n("about_update_skip")}
            </Button>
          </div>
          {error && <Text role="alert">{error}</Text>}
        </aside>
      )}
      <Modal
        opened={blocking}
        onClose={() => {}}
        closeOnEscape={false}
        closeOnClickOutside={false}
        withCloseButton={false}
        zIndex={10000}
        title={i18n("about_update_phase_" + state.phase)}
        centered
      >
        <section data-app-update-block>
          <progress
            max={total || undefined}
            value={total > 0 ? downloaded : undefined}
          />
          <Text>
            {Math.ceil(downloaded / 1024)} /{" "}
            {total > 0 ? Math.ceil(total / 1024) : "?"} KB
          </Text>
          {(error || state.lastError) && (
            <Text role="alert">{error || state.lastError}</Text>
          )}
          <Button variant="default" onClick={() => void act("cancel")}>
            {i18n("about_update_cancel_download")}
          </Button>
        </section>
      </Modal>
    </>
  );
}
