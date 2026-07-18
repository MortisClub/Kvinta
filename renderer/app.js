'use strict';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const store = {
  get(key, def) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; }
    catch { return def; }
  },
  set(key, val) { localStorage.setItem(key, JSON.stringify(val)); }
};

const DEFAULT_SETTINGS = {
  eqOn: false, eqPreset: 'flat', eqGains: null, volume: 0.8,
  speed: 1, fade: 0, normalize: false, mono: false, balance: 0, preamp: 0
};

const state = {
  favorites: store.get('kv.favorites', []),
  playlists: store.get('kv.playlists', []),
  downloads: store.get('kv.downloads', []),
  settings: store.get('kv.settings', { ...DEFAULT_SETTINGS }),
  history: store.get('kv.history', []),
  sleep: { minutes: 0, until: 0, timerId: null, stopAfterTrack: false },
  update: { state: 'idle', version: null, assetId: null },
  queue: [],
  queueName: '',
  order: [],
  orderPos: -1,
  shuffle: false,
  repeat: 'off',
  current: null,
  view: 'new',
  viewParam: null,
  searchQuery: '',
  cache: {}
};

const favIds = () => new Set(state.favorites.map(t => t.id));
const dlById = () => new Map(state.downloads.map(t => [t.id, t]));

function saveFavs() { store.set('kv.favorites', state.favorites); }
function savePls() { store.set('kv.playlists', state.playlists); renderSidebarPlaylists(); }
function saveDls() { store.set('kv.downloads', state.downloads); }
function saveHistory() { store.set('kv.history', state.history); }
function saveSettings() { store.set('kv.settings', state.settings); }

function fmtTime(sec) {
  if (!sec || !isFinite(sec)) return '0:00';
  sec = Math.round(sec);
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function toast(msg, ms = 2600) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  $('#toasts').appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 350); }, ms);
}

function fileUrl(p) {
  if (window.KV_MOBILE) return window.Capacitor.convertFileSrc(p);
  return 'file:///' + p.replace(/\\/g, '/').split('/').map(encodeURIComponent).join('/');
}

const ymCover = (uri, size) => uri ? 'https://' + String(uri).replace('%%', size) : null;

function normTrack(t) {
  return {
    id: String(t.id),
    source: 'ym',
    title: t.title || 'Без названия',
    artist: (t.artists || []).map(a => a.name).join(', ') || 'Неизвестный артист',
    artists: (t.artists || []).filter(a => a.id).map(a => ({ id: a.id, name: a.name })),
    album: (t.albums && t.albums[0] && t.albums[0].title) || '',
    albumId: (t.albums && t.albums[0] && t.albums[0].id) || null,
    art150: ymCover(t.coverUri, '100x100'),
    art480: ymCover(t.coverUri, '400x400'),
    duration: Math.round((t.durationMs || 0) / 1000),
    genre: (t.albums && t.albums[0] && t.albums[0].genre) || ''
  };
}

const isPlayable = t => t && t.id && t.available !== false;

async function ym(path, cacheKey) {
  if (cacheKey && state.cache[cacheKey]) return state.cache[cacheKey];
  const res = await window.kvinta.ym(path);
  if (!res.ok) throw new Error(res.error);
  if (cacheKey) state.cache[cacheKey] = res.data;
  return res.data;
}

function extractTracks(list) {
  return (list || [])
    .map(x => x.track || x)
    .filter(isPlayable)
    .map(normTrack);
}

const proxied = u => window.KV_MOBILE ? u : 'kvs://media/?u=' + encodeURIComponent(u);

const audio = $('#audio');
const EQ_FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_PRESETS = {
  flat: { name: 'Ровный', g: [0,0,0,0,0,0,0,0,0,0] },
  bass: { name: 'Бас-буст', g: [7,6,5,3,1,0,0,0,0,0] },
  rock: { name: 'Рок', g: [5,4,2,0,-1,0,2,3,4,4] },
  pop: { name: 'Поп', g: [-1,0,2,4,5,4,2,0,-1,-1] },
  electronic: { name: 'Электроника', g: [6,5,2,0,-2,0,1,3,5,6] },
  vocal: { name: 'Вокал', g: [-2,-2,-1,1,4,5,4,2,0,-1] },
  treble: { name: 'Верха', g: [0,0,0,0,0,1,3,5,6,7] },
  custom: { name: 'Свой', g: null }
};

let audioCtx = null, eqFilters = [], eqReady = false;
let preampNode = null, fadeNode = null, panNode = null, compNode = null, stereoGain = null, monoGain = null;

function initEq() {
  if (eqReady) return;
  try {
    audioCtx = new AudioContext();
    const src = audioCtx.createMediaElementSource(audio);
    let node = src;
    eqFilters = EQ_FREQS.map((f, i) => {
      const flt = audioCtx.createBiquadFilter();
      flt.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      flt.frequency.value = f;
      flt.Q.value = 1.1;
      flt.gain.value = 0;
      node.connect(flt);
      node = flt;
      return flt;
    });

    preampNode = audioCtx.createGain();
    fadeNode = audioCtx.createGain();
    panNode = audioCtx.createStereoPanner();
    compNode = audioCtx.createDynamicsCompressor();
    stereoGain = audioCtx.createGain();
    monoGain = audioCtx.createGain();
    monoGain.channelCount = 1;
    monoGain.channelCountMode = 'explicit';

    node.connect(preampNode);
    preampNode.connect(fadeNode);
    fadeNode.connect(panNode);
    panNode.connect(compNode);
    compNode.connect(stereoGain);
    compNode.connect(monoGain);
    stereoGain.connect(audioCtx.destination);
    monoGain.connect(audioCtx.destination);

    eqReady = true;
    applyEq();
    applyPlayback();
  } catch (e) {
    console.warn('EQ init failed', e);
  }
}

function currentGains() {
  const s = state.settings;
  if (s.eqPreset === 'custom' && s.eqGains) return s.eqGains;
  return (EQ_PRESETS[s.eqPreset] || EQ_PRESETS.flat).g || EQ_PRESETS.flat.g;
}

function applyEq() {
  if (!eqReady) return;
  const gains = state.settings.eqOn ? currentGains() : EQ_PRESETS.flat.g;
  eqFilters.forEach((f, i) => { f.gain.value = gains[i]; });
}

function applyPlayback() {
  const s = state.settings;
  audio.playbackRate = s.speed || 1;
  if (!eqReady) return;
  preampNode.gain.value = Math.pow(10, (s.preamp || 0) / 20);
  panNode.pan.value = (s.balance || 0) / 100;
  stereoGain.gain.value = s.mono ? 0 : 1;
  monoGain.gain.value = s.mono ? 1 : 0;
  if (s.normalize) {
    compNode.threshold.value = -24; compNode.knee.value = 30;
    compNode.ratio.value = 3; compNode.attack.value = 0.003; compNode.release.value = 0.25;
  } else {
    compNode.threshold.value = 0; compNode.knee.value = 0;
    compNode.ratio.value = 1; compNode.attack.value = 0.003; compNode.release.value = 0.25;
  }
}

function applyFade() {
  if (!eqReady || !fadeNode) return;
  const f = state.settings.fade || 0;
  if (!f || !audio.duration || !isFinite(audio.duration)) {
    fadeNode.gain.setTargetAtTime(1, audioCtx.currentTime, 0.05);
    return;
  }
  const t = audio.currentTime, remain = audio.duration - t;
  let v = 1;
  if (t < f) v = Math.max(t / f, 0.02);
  if (remain < f) v = Math.min(v, Math.max(remain / f, 0));
  fadeNode.gain.setTargetAtTime(v, audioCtx.currentTime, 0.12);
}

function buildOrder() {
  state.order = state.queue.map((_, i) => i);
  if (state.shuffle) {
    for (let i = state.order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
    }
  }
}

async function playQueue(tracks, index, name) {
  if (!tracks.length) return;
  state.queue = tracks.slice();
  state.queueName = name || '';
  buildOrder();
  state.orderPos = state.order.indexOf(index);
  if (state.shuffle && state.orderPos !== 0) {
    state.order.splice(state.orderPos, 1);
    state.order.unshift(index);
    state.orderPos = 0;
  }
  await playTrack(state.queue[index]);
}

function needsDsp() {
  const s = state.settings;
  return !!(s.eqOn || s.mono || s.normalize || (s.balance || 0) || (s.preamp || 0) || (s.fade || 0));
}

let lastBlobUrl = null;

async function playTrack(track) {
  state.current = track;
  updatePlayerBar();

  const dl = dlById().get(track.id);
  let localOk = false;
  if (dl && dl.path) localOk = await window.kvinta.fileExists(dl.path);

  let src = null, sameOrigin = false;
  if (localOk) {
    src = fileUrl(dl.path);
    sameOrigin = true;
  } else {
    let url = track.streamUrl || null;
    if (!url && track.source === 'ym') {
      const res = await window.kvinta.ymStreamUrl(track.id);
      if (!res.ok) {
        toast(res.error === 'no-token' || res.error === 'bad-token'
          ? 'Сервис временно недоступен'
          : 'Не удалось получить поток: ' + res.error);
        return;
      }
      url = res.url;
    }
    if (!url) { toast('У трека нет ссылки на поток'); return; }

    if (window.KV_MOBILE && (needsDsp() || eqReady) && window.kvinta.fetchStreamBlobUrl) {
      $('#pbArtist').textContent = 'загружаю…';
      const res = await window.kvinta.fetchStreamBlobUrl(url);
      if (res.ok) { src = res.url; sameOrigin = true; }
      else src = url;
    } else {
      src = window.KV_MOBILE ? url : proxied(url);
    }
  }

  if (state.current !== track) {
    if (src && src.startsWith('blob:')) URL.revokeObjectURL(src);
    return;
  }

  if (!window.KV_MOBILE || sameOrigin) initEq();
  if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();

  if (lastBlobUrl) { URL.revokeObjectURL(lastBlobUrl); lastBlobUrl = null; }
  if (src.startsWith('blob:')) lastBlobUrl = src;

  if (window.KV_MOBILE || localOk) audio.removeAttribute('crossorigin');
  else audio.setAttribute('crossorigin', 'anonymous');
  audio.src = src;
  audio.playbackRate = state.settings.speed || 1;
  try {
    await audio.play();
  } catch (e) {
    console.warn('play failed', e);
    toast('Не удалось воспроизвести трек, пропускаю…');
    nextTrack();
    return;
  }
  state.history = [{ ...track }, ...state.history.filter(x => x.id !== track.id)].slice(0, 30);
  saveHistory();
  updatePlayerBar();
  highlightPlaying();
}

