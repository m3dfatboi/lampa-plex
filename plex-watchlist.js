(function () {
    'use strict';

    var PLUGIN_ID = 'plex_watchlist';
    var VERSION = '0.5.18';
    var WATCHLIST_TITLE = 'Очередь';
    var WATCHLIST_FROM_TITLE = 'Очереди';
    var PLEX = 'https://plex.tv';
    var DISCOVER = 'https://discover.provider.plex.tv';
    var DISCOVER_IDENTIFIER = 'tv.plex.provider.discover';
    var METADATA = 'https://metadata.provider.plex.tv';
    var COMMUNITY = 'https://community.plex.tv';
    var WATCHLIST_PATH = '/library/sections/watchlist/all';
    var CACHE_KEY = 'plex_watchlist_cache';
    var LEGACY_ROW_CACHE_KEY = 'plex_watchlist_rows_cache';
    var ROW_CACHE_KEY = 'plex_watchlist_rows_cache_v2';
    var LAMPA_FULL_CARD_CACHE_KEY = 'plex_watchlist_lampa_full_cards';
    var LAMPA_FULL_CARD_CACHE_SCHEMA = 1;
    var CACHE_SCHEMA = 8;
    var CLIENT_ID_KEY = 'plex_watchlist_client_id';
    var PAGE_SIZE = 20;
    var PLEX_ROW_SIZE = 24;
    var HISTORY_ROW_SIZE = 24;
    var HISTORY_GRAPH_PAGE_SIZE = 60;
    var HISTORY_MAX_BATCHES = 6;
    var WATCHLIST_ROW_SIZE = 20;
    var WATCHLIST_FETCH_SIZE = 60;
    var WATCHLIST_MAX_BATCHES = 10;
    var WATCHED_SNAPSHOT_SIZE = 100;
    var WATCHED_SNAPSHOT_TTL = 30 * 60 * 1000;
    var WATCHED_SNAPSHOT_ERROR_RETRY = 2 * 60 * 1000;
    var WATCHED_SNAPSHOT_DELAY = 30 * 1000;
    var PLEX_STATE_TTL = 5 * 60 * 1000;
    var PLEX_ROW_CACHE_TTL = 5 * 60 * 1000;
    var PLEX_ROW_CACHE_MAX_AGE = 7 * 24 * 60 * 60 * 1000;
    var PLEX_EMPTY_ROW_CACHE_TTL = 60 * 1000;
    var PLEX_ROW_REFRESH_DELAY = 8 * 1000;
    var PLEX_MARKER_SCAN_INTERVAL = 10 * 1000;
    var PLEX_DEFERRED_ROW_DELAY = 180;
    var PLEX_DEFERRED_ROW_STAGGER = 240;
    var CATEGORY_FILTER_SOURCE_PAGE_SIZE = 10;
    var LAMPA_CARD_CACHE_LIMIT = 400;
    var LAMPA_MATCH_REFRESH_INTERVAL = 24 * 60 * 60 * 1000;
    var LAMPA_CARD_HYDRATION_TIMEOUT = 20 * 1000;
    var LAMPA_FULL_CARD_CACHE_TTL = 30 * 24 * 60 * 60 * 1000;
    var LAMPA_FULL_CARD_CACHE_SAVE_DELAY = 300;
    var LAMPA_FULL_CARD_CONCURRENCY = 4;
    var LAMPA_FULL_CARD_REQUEST_TIMEOUT = 18 * 1000;
    var LOCAL_WATCHLIST_TOMBSTONE_TTL = 10 * 60 * 1000;
    var LAMPA_CARD_CONCURRENCY = 4;
    var AUTH_POLL_INTERVAL = 3000;
    var AUTH_TIMEOUT = 15 * 60 * 1000;
    var PROFILE_PARENT_FIELDS = 'fragment parentFields on MetadataItem { index title publishedAt key type publicPagesURL leafCount year originallyAvailableAt childCount images { coverArt coverPoster thumbnail art } userState @skip(if: $skipUserState) { viewCount viewedLeafCount watchlistedAt } }';
    var PROFILE_ITEM_FIELDS = 'fragment itemFields on MetadataItem { id images { coverArt coverPoster thumbnail art } userState @skip(if: $skipUserState) { viewCount viewedLeafCount watchlistedAt } title key type index publicPagesURL parent { ...parentFields } grandparent { ...parentFields } publishedAt leafCount year originallyAvailableAt childCount }';
    var PROFILE_WATCH_HISTORY_QUERY = 'query GetWatchHistoryHub($uuid: ID = "", $first: PaginationInt!, $after: String, $skipUserState: Boolean = false) { user(id: $uuid) { watchHistory(first: $first, after: $after) { nodes { metadataItem { ...itemFields } date id } pageInfo { hasNextPage hasPreviousPage endCursor } } } } ' + PROFILE_ITEM_FIELDS + ' ' + PROFILE_PARENT_FIELDS;

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
    var plexRowsRegistered = false;
    var plexMarkerScanTimer = null;
    var plexMarkerInterval = null;
    var watchedSnapshotTimer = null;
    var watchedSnapshotGeneration = 0;
    var plexRowLoading = {};
    var plexRowRefreshTimers = {};
    var plexRowGenerations = {};
    var plexDeferredPages = [];
    var lampaFullCardCacheMemory = null;
    var lampaFullCardCacheSaveTimer = null;
    var lampaFullCardQueue = [];
    var lampaFullCardRequests = {};
    var lampaFullCardActive = 0;
    var lampaFullCardGeneration = 0;
    var HISTORY_ROUTE = PLUGIN_ID + '_history';

    function startPlugin() {
        if (window.plex_watchlist_ready) return;
        window.plex_watchlist_ready = true;

        Lampa.Manifest.plugins = manifest;

        registerSettings();
        registerStyles();
        registerRoute();
        registerMenu();
        registerContextAction();
        registerFullButtons();
        registerPlaybackSync();
        registerPlexRows();
        registerPlexMarkers();

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
        var scope = tokenFingerprint();

        if (cache.schema !== CACHE_SCHEMA || cache.scope !== scope) {
            delete cache.rows;
            cache.items = {};
            cache.watchlist = {};
            cache.watchlist_removed = {};
            cache.watchlist_checked = {};
            cache.lampa = {};
            cache.episodes = {};
            cache.watched = {};
            cache.watched_checked = {};
            cache.ratings = {};
            cache.ratings_checked = {};
            cache.state_checked = {};
            cache.state_loading = {};
            cache.watched_loaded = 0;
            cache.watched_loading = false;
            cache.account = {};
            cache.schema = CACHE_SCHEMA;
            cache.scope = scope;
        }

        cache.items = cache.items || {};
        cache.watchlist = cache.watchlist || {};
        cache.watchlist_removed = cache.watchlist_removed || {};
        cache.watchlist_checked = cache.watchlist_checked || {};
        cache.lampa = cache.lampa || {};
        cache.episodes = cache.episodes || {};
        cache.watched = cache.watched || {};
        cache.watched_checked = cache.watched_checked || {};
        cache.ratings = cache.ratings || {};
        cache.ratings_checked = cache.ratings_checked || {};
        cache.state_checked = cache.state_checked || {};
        cache.state_loading = cache.state_loading || {};
        cache.watched_loaded = cache.watched_loaded || 0;
        cache.watched_loading = cache.watched_loading || false;
        if (cache.watched_loading && Date.now() - cache.watched_loading > 2 * 60 * 1000) cache.watched_loading = false;
        Object.keys(cache.state_loading).forEach(function (key) {
            if (Date.now() - cache.state_loading[key] > 2 * 60 * 1000) delete cache.state_loading[key];
        });
        cache.account = cache.account || {};

        return cache;
    }

    function saveCache(cache) {
        try {
            Lampa.Storage.set(CACHE_KEY, cache);
        } catch (e) {
            console.log('Plex Watchlist', 'cache save failed', e);
        }
    }

    function getPlexRowCache() {
        return Lampa.Storage.get(ROW_CACHE_KEY, {}) || {};
    }

    function savePlexRowCache(rows) {
        try {
            Lampa.Storage.set(ROW_CACHE_KEY, rows);
        } catch (e) {
            console.log('Plex Watchlist', 'row cache save failed', e);
        }
    }

    function lampaFullCardCacheScope() {
        var language = storageGet('tmdb_lang', storageGet('language', 'ru')) || 'ru';

        return tokenFingerprint() + ':' + language;
    }

    function getLampaFullCardCache() {
        var scope = lampaFullCardCacheScope();
        var stored;

        if (lampaFullCardCacheMemory &&
            lampaFullCardCacheMemory.schema === LAMPA_FULL_CARD_CACHE_SCHEMA &&
            lampaFullCardCacheMemory.scope === scope) {
            return lampaFullCardCacheMemory;
        }

        stored = Lampa.Storage.get(LAMPA_FULL_CARD_CACHE_KEY, {}) || {};

        if (stored.schema !== LAMPA_FULL_CARD_CACHE_SCHEMA || stored.scope !== scope) {
            stored = {
                schema: LAMPA_FULL_CARD_CACHE_SCHEMA,
                scope: scope,
                items: {}
            };
        }

        stored.items = stored.items || {};
        lampaFullCardCacheMemory = stored;

        return stored;
    }

    function flushLampaFullCardCache() {
        if (lampaFullCardCacheSaveTimer) {
            clearTimeout(lampaFullCardCacheSaveTimer);
            lampaFullCardCacheSaveTimer = null;
        }

        if (!lampaFullCardCacheMemory) return;

        try {
            Lampa.Storage.set(LAMPA_FULL_CARD_CACHE_KEY, lampaFullCardCacheMemory);
        } catch (e) {
            console.log('Plex Watchlist', 'Lampa card cache save failed', e);
        }
    }

    function scheduleLampaFullCardCacheSave() {
        if (lampaFullCardCacheSaveTimer) clearTimeout(lampaFullCardCacheSaveTimer);

        lampaFullCardCacheSaveTimer = setTimeout(flushLampaFullCardCache, LAMPA_FULL_CARD_CACHE_SAVE_DELAY);
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

    function mergeParams(base, extra) {
        var out = {};
        var k;

        base = base || {};
        extra = extra || {};

        for (k in base) {
            if (base.hasOwnProperty(k)) out[k] = base[k];
        }

        for (k in extra) {
            if (extra.hasOwnProperty(k)) out[k] = extra[k];
        }

        return out;
    }

    function request(method, url, params, success, fail, options) {
        options = options || {};

        var xhr = new XMLHttpRequest();
        var query = qs(params || {});
        var full = url + (query ? (url.indexOf('?') >= 0 ? '&' + query.slice(1) : query) : '');
        var requestScope = options.noToken ? '' : tokenFingerprint();
        var settled = false;

        function reject(data) {
            if (settled) return;

            settled = true;
            if (fail) fail(data, xhr);
        }

        xhr.open(method, full, true);
        xhr.timeout = 20000;
        plexHeaders(xhr, options);

        xhr.onreadystatechange = function () {
            if (xhr.readyState !== 4 || settled) return;

            var text = xhr.responseText || '';
            var data = text;

            try {
                data = text ? JSON.parse(text) : {};
            } catch (e) {}

            if (xhr.status >= 200 && xhr.status < 300) {
                if (!options.noToken && requestScope != tokenFingerprint()) {
                    reject({ message: 'account_changed' });
                    return;
                }

                settled = true;
                success(data, xhr);
            } else {
                console.log('Plex Watchlist', 'request error', xhr.status, full, data);
                reject(data);
            }
        };

        xhr.onerror = function () {
            reject({ message: 'network' });
        };

        xhr.ontimeout = function () {
            reject({ message: 'timeout' });
        };

        xhr.send(options.body ? JSON.stringify(options.body) : null);
    }

    function graphQL(document, variables, success, fail) {
        request('POST', COMMUNITY + '/api', {}, function (data) {
            if (data && data.errors && data.errors.length) {
                console.log('Plex Watchlist', 'graphql error', data.errors);
                if (fail) fail(data);
                return;
            }

            success(data && data.data ? data.data : data);
        }, fail, {
            contentType: 'application/json',
            body: {
                query: document,
                variables: variables || {}
            }
        });
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

    function collectHubItems(hub) {
        var out = [];

        if (!hub) return out;

        ['Metadata', 'Video', 'Directory'].forEach(function (name) {
            asArray(hub[name]).forEach(function (item) {
                out.push(item);
            });
        });

        return out;
    }

    function normalizePlexType(type) {
        var value = (type || '').toString().toLowerCase();

        if (value == 'movie') return 'movie';
        if (value == 'episode') return 'episode';
        if (value == 'season') return 'season';
        if (value == 'show' || value == 'series' || value == 'tv') return 'show';

        return value;
    }

    function metadataRatingKey(item) {
        if (!item) return '';

        var key = item.ratingKey || item.id || '';
        var path = item.key || item.sourceURI || item.publicPagesURL || '';
        var found = (path + '').match(/metadata\/([^/?#]+)/);

        return found ? found[1] : key;
    }

    function graphImage(images, preferred) {
        images = images || {};

        return images[preferred || 'coverPoster'] || images.coverPoster || images.coverArt || images.thumbnail || images.art || '';
    }

    function stateWatched(state, item) {
        if (!state) return false;

        var viewed = parseInt(state.viewCount || 0, 10) > 0;
        var viewedLeafCount = parseInt(state.viewedLeafCount || 0, 10) || 0;
        var leafCount = parseInt(item && item.leafCount || 0, 10) || 0;

        return viewed || (leafCount > 0 && viewedLeafCount >= leafCount);
    }

    function metadataWatched(item) {
        if (!item) return false;

        var state = item.UserState || item.userState || {};
        if (Array.isArray(state)) state = state[0] || {};

        return !!(item.viewCount || item.lastViewedAt || item.viewedAt || item.viewed || stateWatched(state, item));
    }

    function metadataWatchlisted(item) {
        if (!item) return false;

        var state = item.UserState || item.userState || {};
        if (Array.isArray(state)) state = state[0] || {};

        return isUserStateWatchlisted(state) || !!item.watchlistedAt;
    }

    function metadataUserRating(item) {
        if (!item) return 0;

        var state = item.UserState || item.userState || {};
        if (Array.isArray(state)) state = state[0] || {};

        if (item.userRating !== undefined && item.userRating !== null && item.userRating !== '') return parsePlexRating(item.userRating);

        return userStateRating(state);
    }

    function episodeLabel(season, episode) {
        if (!season && !episode) return '';
        if (season && episode) return 'S' + season + ' E' + episode;
        if (episode) return 'E' + episode;
        return 'S' + season;
    }

    function attachEpisodeFields(card, item) {
        var season = item.plex_episode_season || item.parentIndex || item.season || item.seasonNumber || (item.parent && item.parent.index) || '';
        var episode = item.plex_episode_number || item.index || item.episode || item.episodeNumber || '';
        var airDate = item.plex_episode_air_date || episodeAirDate(item);

        if (season) card.plex_episode_season = parseInt(season, 10) || season;
        if (episode) card.plex_episode_number = parseInt(episode, 10) || episode;
        if (card.plex_episode_season || card.plex_episode_number) card.plex_episode_label = episodeLabel(card.plex_episode_season, card.plex_episode_number);

        if (airDate) {
            card.plex_episode_air_date = airDate;
            card.plex_episode_air_date_label = formatEpisodeAirDate(airDate);
        }

        if (item.ratingKey || item.id || item.key) card.plex_episode_rating_key = metadataRatingKey(item);
    }

    function graphMetadataToPlexItem(meta, entry) {
        if (!meta) return null;

        var type = normalizePlexType(meta.type);
        var isEpisode = type == 'episode';
        var isSeason = type == 'season';
        var seasonShow = isSeason ? meta.parent || meta.grandparent || null : null;
        var show = isEpisode && meta.grandparent ? meta.grandparent : (isSeason ? seasonShow || meta : meta);
        var parent = isEpisode ? meta.parent || {} : {};
        var images = show.images || meta.images || {};
        var episodeImages = meta.images || {};
        var episodeThumb = isEpisode ? episodeImages.thumbnail || episodeImages.art || '' : '';
        var item = {
            ratingKey: isEpisode ? metadataRatingKey(meta) : (isSeason ? metadataRatingKey(show) || metadataRatingKey(meta) : metadataRatingKey(show)),
            guid: show.guid || meta.guid || '',
            type: isEpisode ? 'episode' : (type == 'season' ? 'show' : type),
            sourceType: type,
            title: isEpisode ? show.title || meta.title : (isSeason ? seasonShow && seasonShow.title || '' : meta.title),
            year: show.year || meta.year || '',
            originallyAvailableAt: show.originallyAvailableAt || show.publishedAt || meta.originallyAvailableAt || meta.publishedAt || '',
            thumb: episodeThumb || graphImage(images, 'coverPoster') || graphImage(meta.images, 'coverPoster'),
            episodeThumb: episodeThumb,
            art: graphImage(images, 'art') || graphImage(meta.images, 'art'),
            key: isEpisode ? meta.key || show.key : show.key || meta.key || '',
            UserState: isEpisode ? meta.userState || show.userState || {} : show.userState || meta.userState || {}
        };

        if (isSeason && seasonShow) {
            item.seasonTitle = meta.title || '';
            item.seasonIndex = meta.index || '';
            item.parentTitle = show.title || '';
            item.parentRatingKey = metadataRatingKey(show);
            item.parentGuid = show.guid || '';
            item.parentYear = show.year || '';
            item.parentOriginallyAvailableAt = show.originallyAvailableAt || show.publishedAt || '';
            item.parentKey = show.key || '';
            item.parentThumb = graphImage(show.images, 'coverPoster');
            item.parentArt = graphImage(show.images, 'art');
        }

        if (isEpisode) {
            item.grandparentTitle = show.title || meta.grandparentTitle || '';
            item.grandparentRatingKey = metadataRatingKey(show);
            item.grandparentThumb = graphImage(show.images, 'coverPoster');
            item.grandparentArt = graphImage(show.images, 'art');
            item.grandparentYear = show.year || '';
            item.grandparentOriginallyAvailableAt = show.originallyAvailableAt || show.publishedAt || '';
            item.grandparentKey = show.key || '';
            item.parentTitle = parent.title || '';
            item.parentIndex = parent.index || meta.parentIndex || '';
            item.index = meta.index || '';
        }

        if (entry && entry.date) item.viewedAt = entry.date;
        if (entry && entry.id) item.historyId = entry.id;

        return item;
    }

    function cardType(card) {
        return card && (card.name || card.original_name || card.media_type == 'tv' || card.type == 'show') ? 'show' : 'movie';
    }

    function hasLampaGenre(card, genreId) {
        var wanted = parseInt(genreId, 10) || 0;
        var found = false;

        asArray(card && card.genre_ids).forEach(function (id) {
            if (parseInt(id, 10) == wanted) found = true;
        });

        asArray(card && card.genres).forEach(function (genre) {
            var id = genre && typeof genre == 'object' ? genre.id : genre;

            if (parseInt(id, 10) == wanted) found = true;
        });

        return found;
    }

    function isLampaAnimeCard(card) {
        var language = (card && card.original_language || '').toString().toLowerCase();

        // Lampa's Anime catalog is Japanese TV animation, not every animated show.
        return cardType(card) == 'show' && language == 'ja' && hasLampaGenre(card, 16);
    }

    function matchesLampaCategory(card, kind) {
        if (kind == 'anime') return isLampaAnimeCard(card);
        if (kind == 'tv' || kind == 'show') return cardType(card) == 'show' && !isLampaAnimeCard(card);

        return true;
    }

    function filterLampaCategoryCards(cards, kind) {
        return asArray(cards).filter(function (card) {
            return matchesLampaCategory(card, kind);
        });
    }

    function categoryFilterPagingState(state, namespace, kind, createSourceState) {
        var key = namespace + ':' + kind;

        state = state || {};
        state.category_filter = state.category_filter || {};

        if (!state.category_filter[key]) {
            state.category_filter[key] = {
                source: createSourceState(),
                source_page: 1,
                done: false,
                queue: []
            };
        }

        state.category_filter[key].queue = state.category_filter[key].queue || [];

        return state.category_filter[key];
    }

    function loadFilteredLampaCategoryPage(namespace, kind, page, state, limit, createSourceState, sourceLoader, success, fail) {
        var paging = categoryFilterPagingState(state, namespace, kind, createSourceState);
        var sourceLimit;
        var collected = [];

        page = parseInt(page || 1, 10) || 1;
        limit = parseInt(limit || PAGE_SIZE, 10) || PAGE_SIZE;
        sourceLimit = Math.min(limit, CATEGORY_FILTER_SOURCE_PAGE_SIZE);

        function drainQueue() {
            while (paging.queue.length && collected.length < limit) {
                collected.push(paging.queue.shift());
            }
        }

        function deliver() {
            var hasMore = !!paging.queue.length || !paging.done;

            success({
                results: collected,
                page: page,
                total_pages: hasMore ? page + 1 : page,
                has_more: hasMore
            });
        }

        function next() {
            var sourcePage;

            drainQueue();

            if (collected.length >= limit || paging.done) {
                deliver();
                return;
            }

            sourcePage = paging.source_page++;

            sourceLoader(sourcePage, paging.source, sourceLimit, function (data) {
                var cards = filterLampaCategoryCards(data && data.results, kind);

                paging.done = !(data && data.has_more);
                cards.forEach(function (card) {
                    paging.queue.push(card);
                });
                drainQueue();

                if (collected.length >= limit || paging.done) deliver();
                else next();
            }, function () {
                paging.source_page = Math.max(1, paging.source_page - 1);

                if (collected.length) deliver();
                else if (fail) fail();
            });
        }

        next();
    }

    function normalizeTitle(str) {
        return (str || '').toString().toLowerCase().replace(/ё/g, 'е').replace(/[^a-zа-я0-9]+/g, ' ').trim();
    }

    function normalizedTitleList(list) {
        var out = [];
        var seen = {};

        list.forEach(function (title) {
            var normalized = normalizeTitle(title);

            if (normalized && !seen[normalized]) {
                seen[normalized] = true;
                out.push(normalized);
            }
        });

        return out;
    }

    function releaseYear(card) {
        var raw = card.release_date || card.first_air_date || card.originallyAvailableAt || card.year || '';
        var year = (raw + '').match(/\d{4}/);
        return year ? parseInt(year[0], 10) : 0;
    }

    function yearFromText(value) {
        var year = (value || '').toString().match(/(?:^|[^0-9])((?:19|20)\d{2})(?:[^0-9]|$)/);

        return year ? year[1] : '';
    }

    function metadataYear(item) {
        item = item || {};

        return item.year || yearFromText(item.originallyAvailableAt) || yearFromText(item.publishedAt) || yearFromText(item.publicPagesURL) || yearFromText(item.slug) || yearFromText(item.key) || yearFromText(item.sourceURI) || '';
    }

    function episodeSeriesYear(item) {
        item = item || {};

        return item.grandparentYear || item.parentYear || yearFromText(item.grandparentOriginallyAvailableAt) || yearFromText(item.parentOriginallyAvailableAt) || '';
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

    function ratingKeyForCard(card) {
        var direct = plexItemFromCard(card);
        var cached = getCache().items[cardKey(card)];

        if (direct && direct.ratingKey) return direct.ratingKey;
        if (cached && cached.ratingKey) return cached.ratingKey;

        return '';
    }

    function cachedPlexItemForCard(card) {
        var direct = plexItemFromCard(card);
        var cached = getCache().items[cardKey(card)];

        return direct || cached || null;
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

    function mergeUserState(primary, meta) {
        var state = {};
        var nested;
        var key;

        primary = Array.isArray(primary) ? primary[0] || {} : primary || {};
        meta = meta || {};
        nested = Array.isArray(meta.UserState) ? meta.UserState[0] || {} : meta.UserState || {};

        for (key in nested) {
            if (nested.hasOwnProperty(key)) state[key] = nested[key];
        }

        for (key in primary) {
            if (primary.hasOwnProperty(key)) state[key] = primary[key];
        }

        if (meta.userRating !== undefined && meta.userRating !== null && meta.userRating !== '') state.userRating = meta.userRating;
        if (meta.viewCount !== undefined && state.viewCount === undefined) state.viewCount = meta.viewCount;
        if (meta.lastViewedAt !== undefined && state.lastViewedAt === undefined) state.lastViewedAt = meta.lastViewedAt;

        return state;
    }

    function userState(ratingKey, success, fail) {
        request('GET', METADATA + '/library/metadata/' + encodeURIComponent(ratingKey) + '/userState', {}, function (data) {
            var box = mediaContainer(data);
            var meta = asArray(box.Metadata)[0] || {};

            success(mergeUserState(box.UserState, meta), meta);
        }, fail);
    }

    function metadataState(ratingKey, success, fail) {
        request('GET', METADATA + '/library/metadata/' + encodeURIComponent(ratingKey), {
            includeUserState: 1
        }, function (data) {
            var meta = collectMetadata(data)[0] || {};

            success(mergeUserState(meta.UserState, meta), meta);
        }, fail);
    }

    function hasRatingField(state) {
        return !!(state && (
            state.userRating !== undefined && state.userRating !== null && state.userRating !== '' ||
            state.rating !== undefined && state.rating !== null && state.rating !== ''
        ));
    }

    function loadPlexRatingState(ratingKey, success, fail) {
        userState(ratingKey, function (state, meta) {
            if (hasRatingField(state)) {
                success(state, meta);
                return;
            }

            metadataState(ratingKey, success, function () {
                success(state, meta);
            });
        }, function () {
            metadataState(ratingKey, success, fail);
        });
    }

    function isCachedWatchlisted(ratingKey) {
        var cache = getCache();
        return !!(cache.watchlist[ratingKey] && cache.watchlist_checked[ratingKey] && !cache.watchlist_removed[ratingKey]);
    }

    function isCachedWatchlistRemoved(ratingKey) {
        var cache = getCache();
        return !!cache.watchlist_removed[ratingKey];
    }

    function hasRecentWatchlistRemoval(cache, ratingKey) {
        var removedAt = cache.watchlist_removed[ratingKey] || 0;

        return !!(removedAt && Date.now() - removedAt < LOCAL_WATCHLIST_TOMBSTONE_TTL);
    }

    function isCardWatchlisted(card) {
        var direct = plexItemFromCard(card);
        var cached = getCache().items[cardKey(card)];

        if (direct && direct.ratingKey) {
            if (isCachedWatchlistRemoved(direct.ratingKey)) return false;
            if (card.plex_watchlisted) return true;
            return isCachedWatchlisted(direct.ratingKey);
        }

        return !!(cached && cached.ratingKey && isCachedWatchlisted(cached.ratingKey));
    }

    function parsePlexRating(value) {
        var rating = parseFloat(value);

        if (!isFinite(rating) || rating <= 0) return 0;

        return Math.round(rating * 10) / 10;
    }

    function userStateRating(state) {
        if (!state) return 0;
        if (state.userRating !== undefined && state.userRating !== null && state.userRating !== '') return parsePlexRating(state.userRating);
        if (state.rating !== undefined && state.rating !== null && state.rating !== '') return parsePlexRating(state.rating);
        return 0;
    }

    function cachedRatingForCard(card) {
        var cache = getCache();
        var key = ratingKeyForCard(card);
        var value;

        if (card && card.plex_rating) return parsePlexRating(card.plex_rating);
        if (!key) return 0;

        value = cache.ratings[key];

        return value ? parsePlexRating(value) : 0;
    }

    function formatPlexRating(rating) {
        rating = parsePlexRating(rating);

        return rating % 1 === 0 ? parseInt(rating, 10) + '/10' : rating + '/10';
    }

    function plexRatingActionTitle(card) {
        var rating = cachedRatingForCard(card);

        return rating ? 'Изменить оценку (' + formatPlexRating(rating) + ')' : 'Оценить на Plex';
    }

    function setCachedWatchlisted(ratingKey, status, options) {
        var cache = getCache();

        options = options || {};
        cache.watchlist_checked[ratingKey] = Date.now();

        if (status) {
            cache.watchlist[ratingKey] = Date.now();
            delete cache.watchlist_removed[ratingKey];
        } else {
            delete cache.watchlist[ratingKey];
            cache.watchlist_removed[ratingKey] = Date.now();
        }

        saveCache(cache);
        if (options.scan !== false) schedulePlexMarkerScan();
    }

    function setCachedWatched(ratingKey, status, options) {
        if (!ratingKey) return;

        var cache = getCache();

        options = options || {};
        cache.watched_checked[ratingKey] = Date.now();

        if (status) cache.watched[ratingKey] = Date.now();
        else delete cache.watched[ratingKey];

        saveCache(cache);
        if (options.scan !== false) schedulePlexMarkerScan();
    }

    function setCachedRating(ratingKey, rating, options) {
        if (!ratingKey) return;

        var cache = getCache();
        var value = parsePlexRating(rating);

        options = options || {};
        cache.ratings_checked[ratingKey] = Date.now();

        if (value) cache.ratings[ratingKey] = value;
        else delete cache.ratings[ratingKey];

        saveCache(cache);
        if (options.scan !== false) schedulePlexMarkerScan();
    }

    function isUserStateWatchlisted(state) {
        return !!(state && (state.watchlistedAt || state.watchlist || state.watchlisted));
    }

    function syncCachedUserState(ratingKey, state) {
        var onList = isUserStateWatchlisted(state);

        setCachedWatchlisted(ratingKey, onList);

        return onList;
    }

    function syncCachedPlexState(ratingKey, state, item, options) {
        var watched = stateWatched(state, item);
        var rating = hasRatingField(state) ? userStateRating(state) : 0;

        setCachedWatched(ratingKey, watched, options);
        if (hasRatingField(state)) setCachedRating(ratingKey, rating, options);

        return {
            watched: watched,
            rating: rating
        };
    }

    function watchedSnapshotFresh(cache) {
        return !!(cache && cache.watched_loaded && Date.now() - cache.watched_loaded < WATCHED_SNAPSHOT_TTL);
    }

    function rememberWatchedItems(items) {
        var cache = getCache();
        var cards = [];
        var unresolved = [];

        cache.watched = {};
        cache.watched_checked = {};

        asArray(items).forEach(function (item) {
            var card = plexToLampaCard(item);
            var direct;

            if (!card || !cardTitle(card)) return;

            card.plex_watched = true;
            applyPlexCardDecorations(card);
            cards.push(card);

            direct = plexItemFromCard(card);
            if (direct && direct.ratingKey) {
                cache.watched[direct.ratingKey] = Date.now();
                cache.watched_checked[direct.ratingKey] = Date.now();
            }
        });

        cache.watched_loaded = Date.now();
        cache.watched_loading = false;
        saveCache(cache);

        if (!cards.length) {
            schedulePlexMarkerScan();
            return;
        }

        rememberPlexCards(cards);

        unresolved = cards.filter(function (card) {
            return typeof card.id != 'number' && !cachedLampaMatch(card);
        });

        if (!unresolved.length) return;

        hydrateLampaCards(unresolved, function (hydrated) {
            hydrated.forEach(function (card) {
                card.plex_watched = true;
                applyPlexCardDecorations(card);
            });

            rememberPlexCards(hydrated);
        }, {
            full: false
        });
    }

    function loadWatchedSnapshot(done) {
        var cache;
        var generation = watchedSnapshotGeneration;
        var scope = tokenFingerprint();

        done = done || function () {};

        if (!token()) {
            done();
            return;
        }

        cache = getCache();

        if (watchedSnapshotFresh(cache) || cache.watched_loading) {
            done();
            return;
        }

        cache.watched_loading = Date.now();
        saveCache(cache);

        loadProfileWatchHistory(function (items) {
            if (generation != watchedSnapshotGeneration || scope != tokenFingerprint()) {
                done();
                return;
            }

            rememberWatchedItems(items);
            done();
        }, function () {
            if (generation != watchedSnapshotGeneration || scope != tokenFingerprint()) {
                done();
                return;
            }

            cache = getCache();
            cache.watched_loading = false;
            cache.watched_loaded = Date.now() - WATCHED_SNAPSHOT_TTL + WATCHED_SNAPSHOT_ERROR_RETRY;
            saveCache(cache);
            done();
        }, {
            first: WATCHED_SNAPSHOT_SIZE
        });
    }

    function addToWatchlist(ratingKey, success, fail) {
        request('PUT', DISCOVER + '/actions/addToWatchlist', { ratingKey: ratingKey }, function (data) {
            setCachedWatchlisted(ratingKey, true);
            invalidatePlexRowCache(['watchlist', 'recent_episodes']);
            if (success) success(data);
        }, fail);
    }

    function removeFromWatchlist(ratingKey, success, fail) {
        request('PUT', DISCOVER + '/actions/removeFromWatchlist', { ratingKey: ratingKey }, function (data) {
            setCachedWatchlisted(ratingKey, false);
            invalidatePlexRowCache(['watchlist', 'recent_episodes']);
            if (success) success(data);
        }, fail);
    }

    function registerStyles() {
        var styleId = PLUGIN_ID + '_styles';
        var css = [
            '.card__icons-inner .icon--wath,.card__icons-inner .icon--history{',
            'display:none!important;',
            '}',
            '.card__plex-episode{',
            'left:.3em;',
            'right:auto;',
            'z-index:2;',
            'white-space:nowrap;',
            '}',
            '.card__age[data-plex-episode-date]{',
            'white-space:normal;',
            'overflow:visible;',
            'text-overflow:clip;',
            '}',
            '.plex-row-deferred{',
            'opacity:0;',
            'transform:translateY(.35em);',
            'transition:opacity .2s ease,transform .2s ease;',
            '}',
            '.plex-row-deferred--visible{',
            'opacity:1;',
            'transform:translateY(0);',
            '}',
            '.plex-row-deferred--instant{',
            'transition:none!important;',
            '}',
            '@media (prefers-reduced-motion:reduce){',
            '.plex-row-deferred{transition:none!important;}',
            '}'
        ].join('');

        if (document.getElementById(styleId)) return;

        var style = document.createElement('style');

        style.id = styleId;
        style.type = 'text/css';
        style.appendChild(document.createTextNode(css));

        (document.head || document.documentElement).appendChild(style);
    }

    function markPlayed(ratingKey, success, fail) {
        request('PUT', DISCOVER + '/actions/scrobble', {
            key: ratingKey,
            identifier: DISCOVER_IDENTIFIER
        }, function (data) {
            setCachedWatched(ratingKey, true);
            invalidatePlexRowCache(['history', 'recent_episodes']);
            if (success) success(data);
        }, fail);
    }

    function ratePlexItem(ratingKey, rating, success, fail) {
        request('PUT', DISCOVER + '/actions/rate', {
            key: ratingKey,
            identifier: DISCOVER_IDENTIFIER,
            rating: rating
        }, success || function () {}, fail);
    }

    function disableNativeRows() {
        try {
            Lampa.Storage.set('content_rows_continue_watch', 'false', true);
            Lampa.Storage.set('content_rows_timetable_lately', 'false', true);
            Lampa.Storage.set('content_rows_timetable_recently', 'false', true);
        } catch (e) {
            console.log('Plex Watchlist', 'native rows disable failed', e);
        }
    }

    function tokenFingerprint() {
        var value = token();
        var hash = 5381;
        var i;

        for (i = 0; i < value.length; i++) hash = ((hash << 5) + hash) ^ value.charCodeAt(i);

        return (hash >>> 0).toString(36);
    }

    function scopedPlexRowKey(name) {
        return lampaFullCardCacheScope() + ':' + name;
    }

    function clonePlainValue(value) {
        if (value === null || value === undefined) return value;
        if (typeof value != 'object') return value;

        try {
            return JSON.parse(JSON.stringify(value));
        } catch (e) {
            return undefined;
        }
    }

    function compactPlexCard(card) {
        var fields = [
            'id', 'tmdb_id', 'imdb_id', 'title', 'original_title', 'name', 'original_name',
            'release_date', 'first_air_date', 'poster_path', 'backdrop_path', 'poster', 'img',
            'background_image', 'vote_average', 'vote_count', 'popularity', 'adult', 'genre_ids', 'genres',
            'original_language', 'origin_country', 'media_type', 'type', 'source', 'year'
        ];
        var out = {};

        card = card || {};

        fields.forEach(function (name) {
            var value = card[name];

            if (value === undefined || typeof value == 'function') return;

            value = clonePlainValue(value);
            if (value !== undefined) out[name] = value;
        });

        Object.keys(card).forEach(function (name) {
            var value;

            if (name.indexOf('plex_') !== 0 || typeof card[name] == 'function') return;

            value = clonePlainValue(card[name]);
            if (value !== undefined) out[name] = value;
        });

        return out;
    }

    function compactLampaCard(card) {
        var fields = [
            'id', 'tmdb_id', 'imdb_id', 'title', 'original_title', 'name', 'original_name',
            'release_date', 'first_air_date', 'poster_path', 'backdrop_path', 'poster', 'img',
            'background_image', 'overview', 'vote_average', 'vote_count', 'popularity', 'adult',
            'genre_ids', 'genres', 'original_language', 'origin_country', 'media_type', 'type',
            'source', 'year'
        ];
        var out = {};

        card = card || {};

        fields.forEach(function (name) {
            var value = card[name];

            if (value === undefined || typeof value == 'function') return;

            value = clonePlainValue(value);
            if (value !== undefined) out[name] = value;
        });

        return out;
    }

    function restorePlexRowCards(cards) {
        var cache = getCache();

        return asArray(cards).map(function (card) {
            var restored = compactPlexCard(card);
            var key = restored.plex_rating_key;

            if (key && cache.watchlist_removed[key]) restored.plex_watchlisted = false;
            else if (key && cache.watchlist[key]) restored.plex_watchlisted = true;

            if (key && cache.watched_checked[key]) restored.plex_watched = !!cache.watched[key];
            if (key && cache.ratings_checked[key]) restored.plex_rating = cache.ratings[key] || 0;

            delete restored.params;
            applyPlexCardDecorations(restored);

            return restored;
        }).filter(function (card) {
            return !!cardTitle(card);
        });
    }

    function prunePlexRowCache(rows) {
        var now = Date.now();
        var keys = Object.keys(rows);

        keys.forEach(function (key) {
            var row = rows[key];

            if (!row || !row.time || now - row.time > PLEX_ROW_CACHE_MAX_AGE) delete rows[key];
        });

        keys = Object.keys(rows);

        if (keys.length > 16) {
            keys.sort(function (a, b) {
                return (rows[b].time || 0) - (rows[a].time || 0);
            });

            keys.slice(16).forEach(function (key) {
                delete rows[key];
            });
        }
    }

    function savePlexRowSnapshot(name, cards, data) {
        var compact = asArray(cards).map(compactPlexCard).filter(function (card) {
            return !!cardTitle(card);
        });
        var rows = getPlexRowCache();
        var key = scopedPlexRowKey(name);

        rows[key] = {
            time: Date.now(),
            cards: compact,
            empty: !compact.length,
            data: {
                page: data && data.page || 1,
                total_pages: data && data.total_pages || 1,
                has_more: !!(data && data.has_more)
            }
        };
        prunePlexRowCache(rows);
        savePlexRowCache(rows);
    }

    function savePlexRowFailureSnapshot(name) {
        var rows = getPlexRowCache();
        var key = scopedPlexRowKey(name);
        var current = rows[key];

        if (current && Array.isArray(current.cards) && current.cards.length) return;

        rows[key] = {
            time: Date.now(),
            cards: [],
            empty: true,
            failed: true,
            data: {
                page: 1,
                total_pages: 1,
                has_more: false
            }
        };
        prunePlexRowCache(rows);
        savePlexRowCache(rows);
    }

    function plexRowSnapshot(name) {
        var rows = getPlexRowCache();
        var key = scopedPlexRowKey(name);
        var row = rows[key];
        var age;
        var maxAge;

        if (!row || !Array.isArray(row.cards) || !row.time) return null;

        age = Date.now() - row.time;
        maxAge = PLEX_ROW_CACHE_MAX_AGE;

        if (age > maxAge) {
            delete rows[key];
            savePlexRowCache(rows);
            return null;
        }

        return {
            age: age,
            empty: !!row.empty,
            cards: restorePlexRowCards(row.cards),
            data: row.data || {
                page: 1,
                total_pages: 1
            }
        };
    }

    function finishPlexRowLoad(scoped, pending, ok, cards, data) {
        var callbacks;

        if (!pending || plexRowLoading[scoped] !== pending) return;

        delete plexRowLoading[scoped];
        callbacks = ok ? pending.success : pending.fail;

        callbacks.forEach(function (callback) {
            try {
                if (ok) callback(cards, data);
                else callback();
            } catch (e) {
                console.log('Plex Watchlist', 'row callback failed', e);
            }
        });
    }

    function fetchPlexRow(name, loader, success, fail) {
        var scoped = scopedPlexRowKey(name);
        var settled = false;
        var pending;

        if (plexRowLoading[scoped]) {
            if (success) plexRowLoading[scoped].success.push(success);
            if (fail) plexRowLoading[scoped].fail.push(fail);
            return;
        }

        pending = {
            success: success ? [success] : [],
            fail: fail ? [fail] : [],
            generation: plexRowGenerations[scoped] || 0
        };
        plexRowLoading[scoped] = pending;

        function complete(cards, data) {
            if (settled) return;

            settled = true;

            if (scoped != scopedPlexRowKey(name) || pending.generation != (plexRowGenerations[scoped] || 0)) {
                finishPlexRowLoad(scoped, pending, false);
                return;
            }

            savePlexRowSnapshot(name, cards, data);
            finishPlexRowLoad(scoped, pending, true, cards, data);
        }

        function reject() {
            if (settled) return;

            settled = true;
            if (plexRowLoading[scoped] === pending && scoped == scopedPlexRowKey(name) &&
                pending.generation == (plexRowGenerations[scoped] || 0)) {
                savePlexRowFailureSnapshot(name);
            }
            finishPlexRowLoad(scoped, pending, false);
        }

        try {
            loader(complete, reject);
        } catch (e) {
            console.log('Plex Watchlist', 'row load failed', e);
            reject();
        }
    }

    function schedulePlexRowRefresh(name, loader) {
        var scoped = scopedPlexRowKey(name);

        if (plexRowRefreshTimers[scoped] || plexRowLoading[scoped]) return;

        plexRowRefreshTimers[scoped] = setTimeout(function () {
            delete plexRowRefreshTimers[scoped];

            if (scoped != scopedPlexRowKey(name)) return;

            fetchPlexRow(name, loader);
        }, PLEX_ROW_REFRESH_DELAY);
    }

    function findDeferredPlexPage(params) {
        var found = null;

        plexDeferredPages.forEach(function (page) {
            if (!found && page.params === params) found = page;
        });

        return found;
    }

    function getDeferredPlexPage(params) {
        var page = findDeferredPlexPage(params);

        if (page) return page;

        page = {
            params: params,
            component: null,
            bound: false,
            built: false,
            empty: false,
            destroyed: false,
            rows: [],
            flush_timer: null,
            original_start: null
        };
        plexDeferredPages.push(page);

        return page;
    }

    function destroyDeferredPlexPage(page) {
        var index;

        if (!page || page.destroyed) return;

        page.destroyed = true;
        clearTimeout(page.flush_timer);

        page.rows.forEach(function (row) {
            clearTimeout(row.timer);
        });

        index = plexDeferredPages.indexOf(page);
        if (index >= 0) plexDeferredPages.splice(index, 1);
    }

    function markDeferredPlexPageBuilt(page) {
        if (!page || page.destroyed) return;

        page.built = true;
        clearTimeout(page.flush_timer);
        page.flush_timer = setTimeout(function () {
            page.flush_timer = null;
            flushDeferredPlexPage(page);
        }, PLEX_DEFERRED_ROW_DELAY);
    }

    function bindDeferredPlexPage(page) {
        var activity;
        var component;
        var oldLinesBuild;
        var oldDestroy;

        if (!page || page.bound || page.destroyed) return;

        activity = page.params && page.params.activity;
        component = activity && activity.component;
        if (!component) return;

        page.component = component;
        page.bound = true;
        page.original_start = component.start;

        if (typeof component.use == 'function') {
            component.use({
                onBuild: function () {
                    markDeferredPlexPageBuilt(page);
                },
                onEmpty: function () {
                    page.empty = true;
                    markDeferredPlexPageBuilt(page);
                },
                onDestroy: function () {
                    destroyDeferredPlexPage(page);
                }
            });

            if (component.items && component.items.length) markDeferredPlexPageBuilt(page);
            return;
        }

        if (typeof component.build == 'function') {
            oldLinesBuild = component.onLinesBuild;
            component.onLinesBuild = function () {
                if (typeof oldLinesBuild == 'function') oldLinesBuild.apply(this, arguments);
                markDeferredPlexPageBuilt(page);
            };
        }

        if (typeof component.destroy == 'function') {
            oldDestroy = component.destroy;
            component.destroy = function () {
                destroyDeferredPlexPage(page);
                return oldDestroy.apply(this, arguments);
            };
        }
    }

    function deferredPlexRowAnimation(element) {
        var enabled = storageGet('animation', true);

        if (!element || !element.classList) return;

        element.classList.add('plex-row-deferred');

        if (enabled === false || enabled === 'false') {
            element.classList.add('plex-row-deferred--instant');
            element.classList.add('plex-row-deferred--visible');
            return;
        }

        if (window.requestAnimationFrame) {
            window.requestAnimationFrame(function () {
                window.requestAnimationFrame(function () {
                    element.classList.add('plex-row-deferred--visible');
                });
            });
        } else {
            setTimeout(function () {
                element.classList.add('plex-row-deferred--visible');
            }, 30);
        }
    }

    function decorateDeferredPlexRow(row) {
        var existing;
        var oldCreate;
        var emit = {};
        var key;

        if (!row) return row;

        row.params = row.params || {};
        existing = row.params.emit || {};
        if (existing.plexDeferredDecorated) return row;

        oldCreate = existing.onCreate;

        for (key in existing) {
            if (existing.hasOwnProperty(key)) emit[key] = existing[key];
        }

        emit.onCreate = function () {
            if (typeof oldCreate == 'function') oldCreate.apply(this, arguments);
            deferredPlexRowAnimation(domElement(this.html));
        };
        emit.plexDeferredDecorated = true;
        row.params.emit = emit;

        return row;
    }

    function orderDeferredPlexRows(component) {
        var current;
        var regular = [];
        var deferred = [];
        var activeItem;
        var ordered;
        var changed = false;

        if (!component || !Array.isArray(component.items) || !component.scroll) return;

        current = component.items.slice();
        activeItem = current[component.active];

        current.forEach(function (item) {
            if (item && item.data && typeof item.data.plex_deferred_order == 'number') deferred.push(item);
            else regular.push(item);
        });

        if (deferred.length < 2) return;

        deferred.sort(function (a, b) {
            return a.data.plex_deferred_order - b.data.plex_deferred_order ||
                a.data.plex_deferred_sequence - b.data.plex_deferred_sequence;
        });
        // Keep cold rows at the bottom so late content never shifts the page under the user.
        ordered = regular.concat(deferred);

        ordered.forEach(function (item, index) {
            if (item !== current[index]) changed = true;
        });

        if (!changed) return;

        component.items = ordered;
        if (activeItem) component.active = Math.max(0, ordered.indexOf(activeItem));

        deferred.forEach(function (item) {
            if (item && typeof item.render == 'function') component.scroll.append(item.render(true));
        });
    }

    function appendDeferredPlexRow(page, pending, row) {
        var component;
        var modern;
        var scrollElement;
        var wasEmpty;

        if (!page || page.destroyed || !page.built || !pending || pending.appended || !row) return;

        component = page.component;
        if (!component) return;

        modern = typeof component.emit == 'function' && component.scroll &&
            typeof component.scroll.append == 'function' && typeof component.scroll.render == 'function' &&
            Array.isArray(component.items) &&
            typeof document.createDocumentFragment == 'function';
        if (!modern && typeof component.append != 'function') return;

        pending.appended = true;
        row.plex_deferred_order = pending.order;
        row.plex_deferred_sequence = pending.sequence;
        decorateDeferredPlexRow(row);
        wasEmpty = page.empty;

        try {
            if (wasEmpty) {
                if (component.empty_class && typeof component.empty_class.destroy == 'function') component.empty_class.destroy();
                if (page.original_start) component.start = page.original_start;
                if (component.scroll && typeof component.scroll.render == 'function') {
                    scrollElement = domElement(component.scroll.render(true));

                    if (scrollElement && scrollElement.classList) scrollElement.classList.remove('scroll--nopadding');
                }
                page.empty = false;
            }

            if (modern) {
                // Create exactly one line without replaying every page-level onBuild handler.
                component.fragment = document.createDocumentFragment();
                component.emit('createAndAppend', row);
                component.scroll.append(component.fragment);
                orderDeferredPlexRows(component);

                if (Lampa.Layer && typeof Lampa.Layer.visible == 'function') {
                    Lampa.Layer.visible(component.scroll.render(true));
                }
            } else component.append(row);

            if (wasEmpty && Lampa.Activity && typeof Lampa.Activity.own == 'function' &&
                Lampa.Activity.own(component) && typeof component.start == 'function') {
                component.start();
            }

            schedulePlexMarkerScan();
        } catch (e) {
            pending.appended = false;
            console.log('Plex Watchlist', 'deferred row append failed', e);
        }
    }

    function startDeferredPlexRow(page, pending) {
        if (!page || page.destroyed || !pending || pending.finished) return;
        if (pending.scope != tokenFingerprint()) {
            pending.finished = true;
            return;
        }

        pending.timer = null;

        fetchPlexRow(pending.name, pending.loader, function (cards, data) {
            var row;

            pending.finished = true;
            if (page.destroyed || pending.scope != tokenFingerprint()) return;

            try {
                row = pending.make(cards, data);
            } catch (e) {
                console.log('Plex Watchlist', 'deferred row build failed', e);
                return;
            }

            appendDeferredPlexRow(page, pending, row);
        }, function () {
            pending.finished = true;
        });
    }

    function flushDeferredPlexPage(page) {
        var delay = 0;

        if (!page || page.destroyed || !page.built) return;

        page.rows.forEach(function (pending) {
            if (pending.started || pending.finished || pending.appended) return;

            pending.started = true;
            pending.timer = setTimeout(function () {
                startDeferredPlexRow(page, pending);
            }, delay);
            delay += PLEX_DEFERRED_ROW_STAGGER;
        });
    }

    function queueDeferredPlexRow(params, name, loader, make, order) {
        var page = getDeferredPlexPage(params);
        var scoped = scopedPlexRowKey(name);
        var exists = false;

        page.rows.forEach(function (pending) {
            if (pending.scoped == scoped) exists = true;
        });

        if (exists) return;

        page.rows.push({
            name: name,
            scoped: scoped,
            scope: tokenFingerprint(),
            loader: loader,
            make: make,
            order: typeof order == 'number' ? order : page.rows.length,
            sequence: page.rows.length,
            started: false,
            finished: false,
            appended: false,
            timer: null
        });

        bindDeferredPlexPage(page);
        if (page.built) markDeferredPlexPageBuilt(page);
    }

    function progressivePlexContentRow(params, name, loader, make, order) {
        return function (call) {
            var cached;
            var empty;
            var row;
            var released = false;

            function release(value) {
                if (released) return;

                released = true;
                call(value);
            }

            try {
                cached = plexRowSnapshot(name);
                empty = cached && (cached.empty || !cached.cards.length);

                if (cached && !empty) {
                    try {
                        row = make(cached.cards, cached.data);
                    } catch (e) {
                        console.log('Plex Watchlist', 'cached row build failed', e);
                    }

                    release(row);

                    if (cached.age >= PLEX_ROW_CACHE_TTL) schedulePlexRowRefresh(name, loader);
                    return;
                }

                if (cached && cached.age < PLEX_EMPTY_ROW_CACHE_TTL) {
                    release();
                    return;
                }

                // Bind only local lifecycle hooks, then release Lampa before any Plex work starts.
                queueDeferredPlexRow(params, name, loader, make, order);
                release();
            } catch (e) {
                console.log('Plex Watchlist', 'progressive row failed', e);
                release();
            }
        };
    }

    function cancelPlexRowWork(groups) {
        var scope = tokenFingerprint() + ':';
        var keys = {};

        groups = groups ? asArray(groups) : [];

        function matches(key) {
            var matched = false;

            if (!groups.length) return true;
            if (key.indexOf(scope) !== 0) return false;

            groups.forEach(function (group) {
                if (key.indexOf(':' + group) >= 0) matched = true;
            });

            return matched;
        }

        Object.keys(plexRowRefreshTimers).forEach(function (key) {
            keys[key] = true;
        });
        Object.keys(plexRowLoading).forEach(function (key) {
            keys[key] = true;
        });

        Object.keys(keys).forEach(function (key) {
            if (!matches(key)) return;

            plexRowGenerations[key] = (plexRowGenerations[key] || 0) + 1;

            if (plexRowRefreshTimers[key]) {
                clearTimeout(plexRowRefreshTimers[key]);
                delete plexRowRefreshTimers[key];
            }

            if (plexRowLoading[key]) finishPlexRowLoad(key, plexRowLoading[key], false);
        });
    }

    function invalidatePlexRowCache(groups) {
        var rows = getPlexRowCache();
        var scope = tokenFingerprint() + ':';
        var changed = false;

        groups = asArray(groups);
        cancelPlexRowWork(groups);

        Object.keys(rows).forEach(function (key) {
            if (key.indexOf(scope) !== 0) return;

            groups.forEach(function (group) {
                if (key.indexOf(':' + group) < 0) return;

                delete rows[key];
                changed = true;
            });
        });

        if (changed) savePlexRowCache(rows);
    }

    function registerPlexRows() {
        if (plexRowsRegistered || !Lampa.ContentRows || !Lampa.ContentRows.add) return;

        plexRowsRegistered = true;
        disableNativeRows();

        Lampa.ContentRows.add({
            name: 'plex_watch_history',
            title: 'История',
            index: 2,
            screen: ['main'],
            call: function (params) {
                if (!token()) return;

                return progressivePlexContentRow(params, 'main:history:episode_stills:blur', loadPlexHistory, function (cards, data) {
                    return makePlexRow('История', cards, historyRowOptions('all', 'История', data));
                }, 2);
            }
        });

        Lampa.ContentRows.add({
            name: 'plex_watchlist_row',
            title: WATCHLIST_TITLE,
            index: 1,
            screen: ['main'],
            call: function (params) {
                if (!token()) return;

                return progressivePlexContentRow(params, 'main:watchlist', loadPlexWatchlistRow, function (cards, data) {
                    return makePlexRow(WATCHLIST_TITLE, cards, watchlistRowOptions('all', WATCHLIST_TITLE, data));
                }, 1);
            }
        });

        Lampa.ContentRows.add({
            name: 'plex_movie_history',
            title: 'Вы смотрели',
            index: 2,
            screen: ['category'],
            call: function (params) {
                if (!token() || params.url != 'movie') return;

                return progressivePlexContentRow(params, 'category:movie:history', loadPlexMovieHistory, function (cards, data) {
                    return makePlexRow('Вы смотрели', cards, historyRowOptions('movie', 'Вы смотрели', data));
                }, 2);
            }
        });

        Lampa.ContentRows.add({
            name: 'plex_movie_watchlist',
            title: WATCHLIST_TITLE,
            index: 1,
            screen: ['category'],
            call: function (params) {
                if (!token() || params.url != 'movie') return;

                return progressivePlexContentRow(params, 'category:movie:watchlist', function (success, fail) {
                    loadPlexWatchlistTypeRow('movie', success, fail);
                }, function (cards, data) {
                    return makePlexRow(WATCHLIST_TITLE, cards, watchlistRowOptions('movie', WATCHLIST_TITLE, data));
                }, 1);
            }
        });

        Lampa.ContentRows.add({
            name: 'plex_show_history',
            title: 'Вы смотрели',
            index: 2,
            screen: ['category'],
            call: function (params) {
                var kind;

                if (!token() || (params.url != 'tv' && params.url != 'anime')) return;
                kind = params.url == 'anime' ? 'anime' : 'tv';

                return progressivePlexContentRow(params, 'category:' + kind + ':history:filled', function (success, fail) {
                    loadPlexCategoryHistory(kind, success, fail);
                }, function (cards, data) {
                    return makePlexRow('Вы смотрели', cards, historyRowOptions(kind, 'Вы смотрели', data));
                }, 2);
            }
        });

        Lampa.ContentRows.add({
            name: 'plex_show_watchlist',
            title: WATCHLIST_TITLE,
            index: 0,
            screen: ['category'],
            call: function (params) {
                var kind;

                if (!token() || (params.url != 'tv' && params.url != 'anime')) return;
                kind = params.url == 'anime' ? 'anime' : 'tv';

                return progressivePlexContentRow(params, 'category:' + kind + ':watchlist:filled', function (success, fail) {
                    loadPlexWatchlistTypeRow(kind, success, fail);
                }, function (cards, data) {
                    return makePlexRow(WATCHLIST_TITLE, cards, watchlistRowOptions(kind, WATCHLIST_TITLE, data));
                }, 0);
            }
        });

        Lampa.ContentRows.add({
            name: 'plex_recent_episodes',
            title: 'Новые эпизоды',
            index: 1,
            screen: ['category'],
            call: function (params, screen) {
                var kind;

                if (!token()) return;
                if (screen == 'category' && params.url == 'movie') return;
                if (screen == 'category' && params.url && params.url != 'tv' && params.url != 'anime') return;
                kind = params.url == 'anime' ? 'anime' : 'tv';

                return progressivePlexContentRow(params, 'category:' + kind + ':recent_episodes', function (success, fail) {
                    loadPlexRecentlyAired(kind, success, fail);
                }, function (cards) {
                    return makePlexRow('Новые эпизоды', cards);
                }, 1);
            }
        });
    }

    function makePlexRow(title, cards, options) {
        var row;
        var key;

        if (!cards || !cards.length) return;

        row = {
            title: title,
            results: cards
        };

        options = options || {};

        for (key in options) {
            if (options.hasOwnProperty(key)) row[key] = options[key];
        }

        return row;
    }

    function historyRowOptions(kind, title, data) {
        return moreRowOptions(data, function () {
            openPlexHistory(kind, title);
        });
    }

    function watchlistRowOptions(kind, title, data) {
        return moreRowOptions(data, function () {
            openWatchlist(kind, title);
        });
    }

    function moreRowOptions(data, open) {
        var total = data && data.total_pages ? data.total_pages : 1;

        return {
            page: 1,
            total_pages: total,
            onMore: function () {
                open();
            },
            params: {
                emit: {
                    onlyMore: function () {
                        open();
                    }
                }
            }
        };
    }

    function hubRequestParams() {
        return {
            includeCollections: 1,
            includeExternalMedia: 1,
            includeGuids: 1,
            includeMeta: 1,
            includeMetadata: 1,
            includeExternalMetadata: 1,
            includeLibraryPlaylists: 1,
            includeStations: 1,
            includeRecentChannels: 1,
            includeUserState: 1,
            excludeFields: 'summary',
            count: PLEX_ROW_SIZE,
            'X-Plex-Container-Start': 0,
            'X-Plex-Container-Size': PLEX_ROW_SIZE
        };
    }

    function hubText(hub) {
        return normalizeTitle([
            hub && hub.title,
            hub && hub.context,
            hub && hub.key,
            hub && hub.hubKey,
            hub && hub.hubIdentifier,
            hub && hub.identifier,
            hub && hub.sourceURI,
            hub && hub.type
        ].join(' '));
    }

    function pickHub(data, names) {
        var hubs = asArray(mediaContainer(data).Hub);
        var picked = null;

        names.forEach(function (name) {
            var normalized = normalizeTitle(name);
            var compact = normalized.replace(/\s+/g, '');

            if (picked) return;

            hubs.forEach(function (hub) {
                var text = hubText(hub);
                var compactText = text.replace(/\s+/g, '');

                if (!picked && (text.indexOf(normalized) >= 0 || compactText.indexOf(compact) >= 0)) picked = hub;
            });
        });

        return picked;
    }

    function hubUrl(key) {
        if (!key) return '';
        key = key.toString();

        if (/^https?:\/\//i.test(key)) return key;

        if (key.indexOf('provider://' + DISCOVER_IDENTIFIER) === 0) {
            return DISCOVER + key.replace('provider://' + DISCOVER_IDENTIFIER, '');
        }

        if (key.charAt(0) != '/') key = '/' + key;

        return DISCOVER + key;
    }

    function hubKeys(hub) {
        var out = [];

        ['key', 'hubKey', 'sourceURI'].forEach(function (name) {
            if (hub && hub[name] && out.indexOf(hub[name]) < 0) out.push(hub[name]);
        });

        return out;
    }

    function hubDataItems(data, names, allowAll) {
        var hubs = asArray(mediaContainer(data).Hub);
        var hub = pickHub(data, names);
        var items = collectHubItems(hub);

        if (!items.length && allowAll) {
            if (!hub && hubs.length == 1) hub = hubs[0];
            items = hub ? collectHubItems(hub) : [];
            if (!items.length) items = collectMetadata(data);
        }

        return {
            hub: hub,
            items: items
        };
    }

    function loadHubItems(names, success, fail, options) {
        options = options || {};

        var sources = [
            {
                path: '/hubs/sections/home',
                allowAll: false
            },
            {
                path: '/hubs',
                allowAll: false
            },
            {
                path: '/hubs/sections/watchlist/recommended',
                allowAll: false
            },
            {
                path: '/hubs/sections/watchlist',
                allowAll: false
            }
        ];
        var index = 0;
        var tried = {};

        if (options.identifier) {
            var identifierSource = {
                path: '/hubs',
                params: {
                    identifier: options.identifier
                },
                allowAll: true
            };

            if (options.identifierFirst === false) sources.splice(1, 0, identifierSource);
            else sources.unshift(identifierSource);
        }

        function next() {
            var source;

            if (index >= sources.length) {
                if (fail) fail();
                return;
            }

            source = sources[index++];

            request('GET', hubUrl(source.path), mergeParams(hubRequestParams(), source.params), function (data) {
                var found = hubDataItems(data, names, source.allowAll);

                if (found.items.length) {
                    success(found.items, function () {
                        loadHubKeyItems(found.hub, names, tried, success, next);
                    });
                    return;
                }

                loadHubKeyItems(found.hub, names, tried, success, next);
            }, next);
        }

        next();
    }

    function loadHubKeyItems(hub, names, tried, success, fail) {
        var keys = hubKeys(hub);
        var index = 0;

        function next() {
            var key;

            if (index >= keys.length) {
                if (fail) fail();
                return;
            }

            key = keys[index++];

            if (tried[key]) {
                next();
                return;
            }

            tried[key] = true;

            request('GET', hubUrl(key), hubRequestParams(), function (data) {
                var found = hubDataItems(data, names, true);

                if (found.items.length) success(found.items, next);
                else next();
            }, next);
        }

        next();
    }

    function loadPlexContinueWatching(success, fail) {
        loadHubItems([
            'watchlist.continueWatching',
            'continueWatching',
            'home.continue',
            'movies.continueWatching',
            'continue watching',
            'continue',
            'home.ondeck'
        ], function (items) {
            hydratePlexItems(items, 'continue', success, {
                enrichEpisodes: true,
                watchlisted: true
            });
        }, fail, {
            identifier: 'watchlist.continueWatching,continueWatching,home.continue,movies.continueWatching,home.ondeck'
        });
    }

    function loadPlexRecentlyAired(kind, success, fail) {
        var hydrate = function (items, nextHub) {
            hydratePlexEpisodeItems(items, 'recent_episodes', success, function () {
                if (nextHub) nextHub();
                else loadPlexRecentlyAiredFallback(kind, success, fail);
            }, {
                category: kind,
                watchlisted: true
            });
        };

        loadHubItems([
            'recently aired episodes',
            'recently aired',
            'recentlyAiredEpisodes',
            'watchlist.recentlyAiredEpisodes',
            'watchlist.recentlyAired',
            'watchlist.recentEpisodes',
            'recent episodes',
            'new episodes',
            'recently released',
            'home.television.recent',
            'home.ondeck'
        ], hydrate, function () {
            loadPlexRecentlyAiredFallback(kind, success, fail);
        }, {
            identifier: 'watchlist.recentlyAiredEpisodes,watchlist.recentlyAired,watchlist.recentEpisodes,home.television.recent,home.ondeck',
            identifierFirst: true
        });
    }

    function loadPlexRecentlyAiredFallback(kind, success, fail) {
        var sawItems = false;

        loadHubItems([
            'home.ondeck',
            'on deck',
            'recent episodes',
            'new episodes',
            'continue watching'
        ], function (items, nextHub) {
            sawItems = true;

            hydratePlexEpisodeItems(items, 'recent_episodes', success, function () {
                if (nextHub) nextHub();
                else success([]);
            }, {
                category: kind,
                watchlisted: true
            });
        }, function () {
            if (sawItems) success([]);
            else if (fail) fail();
        }, {
            identifier: 'home.ondeck,watchlist.continueWatching,home.continue',
            identifierFirst: true
        });
    }

    function hydratePlexEpisodeItems(items, rowKind, success, fail, options) {
        options = options || {};

        var episodes = asArray(items).filter(isPlexEpisodeLike);

        if (!episodes.length) {
            if (fail) fail();
            return;
        }

        hydratePlexItems(episodes, rowKind, function (cards) {
            if (options.category) cards = filterLampaCategoryCards(cards, options.category);

            if (cards && cards.length) success(cards);
            else if (fail) fail();
        }, {
            enrichEpisodes: true,
            watchlisted: !!options.watchlisted
        });
    }

    function loadPlexWatchlistRow(success, fail) {
        loadWatchlist(1, function (data) {
            var cards = data && data.results ? data.results : [];

            success(cards, data);
        }, fail, 'all', createWatchlistState(), WATCHLIST_ROW_SIZE);
    }

    function isWatchlistRowType(item, wanted) {
        var type = normalizePlexType(item && item.type);

        if (wanted == 'movie') return type == 'movie';
        if (wanted == 'show') return type == 'show' || type == 'season';

        return false;
    }

    function createWatchlistState() {
        return {
            start: 0,
            done: false,
            queue: [],
            seen: {}
        };
    }

    function watchlistItemKey(item) {
        var type = normalizePlexType(item && item.type);
        var title = cardTitle(item) || item.title || item.name || '';

        return [
            type,
            metadataRatingKey(item),
            normalizeTitle(title),
            metadataYear(item)
        ].join(':');
    }

    function collectWatchlistItems(items, wanted, state, limit) {
        var out = [];

        wanted = wanted || 'all';
        limit = limit || items.length || PLEX_ROW_SIZE;

        items.forEach(function (item) {
            var type = normalizePlexType(item && item.type);
            var key;

            if (out.length >= limit) return;
            if (wanted != 'all' && !isWatchlistRowType(item, wanted)) return;
            if (wanted == 'all' && type != 'movie' && type != 'show' && type != 'season') return;

            if ((wanted == 'show' || wanted == 'all') && type == 'season') item = showHistoryItem(item);
            if (!item) return;

            key = watchlistItemKey(item);

            if (!key || state.seen[key]) return;

            state.seen[key] = true;
            out.push(item);
        });

        return out;
    }

    function loadPlexWatchlistTypeRow(wanted, success, fail) {
        loadWatchlist(1, function (data) {
            var cards = data && data.results ? data.results : [];

            success(cards, data);
        }, fail, wanted, createWatchlistState(), WATCHLIST_ROW_SIZE);
    }

    function plexAccountId(data) {
        data = data || {};

        return data.uuid || data.id || data.username || (data.user && (data.user.uuid || data.user.id || data.user.username)) || '';
    }

    function loadPlexAccountId(success, fail) {
        var cache = getCache();
        var account = cache.account || {};
        var fresh = account.id && account.time && Date.now() - account.time < 24 * 60 * 60 * 1000;

        if (fresh) {
            success(account.id);
            return;
        }

        request('GET', PLEX + '/api/v2/user', {}, function (data) {
            var id = plexAccountId(data);

            if (!id) {
                if (fail) fail();
                return;
            }

            cache = getCache();
            cache.account = cache.account || {};
            cache.account.id = id;
            cache.account.time = Date.now();
            saveCache(cache);

            success(id);
        }, fail);
    }

    function loadProfileWatchHistory(success, fail, options) {
        options = options || {};

        var first = parseInt(options.first || PLEX_ROW_SIZE * 2, 10) || PLEX_ROW_SIZE * 2;
        var after = options.after || null;

        function requestHistory(uuid, canRetryEmpty) {
            graphQL(PROFILE_WATCH_HISTORY_QUERY, {
                uuid: uuid || '',
                first: first,
                after: after,
                skipUserState: false
            }, function (data) {
                parseHistory(data, uuid, canRetryEmpty);
            }, function () {
                if (uuid && canRetryEmpty) requestHistory('', false);
                else if (fail) fail();
            });
        }

        function parseHistory(data, uuid, canRetryEmpty) {
            var history = data && data.user && data.user.watchHistory ? data.user.watchHistory : {};
            var nodes = asArray(history.nodes);
            var pageInfo = history.pageInfo || {};
            var items = [];

            nodes.forEach(function (node) {
                var item = graphMetadataToPlexItem(node.metadataItem, node);
                if (item) items.push(item);
            });

            if (items.length) success(items, pageInfo);
            else if (uuid && canRetryEmpty) requestHistory('', false);
            else if (options.allowEmpty) success([], pageInfo);
            else if (fail) fail();
        }

        loadPlexAccountId(function (id) {
            requestHistory(id, true);
        }, function () {
            requestHistory('', false);
        });
    }

    function historyWatchedState(item) {
        var type = normalizePlexType(item && item.type);

        if (type == 'movie') return true;
        if (type == 'show' || type == 'season') return metadataWatched(item);

        return false;
    }

    function createHistoryState() {
        return {
            after: null,
            done: false,
            queue: [],
            seen: {}
        };
    }

    function historyItemKey(item) {
        var title = cardTitle(item) || item.title || item.name || '';

        return metadataRatingKey(item) || normalizeTitle(title) + ':' + metadataYear(item);
    }

    function historyAllItemKey(item) {
        var type = normalizePlexType(item && (item.sourceType || item.type));
        var title = cardTitle(item) || item.title || item.name || '';
        var season = seasonValue(item);
        var episode = item && (item.index || item.episode || item.episodeNumber || '');

        return item && item.historyId || [
            metadataRatingKey(item),
            type,
            season,
            episode,
            item && item.viewedAt || '',
            normalizeTitle(title),
            metadataYear(item)
        ].join(':');
    }

    function collectMovieHistoryItems(items, state, limit) {
        var out = [];

        limit = limit || items.length || PLEX_ROW_SIZE;

        items.forEach(function (item) {
            var key;

            if (out.length >= limit) return;
            if (normalizePlexType(item.type) != 'movie') return;

            key = historyItemKey(item);

            if (!key || state.seen[key]) return;

            state.seen[key] = true;
            out.push(item);
        });

        return out;
    }

    function collectShowHistoryItems(items, state, limit) {
        var candidates = items.filter(function (item) {
            var type = normalizePlexType(item.type);

            return type == 'episode' || type == 'show' || type == 'season' || isPlexEpisodeLike(item);
        });

        return uniqueShowHistoryItems(candidates, limit || candidates.length || PLEX_ROW_SIZE, state.seen);
    }

    function collectAllHistoryItems(items, state, limit) {
        var out = [];

        limit = limit || items.length || PLEX_ROW_SIZE;

        items.forEach(function (item) {
            var type = normalizePlexType(item && item.type);
            var key;

            if (out.length >= limit) return;
            if (type != 'movie' && type != 'episode' && type != 'show' && type != 'season') return;

            key = historyAllItemKey(item);

            if (!key || state.seen[key]) return;

            state.seen[key] = true;
            out.push(item);
        });

        return out;
    }

    function collectTypedHistoryItems(kind, items, state, limit) {
        if (kind == 'all') return collectAllHistoryItems(items, state, limit);
        if (kind == 'show') return collectShowHistoryItems(items, state, limit);

        return collectMovieHistoryItems(items, state, limit);
    }

    function hydrateTypedHistoryItems(kind, items, success) {
        if (kind == 'all') {
            hydratePlexItems(items, 'history', function (cards) {
                success(cards);
            }, {
                enrichEpisodes: true,
                watched: historyWatchedState
            });
            return;
        }

        hydratePlexItems(items, kind == 'show' ? 'show_history' : 'history', function (cards) {
            success(cards);
        }, {
            watched: kind == 'movie' ? true : undefined
        });
    }

    function loadRawPlexHistoryPageData(kind, page, state, limit, success, fail) {
        state = state || createHistoryState();
        state.seen = state.seen || {};
        state.queue = state.queue || [];

        page = parseInt(page || 1, 10) || 1;
        limit = parseInt(limit || PAGE_SIZE, 10) || PAGE_SIZE;

        var collected = [];
        var batches = 0;

        function drainQueue() {
            while (state.queue.length && collected.length < limit) {
                collected.push(state.queue.shift());
            }
        }

        function finish(hasMore) {
            hasMore = hasMore || !!state.queue.length;

            if (!collected.length) {
                if (state.done) {
                    success({
                        results: [],
                        page: page,
                        total_pages: page,
                        has_more: false
                    });
                    return;
                }

                if (fail) fail();
                return;
            }

            hydrateTypedHistoryItems(kind, collected.slice(0, limit), function (cards) {
                success({
                    results: cards,
                    page: page,
                    total_pages: hasMore ? page + 1 : page,
                    has_more: !!hasMore
                });
            });
        }

        function next() {
            drainQueue();

            if (collected.length >= limit) {
                finish(!state.done || !!state.queue);
                return;
            }

            if (state.done || batches >= HISTORY_MAX_BATCHES) {
                finish(!state.done);
                return;
            }

            loadProfileWatchHistory(function (items, pageInfo) {
                var picked;

                batches++;
                pageInfo = pageInfo || {};

                state.after = pageInfo.endCursor || null;
                state.done = !pageInfo.hasNextPage || !state.after;

                picked = collectTypedHistoryItems(kind, items, state, items.length || HISTORY_GRAPH_PAGE_SIZE);

                picked.forEach(function (item) {
                    state.queue.push(item);
                });

                drainQueue();

                if (collected.length >= limit || state.done || batches >= HISTORY_MAX_BATCHES) {
                    finish(!state.done);
                } else {
                    next();
                }
            }, function () {
                finish(false);
            }, {
                first: HISTORY_GRAPH_PAGE_SIZE,
                after: state.after,
                allowEmpty: true
            });
        }

        next();
    }

    function loadPlexHistoryPageData(kind, page, state, limit, success, fail) {
        if (kind != 'tv' && kind != 'anime' && kind != 'show') {
            loadRawPlexHistoryPageData(kind, page, state, limit, success, fail);
            return;
        }

        kind = kind == 'show' ? 'tv' : kind;
        state = state || createHistoryState();

        loadFilteredLampaCategoryPage('history', kind, page, state, limit, createHistoryState, function (sourcePage, sourceState, sourceLimit, onSuccess, onFail) {
            loadRawPlexHistoryPageData('show', sourcePage, sourceState, sourceLimit, onSuccess, onFail);
        }, success, fail);
    }

    function loadPlexHistory(success, fail) {
        loadPlexHistoryPageData('all', 1, createHistoryState(), HISTORY_ROW_SIZE, function (data) {
            success(data.results, data);
        }, function () {
            loadPlexHistoryFallback(function (cards) {
                success(cards, {
                    page: 1,
                    total_pages: 1
                });
            }, fail);
        });
    }

    function loadPlexHistoryFallback(success, fail) {
        loadHubItems(['watch history', 'recently watched', 'watch again', 'history'], function (items) {
            var history = items.filter(function (item) {
                var type = normalizePlexType(item.type);

                return type == 'movie' || type == 'episode' || type == 'show' || type == 'season';
            }).slice(0, PLEX_ROW_SIZE);

            if (!history.length) {
                if (fail) fail();
                return;
            }

            hydratePlexItems(history, 'history', success, {
                enrichEpisodes: true,
                watched: historyWatchedState
            });
        }, fail);
    }

    function showHistoryItem(item) {
        var type = normalizePlexType(item && item.type);
        var sourceType = normalizePlexType(item && item.sourceType);
        var isSeason = type == 'season' || sourceType == 'season';
        var showKey;
        var title;
        var year;
        var guid;
        var guids;
        var out;

        if (!item) return null;

        if (type == 'show' && !isSeason) return item;

        if (!isSeason && type != 'episode' && !isPlexEpisodeLike(item)) return null;

        if (isSeason) {
            showKey = item.parentRatingKey || item.grandparentRatingKey || '';
            title = seasonShowTitle(item) || (sourceType == 'season' ? item.title : '');
            year = item.parentYear || item.grandparentYear || metadataYear(item);
            guid = item.parentGuid || item.grandparentGuid || item.showGuid || '';
            guids = asArray(item.parentGuidList || item.grandparentGuidList);
        } else {
            showKey = item.grandparentRatingKey || item.parentRatingKey || '';
            title = episodeShowTitle(item) || item.title || '';
            year = episodeSeriesYear(item) || item.grandparentYear || yearFromText(item.grandparentOriginallyAvailableAt) || '';
            guid = item.grandparentGuid || item.showGuid || '';
            guids = asArray(item.grandparentGuidList);
        }

        if (!title) return null;

        out = {
            ratingKey: showKey || metadataRatingKey(item),
            guid: guid,
            type: 'show',
            title: title,
            year: year,
            originallyAvailableAt: item.parentOriginallyAvailableAt || item.grandparentOriginallyAvailableAt || (year ? year + '-01-01' : ''),
            thumb: item.parentThumb || item.grandparentThumb || item.thumb,
            art: item.parentArt || item.grandparentArt || item.art,
            key: item.parentKey || item.grandparentKey || (showKey ? '/library/metadata/' + showKey : item.key),
            UserState: item.grandparentUserState || {}
        };

        if (guids.length) {
            out.Guid = guids.map(function (value) {
                return typeof value == 'string' ? { id: value } : value;
            });
        }

        return out;
    }

    function uniqueShowHistoryItems(items, limit, seen) {
        var out = [];

        limit = limit || PLEX_ROW_SIZE;
        seen = seen || {};

        items.forEach(function (item) {
            var show = showHistoryItem(item);
            var key;

            if (out.length >= limit) return;
            if (!show || !show.title) return;

            key = metadataRatingKey(show) || normalizeTitle(show.title) + ':' + metadataYear(show);

            if (seen[key]) return;

            seen[key] = true;
            out.push(show);
        });

        return out;
    }

    function hydratePlexShowHistoryItems(items, success, fail) {
        var candidates = items.filter(function (item) {
            var type = normalizePlexType(item.type);

            return type == 'episode' || type == 'show' || type == 'season' || isPlexEpisodeLike(item);
        });

        if (!candidates.length) {
            if (fail) fail();
            return;
        }

        preparePlexItems(candidates, {
            enrichEpisodes: true
        }, function (prepared) {
            var shows = uniqueShowHistoryItems(prepared, PLEX_ROW_SIZE, {});

            if (!shows.length) {
                if (fail) fail();
                return;
            }

            hydratePlexItems(shows, 'show_history', success);
        });
    }

    function loadPlexCategoryHistory(kind, success, fail) {
        kind = kind == 'show' ? 'tv' : kind;

        loadPlexHistoryPageData(kind, 1, createHistoryState(), HISTORY_ROW_SIZE, function (data) {
            success(data.results, data);
        }, function () {
            loadPlexShowHistoryFallback(function (cards) {
                cards = filterLampaCategoryCards(cards, kind);

                success(cards, {
                    page: 1,
                    total_pages: 1,
                    has_more: false
                });
            }, fail);
        });
    }

    function loadPlexShowHistoryFallback(success, fail) {
        loadHubItems(['watch history', 'recently watched', 'watch again', 'history'], function (items) {
            hydratePlexShowHistoryItems(items, success, fail);
        }, fail);
    }

    function loadPlexMovieHistory(success, fail) {
        loadPlexHistoryPageData('movie', 1, createHistoryState(), HISTORY_ROW_SIZE, function (data) {
            success(data.results, data);
        }, function () {
            loadPlexMovieHistoryFallback(function (cards) {
                success(cards, {
                    page: 1,
                    total_pages: 1
                });
            }, fail);
        });
    }

    function loadPlexMovieHistoryFallback(success, fail) {
        loadHubItems(['watch history', 'recently watched', 'watch again', 'history'], function (items) {
            var movies = items.filter(function (item) {
                return normalizePlexType(item.type) == 'movie';
            }).slice(0, PLEX_ROW_SIZE);

            if (!movies.length) {
                if (fail) fail();
                return;
            }

            hydratePlexItems(movies, 'history', success, {
                watched: true
            });
        }, fail);
    }

    function loadPlexHistoryCategoryPage(kind, page, state, success, fail) {
        kind = kind == 'show' ? 'tv' : kind;

        loadPlexHistoryPageData(kind, page, state, PAGE_SIZE, success, function () {
            if (page > 1) {
                if (fail) fail();
                return;
            }

            if (kind == 'all') {
                loadPlexHistoryFallback(function (cards) {
                    success({
                        results: cards,
                        page: 1,
                        total_pages: 1
                    });
                }, fail);
            } else if (kind == 'tv' || kind == 'anime') {
                loadPlexShowHistoryFallback(function (cards) {
                    cards = filterLampaCategoryCards(cards, kind);

                    success({
                        results: cards,
                        page: 1,
                        total_pages: 1,
                        has_more: false
                    });
                }, fail);
            } else {
                loadPlexMovieHistoryFallback(function (cards) {
                    success({
                        results: cards,
                        page: 1,
                        total_pages: 1
                    });
                }, fail);
            }
        });
    }

    function episodeShowTitle(item) {
        item = item || {};

        return item.grandparentTitle || item.showTitle || item.seriesTitle || item.grandparentName || item.grandparent && item.grandparent.title || '';
    }

    function seasonShowTitle(item) {
        item = item || {};

        return item.parentTitle || item.grandparentTitle || item.showTitle || item.seriesTitle || item.parentName || item.parent && item.parent.title || item.grandparent && item.grandparent.title || '';
    }

    function isPlexEpisodeLike(item) {
        return normalizePlexType(item && item.type) == 'episode' || !!(item && (item.grandparentTitle || item.parentIndex || item.episodeNumber));
    }

    function episodeAirDate(item) {
        item = item || {};

        return item.episodeOriginallyAvailableAt || item.airDate || item.originallyAvailableAt || item.publishedAt || item.originallyAvailable || '';
    }

    function plexImageUrl(value) {
        var image = (value || '').toString();

        if (!image || /^(?:https?:|data:|blob:)/i.test(image)) return image;
        if (image.indexOf('//') === 0) return 'https:' + image;

        return '';
    }

    function episodeStillImage(item) {
        var image;

        item = item || {};
        image = Object.prototype.hasOwnProperty.call(item, 'episodeThumb') ? item.episodeThumb : item.episode_thumb || item.thumb || '';

        return plexImageUrl(image);
    }

    function formatEpisodeAirDate(value) {
        var months = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
        var found = (value || '').toString().match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
        var year;
        var month;
        var day;

        if (!found) return '';

        year = parseInt(found[1], 10);
        month = parseInt(found[2], 10);
        day = parseInt(found[3], 10);

        if (!year || !day || month < 1 || month > 12) return '';

        return day + ' ' + months[month - 1] + ' ' + year;
    }

    function shouldEnrichEpisode(item) {
        return normalizePlexType(item && item.type) == 'episode';
    }

    function mergeEpisodeDetail(item, detail) {
        var merged = {};
        var fields = [
            'grandparentTitle',
            'grandparentRatingKey',
            'grandparentGuid',
            'grandparentGuidList',
            'grandparentThumb',
            'grandparentArt',
            'grandparentYear',
            'grandparentOriginallyAvailableAt',
            'parentTitle',
            'parentRatingKey',
            'parentGuid',
            'parentThumb',
            'parentIndex',
            'index',
            'originallyAvailableAt',
            'publishedAt',
            'year',
            'Guid',
            'UserState'
        ];

        for (var key in item) {
            if (item.hasOwnProperty(key)) merged[key] = item[key];
        }

        fields.forEach(function (name) {
            if ((merged[name] === undefined || merged[name] === null || merged[name] === '') && detail && detail[name] !== undefined && detail[name] !== null && detail[name] !== '') {
                merged[name] = detail[name];
            }
        });

        if (!merged.episodeThumb && detail) merged.episodeThumb = detail.episodeThumb || detail.thumb || detail.art || '';

        if (!merged.ratingKey && detail && detail.ratingKey) merged.ratingKey = detail.ratingKey;
        if (!merged.key && detail && detail.key) merged.key = detail.key;
        if (!merged.type && detail && detail.type) merged.type = detail.type;

        return merged;
    }

    function metadataGuidList(item) {
        var guids = [];

        item = item || {};

        asArray(item.Guid).forEach(function (guid) {
            if (guid && guid.id) guids.push(guid.id);
        });

        if (item.guid) guids.push(item.guid);

        return guids;
    }

    function preferredGuid(item) {
        var guids = metadataGuidList(item);
        var best = '';

        guids.forEach(function (guid) {
            if (!best) best = guid;
            if ((guid + '').indexOf('tmdb://') === 0) best = guid;
        });

        return best;
    }

    function mergeEpisodeShowDetail(item, show) {
        var merged = {};
        var showYear = metadataYear(show);
        var showGuid = preferredGuid(show);
        var showGuids = metadataGuidList(show);

        for (var key in item) {
            if (item.hasOwnProperty(key)) merged[key] = item[key];
        }

        if (show && show.title) merged.grandparentTitle = show.title;
        if (show && metadataRatingKey(show)) merged.grandparentRatingKey = metadataRatingKey(show);
        if (showGuid) merged.grandparentGuid = showGuid;
        if (showGuids.length) merged.grandparentGuidList = showGuids;
        if (showYear) merged.grandparentYear = showYear;
        if (show && show.thumb) merged.grandparentThumb = show.thumb;
        if (show && show.art) merged.grandparentArt = show.art;
        if (show && show.originallyAvailableAt) merged.grandparentOriginallyAvailableAt = show.originallyAvailableAt;

        return merged;
    }

    function enrichEpisodeItem(item, done) {
        var ratingKey = metadataRatingKey(item);

        if (!ratingKey || !shouldEnrichEpisode(item)) {
            done(item);
            return;
        }

        request('GET', METADATA + '/library/metadata/' + encodeURIComponent(ratingKey), {
            includeGuids: 1,
            includeUserState: 1
        }, function (data) {
            var detail = collectMetadata(data)[0];
            var merged = detail ? mergeEpisodeDetail(item, detail) : item;
            var showKey = merged.grandparentRatingKey;

            if (!showKey || showKey == ratingKey) {
                done(merged);
                return;
            }

            request('GET', METADATA + '/library/metadata/' + encodeURIComponent(showKey), {
                includeGuids: 1,
                includeUserState: 1
            }, function (showData) {
                var show = collectMetadata(showData)[0];

                done(show ? mergeEpisodeShowDetail(merged, show) : merged);
            }, function () {
                done(merged);
            });
        }, function () {
            done(item);
        });
    }

    function preparePlexItems(items, options, done) {
        var out = items.slice();
        var cursor = 0;
        var active = 0;
        var finished = 0;
        var completed = false;

        if (!options.enrichEpisodes || !items.length) {
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
                    active++;

                    enrichEpisodeItem(items[index], function (item) {
                        out[index] = item || items[index];
                        active--;
                        finished++;
                        next();
                    });
                })(cursor++);
            }
        }

        next();
    }

    function plexWatchedState(item, options) {
        if (typeof options.watched == 'function') return !!options.watched(item);
        if (typeof options.watched != 'undefined') return !!options.watched || metadataWatched(item);

        return metadataWatched(item);
    }

    function hydratePlexItems(items, rowKind, success, options) {
        options = options || {};

        preparePlexItems(items, options, function (prepared) {
            var cards = [];

            prepared.forEach(function (item) {
                var card = plexToLampaCard(item, rowKind);

                if (!card || !cardTitle(card)) return;

                card.plex_row_kind = rowKind;
                card.plex_watched = plexWatchedState(item, options);
                card.plex_watchlisted = !!options.watchlisted || metadataWatchlisted(item);
                applyPlexCardDecorations(card);
                cards.push(card);
            });

            if (!cards.length) {
                success([]);
                return;
            }

            rememberPlexCards(cards);

            hydrateLampaCards(cards, function (hydrated) {
                hydrated.forEach(function (card) {
                    applyPlexCardDecorations(card);
                });

                rememberPlexCards(hydrated);
                success(hydrated);
            });
        });
    }

    function rememberPlexCards(cards) {
        var cache = getCache();

        cards.forEach(function (card) {
            var direct = plexItemFromCard(card);

            if (!direct || !direct.ratingKey) return;

            cache.items[cardKey(card)] = direct;

            if (card.plex_watched) {
                cache.watched[direct.ratingKey] = Date.now();
                cache.watched_checked[direct.ratingKey] = Date.now();
            }
            if (card.plex_rating) {
                cache.ratings[direct.ratingKey] = parsePlexRating(card.plex_rating);
                cache.ratings_checked[direct.ratingKey] = Date.now();
            }
            if (card.plex_watchlisted) {
                if (hasRecentWatchlistRemoval(cache, direct.ratingKey)) return;

                cache.watchlist[direct.ratingKey] = Date.now();
                cache.watchlist_checked[direct.ratingKey] = Date.now();
                delete cache.watchlist_removed[direct.ratingKey];
            }
        });

        saveCache(cache);
        schedulePlexMarkerScan();
    }

    function applyPlexCardDecorations(card) {
        card.params = card.params || {};

        var existing = card.params.emit || {};
        if (existing.plexWatchlistDecorated) return card;

        var oldInit = existing.onInit;
        var oldCreate = existing.onCreate;
        var emit = {};

        for (var key in existing) {
            if (existing.hasOwnProperty(key)) emit[key] = existing[key];
        }

        emit.onInit = function (instance) {
            if (typeof oldInit == 'function') oldInit.apply(this, arguments);
            useHistoryEpisodePoster(instance, card);
        };
        emit.onCreate = function () {
            if (typeof oldCreate == 'function') oldCreate.apply(this, arguments);
            decorateCreatedCard(this.html, this.data || card);
        };
        emit.plexWatchlistDecorated = true;

        card.params.emit = emit;

        return card;
    }

    function useHistoryEpisodePoster(instance, fallbackCard) {
        var card = instance && instance.data || fallbackCard || {};
        var image = card.plex_episode_thumb || fallbackCard && fallbackCard.plex_episode_thumb || '';

        if (!instance || !image) return;
        if (card.plex_row_kind != 'history' || !card.plex_episode_rating_key) return;

        // Lampa also uses poster/img as the focus background, so replace only the rendered card image.
        instance.getPosterPath = function () {
            return image;
        };
    }

    function domElement(node) {
        if (!node) return null;
        if (node.nodeType) return node;
        if (node[0] && node[0].nodeType) return node[0];
        return null;
    }

    function decorateCreatedCard(root, card) {
        var element = domElement(root);

        if (!element || !card) return;

        removeCardIcon(element, 'wath');
        removeCardIcon(element, 'history');
        if (card.plex_episode_label) addEpisodeBadge(element, card.plex_episode_label);
        if (card.plex_episode_air_date_label) addEpisodeAirDate(element, card.plex_episode_air_date_label);
        refreshVisiblePlexState(element, card);
    }

    function removeCardIcon(element, name) {
        var icons = element && element.querySelectorAll ? element.querySelectorAll('.card__icons-inner .icon--' + name) : [];

        Array.prototype.forEach.call(icons, function (icon) {
            if (icon.parentNode) icon.parentNode.removeChild(icon);
        });
    }

    function updateWatchedState(element, card, watched) {
        card.plex_watched = !!watched;
        removeCardIcon(element, 'history');
    }

    function refreshVisiblePlexState(element, card) {
        var key;
        var cache;

        if (!token() || !card || !element) return;
        if (card.plex_row_kind) return;

        key = ratingKeyForCard(card);
        if (!key) return;

        cache = getCache();

        if (cache.state_loading[key]) return;
        if (cache.state_checked[key] && Date.now() - cache.state_checked[key] < PLEX_STATE_TTL) return;

        cache.state_loading[key] = Date.now();
        saveCache(cache);

        userState(key, function (state) {
            var sync = syncCachedPlexState(key, state, cachedPlexItemForCard(card), {
                scan: false
            });

            cache = getCache();
            delete cache.state_loading[key];
            cache.state_checked[key] = Date.now();
            saveCache(cache);

            updateWatchedState(element, card, sync.watched);
        }, function () {
            cache = getCache();
            delete cache.state_loading[key];
            cache.state_checked[key] = Date.now();
            saveCache(cache);
        });
    }

    function addEpisodeBadge(element, label) {
        var view = element.querySelector('.card__view');
        var badge = element.querySelector('.card__plex-episode');

        if (!view || !label) return;

        if (!badge) {
            badge = document.createElement('div');
            badge.className = 'card__vote card__plex-episode';
            view.appendChild(badge);
        } else if (!badge.classList.contains('card__vote')) {
            badge.className = 'card__vote card__plex-episode';
        }

        badge.textContent = label;
    }

    function addEpisodeAirDate(element, label) {
        var age = element.querySelector('.card__age');

        if (!age || !label) return;
        if (age.getAttribute('data-plex-episode-date') == label) return;

        age.setAttribute('data-plex-base-age', age.getAttribute('data-plex-base-age') || age.textContent || '');
        age.setAttribute('data-plex-episode-date', label);
        age.textContent = label;
    }

    function scanPlexMarkers() {
        var nodes = document.querySelectorAll('.card');
        var cache = getCache();

        if (token() && !watchedSnapshotFresh(cache) && !cache.watched_loading) {
            scheduleWatchedSnapshot();
        }

        Array.prototype.forEach.call(nodes, function (node) {
            if (node.card_data) decorateCreatedCard(node, node.card_data);
        });
    }

    function schedulePlexMarkerScan() {
        clearTimeout(plexMarkerScanTimer);

        plexMarkerScanTimer = setTimeout(scanPlexMarkers, 350);
    }

    function scheduleWatchedSnapshot(delay) {
        var cache;

        if (!token() || watchedSnapshotTimer) return;

        cache = getCache();
        if (watchedSnapshotFresh(cache) || cache.watched_loading) return;

        watchedSnapshotTimer = setTimeout(function () {
            watchedSnapshotTimer = null;

            loadWatchedSnapshot(function () {
                schedulePlexMarkerScan();
            });
        }, typeof delay == 'number' ? delay : WATCHED_SNAPSHOT_DELAY);
    }

    function registerPlexMarkers() {
        scheduleWatchedSnapshot(WATCHED_SNAPSHOT_DELAY);

        if (Lampa.Listener && Lampa.Listener.follow) {
            Lampa.Listener.follow('activity', function (event) {
                if (event && (event.type == 'create' || event.type == 'start')) {
                    schedulePlexMarkerScan();
                }
            });

            Lampa.Listener.follow('state:changed', function () {
                schedulePlexMarkerScan();
            });
        }

        if (!plexMarkerInterval) plexMarkerInterval = setInterval(scanPlexMarkers, PLEX_MARKER_SCAN_INTERVAL);
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
            var actions = [];
            if (!active || !active.items || active.plexWatchlistInjected) return;

            var titleAction = Lampa.Lang.translate('title_action');
            if (active.title != titleAction) return;

            var card = focusedCardData();
            if (!card || !cardTitle(card)) return;

            active.plexWatchlistInjected = true;

            var onList = isCardWatchlisted(card);
            var targetStatus = !onList;

            actions.push({
                title: onList ? 'Удалить из ' + WATCHLIST_FROM_TITLE : 'Добавить в ' + WATCHLIST_TITLE,
                subtitle: 'Plex Discover',
                plex_watchlist_action: true,
                onSelect: function () {
                    setCardWatchlist(card, targetStatus);
                    Lampa.Controller.toggle('content');
                }
            });

            actions.push({
                title: plexRatingActionTitle(card),
                subtitle: 'Отметит просмотренным',
                plex_watchlist_rate_action: true,
                onSelect: function () {
                    Lampa.Controller.toggle('content');
                    setTimeout(function () {
                        showPlexRatingSelect(card);
                    }, 50);
                }
            });

            if (card.plex_episode_rating_key && card.plex_episode_label) {
                actions.push({
                    title: 'Отметить серию просмотренной',
                    subtitle: card.plex_episode_label,
                    plex_watchlist_episode_action: true,
                    onSelect: function () {
                        Lampa.Controller.toggle('content');
                        markSelectedEpisodeWatched(card);
                    }
                });
            }

            active.items = actions.concat(active.items);
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

        setRateButtonState(button, cachedRatingForCard(card));
        refreshRateButton(button, card);

        button.on('hover:enter', function () {
            showPlexRatingSelect(card);
        });

        bindFullButtonLast(event, button);
    }

    function setRateButtonState(button, rating) {
        var text = button.find('span').first();

        if (!text.length) {
            button.append('<span></span>');
            text = button.find('span').first();
        }

        text.text(rating ? 'Изменить оценку (' + formatPlexRating(rating) + ')' : 'Оценить на Plex');
    }

    function refreshRateButton(button, card) {
        var key;

        if (!token()) return;

        resolvePlexItem(card, function (item) {
            key = item.ratingKey;

            loadPlexRatingState(key, function (state) {
                var rating = userStateRating(state);

                setCachedRating(key, rating, {
                    scan: false
                });
                card.plex_rating = rating;
                setRateButtonState(button, rating);
            });
        });
    }

    function registerFullButtons() {
        if (!Lampa.Listener || !Lampa.Listener.follow) return;

        Lampa.Listener.follow('full', function (event) {
            if (!event || event.type != 'complite') return;

            var card = fullEventCard(event);
            var body = fullEventBody(event);

            if (!card || !cardTitle(card) || !body.length || body.data('plex-watchlist-full')) return;

            currentCard = card;
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
                setCachedRating(item.ratingKey, rating, {
                    scan: false
                });
                card.plex_rating = rating;

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

    function markSelectedEpisodeWatched(card) {
        if (!card || !card.plex_episode_rating_key) {
            notify('Не нашел выбранную серию Plex');
            return;
        }

        if (!token()) {
            notify('Укажи Plex token в настройках');
            return;
        }

        Lampa.Loading.start();

        markPlayed(card.plex_episode_rating_key, function () {
            Lampa.Loading.stop();
            notify('Серия отмечена просмотренной в Plex');
            if (Lampa.Activity && Lampa.Activity.refresh) Lampa.Activity.refresh();
        }, function () {
            Lampa.Loading.stop();
            notify('Plex: не удалось отметить серию');
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

        if (Lampa.Listener && Lampa.Listener.follow) {
            Lampa.Listener.follow('state:changed', function (event) {
                syncManualTimelineEpisode(event);
            });
        }
    }

    function syncManualTimelineEpisode(event) {
        if (!storageGet('plex_watchlist_sync_watched', true)) return;
        if (!token() || !event || event.target != 'timeline' || event.reason != 'update') return;
        if (!event.data || !event.data.road) return;

        var hash = String(event.data.hash);
        var road = event.data.road;
        var threshold = parseInt(storageGet('plex_watchlist_sync_threshold', '90'), 10) || 90;

        if ((road.percent || 0) < threshold) return;
        if (pendingSync[hash]) return;

        pendingSync[hash] = true;

        inferTimelinePlayback(hash, function (playback) {
            if (!playback || !playback.card || !playback.season || !playback.episode) {
                delete pendingSync[hash];
                return;
            }

            syncWatched(playback, function () {
                console.log('Plex Watchlist', 'manual episode mark synced', cardTitle(playback.card), playback.season, playback.episode);
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

    function inferTimelinePlayback(hash, done) {
        var playback = playbackByHash[hash] || inferCurrentPlayback(hash);
        var card;
        var info;

        if (playback && playback.card) {
            done(playback);
            return;
        }

        card = activeSeriesCard();

        if (!card) {
            done(null);
            return;
        }

        info = episodeByKnownHash(card, hash);

        if (info) {
            done({
                hash: hash,
                card: card,
                title: '',
                season: info.season,
                episode: info.episode
            });
            return;
        }

        resolveEpisodeByHash(card, hash, function (resolved) {
            done({
                hash: hash,
                card: card,
                title: '',
                season: resolved.season,
                episode: resolved.episode
            });
        }, function () {
            done(null);
        });
    }

    function activeActivityObject() {
        try {
            return Lampa.Activity && Lampa.Activity.active ? Lampa.Activity.active() : null;
        } catch (e) {}

        return null;
    }

    function activeSeriesCard() {
        var active = activeActivityObject();
        var candidates = [];

        if (active) {
            candidates.push(active.card);
            candidates.push(active.movie);
            candidates.push(active.object && active.object.card);
            candidates.push(active.object && active.object.movie);
            candidates.push(active.data && active.data.card);
            candidates.push(active.data && active.data.movie);
        }

        candidates.push(currentCard);

        for (var i = 0; i < candidates.length; i++) {
            var card = candidates[i];

            if (card && cardTitle(card) && cardType(card) == 'show') return card;
        }

        return null;
    }

    function activeSeasonHint() {
        var active = activeActivityObject();
        var values = [];

        if (active) {
            values.push(active.season);
            values.push(active.object && active.object.season);
            values.push(active.data && active.data.season);
            values.push(active.params && active.params.season);
        }

        for (var i = 0; i < values.length; i++) {
            var season = parseInt(values[i], 10);

            if (season > 0) return season;
        }

        return 0;
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

    function possibleSeasonNumbers(card) {
        var hint = activeSeasonHint();
        var max = parseInt(card && (card.number_of_seasons || card.seasons_count), 10) || 0;
        var next = card && (card.next_episode_to_air || card.last_episode_to_air) || {};
        var out = [];
        var seen = {};
        var limit;

        if (next.season_number) max = Math.max(max, parseInt(next.season_number, 10) || 0);
        if (!max) max = hint || 80;

        limit = Math.min(Math.max(max, hint || 0, 1), 120);

        function add(season) {
            season = parseInt(season, 10);

            if (season > 0 && !seen[season]) {
                seen[season] = true;
                out.push(season);
            }
        }

        add(hint);

        for (var i = 1; i <= limit; i++) add(i);

        return out;
    }

    function possibleEpisodeLimit(card) {
        var total = parseInt(card && card.number_of_episodes, 10) || 0;
        var seasons = parseInt(card && card.number_of_seasons, 10) || 0;
        var next = card && (card.next_episode_to_air || card.last_episode_to_air) || {};
        var limit = 300;

        if (seasons <= 1 && total) limit = total + 5;
        else if (seasons > 1 && total) limit = Math.ceil(total / seasons) + 60;

        if (next.episode_number) limit = Math.max(limit, parseInt(next.episode_number, 10) + 5 || 0);

        return Math.min(Math.max(limit, 300), 2000);
    }

    function episodeByKnownHash(card, hash) {
        var seasons;
        var episodeLimit;

        if (!card || !Lampa.Utils || !Lampa.Utils.hash) return null;

        seasons = possibleSeasonNumbers(card);
        episodeLimit = possibleEpisodeLimit(card);

        for (var s = 0; s < seasons.length; s++) {
            var season = seasons[s];

            for (var episode = 1; episode <= episodeLimit; episode++) {
                var variants = episodeHashVariants(card, season, episode);

                if (variants.indexOf(String(hash)) >= 0) {
                    return {
                        season: season,
                        episode: episode
                    };
                }
            }
        }

        return null;
    }

    function resolveEpisodeByHash(card, hash, success, fail) {
        var known = episodeByKnownHash(card, hash);

        if (known) {
            success(known);
            return;
        }

        if (!Lampa.TimeTable || !Lampa.TimeTable.get) {
            if (fail) fail();
            return;
        }

        Lampa.TimeTable.get(card, function (episodes) {
            var resolved = false;

            asArray(episodes).forEach(function (ep) {
                var season = ep.season_number || ep.season || 1;
                var episode = ep.episode_number || ep.episode || ep.number;
                var variants = episodeHashVariants(card, season, episode);

                if (!resolved && variants.indexOf(String(hash)) >= 0) {
                    resolved = true;
                    success({
                        season: season,
                        episode: episode
                    });
                }
            });

            if (!resolved && fail) fail();
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
        Lampa.Component.add(HISTORY_ROUTE, PlexHistoryComponent);

        if (Lampa.Router && Lampa.Router.add) {
            Lampa.Router.add(PLUGIN_ID, function (data) {
                return {
                    title: data.title || WATCHLIST_TITLE,
                    kind: data.kind || 'all',
                    page: data.page || 1
                };
            });

            Lampa.Router.add(HISTORY_ROUTE, function (data) {
                return {
                    title: data.title || 'Вы смотрели',
                    kind: data.kind || 'movie',
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

    function openWatchlist(kind, title) {
        kind = kind || 'all';
        title = title || WATCHLIST_TITLE;

        if (Lampa.Router && Lampa.Router.call) {
            Lampa.Router.call(PLUGIN_ID, {
                title: title,
                kind: kind
            });
        } else {
            Lampa.Activity.push({
                component: PLUGIN_ID,
                title: title,
                kind: kind,
                page: 1
            });
        }
    }

    function openPlexHistory(kind, title) {
        var data = {
            kind: kind || 'movie',
            title: title || 'Вы смотрели',
            page: 1
        };

        if (Lampa.Router && Lampa.Router.call) {
            Lampa.Router.call(HISTORY_ROUTE, data);
        } else {
            data.component = HISTORY_ROUTE;
            Lampa.Activity.push(data);
        }
    }

    function PlexWatchlistComponent(object) {
        var comp = new Lampa.InteractionCategory(object);
        var state = createWatchlistState();
        var kind = object.kind || 'all';
        var page = parseInt(object.page || 1, 10) || 1;
        var hasMore = true;
        var waitload = false;

        comp.render().addClass('plex-watchlist-page');

        function applyGrid() {
            comp.render().find('.category-full').addClass('mapping--grid cols--6');
        }

        function rememberPage(data) {
            page = parseInt(data && data.page || page, 10) || page;
            object.page = page;

            if (data && typeof data.has_more !== 'undefined') hasMore = !!data.has_more;
            else hasMore = !!(data && data.total_pages && page < data.total_pages);
        }

        comp.create = function () {
            loadWatchlist(page, function (data) {
                rememberPage(data);
                comp.build(data);
                applyGrid();
            }, this.empty.bind(this), kind, state, PAGE_SIZE);
        };

        comp.nextPageReuest = function (params, resolve, reject) {
            loadWatchlist(params.page || page + 1, function (data) {
                rememberPage(data);
                resolve.call(comp, data);
            }, function () {
                hasMore = false;
                reject.call(comp);
            }, kind, state, PAGE_SIZE);
        };

        comp.next = function () {
            if (waitload || !hasMore) return;

            waitload = true;

            loadWatchlist(page + 1, function (data) {
                rememberPage(data);
                comp.append(data, true);
                waitload = false;
                applyGrid();
                comp.limit();
            }, function () {
                hasMore = false;
                waitload = false;
            }, kind, state, PAGE_SIZE);
        };

        comp.cardRender = function (params, data, card) {
            card.onEnter = function () {
                openLampaCard(data);
            };
        };

        return comp;
    }

    function PlexHistoryComponent(object) {
        var comp = new Lampa.InteractionCategory(object);
        var state = createHistoryState();
        var kind = object.kind || 'movie';

        comp.create = function () {
            loadPlexHistoryCategoryPage(kind, object.page || 1, state, this.build.bind(this), this.empty.bind(this));
        };

        comp.nextPageReuest = function (params, resolve, reject) {
            loadPlexHistoryCategoryPage(kind, params.page || 1, state, resolve.bind(comp), reject.bind(comp));
        };

        comp.cardRender = function (params, data, card) {
            card.onEnter = function () {
                openLampaCard(data);
            };
        };

        return comp;
    }

    function loadWatchlistPageData(wanted, page, state, limit, success, fail) {
        if (!token()) {
            if (fail) fail();
            return;
        }

        wanted = wanted || 'all';
        state = state || createWatchlistState();
        state.queue = state.queue || [];
        state.seen = state.seen || {};

        page = parseInt(page || 1, 10) || 1;
        limit = parseInt(limit || PAGE_SIZE, 10) || PAGE_SIZE;

        var collected = [];
        var batches = 0;

        function drainQueue() {
            while (state.queue.length && collected.length < limit) {
                collected.push(state.queue.shift());
            }
        }

        function finish(hasMore) {
            hasMore = hasMore || !!state.queue.length;

            if (!collected.length) {
                if (state.done) {
                    success({
                        results: [],
                        page: page,
                        total_pages: page,
                        has_more: false
                    });
                    return;
                }

                if (fail) fail();
                return;
            }

            hydratePlexItems(collected.slice(0, limit), 'watchlist', function (cards) {
                cards.forEach(function (card) {
                    card.plex_watchlisted = true;
                    applyPlexCardDecorations(card);
                });

                rememberWatchlist(cards);
                rememberPlexCards(cards);

                success({
                    results: cards,
                    page: page,
                    total_pages: hasMore ? page + 1 : page,
                    has_more: !!hasMore
                });
            }, {
                watchlisted: true
            });
        }

        function next() {
            drainQueue();

            if (collected.length >= limit) {
                finish(!state.done || !!state.queue);
                return;
            }

            if (state.done || batches >= WATCHLIST_MAX_BATCHES) {
                finish(!state.done);
                return;
            }

            request('GET', DISCOVER + WATCHLIST_PATH, {
                includeCollections: 1,
                includeExternalMedia: 1,
                includeGuids: 1,
                includeUserState: 1,
                sort: 'watchlistedAt:desc',
                'X-Plex-Container-Start': state.start,
                'X-Plex-Container-Size': WATCHLIST_FETCH_SIZE
            }, function (data) {
                var box = mediaContainer(data);
                var plexItems = collectMetadata(data);
                var total = parseInt(box.totalSize || box.size || 0, 10) || 0;
                var picked;

                batches++;
                state.start += plexItems.length || WATCHLIST_FETCH_SIZE;
                state.done = !plexItems.length || (total > 0 && state.start >= total);

                picked = collectWatchlistItems(plexItems, wanted, state, plexItems.length || WATCHLIST_FETCH_SIZE);

                picked.forEach(function (item) {
                    state.queue.push(item);
                });

                drainQueue();

                if (collected.length >= limit || state.done || batches >= WATCHLIST_MAX_BATCHES) {
                    finish(!state.done);
                } else {
                    next();
                }
            }, function () {
                finish(false);
            });
        }

        next();
    }

    function loadWatchlist(page, success, fail, wanted, state, limit) {
        wanted = wanted || 'all';
        state = state || createWatchlistState();
        limit = limit || PAGE_SIZE;

        if (wanted == 'show') wanted = 'tv';

        if (wanted == 'tv' || wanted == 'anime') {
            loadFilteredLampaCategoryPage('watchlist', wanted, page, state, limit, createWatchlistState, function (sourcePage, sourceState, sourceLimit, onSuccess, onFail) {
                loadWatchlistPageData('show', sourcePage, sourceState, sourceLimit, onSuccess, onFail);
            }, success, fail);
            return;
        }

        loadWatchlistPageData(wanted, page, state, limit, success, fail);
    }

    function rememberWatchlist(items) {
        var cache = getCache();

        items.forEach(function (item) {
            if (item.plex_rating_key) {
                if (hasRecentWatchlistRemoval(cache, item.plex_rating_key)) return;

                cache.watchlist[item.plex_rating_key] = Date.now();
                cache.watchlist_checked[item.plex_rating_key] = Date.now();
                delete cache.watchlist_removed[item.plex_rating_key];
            }
        });

        saveCache(cache);
    }

    function attachPlexFields(target, source) {
        var hasPoster;
        var hasBackground;
        var episodeThumb;

        target = target || {};
        source = source || {};
        episodeThumb = source.plex_episode_thumb || '';
        hasPoster = !!(target.poster_path || target.poster || target.img);
        hasBackground = !!(target.backdrop_path || target.background_image);

        if (!hasPoster) {
            if (source.poster_path) target.poster_path = source.poster_path;
            if (source.poster) target.poster = source.poster;
            if (source.img) target.img = source.img;
        }

        if (!hasBackground) {
            if (source.backdrop_path) target.backdrop_path = source.backdrop_path;
            if (source.background_image) target.background_image = source.background_image;
        }

        target.plex_rating_key = source.plex_rating_key;
        target.plex_episode_rating_key = source.plex_episode_rating_key || '';
        target.plex_episode_season = source.plex_episode_season || '';
        target.plex_episode_number = source.plex_episode_number || '';
        target.plex_episode_label = source.plex_episode_label || '';
        target.plex_episode_air_date = source.plex_episode_air_date || '';
        target.plex_episode_air_date_label = source.plex_episode_air_date_label || '';
        target.plex_episode_thumb = episodeThumb;
        target.plex_row_kind = source.plex_row_kind || '';
        target.plex_watched = !!source.plex_watched;
        target.plex_watchlisted = !!source.plex_watchlisted;
        target.plex_guid = source.plex_guid || '';
        target.plex_art = source.plex_art || '';
        target.plex_title = source.plex_title || source.title || source.name || '';
        target.plex_tmdb_id = source.tmdb_id || (typeof source.id == 'number' ? source.id : '');
        target.source = target.source || 'tmdb';
        applyPlexCardDecorations(target);

        return target;
    }

    function hydrateLampaCard(card, done, options) {
        var completed = false;
        var fallbackCard = card;
        options = options || {};
        var timer = setTimeout(function () {
            finish(attachPlexFields(fallbackCard, card));
        }, LAMPA_CARD_HYDRATION_TIMEOUT);

        function finish(result) {
            if (completed) return;

            completed = true;
            clearTimeout(timer);
            done(result || card);
        }

        function useFallback(sourceCard, lampaCard) {
            rememberLampaMatch(sourceCard, lampaCard);
            finish(attachPlexFields(lampaCard, sourceCard));
        }

        function loadFull(sourceCard, lampaCard) {
            fallbackCard = lampaCard || sourceCard;

            if (options.full === false || !lampaCard || !lampaCard.id) {
                useFallback(sourceCard, lampaCard);
                return;
            }

            requestLampaFullCard(sourceCard, lampaCard, function (movie, cancelled) {
                if (cancelled) {
                    finish(sourceCard);
                    return;
                }

                if (!movie || !movie.id) {
                    useFallback(sourceCard, lampaCard);
                    return;
                }

                rememberLampaMatch(sourceCard, movie);
                finish(attachPlexFields(movie, sourceCard));
            });
        }

        var cached = cachedLampaMatch(card);

        if (cached) {
            loadFull(card, cached);
            return;
        }

        if (typeof card.id == 'number') {
            loadFull(card, card);
            return;
        }

        if (!Lampa.Api) {
            finish(card);
            return;
        }

        searchLampaCard(card, function (found) {
            if (found && found.id) loadFull(card, found);
            else finish(card);
        });
    }

    function lampaSearchParams(card) {
        var year = releaseYear(card);
        var isShow = cardType(card) == 'show';
        var titles = [
            cardTitle(card),
            card.plex_title,
            card.original_title,
            card.original_name
        ];
        var out = [];
        var seen = {};

        function add(title, mode) {
            var normalized = normalizeTitle(title);
            var params;

            if (!normalized) return;

            if (mode == 'year_text' && !year) return;

            params = {
                query: encodeURIComponent(mode == 'year_text' ? title + ' ' + year : title)
            };

            if (mode == 'filter' && year) {
                params.filter = {};
                params.filter[isShow ? 'first_air_date_year' : 'primary_release_year'] = year;
            }

            var key = JSON.stringify(params);

            if (!seen[key]) {
                seen[key] = true;
                out.push(params);
            }
        }

        titles.forEach(function (title) {
            add(title, 'filter');
        });

        titles.forEach(function (title) {
            add(title, 'year_text');
        });

        titles.forEach(function (title) {
            add(title, 'plain');
        });

        return out;
    }

    function requestLampaSearch(params, onResult, onFail) {
        try {
            if (typeof Lampa.Api.search === 'function') {
                Lampa.Api.search(params, onResult);
                return;
            }

            if (Lampa.Api.sources && Lampa.Api.sources.tmdb && typeof Lampa.Api.sources.tmdb.search === 'function') {
                Lampa.Api.sources.tmdb.search(params, onResult);
                return;
            }

            onFail();
        } catch (e) {
            console.log('Plex Watchlist', 'Lampa card search failed', e);
            onFail();
        }
    }

    function searchLampaCard(card, done) {
        var searches = lampaSearchParams(card);
        var index = 0;
        var handled = false;
        var timer = setTimeout(function () {
            finish(null);
        }, 7000);

        function finish(result) {
            if (handled) return;

            handled = true;
            clearTimeout(timer);
            done(result);
        }

        function next() {
            if (handled) return;

            if (index >= searches.length) {
                finish(null);
                return;
            }

            requestLampaSearch(searches[index++], function (data) {
                var found = pickBestLampaMatch(card, collectLampaSearchResults(data));

                if (found) finish(found);
                else next();
            }, next);
        }

        if (!searches.length || !Lampa.Api) {
            finish(null);
            return;
        }

        next();
    }

    function collectLampaSearchResults(data) {
        var out = [];

        function append(row, type) {
            if (!row || !row.results) return;

            asArray(row.results).forEach(function (item) {
                if (!item || !item.id) return;

                item.plex_lampa_type = type || row.type || '';
                out.push(item);
            });
        }

        if (Array.isArray(data)) {
            data.forEach(function (row) {
                append(row, row.type);
            });
        } else {
            append(data && data.movie, 'movie');
            append(data && data.tv, 'tv');
        }

        return out;
    }

    function pickBestLampaMatch(sourceCard, results) {
        var wantedType = cardType(sourceCard) == 'show' ? 'tv' : 'movie';
        var wantedYear = releaseYear(sourceCard);
        var strictEpisode = !!sourceCard.plex_episode_label && !wantedYear && typeof sourceCard.id != 'number';
        var wantedTitles = normalizedTitleList([
            cardTitle(sourceCard),
            sourceCard.plex_title,
            sourceCard.original_title,
            sourceCard.original_name
        ]);
        var best = null;
        var bestScore = -1;

        results.forEach(function (item) {
            var itemType = item.plex_lampa_type || (item.name || item.original_name ? 'tv' : 'movie');
            var itemYear = releaseYear(item);
            var titles = normalizedTitleList([
                item.title,
                item.name,
                item.original_title,
                item.original_name
            ]);
            var score = 0;

            if (itemType && itemType != wantedType) return;

            wantedTitles.forEach(function (wanted) {
                if (!wanted) return;

                titles.forEach(function (title) {
                    if (!title) return;

                    if (title == wanted) score += 60;
                    else if (title.indexOf(wanted) >= 0 || wanted.indexOf(title) >= 0) score += 18;
                });
            });

            if (wantedYear && itemYear) {
                var diff = Math.abs(itemYear - wantedYear);

                if (diff === 0) score += 30;
                else if (diff <= 1) score += 8;
                else if (diff > 2) score -= 35;
            }

            if (item.poster_path) score += 4;
            if (item.backdrop_path) score += 2;

            if (score > bestScore) {
                bestScore = score;
                best = item;
            }
        });

        return bestScore >= (strictEpisode ? 80 : 30) ? best : null;
    }

    function rememberLampaMatch(sourceCard, lampaCard) {
        if (!sourceCard.plex_rating_key || !lampaCard || !lampaCard.id) return;

        var cache = getCache();
        var type = cardType(sourceCard) == 'show' ? 'tv' : 'movie';
        var categoryFields = ['original_language', 'genre_ids', 'genres'];
        var previous;
        var match;
        var keys;

        cache.lampa = cache.lampa || {};
        previous = cache.lampa[sourceCard.plex_rating_key];

        match = {
            id: lampaCard.id,
            type: type,
            time: Date.now()
        };

        categoryFields.forEach(function (name) {
            var value = lampaCard[name];

            if (value === undefined && previous && previous.id == match.id && previous.type == type) {
                value = previous[name];
            }

            value = clonePlainValue(value);
            if (value !== undefined) match[name] = value;
        });

        if (previous && previous.id == lampaCard.id && previous.type == type &&
            previous.time && Date.now() - previous.time < LAMPA_MATCH_REFRESH_INTERVAL &&
            categoryFields.every(function (name) {
                return JSON.stringify(previous[name]) == JSON.stringify(match[name]);
            })) {
            return;
        }

        cache.lampa[sourceCard.plex_rating_key] = match;

        keys = Object.keys(cache.lampa);

        if (keys.length > LAMPA_CARD_CACHE_LIMIT) {
            keys.sort(function (a, b) {
                return (cache.lampa[b] && cache.lampa[b].time || 0) - (cache.lampa[a] && cache.lampa[a].time || 0);
            });

            keys.slice(LAMPA_CARD_CACHE_LIMIT).forEach(function (key) {
                delete cache.lampa[key];
            });
        }

        saveCache(cache);
    }

    function lampaFullCardKey(sourceCard, lampaCard) {
        var id = parseInt(lampaCard && lampaCard.id, 10) || 0;
        var type = cardType(sourceCard) == 'show' ? 'tv' : 'movie';

        return id ? type + ':' + id : '';
    }

    function rememberLampaFullCard(sourceCard, lampaCard, expectedScope) {
        var cache;
        var keys;
        var compact;
        var key;

        if (!lampaCard || !lampaCard.id) return;
        if (expectedScope && expectedScope !== lampaFullCardCacheScope()) return;

        compact = compactLampaCard(lampaCard);
        if (!compact.id || !cardTitle(compact)) return;

        cache = getLampaFullCardCache();
        key = lampaFullCardKey(sourceCard, compact);
        if (!key) return;

        cache.items[key] = {
            time: Date.now(),
            card: compact
        };
        keys = Object.keys(cache.items);

        if (keys.length > LAMPA_CARD_CACHE_LIMIT) {
            keys.sort(function (a, b) {
                return (cache.items[b] && cache.items[b].time || 0) - (cache.items[a] && cache.items[a].time || 0);
            });

            keys.slice(LAMPA_CARD_CACHE_LIMIT).forEach(function (key) {
                delete cache.items[key];
            });
        }

        scheduleLampaFullCardCacheSave();
    }

    function cachedLampaFullCard(sourceCard, lampaCard) {
        var cache;
        var found;
        var key = lampaFullCardKey(sourceCard, lampaCard);

        if (!key) return null;

        cache = getLampaFullCardCache();
        found = cache.items[key];

        if (!found || !found.card || !found.time) return null;

        if (Date.now() - found.time > LAMPA_FULL_CARD_CACHE_TTL) {
            delete cache.items[key];
            scheduleLampaFullCardCacheSave();
            return null;
        }

        return compactLampaCard(found.card);
    }

    function finishLampaFullCardRequest(job, movie) {
        var callbacks;
        var cancelled;

        if (!job || job.settled) return;

        job.settled = true;
        clearTimeout(job.timer);
        lampaFullCardActive = Math.max(0, lampaFullCardActive - 1);
        if (lampaFullCardRequests[job.key] === job) delete lampaFullCardRequests[job.key];

        cancelled = job.generation !== lampaFullCardGeneration || job.scope !== lampaFullCardCacheScope();
        if (cancelled) movie = null;
        if (movie && movie.id) rememberLampaFullCard(job.sourceCard, movie, job.scope);

        callbacks = job.callbacks.slice();
        callbacks.forEach(function (callback) {
            try {
                callback(movie && movie.id ? compactLampaCard(movie) : null, cancelled);
            } catch (e) {
                console.log('Plex Watchlist', 'Lampa card callback failed', e);
            }
        });

        drainLampaFullCardQueue();
    }

    function startLampaFullCardRequest(job) {
        lampaFullCardActive++;
        job.started = true;
        job.timer = setTimeout(function () {
            finishLampaFullCardRequest(job, null);
        }, LAMPA_FULL_CARD_REQUEST_TIMEOUT);

        try {
            Lampa.Api.full({
                id: job.id,
                method: job.method,
                card: job.card,
                source: 'tmdb'
            }, function (data) {
                var movie = data && data.movie ? data.movie : null;

                if (job.settled) {
                    if (movie && movie.id && job.generation === lampaFullCardGeneration &&
                        job.scope === lampaFullCardCacheScope()) {
                        rememberLampaFullCard(job.sourceCard, movie, job.scope);
                    }
                    return;
                }

                finishLampaFullCardRequest(job, movie);
            }, function () {
                finishLampaFullCardRequest(job, null);
            });
        } catch (e) {
            console.log('Plex Watchlist', 'Lampa card full failed', e);
            finishLampaFullCardRequest(job, null);
        }
    }

    function drainLampaFullCardQueue() {
        while (lampaFullCardActive < LAMPA_FULL_CARD_CONCURRENCY && lampaFullCardQueue.length) {
            startLampaFullCardRequest(lampaFullCardQueue.shift());
        }
    }

    function requestLampaFullCard(sourceCard, lampaCard, done) {
        var cached = cachedLampaFullCard(sourceCard, lampaCard);
        var cacheKey = lampaFullCardKey(sourceCard, lampaCard);
        var scope = lampaFullCardCacheScope();
        var requestKey = scope + ':' + cacheKey;
        var job;

        if (cached) {
            done(cached, false);
            return;
        }

        if (!cacheKey || !Lampa.Api || typeof Lampa.Api.full !== 'function') {
            done(null, false);
            return;
        }

        if (lampaFullCardRequests[requestKey]) {
            lampaFullCardRequests[requestKey].callbacks.push(done);
            return;
        }

        job = {
            key: requestKey,
            scope: scope,
            generation: lampaFullCardGeneration,
            sourceCard: sourceCard,
            id: parseInt(lampaCard.id, 10),
            method: cardType(sourceCard) == 'show' ? 'tv' : 'movie',
            card: compactLampaCard(lampaCard),
            callbacks: [done],
            settled: false,
            started: false,
            timer: null
        };

        lampaFullCardRequests[requestKey] = job;
        lampaFullCardQueue.push(job);
        drainLampaFullCardQueue();
    }

    function cancelLampaFullCardRequests() {
        var jobs = lampaFullCardRequests;

        lampaFullCardRequests = {};
        lampaFullCardQueue = [];
        lampaFullCardActive = 0;

        Object.keys(jobs).forEach(function (key) {
            var job = jobs[key];

            if (!job || job.settled) return;

            job.settled = true;
            clearTimeout(job.timer);

            job.callbacks.forEach(function (callback) {
                try {
                    callback(null, true);
                } catch (e) {
                    console.log('Plex Watchlist', 'Lampa card cancel callback failed', e);
                }
            });
        });
    }

    function cachedLampaMatch(card) {
        var cache = getCache();
        var found = cache.lampa && card.plex_rating_key ? cache.lampa[card.plex_rating_key] : null;
        var categoryFields = ['original_language', 'genre_ids', 'genres'];

        if (!found || !found.id) return null;

        var out = {
            id: found.id,
            title: card.title,
            original_title: card.original_title,
            release_date: card.release_date,
            poster_path: card.poster_path,
            backdrop_path: card.backdrop_path,
            poster: card.poster,
            img: card.img,
            background_image: card.background_image,
            source: 'tmdb'
        };

        if (found.type == 'tv') {
            out.name = card.name || card.title;
            out.original_name = card.original_name || card.original_title || card.title;
            out.first_air_date = card.first_air_date || card.release_date;
        }

        categoryFields.forEach(function (name) {
            var value = found[name] !== undefined ? found[name] : card[name];

            value = clonePlainValue(value);
            if (value !== undefined) out[name] = value;
        });

        if (found.type == 'tv' && (!out.original_language ||
            (out.genre_ids === undefined && out.genres === undefined))) {
            return null;
        }

        return attachPlexFields(out, card);
    }

    function hydrateLampaCards(items, done, options) {
        var out = items.slice();
        var cursor = 0;
        var active = 0;
        var finished = 0;
        var completed = false;
        var generation = lampaFullCardGeneration;

        if (!items.length) {
            done(out);
            return;
        }


        function complete(cancelled) {
            if (completed) return;

            completed = true;
            done(cancelled ? [] : out);
        }

        function next() {
            if (generation !== lampaFullCardGeneration) {
                complete(true);
                return;
            }

            if (finished >= items.length && active === 0) {
                complete();
                return;
            }

            while (active < LAMPA_CARD_CONCURRENCY && cursor < items.length) {
                (function (index) {
                    var item = items[index];

                    active++;

                    hydrateLampaCard(item, function (card) {
                        if (generation !== lampaFullCardGeneration) {
                            active--;
                            finished++;
                            complete(true);
                            return;
                        }

                        out[index] = card || item;
                        active--;
                        finished++;
                        next();
                    }, options);
                })(cursor++);
            }
        }

        next();
    }

    function historyWholeShowLabel(item, rowKind) {
        var type = normalizePlexType(item && item.type);
        var sourceType = normalizePlexType(item && item.sourceType);
        var season;
        var seasonTitle;
        var titleSeason;

        if (rowKind != 'history') return '';
        if (type == 'episode' || sourceType == 'episode' || isPlexEpisodeLike(item)) return '';

        if (type == 'season' || sourceType == 'season') {
            season = seasonValue(item);
            seasonTitle = item.seasonTitle || item.title || item.name || '';

            if (isSpecialSeason(season, seasonTitle)) return 'Specials';

            season = parseInt(season, 10) || season;

            if (season) return episodeLabel(season, '');

            titleSeason = seasonNumberFromTitle(seasonTitle);

            if (titleSeason) return episodeLabel(titleSeason, '');

            return seasonTitle || 'Season';
        }

        if (sourceType == 'show') return 'Full';

        return '';
    }

    function isSpecialSeason(season, title) {
        var normalized = normalizeTitle(title);

        if (season === 0 || season === '0') return true;
        if (!normalized) return false;

        return normalized.indexOf('special') >= 0 ||
            normalized.indexOf('спец') >= 0 ||
            normalized.indexOf('особ') >= 0 ||
            normalized.indexOf('season 0') >= 0 ||
            normalized.indexOf('сезон 0') >= 0;
    }

    function seasonValue(item) {
        var fields = [
            item && item.seasonIndex,
            item && item.index,
            item && item.parentIndex,
            item && item.season,
            item && item.seasonNumber
        ];
        var i;

        for (i = 0; i < fields.length; i++) {
            if (fields[i] !== undefined && fields[i] !== null && fields[i] !== '') return fields[i];
        }

        return '';
    }

    function seasonNumberFromTitle(title) {
        var found = (title || '').toString().match(/(?:season|сезон)\s*(\d+)/i);

        return found ? parseInt(found[1], 10) || '' : '';
    }

    function plexToLampaCard(item, rowKind) {
        var type = normalizePlexType(item.type);
        var isEpisode = type == 'episode';
        var isShow = type == 'show' || type == 'season' || isEpisode;
        var showTitle = isEpisode ? episodeShowTitle(item) : '';
        var title = isEpisode ? showTitle || item.title : item.title;
        var ratingKey = isEpisode ? item.grandparentRatingKey || item.parentRatingKey || item.ratingKey : item.ratingKey;
        var guid = isEpisode ? item.grandparentGuid || item.showGuid || '' : item.guid;
        var year = isEpisode ? episodeSeriesYear(item) : item.grandparentYear || metadataYear(item);
        var episodeYear = isEpisode ? ((episodeAirDate(item) || '').match(/\d{4}/) || [''])[0] : '';
        var episodeThumb = isEpisode ? episodeStillImage(item) : '';
        var thumb = isEpisode ? item.grandparentThumb || item.parentThumb || item.thumb : item.thumb;
        var art = isEpisode ? item.grandparentArt || item.parentArt || item.art : item.art;

        if (isEpisode && episodeYear && year == episodeYear && !episodeSeriesYear(item)) year = '';

        var card = {
            id: 'plex_' + (ratingKey || item.ratingKey || item.id || Date.now()),
            title: title,
            original_title: title,
            release_date: isEpisode ? (year ? year + '-01-01' : '') : item.originallyAvailableAt || (year ? year + '-01-01' : ''),
            poster: thumb,
            img: thumb,
            background_image: art || '',
            plex_art: art,
            plex_guid: guid,
            plex_rating_key: ratingKey || item.ratingKey,
            plex_row_kind: rowKind || '',
            plex_title: title,
            source: 'tmdb',
            year: year,
            plex_watched: metadataWatched(item),
            plex_rating: metadataUserRating(item),
            plex_watchlisted: metadataWatchlisted(item)
        };

        if (isEpisode && rowKind == 'history' && episodeThumb) card.plex_episode_thumb = episodeThumb;

        if (isShow) {
            card.name = title;
            card.original_name = title;
            card.first_air_date = card.release_date;
        }

        if (isEpisode) attachEpisodeFields(card, item);
        else {
            var historyLabel = historyWholeShowLabel(item, rowKind);
            if (historyLabel) card.plex_episode_label = historyLabel;
        }

        attachTmdbIdFromGuids(card, item);
        applyPlexCardDecorations(card);

        return card;
    }

    function attachTmdbIdFromGuids(card, item) {
        var guids = [];
        var episodeCard = !!(card && card.plex_episode_label);

        if (card && card.plex_guid) guids.push(card.plex_guid);

        if (episodeCard && !card.plex_guid) return;

        if (!episodeCard) {
            metadataGuidList(item).forEach(function (guid) {
                guids.push(guid);
            });
            if (item.parentGuid) guids.push(item.parentGuid);
        } else {
            asArray(item.grandparentGuidList).forEach(function (guid) {
                guids.push(guid);
            });
        }

        if (item.grandparentGuid) guids.push(item.grandparentGuid);
        if (item.primaryGuid) guids.push(item.primaryGuid);

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

    function clearPlexCaches() {
        cancelPlexRowWork();
        plexDeferredPages.slice().forEach(destroyDeferredPlexPage);
        watchedSnapshotGeneration++;
        lampaFullCardGeneration++;
        cancelLampaFullCardRequests();

        if (watchedSnapshotTimer) {
            clearTimeout(watchedSnapshotTimer);
            watchedSnapshotTimer = null;
        }

        if (lampaFullCardCacheSaveTimer) {
            clearTimeout(lampaFullCardCacheSaveTimer);
            lampaFullCardCacheSaveTimer = null;
        }

        lampaFullCardCacheMemory = null;

        Lampa.Storage.set(CACHE_KEY, {});
        Lampa.Storage.set(LEGACY_ROW_CACHE_KEY, {});
        Lampa.Storage.set(ROW_CACHE_KEY, {});
        Lampa.Storage.set(LAMPA_FULL_CARD_CACHE_KEY, {});
    }

    function logoutPlex() {
        Lampa.Storage.set('plex_watchlist_token', '');
        clearPlexCaches();
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
                clearPlexCaches();
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
