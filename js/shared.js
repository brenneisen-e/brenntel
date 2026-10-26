/* ========================================
   Language Switching (shared across all pages)
   ======================================== */
(function () {
  'use strict';

  var STORAGE_KEY = 'brenntel-lang';

  function getCurrentLang() {
    return localStorage.getItem(STORAGE_KEY) || 'de';
  }

  function setLanguage(lang) {
    localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;

    // Update text content via data attributes
    document.querySelectorAll('[data-de]').forEach(function (el) {
      var text = el.getAttribute('data-' + lang);
      if (text) {
        if (el.tagName === 'LABEL' || el.closest('.form-checkbox') || text.indexOf('<') !== -1) {
          el.innerHTML = text;
        } else {
          el.textContent = text;
        }
      }
    });

    // Update placeholders
    document.querySelectorAll('[data-de-placeholder]').forEach(function (el) {
      var placeholder = el.getAttribute('data-' + lang + '-placeholder');
      if (placeholder) el.placeholder = placeholder;
    });

    // Screenreader-Beschriftungen (aria-label) mitübersetzen
    document.querySelectorAll('[data-de-aria-label]').forEach(function (el) {
      var label = el.getAttribute('data-' + lang + '-aria-label');
      if (label) el.setAttribute('aria-label', label);
    });

    // Update toggle buttons
    document.querySelectorAll('.lang-toggle button').forEach(function (btn) {
      var isActive = btn.getAttribute('data-lang') === lang;
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-pressed', String(isActive));
    });

    // Menü-Button: gleichbleibende Beschriftung, der Zustand steckt in aria-expanded
    document.querySelectorAll('.hamburger').forEach(function (btn) {
      btn.setAttribute('aria-label', lang === 'en' ? 'Menu' : 'Menü');
    });
  }

  // Bind toggle buttons
  document.querySelectorAll('.lang-toggle button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      setLanguage(this.getAttribute('data-lang'));
      // Dispatch custom event for page-specific handlers
      document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: this.getAttribute('data-lang') } }));
    });
  });

  // Initialize
  var lang = getCurrentLang();
  setLanguage(lang);
  document.dispatchEvent(new CustomEvent('langchange', { detail: { lang: lang } }));

  /* ========================================
     Mobile Navigation
     ======================================== */
  var hamburger = document.querySelector('.hamburger');
  var navMobile = document.querySelector('.nav-mobile');
  var navOverlay = document.querySelector('.nav-overlay');

  if (hamburger && navMobile && navOverlay) {
    if (!navMobile.id) navMobile.id = 'nav-mobile';
    hamburger.setAttribute('aria-controls', navMobile.id);
    // Zugeklappt nicht per Tab oder Screenreader erreichbar (bleibt aber gezeichnet)
    navMobile.inert = true;

    // Set nav top position based on actual header height
    var siteHeader = document.querySelector('.site-header');
    function updateNavTop() {
      if (siteHeader) {
        navMobile.style.top = siteHeader.offsetHeight + 'px';
      }
    }
    updateNavTop();
    window.addEventListener('resize', updateNavTop);

    function toggleMenu() {
      updateNavTop();
      var isOpen = navMobile.classList.toggle('open');
      navMobile.inert = !isOpen;
      hamburger.classList.toggle('open', isOpen);
      navOverlay.classList.toggle('open', isOpen);
      hamburger.setAttribute('aria-expanded', String(isOpen));
      document.body.style.overflow = isOpen ? 'hidden' : '';
    }

    function closeMenu() {
      navMobile.classList.remove('open');
      navMobile.inert = true;
      hamburger.classList.remove('open');
      navOverlay.classList.remove('open');
      hamburger.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }

    hamburger.addEventListener('click', toggleMenu);
    navOverlay.addEventListener('click', closeMenu);

    navMobile.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', closeMenu);
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' || !navMobile.classList.contains('open')) return;
      var focusInMenu = navMobile.contains(document.activeElement);
      closeMenu();
      if (focusInMenu) hamburger.focus();
    });
  }

  /* ========================================
     Header Scroll Effect
     ======================================== */
  var header = document.querySelector('.site-header');
  if (header) {
    window.addEventListener('scroll', function () {
      header.classList.toggle('scrolled', window.scrollY > 20);
    }, { passive: true });
  }

  /* ========================================
     Theme (light/dark) toggle
     ======================================== */
  var THEME_KEY = 'brenntel-theme';

  function getStoredTheme() {
    try { return localStorage.getItem(THEME_KEY); } catch (_) { return null; }
  }

  function systemPrefersDark() {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  }

  function applyTheme(theme) {
    var root = document.documentElement;
    if (theme === 'dark') {
      root.setAttribute('data-theme', 'dark');
    } else {
      root.removeAttribute('data-theme');
    }
    // Schalter „Dunkles Design“: gedrückt = dunkel
    document.querySelectorAll('.theme-toggle').forEach(function (btn) {
      btn.setAttribute('aria-pressed', String(theme === 'dark'));
    });
  }

  var initialTheme = getStoredTheme() || (systemPrefersDark() ? 'dark' : 'light');
  applyTheme(initialTheme);

  document.querySelectorAll('.theme-toggle').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
      var next = current === 'dark' ? 'light' : 'dark';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch (_) {}
    });
  });

  /* ========================================
     Footer Year
     ======================================== */
  var yearEl = document.getElementById('year');
  if (yearEl) yearEl.textContent = new Date().getFullYear();

  // Expose for page-specific scripts
  window.brenntelLang = {
    get: getCurrentLang,
    set: setLanguage
  };
})();