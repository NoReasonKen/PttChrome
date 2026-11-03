import fs from 'node:fs';
import path from 'node:path';

// HTML metadata and web manifests cannot resolve CSS custom properties.
// Generate both from the same channels used by the translucent chrome surfaces.
export function renderChromeAssets(palette, template) {
  const match = /--mobile-chrome-background-rgb:\s*(\d+)\s+(\d+)\s+(\d+)\s*;/.exec(palette);
  if (!match || match.slice(1).some(channel => Number(channel) > 255)) {
    throw new Error('Invalid mobile chrome background channels');
  }
  const themeColor = '#' + match.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('');
  const manifest = JSON.stringify({ ...JSON.parse(template), theme_color: themeColor }, null, 2) + '\n';
  return { themeColor, manifest };
}

export function mobileChromeAssets(root = process.cwd()) {
  const paletteFile = path.resolve(root, 'src/css/mobile_chrome_palette.css');
  const manifestFile = path.resolve(root, 'src/manifest.webmanifest');
  const render = () => renderChromeAssets(fs.readFileSync(paletteFile, 'utf8'), fs.readFileSync(manifestFile, 'utf8'));
  return {
    name: 'pttchrome:mobile-chrome-assets',
    transformIndexHtml(html) {
      return html.replaceAll('%PTTCHROME_THEME_COLOR%', render().themeColor);
    },
    configureServer(server) {
      server.watcher.add([paletteFile, manifestFile]);
      server.watcher.on('change', file => {
        if (file === paletteFile || file === manifestFile) server.ws.send({ type: 'full-reload' });
      });
      server.middlewares.use((req, res, next) => {
        if (!req.url?.split('?')[0].endsWith('/manifest.webmanifest')) return next();
        try {
          res.setHeader('Content-Type', 'application/manifest+json');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(render().manifest);
        } catch (error) {
          next(error);
        }
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: render().manifest });
    },
  };
}
