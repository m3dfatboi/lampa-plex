(function () {
    'use strict';

    var PLUGIN_ID = 'plex_watchlist';
    var VERSION = '0.1.0';
    var DISCOVER = 'https://discover.provider.plex.tv';
    var METADATA = 'https://metadata.provider.plex.tv';
    var WATCHLIST_PATH = '/library/sections/watchlist/all';
    var CACHE_KEY = 'plex_watchlist_cache';
    var PAGE_SIZE = 20;

    var manifest = {
        type: 'other',
        version: VERSION,
        name: 'Plex Watchlist',
        description: 'Синхронизация просмотренного и Watchlist Plex Discover',
        component: PLUGIN_ID
    };

    var icon = '<svg viewBox="0 0 256 256" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M50 28h54l102 100-102 100H50l102-100L50 28Z" fill="currentColor"/></svg>';
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
        registerPlaybackSync();

        console.log('Plex Watchlist', 'started', VERSION);
    }

    function storageGet(name, def) {
        try {
            if (Lampa.Storage.field && typeof Lampa.Storage.field(name) !== 'undefined') return Lampa.Storage.field(name);
        } catch (e) {}

        return Lampa.Storage.get(name, def);
    }

    function token() {
        return (Lampa.Storage.get('plex_watchlist_token', '') || '').trim();
    }

    function notify(text) {
        Lampa.Noty.show(text);
    }

    function getCache() {
        var cache = Lampa.Storage.get(CACHE_KEY, {});

        cache.items = cache.items || {};
        cache.watchlist = cache.watchlist || {};
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

    function request(method, url, params, success, fail) {
        var xhr = new XMLHttpRequest();
        var full = url + qs(params || {});

        xhr.open(method, full, true);
        xhr.timeout = 20000;
        xhr.setRequestHeader('Accept', 'application/json');

        if (token()) xhr.setRequestHeader('X-Plex-Token', token());

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

        xhr.send();
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

    function resolvePlexItem(card, success, fail) {
        var cache = getCache();
        var key = cardKey(card);

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
        return !!cache.watchlist[ratingKey];
    }

    function setCachedWatchlisted(ratingKey, status) {
        var cache = getCache();

        if (status) cache.watchlist[ratingKey] = Date.now();
        else delete cache.watchlist[ratingKey];

        saveCache(cache);
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
        request('PUT', METADATA + '/actions/scrobble', {
            key: ratingKey,
            identifier: 'com.plexapp.plugins.library'
        }, success || function () {}, fail);
    }

    function toggleCardWatchlist(card) {
        if (!token()) {
            notify('Укажи Plex token в настройках');
            return;
        }

        Lampa.Loading.start();

        resolvePlexItem(card, function (item) {
            userState(item.ratingKey, function (state) {
                var onList = !!(state.watchlistedAt || state.watchlist || isCachedWatchlisted(item.ratingKey));
                var done = function () {
                    Lampa.Loading.stop();
                    notify(onList ? 'Удалено из Plex Watchlist' : 'Добавлено в Plex Watchlist');
                    Lampa.Activity.refresh();
                };
                var bad = function () {
                    Lampa.Loading.stop();
                    notify('Plex Watchlist: ошибка запроса');
                };

                if (onList) removeFromWatchlist(item.ratingKey, done, bad);
                else addToWatchlist(item.ratingKey, done, bad);
            }, function () {
                var onList = isCachedWatchlisted(item.ratingKey);
                var done = function () {
                    Lampa.Loading.stop();
                    notify(onList ? 'Удалено из Plex Watchlist' : 'Добавлено в Plex Watchlist');
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

    function registerContextAction() {
        Lampa.Select.listener.follow('preshow', function (event) {
            var active = event.active;
            if (!active || !active.items || active.plexWatchlistInjected) return;

            var titleAction = Lampa.Lang.translate('title_action');
            if (active.title != titleAction) return;

            var card = focusedCardData();
            if (!card || !cardTitle(card)) return;

            active.plexWatchlistInjected = true;

            var cached = getCache().items[cardKey(card)];
            var onList = cached && cached.ratingKey ? isCachedWatchlisted(cached.ratingKey) : false;

            active.items.push({
                title: 'Plex',
                separator: true
            });

            active.items.push({
                title: onList ? 'Удалить из Plex Watchlist' : 'Добавить в Plex Watchlist',
                subtitle: 'Plex Discover',
                plex_watchlist_action: true,
                onSelect: function () {
                    toggleCardWatchlist(card);
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
                    title: data.title || 'Plex Watchlist',
                    page: data.page || 1
                };
            });
        }
    }

    function registerMenu() {
        Lampa.Menu.addButton(icon, 'Plex Watchlist', function () {
            openWatchlist();
        }).attr('data-action', PLUGIN_ID);
    }

    function openWatchlist() {
        if (Lampa.Router && Lampa.Router.call) {
            Lampa.Router.call(PLUGIN_ID, {
                title: 'Plex Watchlist'
            });
        } else {
            Lampa.Activity.push({
                component: PLUGIN_ID,
                title: 'Plex Watchlist',
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
            var items = collectMetadata(data).map(plexToLampaCard);
            var total = parseInt(box.totalSize || box.size || items.length, 10) || items.length;

            rememberWatchlist(items);

            if (!items.length) {
                if (fail) fail();
                return;
            }

            success({
                results: items,
                page: page,
                total_pages: Math.max(1, Math.ceil(total / PAGE_SIZE))
            });
        }, fail);
    }

    function rememberWatchlist(items) {
        var cache = getCache();

        items.forEach(function (item) {
            if (item.plex_rating_key) cache.watchlist[item.plex_rating_key] = Date.now();
        });

        saveCache(cache);
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

    function registerSettings() {
        Lampa.SettingsApi.addComponent({
            component: PLUGIN_ID,
            icon: icon,
            name: 'Plex Watchlist'
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
                name: 'plex_watchlist_token',
                type: 'input',
                values: '',
                default: ''
            },
            field: {
                name: 'X-Plex-Token',
                description: 'Токен аккаунта Plex для Discover/Watchlist'
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
                name: 'plex_watchlist_open'
            },
            field: {
                name: 'Открыть Watchlist'
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
                name: 'Удалять фильмы из Watchlist',
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
