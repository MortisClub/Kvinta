'use strict';
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

require('../main.js');

const OUT = path.join(__dirname, '..', 'docs', 'screens');
const delay = ms => new Promise(r => setTimeout(r, ms));

async function shot(win, name) {
  const img = await win.webContents.capturePage();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, name), img.toPNG());
  console.log(name);
}

app.whenReady().then(async () => {
  await delay(1500);
  const win = BrowserWindow.getAllWindows()[0];
  win.setContentSize(1280, 800);
  await delay(6000);

  await win.webContents.executeJavaScript(
    `(async () => { const tr = await loadChartTracks(); await playQueue(tr, 0, 'Чарт'); })()`, true);
  await delay(4000);
  await shot(win, 'desktop-home.png');

  await win.webContents.executeJavaScript(`switchView('settings')`, true);
  await delay(1000);
  await win.webContents.executeJavaScript(
    `document.getElementById('eqBands').scrollIntoView({ block: 'end' }); undefined`, true);
  await delay(600);
  await shot(win, 'desktop-settings.png');

  await win.webContents.executeJavaScript(`audio.pause(); undefined`, true);
  win.hide();

  const mw = new BrowserWindow({
    width: 393, height: 852, useContentSize: true,
    backgroundColor: '#0d0709', autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  await mw.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  await mw.webContents.executeJavaScript(`
    window.KV_MOBILE = true;
    document.head.insertAdjacentHTML('beforeend', '<link rel="stylesheet" href="../mobile/www/mobile.css">');
    setupMobileUi(); undefined`, true);
  await delay(6000);
  await mw.webContents.executeJavaScript(
    `(async () => { const tr = await loadChartTracks(); await playQueue(tr, 1, 'Чарт'); })()`, true);
  await delay(3500);
  await shot(mw, 'mobile-home.png');

  await mw.webContents.executeJavaScript(
    `document.getElementById('npSheet').classList.add('open'); syncNp(); updatePlayIcon(); undefined`, true);
  await delay(1200);
  await shot(mw, 'mobile-player.png');

  app.exit(0);
});
