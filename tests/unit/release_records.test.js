import {
  renderReleaseNotes,
  createUpdateMetadata,
  parseApkBadging,
  parseApkSignerCertificates,
  validateReleaseRecord,
  synchronizePublication,
} from "../../scripts/release-records.mjs";

const record = {
  schemaVersion: 1,
  version: "0.2.0",
  tag: "android-fork-v0.2.0",
  sourceCommit: "966a57b3b5489c1ebb31a81e706a35bd2ced0914",
  previousRelease: {
    version: "0.1.0",
    sourceCommit: "f8f104178899e7e5bae02e2d140c975f43d1b87f",
  },
  versionCode: 4,
  nativeChanged: false,
  publishedAt: null,
  summary: {
    zhTW: ["保留旋轉後的閱讀位置。"],
    en: ["Preserve reading position after rotation."],
  },
  commits: [
    {
      sha: "8eccbfe1be17ca9a3807766381572f3de96312bd",
      subject: "fix: preserve a waiting article resize through Back",
    },
  ],
};

test("a release page combines its English summary, linked commits, and corresponding source", () => {
  const notes = renderReleaseNotes(record);
  expect(notes).toContain("Preserve reading position after rotation.");
  expect(notes).not.toContain("保留旋轉後的閱讀位置");
  expect(notes).toContain(
    "https://github.com/NoReasonKen/PttChrome/commit/8eccbfe1be17ca9a3807766381572f3de96312bd",
  );
  expect(notes).toContain(
    "fix: preserve a waiting article resize through Back",
  );
  expect(notes).toContain(
    "https://github.com/NoReasonKen/PttChrome/tree/android-fork-v0.2.0",
  );
  expect(notes).toContain("GPL-2.0-only");
});

test("a web-only release retains the last native version while binding its APK bytes", () => {
  const first = {
    ...record,
    version: "0.1.0",
    tag: "android-fork-v0.1.0",
    versionCode: 3,
    nativeChanged: true,
    previousRelease: null,
  };
  const metadata = createUpdateMetadata(record, [first, record], {
    versionCode: 4,
    sourceCommit: record.sourceCommit,
    apkBytes: Buffer.from("abc"),
  });
  expect(metadata.nativeVersionCode).toBe(3);
  expect(metadata.versionCode).toBe(4);
  expect(metadata.apk).toEqual({
    url: "https://github.com/NoReasonKen/PttChrome/releases/download/android-fork-v0.2.0/pttchrome.apk",
    size: 3,
    sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  });
});

test("a future web-only release inherits the preceding official artifact's native baseline", () => {
  const previous = {
    ...record,
    version: "0.3.0",
    tag: "android-fork-v0.3.0",
    sourceCommit: undefined,
    versionCode: undefined,
    nativeChanged: true,
  };
  const current = {
    ...record,
    version: "0.4.0",
    tag: "android-fork-v0.4.0",
    versionCode: undefined,
    previousRelease: { version: "0.3.0" },
  };
  const previousMetadata = {
    schemaVersion: 1,
    version: "0.3.0",
    tag: "android-fork-v0.3.0",
    sourceCommit: "8eccbfe1be17ca9a3807766381572f3de96312bd",
    packageName: "io.github.noreasonken.pttchrome",
    versionCode: 7,
    nativeVersionCode: 7,
  };
  const input = {
    versionCode: 8,
    sourceCommit: record.sourceCommit,
    apkBytes: Buffer.from("abc"),
    previousMetadata,
  };
  expect(
    createUpdateMetadata(current, [previous, current], input).nativeVersionCode,
  ).toBe(7);
  expect(() =>
    createUpdateMetadata(current, [previous, current], {
      ...input,
      previousMetadata: { ...previousMetadata, packageName: "another.app" },
    }),
  ).toThrow("identity mismatch");
  expect(() =>
    createUpdateMetadata(current, [previous, current], {
      ...input,
      versionCode: 7,
    }),
  ).toThrow("must increase");
});

test("release metadata uses the built APK's manifest identity and compatibility", () => {
  expect(
    parseApkBadging(
      "package: name='io.github.noreasonken.pttchrome' versionCode='4' versionName='0.2.0'\nsdkVersion:'26'\n",
    ),
  ).toEqual({
    packageName: "io.github.noreasonken.pttchrome",
    versionCode: 4,
    version: "0.2.0",
    minSdk: 26,
  });
  expect(() =>
    parseApkBadging(
      "package: name='other.app' versionCode='4' versionName='0.2.0'\nsdkVersion:'26'\n",
    ),
  ).toThrow("identity");
  expect(() =>
    parseApkBadging(
      "package: name='io.github.noreasonken.pttchrome' versionCode='4' versionName='0.2.0'\n",
    ),
  ).toThrow("compatibility");
});

