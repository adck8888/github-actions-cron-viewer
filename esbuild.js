const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const minify = process.argv.includes('--minify');

esbuild
  .build({
    entryPoints: ['src/extension.ts'],
    bundle: true,
    outfile: 'dist/extension.js',
    external: ['vscode'],
    format: 'cjs',
    platform: 'node',
    target: 'node18',
    sourcemap: !minify,
    minify
  })
  .catch(() => process.exit(1));

// The webview uses codicons, so the font has to travel with the extension.
const fontTarget = path.join(__dirname, 'media', 'codicons');
fs.mkdirSync(fontTarget, { recursive: true });
fs.copyFileSync(
  path.join(__dirname, 'node_modules', '@vscode', 'codicons', 'dist', 'codicon.ttf'),
  path.join(fontTarget, 'codicon.ttf')
);
