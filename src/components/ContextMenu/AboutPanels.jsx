import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button, Modal, Switch, Text } from "@mantine/core";
import { i18n } from "../../js/i18n";
import {
  getUpdateState,
  subscribeUpdates,
  updateAction,
} from "../../js/app_updates";
import { releaseHistory, summaryForLocale } from "../../js/release_history";
import "./AboutPanels.css";

export function AboutVersionSources({ current, upstream, original }) {
  const state = useSyncExternalStore(subscribeUpdates, getUpdateState);
  return (
    <details className="AboutTree" data-about-section="sources">
      <summary>{i18n("about_version_title")}</summary>
      <details data-about-source="current">
        <summary>{i18n("about_source_current")}</summary>
        <Text>{current}</Text>
        {state.installedVersion && (
          <Text>
            {i18n("about_apk_version")}: {state.installedVersion}
          </Text>
        )}
        <Text>
          build: <code>{process.env.GIT_COMMIT}</code> ({process.env.BUILD_TIME}
          )
        </Text>
      </details>
      <details data-about-source="upstream">
        <summary>{i18n("about_source_upstream")}</summary>
        <Text>{upstream}</Text>
      </details>
      <details data-about-source="original">
        <summary>{i18n("about_source_original")}</summary>
        <Text>{original}</Text>
      </details>
    </details>
  );
}

export function AboutReleaseHistory() {
  const state = useSyncExternalStore(subscribeUpdates, getUpdateState);
  return (
    <details className="AboutTree" data-about-section="history">
      <summary>{i18n("about_release_history")}</summary>
      {releaseHistory().map((record) => (
        <details key={record.version}>
          <summary>{record.version}</summary>
          <ul>
            {summaryForLocale(record, state.systemLanguage).map(
              (line, index) => (
                <li key={index}>{line}</li>
              ),
            )}
          </ul>
        </details>
      ))}
    </details>
  );
}

export function AboutUpdate({ offerRequest, registerBack, onOfferChange }) {
  const state = useSyncExternalStore(subscribeUpdates, getUpdateState);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [awaitingCheck, setAwaitingCheck] = useState(false);
  const [noUpdate, setNoUpdate] = useState(false);
  const [offerOpen, setOfferOpen] = useState(false);
  const consumedOffer = useRef(null);
  const offeredRelease =
    state.latestRelease?.versionCode > state.installedVersionCode
      ? state.latestRelease
      : state.release;
  useEffect(() => {
    onOfferChange?.(offerOpen);
    return () => onOfferChange?.(false);
  }, [offerOpen, onOfferChange]);
  useEffect(() => {
    if (offerOpen) return registerBack?.(() => setOfferOpen(false));
  }, [offerOpen, registerBack]);
  const busy =
    pending ||
    ["checking", "downloading", "paused", "verifying"].includes(state.phase);
  const run = async (action, payload) => {
    setError("");
    setPending(true);
    try {
      return await updateAction(action, payload);
    } catch (failure) {
      setError(failure.message || String(failure));
      setAwaitingCheck(false);
    } finally {
      setPending(false);
    }
  };
  useEffect(() => {
    if (!awaitingCheck || busy) return;
    setAwaitingCheck(false);
    if (error || state.lastError) return;
    if (offeredRelease) setOfferOpen(true);
    else setNoUpdate(true);
  }, [awaitingCheck, busy, error, state.lastError, offeredRelease]);
  useEffect(() => {
    if (!noUpdate) return;
    const timer = setTimeout(() => setNoUpdate(false), 3000);
    return () => clearTimeout(timer);
  }, [noUpdate]);
  useEffect(() => {
    if (
      offerRequest &&
      offeredRelease &&
      consumedOffer.current !== offerRequest
    ) {
      consumedOffer.current = offerRequest;
      setOfferOpen(true);
    }
  }, [offerRequest, offeredRelease]);
  const check = () => {
    setNoUpdate(false);
    setAwaitingCheck(true);
    void run("check", { manual: true });
  };
  const retainedOffer =
    state.phase === "ready" && state.release?.id === offeredRelease?.id;
  const download = () => {
    setOfferOpen(false);
    void run(retainedOffer ? "install" : "download", {
      releaseId: offeredRelease.id,
    });
  };
  return (
    <>
      <details className="AboutTree" data-about-section="update">
        <summary>{i18n("about_update_title")}</summary>
        <div className="AboutUpdateInfo">
          {!state.supported ? (
            <>
              <Text>{i18n("about_update_unsupported")}</Text>
              <a
                href="https://github.com/NoReasonKen/PttChrome/releases"
                target="_blank"
                rel="noreferrer"
              >
                {i18n("about_update_releases")}
              </a>
            </>
          ) : (
            <>
              <Text>
                {i18n("about_update_version")}: {state.installedVersion}
              </Text>
              <Switch
                checked={!!state.automaticChecks}
                disabled={busy}
                label={i18n("about_update_automatic")}
                onChange={(event) =>
                  run("preferences", {
                    automaticChecks: event.currentTarget.checked,
                  })
                }
              />
              <Text size="sm">
                {i18n("about_update_last_check")}:{" "}
                {state.lastSuccessfulCheck > 0
                  ? new Date(state.lastSuccessfulCheck).toLocaleString()
                  : i18n("about_update_phase_idle")}
              </Text>
              <Text role="status">
                {i18n(
                  error || state.lastError
                    ? "about_update_phase_error"
                    : state.phase === "idle" && state.lastSuccessfulCheck > 0
                      ? "about_update_up_to_date"
                      : "about_update_phase_" + state.phase,
                )}
              </Text>
              {state.phase === "ready" && (
                <Button
                  variant="default"
                  disabled={busy}
                  onClick={() =>
                    run("install", { releaseId: state.release.id })
                  }
                >
                  {i18n("about_update_install")}
                </Button>
              )}
            </>
          )}
        </div>
      </details>
      {state.supported && (
        <div className="AboutUpdateActions">
          <Button disabled={busy || noUpdate} onClick={check}>
            {i18n(noUpdate ? "about_update_none" : "about_update_check")}
          </Button>
        </div>
      )}
      {(error || state.lastError) && (
        <Text role="alert">{error || state.lastError}</Text>
      )}
      <Modal
        opened={offerOpen && !!offeredRelease}
        onClose={() => setOfferOpen(false)}
        title={i18n("about_update_downloadable")}
        centered
        zIndex={11000}
      >
        {offeredRelease && (
          <section data-app-update-offer>
            <Text fw={600}>{offeredRelease.version}</Text>
            <ul>
              {summaryForLocale(offeredRelease, state.systemLanguage).map(
                (line, index) => (
                  <li key={index}>{line}</li>
                ),
              )}
            </ul>
            {!state.needsNativeUpdate && (
              <Text size="sm">{i18n("about_update_web_only")}</Text>
            )}
            <Text size="sm">
              {i18n("about_update_size")}:{" "}
              {formatDownloadSize(offeredRelease.apk?.size)}
            </Text>
            <div className="AboutUpdateActions">
              <Button disabled={busy} onClick={download}>
                {i18n(
                  retainedOffer
                    ? "about_update_install"
                    : "about_update_download",
                )}
              </Button>
              <Button variant="default" onClick={() => setOfferOpen(false)}>
                {i18n("about_update_cancel")}
              </Button>
            </div>
          </section>
        )}
      </Modal>
    </>
  );
}

export function formatDownloadSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0)
    return i18n("about_update_size_unknown");
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