test("release metadata reads current aapt2 badging from a production APK", () => {
  const badging = "package: name='io.github.noreasonken.pttchrome' versionCode='4' versionName='0.2.0' platformBuildVersionName='17' platformBuildVersionCode='37' compileSdkVersion='37' compileSdkVersionCodename='17'\nminSdkVersion:'26'\ntargetSdkVersion:'37'\n";
  expect(parseApkBadging(badging)).toEqual({
    packageName: "io.github.noreasonken.pttchrome",
    versionCode: 4,
    version: "0.2.0",
    minSdk: 26,
  });
  expect(() => parseApkBadging(badging.replace("minSdkVersion:'26'", "minSdkVersion:'25'"))).toThrow("compatibility");
});

const signerA = "85f42dce0807ef9fae714bd2135cd018d454672a61549617cca37a62f345f46a";
const signerB = "85503193dbbbf587a10e0e80827641a82b361e1220ee1733a5e22c69957dbb74";
const signerLines = (label, digest, name) =>
  [
    `${label} certificate DN: CN=${name}`,
    `${label} certificate SHA-256 digest: ${digest}`,
    `${label} certificate SHA-1 digest: 19407f3e1a05ea0fae4fc827161201fec497a837`,
    `${label} certificate MD5 digest: 78af37a39a9c78d5ae6040f1c835fb0d`,
  ].join("\n");

test("signing certificates are read from build-tools 36 apksigner output", () => {
  expect(parseApkSignerCertificates(`${signerLines("Signer #1", signerA, "Test A")}\n`)).toEqual([signerA]);
  expect(
    parseApkSignerCertificates(`${signerLines("Signer #1", signerB, "Test B")}\r\n${signerLines("Signer #2", signerA.toUpperCase(), "Test A")}\r\n`),
  ).toEqual([signerB, signerA].sort());
});

test("signing certificates are read from build-tools 37 apksigner output", () => {
  expect(parseApkSignerCertificates(`${signerLines("V2 Signer:", signerA, "Test A")}\n`)).toEqual([signerA]);
  expect(parseApkSignerCertificates(`${signerLines("V3.0 Signer:", signerA, "Test A")}\n`)).toEqual([signerA]);
  expect(
    parseApkSignerCertificates(`${signerLines("V2 Signer #1:", signerA, "Test A")}\n${signerLines("V2 Signer #2:", signerB, "Test B")}\n`),
  ).toEqual([signerA, signerB].sort());
});

test("signing certificate parsing ignores public keys and requires a signer", () => {
  const verbose = [
    "Verifies",
    "Number of signers: 1",
    signerLines("V2 Signer:", signerA, "Test A"),
    `V2 Signer: public key SHA-256 digest: ${signerB}`,
    `Signer #1 public key SHA-256 digest: ${signerB}`,
  ].join("\n");
  expect(parseApkSignerCertificates(verbose)).toEqual([signerA]);
  expect(() => parseApkSignerCertificates("Verifies\n")).toThrow("No verified APK signing certificate found");
});

test("incomplete or ambiguous notes fail before publication", () => {
  expect(() =>
    validateReleaseRecord({ ...record, summary: { en: ["An update"] } }),
  ).toThrow("zhTW");
  expect(() =>
    validateReleaseRecord({
      ...record,
      commits: [...record.commits, ...record.commits],
    }),
  ).toThrow("Duplicate");
  expect(() =>
    createUpdateMetadata(record, [record], {
      versionCode: 4,
      sourceCommit: record.sourceCommit,
      apkBytes: Buffer.alloc(0),
    }),
  ).toThrow("complete APK");
});

test("a published record binds official publication time and actual metadata without rewriting a tag", () => {
  const pending = {
    ...record,
    sourceCommit: undefined,
    versionCode: undefined,
  };
  const official = {
    tag: record.tag,
    publishedAt: "2026-10-29T13:50:08Z",
    draft: false,
    prerelease: false,
  };
  const metadata = {
    schemaVersion: 1,
    version: record.version,
    tag: record.tag,
    sourceCommit: record.sourceCommit,
    packageName: "io.github.noreasonken.pttchrome",
    versionCode: 4,
  };
  const synced = synchronizePublication(
    pending,
    official,
    metadata,
    record.sourceCommit,
  );
  expect(synced.publishedAt).toBe("2026-10-29T13:50:08Z");
  expect(synced.sourceCommit).toBe(record.sourceCommit);
  expect(synced.versionCode).toBe(4);
  expect(pending.publishedAt).toBeNull();
  expect(() =>
    synchronizePublication(
      pending,
      { ...official, draft: true },
      metadata,
      record.sourceCommit,
    ),
  ).toThrow("published stable");
});
