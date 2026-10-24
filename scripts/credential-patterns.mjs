// Recognizable credential formats, plus this repository's browser-key policy.
// Findings intentionally contain locations and rule names, never matched values.
const RULES = [
  ["private-key", /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----/g],
  ["github-token", /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/g],
  ["browser-key-policy", /\bAIza[A-Za-z0-9_-]{35}(?![A-Za-z0-9_-])/g],
  ["google-oauth-secret", /\bGOCSPX-[A-Za-z0-9_-]{20,}/g],
  ["google-access-token", /\bya29\.[A-Za-z0-9_.-]{20,}/g],
  ["google-refresh-token", /\b1\/\/[A-Za-z0-9_-]{20,}/g],
  ["credential-assignment", /(?<![\w"'])(["']?)(?:client_secret|private_key|refresh_token|access_token|APPCHECK_DEBUG_TOKEN|ANDROID_KEYSTORE_PASSWORD|ANDROID_KEY_PASSWORD)\1\s*[:=]\s*(?:"(?:\\.|[^"\\\r\n]){20,}"|'(?:\\.|[^'\\\r\n]){20,}'|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})/gi],
];

export function credentialFindings(text) {
  const findings = [];
  for (const [rule, pattern] of RULES) {
    for (const match of text.matchAll(pattern)) {
      findings.push({ rule, line: text.slice(0, match.index).split("\n").length });
    }
  }
  return findings;
}

export function redactCredentials(text) {
  let result = String(text).replace(
    /-----BEGIN ((?:[A-Z0-9]+ )*PRIVATE KEY)-----[\s\S]*?(?:-----END \1-----|$)/g,
    "[REDACTED]",
  );
  result = result
    .replace(/(\bauthorization:\s*(?:bearer|basic)\s+)[^\s"',]+/gi, "$1[REDACTED]")
    .replace(
      /(\b(?:password|client_secret|private_key|refresh_token|access_token|api[_-]?key|FIREBASE_API_KEY|APPCHECK_DEBUG_TOKEN|ANDROID_KEYSTORE_PASSWORD|ANDROID_KEY_PASSWORD)\b["']?\s*[:=]\s*)(?:"(?:\\.|[^"\\\r\n])*"|'(?:\\.|[^'\\\r\n])*'|[^\r\n&,"']+)/gi,
      "$1[REDACTED]",
    );
  // Preserve the field name until its whole value has been removed. Matching a
  // signature first can otherwise leave a password suffix with no key to find.
  for (const [, pattern] of RULES) result = result.replace(pattern, "[REDACTED]");
  return result;
}