function nextTrack(auto = false) {
  if (!state.queue.length) return;
  if (auto && state.sleep.stopAfterTrack) {
    state.sleep.stopAfterTrack = false;
    audio.pause(); updatePlayIcon(); syncSleepUi();
    toast('Таймер сна: музыка остановлена');
    return;
  }
  if (auto && state.repeat === 'one') { audio.currentTime = 0; audio.play(); return; }
  let pos = state.orderPos + 1;
  if (pos >= state.order.length) {
    if (state.repeat === 'all' || !auto) {
      if (state.shuffle) buildOrder();
      pos = 0;
    } else { audio.pause(); updatePlayIcon(); return; }
  }
  state.orderPos = pos;
  playTrack(state.queue[state.order[pos]]);
}

function prevTrack() {
  if (!state.queue.length) return;
  if (audio.currentTime > 4) { audio.currentTime = 0; return; }
  let pos = state.orderPos - 1;
  if (pos < 0) pos = state.order.length - 1;
  state.orderPos = pos;
  playTrack(state.queue[state.order[pos]]);
}

function togglePlay() {
  if (!audio.src) {
    const tr = state.cache['chart-tracks'];
    if (tr && tr.length) playQueue(tr, 0, 'Чарт');
    return;
  }
  if (audio.paused) { if (audioCtx) audioCtx.resume(); audio.play(); }
  else audio.pause();
}

function updatePlayerBar() {
  const t = state.current;
  if (!t) return;
  $('#app').classList.add('has-track');
  $('#pbTitle').textContent = t.title;
  const pa = $('#pbArtist');
  if (!window.KV_MOBILE && t.artists && t.artists.length) {
    pa.innerHTML = t.artists.map(a => `<span class="link" data-aid="${a.id}">${esc(a.name)}</span>`).join(', ');
    pa.classList.remove('link');
  } else {
    pa.textContent = t.artist;
    pa.classList.toggle('link', !window.KV_MOBILE && !!t.artist);
  }
  const dl = dlById().get(t.id);
  const art = t.art480 || t.art150 || (dl && dl.cover ? fileUrl(dl.cover) : null);
  $('#pbCover').style.backgroundImage = art ? `url("${art}")` : 'none';
  $('#pbLike').classList.toggle('on', favIds().has(t.id));
  document.title = `${t.title} — ${t.artist} · Kvinta`;
  syncNp();
  updateMediaSession();
}

function updateMediaSession() {
  if (!('mediaSession' in navigator) || !state.current) return;
  const t = state.current;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist, album: t.album || 'Kvinta',
      artwork: t.art480 ? [{ src: t.art480, sizes: '400x400', type: 'image/jpeg' }] : []
    });
  } catch {}
}

function updatePlayIcon() {
  const playing = !audio.paused && audio.src;
  $('#app').classList.toggle('paused', !playing);
  $('#iconPlay').style.display = playing ? 'none' : '';
  $('#iconPause').style.display = playing ? '' : 'none';
  const np = $('#iconNpPlay');
  if (np) { np.style.display = playing ? 'none' : ''; $('#iconNpPause').style.display = playing ? '' : 'none'; }
  if ('mediaSession' in navigator) {
    try { navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'; } catch {}
  }
}

function setRangeFill(el, val, max) {
  el.style.setProperty('--fill', (max ? (val / max) * 100 : 0) + '%');
}

audio.addEventListener('timeupdate', () => {
  const seek = $('#pbSeek');
  if (!seek.matches(':active') && audio.duration) {
    seek.value = (audio.currentTime / audio.duration) * 1000;
    setRangeFill(seek, audio.currentTime, audio.duration);
  }
  $('#pbTimeCur').textContent = fmtTime(audio.currentTime);
  $('#pbTimeTotal').textContent = fmtTime(audio.duration || (state.current && state.current.duration));
  const nps = $('#npSeek');
  if (nps && $('#npSheet').classList.contains('open')) {
    if (!nps.matches(':active') && audio.duration) {
      nps.value = (audio.currentTime / audio.duration) * 1000;
      setRangeFill(nps, audio.currentTime, audio.duration);
    }
    $('#npCur').textContent = fmtTime(audio.currentTime);
    $('#npTot').textContent = fmtTime(audio.duration || (state.current && state.current.duration));
  }
  if ('mediaSession' in navigator && audio.duration && isFinite(audio.duration)) {
    try {
      navigator.mediaSession.setPositionState({
        duration: audio.duration, playbackRate: audio.playbackRate || 1, position: audio.currentTime
      });
    } catch {}
  }
  applyFade();
});
audio.addEventListener('play', updatePlayIcon);
audio.addEventListener('pause', updatePlayIcon);
audio.addEventListener('ended', () => nextTrack(true));
audio.addEventListener('error', () => {
  if (audio.src && state.current) { toast('Ошибка потока, следующий трек…'); nextTrack(true); }
});

$('#pbSeek').addEventListener('input', e => {
  if (audio.duration) {
    audio.currentTime = (e.target.value / 1000) * audio.duration;
    setRangeFill(e.target, audio.currentTime, audio.duration);
  }
});
$('#pbVolume').addEventListener('input', e => {
  audio.volume = e.target.value / 100;
  state.settings.volume = audio.volume;
  saveSettings();
  setRangeFill(e.target, e.target.value, 100);
});

$('#pbPlay').addEventListener('click', togglePlay);
$('#pbNext').addEventListener('click', () => nextTrack());
$('#pbPrev').addEventListener('click', prevTrack);
$('#pbShuffle').addEventListener('click', () => {
  state.shuffle = !state.shuffle;
  $('#pbShuffle').classList.toggle('on', state.shuffle);
  if (state.queue.length) {
    const cur = state.order[state.orderPos];
    buildOrder();
    if (state.shuffle) {
      state.order.splice(state.order.indexOf(cur), 1);
      state.order.unshift(cur);
      state.orderPos = 0;
    } else state.orderPos = state.order.indexOf(cur);
  }
  toast(state.shuffle ? 'Перемешивание включено' : 'Перемешивание выключено', 1400);
});
$('#pbRepeat').addEventListener('click', () => {
  state.repeat = state.repeat === 'off' ? 'all' : state.repeat === 'all' ? 'one' : 'off';
  $('#pbRepeat').classList.toggle('on', state.repeat !== 'off');
  $('#pbRepeat').classList.toggle('one', state.repeat === 'one');
  const label = state.repeat === 'off' ? 'Повтор выключен' : state.repeat === 'all' ? 'Повтор очереди' : 'Повтор одного трека';
  $('#pbRepeat').dataset.tip = label;
  toast(label, 1400);
});
$('#pbLike').addEventListener('click', () => state.current && toggleFav(state.current));
$('#pbEq').addEventListener('click', () => switchView('settings'));
async function openArtistFromTrack(t) {
  if (!t) return;
  if (t.artists && t.artists.length) { switchView('artist', t.artists[0].id); return; }
  const name = (t.artist || '').split(',')[0].trim();
  if (!name) return;
  try {
    const data = await ym(`/search?text=${encodeURIComponent(name)}&type=artist&page=0&nocorrect=false`, 'artist-q-' + name);
    const a = data.artists && data.artists.results && data.artists.results[0];
    if (a && a.id) switchView('artist', a.id);
    else toast('Артист не найден');
  } catch {
    toast('Не удалось открыть артиста');
  }
}

$('#pbArtist').addEventListener('click', e => {
  if (window.KV_MOBILE) return;
  const t = state.current;
  if (!t) return;
  if (t.artists && t.artists.length) openArtists(e, t.artists, e.target.closest('[data-aid]')?.dataset.aid);
  else openArtistFromTrack(t);
});

let volBeforeMute = 0.8;
$('.vol-icon').addEventListener('click', () => {
  if (audio.volume > 0) { volBeforeMute = audio.volume; audio.volume = 0; }
  else audio.volume = volBeforeMute || 0.8;
  state.settings.volume = audio.volume;
  saveSettings();
  const pv = $('#pbVolume');
  pv.value = Math.round(audio.volume * 100);
  setRangeFill(pv, +pv.value, 100);
});

if ('mediaSession' in navigator) {
  try {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', () => { if (audio.src) { if (audioCtx) audioCtx.resume(); audio.play(); } });
    ms.setActionHandler('pause', () => audio.pause());
    ms.setActionHandler('previoustrack', prevTrack);
    ms.setActionHandler('nexttrack', () => nextTrack());
    ms.setActionHandler('seekto', d => { if (audio.duration && d.seekTime != null) audio.currentTime = d.seekTime; });
  } catch {}
}

window.kvinta.onMediaKey(key => {
  if (key === 'playpause') togglePlay();
  if (key === 'next') nextTrack();
  if (key === 'prev') prevTrack();
});

document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if (e.code === 'ArrowRight' && audio.duration) audio.currentTime = Math.min(audio.duration, audio.currentTime + 5);
  if (e.code === 'ArrowLeft' && audio.duration) audio.currentTime = Math.max(0, audio.currentTime - 5);
  if (e.code === 'ArrowUp' || e.code === 'ArrowDown') {
    e.preventDefault();
    audio.volume = Math.min(1, Math.max(0, audio.volume + (e.code === 'ArrowUp' ? 0.05 : -0.05)));
    state.settings.volume = audio.volume;
    saveSettings();
    const pv = $('#pbVolume');
    pv.value = Math.round(audio.volume * 100);
    setRangeFill(pv, +pv.value, 100);
  }
});

