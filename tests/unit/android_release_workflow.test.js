import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const workflow = fs.readFileSync(
  path.join(__dirname, "../../.github/workflows/android.yml"),
  "utf8",
);

const step = (name) => {
  const start = workflow.indexOf(`      - name: ${name}\n`);
  expect(start, `Missing workflow step: ${name}`).toBeGreaterThanOrEqual(0);
  const end = workflow.indexOf("\n      - ", start + 1);
  return workflow.slice(start, end < 0 ? undefined : end);
};

const signingInputs = [
  "ANDROID_KEYSTORE_B64",
  "ANDROID_KEYSTORE_PASSWORD",
  "ANDROID_KEY_ALIAS",
  "ANDROID_KEY_PASSWORD",
];

const runSigningGuard = (missing) => {
  const lines = step("Validate release signing inputs").split("\n");
  const script = lines
    .slice(lines.indexOf("        run: |") + 1)
    .filter((line) => line.startsWith("          ") || line === "")
    .map((line) => line.slice(10))
    .join("\n");
  const env = { ...process.env };
  for (const name of signingInputs) {
    env[name] = name === missing ? "" : `private-value-${name}`;
  }
  return spawnSync("bash", ["--noprofile", "--norc", "-e", "-c", script], {
    env,
    encoding: "utf8",
  });
};

// Inherited upstream tags (android-v*) must never trigger this fork's release.
test("only fork release tags trigger and gate a release", () => {
  expect(workflow).toContain("tags: ['android-fork-v*']");
  expect(workflow).not.toMatch(/refs\/tags\/android-v/);
  expect(step("Publish release")).toContain(
    "if: startsWith(github.ref, 'refs/tags/android-fork-v')",
  );
});

test("release tags require signing before decoding or building, while non-release builds skip the guard", () => {
  expect(step("Validate release signing inputs")).toContain(
    "if: startsWith(github.ref, 'refs/tags/android-fork-v')",
  );
  expect(
    workflow.indexOf("name: Validate release signing inputs"),
  ).toBeLessThan(workflow.indexOf("name: Decode signing keystore"));
});

test.each(signingInputs)(
  "missing %s rejects a release without printing secret values",
  (name) => {
    const result = runSigningGuard(name);
    expect(result.status).toBe(1);
    expect(result.stdout + result.stderr).toContain(name);
    expect(result.stdout + result.stderr).not.toContain("private-value-");
  },
);

test("complete signing inputs allow the release guard to pass", () => {
  const result = runSigningGuard();
  expect(result.status, result.stderr).toBe(0);
  expect(result.stdout + result.stderr).not.toContain("private-value-");
});
