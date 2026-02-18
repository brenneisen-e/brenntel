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
    const url = endpoint.startsWith('http') ? endpoint : state.apiRoot + endpoint;
    const opts = { headers: {} };
    if (auth && state.isAuthenticated) {
      opts.headers['Authorization'] = basicAuthHeader(state.username, state.password);
    }
    const res = await proxiedFetch(url, opts);
    if (!res.ok) throw new Error(res.status + ' ' + res.statusText);
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

    if (!data) throw new Error('WordPress REST API nicht erreichbar. Pruefen Sie die URL und ob die REST API aktiviert ist.');

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

    return {
      name: state.siteName,
      description: state.siteDescription,
      hasAppPasswords: state.hasAppPasswords,
      version: state.wpVersion,
      namespaces: data.namespaces || [],
    };
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
    sessionStorage.removeItem('wp_credentials');
    sessionStorage.removeItem('wp_auth_pending');
  }

  // ==========================================
  // Extraction
  // ==========================================
  const CONTENT_TYPES = {
    posts:      { endpoint: '/wp/v2/posts', label: 'Beitraege', auth: false, perPage: 100 },
    pages:      { endpoint: '/wp/v2/pages', label: 'Seiten', auth: false, perPage: 100 },
    media:      { endpoint: '/wp/v2/media', label: 'Medien', auth: false, perPage: 100 },
    categories: { endpoint: '/wp/v2/categories', label: 'Kategorien', auth: false, perPage: 100 },
    tags:       { endpoint: '/wp/v2/tags', label: 'Tags', auth: false, perPage: 100 },
    users:      { endpoint: '/wp/v2/users', label: 'Autoren', auth: false, perPage: 100 },
    comments:   { endpoint: '/wp/v2/comments', label: 'Kommentare', auth: false, perPage: 100 },
    menus:      { endpoint: '/wp/v2/menus', label: 'Menues', auth: true, perPage: 100 },
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

  async function fetchAllPages(type, onProgress, useEmbed) {
    const cfg = CONTENT_TYPES[type];
    if (cfg.single) {
      const res = await wpFetch(cfg.endpoint, cfg.auth);
      return await res.json();
    }

    let allItems = [];
    let page = 1;
    let totalPages = 1;
    const embedParam = useEmbed ? '&_embed=1' : '';
    const fields = '';

    while (page <= totalPages) {
      const sep = cfg.endpoint.includes('?') ? '&' : '?';
      const url = cfg.endpoint + sep + 'per_page=' + cfg.perPage + '&page=' + page + '&orderby=id&order=asc' + embedParam + fields;
      const res = await wpFetch(url, cfg.auth);

      if (page === 1) {
        totalPages = parseInt(res.headers.get('X-WP-TotalPages'), 10) || 1;
      }

      const items = await res.json();
      allItems = allItems.concat(items);

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

    for (const type of selectedTypes) {
      const cfg = CONTENT_TYPES[type];
      if (!cfg) continue;

      // Skip auth-required types if not authenticated
      if (cfg.auth && !state.isAuthenticated) {
        onLog('warn', cfg.label + ': Uebersprungen (Auth erforderlich)');
        onTypeError(type, 'Auth erforderlich');
        completed++;
        continue;
      }

      onTypeStart(type);
      onLog('info', cfg.label + ' wird extrahiert...');

      try {
        const data = await fetchAllPages(type, (fetched, est, page, totalP) => {
          onTypeProgress(type, fetched, est, page, totalP);
        }, useEmbed && !cfg.single);

        const count = Array.isArray(data) ? data.length : 1;
        results[type] = data;
        state.extractedData[type] = data;
        state.counts[type] = count;
        onTypeDone(type, count);
        onLog('ok', cfg.label + ': ' + count + ' Eintraege extrahiert');
      } catch (err) {
        onTypeError(type, err.message);
        onLog('err', cfg.label + ': Fehler — ' + err.message);
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

  async function downloadZip() {
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

    $('#auth-options').hidden = false;
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
      el.textContent = count !== null ? count + ' Eintraege' : '';
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
    const line = document.createElement('div');
    line.className = 'log-' + level;
    const time = new Date().toLocaleTimeString('de-DE');
    line.textContent = '[' + time + '] ' + message;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  function showDownloadPanel() {
    const totalItems = Object.values(state.counts).reduce((a, b) => a + b, 0);
    const totalTypes = Object.keys(state.extractedData).length;

    $('#download-summary').textContent = totalItems + ' Eintraege aus ' + totalTypes + ' Inhaltstypen von ' + state.siteName + ' extrahiert.';

    // Stats
    const statsContainer = $('#download-stats');
    statsContainer.innerHTML = '';
    const statsData = [
      { value: totalItems, label: 'Eintraege' },
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
      updateContentCounts();
      updateAuthRequiredCards();
      return;
    }

    // Check for existing session
    if (restoreSession()) {
      showPanel('extract');
      $('#connected-name').textContent = state.siteName;
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
      const url = $('#wp-url').value;
      if (!url) return;

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

    // Download buttons
    $('#btn-download-zip').addEventListener('click', () => downloadZip());
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

  async function startExtraction() {
    const checked = Array.from($$('input[name="extract"]:checked')).map(i => i.value);
    if (checked.length === 0) return;

    const useEmbed = $('#opt-embed').checked;

    showPanel('progress');
    renderProgressItems(checked);
    $('#progress-log').innerHTML = '';

    let completedCount = 0;

    addLog('info', 'Extraktion gestartet fuer ' + state.siteName);

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
        setProgressItemStatus(type, 'done', count + ' Eintraege');
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

    addLog('ok', 'Extraktion abgeschlossen!');
    $('#progress-status').textContent = 'Extraktion abgeschlossen!';

    // Short delay then show download
    setTimeout(() => showDownloadPanel(), 1000);
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