function toggleFav(track) {
  const ids = favIds();
  if (ids.has(track.id)) {
    state.favorites = state.favorites.filter(t => t.id !== track.id);
    toast('Убрано из избранного', 1400);
  } else {
    state.favorites.unshift({ ...track });
    toast('Добавлено в избранное', 1400);
  }
  saveFavs();
  updatePlayerBar();
  if (state.view === 'favorites' || state.view === 'foryou') renderView();
  else refreshRowIcons();
}

async function downloadTrack(track, btn) {
  if (dlById().has(track.id)) { toast('Трек уже скачан'); return; }
  toast(`Скачиваю: ${track.title}…`);
  if (btn) btn.style.opacity = '.4';
  const res = await window.kvinta.downloadTrack({
    id: track.id, title: track.title, artist: track.artist, source: track.source,
    artwork: track.art480 || track.art150, streamUrl: track.streamUrl
  });
  if (btn) btn.style.opacity = '';
  if (res.ok) {
    state.downloads.unshift({ ...track, path: res.path, cover: res.cover });
    saveDls();
    toast(`Скачано: ${track.title}`);
    refreshRowIcons();
    if (state.view === 'downloads') renderView();
  } else {
    toast('Не удалось скачать: ' + res.error);
  }
}

function addToPlaylist(plId, track) {
  const pl = state.playlists.find(p => p.id === plId);
  if (!pl) return;
  if (pl.tracks.some(t => t.id === track.id)) { toast('Уже есть в этом плейлисте'); return; }
  pl.tracks.push({ ...track });
  savePls();
  toast(`Добавлено в «${pl.name}»`, 1600);
}

function askText(title, placeholder, initial = '') {
  return new Promise(resolve => {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:400;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)';
    wrap.innerHTML = `
      <div style="background:#241219;border:1px solid rgba(255,255,255,.1);border-radius:16px;padding:24px;width:360px;max-width:calc(100vw - 32px);box-shadow:var(--shadow)">
        <h3 style="font-family:Montserrat;margin-bottom:14px">${esc(title)}</h3>
        <input type="text" placeholder="${esc(placeholder)}" value="${esc(initial)}"
          style="width:100%;padding:11px 14px;border-radius:10px;border:1px solid var(--line);background:#180c11;color:var(--text);font:400 14px Inter;outline:none;margin-bottom:16px">
        <div style="display:flex;gap:10px;justify-content:flex-end">
          <button class="btn secondary" data-x="cancel">Отмена</button>
          <button class="btn" data-x="ok">Готово</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);
    const input = $('input', wrap);
    input.focus(); input.select();
    const close = v => { wrap.remove(); resolve(v); };
    $('[data-x=ok]', wrap).onclick = () => close(input.value.trim() || null);
    $('[data-x=cancel]', wrap).onclick = () => close(null);
    input.onkeydown = e => {
      if (e.key === 'Enter') close(input.value.trim() || null);
      if (e.key === 'Escape') close(null);
    };
    wrap.onclick = e => { if (e.target === wrap) close(null); };
  });
}

function showTrackMenu(x, y, track, ctx) {
  const menu = $('#ctxMenu');
  const fav = favIds().has(track.id);
  const downloaded = dlById().has(track.id);
  let html = `<button data-a="fav">${fav ? 'Убрать из избранного' : 'В избранное'}</button>`;
  html += downloaded ? '<button data-a="rmdl">Удалить загрузку</button>' : '<button data-a="dl">Скачать для офлайна</button>';
  html += '<div class="cm-head">Добавить в плейлист</div>';
  if (!state.playlists.length) html += '<button data-a="newpl">+ Новый плейлист…</button>';
  else {
    state.playlists.forEach(p => { html += `<button data-a="pl" data-id="${p.id}">${esc(p.name)}</button>`; });
    html += '<button data-a="newpl">+ Новый плейлист…</button>';
  }
  if ((track.artists && track.artists.length) || track.albumId) {
    html += '<div class="cm-head">Перейти</div>';
    (track.artists || []).slice(0, 3).forEach(a => { html += `<button data-a="artist" data-id="${a.id}">${esc(a.name)}</button>`; });
    if (track.albumId) html += `<button data-a="album" data-id="${track.albumId}">Альбом «${esc(track.album)}»</button>`;
  }
  if (ctx && ctx.playlistId) html += `<div class="cm-head">Плейлист</div><button data-a="rmpl">Убрать из этого плейлиста</button>`;
  menu.innerHTML = html;
  menu.style.display = 'block';
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(12, Math.min(x, innerWidth - r.width - 12)) + 'px';
  menu.style.top = Math.max(12, Math.min(y, innerHeight - r.height - 12)) + 'px';

  menu.onclick = async e => {
    const b = e.target.closest('button');
    if (!b) return;
    hideMenu();
    const a = b.dataset.a;
    if (a === 'fav') toggleFav(track);
    if (a === 'dl') downloadTrack(track);
    if (a === 'artist') { closeNpSheet(); switchView('artist', b.dataset.id); }
    if (a === 'album') { closeNpSheet(); switchView('album', b.dataset.id); }
    if (a === 'pl') addToPlaylist(b.dataset.id, track);
    if (a === 'newpl') {
      const name = await askText('Новый плейлист', 'Название плейлиста');
      if (name) {
        const pl = { id: 'pl' + Date.now(), name, tracks: [{ ...track }] };
        state.playlists.push(pl);
        savePls();
        toast(`Плейлист «${name}» создан`);
      }
    }
    if (a === 'rmpl' && ctx.playlistId) {
      const pl = state.playlists.find(p => p.id === ctx.playlistId);
      if (pl) { pl.tracks = pl.tracks.filter(t => t.id !== track.id); savePls(); renderView(); }
    }
    if (a === 'rmdl') {
      const dl = dlById().get(track.id);
      if (dl) {
        await window.kvinta.deleteDownload(dl.path);
        state.downloads = state.downloads.filter(t => t.id !== track.id);
        saveDls();
        toast('Загрузка удалена');
        renderView();
      }
    }
  };
}
function hideMenu() { $('#ctxMenu').style.display = 'none'; }
function closeNpSheet() { $('#npSheet')?.classList.remove('open'); }

function showArtistMenu(x, y, artists) {
  const menu = $('#ctxMenu');
  menu.innerHTML = '<div class="cm-head">Артисты</div>' +
    artists.map(a => `<button data-id="${a.id}">${esc(a.name)}</button>`).join('');
  menu.style.display = 'block';
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(12, Math.min(x, innerWidth - r.width - 12)) + 'px';
  menu.style.top = Math.max(12, Math.min(y, innerHeight - r.height - 12)) + 'px';
  menu.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    hideMenu();
    closeNpSheet();
    switchView('artist', b.dataset.id);
  };
}

function openArtists(e, artists, fallbackId) {
  e.stopPropagation();
  if (artists.length > 1) showArtistMenu(e.clientX, e.clientY, artists);
  else switchView('artist', fallbackId || artists[0].id);
}
document.addEventListener('click', e => { if (!e.target.closest('#ctxMenu')) hideMenu(); });

const SLEEP_OPTS = [[0, 'Выкл'], [15, '15 мин'], [30, '30 мин'], [60, '1 час'], [90, '1,5 часа'], [-1, 'До конца трека']];
const sleepActive = () => state.sleep.stopAfterTrack ? -1 : (state.sleep.timerId ? state.sleep.minutes : 0);

function sleepStatusText() {
  if (state.sleep.stopAfterTrack) return 'Музыка остановится после текущего трека.';
  if (state.sleep.timerId) {
    const d = new Date(state.sleep.until);
    return `Пауза в ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}.`;
  }
  return 'Таймер выключен.';
}

function setSleep(min) {
  clearTimeout(state.sleep.timerId);
  state.sleep = { minutes: 0, until: 0, timerId: null, stopAfterTrack: false };
  if (min === -1) {
    state.sleep.stopAfterTrack = true;
    toast('Остановлю после этого трека', 1800);
  } else if (min > 0) {
    state.sleep.minutes = min;
    state.sleep.until = Date.now() + min * 60000;
    state.sleep.timerId = setTimeout(() => {
      audio.pause(); updatePlayIcon();
      state.sleep = { minutes: 0, until: 0, timerId: null, stopAfterTrack: false };
      syncSleepUi();
      toast('Таймер сна: музыка на паузе');
    }, min * 60000);
    toast(`Таймер сна: ${min} мин`, 1800);
  } else {
    toast('Таймер сна выключен', 1400);
  }
  syncSleepUi();
}

function syncSleepUi() {
  const act = sleepActive();
  const st = $('#sleepStatus');
  if (st) {
    st.textContent = sleepStatusText();
    $$('#sleepChips .chip').forEach(c => c.classList.toggle('active', +c.dataset.min === act));
  }
  const nb = $('#npSleep');
  if (nb) nb.classList.toggle('active', act !== 0);
}

function showSleepMenu(x, y) {
  const menu = $('#ctxMenu');
  const act = sleepActive();
  menu.innerHTML = '<div class="cm-head">Таймер сна</div>' +
    SLEEP_OPTS.map(([m, l]) => `<button data-min="${m}">${act === m ? '● ' : ''}${l}</button>`).join('');
  menu.style.display = 'block';
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.max(12, Math.min(x, innerWidth - r.width - 12)) + 'px';
  menu.style.top = Math.max(12, Math.min(y, innerHeight - r.height - 12)) + 'px';
  menu.onclick = e => {
    const b = e.target.closest('button');
    if (!b) return;
    hideMenu();
    setSleep(+b.dataset.min);
  };
}

const SVG = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 21s-8-5.3-10-10C.6 7.5 3 4 6.5 4 9 4 11 6 12 7.5 13 6 15 4 17.5 4 21 4 23.4 7.5 22 11c-2 4.7-10 10-10 10z"/></svg>',
  dl: '<svg viewBox="0 0 24 24"><path d="M12 3v10l4-4 1.4 1.4L12 15.8 6.6 10.4 8 9l3 3V3zM5 19h14v2H5z"/></svg>',
  dots: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M12 3v10.3a4 4 0 1 0 2 3.5V7h6V3z"/></svg>'
};

function artistLinksHtml(t) {
  if (t.artists && t.artists.length) {
    return t.artists.map(a => `<span class="tr-artist-name link" data-aid="${a.id}">${esc(a.name)}</span>`).join(', ');
  }
  return `<span class="tr-artist-name">${esc(t.artist)}</span>`;
}

function trackListEl(tracks, ctx = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'tracklist';
  wrap.innerHTML = `<div class="tl-head"><span>#</span><span></span><span>Название</span><span style="text-align:right">Время</span><span></span></div>`;
  const ids = favIds(), dls = dlById();
  tracks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'track-row';
    row.dataset.tid = t.id;
    const dl = dls.get(t.id);
    const art = t.art150 || (dl && dl.cover ? fileUrl(dl.cover) : null);
    row.innerHTML = `
      <div class="tr-num"><span>${i + 1}</span>${SVG.play}<i class="tr-eq"><b></b><b></b><b></b></i></div>
      <div class="tr-cover" style="${art ? `background-image:url('${art}')` : ''}"></div>
      <div class="tr-main">
        <div class="tr-title">${esc(t.title)}</div>
        <div class="tr-artist">${artistLinksHtml(t)}${t.album ? ' · ' + esc(t.album) : (t.genre ? ' · ' + esc(t.genre) : '')}</div>
      </div>
      <div class="tr-dur">${fmtTime(t.duration)}</div>
      <div class="tr-actions">
        <button class="icon-btn a-like ${ids.has(t.id) ? 'on' : ''}" title="В избранное">${SVG.heart}</button>
        <button class="icon-btn a-dl ${dls.has(t.id) ? 'dl-done on' : ''}" title="${dls.has(t.id) ? 'Скачан' : 'Скачать для офлайна'}">${SVG.dl}</button>
        <button class="icon-btn a-menu" title="Ещё">${SVG.dots}</button>
      </div>`;
    row.addEventListener('click', e => {
      if (e.target.closest('.icon-btn')) return;
      playQueue(tracks, i, ctx.name);
    });
    $('.a-like', row).addEventListener('click', () => toggleFav(t));
    $('.a-dl', row).addEventListener('click', e => downloadTrack(t, e.currentTarget));
    $('.a-menu', row).addEventListener('click', e => {
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      showTrackMenu(r.left, r.bottom + 4, t, ctx);
    });
    row.addEventListener('contextmenu', e => { e.preventDefault(); showTrackMenu(e.clientX, e.clientY, t, ctx); });
    $$('.tr-artist-name.link', row).forEach(an => {
      an.addEventListener('click', e => openArtists(e, t.artists, an.dataset.aid));
    });
    wrap.appendChild(row);
  });
  return wrap;
}

