import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const root = path.resolve(import.meta.dirname, "../..");
const script = path.join(root, "scripts/scan-credentials.mjs");
const temporary = [];
const browserKey = "AI" + "za" + "B".repeat(35);
const githubToken = "gh" + "p_" + "C".repeat(36);

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pttchrome-credentials-"));
  temporary.push(cwd);
  execFileSync("git", ["init", "--quiet", cwd]);
  return cwd;
}

function stage(cwd, file, content) {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), content);
  execFileSync("git", ["add", "--", file], { cwd });
}

function scan(cwd, mode = "--staged") {
  const result = spawnSync(process.execPath, [script, mode], { cwd, encoding: "utf8" });
  return { ...result, output: result.stdout + result.stderr };
}

afterEach(() => {
  for (const cwd of temporary.splice(0)) fs.rmSync(cwd, { recursive: true, force: true });
});

test("rejects a staged credential even when the working copy was cleaned afterward", () => {
  const cwd = fixture();
  stage(cwd, "source with spaces.js", `// example\nconst value = '${githubToken}';\n`);
  fs.writeFileSync(path.join(cwd, "source with spaces.js"), "const value = process.env.TOKEN;\n");
  const result = scan(cwd);
  expect(result.status).toBe(1);
  expect(result.output).toContain("github-token");
  expect(result.output).toContain("source with spaces.js");
  expect(result.output).toContain(":2:");
  expect(result.output).not.toContain(githubToken);
});

test("permits unstaged local credentials while inspecting only the staged snapshot", () => {
  const cwd = fixture();
  stage(cwd, "config.js", "export const value = process.env.TOKEN;\n");
  fs.writeFileSync(path.join(cwd, "config.js"), githubToken);
  const result = scan(cwd);
  expect(result.status).toBe(0);
  expect(result.output).not.toContain(githubToken);
});

test.each([
  ["browser-key-policy", browserKey],
  ["browser-key-policy", "AI" + "za" + "B".repeat(34) + "-"],
  ["google-oauth-secret", "GOC" + "SPX-" + "D".repeat(28)],
  ["google-access-token", "ya" + "29." + "E".repeat(30)],
  ["google-refresh-token", "1/" + "/" + "F".repeat(30)],
  ["private-key", "-----BEGIN " + "PRIVATE KEY-----\nbase64-material\n-----END PRIVATE KEY-----"],
  ["credential-assignment", '"client_secret": "' + "G".repeat(30) + '"'],
  ["credential-assignment", "APPCHECK_DEBUG_TOKEN=" + "b621086a-7522-4e0b-a40f-89f735214362"],
])("blocks %s without reporting its value", (rule, value) => {
  const cwd = fixture();
  stage(cwd, "nested/config.txt", value);
  const result = scan(cwd);
  expect(result.status).toBe(1);
  expect(result.output).toContain(rule);
  expect(result.output).not.toContain(value);
});

test.each([".env.local", "android/release.p12", "android/keystore.properties"])(
  "rejects credential file %s even if it is binary or contains an unfamiliar format",
  (file) => {
    const cwd = fixture();
    stage(cwd, file, Buffer.from([0, 1, 2, 3]));
    expect(scan(cwd).output).toContain("credential-file");
    expect(scan(cwd).status).toBe(1);
  },
);

test("allows public client identifiers, placeholder templates, and ordinary binary assets", () => {
  const cwd = fixture();
  stage(cwd, "config.js", 'export const clientId = "123.apps.googleusercontent.com";\n');
  stage(cwd, ".env.example", "FIREBASE_API_KEY=\nAPPCHECK_DEBUG_TOKEN=<local-only>\n");
  stage(cwd, "icon.png", Buffer.from([0, 1, 2, 3]));
  expect(scan(cwd).status).toBe(0);
});

test("recognizes a text credential embedded in binary data", () => {
  const cwd = fixture();
  stage(cwd, "attachment.bin", Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(githubToken)]));
  expect(scan(cwd).status).toBe(1);
});

test("the same check is required by both the hook and reusable CI unit job", () => {
  const hook = fs.readFileSync(path.join(root, ".husky/pre-commit"), "utf8");
  const workflow = fs.readFileSync(path.join(root, ".github/workflows/test.yml"), "utf8");
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  expect(hook).toContain("node scripts/scan-credentials.mjs --staged");
  expect(pkg.scripts["check:credentials"]).toBe("node scripts/scan-credentials.mjs --tracked");
  expect(workflow).toMatch(/yarn check:credentials\s+yarn test:unit/);
});

test("CI mode also inspects credentials in unchanged tracked files", () => {
  const cwd = fixture();
  stage(cwd, "legacy.js", githubToken);
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Seed fixture"], { cwd });
  expect(scan(cwd).status).toBe(0);
  const result = scan(cwd, "--tracked");
  expect(result.status).toBe(1);
  expect(result.output).toContain("github-token");
  expect(result.output).not.toContain(githubToken);
});

test("fails closed on invalid invocation or unavailable Git metadata", () => {
  expect(scan(fixture(), "--unknown").status).toBe(2);
  const cwd = fixture();
  fs.rmSync(path.join(cwd, ".git"), { recursive: true });
  expect(scan(cwd).status).toBe(2);
});
