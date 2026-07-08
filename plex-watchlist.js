(function () {
    'use strict';

    var PLUGIN_ID = 'plex_watchlist';
    var VERSION = '0.3.2';
    var WATCHLIST_TITLE = 'Очередь';
    var WATCHLIST_FROM_TITLE = 'Очереди';
    var PLEX = 'https://plex.tv';
    var DISCOVER = 'https://discover.provider.plex.tv';
    var DISCOVER_IDENTIFIER = 'tv.plex.provider.discover';
    var METADATA = 'https://metadata.provider.plex.tv';
    var WATCHLIST_PATH = '/library/sections/watchlist/all';
    var CACHE_KEY = 'plex_watchlist_cache';
    var CACHE_SCHEMA = 2;
    var CLIENT_ID_KEY = 'plex_watchlist_client_id';
    var PAGE_SIZE = 20;
    var LAMPA_CARD_CONCURRENCY = 4;
    var AUTH_POLL_INTERVAL = 3000;
    var AUTH_TIMEOUT = 15 * 60 * 1000;

    var manifest = {
        type: 'other',
        version: VERSION,
        name: 'Plex Watchlist',
        description: 'Синхронизация просмотренного и Watchlist Plex Discover',
        component: PLUGIN_ID
    };

    var icon = '<svg viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M50 28h54l102 100-102 100H50l102-100L50 28Z" fill="currentColor"/></svg>';
    var settingsIcon = '<svg width="38" height="38" viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M50 28h54l102 100-102 100H50l102-100L50 28Z" fill="white"/></svg>';
    var watchlistButtonIcon = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M7 4.75c0-.69.56-1.25 1.25-1.25h7.5c.69 0 1.25.56 1.25 1.25v14.5l-5-2.85-5 2.85V4.75Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    var rateButtonIcon = '<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="m12 3.7 2.43 4.93 5.45.79-3.94 3.84.93 5.42L12 16.12l-4.87 2.56.93-5.42-3.94-3.84 5.45-.79L12 3.7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
    var playbackByHash = {};
    var pendingSync = {};
    var currentCard = null;

    function startPlugin() {
        if (window.plex_watchlist_ready) return;
        window.plex_watchlist_ready = true;

        Lampa.Manifest.plugins = manifest;

        registerSettings();
        registerRoute();
        registerMenu();
        registerContextAction();
        registerFullButtons();
        registerPlaybackSync();

        console.log('Plex Watchlist', 'started', VERSION);
    }

    function storageGet(name, def) {
        try {
            if (Lampa.Storage.field && typeof Lampa.Storage.field(name) !== 'undefined') return Lampa.Storage.field(name);
        } catch (e) {}

        return Lampa.Storage.get(name, def);
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    function token() {
        return (Lampa.Storage.get('plex_watchlist_token', '') || '').trim();
    }

    function clientIdentifier() {
        var id = Lampa.Storage.get(CLIENT_ID_KEY, '');

        if (!id) {
            id = 'lampa-plex-' + Date.now().toString(16) + '-' + Math.random().toString(16).slice(2);
            Lampa.Storage.set(CLIENT_ID_KEY, id, true);
        }

        return id;
    }

    function plexHeaders(xhr, options) {
        xhr.setRequestHeader('Accept', 'application/json');
        xhr.setRequestHeader('X-Plex-Product', manifest.name);
        xhr.setRequestHeader('X-Plex-Version', VERSION);
        xhr.setRequestHeader('X-Plex-Client-Identifier', clientIdentifier());
        xhr.setRequestHeader('X-Plex-Platform', 'Lampa');
        xhr.setRequestHeader('X-Plex-Device', 'Lampa');
        xhr.setRequestHeader('X-Plex-Device-Name', 'Lampa');

        if (!options.noToken && token()) xhr.setRequestHeader('X-Plex-Token', token());
        if (options.contentType) xhr.setRequestHeader('Content-Type', options.contentType);
    }

    function getCache() {
        var cache = Lampa.Storage.get(CACHE_KEY, {});

        if (cache.schema !== CACHE_SCHEMA) {
            cache.watchlist = {};
            cache.watchlist_removed = {};
            cache.watchlist_checked = {};
            cache.schema = CACHE_SCHEMA;
        }

        cache.items = cache.items || {};
        cache.watchlist = cache.watchlist || {};
        cache.watchlist_removed = cache.watchlist_removed || {};
        cache.watchlist_checked = cache.watchlist_checked || {};
        cache.episodes = cache.episodes || {};

        return cache;
    }

    function saveCache(cache) {
        Lampa.Storage.set(CACHE_KEY, cache);
    }

    function qs(params) {
        var list = [];

        for (var k in params) {
            if (params.hasOwnProperty(k) && params[k] !== undefined && params[k] !== null && params[k] !== '') {
                list.push(encodeURIComponent(k) + '=' + encodeURIComponent(params[k]));
            }
        }

        return list.length ? '?' + list.join('&') : '';
    }

    function request(method, url, params, success, fail, options) {
        options = options || {};

        var xhr = new XMLHttpRequest();
        var full = url + qs(params || {});

        xhr.open(method, full, true);
        xhr.timeout = 20000;
        plexHeaders(xhr, options);

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4) return;

            var text = xhr.responseText || '';
            var data = text;

            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {}

            if (xhr.status >= 200 && xhr.status < 300) {
                success(data, xhr);
            } else {
                console.log('Plex Watchlist', 'request error', xhr.status, full, data);
                if (fail) fail(data, xhr);
            }
        };

        xhr.onerror = function () {
            if (fail) fail({ message: 'network' }, xhr);
        };

        xhr.ontimeout = function () {
            if (fail) fail({ message: 'timeout' }, xhr);
        };

        xhr.send(options.body ? JSON.stringify(options.body) : null);
    }

    function asArray(value) {
        if (!value) return [];
        return Array.isArray(value) ? value : [value];
    }

    function mediaContainer(data) {
        return data && data.MediaContainer ? data.MediaContainer : {};
    }

    function collectMetadata(data) {
        var box = mediaContainer(data);
        var out = [];

        ['Metadata', 'Video', 'Directory'].forEach(function (name) {
            asArray(box[name]).forEach(function (item) {
                out.push(item);
            });
        });

        asArray(box.Hub).forEach(function (hub) {
            ['Metadata', 'Video', 'Directory'].forEach(function (name) {
                asArray(hub[name]).forEach(function (item) {
                    out.push(item);
                });
            });
        });

        return out;
    }

    function cardType(card) {
        return card && (card.name || card.original_name || card.media_type == 'tv' || card.type == 'show') ? 'show' : 'movie';
    }

    function normalizeTitle(str) {
        return (str || '').toString().toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
    }

    function releaseYear(card) {
        var raw = card.release_date || card.first_air_date || card.originallyAvailableAt || card.year || '';
        var year = (raw + '').match(/\d{4}/);
        return year ? parseInt(year[0], 10) : 0;
    }

    function cardTitle(card) {
        return card.title || card.name || card.original_title || card.original_name || '';
    }

    function cardKey(card) {
        return cardType(card) + ':' + (card.id || card.tmdb_id || card.imdb_id || normalizeTitle(cardTitle(card)) + ':' + releaseYear(card));
    }

    function plexType(card) {
        return cardType(card) == 'show' ? 'tv' : 'movies';
    }

    function searchDiscover(card, success, fail) {
        request('GET', DISCOVER + '/library/search', {
            query: cardTitle(card),
            limit: 12,
            searchTypes: plexType(card),
            searchProviders: 'discover',
            includeMetadata: 1
        }, function (data) {
            var results = [];
            var groups = asArray(mediaContainer(data).SearchResults);

            groups.forEach(function (group) {
                asArray(group.SearchResult).forEach(function (item) {
                    if (item.Metadata) results.push(item.Metadata);
                });
            });

            success(pickBestMatch(card, results));
        }, fail);
    }

    function pickBestMatch(card, results) {
        if (!results.length) return null;

        var wantedType = cardType(card);
        var wantedTitle = normalizeTitle(cardTitle(card));
        var wantedYear = releaseYear(card);
        var best = null;
        var bestScore = -1;

        results.forEach(function (item) {
            if (wantedType == 'movie' && item.type != 'movie') return;
            if (wantedType == 'show' && item.type != 'show') return;

            var score = 0;
            var title = normalizeTitle(item.title);

            if (title == wantedTitle) score += 50;
            else if (title.indexOf(wantedTitle) >= 0 || wantedTitle.indexOf(title) >= 0) score += 15;

            if (wantedYear && item.year) {
                var diff = Math.abs(parseInt(item.year, 10) - wantedYear);
                if (diff === 0) score += 25;
                else if (diff <= 1) score += 8;
            }

            if (item.ratingKey) score += 5;

            if (score > bestScore) {
                bestScore = score;
                best = item;
            }
        });

        return best || results[0];
    }

    function plexItemFromCard(card) {
        if (!card || !card.plex_rating_key) return null;

        return {
            ratingKey: card.plex_rating_key,
            guid: card.plex_guid || '',
            type: cardType(card) == 'show' ? 'show' : 'movie',
            title: cardTitle(card),
            year: releaseYear(card)
        };
    }

    function resolvePlexItem(card, success, fail) {
        var cache = getCache();
        var key = cardKey(card);
        var direct = plexItemFromCard(card);

        if (direct && direct.ratingKey) {
            cache.items[key] = direct;
            saveCache(cache);
            success(direct);
            return;
        }

        if (cache.items[key] && cache.items[key].ratingKey) {
            success(cache.items[key]);
            return;
        }

        searchDiscover(card, function (item) {
            if (!item || !item.ratingKey) {
                if (fail) fail();
                return;
            }

            cache.items[key] = {
                ratingKey: item.ratingKey,
                guid: item.guid,
                type: item.type,
                title: item.title,
                year: item.year
            };

            saveCache(cache);
            success(cache.items[key]);
        }, fail);
    }

    function userState(ratingKey, success, fail) {
        request('GET', METADATA + '/library/metadata/' + encodeURIComponent(ratingKey) + '/userState', {}, function (data) {
            var box = mediaContainer(data);
            var state = box.UserState || {};
            var meta = asArray(box.Metadata)[0] || {};

            if (Array.isArray(state)) state = state[0] || {};
            if (!state.watchlistedAt && meta.UserState) {
                state = Array.isArray(meta.UserState) ? meta.UserState[0] || {} : meta.UserState;
            }

            success(state);
        }, fail);
    }

    function isCachedWatchlisted(ratingKey) {
        var cache = getCache();
        return !!(cache.watchlist[ratingKey] && cache.watchlist_checked[ratingKey] && !cache.watchlist_removed[ratingKey]);
    }

    function isCachedWatchlistRemoved(ratingKey) {
        var cache = getCache();
        return !!cache.watchlist_removed[ratingKey];
    }

    function isCardWatchlisted(card) {
        var direct = plexItemFromCard(card);
        var cached = getCache().items[cardKey(card)];

        if (direct && direct.ratingKey) {
            if (isCachedWatchlistRemoved(direct.ratingKey)) return false;
            return isCachedWatchlisted(direct.ratingKey) || String(card.id || '').indexOf('plex_') === 0;
        }

        return !!(cached && cached.ratingKey && isCachedWatchlisted(cached.ratingKey));
    }

    function setCachedWatchlisted(ratingKey, status) {
        var cache = getCache();

        cache.watchlist_checked[ratingKey] = Date.now();

        if (status) {
            cache.watchlist[ratingKey] = Date.now();
            delete cache.watchlist_removed[ratingKey];
        } else {
            delete cache.watchlist[ratingKey];
            cache.watchlist_removed[ratingKey] = Date.now();
        }

        saveCache(cache);
    }

    function isUserStateWatchlisted(state) {
        return !!(state && (state.watchlistedAt || state.watchlist || state.watchlisted));
    }

    function syncCachedUserState(ratingKey, state) {
        var onList = isUserStateWatchlisted(state);

        setCachedWatchlisted(ratingKey, onList);

        return onList;
    }

    function addToWatchlist(ratingKey, success, fail) {
        request('PUT', DISCOVER + '/actions/addToWatchlist', { ratingKey: ratingKey }, function (data) {
            setCachedWatchlisted(ratingKey, true);
            if (success) success(data);
        }, fail);
    }

    function removeFromWatchlist(ratingKey, success, fail) {
        request('PUT', DISCOVER + '/actions/removeFromWatchlist', { ratingKey: ratingKey }, function (data) {
            setCachedWatchlisted(ratingKey, false);
            if (success) success(data);
        }, fail);
    }

    function markPlayed(ratingKey, success, fail) {
        request('PUT', DISCOVER + '/actions/scrobble', {
            key: ratingKey,
            identifier: DISCOVER_IDENTIFIER
        }, success || function () {}, fail);
    }

    function ratePlexItem(ratingKey, rating, success, fail) {
        request('PUT', DISCOVER + '/actions/rate', {
            key: ratingKey,
            identifier: DISCOVER_IDENTIFIER,
            rating: rating
        }, success || function () {}, fail);
    }

    function toggleCardWatchlist(card, doneCallback, options) {
        if (!token()) {
            notify('Укажи Plex token в настройках');
            return;
        }

        options = options || {};
        Lampa.Loading.start();

        resolvePlexItem(card, function (item) {
            userState(item.ratingKey, function (state) {
                var onList = syncCachedUserState(item.ratingKey, state);
                var done = function () {
                    var newStatus = !onList;

                    Lampa.Loading.stop();
                    notify(onList ? 'Удалено из ' + WATCHLIST_FROM_TITLE : 'Добавлено в ' + WATCHLIST_TITLE);
                    if (doneCallback) doneCallback(newStatus, item);
                    if (options.refresh !== false) Lampa.Activity.refresh();
                };
                var bad = function () {
                    Lampa.Loading.stop();
                    notify('Plex Watchlist: ошибка запроса');
                };

                if (onList) removeFromWatchlist(item.ratingKey, done, bad);
                else addToWatchlist(item.ratingKey, done, bad);
            }, function () {
                var onList = isCachedWatchlisted(item.ratingKey) || isCardWatchlisted(card);
                var done = function () {
                    var newStatus = !onList;

                    Lampa.Loading.stop();
                    notify(onList ? 'Удалено из ' + WATCHLIST_FROM_TITLE : 'Добавлено в ' + WATCHLIST_TITLE);
                    if (doneCallback) doneCallback(newStatus, item);
                    if (options.refresh !== false) Lampa.Activity.refresh();
                };
                var bad = function () {
                    Lampa.Loading.stop();
                    notify('Plex Watchlist: ошибка запроса');
                };

                if (onList) removeFromWatchlist(item.ratingKey, done, bad);
                else addToWatchlist(item.ratingKey, done, bad);
            });
        }, function () {
            Lampa.Loading.stop();
            notify('Не нашел этот тайтл в Plex Discover');
        });
    }

    function setCardWatchlist(card, targetStatus, doneCallback, options) {
        if (!token()) {
            notify('Укажи Plex token в настройках');
            return;
        }

        options = options || {};
        Lampa.Loading.start();

        resolvePlexItem(card, function (item) {
            var finish = function () {
                Lampa.Loading.stop();
                notify(targetStatus ? 'Добавлено в ' + WATCHLIST_TITLE : 'Удалено из ' + WATCHLIST_FROM_TITLE);
                if (doneCallback) doneCallback(targetStatus, item);
                if (options.refresh !== false) Lampa.Activity.refresh();
            };
            var bad = function () {
                Lampa.Loading.stop();
                notify('Plex Watchlist: ошибка запроса');
            };
            var apply = function () {
                if (targetStatus) addToWatchlist(item.ratingKey, finish, bad);
                else removeFromWatchlist(item.ratingKey, finish, bad);
            };

            userState(item.ratingKey, function (state) {
                var currentStatus = syncCachedUserState(item.ratingKey, state);

                if (currentStatus == targetStatus) {
                    finish();
                    return;
                }

                apply();
            }, apply);
        }, function () {
            Lampa.Loading.stop();
            notify('Не нашел этот тайтл в Plex Discover');
        });
    }

    function registerContextAction() {
        Lampa.Select.listener.follow('preshow', function (event) {
            var active = event.active;
            if (!active || !active.items || active.plexWatchlistInjected) return;

            var titleAction = Lampa.Lang.translate('title_action');
            if (active.title != titleAction) return;

            var card = focusedCardData();
            if (!card || !cardTitle(card)) return;

            active.plexWatchlistInjected = true;

            var onList = isCardWatchlisted(card);
            var targetStatus = !onList;

            active.items.unshift({
                title: onList ? 'Удалить из ' + WATCHLIST_FROM_TITLE : 'Добавить в ' + WATCHLIST_TITLE,
                subtitle: 'Plex Discover',
                plex_watchlist_action: true,
                onSelect: function () {
                    setCardWatchlist(card, targetStatus);
                    Lampa.Controller.toggle('content');
                }
            });
        });
    }

    function focusedCardData() {
        var nodes = [
            document.querySelector('.card.focus'),
            document.querySelector('.selector.focus.card'),
            document.querySelector('.selector.focus')
        ];

        for (var i = 0; i < nodes.length; i++) {
            var node = nodes[i];

            while (node) {
                if (node.card_data) return node.card_data;
                if (node.classList && node.classList.contains('card') && node.card_data) return node.card_data;
                node = node.parentNode;
            }
        }

        return currentCard;
    }

    function fullEventCard(event) {
        if (!event) return null;
        if (event.data && event.data.movie) return event.data.movie;
        if (event.object && event.object.movie) return event.object.movie;
        if (event.object && event.object.card) return event.object.card;
        return currentCard;
    }

    function fullEventBody(event) {
        if (event && event.body && event.body.find) return event.body;

        if (event && event.object && event.object.activity && event.object.activity.render) {
            return event.object.activity.render();
        }

        return $();
    }

    function setFullWatchlistButtonState(button, onList) {
        var label = onList ? 'Удалить из ' + WATCHLIST_FROM_TITLE : 'В ' + WATCHLIST_TITLE;
        var text = button.find('span').first();

        if (!text.length) {
            button.append('<span></span>');
            text = button.find('span').first();
        }

        text.text(label);
        button.toggleClass('active', !!onList);
    }

    function refreshFullWatchlistButton(button, card) {
        setFullWatchlistButtonState(button, isCardWatchlisted(card));

        if (!token()) return;

        resolvePlexItem(card, function (item) {
            userState(item.ratingKey, function (state) {
                setFullWatchlistButtonState(button, syncCachedUserState(item.ratingKey, state));
            });
        });
    }

    function bindFullButtonLast(event, button) {
        button.on('hover:focus hover:enter hover:hover hover:touch', function (e) {
            if (event.link && event.link.items && event.link.items[0]) event.link.items[0].last = e.target;
        });
    }

    function replaceFavoriteButton(event, card, body) {
        var button = body.find('.button--book').first();

        if (!button.length || button.hasClass('button--plex-watchlist')) return button;

        button.off('hover:enter').removeClass('button--book').addClass('button--plex-watchlist').attr('data-subtitle', 'Plex');

        if (button.find('svg').length) button.find('svg').first().replaceWith(watchlistButtonIcon);
        else button.prepend(watchlistButtonIcon);

        setFullWatchlistButtonState(button, isCardWatchlisted(card));
        refreshFullWatchlistButton(button, card);

        button.on('hover:enter', function () {
            setCardWatchlist(card, !button.hasClass('active'), function (status) {
                setFullWatchlistButtonState(button, status);
            }, {
                refresh: false
            });
        });

        bindFullButtonLast(event, button);

        return button;
    }

    function addRateButton(event, card, body, anchor) {
        if (body.find('.button--plex-rate').length) return;

        var button = $('<div class="full-start__button selector button--plex-rate" data-subtitle="Plex">' + rateButtonIcon + '<span>Оценить на Plex</span></div>');

        if (anchor && anchor.length) anchor.after(button);
        else {
            var box = body.find('.full-start-new__buttons, .buttons--container').first();
            if (box.length) box.append(button);
            else return;
        }

        button.on('hover:enter', function () {
            showPlexRatingSelect(card);
        });

        bindFullButtonLast(event, button);
    }

    function registerFullButtons() {
        if (!Lampa.Listener || !Lampa.Listener.follow) return;

        Lampa.Listener.follow('full', function (event) {
            if (!event || event.type != 'complite') return;

            var card = fullEventCard(event);
            var body = fullEventBody(event);

            if (!card || !cardTitle(card) || !body.length || body.data('plex-watchlist-full')) return;

            body.data('plex-watchlist-full', true);

            var watchlistButton = replaceFavoriteButton(event, card, body);
            addRateButton(event, card, body, watchlistButton);
        });
    }

    function showPlexRatingSelect(card) {
        if (!Lampa.Select || !Lampa.Select.show) return;

        if (!token()) {
            notify('Укажи Plex token в настройках');
            return;
        }

        var items = [];

        for (var i = 10; i >= 1; i--) {
            items.push({
                title: i + ' / 10',
                rating: i
            });
        }

        Lampa.Select.show({
            title: 'Оценить на Plex',
            items: items,
            onBack: function () {
                Lampa.Controller.toggle('content');
            },
            onSelect: function (item) {
                Lampa.Controller.toggle('content');
                if (item) rateCardOnPlex(card, item.rating);
            }
        });
    }

    function rateCardOnPlex(card, rating) {
        if (!token()) {
            notify('Укажи Plex token в настройках');
            return;
        }

        Lampa.Loading.start();

        resolvePlexItem(card, function (item) {
            ratePlexItem(item.ratingKey, rating, function () {
                markPlayed(item.ratingKey, function () {
                    Lampa.Loading.stop();
                    notify('Оценка Plex сохранена, просмотр отмечен');
                }, function () {
                    Lampa.Loading.stop();
                    notify('Оценка Plex сохранена, но просмотр не отмечен');
                });
            }, function () {
                Lampa.Loading.stop();
                notify('Plex: не удалось сохранить оценку');
            });
        }, function () {
            Lampa.Loading.stop();
            notify('Не нашел этот тайтл в Plex Discover');
        });
    }

    function registerPlaybackSync() {
        Lampa.Player.listener.follow('start', function (data) {
            rememberPlayback(data);
        });

        Lampa.Player.listener.follow('ready', function (data) {
            rememberPlayback(data);
        });

        Lampa.Timeline.listener.follow('update', function (event) {
            if (!storageGet('plex_watchlist_sync_watched', true)) return;
            if (!token() || !event || !event.data || !event.data.road) return;

            var hash = String(event.data.hash);
            var road = event.data.road;
            var threshold = parseInt(storageGet('plex_watchlist_sync_threshold', '90'), 10) || 90;

            if ((road.percent || 0) < threshold) return;
            if (pendingSync[hash]) return;

            var playback = playbackByHash[hash] || inferCurrentPlayback(hash);
            if (!playback || !playback.card) return;

            pendingSync[hash] = true;

            syncWatched(playback, function () {
                delete pendingSync[hash];
            }, function () {
                delete pendingSync[hash];
            });
        });
    }

    function rememberPlayback(data) {
        if (!data || !data.timeline || !data.timeline.hash) return;

        var active = Lampa.Activity.active ? Lampa.Activity.active() : null;
        var card = data.card || (active && (active.movie || active.card));
        var hash = String(data.timeline.hash);

        if (!card || !cardTitle(card)) return;

        currentCard = card;

        playbackByHash[hash] = {
            hash: hash,
            card: card,
            title: data.title || '',
            season: data.season || data.s || null,
            episode: data.episode || data.e || null
        };

        if (cardType(card) == 'show' && (!playbackByHash[hash].season || !playbackByHash[hash].episode)) {
            var parsed = parseSeasonEpisode(data.title || '');

            if (parsed) {
                playbackByHash[hash].season = parsed.season;
                playbackByHash[hash].episode = parsed.episode;
            } else {
                resolveEpisodeByHash(card, hash, function (info) {
                    if (playbackByHash[hash]) {
                        playbackByHash[hash].season = info.season;
                        playbackByHash[hash].episode = info.episode;

                        syncIfAlreadyPastThreshold(hash);
                    }
                });
            }
        }
    }

    function syncIfAlreadyPastThreshold(hash) {
        if (!storageGet('plex_watchlist_sync_watched', true) || !token()) return;

        var view = Lampa.Timeline.view(hash);
        var threshold = parseInt(storageGet('plex_watchlist_sync_threshold', '90'), 10) || 90;

        if (!view || (view.percent || 0) < threshold || pendingSync[hash]) return;

        pendingSync[hash] = true;

        syncWatched(playbackByHash[hash], function () {
            delete pendingSync[hash];
        }, function () {
            delete pendingSync[hash];
        });
    }

    function inferCurrentPlayback(hash) {
        var data = Lampa.Player.playdata ? Lampa.Player.playdata() : null;
        if (data && data.timeline && String(data.timeline.hash) == String(hash)) {
            rememberPlayback(data);
            return playbackByHash[String(hash)];
        }

        return null;
    }

    function parseSeasonEpisode(title) {
        var text = (title || '').toString();
        var found = text.match(/S\s*(\d+)\s*[/xXeE: -]+(?:E\s*)?(\d+)/i) || text.match(/(\d+)\s*сезон.*?(\d+)\s*сер/i);

        if (found) {
            return {
                season: parseInt(found[1], 10),
                episode: parseInt(found[2], 10)
            };
        }

        return null;
    }

    function episodeHashVariants(card, season, episode) {
        var titles = [card.original_title, card.original_name, card.title, card.name];
        var out = [];

        titles.forEach(function (title) {
            if (!title) return;

            out.push(Lampa.Utils.hash([season, episode, title].join('')));
            out.push(Lampa.Utils.hash([season, season > 10 ? ':' : '', episode, title].join('')));
        });

        return out.map(String);
    }

    function resolveEpisodeByHash(card, hash, success) {
        if (!Lampa.TimeTable || !Lampa.TimeTable.get) return;

        Lampa.TimeTable.get(card, function (episodes) {
            asArray(episodes).forEach(function (ep) {
                var season = ep.season_number || ep.season || 1;
                var episode = ep.episode_number || ep.episode || ep.number;
                var variants = episodeHashVariants(card, season, episode);

                if (variants.indexOf(String(hash)) >= 0) {
                    success({
                        season: season,
                        episode: episode
                    });
                }
            });
        });
    }

    function syncWatched(playback, done, fail) {
        var card = playback.card;

        resolvePlexItem(card, function (item) {
            if (cardType(card) == 'show') {
                if (!playback.season || !playback.episode) {
                    if (fail) fail();
                    return;
                }

                resolvePlexEpisode(item.ratingKey, playback.season, playback.episode, function (episodeKey) {
                    markPlayed(episodeKey, function () {
                        console.log('Plex Watchlist', 'marked episode watched', cardTitle(card), playback.season, playback.episode);
                        if (done) done();
                    }, fail);
                }, fail);
            } else {
                markPlayed(item.ratingKey, function () {
                    if (storageGet('plex_watchlist_remove_movie_after_watched', false)) {
                        removeFromWatchlist(item.ratingKey, function () {
                            if (done) done();
                        }, done);
                    } else if (done) done();

                    console.log('Plex Watchlist', 'marked movie watched', cardTitle(card));
                }, fail);
            }
        }, fail);
    }

    function resolvePlexEpisode(showKey, seasonNumber, episodeNumber, success, fail) {
        var cache = getCache();
        var key = showKey + ':' + seasonNumber + ':' + episodeNumber;

        if (cache.episodes[key]) {
            success(cache.episodes[key]);
            return;
        }

        request('GET', METADATA + '/library/metadata/' + encodeURIComponent(showKey) + '/children', {
            includeUserState: 1
        }, function (data) {
            var seasons = collectMetadata(data);
            var season = null;

            seasons.forEach(function (item) {
                if (parseInt(item.index, 10) == parseInt(seasonNumber, 10)) season = item;
            });

            if (!season || !season.ratingKey) {
                if (fail) fail();
                return;
            }

            request('GET', METADATA + '/library/metadata/' + encodeURIComponent(season.ratingKey) + '/children', {
                includeUserState: 1
            }, function (episodeData) {
                var episodes = collectMetadata(episodeData);
                var episode = null;

                episodes.forEach(function (item) {
                    if (parseInt(item.index, 10) == parseInt(episodeNumber, 10)) episode = item;
                });

                if (!episode || !episode.ratingKey) {
                    if (fail) fail();
                    return;
                }

                cache.episodes[key] = episode.ratingKey;
                saveCache(cache);
                success(episode.ratingKey);
            }, fail);
        }, fail);
    }

    function registerRoute() {
        Lampa.Component.add(PLUGIN_ID, PlexWatchlistComponent);

        if (Lampa.Router && Lampa.Router.add) {
            Lampa.Router.add(PLUGIN_ID, function (data) {
                return {
                    title: data.title || WATCHLIST_TITLE,
                    page: data.page || 1
                };
            });
        }
    }

    function registerMenu() {
        Lampa.Menu.addButton(icon, WATCHLIST_TITLE, function () {
            openWatchlist();
        }).attr('data-action', PLUGIN_ID);
    }

    function openWatchlist() {
        if (Lampa.Router && Lampa.Router.call) {
            Lampa.Router.call(PLUGIN_ID, {
                title: WATCHLIST_TITLE
            });
        } else {
            Lampa.Activity.push({
                component: PLUGIN_ID,
                title: WATCHLIST_TITLE,
                page: 1
            });
        }
    }

    function PlexWatchlistComponent(object) {
        var comp = new Lampa.InteractionCategory(object);

        comp.create = function () {
            loadWatchlist(object.page || 1, this.build.bind(this), this.empty.bind(this));
        };

        comp.nextPageReuest = function (params, resolve, reject) {
            loadWatchlist(params.page || 1, resolve.bind(comp), reject.bind(comp));
        };

        comp.cardRender = function (params, data, card) {
            card.onEnter = function () {
                openLampaCard(data);
            };
        };

        return comp;
    }

    function loadWatchlist(page, success, fail) {
        if (!token()) {
            if (fail) fail();
            return;
        }

        request('GET', DISCOVER + WATCHLIST_PATH, {
            includeCollections: 1,
            includeExternalMedia: 1,
            includeUserState: 1,
            sort: 'watchlistedAt:desc',
            'X-Plex-Container-Start': (page - 1) * PAGE_SIZE,
            'X-Plex-Container-Size': PAGE_SIZE
        }, function (data) {
            var box = mediaContainer(data);
            var plexItems = collectMetadata(data);
            var items = plexItems.map(plexToLampaCard);
            var total = parseInt(box.totalSize || box.size || items.length, 10) || items.length;

            rememberWatchlist(items);

            if (!items.length) {
                if (fail) fail();
                return;
            }

            hydrateLampaCards(items, function (cards) {
                success({
                    results: cards,
                    page: page,
                    total_pages: Math.max(1, Math.ceil(total / PAGE_SIZE))
                });
            });
        }, fail);
    }

    function rememberWatchlist(items) {
        var cache = getCache();

        items.forEach(function (item) {
            if (item.plex_rating_key) {
                cache.watchlist[item.plex_rating_key] = Date.now();
                cache.watchlist_checked[item.plex_rating_key] = Date.now();
                delete cache.watchlist_removed[item.plex_rating_key];
            }
        });

        saveCache(cache);
    }

    function attachPlexFields(target, source) {
        target.plex_rating_key = source.plex_rating_key;
        target.plex_guid = source.plex_guid || '';
        target.plex_art = source.plex_art || '';
        target.plex_title = source.plex_title || source.title || source.name || '';
        target.plex_tmdb_id = source.tmdb_id || (typeof source.id == 'number' ? source.id : '');
        target.source = target.source || 'tmdb';

        return target;
    }

    function hydrateLampaCard(card, done) {
        if (!Lampa.Api || typeof Lampa.Api.full !== 'function' || typeof card.id != 'number') {
            done(card);
            return;
        }

        try {
            Lampa.Api.full({
                id: card.id,
                method: cardType(card) == 'show' ? 'tv' : 'movie',
                card: card,
                source: 'tmdb'
            }, function (data) {
                var movie = data && data.movie ? data.movie : null;

                if (!movie || !movie.id) {
                    done(card);
                    return;
                }

                done(attachPlexFields(movie, card));
            }, function () {
                done(card);
            });
        } catch (e) {
            console.log('Plex Watchlist', 'Lampa card hydrate failed', e);
            done(card);
        }
    }

    function hydrateLampaCards(items, done) {
        var out = items.slice();
        var cursor = 0;
        var active = 0;
        var finished = 0;
        var completed = false;

        if (!items.length) {
            done(out);
            return;
        }

        function complete() {
            if (completed) return;

            completed = true;
            done(out);
        }

        function next() {
            if (finished >= items.length && active === 0) {
                complete();
                return;
            }

            while (active < LAMPA_CARD_CONCURRENCY && cursor < items.length) {
                (function (index) {
                    var item = items[index];

                    if (typeof item.id != 'number') {
                        finished++;
                        next();
                        return;
                    }

                    active++;

                    hydrateLampaCard(item, function (card) {
                        out[index] = card || item;
                        active--;
                        finished++;
                        next();
                    });
                })(cursor++);
            }
        }

        next();
    }

    function plexToLampaCard(item) {
        var isShow = item.type == 'show';
        var year = item.year || ((item.originallyAvailableAt || '').match(/\d{4}/) || [''])[0];
        var card = {
            id: 'plex_' + item.ratingKey,
            title: item.title,
            original_title: item.title,
            release_date: item.originallyAvailableAt || (year ? year + '-01-01' : ''),
            poster: item.thumb,
            img: item.thumb,
            background_image: item.art || '',
            plex_art: item.art,
            plex_guid: item.guid,
            plex_rating_key: item.ratingKey,
            plex_title: item.title,
            source: 'tmdb',
            year: year
        };

        if (isShow) {
            card.name = item.title;
            card.original_name = item.title;
            card.first_air_date = item.originallyAvailableAt || card.release_date;
        }

        attachTmdbIdFromGuids(card, item);

        return card;
    }

    function attachTmdbIdFromGuids(card, item) {
        var guids = [];

        asArray(item.Guid).forEach(function (guid) {
            if (guid && guid.id) guids.push(guid.id);
        });

        if (item.guid) guids.push(item.guid);

        guids.forEach(function (guid) {
            var tmdb = (guid + '').match(/tmdb:\/\/(\d+)/);
            var imdb = (guid + '').match(/imdb:\/\/(tt\d+)/);

            if (tmdb) {
                card.id = parseInt(tmdb[1], 10);
                card.tmdb_id = card.id;
            }

            if (imdb) card.imdb_id = imdb[1];
        });
    }

    function openLampaCard(card) {
        if (typeof card.id == 'number') {
            Lampa.Router.call('full', card);
            return;
        }

        if (!card.plex_rating_key || !token()) {
            notify('Не найден TMDB id для открытия карточки');
            return;
        }

        Lampa.Loading.start();

        request('GET', METADATA + '/library/metadata/' + encodeURIComponent(card.plex_rating_key), {
            includeUserState: 1
        }, function (data) {
            var meta = collectMetadata(data)[0] || {};

            attachTmdbIdFromGuids(card, meta);
            Lampa.Loading.stop();

            if (typeof card.id == 'number') Lampa.Router.call('full', card);
            else notify('Не найден TMDB id для открытия карточки');
        }, function () {
            Lampa.Loading.stop();
            notify('Не удалось открыть карточку Plex');
        });
    }

    function escapeHtml(text) {
        return (text || '').toString().replace(/[&<>"']/g, function (char) {
            return {
                '&': '&amp;',
                '<': '&lt;',
                '>': '&gt;',
                '"': '&quot;',
                "'": '&#039;'
            }[char];
        });
    }

    function plexAuthUrl(code) {
        return 'https://app.plex.tv/auth#' + qs({
            clientID: clientIdentifier(),
            code: code,
            'context[device][product]': manifest.name,
            'context[device][version]': VERSION,
            forwardUrl: window.location.href
        });
    }

    function openExternal(url) {
        if (Lampa.Android && Lampa.Android.openBrowser) {
            Lampa.Android.openBrowser(url);
            return;
        }

        try {
            window.open(url, '_blank');
        } catch (e) {
            var link = document.createElement('a');
            link.href = url;
            link.target = '_blank';
            document.body.appendChild(link);
            link.click();
            link.remove();
        }
    }

    function beginPlexLogin() {
        Lampa.Loading.start();

        request('POST', PLEX + '/api/v2/pins', {}, function (pin) {
            Lampa.Loading.stop();

            if (!pin || !pin.id || !pin.code) {
                notify('Plex не вернул код входа');
                return;
            }

            showPlexLogin(pin);
        }, function () {
            Lampa.Loading.stop();
            notify('Не удалось создать код Plex');
        }, {
            noToken: true,
            contentType: 'application/json'
        });
    }

    function showPlexLogin(pin) {
        var authUrl = plexAuthUrl(pin.code);
        var linkUrl = 'https://plex.tv/link';
        var timer = 0;
        var started = Date.now();
        var closed = false;
        var html = $('<div class="account-modal-split plex-watchlist-login">' +
            '<div class="account-modal-split__qr">' +
                '<div class="account-modal-split__qr-code"></div>' +
                '<div class="account-modal-split__qr-text">Сканируйте QR или откройте plex.tv/link</div>' +
            '</div>' +
            '<div class="account-modal-split__info">' +
                '<div class="account-modal-split__title">Вход в Plex</div>' +
                '<div class="account-modal-split__text">' +
                    '<div style="font-size:3em;font-weight:700;letter-spacing:.18em;margin:.45em 0">' + escapeHtml(pin.code) + '</div>' +
                    '<p>Откройте <b>plex.tv/link</b> на телефоне или компьютере, войдите в Plex и введите код.</p>' +
                    '<p>После подтверждения Lampa сама сохранит токен аккаунта. Пароль Plex плагин не видит и не хранит.</p>' +
                    '<p class="plex-watchlist-login__state">Жду подтверждение Plex...</p>' +
                    '<p style="word-break:break-all">' + escapeHtml(linkUrl) + '</p>' +
                '</div>' +
            '</div>' +
        '</div>');

        function closeModal() {
            if (closed) return;

            closed = true;
            clearInterval(timer);

            if (Lampa.Modal && Lampa.Modal.close) Lampa.Modal.close();
        }

        function checkPin() {
            if (closed) return;

            if (Date.now() - started > AUTH_TIMEOUT) {
                html.find('.plex-watchlist-login__state').text('Код устарел. Создайте новый код входа.');
                clearInterval(timer);
                return;
            }

            request('GET', PLEX + '/api/v2/pins/' + encodeURIComponent(pin.id), {
                code: pin.code
            }, function (data) {
                if (!data || !data.authToken) return;

                Lampa.Storage.set('plex_watchlist_token', data.authToken);
                Lampa.Storage.set('plex_watchlist_auth_at', Date.now(), true);

                html.find('.plex-watchlist-login__state').text('Plex подключен');
                notify('Plex подключен');
                closeModal();
                testConnection();
            }, function () {
                html.find('.plex-watchlist-login__state').text('Не удалось проверить код. Пробую ещё раз...');
            }, {
                noToken: true
            });
        }

        if (Lampa.Utils && Lampa.Utils.qrcode) {
            Lampa.Utils.qrcode(authUrl, html.find('.account-modal-split__qr-code'), function () {
                html.find('.account-modal-split__qr-code').text(pin.code);
            });
        } else {
            html.find('.account-modal-split__qr-code').text(pin.code);
        }

        if (Lampa.Modal && Lampa.Modal.open) {
            Lampa.Modal.open({
                title: '',
                html: html,
                size: 'full',
                scroll: {
                    nopadding: true
                },
                buttons: [
                    {
                        name: 'Открыть Plex',
                        onSelect: function () {
                            openExternal(authUrl);
                        }
                    },
                    {
                        name: 'Закрыть',
                        onSelect: closeModal
                    }
                ],
                buttons_position: 'outside',
                onBack: closeModal
            });
        } else {
            notify('Plex код: ' + pin.code + '. Откройте plex.tv/link');
            openExternal(authUrl);
        }

        timer = setInterval(checkPin, AUTH_POLL_INTERVAL);
        checkPin();
    }

    function logoutPlex() {
        Lampa.Storage.set('plex_watchlist_token', '');
        Lampa.Storage.set(CACHE_KEY, {});
        notify('Plex token удалён');
    }

    function registerSettings() {
        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            icon: settingsIcon,
            name: 'Plex Watchlist',
            before: 'parser'
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                type: 'title'
            },
            field: {
                name: 'Аккаунт Plex'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                type: 'button',
                name: 'plex_watchlist_login'
            },
            field: {
                name: 'Войти через Plex',
                description: 'Откроет вход по коду без ручного поиска токена'
            },
            onChange: function () {
                beginPlexLogin();
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                name: 'plex_watchlist_token',
                type: 'input',
                values: '',
                default: ''
            },
            field: {
                name: 'X-Plex-Token',
                description: 'Заполняется автоматически после входа через Plex; можно вставить вручную'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                type: 'button',
                name: 'plex_watchlist_test'
            },
            field: {
                name: 'Проверить подключение'
            },
            onChange: function () {
                testConnection();
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                type: 'button',
                name: 'plex_watchlist_logout'
            },
            field: {
                name: 'Выйти из Plex',
                description: 'Удалить сохранённый token и кэш Plex'
            },
            onChange: function () {
                logoutPlex();
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                type: 'button',
                name: 'plex_watchlist_open'
            },
            field: {
                name: 'Открыть ' + WATCHLIST_TITLE
            },
            onChange: function () {
                Lampa.Controller.toContent();
                openWatchlist();
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                type: 'title'
            },
            field: {
                name: 'Синхронизация'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                name: 'plex_watchlist_sync_watched',
                type: 'trigger',
                default: true
            },
            field: {
                name: 'Отмечать просмотренное в Plex',
                description: 'Когда прогресс Lampa достигнет выбранного порога'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                name: 'plex_watchlist_sync_threshold',
                type: 'select',
                values: {
                    '80': '80%',
                    '90': '90%',
                    '95': '95%'
                },
                default: '90'
            },
            field: {
                name: 'Порог просмотра'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                name: 'plex_watchlist_remove_movie_after_watched',
                type: 'trigger',
                default: false
            },
            field: {
                name: 'Удалять фильмы из ' + WATCHLIST_FROM_TITLE,
                description: 'Только для фильмов после отметки просмотренным'
            }
        });

        Lampa.SettingsApi.addParam({
            component: PLUGIN_ID,
            param: {
                type: 'button',
                name: 'plex_watchlist_clear_cache'
            },
            field: {
                name: 'Очистить кэш Plex'
            },
            onChange: function () {
                Lampa.Storage.set(CACHE_KEY, {});
                notify('Кэш Plex Watchlist очищен');
            }
        });
    }

    function testConnection() {
        if (!token()) {
            notify('Укажи Plex token');
            return;
        }

        Lampa.Loading.start();

        request('GET', DISCOVER + WATCHLIST_PATH, {
            includeCollections: 1,
            includeExternalMedia: 1,
            'X-Plex-Container-Start': 0,
            'X-Plex-Container-Size': 1
        }, function () {
            Lampa.Loading.stop();
            notify('Plex подключен');
        }, function () {
            Lampa.Loading.stop();
            notify('Plex token не сработал');
        });
    }

    if (window.appready) {
        startPlugin();
    } else {
        Lampa.Listener.follow('app', function (e) {
            if (e.type == 'ready') startPlugin();
        });
    }
})();
