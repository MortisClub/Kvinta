<p align="center">
  <img src="assets/icon.png" width="128" alt="Kvinta">
</p>

<h1 align="center">Kvinta</h1>

<p align="center">
  Локальный музыкальный сервис в фирменном красном стиле.<br>
  Весь каталог Яндекс Музыки — слушай онлайн, сохраняй офлайн, собирай свои плейлисты.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Windows-Electron-ff1e42?style=flat-square&logo=electron&logoColor=white" alt="Electron">
  <img src="https://img.shields.io/badge/Android-Capacitor-ff6a3d?style=flat-square&logo=android&logoColor=white" alt="Capacitor">
  <img src="https://img.shields.io/badge/%C2%A9%20MortisClub-2026-2b161e?style=flat-square" alt="MortisClub">
</p>

---

## Скриншоты

<p align="center">
  <img src="docs/screens/desktop-home.png" width="820" alt="Главная — чарт и новые релизы">
</p>
<p align="center">
  <img src="docs/screens/desktop-settings.png" width="820" alt="Настройки — эквалайзер и тонкая настройка звука">
</p>
<p align="center">
  <img src="docs/screens/mobile-home.png" width="270" alt="Мобильная версия — главная">
  &nbsp;&nbsp;
  <img src="docs/screens/mobile-player.png" width="270" alt="Мобильная версия — экран «Сейчас играет»">
</p>

## Возможности

- 🔥 **Каталог** — чарт, новые релизы, поиск, персональные подборки «Для тебя», история «Ты недавно слушал»
- ❤ **Своя библиотека** — избранное и плейлисты, всё хранится только на твоём устройстве
- ⬇ **Офлайн** — загрузка треков (на ПК — в папку `Музыка\Kvinta`)
- 🎚 **Звук** — 10-полосный эквалайзер с пресетами, скорость, баланс, моно, нормализация громкости, preamp, плавные переходы между треками
- 🌙 **Таймер сна** — 15/30/60/90 минут или «до конца трека»
- 🎧 **Управление отовсюду** — медиаклавиши клавиатуры, шторка и экран блокировки Android (Media Session)

## Запуск на ПК

Дважды кликни **`Kvinta.bat`** — при первом запуске сам поставит зависимости.

## Мобильная версия

Capacitor-обёртка над тем же кодом (папка `mobile/`):

```bash
node mobile/sync.js        # синхронизировать общий код в mobile/www
```

Дальше открыть `mobile/android` в **Android Studio** и собрать APK.

Особенности мобильной версии:

- Нижняя таб-навигация, компактный мини-плеер, полноэкранный «Сейчас играет» (тап по мини-плееру, свайп вниз — закрыть)
- Полные настройки звука: трек с обработкой загружается нативно (мимо CORS) и играет из blob — эквалайзер работает как на ПК
- Громкость и таймер сна в настройках, управление из шторки и с экрана блокировки

## Структура проекта

| Путь | Что это |
|---|---|
| `main.js`, `preload.js` | Electron: окно, IPC, прокси `kvs://` для Web Audio, загрузки |
| `renderer/` | Общий интерфейс (UI, плеер, эквалайзер) — правится здесь |
| `mobile/www/` | Копия renderer + `native.js` (Capacitor-мост) и `mobile.css` |
| `mobile/sync.js` | Синхронизация renderer → www перед сборкой APK |
| `tools/make-icons.js` | Генератор всех иконок (Android mipmap, `.ico`, Play Store) |
| `tools/shot.js` | Автоскриншоты для README (`npx electron tools/shot.js`) |

---

<p align="center">© MortisClub 2026</p>
