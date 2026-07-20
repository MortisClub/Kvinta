# Разработка

## Запуск

```
npm install
npm start
```

## Где что править

Весь интерфейс — в `renderer/`, правится там. Electron-часть (окно, IPC, прокси `kvs://`,
загрузки) — в `main.js` и `preload.js`.

Мобильная версия — обёртка Capacitor над тем же кодом. После правок в `renderer/` синкайте
общие файлы в `mobile/www`:

```
node mobile/sync.js
```

## Релиз

```
node tools/release.js 1.0.6 "что нового"
```

Скрипт поднимает версию, собирает установщик и APK и публикует релиз. Иконки —
`node tools/make-icons.js`, скриншоты для README — `node tools/shot.js`.

Нашли баг — заводите issue и по возможности приложите шаги и версию.
