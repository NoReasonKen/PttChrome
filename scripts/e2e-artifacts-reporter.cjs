const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

// Opt-in persistence for image attachments, including buffers from passing tests.
// A unique directory survives Playwright's next output-directory cleanup.
class ImageArtifactsReporter {
  constructor(options = {}) {
    this.root = options.directory || process.env.E2E_ARTIFACT_DIR;
    this.images = [];
    this.errors = [];
  }

  onBegin() {
    if (!this.root) return;
    try {
      const root = path.resolve(this.root);
      fs.mkdirSync(root, { recursive: true });
      this.directory = fs.mkdtempSync(path.join(root, 'run-'));
    } catch (error) {
      this.errors.push(String(error));
    }
  }

  onTestEnd(test, result) {
    if (!this.directory) return;
    for (const [index, attachment] of (result.attachments || []).entries()) {
      const extension = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[attachment.contentType];
      if (!extension) continue;
      try {
        const id = createHash('sha256').update(test.id).digest('hex').slice(0, 16);
        const file = path.join(this.directory, `${id}-${result.retry}-${index}.${extension}`);
        if (attachment.body !== undefined) fs.writeFileSync(file, attachment.body, { flag: 'wx' });
        else if (attachment.path) fs.copyFileSync(attachment.path, file, fs.constants.COPYFILE_EXCL);
        else throw new Error(`Image attachment has no data: ${attachment.name}`);
        this.images.push({ test: test.titlePath(), name: attachment.name, status: result.status, path: file });
      } catch (error) {
        this.errors.push(String(error));
      }
    }
  }

  onEnd() {
    if (this.directory) {
      try {
        const manifest = path.join(this.directory, 'images.json');
        fs.writeFileSync(manifest, JSON.stringify({ images: this.images, errors: this.errors }, null, 2) + '\n');
        console.log(`Image artifacts: ${manifest}`);
        for (const image of this.images) console.log(`Image artifact: ${image.path}`);
      } catch (error) {
        this.errors.push(String(error));
      }
    }
    if (this.errors.length) {
      console.error(`Image artifact failure: ${this.errors.join('; ')}`);
      return { status: 'failed' };
    }
  }
}

module.exports = ImageArtifactsReporter;
