# Lampa Plex Watchlist

Плагин для Lampa, который связывает локальную историю просмотра Lampa с Plex Discover / Universal Watchlist.

## Что умеет

- Добавляет пункт `Очередь` в боковое меню Lampa.
- Показывает Watchlist из Plex отдельным нативным разделом Lampa, догружая карточки из Lampa/TMDB.
- Добавляет `Добавить в Очередь` / `Удалить из Очереди` первым пунктом в меню действий карточки.
- Заменяет кнопку избранного на full-странице на добавление/удаление из `Очередь`.
- Добавляет кнопку `Оценить на Plex`; после оценки тайтл отмечается просмотренным в Plex.
- Авторизуется в Plex по коду через официальный PIN-flow, без ручного поиска токена.
- Может отмечать фильмы и серии как просмотренные в Plex, когда прогресс Lampa достигает выбранного порога.

## Настройка

1. Подключи `plex-watchlist.js` как обычный плагин Lampa.
2. Открой `Настройки -> Plex Watchlist`.
3. Нажми `Войти через Plex`.
4. Открой `plex.tv/link` на телефоне или компьютере, войди в Plex и введи код из Lampa.
5. После подтверждения плагин сам сохранит `X-Plex-Token`; нажми `Проверить подключение`.

Поле `X-Plex-Token` оставлено как запасной ручной способ. Его можно получить в Plex Web через `View XML` у любого элемента библиотеки и скопировать параметр `X-Plex-Token` из URL.

## Ссылка

Финальный файл плагина для Lampa:

- `https://m3dfatboi.github.io/lampa-plex/plex-watchlist.js`
- Если Lampa держит старый кэш: `https://m3dfatboi.github.io/lampa-plex/plex-watchlist-0.3.5.js`

## Ограничения MVP

- Синхронизируется watched/unwatched state, не точный тайминг остановки.
- Маппинг Lampa -> Plex выполняется через Plex Discover search по названию, типу и году.
- Для открытия карточек из `Очередь` в Lampa нужен TMDB id. Плагин пытается достать его из metadata `Guid`.
- Синхронизация серий зависит от того, как текущий Lampa-балансер формирует `timeline.hash`; в плагине есть несколько эвристик для популярных схем.

## Plex endpoints

Плагин ходит напрямую в:

- `https://discover.provider.plex.tv/library/sections/watchlist/all`
- `https://discover.provider.plex.tv/actions/addToWatchlist`
- `https://discover.provider.plex.tv/actions/removeFromWatchlist`
- `https://discover.provider.plex.tv/actions/scrobble`
- `https://discover.provider.plex.tv/actions/rate`
- `https://metadata.provider.plex.tv/library/metadata/{ratingKey}/userState`
- `https://plex.tv/api/v2/pins`
