import { useState, useSyncExternalStore } from "react";
import { Button, Switch, Text, Title } from "@mantine/core";
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

export function AboutUpdate() {
  const state = useSyncExternalStore(subscribeUpdates, getUpdateState);
  const [error, setError] = useState("");
  const [confirmInstall, setConfirmInstall] = useState(false);
  const [pending, setPending] = useState(false);
  const run = async (action, payload) => {
    setError("");
    setPending(true);
    try {
      await updateAction(action, payload);
    } catch (failure) {
      setError(failure.message || String(failure));
    } finally {
      setPending(false);
    }
  };
  const busy =
    pending ||
    ["checking", "downloading", "paused", "verifying"].includes(state.phase);
  const install = async () => {
    setConfirmInstall(false);
    await run("install");
  };
  return (
    <section
      data-about-section="update"
      aria-label={i18n("about_update_title")}
    >
      <Title order={5}>{i18n("about_update_title")}</Title>
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
            {i18n("about_apk_version")}: {state.installedVersion}
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
          <Text role="status">
            {i18n(
              error || state.lastError
                ? "about_update_phase_error"
                : state.phase === "idle" && state.lastSuccessfulCheck > 0
                  ? "about_update_up_to_date"
                  : "about_update_phase_" + state.phase,
            )}
          </Text>
          {state.lastSuccessfulCheck > 0 && (
            <Text size="sm">
              {i18n("about_update_last_check")}:{" "}
              {new Date(state.lastSuccessfulCheck).toLocaleString()}
            </Text>
          )}
          {(error || state.lastError) && (
            <Text role="alert">{error || state.lastError}</Text>
          )}
          <div className="AboutUpdateActions">
            <Button
              disabled={busy}
              onClick={() => run("check", { manual: true })}
            >
              {i18n("about_update_check")}
            </Button>
          </div>
          {state.release && (
            <div>
              <Text>
                {i18n("about_update_available")}: {state.release.version}
              </Text>
              {!state.needsNativeUpdate && (
                <Text>{i18n("about_update_web_only")}</Text>
              )}
              <ul>
                {summaryForLocale(state.release, state.systemLanguage).map(
                  (line, index) => (
                    <li key={index}>{line}</li>
                  ),
                )}
              </ul>
              <Text size="sm">
                {i18n("about_update_size")}:{" "}
                {formatDownloadSize(state.release.apk?.size)}
              </Text>
              <div className="AboutUpdateActions">
                {state.phase !== "ready" && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      run("download", { releaseId: state.release.id })
                    }
                  >
                    {i18n("about_update_download")}
                  </Button>
                )}
                {state.phase === "ready" && (
                  <Button
                    disabled={busy}
                    onClick={() => setConfirmInstall(true)}
                  >
                    {i18n("about_update_install")}
                  </Button>
                )}
              </div>
            </div>
          )}
          {confirmInstall && state.phase === "ready" && (
            <div role="group" aria-label={i18n("about_update_install")}>
              <Text>{i18n("about_update_install_warning")}</Text>
              <div className="AboutUpdateActions">
                <Button disabled={pending} onClick={install}>
                  {i18n("about_update_confirm_install")}
                </Button>
                <Button
                  variant="default"
                  onClick={() => setConfirmInstall(false)}
                >
                  {i18n("about_update_later")}
                </Button>
              </div>
            </div>
          )}
          {state.phase === "ready" &&
            state.latestRelease &&
            state.latestRelease.id !== state.release?.id && (
              <div>
                <Text>
                  {i18n("about_update_available")}:{" "}
                  {state.latestRelease.version}
                </Text>
                <Text size="sm">
                  {i18n("about_update_size")}:{" "}
                  {formatDownloadSize(state.latestRelease.apk?.size)}
                </Text>
                <Button
                  disabled={busy}
                  onClick={() =>
                    run("download", { releaseId: state.latestRelease.id })
                  }
                >
                  {i18n("about_update_download")}
                </Button>
              </div>
            )}
        </>
      )}
    </section>
  );
}

export function formatDownloadSize(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0)
    return i18n("about_update_size_unknown");
  return bytes < 1024 * 1024
    ? `${Math.ceil(bytes / 1024)} KB`
    : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
