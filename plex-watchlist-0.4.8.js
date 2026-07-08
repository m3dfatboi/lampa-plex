(function () {
    'use strict';

    var PLUGIN_ID = 'plex_watchlist';
    var VERSION = '0.4.8';
    var WATCHLIST_TITLE = 'Очередь';
    var WATCHLIST_FROM_TITLE = 'Очереди';
    var PLEX = 'https://plex.tv';
    var DISCOVER = 'https://discover.provider.plex.tv';
    var DISCOVER_IDENTIFIER = 'tv.plex.provider.discover';
    var METADATA = 'https://metadata.provider.plex.tv';
    var COMMUNITY = 'https://community.plex.tv';
    var WATCHLIST_PATH = '/library/sections/watchlist/all';
    var CACHE_KEY = 'plex_watchlist_cache';
    var CACHE_SCHEMA = 7;
    var CLIENT_ID_KEY = 'plex_watchlist_client_id';
    var PAGE_SIZE = 20;
    var PLEX_ROW_SIZE = 24;
    var WATCHED_SNAPSHOT_SIZE = 100;
    var WATCHED_SNAPSHOT_TTL = 2 * 60 * 1000;
    var PLEX_STATE_TTL = 45 * 1000;
    var LAMPA_CARD_CONCURRENCY = 4;
    var AUTH_POLL_INTERVAL = 3000;
    var AUTH_TIMEOUT = 15 * 60 * 1000;
    var PROFILE_PARENT_FIELDS = 'fragment parentFields on MetadataItem { index title publishedAt key type images { coverArt coverPoster thumbnail art } userState @skip(if: $skipUserState) { viewCount viewedLeafCount watchlistedAt } }';
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
        registerShotsHider();

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
            cache.lampa = {};
            cache.watched = {};
            cache.watched_checked = {};
            cache.ratings = {};
            cache.ratings_checked = {};
            cache.state_checked = {};
            cache.state_loading = {};
            cache.watched_loaded = 0;
            cache.watched_loading = false;
            cache.schema = CACHE_SCHEMA;
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
        var show = isEpisode && meta.grandparent ? meta.grandparent : meta;
        var parent = isEpisode ? meta.parent || {} : {};
        var images = show.images || meta.images || {};
        var item = {
            ratingKey: isEpisode ? metadataRatingKey(meta) : metadataRatingKey(show),
            guid: show.guid || meta.guid || '',
            type: isEpisode ? 'episode' : (type == 'season' ? 'show' : type),
            title: isEpisode ? show.title || meta.title : meta.title,
            year: show.year || meta.year || '',
            originallyAvailableAt: show.originallyAvailableAt || show.publishedAt || meta.originallyAvailableAt || meta.publishedAt || '',
            thumb: graphImage(images, 'coverPoster') || graphImage(meta.images, 'coverPoster'),
            art: graphImage(images, 'art') || graphImage(meta.images, 'art'),
            key: isEpisode ? meta.key || show.key : show.key || meta.key || '',
            UserState: isEpisode ? meta.userState || show.userState || {} : show.userState || meta.userState || {}
        };

        if (isEpisode) {
            item.grandparentTitle = show.title || meta.grandparentTitle || '';
            item.grandparentRatingKey = metadataRatingKey(show);
            item.grandparentThumb = graphImage(show.images, 'coverPoster');
            item.grandparentArt = graphImage(show.images, 'art');
            item.parentTitle = parent.title || '';
            item.parentIndex = parent.index || meta.parentIndex || '';
            item.index = meta.index || '';
        }

        if (entry && entry.date) item.viewedAt = entry.date;

        return item;
    }

    function cardType(card) {
        return card && (card.name || card.original_name || card.media_type == 'tv' || card.type == 'show') ? 'show' : 'movie';
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

    function isCardWatchlisted(card) {
        var direct = plexItemFromCard(card);
        var cached = getCache().items[cardKey(card)];

        if (direct && direct.ratingKey) {
            if (card.plex_watchlisted) return true;
            if (isCachedWatchlistRemoved(direct.ratingKey)) return false;
            return isCachedWatchlisted(direct.ratingKey);
        }

        return !!(cached && cached.ratingKey && isCachedWatchlisted(cached.ratingKey));
    }

    function isCardWatched(card) {
        var cache = getCache();
        var direct = plexItemFromCard(card);
        var cached = cache.items[cardKey(card)];

        if (card && card.plex_watched) return true;
        if (direct && direct.ratingKey && cache.watched[direct.ratingKey]) return true;

        return !!(cached && cached.ratingKey && cache.watched[cached.ratingKey]);
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

        hydrateLampaCards(cards, function (hydrated) {
            hydrated.forEach(function (card) {
                card.plex_watched = true;
                applyPlexCardDecorations(card);
            });

            rememberPlexCards(hydrated);
        });
    }

    function loadWatchedSnapshot(done) {
        var cache;

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
            rememberWatchedItems(items);
            done();
        }, function () {
            cache = getCache();
            cache.watched_loading = false;
            cache.watched_loaded = Date.now();
            saveCache(cache);
            done();
        }, {
            first: WATCHED_SNAPSHOT_SIZE
        });
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

    function registerStyles() {
        var styleId = PLUGIN_ID + '_styles';
        var css = [
            '.plex-watchlist-page .category-full .card{',
            'margin-bottom:1em;',
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
            '.plex-watchlist-hidden-row{',
            'display:none!important;',
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

    function safeContentRow(loader) {
        return function (call) {
            var completed = false;
            var timer = setTimeout(function () {
                finish();
            }, 25000);

            function finish(row) {
                if (completed) return;

                completed = true;
                clearTimeout(timer);
                call(row);
            }

            try {
                loader(finish);
            } catch (e) {
                console.log('Plex Watchlist', 'content row failed', e);
                finish();
            }
        };
    }

    function registerPlexRows() {
        if (plexRowsRegistered || !Lampa.ContentRows || !Lampa.ContentRows.add) return;

        plexRowsRegistered = true;
        disableNativeRows();

        Lampa.ContentRows.add({
            name: 'plex_continue_watch',
            title: 'Продолжить просмотр',
            index: 1,
            screen: ['main', 'category'],
            call: function (params, screen) {
                if (!token()) return;
                if (screen == 'category' && params.url == 'movie') return;
                if (screen == 'category' && params.url && params.url != 'tv' && params.url != 'anime') return;

                return safeContentRow(function (call) {
                    loadPlexContinueWatching(function (cards) {
                        call(makePlexRow('Продолжить просмотр', cards));
                    }, function () {
                        call();
                    });
                });
            }
        });

        Lampa.ContentRows.add({
            name: 'plex_recent_episodes',
            title: 'Новые эпизоды',
            index: 3,
            screen: ['main', 'category'],
            call: function (params, screen) {
                if (!token()) return;
                if (screen == 'category' && params.url == 'movie') return;
                if (screen == 'category' && params.url && params.url != 'tv' && params.url != 'anime') return;

                return safeContentRow(function (call) {
                    loadPlexRecentlyAired(function (cards) {
                        call(makePlexRow('Новые эпизоды', cards));
                    }, function () {
                        call();
                    });
                });
            }
        });

        Lampa.ContentRows.add({
            name: 'plex_watchlist_row',
            title: WATCHLIST_TITLE,
            index: 2,
            screen: ['main'],
            call: function () {
                if (!token()) return;

                return safeContentRow(function (call) {
                    loadPlexWatchlistRow(function (cards) {
                        call(makePlexRow(WATCHLIST_TITLE, cards));
                    }, function () {
                        call();
                    });
                });
            }
        });

        Lampa.ContentRows.add({
            name: 'plex_movie_history',
            title: 'Вы смотрели',
            index: 1,
            screen: ['category'],
            call: function (params) {
                if (!token() || params.url != 'movie') return;

                return safeContentRow(function (call) {
                    loadPlexMovieHistory(function (cards) {
                        call(makePlexRow('Вы смотрели', cards));
                    }, function () {
                        call();
                    });
                });
            }
        });
    }

    function makePlexRow(title, cards) {
        if (!cards || !cards.length) return;

        return {
            title: title,
            results: cards
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
                    success(found.items);
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

                if (found.items.length) success(found.items);
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

    function loadPlexRecentlyAired(success, fail) {
        var hydrate = function (items) {
            hydratePlexEpisodeItems(items, 'recent_episodes', success, function () {
                loadPlexRecentlyAiredFallback(success, fail);
            }, {
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
            loadPlexRecentlyAiredFallback(success, fail);
        }, {
            identifier: 'watchlist.recentlyAiredEpisodes,watchlist.recentlyAired,watchlist.recentEpisodes,home.television.recent,home.ondeck',
            identifierFirst: true
        });
    }

    function loadPlexRecentlyAiredFallback(success, fail) {
        loadHubItems([
            'home.ondeck',
            'on deck',
            'recent episodes',
            'new episodes',
            'continue watching'
        ], function (items) {
            hydratePlexEpisodeItems(items, 'recent_episodes', success, fail, {
                watchlisted: true
            });
        }, fail, {
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
            if (cards && cards.length) success(cards);
            else if (fail) fail();
        }, {
            enrichEpisodes: true,
            watchlisted: !!options.watchlisted
        });
    }

    function loadPlexWatchlistRow(success, fail) {
        loadWatchlist(1, function (data) {
            var cards = data && data.results ? data.results.slice(0, PLEX_ROW_SIZE) : [];

            if (cards.length) success(cards);
            else if (fail) fail();
        }, fail);
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

        function requestHistory(uuid, canRetryEmpty) {
            graphQL(PROFILE_WATCH_HISTORY_QUERY, {
                uuid: uuid || '',
                first: first,
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
            var items = [];

            nodes.forEach(function (node) {
                var item = graphMetadataToPlexItem(node.metadataItem, node);
                if (item) items.push(item);
            });

            if (items.length) success(items);
            else if (uuid && canRetryEmpty) requestHistory('', false);
            else if (fail) fail();
        }

        loadPlexAccountId(function (id) {
            requestHistory(id, true);
        }, function () {
            requestHistory('', false);
        });
    }

    function loadPlexMovieHistory(success, fail) {
        loadProfileWatchHistory(function (items) {
            var movies = items.filter(function (item) {
                return normalizePlexType(item.type) == 'movie';
            }).slice(0, PLEX_ROW_SIZE);

            if (!movies.length) {
                loadPlexMovieHistoryFallback(success, fail);
                return;
            }

            hydratePlexItems(movies, 'history', success, {
                watched: true
            });
        }, function () {
            loadPlexMovieHistoryFallback(success, fail);
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

    function episodeShowTitle(item) {
        item = item || {};

        return item.grandparentTitle || item.showTitle || item.seriesTitle || item.grandparentName || item.grandparent && item.grandparent.title || '';
    }

    function isPlexEpisodeLike(item) {
        return normalizePlexType(item && item.type) == 'episode' || !!(item && (item.grandparentTitle || item.parentIndex || item.episodeNumber));
    }

    function episodeAirDate(item) {
        item = item || {};

        return item.episodeOriginallyAvailableAt || item.airDate || item.originallyAvailableAt || item.publishedAt || item.originallyAvailable || '';
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

    function hydratePlexItems(items, rowKind, success, options) {
        options = options || {};

        preparePlexItems(items, options, function (prepared) {
            var cards = [];

            prepared.forEach(function (item) {
                var card = plexToLampaCard(item);

                if (!card || !cardTitle(card)) return;

                card.plex_row_kind = rowKind;
                card.plex_watched = options.watched || metadataWatched(item);
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

        var oldCreate = existing.onCreate;
        var emit = {};

        for (var key in existing) {
            if (existing.hasOwnProperty(key)) emit[key] = existing[key];
        }

        emit.onCreate = function () {
            if (typeof oldCreate == 'function') oldCreate.apply(this, arguments);
            decorateCreatedCard(this.html, this.data || card);
        };
        emit.plexWatchlistDecorated = true;

        card.params.emit = emit;

        return card;
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

        if (isCardWatchlisted(card) || card.plex_watchlisted) addCardIcon(element, 'wath');
        if (isCardWatched(card) || card.plex_watched) addCardIcon(element, 'history');
        if (card.plex_episode_label) addEpisodeBadge(element, card.plex_episode_label);
        if (card.plex_episode_air_date_label) addEpisodeAirDate(element, card.plex_episode_air_date_label);
        refreshVisiblePlexState(element, card);
    }

    function addCardIcon(element, name) {
        var inner = element.querySelector('.card__icons-inner');

        if (!inner) return;
        if (inner.querySelector('.icon--' + name)) return;

        var icon = document.createElement('div');

        icon.className = 'card__icon icon--' + name + ' plex-watchlist-icon plex-watchlist-icon--' + name;
        inner.appendChild(icon);
    }

    function removeCardIcon(element, name) {
        var icon = element && element.querySelector ? element.querySelector('.card__icons-inner .icon--' + name) : null;

        if (icon && icon.parentNode) icon.parentNode.removeChild(icon);
    }

    function updateWatchedIcon(element, card, watched) {
        card.plex_watched = !!watched;

        if (watched) addCardIcon(element, 'history');
        else removeCardIcon(element, 'history');
    }

    function refreshVisiblePlexState(element, card) {
        var key;
        var cache;

        if (!token() || !card || !element) return;

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

            updateWatchedIcon(element, card, sync.watched);
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
            loadWatchedSnapshot(function () {
                schedulePlexMarkerScan();
            });
        }

        Array.prototype.forEach.call(nodes, function (node) {
            if (node.card_data) decorateCreatedCard(node, node.card_data);
        });
    }

    function schedulePlexMarkerScan() {
        clearTimeout(plexMarkerScanTimer);

        plexMarkerScanTimer = setTimeout(scanPlexMarkers, 350);
    }

    function resetPlexStateThrottle() {
        var cache = getCache();

        cache.state_checked = {};
        saveCache(cache);
    }

    function registerPlexMarkers() {
        loadWatchedSnapshot(function () {
            schedulePlexMarkerScan();
        });

        if (Lampa.Listener && Lampa.Listener.follow) {
            Lampa.Listener.follow('activity', function (event) {
                if (event && (event.type == 'create' || event.type == 'start')) {
                    resetPlexStateThrottle();
                    schedulePlexMarkerScan();
                }
            });

            Lampa.Listener.follow('state:changed', function () {
                schedulePlexMarkerScan();
            });
        }

        if (!plexMarkerInterval) plexMarkerInterval = setInterval(scanPlexMarkers, 3000);
    }

    function hideShotsRows() {
        var rows = document.querySelectorAll('.items-line');

        Array.prototype.forEach.call(rows, function (row) {
            var title = row.querySelector('.items-line__title');
            var text = title ? (title.textContent || '').trim().toLowerCase() : '';

            if (text == 'shots') row.classList.add('plex-watchlist-hidden-row');
        });
    }

    function scheduleShotsHide() {
        setTimeout(hideShotsRows, 300);
        setTimeout(hideShotsRows, 1200);
    }

    function registerShotsHider() {
        scheduleShotsHide();

        if (Lampa.Listener && Lampa.Listener.follow) {
            Lampa.Listener.follow('activity', function (event) {
                if (event && (event.type == 'create' || event.type == 'start')) scheduleShotsHide();
            });

            Lampa.Listener.follow('state:changed', scheduleShotsHide);
        }

        setInterval(hideShotsRows, 3000);
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

        comp.render().addClass('plex-watchlist-page');

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
            includeGuids: 1,
            includeUserState: 1,
            sort: 'watchlistedAt:desc',
            'X-Plex-Container-Start': (page - 1) * PAGE_SIZE,
            'X-Plex-Container-Size': PAGE_SIZE
        }, function (data) {
            var box = mediaContainer(data);
            var plexItems = collectMetadata(data);
            var items = plexItems.map(function (item) {
                var card = plexToLampaCard(item);

                card.plex_watchlisted = true;
                applyPlexCardDecorations(card);

                return card;
            });
            var total = parseInt(box.totalSize || box.size || items.length, 10) || items.length;

            rememberWatchlist(items);
            rememberPlexCards(items);

            if (!items.length) {
                if (fail) fail();
                return;
            }

            hydrateLampaCards(items, function (cards) {
                cards.forEach(function (card) {
                    card.plex_watchlisted = true;
                    applyPlexCardDecorations(card);
                });
                rememberWatchlist(cards);
                rememberPlexCards(cards);

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
        target.plex_episode_rating_key = source.plex_episode_rating_key || '';
        target.plex_episode_season = source.plex_episode_season || '';
        target.plex_episode_number = source.plex_episode_number || '';
        target.plex_episode_label = source.plex_episode_label || '';
        target.plex_episode_air_date = source.plex_episode_air_date || '';
        target.plex_episode_air_date_label = source.plex_episode_air_date_label || '';
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

    function hydrateLampaCard(card, done) {
        var completed = false;
        var timer = setTimeout(function () {
            finish(card);
        }, 9000);

        function finish(result) {
            if (completed) return;

            completed = true;
            clearTimeout(timer);
            done(result || card);
        }

        function loadFull(sourceCard, lampaCard) {
            if (!Lampa.Api || typeof Lampa.Api.full !== 'function' || typeof lampaCard.id != 'number') {
                rememberLampaMatch(sourceCard, lampaCard);
                finish(attachPlexFields(lampaCard, sourceCard));
                return;
            }

            try {
                Lampa.Api.full({
                    id: lampaCard.id,
                    method: cardType(sourceCard) == 'show' ? 'tv' : 'movie',
                    card: lampaCard,
                    source: 'tmdb'
                }, function (data) {
                    var movie = data && data.movie ? data.movie : null;

                    if (!movie || !movie.id) {
                        rememberLampaMatch(sourceCard, lampaCard);
                        finish(attachPlexFields(lampaCard, sourceCard));
                        return;
                    }

                    rememberLampaMatch(sourceCard, movie);
                    finish(attachPlexFields(movie, sourceCard));
                }, function () {
                    rememberLampaMatch(sourceCard, lampaCard);
                    finish(attachPlexFields(lampaCard, sourceCard));
                });
            } catch (e) {
                console.log('Plex Watchlist', 'Lampa card full failed', e);
                rememberLampaMatch(sourceCard, lampaCard);
                finish(attachPlexFields(lampaCard, sourceCard));
            }
        }

        if (!Lampa.Api) {
            finish(card);
            return;
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

        cache.lampa = cache.lampa || {};
        cache.lampa[sourceCard.plex_rating_key] = {
            id: lampaCard.id,
            type: cardType(sourceCard) == 'show' ? 'tv' : 'movie'
        };

        saveCache(cache);
    }

    function cachedLampaMatch(card) {
        var cache = getCache();
        var found = cache.lampa && card.plex_rating_key ? cache.lampa[card.plex_rating_key] : null;

        if (!found || !found.id) return null;

        var out = {
            id: found.id,
            title: card.title,
            original_title: card.original_title,
            release_date: card.release_date,
            source: 'tmdb'
        };

        if (found.type == 'tv') {
            out.name = card.name || card.title;
            out.original_name = card.original_name || card.original_title || card.title;
            out.first_air_date = card.first_air_date || card.release_date;
        }

        return attachPlexFields(out, card);
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
        var type = normalizePlexType(item.type);
        var isEpisode = type == 'episode';
        var isShow = type == 'show' || type == 'season' || isEpisode;
        var showTitle = isEpisode ? episodeShowTitle(item) : '';
        var title = isEpisode ? showTitle || item.title : item.title;
        var ratingKey = isEpisode ? item.grandparentRatingKey || item.parentRatingKey || item.ratingKey : item.ratingKey;
        var guid = isEpisode ? item.grandparentGuid || item.showGuid || '' : item.guid;
        var year = isEpisode ? episodeSeriesYear(item) : item.grandparentYear || metadataYear(item);
        var episodeYear = isEpisode ? ((episodeAirDate(item) || '').match(/\d{4}/) || [''])[0] : '';
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
            plex_title: title,
            source: 'tmdb',
            year: year,
            plex_watched: metadataWatched(item),
            plex_rating: metadataUserRating(item),
            plex_watchlisted: metadataWatchlisted(item)
        };

        if (isShow) {
            card.name = title;
            card.original_name = title;
            card.first_air_date = card.release_date;
        }

        if (isEpisode) attachEpisodeFields(card, item);

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