function highlightPlaying() {
  $$('.track-row').forEach(r => r.classList.toggle('playing', state.current && r.dataset.tid === String(state.current.id)));
}

function refreshRowIcons() {
  const ids = favIds(), dls = dlById();
  $$('.track-row').forEach(r => {
    const tid = r.dataset.tid;
    $('.a-like', r)?.classList.toggle('on', ids.has(tid));
    const d = $('.a-dl', r);
    if (d) { d.classList.toggle('dl-done', dls.has(tid)); d.classList.toggle('on', dls.has(tid)); }
  });
  updatePlayerBar();
}

function cardRowEl(tracks, name) {
  const row = document.createElement('div');
  row.className = 'card-row';
  tracks.forEach((t, i) => {
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = `
      <div class="card-cover" style="${t.art480 ? `background-image:url('${t.art480}')` : ''}"></div>
      <div class="card-title">${esc(t.title)}</div>
      <div class="card-sub">${esc(t.artist)}</div>
      <button class="card-play">${SVG.play}</button>`;
    c.addEventListener('click', () => playQueue(tracks, i, name));
    row.appendChild(c);
  });
  return row;
}

const loaderHtml = '<div class="loader"><i></i><i></i><i></i><i></i><i></i></div>';
function emptyStateHtml(title, text) {
  return `<div class="empty-state">${SVG.note.replace('<svg', '<svg width="64" height="64"')}<h3>${esc(title)}</h3><p>${esc(text)}</p></div>`;
}

const container = $('#viewContainer');
let navStack = [];
let backNav = false;

