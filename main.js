const { app, BrowserWindow, ipcMain, globalShortcut, shell, protocol } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const { createHash } = require('crypto');
const { YANDEX_TOKEN } = require('./config');

let win = null;

// Прокси-схема kvs:// — проксирует аудиопотоки через main-процесс и добавляет
// CORS-заголовки, чтобы Web Audio (эквалайзер) не глушил звук из-за taint-проверки
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
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
}

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

  // Медиаклавиши клавиатуры управляют плеером
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

// ---------- Яндекс Музыка (неофициальный API, аккаунт пользователя) ----------

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

// Прямая ссылка на mp3-поток трека (схема подписи из клиентов Яндекс Музыки)
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

// ---------- Загрузки (офлайн-прослушивание) ----------

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
    const file = path.join(downloadsDir(), `${safeName(track.artist)} - ${safeName(track.title)}.mp3`);
    await fsp.writeFile(file, buf);

    // Обложку тоже сохраняем рядом для офлайна
    let coverFile = null;
    if (track.artwork) {
      try {
        const cres = await fetch(track.artwork, { signal: AbortSignal.timeout(30000) });
        if (cres.ok) {
          coverFile = file.replace(/\.mp3$/, '.jpg');
          await fsp.writeFile(coverFile, Buffer.from(await cres.arrayBuffer()));
        }
      } catch {}
    }
    return { ok: true, path: file, cover: coverFile };
  } catch (e) {
    return { ok: false, error: String(e.message || e) };
  }
});

ipcMain.handle('delete-download', async (_ev, filePath) => {
  try {
    await fsp.rm(filePath, { force: true });
    await fsp.rm(filePath.replace(/\.mp3$/, '.jpg'), { force: true });
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
