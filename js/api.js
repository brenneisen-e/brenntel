/* ========================================
   WordPress Content Extractor
   brenntel mediadesign GbR
   ======================================== */

(function () {
  'use strict';

  // ==========================================
  // State
  // ==========================================
  const state = {
    siteUrl: '',
    apiRoot: '',
    authUrl: '',
    hasAppPasswords: false,
    isAuthenticated: false,
    username: '',
    password: '',
    siteName: '',
    siteDescription: '',
    wpVersion: '',
    extractedData: {},
    counts: {},
    // Keys of CPTs that were added dynamically after discovery.
    // Tracked so we can clean them up on disconnect/re-discover.
    discoveredCptKeys: [],
  };

  // ==========================================
  // DOM references
  // ==========================================
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ==========================================
  // Utility
  // ==========================================
  function normalizeUrl(input) {
    let url = input.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    return url;
  }

  function basicAuthHeader(user, pass) {
    return 'Basic ' + btoa(user + ':' + pass);
  }

  /**
   * Route a request through our Cloudflare Pages Function proxy
   * to avoid CORS issues with arbitrary WordPress sites.
   */
  function proxiedFetch(targetUrl, opts) {
    const proxyUrl = '/wp-proxy?url=' + encodeURIComponent(targetUrl);
    return fetch(proxyUrl, opts);
  }

  async function wpFetch(endpoint, auth) {
    let url;
    if (endpoint.startsWith('http')) {
      url = endpoint;
    } else {
      // Avoid double slashes when joining apiRoot and endpoint
      const root = state.apiRoot.replace(/\/+$/, '');
      const path = endpoint.startsWith('/') ? endpoint : '/' + endpoint;
      url = root + path;
    }
    const opts = { headers: {} };
    if (auth && state.isAuthenticated) {
      opts.headers['Authorization'] = basicAuthHeader(state.username, state.password);
    }
    const res = await proxiedFetch(url, opts);
    if (!res.ok) {
      // Try to surface the WordPress error body so logs aren't just "401"
      let detail = '';
      try {
        const body = await res.clone().text();
        if (body) {
          try {
            const parsed = JSON.parse(body);
            if (parsed && parsed.code) {
              detail = ' — WP:' + parsed.code + (parsed.message ? ' "' + String(parsed.message).replace(/<[^>]+>/g, '').slice(0, 160) + '"' : '');
            } else {
              detail = ' — ' + body.slice(0, 160).replace(/\s+/g, ' ');
            }
          } catch (_) {
            detail = ' — ' + body.slice(0, 160).replace(/\s+/g, ' ');
          }
        }
      } catch (_) { /* ignore body read errors */ }
      throw new Error('HTTP ' + res.status + ' ' + res.statusText + ' [' + url + ']' + detail);
    }
    return res;
  }

  // ==========================================
  // Discovery
  // ==========================================
  async function discoverSite(inputUrl) {
    const base = normalizeUrl(inputUrl);
    state.siteUrl = base;

    // Try standard /wp-json/ first, then ?rest_route=/
    const attempts = [
      base + '/wp-json/',
      base + '/?rest_route=/',
    ];

    let data = null;
    let apiRoot = '';

    for (const url of attempts) {
      try {
        const res = await proxiedFetch(url, { signal: AbortSignal.timeout(15000) });
        if (res.ok) {
          data = await res.json();
          apiRoot = url.replace(/\?rest_route=\/$/, '?rest_route=');
          if (url.endsWith('/wp-json/')) apiRoot = url;
          break;
        }
      } catch (_) { /* try next */ }
    }

    if (!data) throw new Error('WordPress REST API nicht erreichbar. Prüfen Sie die URL und ob die REST API aktiviert ist.');

    state.apiRoot = apiRoot;
    state.siteName = data.name || base;
    state.siteDescription = data.description || '';
    state.wpVersion = '';

    // Detect Application Passwords support
    if (data.authentication && data.authentication['application-passwords']) {
      const authEndpoints = data.authentication['application-passwords'].endpoints;
      if (authEndpoints && authEndpoints.authorization) {
        state.authUrl = authEndpoints.authorization;
        state.hasAppPasswords = true;
      }
    }

    // Try to get WP version from namespaces
    if (data.namespaces) {
      if (data.namespaces.includes('wp/v2')) state.wpVersion = '4.7+';
    }

    // Discover custom post types via /wp/v2/types so CPTs like
    // "portfolio" or FSE artefacts (wp_block, wp_template, ...) can
    // be extracted even though they aren't hardcoded in CONTENT_TYPES.
    // Uses wpFetch so both /wp-json/ and ?rest_route=/ roots work.
    let discoveredCpts = [];
    try {
      const typesRes = await wpFetch('/wp/v2/types', false);
      if (typesRes.ok) {
        const typesData = await typesRes.json();
        discoveredCpts = augmentContentTypesFromDiscovery(typesData);
      }
    } catch (_) { /* CPT discovery is best-effort */ }

    return {
      name: state.siteName,
      description: state.siteDescription,
      hasAppPasswords: state.hasAppPasswords,
      version: state.wpVersion,
      namespaces: data.namespaces || [],
      discoveredCpts: discoveredCpts,
    };
  }

  // ==========================================
  // CPT auto-discovery — merge /wp/v2/types result into CONTENT_TYPES
  // ==========================================
  /**
   * Given the JSON response from /wp/v2/types, add any post type that
   * isn't already known to the hardcoded CONTENT_TYPES list. Returns
   * the list of newly added CPT descriptors for UI rendering.
   *
   * Skipped:
   *  - Post types whose rest_base collides with an already-registered
   *    entry (post, page, attachment) to avoid duplicates.
   *  - Types whose rest_base contains a regex placeholder (e.g. the
   *    nested wp_font_face → "font-families/(?P<font_family_id>[\\d]+)/font-faces"),
   *    because they are sub-resources and not directly listable.
   */
  function augmentContentTypesFromDiscovery(typesData) {
    if (!typesData || typeof typesData !== 'object') return [];

    // First, clear any previously discovered CPTs so repeated discovery
    // (after disconnect / different site) doesn't leak stale entries.
    state.discoveredCptKeys.forEach(function (k) {
      delete CONTENT_TYPES[k];
    });
    state.discoveredCptKeys = [];

    // Rest bases already owned by the hardcoded list.
    const reservedRestBases = { posts: 1, pages: 1, media: 1 };

    // Post types whose rest_base is NOT a listable collection in core
    // WordPress and therefore cannot be extracted with the generic
    // `/wp/v2/<rest_base>?per_page=N` loop. `wp_global_styles` is the
    // classic example: it only exposes per-id / per-theme singletons
    // at /wp/v2/global-styles/<id> and returns 404 for a list request.
    const nonListableSlugs = { wp_global_styles: 1 };

    const added = [];

    Object.keys(typesData).forEach(function (slug) {
      const t = typesData[slug];
      if (!t || !t.rest_base) return;

      const restBase = String(t.rest_base);
      // Skip collisions with hardcoded list
      if (reservedRestBases[restBase]) return;
      // Skip sub-resource templated routes
      if (restBase.indexOf('(?P<') !== -1) return;
      // Skip types we know aren't listable via the generic endpoint
      if (nonListableSlugs[slug]) return;

      // Heuristic for auth requirement:
      //  - Core-internal types (prefix "wp_") and nav_menu_item tend to
      //    require edit capabilities even for read access.
      //  - User-defined CPTs (e.g. portfolio) are normally public.
      const needsAuth = /^wp_/.test(slug) || slug === 'nav_menu_item';

      // Key we use internally — use slug as-is (portfolio, wp_block, ...)
      // so counts and checkboxes are keyed consistently.
      const key = slug;
      if (CONTENT_TYPES[key]) return; // already present (safety)

      CONTENT_TYPES[key] = {
        endpoint: '/wp/v2/' + restBase,
        label: (t.name || slug),
        auth: needsAuth,
        perPage: 100,
        discovered: true,
        restBase: restBase,
      };
      state.discoveredCptKeys.push(key);

      added.push({
        key: key,
        slug: slug,
        label: (t.name || slug),
        restBase: restBase,
        needsAuth: needsAuth,
        // Non-wp_ types are real user content → check by default.
        defaultChecked: !needsAuth,
      });
    });

    return added;
  }

  // ==========================================
  // Diagnostics — probe every endpoint and log results
  // ==========================================
  async function runDiagnostics(userUrl, append) {
    const base = normalizeUrl(userUrl);
    const now = new Date().toISOString();
    append('=== WordPress REST API Diagnose ===');
    append('Zeit:   ' + now);
    append('Ziel:   ' + base);
    append('Proxy:  /wp-proxy (Cloudflare Pages Function)');
    append('Hinweis: alle Requests laufen durch unseren CORS-Proxy.');
    append('');

    async function probe(label, targetUrl, summarise) {
      const started = Date.now();
      let res, rawBody = '', parsed = null, errMsg = null;
      try {
        res = await proxiedFetch(targetUrl);
        try { rawBody = await res.text(); } catch (_) { rawBody = ''; }
        try { parsed = JSON.parse(rawBody); } catch (_) { parsed = null; }
      } catch (err) {
        errMsg = err && err.message ? err.message : String(err);
      }
      const elapsed = Date.now() - started;

      append('[' + label + '] ' + targetUrl);
      if (errMsg) {
        append('  -> NETWORK ERROR: ' + errMsg + '  (' + elapsed + 'ms)');
        append('');
        return { ok: false, error: errMsg };
      }

      const ct = res.headers.get('Content-Type') || '(none)';
      append('  -> HTTP ' + res.status + ' ' + res.statusText + '  (' + elapsed + 'ms)');
      append('  -> Content-Type: ' + ct);

      const xwpTotal = res.headers.get('X-WP-Total');
      const xwpPages = res.headers.get('X-WP-TotalPages');
      if (xwpTotal) append('  -> X-WP-Total: ' + xwpTotal + (xwpPages ? ' (Pages: ' + xwpPages + ')' : ''));

      if (parsed && parsed.code && parsed.message) {
        // WordPress REST error object
        append('  -> WP-Error code:    ' + parsed.code);
        append('  -> WP-Error message: ' + String(parsed.message).replace(/<[^>]+>/g, '').slice(0, 240));
        if (parsed.data && parsed.data.status) append('  -> WP-Error status:  ' + parsed.data.status);
      } else if (parsed && typeof summarise === 'function') {
        try {
          const summary = summarise(parsed);
          if (summary) {
            String(summary).split('\n').forEach(function (ln) { append('  -> ' + ln); });
          }
        } catch (_) { /* ignore summariser errors */ }
      } else if (!parsed) {
        // Non-JSON body — likely an HTML error page (WAF, Cloudflare, login wall, ...)
        const snippet = rawBody.slice(0, 240).replace(/\s+/g, ' ').trim();
        if (snippet) append('  -> Body (non-JSON, 240 chars): ' + snippet);
        append('  -> (Antwort ist kein JSON — möglicherweise WAF / Security-Plugin / Login-Wall)');
      }
      append('');
      return { ok: res.ok, status: res.status, body: parsed, raw: rawBody };
    }

    // 1. REST API root
    const rootResult = await probe('ROOT', base + '/wp-json/', function (body) {
      const parts = [];
      parts.push('name: "' + (body.name || '') + '"');
      if (body.description) parts.push('description: "' + String(body.description).slice(0, 80) + '"');
      if (body.url) parts.push('url: ' + body.url);
      if (body.home) parts.push('home: ' + body.home);
      if (body.gmt_offset !== undefined) parts.push('gmt_offset: ' + body.gmt_offset);
      if (body.authentication && body.authentication['application-passwords']) {
        const auth = body.authentication['application-passwords'];
        parts.push('app-passwords: YES');
        if (auth.endpoints && auth.endpoints.authorization) {
          parts.push('  authorize-url: ' + auth.endpoints.authorization);
        }
      } else {
        parts.push('app-passwords: NO (oder nicht in authentication-Key gemeldet)');
      }
      if (Array.isArray(body.namespaces)) {
        parts.push('namespaces: ' + body.namespaces.join(', '));
      }
      return parts.join('\n');
    });

    // 2. Alt root if primary failed
    if (!rootResult.ok) {
      append('(ROOT fehlgeschlagen — versuche Alt-Pfad ?rest_route=/)');
      append('');
      await probe('ALT-ROOT', base + '/?rest_route=/');
    }

    // 3. Post type discovery (CPTs!)
    await probe('TYPES', base + '/wp-json/wp/v2/types', function (body) {
      if (!body || typeof body !== 'object') return null;
      const keys = Object.keys(body);
      const lines = ['Post types (' + keys.length + '): ' + keys.join(', ')];
      keys.forEach(function (k) {
        const t = body[k];
        if (t && t.rest_base) {
          lines.push('  - ' + k + '  rest_base=' + t.rest_base + (t.hierarchical ? '  hierarchical' : '') + (t.name ? '  name="' + t.name + '"' : ''));
        }
      });
      return lines.join('\n');
    });

    // 4. Taxonomies
    await probe('TAXONOMIES', base + '/wp-json/wp/v2/taxonomies', function (body) {
      if (!body || typeof body !== 'object') return null;
      const keys = Object.keys(body);
      return 'Taxonomies (' + keys.length + '): ' + keys.join(', ');
    });

    // 5. Content endpoints — one item each, so we get status + X-WP-Total cheaply
    const endpoints = [
      ['POSTS',      '/wp-json/wp/v2/posts?per_page=1'],
      ['PAGES',      '/wp-json/wp/v2/pages?per_page=1'],
      ['MEDIA',      '/wp-json/wp/v2/media?per_page=1'],
      ['CATEGORIES', '/wp-json/wp/v2/categories?per_page=1'],
      ['TAGS',       '/wp-json/wp/v2/tags?per_page=1'],
      ['USERS',      '/wp-json/wp/v2/users?per_page=1'],
      ['COMMENTS',   '/wp-json/wp/v2/comments?per_page=1'],
      ['MENUS',      '/wp-json/wp/v2/menus?per_page=1'],
    ];

    for (let i = 0; i < endpoints.length; i++) {
      await probe(endpoints[i][0], base + endpoints[i][1], function (body) {
        if (Array.isArray(body)) return 'Array length: ' + body.length;
        return null;
      });
    }

    // 6. Discovered CPTs — probe each so X-WP-Total shows up in the log
    // (this only returns non-empty data when Schritt 1 ran discoverSite()
    //  and the types endpoint reported additional post types).
    if (state.discoveredCptKeys && state.discoveredCptKeys.length > 0) {
      append('--- Entdeckte Custom Post Types (probe je per_page=1) ---');
      append('');
      for (let i = 0; i < state.discoveredCptKeys.length; i++) {
        const key = state.discoveredCptKeys[i];
        const cfg = CONTENT_TYPES[key];
        if (!cfg) continue;
        const label = 'CPT:' + key.toUpperCase();
        await probe(label, base + '/wp-json' + cfg.endpoint + '?per_page=1', function (body) {
          if (Array.isArray(body)) {
            return 'Array length: ' + body.length + '   (rest_base=' + cfg.restBase + ', auth-required=' + (cfg.auth ? 'ja' : 'nein') + ')';
          }
          return null;
        });
      }
    }

    append('=== Diagnose abgeschlossen ===');
  }

  // ==========================================
  // Auth flow
  // ==========================================
  function startAuthRedirect() {
    const appId = crypto.randomUUID ? crypto.randomUUID() : 'brenntel-extractor-' + Date.now();
    const callbackUrl = window.location.origin + window.location.pathname;

    // Save state for callback
    sessionStorage.setItem('wp_auth_pending', JSON.stringify({
      siteUrl: state.siteUrl,
      apiRoot: state.apiRoot,
      siteName: state.siteName,
    }));

    const params = new URLSearchParams({
      app_name: 'brenntel Content Extractor',
      app_id: appId,
      success_url: callbackUrl,
      reject_url: callbackUrl + '?auth=rejected',
    });

    window.location.href = state.authUrl + '?' + params.toString();
  }

  function handleAuthCallback() {
    const params = new URLSearchParams(window.location.search);

    // Check for rejected auth
    if (params.get('auth') === 'rejected') {
      window.history.replaceState({}, '', window.location.pathname);
      return false;
    }

    // Check for successful auth callback
    const siteUrl = params.get('site_url');
    const userLogin = params.get('user_login');
    const password = params.get('password');

    if (siteUrl && userLogin && password) {
      // Restore pending state
      const pending = JSON.parse(sessionStorage.getItem('wp_auth_pending') || '{}');

      state.siteUrl = pending.siteUrl || siteUrl;
      state.apiRoot = pending.apiRoot || siteUrl.replace(/\/$/, '') + '/wp-json/';
      state.siteName = pending.siteName || siteUrl;
      state.username = userLogin;
      state.password = password;
      state.isAuthenticated = true;

      sessionStorage.removeItem('wp_auth_pending');
      sessionStorage.setItem('wp_credentials', JSON.stringify({
        siteUrl: state.siteUrl,
        apiRoot: state.apiRoot,
        siteName: state.siteName,
        username: state.username,
        password: state.password,
      }));

      // Clean URL
      window.history.replaceState({}, '', window.location.pathname);
      return true;
    }

    return false;
  }

  function setManualAuth(username, password) {
    state.username = username;
    state.password = password;
    state.isAuthenticated = true;
    sessionStorage.setItem('wp_credentials', JSON.stringify({
      siteUrl: state.siteUrl,
      apiRoot: state.apiRoot,
      siteName: state.siteName,
      username: state.username,
      password: state.password,
    }));
  }

  function restoreSession() {
    const creds = sessionStorage.getItem('wp_credentials');
    if (!creds) return false;
    try {
      const c = JSON.parse(creds);
      state.siteUrl = c.siteUrl;
      state.apiRoot = c.apiRoot;
      state.siteName = c.siteName;
      state.username = c.username;
      state.password = c.password;
      state.isAuthenticated = true;
      return true;
    } catch (_) { return false; }
  }

  function disconnect() {
    state.isAuthenticated = false;
    state.username = '';
    state.password = '';
    state.siteUrl = '';
    state.apiRoot = '';
    state.siteName = '';
    state.extractedData = {};
    state.counts = {};
    // Clean up any CPTs added via discovery so a subsequent connect
    // to a different site starts from a clean slate.
    state.discoveredCptKeys.forEach(function (k) {
      delete CONTENT_TYPES[k];
    });
    state.discoveredCptKeys = [];
    const ctContainer = document.querySelector('#content-types');
    if (ctContainer) {
      ctContainer.querySelectorAll('.ct-discovered').forEach(function (el) {
        el.remove();
      });
    }
    sessionStorage.removeItem('wp_credentials');
    sessionStorage.removeItem('wp_auth_pending');
  }

  // ==========================================
  // Extraction
  // ==========================================
  const CONTENT_TYPES = {
    posts:      { endpoint: '/wp/v2/posts', label: 'Beiträge', auth: false, perPage: 100 },
    pages:      { endpoint: '/wp/v2/pages', label: 'Seiten', auth: false, perPage: 100 },
    media:      { endpoint: '/wp/v2/media', label: 'Medien', auth: false, perPage: 100 },
    categories: { endpoint: '/wp/v2/categories', label: 'Kategorien', auth: false, perPage: 100 },
    tags:       { endpoint: '/wp/v2/tags', label: 'Tags', auth: false, perPage: 100 },
    users:      { endpoint: '/wp/v2/users', label: 'Autoren', auth: false, perPage: 100 },
    comments:   { endpoint: '/wp/v2/comments', label: 'Kommentare', auth: false, perPage: 100 },
    menus:      { endpoint: '/wp/v2/menus', label: 'Menüs', auth: true, perPage: 100 },
    settings:   { endpoint: '/wp/v2/settings', label: 'Einstellungen', auth: true, single: true },
  };

  async function fetchCount(type) {
    const cfg = CONTENT_TYPES[type];
    if (!cfg || cfg.single) return null;
    try {
      const res = await wpFetch(cfg.endpoint + '?per_page=1', cfg.auth);
      const total = parseInt(res.headers.get('X-WP-Total'), 10);
      return isNaN(total) ? 0 : total;
    } catch (_) { return null; }
  }

  async function fetchAllPages(type, onProgress, useEmbed, onLog) {
    const cfg = CONTENT_TYPES[type];
    const log = typeof onLog === 'function' ? onLog : function () {};

    if (cfg.single) {
      log('info', '  GET ' + cfg.endpoint + (cfg.auth ? '  (auth)' : ''));
      const res = await wpFetch(cfg.endpoint, cfg.auth);
      const json = await res.json();
      log('info', '  -> HTTP ' + res.status + '  (single resource)');
      return json;
    }

    let allItems = [];
    let page = 1;
    let totalPages = 1;
    let totalItemsHeader = null;
    const embedParam = useEmbed ? '&_embed=1' : '';
    const fields = '';

    while (page <= totalPages) {
      const sep = cfg.endpoint.includes('?') ? '&' : '?';
      const url = cfg.endpoint + sep + 'per_page=' + cfg.perPage + '&page=' + page + '&orderby=id&order=asc' + embedParam + fields;
      log('info', '  GET ' + url + (cfg.auth ? '  (auth)' : ''));
      const started = Date.now();
      const res = await wpFetch(url, cfg.auth);
      const elapsed = Date.now() - started;

      if (page === 1) {
        totalPages = parseInt(res.headers.get('X-WP-TotalPages'), 10) || 1;
        totalItemsHeader = res.headers.get('X-WP-Total');
        log('info', '  -> HTTP ' + res.status + '  (' + elapsed + 'ms)' +
          (totalItemsHeader ? '  X-WP-Total=' + totalItemsHeader : '') +
          '  Seiten gesamt: ' + totalPages);
      } else {
        log('info', '  -> HTTP ' + res.status + '  (' + elapsed + 'ms)');
      }

      const items = await res.json();
      if (!Array.isArray(items)) {
        log('warn', '  -> Antwort ist kein Array (' + (typeof items) + ') — breche bei dieser Seite ab.');
        break;
      }
      allItems = allItems.concat(items);
      log('info', '  -> Seite ' + page + '/' + totalPages + ' geladen (' + items.length + ' Items, Summe ' + allItems.length + ')');

      if (onProgress) onProgress(allItems.length, totalPages * cfg.perPage, page, totalPages);

      page++;

      // Rate limiting: small delay between pages
      if (page <= totalPages) await new Promise(r => setTimeout(r, 200));
    }

    return allItems;
  }

  async function runExtraction(selectedTypes, useEmbed, onTypeStart, onTypeProgress, onTypeDone, onTypeError, onLog) {
    const results = {};
    const total = selectedTypes.length;
    let completed = 0;

    onLog('info', 'runExtraction(): ' + total + ' Typen werden verarbeitet.');

    for (const type of selectedTypes) {
      const cfg = CONTENT_TYPES[type];
      if (!cfg) {
        onLog('warn', '[' + type + '] Kein CONTENT_TYPES-Eintrag — übersprungen.');
        onTypeError(type, 'Unbekannter Typ');
        completed++;
        continue;
      }

      onLog('info', '--- [' + (completed + 1) + '/' + total + '] ' + cfg.label + ' (' + type + ') ---');
      onLog('info', 'Endpoint: ' + cfg.endpoint + '  auth=' + (cfg.auth ? 'erforderlich' : 'nein') +
        (cfg.single ? '  single=true' : '  perPage=' + cfg.perPage));

      // Skip auth-required types if not authenticated
      if (cfg.auth && !state.isAuthenticated) {
        onLog('warn', cfg.label + ': Übersprungen (Auth erforderlich, aber nicht angemeldet)');
        onTypeError(type, 'Auth erforderlich');
        completed++;
        continue;
      }

      onTypeStart(type);
      onLog('info', cfg.label + ' wird extrahiert...');

      try {
        const started = Date.now();
        const data = await fetchAllPages(type, (fetched, est, page, totalP) => {
          onTypeProgress(type, fetched, est, page, totalP);
        }, useEmbed && !cfg.single, onLog);
        const elapsed = Date.now() - started;

        const count = Array.isArray(data) ? data.length : 1;
        results[type] = data;
        state.extractedData[type] = data;
        state.counts[type] = count;
        onTypeDone(type, count);
        onLog('ok', cfg.label + ': ' + count + ' Einträge extrahiert (' + elapsed + 'ms)');
      } catch (err) {
        const msg = err && err.message ? err.message : String(err);
        onTypeError(type, msg);
        onLog('err', cfg.label + ': Fehler – ' + msg);
        if (err && err.stack) {
          onLog('err', '  Stack: ' + String(err.stack).split('\n').slice(0, 3).join(' | '));
        }
      }

      completed++;
    }

    return results;
  }

  // ==========================================
  // Download / Export
  // ==========================================
  function generateManifest() {
    return {
      generated_at: new Date().toISOString(),
      source: state.siteUrl,
      site_name: state.siteName,
      authenticated: state.isAuthenticated,
      content_types: Object.keys(state.extractedData).map(type => ({
        type,
        count: Array.isArray(state.extractedData[type]) ? state.extractedData[type].length : 1,
      })),
      total_items: Object.values(state.counts).reduce((a, b) => a + b, 0),
    };
  }

  function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  /**
   * Extract media file URLs from extracted media data.
   * Each media item has source_url or guid.rendered.
   */
  function getMediaFileUrls(mediaData) {
    if (!Array.isArray(mediaData)) return [];
    return mediaData.map(function (item) {
      var url = item.source_url || (item.guid && item.guid.rendered) || '';
      var filename = url.split('/').pop() || ('media-' + item.id);
      return { id: item.id, url: url, filename: filename };
    }).filter(function (item) { return item.url; });
  }

  /**
   * Download a single media file through the proxy.
   * Returns { filename, blob } or null on error.
   */
  async function fetchMediaFile(fileUrl) {
    try {
      var proxyUrl = '/wp-proxy?url=' + encodeURIComponent(fileUrl);
      var res = await fetch(proxyUrl, { signal: AbortSignal.timeout(60000) });
      if (!res.ok) return null;
      var blob = await res.blob();
      return blob;
    } catch (_) {
      return null;
    }
  }

  async function downloadZip(includeMediaFiles, onMediaProgress) {
    // Build ZIP using JSZip if available, otherwise fallback to individual downloads
    if (typeof JSZip === 'undefined') {
      // Load JSZip dynamically
      await new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        script.onload = resolve;
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    const zip = new JSZip();
    const folder = zip.folder('wordpress-export');

    // Add manifest
    folder.file('manifest.json', JSON.stringify(generateManifest(), null, 2));

    // Add content files
    const contentFolder = folder.folder('content');
    for (const [type, data] of Object.entries(state.extractedData)) {
      contentFolder.file(type + '.json', JSON.stringify(data, null, 2));
    }

    // Download and add actual media files if requested
    if (includeMediaFiles && state.extractedData.media) {
      const mediaFolder = folder.folder('media');
      const files = getMediaFileUrls(state.extractedData.media);
      let downloaded = 0;
      let failed = 0;

      for (const file of files) {
        if (onMediaProgress) onMediaProgress(downloaded, files.length, file.filename);
        const blob = await fetchMediaFile(file.url);
        if (blob) {
          mediaFolder.file(file.filename, blob);
          downloaded++;
        } else {
          failed++;
        }
        // Small delay to not overwhelm the server
        await new Promise(function (r) { setTimeout(r, 100); });
      }

      if (onMediaProgress) onMediaProgress(downloaded, files.length, 'done');

      // Add media download summary to manifest
      folder.file('media-summary.json', JSON.stringify({
        total: files.length,
        downloaded: downloaded,
        failed: failed,
        files: files.map(function (f) { return f.filename; }),
      }, null, 2));
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeName = state.siteName.replace(/[^a-zA-Z0-9-]/g, '-').substring(0, 30);
    a.download = 'wp-export-' + safeName + '-' + new Date().toISOString().slice(0, 10) + '.zip';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  // ==========================================
  // UI Controller
  // ==========================================
  const panels = ['connect', 'authorize', 'extract', 'progress', 'download'];

  function showPanel(name) {
    panels.forEach(p => {
      const el = $('#panel-' + p);
      if (el) el.hidden = (p !== name);
    });

    // Update step indicators
    const stepIndex = panels.indexOf(name);
    $$('.step-item').forEach((el, i) => {
      el.classList.remove('active', 'done');
      if (i < stepIndex) el.classList.add('done');
      if (i === stepIndex) el.classList.add('active');
    });
    $$('.step-line').forEach((el, i) => {
      el.classList.toggle('done', i < stepIndex);
    });
  }

  function showDiscoverySuccess(info) {
    const result = $('#discovery-result');
    result.hidden = false;
    result.querySelector('.discovery-success').hidden = false;
    result.querySelector('.discovery-error').hidden = true;

    $('#site-name').textContent = info.name;
    $('#site-desc').textContent = info.description;
    $('#badge-version').textContent = 'WP ' + info.version;
    $('#badge-version').classList.add('badge-ok');
    $('#badge-auth').textContent = info.hasAppPasswords ? 'App Passwords' : 'Kein App Passwords';
    $('#badge-auth').classList.toggle('badge-ok', info.hasAppPasswords);
    $('#badge-auth').classList.toggle('badge-warn', !info.hasAppPasswords);

    // Render checkboxes for any newly discovered custom post types.
    renderDiscoveredCptCards(info.discoveredCpts || []);

    $('#auth-options').hidden = false;
  }

  /**
   * Render a content-type-card in the extract panel for each discovered
   * CPT. Cards are marked with `.ct-discovered` so we can wipe them on
   * re-discovery or disconnect without touching the hardcoded cards.
   */
  function renderDiscoveredCptCards(cpts) {
    const container = $('#content-types');
    if (!container) return;

    // Wipe previously injected cards (from a prior discovery)
    container.querySelectorAll('.ct-discovered').forEach(function (el) {
      el.remove();
    });

    if (!cpts || cpts.length === 0) return;

    // Generic "layers" icon used for all discovered CPTs.
    const iconSvg =
      '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' +
      '<polygon points="12 2 2 7 12 12 22 7 12 2"/>' +
      '<polyline points="2 17 12 22 22 17"/>' +
      '<polyline points="2 12 12 17 22 12"/>' +
      '</svg>';

    cpts.forEach(function (cpt) {
      const label = document.createElement('label');
      label.className = 'content-type-card ct-discovered';
      if (cpt.needsAuth) label.classList.add('ct-auth-required');

      const input = document.createElement('input');
      input.type = 'checkbox';
      input.name = 'extract';
      input.value = cpt.key;
      if (cpt.defaultChecked) input.checked = true;
      label.appendChild(input);

      const inner = document.createElement('div');
      inner.className = 'ct-inner';
      inner.innerHTML =
        iconSvg +
        '<strong></strong>' +
        (cpt.needsAuth ? '<span class="ct-badge-auth">Auth</span>' : '') +
        '<span class="ct-count" data-type="' + cpt.key + '"></span>';
      // Safely set label text (avoid HTML injection from the CPT name)
      inner.querySelector('strong').textContent = cpt.label + ' (CPT)';

      label.appendChild(inner);
      container.appendChild(label);
    });
  }

  function showDiscoveryError(message) {
    const result = $('#discovery-result');
    result.hidden = false;
    result.querySelector('.discovery-success').hidden = true;
    result.querySelector('.discovery-error').hidden = false;
    $('#error-message').textContent = message;
    $('#auth-options').hidden = true;
  }

  function setButtonLoading(btn, loading) {
    const text = btn.querySelector('.btn-text');
    const spinner = btn.querySelector('.btn-spinner');
    if (text) text.hidden = loading;
    if (spinner) spinner.hidden = !loading;
    btn.disabled = loading;
  }

  function updateContentCounts() {
    $$('.ct-count').forEach(async (el) => {
      const type = el.dataset.type;
      if (!type || !CONTENT_TYPES[type]) return;
      const cfg = CONTENT_TYPES[type];
      if (cfg.single) { el.textContent = ''; return; }
      if (cfg.auth && !state.isAuthenticated) { el.textContent = ''; return; }
      el.textContent = '...';
      const count = await fetchCount(type);
      el.textContent = count !== null ? count + ' Einträge' : '';
    });
  }

  function renderProgressItems(types) {
    const container = $('#progress-details');
    container.innerHTML = '';
    types.forEach(type => {
      const cfg = CONTENT_TYPES[type];
      if (!cfg) return;
      const div = document.createElement('div');
      div.className = 'progress-item';
      div.id = 'progress-' + type;
      div.innerHTML = '<div class="progress-item-icon pending"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg></div>' +
        '<span class="progress-item-name">' + cfg.label + '</span>' +
        '<span class="progress-item-count"></span>';
      container.appendChild(div);
    });
  }

  function setProgressItemStatus(type, status, text) {
    const item = $('#progress-' + type);
    if (!item) return;
    const icon = item.querySelector('.progress-item-icon');
    const count = item.querySelector('.progress-item-count');

    icon.className = 'progress-item-icon ' + status;
    if (status === 'running') {
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/></svg>';
    } else if (status === 'done') {
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
    } else if (status === 'error') {
      icon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>';
    }

    if (text) count.textContent = text;
  }

  function addLog(level, message) {
    const log = $('#progress-log');
    const time = new Date().toLocaleTimeString('de-DE');
    const prefix = '[' + time + '] ';
    const text = prefix + message;

    if (log) {
      const line = document.createElement('div');
      line.className = 'log-' + level;
      line.textContent = text;
      log.appendChild(line);
      log.scrollTop = log.scrollHeight;
    }

    // Mirror to console so DevTools always shows activity, even if
    // the progress panel hasn't been rendered yet.
    const consoleMethod = level === 'err' ? 'error'
      : level === 'warn' ? 'warn'
      : level === 'ok' ? 'log'
      : 'log';
    try { console[consoleMethod]('[api]', text); } catch (_) { /* no-op */ }
  }

  function showDownloadPanel() {
    const totalItems = Object.values(state.counts).reduce((a, b) => a + b, 0);
    const totalTypes = Object.keys(state.extractedData).length;

    $('#download-summary').textContent = totalItems + ' Einträge aus ' + totalTypes + ' Inhaltstypen von ' + state.siteName + ' extrahiert.';

    // Stats
    const statsContainer = $('#download-stats');
    statsContainer.innerHTML = '';
    const statsData = [
      { value: totalItems, label: 'Einträge' },
      { value: totalTypes, label: 'Typen' },
      { value: formatBytes(new Blob([JSON.stringify(state.extractedData)]).size), label: 'Daten' },
    ];
    statsData.forEach(s => {
      const card = document.createElement('div');
      card.className = 'stat-card';
      card.innerHTML = '<span class="stat-value">' + s.value + '</span><span class="stat-label">' + s.label + '</span>';
      statsContainer.appendChild(card);
    });

    // Individual download list
    const list = $('#download-list');
    list.innerHTML = '';
    for (const [type, data] of Object.entries(state.extractedData)) {
      const cfg = CONTENT_TYPES[type];
      const count = Array.isArray(data) ? data.length : 1;
      const div = document.createElement('div');
      div.className = 'download-item';
      div.innerHTML = '<span>' + (cfg ? cfg.label : type) + ' (' + count + ')</span>';
      const btn = document.createElement('button');
      btn.textContent = 'JSON';
      btn.addEventListener('click', () => downloadJson(data, type + '.json'));
      div.appendChild(btn);
      list.appendChild(div);
    }

    // Update ZIP button text based on media download option
    const zipBtn = $('#btn-download-zip');
    if (state.includeMediaFiles && state.extractedData.media) {
      const mediaCount = Array.isArray(state.extractedData.media) ? state.extractedData.media.length : 0;
      zipBtn.innerHTML = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ZIP mit ' + mediaCount + ' Mediendateien herunterladen';
    }

    showPanel('download');
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1048576) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1048576).toFixed(1) + ' MB';
  }

  // ==========================================
  // Event Handlers
  // ==========================================
  function init() {
    // Footer year
    const yearEl = $('#year');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Check for auth callback
    if (handleAuthCallback()) {
      showPanel('extract');
      $('#connected-name').textContent = state.siteName;
      rediscoverCptsInBackground();
      updateContentCounts();
      updateAuthRequiredCards();
      return;
    }

    // Check for existing session
    if (restoreSession()) {
      showPanel('extract');
      $('#connected-name').textContent = state.siteName;
      rediscoverCptsInBackground();
      updateContentCounts();
      updateAuthRequiredCards();
      return;
    }

    // Default: show connect panel
    showPanel('connect');

    // Discover form
    $('#form-connect').addEventListener('submit', async (e) => {
      e.preventDefault();
      const btn = $('#btn-discover');
      const url = $('#wp-url').value.trim();
      if (!url) {
        $('#wp-url').focus();
        return;
      }

      setButtonLoading(btn, true);
      $('#discovery-result').hidden = true;
      $('#auth-options').hidden = true;

      try {
        const info = await discoverSite(url);
        showDiscoverySuccess(info);
      } catch (err) {
        showDiscoveryError(err.message);
      } finally {
        setButtonLoading(btn, false);
      }
    });

    // Diagnostic test button — runs the full site discovery (so the
    // Site-Karte + CPT-Checkboxen are set up) AND writes a verbose
    // probe log to a copyable panel. One click, fully prepared.
    $('#btn-diagnostic').addEventListener('click', async () => {
      const url = $('#wp-url').value.trim();
      if (!url) {
        $('#wp-url').focus();
        return;
      }

      const panel = $('#diagnostic-result');
      const pre = $('#diagnostic-log');
      panel.hidden = false;
      pre.textContent = '';

      const lines = [];
      function append(line) {
        lines.push(line == null ? '' : String(line));
        pre.textContent = lines.join('\n');
        pre.scrollTop = pre.scrollHeight;
      }

      const btn = $('#btn-diagnostic');
      const origHtml = btn.innerHTML;
      btn.disabled = true;
      btn.innerHTML = '<span class="btn-text">Läuft …</span>';

      // Also hide the (possibly stale) old discovery card during the run
      $('#discovery-result').hidden = true;
      $('#auth-options').hidden = true;

      try {
        // Step A: real discoverSite() call — same as "Seite prüfen".
        // This sets state.apiRoot, state.hasAppPasswords, mutates
        // CONTENT_TYPES with discovered CPTs, and prepares everything
        // the extract panel needs.
        append('### Schritt 1: discoverSite() (wie "Seite prüfen")');
        try {
          const info = await discoverSite(url);
          append('-> Site erkannt: ' + info.name);
          append('-> App Passwords: ' + (info.hasAppPasswords ? 'ja' : 'nein'));
          if (info.discoveredCpts && info.discoveredCpts.length) {
            append('-> Entdeckte Custom Post Types (' + info.discoveredCpts.length + '):');
            info.discoveredCpts.forEach(function (c) {
              append('     - ' + c.key + '  (rest_base=' + c.restBase + ', auth=' + (c.needsAuth ? 'ja' : 'nein') + ', default checked=' + c.defaultChecked + ')');
            });
            append('-> Diese CPTs wurden der Extract-UI als Checkboxen hinzugefügt.');
          } else {
            append('-> Keine zusätzlichen CPTs entdeckt.');
          }
          // Show the site card + auth options so the user can continue
          // directly from here without clicking "Seite prüfen" again.
          showDiscoverySuccess(info);
          append('');
        } catch (err) {
          append('-> discoverSite() FEHLGESCHLAGEN: ' + (err && err.message ? err.message : err));
          append('-> Das heisst: entweder unterbricht ein WAF die /wp-json/-Anfrage,');
          append('   die REST API ist deaktiviert, oder die URL ist falsch.');
          append('-> Die verbosen Endpoint-Probes laufen trotzdem weiter,');
          append('   damit der Grund im Log sichtbar ist.');
          append('');
        }

        // Step B: verbose per-endpoint probes (read-only diagnostic)
        append('### Schritt 2: Endpoint-Probes');
        append('');
        await runDiagnostics(url, append);
      } catch (err) {
        append('');
        append('UNCAUGHT ERROR: ' + (err && err.message ? err.message : String(err)));
      } finally {
        btn.disabled = false;
        btn.innerHTML = origHtml;
      }
    });

    // Copy diagnostic log to clipboard
    $('#btn-diagnostic-copy').addEventListener('click', async () => {
      const pre = $('#diagnostic-log');
      const text = pre.textContent || '';
      const copyBtn = $('#btn-diagnostic-copy');
      const orig = copyBtn.textContent;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.textContent = 'Kopiert!';
      } catch (_) {
        // Fallback: select the text so the user can Ctrl+C manually
        try {
          const range = document.createRange();
          range.selectNodeContents(pre);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          copyBtn.textContent = 'Markiert — Strg+C';
        } catch (__) {
          copyBtn.textContent = 'Fehler';
        }
      }
      setTimeout(() => { copyBtn.textContent = orig; }, 1800);
    });

    // Close diagnostic panel
    $('#btn-diagnostic-close').addEventListener('click', () => {
      $('#diagnostic-result').hidden = true;
    });

    // Auth choice: public only
    $('#auth-public').addEventListener('click', () => {
      showPanel('extract');
      $('#connected-name').textContent = state.siteName;
      updateContentCounts();
      updateAuthRequiredCards();
    });

    // Auth choice: full access
    $('#auth-full').addEventListener('click', () => {
      if (state.hasAppPasswords) {
        showPanel('authorize');
      } else {
        // No app passwords, show manual auth
        showPanel('authorize');
        $('#btn-authorize').hidden = true;
      }
    });

    // Authorize redirect
    $('#btn-authorize').addEventListener('click', () => {
      startAuthRedirect();
    });

    // Manual auth toggle
    $('#btn-manual-auth').addEventListener('click', () => {
      const form = $('#manual-auth-form');
      form.hidden = !form.hidden;
    });

    // Manual auth submit
    $('#btn-manual-submit').addEventListener('click', () => {
      const user = $('#manual-user').value.trim();
      const pass = $('#manual-pass').value.trim();
      if (!user || !pass) return;
      setManualAuth(user, pass);
      showPanel('extract');
      $('#connected-name').textContent = state.siteName;
      updateContentCounts();
      updateAuthRequiredCards();
    });

    // Disconnect
    $('#btn-disconnect').addEventListener('click', () => {
      disconnect();
      showPanel('connect');
      $('#discovery-result').hidden = true;
      $('#auth-options').hidden = true;
      $('#wp-url').value = '';
    });

    // Start extraction
    $('#btn-extract').addEventListener('click', startExtraction);

    // Copy progress log to clipboard
    const btnProgressLogCopy = $('#btn-progress-log-copy');
    if (btnProgressLogCopy) {
      btnProgressLogCopy.addEventListener('click', async () => {
        const logEl = $('#progress-log');
        if (!logEl) return;
        const text = Array.from(logEl.querySelectorAll('div'))
          .map(d => d.textContent)
          .join('\n');
        const orig = btnProgressLogCopy.querySelector('.btn-text').textContent;
        try {
          await navigator.clipboard.writeText(text);
          btnProgressLogCopy.querySelector('.btn-text').textContent = 'Kopiert!';
        } catch (_) {
          try {
            const range = document.createRange();
            range.selectNodeContents(logEl);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
            btnProgressLogCopy.querySelector('.btn-text').textContent = 'Markiert — Strg+C';
          } catch (__) {
            btnProgressLogCopy.querySelector('.btn-text').textContent = 'Fehler';
          }
        }
        setTimeout(() => {
          btnProgressLogCopy.querySelector('.btn-text').textContent = orig;
        }, 1800);
      });
    }

    // Download buttons
    $('#btn-download-zip').addEventListener('click', async () => {
      const includeMedia = state.includeMediaFiles && state.extractedData.media;
      const btn = $('#btn-download-zip');
      const origHTML = btn.innerHTML;

      if (includeMedia) {
        btn.disabled = true;
        btn.innerHTML = '<span class="btn-spinner"></span> Medien werden heruntergeladen...';
        await downloadZip(true, (done, total, current) => {
          if (current === 'done') {
            btn.innerHTML = origHTML;
            btn.disabled = false;
          } else {
            btn.innerHTML = '<span class="btn-spinner"></span> ' + done + '/' + total + ' Dateien...';
          }
        });
        btn.innerHTML = origHTML;
        btn.disabled = false;
      } else {
        await downloadZip(false);
      }
    });
    $('#btn-download-json').addEventListener('click', () => {
      $('#individual-downloads').hidden = !$('#individual-downloads').hidden;
    });

    // New extraction
    $('#btn-new-extraction').addEventListener('click', () => {
      state.extractedData = {};
      state.counts = {};
      showPanel('extract');
      updateContentCounts();
    });

    // Shared.js mobile nav
    initMobileNav();
  }

  function updateAuthRequiredCards() {
    $$('.ct-auth-required').forEach(el => {
      el.classList.toggle('disabled', !state.isAuthenticated);
      const input = el.querySelector('input');
      if (input && !state.isAuthenticated) input.checked = false;
    });
  }

  /**
   * Fire-and-forget CPT re-discovery for restored sessions and
   * post-auth-callback loads. The extract panel is already visible at
   * this point, so new CPT checkboxes just pop in as soon as the call
   * completes. Silently ignores any network failure.
   */
  function rediscoverCptsInBackground() {
    (async () => {
      try {
        const res = await wpFetch('/wp/v2/types', false);
        if (!res.ok) return;
        const data = await res.json();
        const added = augmentContentTypesFromDiscovery(data);
        renderDiscoveredCptCards(added);
        // Refresh counts now that new types are registered
        updateContentCounts();
      } catch (_) { /* best-effort */ }
    })();
  }

  async function startExtraction() {
    // Always switch to the progress panel first so the log is visible
    // for every subsequent message (including validation errors). This
    // prevents the "click button, nothing happens" experience.
    showPanel('progress');
    const logEl = $('#progress-log');
    if (logEl) logEl.innerHTML = '';
    $('#progress-bar').style.width = '0%';
    $('#progress-pct').textContent = '0%';
    $('#progress-status').textContent = 'Extraktion läuft...';

    // Scroll the progress card into view — on short viewports the panel
    // swap otherwise happens above the fold and the user sees "nothing".
    const progressPanel = $('#panel-progress');
    if (progressPanel && typeof progressPanel.scrollIntoView === 'function') {
      try { progressPanel.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) {}
    }

    addLog('info', '=== startExtraction() ausgelöst ===');
    addLog('info', 'Site:          ' + (state.siteName || '(unbekannt)'));
    addLog('info', 'Site URL:      ' + (state.siteUrl || '(leer)'));
    addLog('info', 'API root:      ' + (state.apiRoot || '(leer)'));
    addLog('info', 'Authentifiziert: ' + (state.isAuthenticated ? 'ja (' + state.username + ')' : 'nein'));
    addLog('info', 'Entdeckte CPTs: ' + (state.discoveredCptKeys.length
      ? state.discoveredCptKeys.join(', ')
      : '(keine)'));

    // Read all checked input[name="extract"] values — includes both the
    // hardcoded cards and any dynamically-injected .ct-discovered cards.
    const allBoxes = Array.from($$('input[name="extract"]'));
    const checkedBoxes = allBoxes.filter(i => i.checked);
    const checked = checkedBoxes.map(i => i.value);

    addLog('info', 'Checkboxen gesamt: ' + allBoxes.length +
      '  (davon angehakt: ' + checked.length + ')');
    if (allBoxes.length > 0) {
      addLog('info', 'Alle Typen:     ' + allBoxes.map(i => i.value + (i.checked ? '[x]' : '[ ]')).join(', '));
    }

    if (checked.length === 0) {
      addLog('err', 'Keine Inhaltstypen ausgewählt! Bitte zurück zu Schritt 3 und mindestens einen Typ anhaken.');
      $('#progress-status').textContent = 'Keine Inhaltstypen ausgewählt.';
      addLog('info', 'Tipp: In 5 Sekunden wechsle ich automatisch zurück zum Auswahl-Schritt.');
      setTimeout(() => showPanel('extract'), 5000);
      return;
    }

    const useEmbed = $('#opt-embed').checked;
    state.includeMediaFiles = $('#opt-media-download').checked;
    addLog('info', 'Optionen:       _embed=' + useEmbed + '  include-media-files=' + state.includeMediaFiles);

    renderProgressItems(checked);

    let completedCount = 0;

    addLog('info', 'Starte Extraktion für ' + state.siteName + '...');

    try {
      await runExtraction(
        checked,
        useEmbed,
        // onTypeStart
        (type) => {
          setProgressItemStatus(type, 'running', '');
        },
        // onTypeProgress
        (type, fetched, est, page, totalPages) => {
          setProgressItemStatus(type, 'running', fetched + ' geladen (Seite ' + page + '/' + totalPages + ')');
          const overallPct = Math.round(((completedCount + (page / totalPages)) / checked.length) * 100);
          $('#progress-bar').style.width = overallPct + '%';
          $('#progress-pct').textContent = overallPct + '%';
        },
        // onTypeDone
        (type, count) => {
          completedCount++;
          setProgressItemStatus(type, 'done', count + ' Einträge');
          const overallPct = Math.round((completedCount / checked.length) * 100);
          $('#progress-bar').style.width = overallPct + '%';
          $('#progress-pct').textContent = overallPct + '%';
        },
        // onTypeError
        (type, msg) => {
          completedCount++;
          setProgressItemStatus(type, 'error', msg);
        },
        // onLog
        addLog,
      );

      addLog('ok', '=== Extraktion abgeschlossen ===');
      addLog('info', 'Ergebnis: ' + Object.keys(state.extractedData).length + ' Typen mit Daten, ' +
        Object.values(state.counts).reduce((a, b) => a + b, 0) + ' Einträgen gesamt.');
      $('#progress-status').textContent = 'Extraktion abgeschlossen!';

      // Only advance to the download panel if at least one type produced data.
      const extractedTypes = Object.keys(state.extractedData).length;
      if (extractedTypes > 0) {
        addLog('info', 'Wechsle in 1.5s zum Download-Schritt...');
        setTimeout(() => showDownloadPanel(), 1500);
      } else {
        addLog('err', 'Keine Daten extrahiert — Download-Schritt wird nicht angezeigt.');
        $('#progress-status').textContent = 'Keine Daten extrahiert. Bitte Log prüfen.';
      }
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      addLog('err', 'UNCAUGHT ERROR in runExtraction(): ' + msg);
      if (err && err.stack) {
        String(err.stack).split('\n').slice(0, 5).forEach(function (ln) {
          addLog('err', '  ' + ln);
        });
      }
      $('#progress-status').textContent = 'Fehler bei der Extraktion — Log prüfen.';
    }
  }

  function initMobileNav() {
    const hamburger = $('.hamburger');
    const navMobile = $('.nav-mobile');
    const overlay = $('.nav-overlay');
    if (!hamburger || !navMobile) return;

    hamburger.addEventListener('click', () => {
      const open = hamburger.classList.toggle('open');
      navMobile.classList.toggle('open', open);
      if (overlay) overlay.classList.toggle('open', open);
      hamburger.setAttribute('aria-expanded', String(open));
    });

    if (overlay) {
      overlay.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navMobile.classList.remove('open');
        overlay.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    }

    navMobile.querySelectorAll('a').forEach(a => {
      a.addEventListener('click', () => {
        hamburger.classList.remove('open');
        navMobile.classList.remove('open');
        if (overlay) overlay.classList.remove('open');
        hamburger.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // ==========================================
  // Boot
  // ==========================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