function switchView(view, param = null) {
  const detail = view === 'artist' || view === 'album';
  if (!backNav) {
    if (detail && (state.view !== view || String(state.viewParam) !== String(param))) {
      navStack.push({ view: state.view, param: state.viewParam });
      if (navStack.length > 20) navStack.shift();
    }
    if (!detail) navStack = [];
  }
  state.view = view;
  state.viewParam = param;
  $$('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  renderView();
  $('#main').scrollTop = 0;
}

function goBack() {
  const prev = navStack.pop() || { view: 'new', param: null };
  backNav = true;
  switchView(prev.view, prev.param);
  backNav = false;
}

function renderView() {
  const v = state.view;
  if (v === 'new') return renderNew();
  if (v === 'search') return renderSearch();
  if (v === 'foryou') return renderForYou();
  if (v === 'favorites') return renderFavorites();
  if (v === 'playlists') return state.viewParam ? renderPlaylistDetail(state.viewParam) : renderPlaylists();
  if (v === 'downloads') return renderDownloads();
  if (v === 'settings') return renderSettings();
  if (v === 'artist') return renderArtist(state.viewParam);
  if (v === 'album') return renderAlbum(state.viewParam);
}

async function renderNew() {
  container.innerHTML = `
    <div class="hero">
      <h1>Твоя музыка.<br><span>Твоя волна.</span></h1>
      <p>Весь каталог Яндекс Музыки — слушай онлайн, сохраняй офлайн, собирай свои плейлисты.</p>
      <button class="btn" id="heroPlay">${SVG.play} Слушать чарт</button>
      <div class="bars"></div>
    </div>
    <div id="secWeek"><h2 class="row-title">В тренде сейчас</h2>${loaderHtml}</div>
    <div id="secUnder"><h2 class="row-title">Андеграунд</h2>${loaderHtml}</div>
    <div id="secMonth"><h2 class="row-title">Топ месяца</h2>${loaderHtml}</div>`;

  const bars = $('.hero .bars');
  bars.innerHTML = '';
  for (let i = 0; i < 12; i++) {
    const b = document.createElement('i');
    b.style.height = (26 + Math.random() * 80) + 'px';
    b.style.animationDelay = (Math.random() * -1.1) + 's';
    b.style.animationDuration = (0.7 + Math.random() * 0.9) + 's';
    bars.appendChild(b);
  }

  if (state.history.length) {
    const sec = document.createElement('div');
    const h = document.createElement('h2');
    h.className = 'row-title';
    h.textContent = 'Ты недавно слушал';
    sec.appendChild(h);
    sec.appendChild(cardRowEl(state.history.slice(0, 15), 'Недавнее'));
    $('#secWeek').before(sec);
  }

  $('#heroPlay').addEventListener('click', async () => {
    try {
      const tr = await loadChartTracks();
      playQueue(tr, 0, 'Чарт');
    } catch { toast('Нет соединения с Яндекс Музыкой'); }
  });

  try {
    const chart = await loadChartTracks();
    if (state.view !== 'new') return;
    $('#secWeek').innerHTML = '<h2 class="row-title">Чарт</h2><div class="row-sub">Самое популярное в Яндекс Музыке прямо сейчас</div>';
    $('#secWeek').appendChild(cardRowEl(chart.slice(0, 20), 'Чарт'));

    const rel = await ym('/landing3?blocks=new-releases', 'newrel');
    if (state.view !== 'new') return;
    const albums = ((rel.blocks && rel.blocks[0] && rel.blocks[0].entities) || [])
      .map(e => e.data).filter(a => a && a.id);
    $('#secUnder').innerHTML = '<h2 class="row-title">Новые релизы</h2><div class="row-sub">Свежие альбомы и синглы</div>';
    $('#secUnder').appendChild(albumCardRowEl(albums));

    if (state.view !== 'new') return;
    $('#secMonth').innerHTML = '<h2 class="row-title">Чарт целиком</h2>';
    $('#secMonth').appendChild(trackListEl(chart, { name: 'Чарт' }));
    highlightPlaying();
  } catch (e) {
    if (state.view !== 'new') return;
    const msg = String(e.message).includes('token')
      ? 'Сервис временно недоступен. Попробуй позже или обнови приложение.'
      : 'Не удалось загрузить треки из сети. Проверь интернет и попробуй ещё раз.';
    $('#secWeek').innerHTML = emptyStateHtml('Каталог недоступен', msg) +
      '<div style="text-align:center"><button class="btn secondary" onclick="renderView()">Повторить</button></div>';
    $('#secUnder').innerHTML = ''; $('#secMonth').innerHTML = '';
  }
}

async function loadChartTracks() {
  if (state.cache['chart-tracks']) return state.cache['chart-tracks'];
  const data = await ym('/landing3/chart/russia');
  const tracks = extractTracks(data.chart && data.chart.tracks);
  state.cache['chart-tracks'] = tracks;
  return tracks;
}

function albumCardRowEl(albums) {
  const row = document.createElement('div');
  row.className = 'card-row';
  albums.forEach(a => {
    const c = document.createElement('div');
    c.className = 'card';
    const artist = (a.artists || []).map(x => x.name).join(', ');
    c.innerHTML = `
      <div class="card-cover" style="${a.coverUri ? `background-image:url('${ymCover(a.coverUri, '400x400')}')` : ''}"></div>
      <div class="card-title">${esc(a.title)}</div>
      <div class="card-sub">${esc(artist || 'Альбом')}</div>
      <button class="card-play">${SVG.play}</button>`;
    c.addEventListener('click', e => {
      if (e.target.closest('.card-play')) { playAlbum(a.id, a.title); return; }
      switchView('album', a.id);
    });
    row.appendChild(c);
  });
  return row;
}

async function loadAlbum(id) {
  const full = await ym(`/albums/${id}/with-tracks`, 'album-' + id);
  return { album: full, tracks: extractTracks((full.volumes || []).flat()) };
}

async function playAlbum(id, title) {
  toast('Загружаю альбом…', 1200);
  try {
    const { album, tracks } = await loadAlbum(id);
    if (tracks.length) playQueue(tracks, 0, album.title || title);
    else toast('В альбоме нет доступных треков');
  } catch { toast('Не удалось открыть альбом'); }
}

async function renderAlbum(id) {
  container.innerHTML = loaderHtml;
  try {
    const { album, tracks } = await loadAlbum(id);
    if (state.view !== 'album' || String(state.viewParam) !== String(id)) return;
    const cov = album.coverUri ? ymCover(album.coverUri, '400x400') : null;
    const artist = (album.artists || []).map(x => x.name).join(', ');
    const meta = [album.year, album.genre, tracks.length ? tracks.length + ' трек(ов)' : null].filter(Boolean).join(' · ');
    container.innerHTML = `
      <button class="btn secondary" id="albumBack" style="margin-bottom:18px">← Назад</button>
      <div class="pl-detail-head">
        <div class="pl-detail-cover ${cov ? '' : 'pl-cover-gen'}" style="${cov ? `background:url('${cov}') center/cover` : `background:${PL_GRADS[0]}`}">${cov ? '' : esc((album.title || '?')[0].toUpperCase())}</div>
        <div>
          <div class="kind">Альбом</div>
          <h1>${esc(album.title || 'Альбом')}</h1>
          <div class="stats">${esc(artist)}${artist && meta ? ' · ' : ''}${esc(meta)}</div>
          <div class="pl-actions">${tracks.length ? `<button class="btn" id="albumPlay">${SVG.play} Слушать</button>` : ''}</div>
        </div>
      </div>
      <div id="albumBody"></div>`;
    $('#albumBack').addEventListener('click', goBack);
    if (tracks.length) {
      $('#albumPlay').addEventListener('click', () => playQueue(tracks, 0, album.title));
      $('#albumBody').appendChild(trackListEl(tracks, { name: album.title }));
    } else {
      $('#albumBody').innerHTML = emptyStateHtml('Пусто', 'В этом альбоме нет доступных треков.');
    }
    highlightPlaying();
  } catch {
    if (state.view !== 'album') return;
    container.innerHTML = emptyStateHtml('Не удалось открыть альбом', 'Проверь соединение и попробуй ещё раз.');
  }
}

let searchTimer = null;

function artistCardRowEl(artists) {
  const row = document.createElement('div');
  row.className = 'card-row';
  artists.forEach(a => {
    const c = document.createElement('div');
    c.className = 'card';
    const cov = a.cover && a.cover.uri ? ymCover(a.cover.uri, '400x400') : null;
    c.innerHTML = `
      <div class="card-cover round" style="${cov ? `background-image:url('${cov}')` : ''}"></div>
      <div class="card-title">${esc(a.name)}</div>
      <div class="card-sub">${esc((a.genres || [])[0] || 'Артист')}</div>`;
    c.addEventListener('click', () => switchView('artist', a.id));
    row.appendChild(c);
  });
  return row;
}

function sectionTitle(box, text) {
  const h = document.createElement('h2');
  h.className = 'row-title';
  h.textContent = text;
  box.appendChild(h);
}

function renderSearch() {
  container.innerHTML = `
    <h1 class="page-title">Поиск</h1>
    <div class="search-box">
      <svg viewBox="0 0 24 24"><path d="M10 2a8 8 0 1 0 4.9 14.3l4.4 4.4 1.4-1.4-4.4-4.4A8 8 0 0 0 10 2zm0 2a6 6 0 1 1 0 12 6 6 0 0 1 0-12z"/></svg>
      <input id="searchInput" type="text" placeholder="Треки, артисты, альбомы…" autofocus>
    </div>
    <div id="searchResults"></div>`;
  const input = $('#searchInput');
  const box = $('#searchResults');
  const idle = () => { box.innerHTML = emptyStateHtml('Найди свою музыку', 'Начни печатать — результаты появятся сразу.'); };

  async function run(q) {
    box.innerHTML = loaderHtml;
    try {
      const data = await ym(`/search?text=${encodeURIComponent(q)}&type=all&page=0&nocorrect=false`, 'search-' + q);
      if ($('#searchInput')?.value.trim() !== q) return;
      const tracks = extractTracks(data.tracks && data.tracks.results);
      const artists = ((data.artists && data.artists.results) || []).filter(a => a && a.id);
      const albums = ((data.albums && data.albums.results) || []).filter(a => a && a.id);
      box.innerHTML = '';
      if (!tracks.length && !artists.length && !albums.length) {
        box.innerHTML = emptyStateHtml('Ничего не нашлось', 'Попробуй другой запрос.');
        return;
      }
      if (artists.length) {
        sectionTitle(box, 'Артисты');
        box.appendChild(artistCardRowEl(artists.slice(0, 10)));
      }
      if (tracks.length) {
        sectionTitle(box, 'Треки');
        box.appendChild(trackListEl(tracks, { name: `Поиск: ${q}` }));
      }
      if (albums.length) {
        sectionTitle(box, 'Альбомы');
        box.appendChild(albumCardRowEl(albums.slice(0, 12)));
      }
      highlightPlaying();
    } catch {
      box.innerHTML = emptyStateHtml('Ошибка сети', 'Не удалось выполнить поиск.');
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    state.searchQuery = q;
    if (!q) { idle(); return; }
    searchTimer = setTimeout(() => run(q), 350);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      clearTimeout(searchTimer);
      run(input.value.trim());
    }
  });

  if (state.searchQuery) {
    input.value = state.searchQuery;
    run(state.searchQuery);
  } else idle();
  input.focus();
}

async function renderArtist(id) {
  container.innerHTML = loaderHtml;
  try {
    const data = await ym(`/artists/${id}/brief-info`, 'artist-' + id);
    if (state.view !== 'artist' || String(state.viewParam) !== String(id)) return;
    const a = data.artist || {};
    const tracks = extractTracks(data.popularTracks);
    const albums = (data.albums || []).filter(x => x && x.id);
    const cov = a.cover && a.cover.uri ? ymCover(a.cover.uri, '400x400') : null;
    container.innerHTML = `
      <button class="btn secondary" id="artistBack" style="margin-bottom:18px">← Назад</button>
      <div class="pl-detail-head">
        <div class="pl-detail-cover round ${cov ? '' : 'pl-cover-gen'}" style="${cov ? `background:url('${cov}') center/cover` : `background:${PL_GRADS[0]}`}">${cov ? '' : esc((a.name || '?')[0].toUpperCase())}</div>
        <div>
          <div class="kind">Артист</div>
          <h1>${esc(a.name || 'Артист')}</h1>
          <div class="stats">${esc((a.genres || []).join(', '))}</div>
          <div class="pl-actions">${tracks.length ? `<button class="btn" id="artistPlay">${SVG.play} Слушать</button>` : ''}</div>
        </div>
      </div>
      <div id="artistBody"></div>`;
    $('#artistBack').addEventListener('click', goBack);
    if (tracks.length) $('#artistPlay').addEventListener('click', () => playQueue(tracks, 0, a.name));
    const body = $('#artistBody');
    if (tracks.length) {
      sectionTitle(body, 'Популярные треки');
      body.appendChild(trackListEl(tracks, { name: a.name }));
    }
    if (albums.length) {
      sectionTitle(body, 'Альбомы');
      body.appendChild(albumCardRowEl(albums.slice(0, 15)));
    }
    if (!tracks.length && !albums.length) body.innerHTML = emptyStateHtml('Пусто', 'У этого артиста нет доступных треков.');
    highlightPlaying();
  } catch {
    if (state.view !== 'artist') return;
    container.innerHTML = emptyStateHtml('Не удалось открыть артиста', 'Проверь соединение и попробуй ещё раз.');
  }
}

