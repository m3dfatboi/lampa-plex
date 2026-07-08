# Lampa Plex Watchlist

Плагин для Lampa, который связывает локальную историю просмотра Lampa с Plex Discover / Universal Watchlist.

## Что умеет

- Добавляет пункт `Plex Watchlist` в боковое меню Lampa.
- Показывает Watchlist из Plex отдельным нативным разделом Lampa.
- Добавляет пункт `Добавить в Plex Watchlist` в меню действий карточки.
- Может отмечать фильмы и серии как просмотренные в Plex, когда прогресс Lampa достигает выбранного порога.

## Настройка

1. Подключи `plex-watchlist.js` как обычный плагин Lampa.
2. Открой `Настройки -> Plex Watchlist`.
3. Укажи `X-Plex-Token` своего аккаунта Plex.
4. Нажми `Проверить подключение`.

## Ссылка

Финальный файл плагина для Lampa:

- `https://m3dfatboi.github.io/lampa-plex/plex-watchlist.js`

## Ограничения MVP

- Синхронизируется watched/unwatched state, не точный тайминг остановки.
- Маппинг Lampa -> Plex выполняется через Plex Discover search по названию, типу и году.
- Для открытия карточек из Plex Watchlist в Lampa нужен TMDB id. Плагин пытается достать его из metadata `Guid`.
- Синхронизация серий зависит от того, как текущий Lampa-балансер формирует `timeline.hash`; в плагине есть несколько эвристик для популярных схем.

## Plex endpoints

Плагин ходит напрямую в:

- `https://discover.provider.plex.tv/library/sections/watchlist/all`
- `https://discover.provider.plex.tv/actions/addToWatchlist`
- `https://discover.provider.plex.tv/actions/removeFromWatchlist`
- `https://metadata.provider.plex.tv/actions/scrobble`
- `https://metadata.provider.plex.tv/library/metadata/{ratingKey}/userState`
