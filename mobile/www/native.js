/* Нативная прослойка мобильной Kvinta — реализует window.kvinta вместо Electron IPC */
'use strict';
window.KV_MOBILE = true;

(function () {
  const YM_BASE = 'https://api.music.yandex.net';
  const TOKEN = window.KV_TOKEN || '';
  const Cap = window.Capacitor;
  const FS = Cap.Plugins.Filesystem;
  const Http = Cap.Plugins.CapacitorHttp;

  const ymHeaders = () => ({
    'Authorization': 'OAuth ' + TOKEN,
    'User-Agent': 'Yandex-Music-API',
    'Accept-Language': 'ru'
  });

  async function ymFetch(pathAndQuery) {
    if (!TOKEN) throw new Error('no-token');
    const res = await fetch(YM_BASE + pathAndQuery, { headers: ymHeaders() });
    if (res.status === 401 || res.status === 403) throw new Error('bad-token');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return (await res.json()).result;
  }

  // Прямая ссылка на mp3-поток (та же схема подписи, что в десктопной версии)
  async function ymStreamUrl(trackId) {
    const infos = await ymFetch('/tracks/' + trackId + '/download-info');
    const mp3 = (infos || [])
      .filter(i => i.codec === 'mp3')
      .sort((a, b) => b.bitrateInKbps - a.bitrateInKbps)[0];
    if (!mp3) throw new Error('нет mp3-потока');

    const xml = await (await fetch(mp3.downloadInfoUrl, { headers: ymHeaders() })).text();
    const tag = name => (xml.match(new RegExp('<' + name + '>([\\s\\S]*?)</' + name + '>')) || [])[1];
    const host = tag('host'), pathv = tag('path'), ts = tag('ts'), s = tag('s');
    if (!host || !pathv) throw new Error('не удалось разобрать download-info');

    const sign = window.md5('XGRlBW9FXlekgbPrRHuSiA' + pathv.slice(1) + s);
    return 'https://' + host + '/get-mp3/' + sign + '/' + ts + pathv;
  }

  function safeName(s) {
    return String(s).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120).trim();
  }

  // Скачивает бинарник нативно (мимо CORS) и возвращает base64
  async function fetchB64(url, timeout) {
    const r = await Http.request({
      url, method: 'GET', responseType: 'blob',
      connectTimeout: 30000, readTimeout: timeout || 180000
    });
    if (r.status < 200 || r.status >= 300) throw new Error('HTTP ' + r.status);
    return r.data;
  }

  window.kvinta = {
    async ym(pathAndQuery) {
      try { return { ok: true, data: await ymFetch(pathAndQuery) }; }
      catch (e) { return { ok: false, error: String(e.message || e) }; }
    },

    async ymStreamUrl(trackId) {
      try { return { ok: true, url: await ymStreamUrl(trackId) }; }
      catch (e) { return { ok: false, error: String(e.message || e) }; }
    },

    // Качает поток нативно и отдаёт blob: URL — same-origin источник,
    // на котором работает Web Audio (эквалайзер, баланс, моно и т.д.)
    async fetchStreamBlobUrl(url) {
      try {
        const b64 = await fetchB64(url);
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return { ok: true, url: URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' })) };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },

    async downloadTrack(track) {
      try {
        let url = track.streamUrl;
        if (!url && track.source === 'ym') url = await ymStreamUrl(track.id);
        if (!url) throw new Error('нет ссылки на поток');
        const rel = 'downloads/' + safeName(track.artist) + ' - ' + safeName(track.title) + '.mp3';
        const w = await FS.writeFile({
          path: rel, directory: 'DATA', recursive: true,
          data: await fetchB64(url)
        });
        let coverUri = null;
        if (track.artwork) {
          try {
            const cw = await FS.writeFile({
              path: rel.replace(/\.mp3$/, '.jpg'), directory: 'DATA', recursive: true,
              data: await fetchB64(track.artwork, 30000)
            });
            coverUri = cw.uri;
          } catch {}
        }
        return { ok: true, path: w.uri, cover: coverUri };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },

    async deleteDownload(p) {
      try { await FS.deleteFile({ path: p }); } catch {}
      try { await FS.deleteFile({ path: p.replace(/\.mp3$/, '.jpg') }); } catch {}
      return true;
    },

    async fileExists(p) {
      try { await FS.stat({ path: p }); return true; }
      catch { return false; }
    },

    async openDownloadsFolder() {},
    onMediaKey() {}
  };
})();