async function renderForYou() {
  container.innerHTML = `<h1 class="page-title">Для тебя</h1><div id="fyBody">${loaderHtml}</div>`;
  const body = $('#fyBody');
  let added = 0;

  try {
    const data = await ym('/landing3?blocks=personalplaylists', 'fy-personal');
    if (state.view !== 'foryou') return;
    const pls = ((data.blocks && data.blocks[0] && data.blocks[0].entities) || [])
      .map(e => e.data && e.data.data).filter(p => p && p.kind != null && p.owner);
    body.innerHTML = '';
    for (const p of pls) {
      try {
        const pd = await ym(`/users/${p.owner.uid}/playlists/${p.kind}?rich-tracks=true`, `fy-pl-${p.kind}`);
        if (state.view !== 'foryou') return;
        const tracks = extractTracks(pd.tracks).slice(0, 25);
        if (!tracks.length) continue;
        const h = document.createElement('h2'); h.className = 'row-title'; h.textContent = p.title || pd.title || 'Подборка';
        const sub = document.createElement('div'); sub.className = 'row-sub'; sub.textContent = 'Персональная подборка Яндекс Музыки';
        body.appendChild(h); body.appendChild(sub);
        body.appendChild(cardRowEl(tracks, p.title || 'Подборка'));
        added++;
      } catch {}
    }
  } catch (e) {
    body.innerHTML = '';
  }

  const favs = state.favorites.filter(t => t.source === 'ym').slice(0, 3);
  const favSet = favIds();
  for (const f of favs) {
    try {
      const sim = await ym(`/tracks/${f.id}/similar`, 'fy-sim-' + f.id);
      if (state.view !== 'foryou') return;
      const tracks = extractTracks(sim.similarTracks).filter(t => !favSet.has(t.id)).slice(0, 10);
      if (!tracks.length) continue;
      const h = document.createElement('h2'); h.className = 'row-title'; h.textContent = `Похоже на «${f.title}»`;
      body.appendChild(h);
      body.appendChild(trackListEl(tracks, { name: `Похоже на ${f.title}` }));
      added++;
    } catch {}
  }

  if (!added) {
    body.innerHTML = emptyStateHtml('Подборки не собрались',
      'Проверь соединение и лайкай треки — появятся разделы «Похоже на…».');
  }
  highlightPlaying();
}

function renderFavorites() {
  container.innerHTML = `<h1 class="page-title">Избранное</h1>`;
  if (!state.favorites.length) {
    container.insertAdjacentHTML('beforeend', emptyStateHtml('Здесь будут любимые треки', 'Жми на сердечко у любого трека, чтобы сохранить его сюда.'));
    return;
  }
  const btn = document.createElement('button');
  btn.className = 'btn'; btn.style.marginBottom = '18px';
  btn.innerHTML = `${SVG.play} Слушать всё`;
  btn.addEventListener('click', () => playQueue(state.favorites, 0, 'Избранное'));
  container.appendChild(btn);
  container.appendChild(trackListEl(state.favorites, { name: 'Избранное' }));
  highlightPlaying();
}

const PL_GRADS = [
  'linear-gradient(135deg,#ff1e42,#ff6a3d)', 'linear-gradient(135deg,#b3122f,#ff5c72)',
  'linear-gradient(135deg,#7a0f22,#ff1e42)', 'linear-gradient(135deg,#ff6a3d,#ffb03d)',
  'linear-gradient(135deg,#42060f,#c2183a)'
];
const plGrad = pl => PL_GRADS[[...pl.id].reduce((a, c) => a + c.charCodeAt(0), 0) % PL_GRADS.length];

function renderPlaylists() {
  container.innerHTML = `<h1 class="page-title">Плейлисты</h1>`;
  const top = document.createElement('div');
  top.style.marginBottom = '20px';
  const nb = document.createElement('button');
  nb.className = 'btn'; nb.textContent = '+ Создать плейлист';
  nb.addEventListener('click', createPlaylistFlow);
  top.appendChild(nb);
  container.appendChild(top);

  if (!state.playlists.length) {
    container.insertAdjacentHTML('beforeend', emptyStateHtml('Плейлистов пока нет', 'Создай первый — и наполняй его через меню у любого трека.'));
    return;
  }
  const grid = document.createElement('div');
  grid.className = 'pl-grid';
  state.playlists.forEach(pl => {
    const first = pl.tracks[0];
    const c = document.createElement('div');
    c.className = 'card';
    c.innerHTML = `
      <div class="card-cover ${first && first.art480 ? '' : 'pl-cover-gen'}" style="${first && first.art480 ? `background-image:url('${first.art480}')` : `background:${plGrad(pl)}`}">${first && first.art480 ? '' : esc(pl.name[0].toUpperCase())}</div>
      <div class="card-title">${esc(pl.name)}</div>
      <div class="card-sub">${pl.tracks.length} трек(ов)</div>
      <button class="card-play">${SVG.play}</button>`;
    c.addEventListener('click', e => {
      if (e.target.closest('.card-play')) { if (pl.tracks.length) playQueue(pl.tracks, 0, pl.name); return; }
      switchView('playlists', pl.id);
    });
    grid.appendChild(c);
  });
  container.appendChild(grid);
}

async function createPlaylistFlow() {
  const name = await askText('Новый плейлист', 'Название плейлиста');
  if (!name) return;
  state.playlists.push({ id: 'pl' + Date.now(), name, tracks: [] });
  savePls();
  if (state.view === 'playlists' && !state.viewParam) renderView();
  toast(`Плейлист «${name}» создан`);
}

function renderPlaylistDetail(plId) {
  const pl = state.playlists.find(p => p.id === plId);
  if (!pl) return switchView('playlists');
  const dur = pl.tracks.reduce((a, t) => a + (t.duration || 0), 0);
  container.innerHTML = `
    <div class="pl-detail-head">
      <div class="pl-detail-cover ${pl.tracks[0] && pl.tracks[0].art480 ? '' : 'pl-cover-gen'}"
        style="${pl.tracks[0] && pl.tracks[0].art480 ? `background:url('${pl.tracks[0].art480}') center/cover` : `background:${plGrad(pl)}`}">${pl.tracks[0] && pl.tracks[0].art480 ? '' : esc(pl.name[0].toUpperCase())}</div>
      <div>
        <div class="kind">Плейлист</div>
        <h1>${esc(pl.name)}</h1>
        <div class="stats">${pl.tracks.length} трек(ов) · ${fmtTime(dur)}</div>
        <div class="pl-actions">
          <button class="btn" id="plPlay">${SVG.play} Слушать</button>
          <button class="btn secondary" id="plRename">Переименовать</button>
          <button class="btn danger" id="plDelete">Удалить</button>
        </div>
      </div>
    </div>
    <div id="plTracks"></div>`;
  $('#plPlay').addEventListener('click', () => pl.tracks.length && playQueue(pl.tracks, 0, pl.name));
  $('#plRename').addEventListener('click', async () => {
    const name = await askText('Переименовать плейлист', 'Новое название', pl.name);
    if (name) { pl.name = name; savePls(); renderView(); }
  });
  $('#plDelete').addEventListener('click', () => {
    state.playlists = state.playlists.filter(p => p.id !== plId);
    savePls();
    toast(`Плейлист «${pl.name}» удалён`);
    switchView('playlists');
  });
  const box = $('#plTracks');
  if (!pl.tracks.length) box.innerHTML = emptyStateHtml('Плейлист пуст', 'Добавляй треки через меню в любом списке.');
  else { box.appendChild(trackListEl(pl.tracks, { name: pl.name, playlistId: plId })); highlightPlaying(); }
}

function renderSidebarPlaylists() {
  const box = $('#sidebarPlaylists');
  box.innerHTML = '';
  state.playlists.forEach(pl => {
    const b = document.createElement('button');
    b.className = 'side-pl';
    b.textContent = pl.name;
    b.addEventListener('click', () => switchView('playlists', pl.id));
    box.appendChild(b);
  });
}

function renderDownloads() {
  container.innerHTML = `<h1 class="page-title">Загрузки</h1>
    <div class="row-sub">${window.KV_MOBILE
      ? 'Эти треки сохранены в памяти телефона и играют даже без интернета.'
      : 'Эти треки сохранены на диск и играют даже без интернета. Папка: Музыка\\Kvinta'}</div>`;
  const bar = document.createElement('div');
  bar.style.cssText = 'display:flex;gap:10px;margin-bottom:18px';
  if (state.downloads.length) {
    const p = document.createElement('button');
    p.className = 'btn'; p.innerHTML = `${SVG.play} Слушать всё`;
    p.addEventListener('click', () => playQueue(state.downloads, 0, 'Загрузки'));
    bar.appendChild(p);
  }
  if (!window.KV_MOBILE) {
    const f = document.createElement('button');
    f.className = 'btn secondary'; f.textContent = 'Открыть папку';
    f.addEventListener('click', () => window.kvinta.openDownloadsFolder());
    bar.appendChild(f);
  }
  container.appendChild(bar);

  if (!state.downloads.length) {
    container.insertAdjacentHTML('beforeend', emptyStateHtml('Загрузок пока нет', 'Нажми кнопку загрузки у любого трека — он сохранится и будет доступен офлайн.'));
    return;
  }
  container.appendChild(trackListEl(state.downloads, { name: 'Загрузки', downloads: true }));
  highlightPlaying();
}

let APP_VERSION = window.KV_VERSION || '';
let manualCheckPending = false;

function updateBoxHtml() {
  const u = state.update;
  if (u.state === 'available') {
    return `<div class="hint">Доступна версия ${esc(u.version)}</div>
      <button class="btn" id="updGo">Обновить</button>`;
  }
  if (u.state === 'downloading') {
    if (window.KV_MOBILE) {
      return `<div class="hint">Скачиваю ${esc(u.version || '')}… <span id="updPct">${u.percent || 0}%</span></div>
        <div class="upd-bar"><i id="updBarFill" style="width:${u.percent || 0}%"></i></div>`;
    }
    return `<div class="hint">Скачиваю обновление ${esc(u.version || '')}…</div>`;
  }
  if (u.state === 'ready') {
    return `<button class="btn" id="updGo">${window.KV_MOBILE ? `Установить ${esc(u.version)}` : `Перезапустить и обновить до ${esc(u.version)}`}</button>`;
  }
  if (u.state === 'dev') return '';
  return `<button class="btn secondary" id="updCheck">Проверить обновления</button>`;
}

function refreshUpdateBox() {
  const box = $('#updBox');
  if (box) { box.innerHTML = updateBoxHtml(); bindUpdateBox(); }
}

