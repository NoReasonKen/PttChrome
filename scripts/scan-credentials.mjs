import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { credentialFindings, redactCredentials } from "./credential-patterns.mjs";

function git(args) {
  return execFileSync("git", args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
}

function credentialFile(file) {
  return /(?:^|\/)\.env(?:\..*)?$/.test(file) && !file.endsWith("/.env.example") && file !== ".env.example" ||
    /\.(?:p12|pfx|jks|keystore)$/i.test(file) ||
    /(?:^|\/)keystore\.properties$/.test(file);
}

export function scanCredentials(mode) {
  if (!["--staged", "--tracked"].includes(mode)) {
    console.error("Usage: node scripts/scan-credentials.mjs --staged|--tracked");
    return 2;
  }
  try {
    const args = mode === "--staged"
      ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
      : ["ls-files", "-z"];
    const files = git(args).toString("utf8").split("\0").filter(Boolean);
    const findings = [];
    for (const file of files) {
      const label = redactCredentials(JSON.stringify(file));
      if (credentialFile(file)) {
        findings.push(label + ":1: credential-file");
        continue;
      }
      // Read the index, never the working copy: partial staging must be safe.
      const content = git(["show", ":" + file]);
      for (const { rule, line } of credentialFindings(content.toString("utf8"))) {
        findings.push(label + ":" + line + ": " + rule);
      }
    }
    if (findings.length) {
      console.error("Credential check blocked this snapshot (values withheld):\n" + findings.join("\n"));
      return 1;
    }
    console.log("Credential check passed (" + mode.slice(2) + " snapshot).");
    return 0;
  } catch {
    // Git errors can include source data; fail closed without echoing them.
    console.error("Credential check could not read the Git snapshot. Resolve Git/index errors and rerun.");
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = scanCredentials(process.argv[2]);
}
