const { app, BrowserWindow, ipcMain, globalShortcut, shell, protocol, Tray, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { createHash } = require('crypto');
const { YANDEX_TOKEN, GH_OWNER, GH_REPO } = require('./config');

let win = null;
let tray = null;
let quitting = false;
let trayOnClose = true;

if (!app.requestSingleInstanceLock()) app.quit();
app.on('second-instance', () => {
  if (win) { win.show(); win.focus(); }
});
app.on('before-quit', () => { quitting = true; });

let updateStatus = { state: 'idle' };

function setUpdateStatus(s) {
  updateStatus = s;
  if (win && !win.isDestroyed()) win.webContents.send('update-status', s);
}

function setupAutoUpdate() {
  if (!app.isPackaged) { updateStatus = { state: 'dev' }; return; }
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.setFeedURL({ provider: 'github', owner: GH_OWNER, repo: GH_REPO });
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', i => setUpdateStatus({ state: 'downloading', version: i.version }));
    autoUpdater.on('update-not-available', () => setUpdateStatus({ state: 'none' }));
    autoUpdater.on('update-downloaded', i => setUpdateStatus({ state: 'ready', version: i.version }));
    autoUpdater.on('error', e => setUpdateStatus({ state: 'error', error: String(e.message || e) }));
    ipcMain.handle('install-update', () => autoUpdater.quitAndInstall());
    ipcMain.handle('check-update', () => { autoUpdater.checkForUpdates().catch(() => {}); });
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 4 * 60 * 60 * 1000);
  } catch (e) {
    console.warn('autoupdate off:', e.message);
  }
}

ipcMain.handle('app-version', () => app.getVersion());
ipcMain.handle('update-status', () => updateStatus);
if (!app.isPackaged) {
  ipcMain.handle('install-update', () => {});
  ipcMain.handle('check-update', () => {});
}

protocol.registerSchemesAsPrivileged([
  { scheme: 'kvs', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
]);

function downloadsDir() {
  const dir = path.join(app.getPath('music'), 'Kvinta');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 980,
    minHeight: 620,
    backgroundColor: '#0e0a0c',
    autoHideMenuBar: true,
    title: 'Kvinta',
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#160a0f', symbolColor: '#f7eff1', height: 36 },
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  win.on('close', e => {
    if (trayOnClose && !quitting) {
      e.preventDefault();
      win.hide();
    }
  });
}

function showWin() {
  if (!win) return;
  win.show();
  win.focus();
}

function setupTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'icon.ico'));
  tray.setToolTip('Kvinta');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Kvinta', click: showWin },
    { type: 'separator' },
    { label: 'Выйти', click: () => { quitting = true; app.quit(); } }
  ]));
  tray.on('click', showWin);
}

ipcMain.on('tray-mode', (_ev, on) => { trayOnClose = !!on; });

let miniPrev = null;

ipcMain.handle('mini-mode', (_ev, on) => {
  if (!win) return;
  if (on) {
    if (!miniPrev) miniPrev = win.getBounds();
    const wa = screen.getPrimaryDisplay().workArea;
    win.setMinimumSize(360, 96);
    win.setBounds({ width: 420, height: 96, x: wa.x + wa.width - 436, y: wa.y + 16 });
    win.setResizable(false);
    win.setMaximizable(false);
    win.setAlwaysOnTop(true, 'screen-saver');
  } else {
    win.setAlwaysOnTop(false);
    win.setResizable(true);
    win.setMaximizable(true);
    win.setMinimumSize(980, 620);
    if (miniPrev) win.setBounds(miniPrev);
    miniPrev = null;
  }
});

app.whenReady().then(() => {
  protocol.handle('kvs', async (request) => {
    try {
      const u = new URL(request.url).searchParams.get('u');
      if (!u) return new Response('bad request', { status: 400 });
      const headers = {};
      const range = request.headers.get('range');
      if (range) headers.Range = range;
      const res = await fetch(u, { headers, signal: AbortSignal.timeout(60000) });
      const h = new Headers();
      for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
        const v = res.headers.get(k);
        if (v) h.set(k, v);
      }
      h.set('Access-Control-Allow-Origin', '*');
      return new Response(res.body, { status: res.status, headers: h });
    } catch (e) {
      return new Response('proxy error: ' + e.message, { status: 502 });
    }
  });

  createWindow();
  setupTray();
  setupAutoUpdate();

  globalShortcut.register('MediaPlayPause', () => win && win.webContents.send('media-key', 'playpause'));
  globalShortcut.register('MediaNextTrack', () => win && win.webContents.send('media-key', 'next'));
  globalShortcut.register('MediaPreviousTrack', () => win && win.webContents.send('media-key', 'prev'));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  app.quit();
});

const YM_BASE = 'https://api.music.yandex.net';

