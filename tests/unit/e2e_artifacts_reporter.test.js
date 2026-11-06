import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import ImageArtifactsReporter from '../../scripts/e2e-artifacts-reporter.cjs';

let root;
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-images-test-')); });
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

const testCase = { id: 'project/test', titlePath: () => ['offline-mobile', 'article opens at top'] };
const result = (attachments, retry = 0) => ({ attachments, retry, status: 'passed' });

test('persists successful buffer and path images with a discoverable manifest', () => {
  const input = path.join(root, 'input.png');
  fs.writeFileSync(input, 'file-image');
  const reporter = new ImageArtifactsReporter({ directory: root });
  reporter.onBegin();
  reporter.onTestEnd(testCase, result([
    { name: 'review', contentType: 'image/png', body: Buffer.from('buffer-image') },
    { name: 'failure', contentType: 'image/png', path: input },
    { name: 'video', contentType: 'video/webm', body: Buffer.from('ignored') },
  ]));
  expect(reporter.onEnd()).toBeUndefined();
  const manifest = JSON.parse(fs.readFileSync(path.join(reporter.directory, 'images.json')));
  expect(manifest.errors).toEqual([]);
  expect(manifest.images.map(image => fs.readFileSync(image.path, 'utf8'))).toEqual(['buffer-image', 'file-image']);
  expect(manifest.images.every(image => path.isAbsolute(image.path) && image.status === 'passed')).toBe(true);
});

test('keeps separate runs and retries without overwriting earlier evidence', () => {
  const reporters = [new ImageArtifactsReporter({ directory: root }), new ImageArtifactsReporter({ directory: root })];
  for (const reporter of reporters) {
    reporter.onBegin();
    const attachment = { name: 'review', contentType: 'image/png', body: Buffer.from('image') };
    reporter.onTestEnd(testCase, result([attachment]));
    reporter.onTestEnd(testCase, result([attachment], 1));
    expect(reporter.onEnd()).toBeUndefined();
    expect(reporter.images).toHaveLength(2);
  }
  expect(reporters[0].directory).not.toBe(reporters[1].directory);
  expect(fs.existsSync(reporters[0].images[0].path)).toBe(true);
});

test('fails explicitly when a requested image cannot be preserved', () => {
  const reporter = new ImageArtifactsReporter({ directory: root });
  reporter.onBegin();
  reporter.onTestEnd(testCase, result([{ name: 'missing', contentType: 'image/png', path: path.join(root, 'absent.png') }]));
  expect(reporter.onEnd()).toEqual({ status: 'failed' });
  expect(reporter.errors).toHaveLength(1);
});

test('is inactive without an output request', () => {
  vi.stubEnv('E2E_ARTIFACT_DIR', '');
  try {
    const reporter = new ImageArtifactsReporter();
    reporter.onBegin();
    reporter.onTestEnd(testCase, result([{ name: 'review', contentType: 'image/png', body: Buffer.from('ignored') }]));
    expect(reporter.onEnd()).toBeUndefined();
    expect(reporter.directory).toBeUndefined();
    expect(fs.readdirSync(root)).toEqual([]);
  } finally { vi.unstubAllEnvs(); }
});
