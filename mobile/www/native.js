'use strict';
window.KV_MOBILE = true;

(function () {
  const YM_BASE = 'https://api.music.yandex.net';
  const TOKEN = window.KV_TOKEN || '';
  const Cap = window.Capacitor;
  const FS = Cap.Plugins.Filesystem;
  const Http = Cap.Plugins.CapacitorHttp;
  const Audio = Cap.Plugins.KvintaAudio;
  const VK_UA = 'KateMobileAndroid/56 lite-460 (Android 4.4.2; SDK 19; x86; unknown; en)';

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

  function bufToB64(buf) {
    const u8 = new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

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

    async importTrack(t) {
      try {
        const rel = 'downloads/' + safeName(t.artist) + ' - ' + safeName(t.title) + '.mp3';
        const w = await FS.writeFile({ path: rel, directory: 'DATA', recursive: true, data: bufToB64(t.mp3) });
        let coverUri = null;
        if (t.cover) {
          try {
            const cw = await FS.writeFile({
              path: rel.replace(/\.mp3$/, '.jpg'), directory: 'DATA', recursive: true,
              data: bufToB64(t.cover)
            });
            coverUri = cw.uri;
          } catch {}
        }
        return { ok: true, path: w.uri, cover: coverUri };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },

    async setCover(trackPath, cover, oldCover) {
      try {
        const name = decodeURIComponent(trackPath.split('/').pop());
        const rel = 'downloads/' + name.replace(/\.mp3$/, '') + '-' + Date.now() + '.jpg';
        const w = await FS.writeFile({ path: rel, directory: 'DATA', recursive: true, data: bufToB64(cover) });
        if (oldCover) { try { await FS.deleteFile({ path: oldCover }); } catch {} }
        return { ok: true, cover: w.uri };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },

    async checkUpdate() {
      try {
        const gh = window.KV_GH || {};
        const api = `https://api.github.com/repos/${gh.owner}/${gh.repo}/releases/latest`;
        const res = await fetch(api, { headers: { 'Accept': 'application/vnd.github+json' } });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        const rel = await res.json();
        const version = String(rel.tag_name || '').replace(/^v/, '');
        const apk = (rel.assets || []).find(a => /\.apk$/i.test(a.name));
        const cur = String(window.KV_VERSION || '0').split('.').map(n => +n || 0);
        const next = version.split('.').map(n => +n || 0);
        let newer = false;
        for (let i = 0; i < 3; i++) {
          if ((next[i] || 0) > (cur[i] || 0)) { newer = true; break; }
          if ((next[i] || 0) < (cur[i] || 0)) break;
        }
        if (!apk || !newer) return { ok: true, update: false, version };
        return { ok: true, update: true, version, assetId: apk.id, size: apk.size, apkUrl: apk.browser_download_url };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },

    async downloadUpdate(directUrl, onProgress) {
      let listener = null;
      try {
        if (!directUrl) throw new Error('нет ссылки на файл');
        if (onProgress && FS.addListener) {
          try {
            listener = await FS.addListener('progress', p => onProgress(p.bytes, p.contentLength));
          } catch {}
        }
        await FS.downloadFile({
          url: directUrl, path: 'update/kvinta.apk', directory: 'CACHE',
          recursive: true, progress: true
        });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      } finally {
        if (listener) { try { listener.remove(); } catch {} }
      }
    },

    async installUpdate() {
      try {
        const u = await FS.getUri({ path: 'update/kvinta.apk', directory: 'CACHE' });
        await Cap.Plugins.ApkInstaller.install({ path: u.uri.replace(/^file:\/\//, '') });
        return { ok: true };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },

    async deleteDownload(p, cover) {
      try { await FS.deleteFile({ path: p }); } catch {}
      try { await FS.deleteFile({ path: p.replace(/\.mp3$/, '.jpg') }); } catch {}
      if (cover) { try { await FS.deleteFile({ path: cover }); } catch {} }
      return true;
    },

    async fileExists(p) {
      try { await FS.stat({ path: p }); return true; }
      catch { return false; }
    },

    async vkAuth() {
      try { return await Cap.Plugins.VkAuth.login(); }
      catch (e) { return { ok: false, error: String(e.message || e) }; }
    },

    async vkAudio(token, userId) {
      try {
        const out = [];
        for (let offset = 0; offset < 5000; offset += 200) {
          const r = await Http.request({
            url: 'https://api.vk.com/method/audio.get',
            method: 'GET',
            headers: { 'User-Agent': VK_UA },
            params: { owner_id: String(userId), count: '200', offset: String(offset), access_token: token, v: '5.131' }
          });
          if (r.data && r.data.error) throw new Error(r.data.error.error_msg || 'ошибка ВК');
          const items = (r.data.response && r.data.response.items) || [];
          out.push(...items.map(a => ({ artist: a.artist, title: a.title, duration: a.duration })));
          if (items.length < 200) break;
        }
        return { ok: true, tracks: out };
      } catch (e) {
        return { ok: false, error: String(e.message || e) };
      }
    },

    async openDownloadsFolder() {},
    onMediaKey() {},

    media: {
      start() { Audio.start().catch(() => {}); },
      setMetadata(meta) { Audio.setMetadata(meta).catch(() => {}); },
      setState(s) { Audio.setState(s).catch(() => {}); },
      onTransport(cb) { Audio.addListener('transport', cb); }
    }
  };
})();
