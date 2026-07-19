'use strict';
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const renderer = path.join(root, 'renderer');
const www = path.join(__dirname, 'www');

fs.mkdirSync(path.join(www, 'fonts'), { recursive: true });

for (const f of ['app.js', 'styles.css']) {
  fs.copyFileSync(path.join(renderer, f), path.join(www, f));
}
for (const f of fs.readdirSync(path.join(renderer, 'fonts'))) {
  fs.copyFileSync(path.join(renderer, 'fonts', f), path.join(www, 'fonts', f));
}

let html = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
html = html.replace('<meta charset="UTF-8">',
  '<meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">');
html = html.replace('<link rel="stylesheet" href="styles.css">',
  '<link rel="stylesheet" href="styles.css">\n  <link rel="stylesheet" href="mobile.css">');
html = html.replace('<script src="app.js"></script>',
  '<script src="config.gen.js"></script>\n  <script src="md5.js"></script>\n  <script src="native.js"></script>\n  <script src="app.js"></script>');
fs.writeFileSync(path.join(www, 'index.html'), html);

const cfg = require(path.join(root, 'config.js'));
const pkg = require(path.join(root, 'package.json'));
fs.writeFileSync(path.join(www, 'config.gen.js'),
  'window.KV_TOKEN = ' + JSON.stringify(cfg.YANDEX_TOKEN) + ';\n' +
  'window.KV_VERSION = ' + JSON.stringify(pkg.version) + ';\n' +
  'window.KV_GH = ' + JSON.stringify({ owner: cfg.GH_OWNER, repo: cfg.GH_REPO }) + ';\n');

console.log('www synced');
