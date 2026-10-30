# Android release records

Release history has one authoritative JSON record per official release under
`releases/`. Each record keeps a concise Traditional Chinese and English summary
for About and an English commit list for the GitHub Release page. Summaries cover
new capabilities and user-visible fixes; commit detail also includes tests, CI,
and refactoring. Do not copy an existing release-page body into a historical
record.

## Historical records

The first fork release, 0.1.0, starts at the verified fork baseline
`f2896b2d2573677ab49026d17c33b57b87cdcbf5`. Its previous release is null: inherited
upstream history is not represented as an earlier fork release. Version 0.2.0
starts at the actual 0.1.0 release source. Intermediate tags do not divide either
range. Historical records retain their original source commit and Android
version code; do not change the existing tags or APK assets when adding notes.

## Prepare a release

1. Start from tested product changes. Select the preceding **published stable
   release**, not the nearest tag. Record its version and actual source commit.
2. Create a new JSON record with the version/tag, previous release, native-change
   classification, bilingual summary, and the non-merge commit list for that
   release range. Exclude commits that only prepare release-note records.
3. Omit the current record's source commit and version code while it is
   unreleased: a file cannot predict its containing commit hash or the future
   workflow run number. Publication binds these values to the actual tag commit
   and built APK. Set `publishedAt` explicitly to null until synchronization
   confirms publication. Do not use placeholders that look like real hashes or codes.
4. Mark `nativeChanged` true when the APK includes a native improvement absent
   from the previous release. A web-only release inherits the last native update
   baseline, including when users skip releases.
5. Render and review the notes before tagging. Keep the summaries concise and
   verify both languages. Review the complete commit list against source history.
6. Commit the record, then create the normal `android-fork-v<version>` tag on the
   intended source. Do not publish a release directly with a different commit.
7. After publication succeeds, synchronize the confirmed publication metadata,
   then commit and deploy the updated record. This does not rewrite the release
   tag. About lists only records with a confirmed publication date, source and
   version code; merely committing a pending record does not advertise a release.

The Android workflow tests and signs the APK, verifies its signature, validates
the tracked release record and commit range, and generates `update.json` from the
actual APK's digest and size. It publishes the APK, license and metadata together
through a draft release before exposing the stable release to update checks.
Missing/mismatched records or metadata prevent publication.

The workflow's Android version code remains its run number. A web-only release
inherits its native version baseline from the preceding official release's
verified metadata. Legacy 0.1.0/0.2.0 baselines are reproducible from their tracked
historical records. A missing baseline must fail publication rather than guess.

Validate historical commit ranges in a checkout with complete Git history:

```bash
node scripts/release-records.mjs verify
```

Synchronize a published release using the official release's metadata and its
actual local tag, without reading its release-page prose:

```bash
node scripts/release-records.mjs sync-publication --version 0.2.0
```

This command updates the tracked record only. Review and commit that change, then
deploy normally; the release workflow never pushes changes back to the branch.

## Preview or replace release text

Render a tracked record without publishing or changing assets:

```bash
node scripts/release-records.mjs notes --version 0.2.0 --output release-notes.md
```

Review that file before using it to replace a release-page body. Rendering does
not mutate GitHub, historical tags, or signed artifacts. About uses only the
summaries; the release page includes the English summary, linked commit detail,
installation guidance, corresponding source and GPL license links.

## Update metadata

`update.json` identifies the stable release, actual source commit, Android
package/version/minimum SDK, cumulative native version baseline, APK URL, SHA-256
digest, byte size, and bilingual summary. Only the final signed APK is hashed.
The app still verifies the downloaded APK's package, signing identity, version,
integrity and device compatibility before installation; metadata is not a
replacement for those checks.
