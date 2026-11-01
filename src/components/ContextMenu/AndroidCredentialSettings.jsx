import { useEffect, useRef, useState } from "react";
import {
  Button,
  Group,
  Modal,
  Radio,
  Stack,
  Text,
  TextInput,
} from "@mantine/core";
import { i18n } from "../../js/i18n";
import { normalizeOtpSecret, isValidOtpSecret } from "../../js/totp";
import { packCredential } from "../../js/credential_pack";
import {
  androidEncryptedCredentialsAvailable,
  getAndroidCredentialStatus,
  saveAndroidCredentials,
  androidCredentialDeletionAvailable,
  deleteAndroidLocalCredentials,
} from "../../js/credential_store";
import {
  hasLegacyAutoLoginCredential,
  clearAndroidLegacyAutoLoginCredential,
} from "../../js/pref_storage";
import { invalidateSessionCredential } from "../../js/auto_login";
import { rememberCredential } from "../../js/credential_redaction";

const emptyDraft = () => ({ user: "", pass: "", otpSecret: "" });

// The credential draft never enters ordinary preference state. It stays alive
// across category changes, but is discarded when the whole settings dialog closes.
export function useAndroidCredentialDraft(show, enabled) {
  const [draft, setDraft] = useState(emptyDraft);
  const [status, setStatus] = useState(null);
  const source = status?.source ?? "local";
  const [result, setResult] = useState(null);
  const [fieldErrors, setFieldErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const busy = useRef(false);
  const statusRevision = useRef(0);
  const supported = enabled && androidEncryptedCredentialsAvailable();
  useEffect(() => {
    setDraft(emptyDraft());
    setResult(null);
    setSaved(false);
    setFieldErrors({});
    setStatus(null);
    setConfirmDelete(null);
    setLegacy(enabled && hasLegacyAutoLoginCredential());
    if (!show || !supported) return;
    let alive = true;
    const revision = ++statusRevision.current;
    getAndroidCredentialStatus().then((value) => {
      if (!alive || revision !== statusRevision.current) return;
      setStatus(value);
      if (!value) setResult("statusUnavailable");
    });
    return () => {
      alive = false;
    };
  }, [show, supported]);

  const hasCredentials = Object.values(draft).some(Boolean);
  const dirty = hasCredentials;
  const errors = hasCredentials
    ? {
        user: !draft.user.trim()
          ? "options_credentials_userRequired"
          : undefined,
        pass: !draft.pass ? "options_credentials_passwordRequired" : undefined,
        otpSecret:
          draft.otpSecret && !isValidOtpSecret(draft.otpSecret)
            ? "options_credentials_invalidSecret"
            : undefined,
      }
    : {};
  const valid = !Object.values(errors).some(Boolean);
  const change = (key, value) => {
    if (busy.current || draft[key] === value) return;
    const next = { ...draft, [key]: value };
    setDraft(next);
    setSaved(false);
    setFieldErrors((previous) => ({ ...previous, [key]: undefined }));
    setResult(null);
  };
  const discard = () => {
    if (busy.current) return;
    setDraft(emptyDraft());
    setResult(null);
    setSaved(false);
    setFieldErrors({});
  };
  const persist = async (payload) => {
    busy.current = true;
    setSaving(true);
    setResult(null);
    try {
      const outcome = await saveAndroidCredentials(payload);
      if (outcome.status !== "saved") {
        setResult(
          ["cancelled", "unreadable"].includes(outcome.status)
            ? outcome.status
            : "failed",
        );
        return false;
      }
      statusRevision.current += 1;
      invalidateSessionCredential();
      setStatus((previous) => ({
        ...previous,
        source: payload.source,
        [payload.source]: { presence: outcome.presence },
      }));
      return true;
    } finally {
      busy.current = false;
      setSaving(false);
    }
  };
  const chooseSource = async (value) => {
    if (
      busy.current ||
      !supported ||
      !status ||
      value === source ||
      !["local", "manager"].includes(value)
    )
      return;
    // Source selection never submits the credential draft or opens the provider.
    if (await persist({ source: value })) setSaved(false);
  };
  const save = async () => {
    if (busy.current || !supported || saved) return false;
    if (!status) {
      setResult("statusUnavailable");
      return false;
    }
    if (!dirty) return true;
    setFieldErrors(errors);
    if (!valid) {
      setResult(null);
      return false;
    }
    const credential = {
      ...draft,
      user: draft.user.trim(),
      otpSecret: normalizeOtpSecret(draft.otpSecret),
    };
    rememberCredential(credential);
    if (
      !(await persist({
        source,
        id: credential.user,
        password: packCredential(credential.pass, credential.otpSecret),
      }))
    )
      return false;
    setSaved(true);
    setDraft(emptyDraft());
    setFieldErrors({});
    if (source === "local") {
      if (clearAndroidLegacyAutoLoginCredential()) setLegacy(false);
      else {
        setLegacy(true);
        setResult("legacyCleanupFailed");
        return false;
      }
    }
    return true;
  };
  const remove = async () => {
    if (busy.current || !confirmDelete) return;
    busy.current = true;
    setSaving(true);
    setResult(null);
    try {
      // A native delete can commit even if its acknowledgement is lost. Stop
      // cached/pending reuse before the confirmed attempt, never on cancellation.
      invalidateSessionCredential();
      if (confirmDelete === "legacy") {
        if (!clearAndroidLegacyAutoLoginCredential()) {
          setResult("deleteFailed");
          return;
        }
        setLegacy(false);
      } else {
        const outcome = await deleteAndroidLocalCredentials();
        if (outcome.status !== "deleted") {
          setResult("deleteFailed");
          return;
        }
        statusRevision.current += 1;
        setStatus((previous) => ({
          ...previous,
          source: outcome.source,
          local: { presence: outcome.presence },
        }));
      }
      setSaved(false);
      setResult("deleted");
    } finally {
      setConfirmDelete(null);
      busy.current = false;
      setSaving(false);
    }
  };
  return {
    draft,
    source,
    presence: status?.[source]?.error ? null : status?.[source]?.presence,
    sourceError: status?.[source]?.error,
    ready: !!status,
    chooseSource,
    result,
    saving,
    saved,
    supported,
    dirty,
    valid,
    fieldErrors,
    change,
    discard,
    save,
    busy,
    legacy,
    localPresent:
      !!status?.local?.error ||
      !!status?.local?.presence?.user ||
      !!status?.local?.presence?.password ||
      !!status?.local?.presence?.otpSecret,
    deletionSupported: supported && androidCredentialDeletionAvailable(),
    confirmDelete,
    requestDelete: (kind) => {
      if (!busy.current) setConfirmDelete(kind);
    },
    cancelDelete: () => {
      if (!busy.current) setConfirmDelete(null);
    },
    remove,
  };
}

export function AndroidCredentialSettings({ editor, anchor }) {
  const [secretFocused, setSecretFocused] = useState(false);
  const showSecretHelp = secretFocused || !!editor.draft.otpSecret;
  return (
    <>
      <Text size="sm" mb="xs">
        {i18n("tooltip_androidCredentials")}
      </Text>
      {editor.legacy && (
        <Text role="note" c="yellow" mb="xs">
          {i18n("options_credentialsLegacySetup")}
        </Text>
      )}
      {!editor.supported && (
        <Text role="alert" c="yellow" mb="xs">
          {i18n("options_credentialsUpgrade")}
        </Text>
      )}
      <Radio.Group
        name="androidCredentialSource"
        label={i18n("options_credentialsSource")}
        value={editor.source}
        onChange={editor.chooseSource}
        mb="sm"
      >
        <Stack gap="xs" mt="xs">
          {["local", "manager"].map((source) => (
            <Radio
              key={source}
              value={source}
              label={i18n("options_credentialsSource_" + source)}
              disabled={!editor.supported || !editor.ready || editor.saving}
            />
          ))}
        </Stack>
      </Radio.Group>
      {editor.sourceError && (
        <Text role="alert" c="red" mb="xs">
          {i18n(
            "options_credentials_" +
              (editor.sourceError === "unreadable"
                ? "unreadable"
                : "statusUnavailable"),
          )}
        </Text>
      )}
      {[
        ["user", "autoLoginUser", "text", "off"],
        ["pass", "autoLoginPassword", "password", "new-password"],
        ["otpSecret", "autoLoginOtpSecret", "text", "off"],
      ].map(([key, name, type, autoComplete]) => {
        const statusKey = key === "pass" ? "password" : key;
        return (
          <TextInput
            key={key}
            name={name}
            type={type}
            autoComplete={autoComplete}
            label={i18n("options_" + name)}
            value={editor.draft[key]}
            styles={{
              input: {
                "--input-color": "var(--mantine-color-text)",
                "--input-placeholder-color": "var(--mantine-color-placeholder)",
              },
            }}
            error={
              editor.fieldErrors[key]
                ? i18n(editor.fieldErrors[key])
                : undefined
            }
            placeholder={
              editor.presence
                ? i18n(
                    `placeholder_${editor.source}_${statusKey}_${editor.presence[statusKey] ? "saved" : "empty"}`,
                  )
                : undefined
            }
            onChange={(event) => editor.change(key, event.currentTarget.value)}
            onFocus={
              key === "otpSecret" ? () => setSecretFocused(true) : undefined
            }
            onBlur={
              key === "otpSecret"
                ? () => {
                    setSecretFocused(false);
                    const raw = editor.draft[key];
                    editor.change(key, normalizeOtpSecret(raw) || raw.trim());
                  }
                : undefined
            }
            disabled={!editor.supported || !editor.ready || editor.saving}
            maxLength={key === "pass" ? 72 : undefined}
            mb="xs"
            {...anchor(name)}
          />
        );
      })}
      {showSecretHelp && (
        <>
          <Text size="xs" c="dimmed" mb="xs">
            {i18n("tooltip_androidCredentialSecret")}
          </Text>
          <Text className="PrefModal__warning">
            {i18n("tooltip_androidCredentialSecretRisk")}
          </Text>
        </>
      )}
      <Group
        className="PrefModal__CredentialActions"
        justify="space-between"
        align="stretch"
        wrap="nowrap"
        gap="xs"
      >
        <Button
          variant="default"
          onClick={editor.save}
          loading={editor.saving}
          disabled={
            !editor.supported || !editor.ready || !editor.dirty || editor.saved
          }
        >
          {i18n(
            editor.saved
              ? "options_credentials_saved"
              : "options_credentialsSave",
          )}
        </Button>
        <Button
          color="red"
          disabled={
            !editor.deletionSupported ||
            !editor.ready ||
            !editor.localPresent ||
            editor.saving
          }
          onClick={() => editor.requestDelete("local")}
        >
          {i18n("options_credentialsDeleteLocal")}
        </Button>
      </Group>
      {editor.result && (
        <Text role="status" size="sm" mt="xs">
          {i18n("options_credentials_" + editor.result)}
        </Text>
      )}
      {editor.legacy && (
        <Button
          variant="default"
          size="xs"
          mt="sm"
          disabled={editor.saving}
          onClick={() => editor.requestDelete("legacy")}
        >
          {i18n("options_credentialsDeleteLegacy")}
        </Button>
      )}
      {editor.supported && !editor.deletionSupported && (
        <Text size="xs" c="dimmed" mt="xs">
          {i18n("options_credentialsDeleteUpgrade")}
        </Text>
      )}
      <Modal
        opened={!!editor.confirmDelete}
        onClose={editor.cancelDelete}
        title={i18n(
          editor.confirmDelete === "legacy"
            ? "options_credentialsDeleteLegacy"
            : "options_credentialsDeleteLocal",
        )}
        closeOnEscape={!editor.saving}
        closeOnClickOutside={!editor.saving}
        withCloseButton={!editor.saving}
      >
        <Text mb="sm">{i18n("options_credentialsDeleteConfirm")}</Text>
        <Group>
          <Button color="red" onClick={editor.remove} loading={editor.saving}>
            {i18n("options_credentialsConfirmDelete")}
          </Button>
          <Button
            variant="default"
            onClick={editor.cancelDelete}
            disabled={editor.saving}
          >
            {i18n("options_credentialsCancelDelete")}
          </Button>
        </Group>
      </Modal>
    </>
  );
}

export function UnsavedCredentialsDialog({
  opened,
  editor,
  onContinue,
  onDiscard,
  onSave,
}) {
  return (
    <Modal
      opened={opened}
      title={i18n("options_credentialsUnsaved")}
      onClose={onContinue}
      closeOnEscape={!editor.saving}
      closeOnClickOutside={!editor.saving}
      withCloseButton={!editor.saving}
    >
      <Text mb="sm">{i18n("tooltip_credentialsUnsaved")}</Text>
      {editor.result && (
        <Text role="status" mb="sm">
          {i18n("options_credentials_" + editor.result)}
        </Text>
      )}
      <Group>
        <Button
          variant="default"
          onClick={onSave}
          loading={editor.saving}
          disabled={editor.saved}
        >
          {i18n("options_credentialsSave")}
        </Button>
        <Button variant="default" onClick={onDiscard} disabled={editor.saving}>
          {i18n("options_credentialsDiscard")}
        </Button>
        <Button variant="default" onClick={onContinue} disabled={editor.saving}>
          {i18n("options_credentialsContinue")}
        </Button>
      </Group>
    </Modal>
  );
}