function ymHeaders() {
  return {
    'Authorization': `OAuth ${YANDEX_TOKEN}`,
    'User-Agent': 'Yandex-Music-API',
    'Accept-Language': 'ru'
  };
}

async function ymFetch(pathAndQuery) {
  if (!YANDEX_TOKEN) throw new Error('no-token');
  const res = await fetch(YM_BASE + pathAndQuery, {
    headers: ymHeaders(),
    signal: AbortSignal.timeout(20000)
  });
  if (res.status === 401 || res.status === 403) throw new Error('bad-token');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return json.result;
}

ipcMain.handle('ym-get', async (_ev, pathAndQuery) => {
  try {
    return { ok: true, data: await ymFetch(pathAndQuery) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

async function ymStreamUrl(trackId) {
  const infos = await ymFetch(`/tracks/${trackId}/download-info`);
  const mp3 = (infos || [])
    .filter(i => i.codec === 'mp3')
    .sort((a, b) => b.bitrateInKbps - a.bitrateInKbps)[0];
  if (!mp3) throw new Error('нет mp3-потока');

  const xmlRes = await fetch(mp3.downloadInfoUrl, { headers: ymHeaders(), signal: AbortSignal.timeout(20000) });
  const xml = await xmlRes.text();
  const tag = name => (xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`)) || [])[1];
  const host = tag('host'), pathv = tag('path'), ts = tag('ts'), s = tag('s');
  if (!host || !pathv) throw new Error('не удалось разобрать download-info');

  const sign = createHash('md5').update('XGRlBW9FXlekgbPrRHuSiA' + pathv.slice(1) + s).digest('hex');
  return `https://${host}/get-mp3/${sign}/${ts}${pathv}`;
}

ipcMain.handle('ym-stream-url', async (_ev, trackId) => {
  try {
    return { ok: true, url: await ymStreamUrl(trackId) };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

function safeName(s) {
  return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120).trim();
}

ipcMain.handle('download-track', async (_ev, track) => {
  try {
    let url = track.streamUrl;
    if (!url && track.source === 'ym') url = await ymStreamUrl(track.id);
    if (!url) throw new Error('нет ссылки на поток');
    const res = await fetch(url, { signal: AbortSignal.timeout(180000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const name = `${safeName(track.artist)} - ${safeName(track.title)}`;
    const file = path.join(downloadsDir(), name + '.mp3');
    await fsp.writeFile(file, buf);

    let coverFile = null;
    if (track.artwork) {
      try {
        const cres = await fetch(track.artwork, { signal: AbortSignal.timeout(30000) });
        if (cres.ok) {
          const coversDir = path.join(downloadsDir(), 'covers');
          await fsp.mkdir(coversDir, { recursive: true });
          coverFile = path.join(coversDir, name + '.jpg');
          await fsp.writeFile(coverFile, Buffer.from(await cres.arrayBuffer()));
        }
      } catch {}
    }
    return { ok: true, path: file, cover: coverFile };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('import-track', async (_ev, t) => {
  try {
    const base = `${safeName(t.artist)} - ${safeName(t.title)}`;
    let file = path.join(downloadsDir(), base + '.mp3');
    for (let n = 2; fs.existsSync(file); n++) file = path.join(downloadsDir(), `${base} (${n}).mp3`);
    await fsp.writeFile(file, Buffer.from(t.mp3));

    let coverFile = null;
    if (t.cover) {
      const coversDir = path.join(downloadsDir(), 'covers');
      await fsp.mkdir(coversDir, { recursive: true });
      coverFile = path.join(coversDir, path.basename(file, '.mp3') + '.jpg');
      await fsp.writeFile(coverFile, Buffer.from(t.cover));
    }
    return { ok: true, path: file, cover: coverFile };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('set-cover', async (_ev, trackPath, cover, oldCover) => {
  try {
    const coversDir = path.join(downloadsDir(), 'covers');
    await fsp.mkdir(coversDir, { recursive: true });
    const file = path.join(coversDir, path.basename(trackPath, '.mp3') + '-' + Date.now() + '.jpg');
    await fsp.writeFile(file, Buffer.from(cover));
    if (oldCover) await fsp.rm(oldCover, { force: true });
    return { ok: true, cover: file };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('delete-download', async (_ev, filePath, coverPath) => {
  try {
    await fsp.rm(filePath, { force: true });
    await fsp.rm(filePath.replace(/\.mp3$/, '.jpg'), { force: true });
    const cover = path.join(path.dirname(filePath), 'covers', path.basename(filePath).replace(/\.mp3$/, '.jpg'));
    await fsp.rm(cover, { force: true });
    if (coverPath) await fsp.rm(coverPath, { force: true });
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('file-exists', async (_ev, filePath) => {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('open-downloads-folder', async () => {
  shell.openPath(downloadsDir());
});