function bindUpdateBox() {
  $('#updCheck')?.addEventListener('click', async () => {
    toast('Проверяю обновления…', 1500);
    if (window.KV_MOBILE) {
      await mobileCheckUpdate(true);
    } else {
      manualCheckPending = true;
      window.kvinta.checkUpdate();
    }
  });
  $('#updGo')?.addEventListener('click', async () => {
    const u = state.update;
    if (u.state === 'ready') { window.kvinta.installUpdate(); return; }
    if (u.state === 'available' && window.KV_MOBILE) {
      state.update = { ...u, state: 'downloading', percent: 0 };
      refreshUpdateBox();
      const r = await window.kvinta.downloadUpdate(u.apkUrl, (done, total) => {
        const p = total ? Math.min(100, Math.round(done / total * 100)) : 0;
        state.update.percent = p;
        const f = $('#updBarFill'), t = $('#updPct');
        if (f) f.style.width = p + '%';
        if (t) t.textContent = p + '%';
      });
      if (r.ok) {
        state.update = { ...u, state: 'ready' };
        toast('Обновление скачано — можно устанавливать', 3000);
      } else {
        state.update = { ...u, state: 'available' };
        toast('Не удалось скачать: ' + r.error);
      }
      refreshUpdateBox();
    }
  });
}

async function mobileCheckUpdate(manual) {
  const r = await window.kvinta.checkUpdate();
  if (r.ok && r.update) {
    state.update = { state: 'available', version: r.version, assetId: r.assetId, apkUrl: r.apkUrl };
    if (!manual) toast(`Вышла Kvinta ${r.version} — обновись в настройках`, 4000);
    refreshUpdateBox();
  } else if (manual) {
    toast(r.ok ? 'У тебя последняя версия' : 'Не удалось проверить: ' + r.error, 2200);
  }
}

if (window.KV_MOBILE) {
  setTimeout(() => mobileCheckUpdate(false), 5000);
} else if (window.kvinta.onUpdateStatus) {
  window.kvinta.appVersion().then(v => { APP_VERSION = v; });
  window.kvinta.updateStatus().then(s => { state.update = s; refreshUpdateBox(); });
  window.kvinta.onUpdateStatus(s => {
    state.update = s;
    if (s.state === 'ready') toast(`Обновление ${s.version} готово — установи в настройках`, 4500);
    if (manualCheckPending) {
      if (s.state === 'none') toast('У тебя последняя версия', 2200);
      if (s.state === 'error') toast('Не удалось проверить: ' + s.error, 2600);
      if (s.state !== 'downloading') manualCheckPending = false;
    }
    refreshUpdateBox();
  });
}

function renderSettings() {
  const s = state.settings;
  const gains = s.eqPreset === 'custom' && s.eqGains ? s.eqGains : (EQ_PRESETS[s.eqPreset] || EQ_PRESETS.flat).g || EQ_PRESETS.flat.g;
  container.innerHTML = `
    <h1 class="page-title">Настройки</h1>

    <div class="settings-card">
      <h3>Воспроизведение</h3>
      <div class="hint">Тонкая настройка звука — применяется сразу, без перезапуска трека.</div>

      <div class="settings-row mobile-only">
        <span style="font-weight:600">Громкость <span class="hint-inline" id="volVal">${Math.round((s.volume ?? 0.8) * 100)}%</span></span>
        <input type="range" id="setVolume" class="h-slider" min="0" max="100" value="${Math.round((s.volume ?? 0.8) * 100)}">
      </div>

      <div class="settings-row">
        <span style="font-weight:600">Скорость воспроизведения <span class="hint-inline" id="speedVal">×${(s.speed || 1).toFixed(2)}</span></span>
        <input type="range" id="setSpeed" class="h-slider" min="50" max="200" step="5" value="${Math.round((s.speed || 1) * 100)}">
      </div>

      <div class="settings-row">
        <span style="font-weight:600">Плавные переходы <span class="hint-inline" id="fadeVal">${s.fade ? s.fade + ' с' : 'выкл'}</span><br>
          <small class="hint-inline">затухание в конце и нарастание в начале трека</small></span>
        <input type="range" id="setFade" class="h-slider" min="0" max="12" step="1" value="${s.fade || 0}">
      </div>

      <div class="settings-row">
        <span style="font-weight:600">Баланс <span class="hint-inline" id="balVal">${s.balance ? (s.balance < 0 ? 'Л ' + (-s.balance) : 'П ' + s.balance) : 'центр'}</span></span>
        <input type="range" id="setBalance" class="h-slider" min="-100" max="100" step="5" value="${s.balance || 0}">
      </div>

      <div class="settings-row">
        <span style="font-weight:600">Усиление (preamp) <span class="hint-inline" id="preVal">${s.preamp > 0 ? '+' : ''}${s.preamp || 0} дБ</span></span>
        <input type="range" id="setPreamp" class="h-slider" min="-6" max="6" step="1" value="${s.preamp || 0}">
      </div>

      <div class="settings-row">
        <span style="font-weight:600">Нормализация громкости<br><small class="hint-inline">выравнивает тихие и громкие треки</small></span>
        <label class="switch"><input type="checkbox" id="setNorm" ${s.normalize ? 'checked' : ''}><i></i></label>
      </div>

      <div class="settings-row">
        <span style="font-weight:600">Моно-звук<br><small class="hint-inline">смешивает каналы — полезно для одного наушника</small></span>
        <label class="switch"><input type="checkbox" id="setMono" ${s.mono ? 'checked' : ''}><i></i></label>
      </div>
    </div>

    <div class="settings-card">
      <h3>Эквалайзер</h3>
      <div class="hint">10 полос, пресеты или ручная настройка. Применяется на лету.</div>
      <div class="hint mobile-only">На телефоне трек с обработкой звука сначала загружается целиком — старт может быть чуть дольше.</div>
      <div class="settings-row" style="margin-bottom:14px">
        <span style="font-weight:600">Включить эквалайзер</span>
        <label class="switch"><input type="checkbox" id="eqOn" ${s.eqOn ? 'checked' : ''}><i></i></label>
      </div>
      <div class="eq-presets" id="eqPresets">
        ${Object.entries(EQ_PRESETS).map(([k, p]) => `<button class="chip ${s.eqPreset === k ? 'active' : ''}" data-p="${k}">${p.name}</button>`).join('')}
      </div>
      <div class="eq-bands" id="eqBands">
        ${EQ_FREQS.map((f, i) => `
          <div class="eq-band">
            <span class="db" id="db${i}">${gains[i] > 0 ? '+' : ''}${gains[i]}</span>
            <input type="range" min="-12" max="12" step="1" value="${gains[i]}" data-band="${i}">
            <span class="freq">${f >= 1000 ? (f / 1000) + 'k' : f}</span>
          </div>`).join('')}
      </div>
    </div>

    <div class="settings-card desktop-only">
      <h3>Загрузки</h3>
      <div class="hint">Скачанные треки хранятся в папке Музыка\\Kvinta и играют без интернета.</div>
      <button class="btn secondary" id="openDlFolder">Открыть папку загрузок</button>
    </div>

    <div class="settings-card">
      <h3>Таймер сна</h3>
      <div class="hint">Музыка остановится сама — можно засыпать спокойно.</div>
      <div class="eq-presets" id="sleepChips" style="margin-bottom:0">
        ${SLEEP_OPTS.map(([m, l]) => `<button class="chip ${sleepActive() === m ? 'active' : ''}" data-min="${m}">${l}</button>`).join('')}
      </div>
      <div class="hint" id="sleepStatus" style="margin:12px 0 0">${sleepStatusText()}</div>
    </div>

    <div class="settings-card">
      <h3>Сброс настроек</h3>
      <div class="hint">Вернёт звук, эквалайзер, скорость и громкость к значениям по умолчанию. Избранное, плейлисты и загрузки не тронет.</div>
      <button class="btn secondary" id="setReset">Сбросить всё по умолчанию</button>
    </div>

    <div class="settings-card">
      <h3>О приложении</h3>
      <div class="hint">
        <b style="color:var(--text)">Kvinta</b> ${APP_VERSION ? 'v' + APP_VERSION : ''} — локальный музыкальный сервис.<br>
        Избранное, плейлисты и загрузки хранятся только на этом устройстве.<br><br>
        © MortisClub 2026
      </div>
      <div id="updBox">${updateBoxHtml()}</div>
    </div>`;

  $('#setVolume').addEventListener('input', e => {
    audio.volume = e.target.value / 100;
    s.volume = audio.volume;
    $('#volVal').textContent = e.target.value + '%';
    const pv = $('#pbVolume');
    pv.value = e.target.value;
    setRangeFill(pv, +e.target.value, 100);
    saveSettings();
  });
  $('#sleepChips').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (b) setSleep(+b.dataset.min);
  });
  bindUpdateBox();
  $('#setSpeed').addEventListener('input', e => {
    s.speed = e.target.value / 100;
    $('#speedVal').textContent = '×' + s.speed.toFixed(2);
    saveSettings(); applyPlayback();
  });
  $('#setFade').addEventListener('input', e => {
    s.fade = +e.target.value;
    $('#fadeVal').textContent = s.fade ? s.fade + ' с' : 'выкл';
    saveSettings(); applyFade();
  });
  $('#setBalance').addEventListener('input', e => {
    s.balance = +e.target.value;
    $('#balVal').textContent = s.balance ? (s.balance < 0 ? 'Л ' + (-s.balance) : 'П ' + s.balance) : 'центр';
    saveSettings(); applyPlayback();
  });
  $('#setPreamp').addEventListener('input', e => {
    s.preamp = +e.target.value;
    $('#preVal').textContent = (s.preamp > 0 ? '+' : '') + s.preamp + ' дБ';
    saveSettings(); applyPlayback();
  });
  $('#setReset').addEventListener('click', () => {
    state.settings = { ...DEFAULT_SETTINGS };
    saveSettings();
    audio.volume = state.settings.volume;
    audio.playbackRate = 1;
    const pv = $('#pbVolume');
    pv.value = Math.round(state.settings.volume * 100);
    setRangeFill(pv, +pv.value, 100);
    applyEq();
    applyPlayback();
    applyFade();
    renderSettings();
    toast('Настройки сброшены', 1600);
  });
  $('#setNorm').addEventListener('change', e => { s.normalize = e.target.checked; saveSettings(); applyPlayback(); });
  $('#setMono').addEventListener('change', e => { s.mono = e.target.checked; saveSettings(); applyPlayback(); });

  $('#eqOn').addEventListener('change', e => {
    s.eqOn = e.target.checked; saveSettings(); applyEq();
    toast(s.eqOn ? 'Эквалайзер включён' : 'Эквалайзер выключен', 1400);
  });
  $('#openDlFolder').addEventListener('click', () => window.kvinta.openDownloadsFolder());

  $('#eqPresets').addEventListener('click', e => {
    const b = e.target.closest('.chip');
    if (!b) return;
    s.eqPreset = b.dataset.p;
    if (s.eqPreset === 'custom' && !s.eqGains) s.eqGains = [...currentGains()];
    saveSettings(); applyEq(); renderSettings();
  });

  $$('#eqBands input').forEach(inp => {
    inp.addEventListener('input', () => {
      const i = +inp.dataset.band, v = +inp.value;
      if (s.eqPreset !== 'custom') { s.eqGains = [...currentGains()]; s.eqPreset = 'custom';
        $$('#eqPresets .chip').forEach(c => c.classList.toggle('active', c.dataset.p === 'custom')); }
      s.eqGains[i] = v;
      $(`#db${i}`).textContent = (v > 0 ? '+' : '') + v;
      saveSettings(); applyEq();
    });
  });
}

function syncNp() {
  const np = $('#npSheet');
  if (!np) return;
  const t = state.current;
  $('#npSrc').textContent = state.queueName ? 'Играет: ' + state.queueName : 'Kvinta';
  if (t) {
    $('#npTitle').textContent = t.title;
    $('#npArtist').textContent = t.artist;
    const dl = dlById().get(t.id);
    const art = t.art480 || t.art150 || (dl && dl.cover ? fileUrl(dl.cover) : null);
    $('#npCover').style.backgroundImage = art ? `url("${art}")` : 'none';
    $('#npLike').classList.toggle('on', favIds().has(t.id));
  }
  $('#npShuffle').classList.toggle('on', state.shuffle);
  $('#npRepeat').classList.toggle('on', state.repeat !== 'off');
  $('#npRepeat').classList.toggle('one', state.repeat === 'one');
  $('#npSleep').classList.toggle('active', sleepActive() !== 0);
}

function setupMobileUi() {
  const tb = document.createElement('nav');
  tb.id = 'tabbar';
  const shortNames = {
    new: 'Новое', search: 'Поиск', foryou: 'Для тебя', favorites: 'Любимое',
    playlists: 'Плейлисты', downloads: 'Офлайн', settings: 'Настройки'
  };
  $$('.nav-item').forEach(b => {
    [...b.childNodes].forEach(n => { if (n.nodeType === 3) n.remove(); });
    const lbl = document.createElement('span');
    lbl.className = 'tab-label';
    lbl.textContent = shortNames[b.dataset.view] || '';
    b.appendChild(lbl);
    tb.appendChild(b);
  });
  $('#app').appendChild(tb);

  const np = document.createElement('div');
  np.id = 'npSheet';
  np.innerHTML = `
    <div class="np-head">
      <button class="icon-btn" id="npClose"><svg viewBox="0 0 24 24"><path d="M12 15.5l-7-7L6.4 7l5.6 5.6L17.6 7 19 8.5z"/></svg></button>
      <div class="np-src" id="npSrc">Kvinta</div>
      <button class="icon-btn" id="npMore">${SVG.dots}</button>
    </div>
    <div class="np-cover-wrap"><div class="np-cover" id="npCover"></div></div>
    <div class="np-meta">
      <div style="min-width:0">
        <div class="np-title" id="npTitle"></div>
        <div class="np-artist" id="npArtist"></div>
      </div>
      <button class="icon-btn like-btn" id="npLike">${SVG.heart}</button>
    </div>
    <div class="np-progress">
      <input type="range" id="npSeek" min="0" max="1000" value="0">
      <div class="np-times"><span id="npCur">0:00</span><span id="npTot">0:00</span></div>
    </div>
    <div class="np-controls">
      <button class="icon-btn" id="npShuffle"><svg viewBox="0 0 24 24"><path d="M17 4l4 3.5L17 11V8.5h-2.6l-8 7H3v-2h2.6l8-7H17zM3 6h3.4l2.3 2-1.5 1.3L5.6 8H3zm12.4 7.7L17 15.5V13l4 3.5L17 20v-2.5h-3.6l-2.3-2z"/></svg></button>
      <button class="icon-btn" id="npPrev"><svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zm12 0v14l-9-7z"/></svg></button>
      <button class="play-btn" id="npPlay">
        <svg id="iconNpPlay" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        <svg id="iconNpPause" viewBox="0 0 24 24" style="display:none"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>
      </button>
      <button class="icon-btn" id="npNext"><svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM6 5l9 7-9 7z"/></svg></button>
      <button class="icon-btn" id="npRepeat"><svg viewBox="0 0 24 24"><path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z"/></svg><span class="np-rep1">1</span></button>
    </div>
    <div class="np-extra">
      <button class="chip" id="npSleep">Таймер сна</button>
      <button class="chip" id="npEq">Звук и эквалайзер</button>
    </div>`;
  document.body.appendChild(np);

  const openNp = () => { np.classList.add('open'); syncNp(); updatePlayIcon(); };
  const closeNp = () => np.classList.remove('open');

  $('.pb-left').addEventListener('click', e => {
    if (e.target.closest('#pbLike')) return;
    if (state.current) openNp();
  });
  $('#npClose').addEventListener('click', closeNp);
  $('#npPlay').addEventListener('click', togglePlay);
  $('#npNext').addEventListener('click', () => nextTrack());
  $('#npPrev').addEventListener('click', prevTrack);
  $('#npLike').addEventListener('click', () => state.current && toggleFav(state.current));
  $('#npShuffle').addEventListener('click', () => { $('#pbShuffle').click(); syncNp(); });
  $('#npRepeat').addEventListener('click', () => { $('#pbRepeat').click(); syncNp(); });
  $('#npEq').addEventListener('click', () => { closeNp(); switchView('settings'); });
  $('#npArtist').addEventListener('click', e => {
    const t = state.current;
    if (!t) return;
    if (t.artists && t.artists.length) { openArtists(e, t.artists); if (t.artists.length === 1) closeNp(); }
    else { closeNp(); openArtistFromTrack(t); }
  });
  $('#npSleep').addEventListener('click', e => {
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    showSleepMenu(r.left, r.top - 240);
  });
  $('#npMore').addEventListener('click', e => {
    if (!state.current) return;
    e.stopPropagation();
    const r = e.currentTarget.getBoundingClientRect();
    showTrackMenu(r.left - 200, r.bottom + 4, state.current, {});
  });
  $('#npSeek').addEventListener('input', e => {
    if (audio.duration) {
      audio.currentTime = (e.target.value / 1000) * audio.duration;
      setRangeFill(e.target, audio.currentTime, audio.duration);
    }
  });

  let ty = null, dy = 0;
  np.addEventListener('touchstart', e => {
    if (e.target.closest('input,button')) { ty = null; return; }
    ty = e.touches[0].clientY; dy = 0;
  }, { passive: true });
  np.addEventListener('touchmove', e => {
    if (ty == null) return;
    dy = e.touches[0].clientY - ty;
    if (dy > 0) { np.style.transition = 'none'; np.style.transform = `translateY(${dy}px)`; }
  }, { passive: true });
  np.addEventListener('touchend', () => {
    np.style.transition = '';
    np.style.transform = '';
    if (dy > 90) closeNp();
    ty = null; dy = 0;
  });
}

function setupTooltips() {
  const tip = document.createElement('div');
  tip.id = 'tooltip';
  document.body.appendChild(tip);
  const hide = () => tip.classList.remove('show');
  document.addEventListener('mouseover', e => {
    const el = e.target.closest('[title], [data-tip]');
    if (!el) return;
    if (el.title) { el.dataset.tip = el.title; el.removeAttribute('title'); }
    if (!el.dataset.tip) return;
    tip.textContent = el.dataset.tip;
    tip.classList.add('show');
    tip.style.left = '0px';
    tip.style.top = '0px';
    const r = el.getBoundingClientRect(), tr = tip.getBoundingClientRect();
    const x = Math.max(8, Math.min(r.left + r.width / 2 - tr.width / 2, innerWidth - tr.width - 8));
    let y = r.top - tr.height - 9;
    if (y < 8) y = r.bottom + 9;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    el.addEventListener('mouseleave', hide, { once: true });
    el.addEventListener('mousedown', hide, { once: true });
  });
  document.addEventListener('scroll', hide, true);
}

$$('.nav-item').forEach(b => b.addEventListener('click', () => switchView(b.dataset.view)));
$('#btnNewPlaylist').addEventListener('click', createPlaylistFlow);
if (window.KV_MOBILE) setupMobileUi();
else setupTooltips();

audio.volume = state.settings.volume ?? 0.8;
audio.playbackRate = state.settings.speed || 1;
$('#pbVolume').value = Math.round(audio.volume * 100);
setRangeFill($('#pbVolume'), audio.volume * 100, 100);

renderSidebarPlaylists();
switchView('new');
