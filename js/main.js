/* ========================================
   Main page JS — animations, cursor, form
   ======================================== */
(function () {
  'use strict';

  /* ========================================
     Preloader — dismiss after bar fill
     ======================================== */
  (function initPreloader() {
    var preloader = document.getElementById('preloader');
    if (!preloader) return;

    var fill = preloader.querySelector('.preloader-bar-fill');
    if (!fill) return;

    // Wait for the bar fill animation to end, then fade out
    fill.addEventListener('animationend', function () {
      // Small pause so the full bar is visible for a moment
      setTimeout(function () {
        preloader.classList.add('done');
      }, 250);
    });

    // Safety fallback: hide after 3.5s no matter what
    setTimeout(function () {
      if (!preloader.classList.contains('done')) {
        preloader.classList.add('done');
      }
    }, 2800);
  })();

  /* ========================================
     Page-specific language updates
     ======================================== */
  document.addEventListener('langchange', function (e) {
    var lang = e.detail.lang;

    // Update meta description
    var metaDesc = document.querySelector('meta[name="description"]');
    if (metaDesc) {
      metaDesc.content = lang === 'de'
        ? 'brenntel mediadesign — Digitalstudio aus Köln: Webdesign, Webentwicklung, Branding und KI-Integration aus einer Hand. Zwei Köpfe, die dein Projekt persönlich bauen — von der ersten Skizze bis zum Go-Live.'
        : 'brenntel mediadesign — digital studio from Cologne: web design, development, branding and AI integration from one team. Two minds building your project personally — from first sketch to go-live.';
    }

    // Update page title
    document.title = lang === 'de'
      ? 'brenntel mediadesign — Digitalstudio für Webdesign, Branding & KI in Köln'
      : 'brenntel mediadesign — Digital Studio for Web Design, Branding & AI in Cologne';
  });

  /* ========================================
     Scroll-triggered Animations (Intersection Observer)
     ======================================== */
  if ('IntersectionObserver' in window) {
    var animObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          animObserver.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -60px 0px' });

    document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right, .scale-in').forEach(function (el) {
      animObserver.observe(el);
    });
  } else {
    document.querySelectorAll('.fade-in, .fade-in-left, .fade-in-right, .scale-in').forEach(function (el) {
      el.classList.add('visible');
    });
  }

  /* ========================================
     Hero rotating headline word
     ======================================== */
  (function initHeroRotator() {
    var rotator = document.querySelector('.hero-rotator');
    var wordEl = rotator ? rotator.querySelector('.hero-rotator-word') : null;
    if (!rotator || !wordEl) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var index = 0;

    function currentLang() {
      return (window.brenntelLang && window.brenntelLang.get()) || 'de';
    }

    function words() {
      var raw = rotator.getAttribute('data-words-' + currentLang()) ||
                rotator.getAttribute('data-words-de') || '';
      return raw.split('|').filter(Boolean);
    }

    // When the language changes, restart cleanly from the first word
    document.addEventListener('langchange', function () {
      index = 0;
      wordEl.classList.remove('rot-out', 'rot-in');
      wordEl.textContent = words()[0] || wordEl.textContent;
    });

    setInterval(function () {
      var list = words();
      if (list.length < 2) return;
      index = (index + 1) % list.length;
      wordEl.classList.remove('rot-in');
      wordEl.classList.add('rot-out');
      setTimeout(function () {
        wordEl.textContent = list[index];
        wordEl.classList.remove('rot-out');
        wordEl.classList.add('rot-in');
      }, 270);
    }, 3000);
  })();

  /* ========================================
     Service Cards — Expand / Collapse
     ======================================== */
  (function initServiceCards() {
    // --- Toggle a card open/closed ---
    function toggleCard(card, forceOpen) {
      var isExpanded = card.classList.contains('expanded');
      var shouldOpen = typeof forceOpen === 'boolean' ? forceOpen : !isExpanded;

      if (shouldOpen === isExpanded) return;

      // Close all other cards first
      document.querySelectorAll('.service-card.expanded').forEach(function (other) {
        if (other !== card) other.classList.remove('expanded');
      });

      card.classList.toggle('expanded', shouldOpen);
    }

    // --- Direct click on service cards ---
    document.querySelectorAll('.service-card').forEach(function (card) {
      card.addEventListener('click', function () {
        toggleCard(card);
      });
    });

  })();

  /* ========================================
     Floating CTA visibility (appears past hero)
     ======================================== */
  (function initFloatingCta() {
    var cta = document.getElementById('floating-cta');
    var hero = document.getElementById('hero');
    if (!cta || !hero) return;
    if (!('IntersectionObserver' in window)) {
      cta.classList.add('visible');
      return;
    }
    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        // When the hero leaves the top of the viewport, reveal the CTA
        cta.classList.toggle('visible', !entry.isIntersecting);
      });
    }, { threshold: 0, rootMargin: '-40% 0px 0px 0px' });
    obs.observe(hero);
  })();

  /* ========================================
     About stats — count-up animation
     ======================================== */
  (function initStatCounters() {
    var stats = document.querySelectorAll('.stat-number[data-count]');
    if (!stats.length || !('IntersectionObserver' in window)) return;

    function animate(el) {
      var target = parseInt(el.getAttribute('data-count'), 10) || 0;
      var suffix = el.textContent.replace(/[0-9]/g, '').trim();
      var duration = 1400;
      var start = performance.now();
      function frame(now) {
        var t = Math.min((now - start) / duration, 1);
        var eased = 1 - Math.pow(1 - t, 3);
        var value = Math.round(target * eased);
        el.textContent = value + suffix;
        if (t < 1) requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
    }

    var obs = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          animate(entry.target);
          obs.unobserve(entry.target);
        }
      });
    }, { threshold: 0.4 });

    stats.forEach(function (s) {
      // Preserve suffix marker (+) while resetting digits
      var original = s.textContent;
      var suffix = original.replace(/[0-9]/g, '');
      s.textContent = '0' + suffix;
      obs.observe(s);
    });
  })();

  /* ========================================
     Work Section — iframe responsive scaling
     ======================================== */
  (function initWorkFrames() {
    var viewports = document.querySelectorAll('.work-viewport');
    if (viewports.length === 0) return;

    var IFRAME_WIDTH = 1280;

    function fitAll() {
      viewports.forEach(function (vp) {
        var iframe = vp.querySelector('iframe');
        if (!iframe) return; // statische Vorschaubilder brauchen keine Skalierung
        var w = vp.clientWidth;
        var h = vp.clientHeight;
        if (w === 0 || h === 0) return;
        var scale = w / IFRAME_WIDTH;
        iframe.style.transform = 'scale(' + scale + ')';
        iframe.style.height = Math.round(h / scale) + 'px';
      });
    }

    // Mark previews (iframe or image) as loaded to fade them in
    viewports.forEach(function (vp) {
      var iframe = vp.querySelector('iframe, img');
      if (!iframe) return;
      function markLoaded() {
        iframe.classList.add('loaded');
        vp.classList.add('is-loaded');
      }
      iframe.addEventListener('load', markLoaded);
      if (iframe.tagName === 'IMG' && iframe.complete && iframe.naturalWidth > 0) markLoaded();
      // Safety: if load doesn't fire within 6s, reveal anyway
      setTimeout(function () {
        if (!iframe.classList.contains('loaded')) markLoaded();
      }, 6000);
    });

    fitAll();
    window.addEventListener('load', fitAll);
    window.addEventListener('resize', fitAll, { passive: true });

    // Re-fit when the section becomes visible (fonts/layout may have shifted)
    if ('IntersectionObserver' in window) {
      var workObs = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            fitAll();
          }
        });
      }, { threshold: 0.1 });
      viewports.forEach(function (vp) { workObs.observe(vp); });
    }
  })();

  /* ========================================
     Work Cards — subtle 3D tilt on desktop
     ======================================== */
  (function initWorkTilt() {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    var cards = document.querySelectorAll('.work-card');
    cards.forEach(function (card) {
      var frame;
      card.addEventListener('mouseenter', function () {
        card.style.transition = 'transform 0.15s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.5s cubic-bezier(0.4, 0, 0.2, 1)';
      });
      card.addEventListener('mousemove', function (e) {
        var rect = card.getBoundingClientRect();
        var x = (e.clientX - rect.left) / rect.width;
        var y = (e.clientY - rect.top) / rect.height;
        var rx = (0.5 - y) * 6;
        var ry = (x - 0.5) * 6;
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(function () {
          card.style.transform =
            'translateY(-10px) rotateX(' + rx.toFixed(2) + 'deg) rotateY(' + ry.toFixed(2) + 'deg)';
        });
      });
      card.addEventListener('mouseleave', function () {
        cancelAnimationFrame(frame);
        card.style.transition = '';
        card.style.transform = '';
      });
    });
  })();

  /* ========================================
     Custom Cursor
     ======================================== */
  var cursorDot = document.querySelector('.cursor-dot');
  var cursorRing = document.querySelector('.cursor-ring');

  if (cursorDot && cursorRing && window.matchMedia('(pointer: fine)').matches) {
    var mouseX = 0, mouseY = 0;
    var ringX = 0, ringY = 0;

    document.addEventListener('mousemove', function (e) {
      mouseX = e.clientX;
      mouseY = e.clientY;
      cursorDot.style.transform = 'translate(' + (mouseX - 3) + 'px, ' + (mouseY - 3) + 'px)';
    }, { passive: true });

    function animateRing() {
      ringX += (mouseX - ringX) * 0.15;
      ringY += (mouseY - ringY) * 0.15;
      cursorRing.style.transform = 'translate(' + (ringX - 18) + 'px, ' + (ringY - 18) + 'px)';
      requestAnimationFrame(animateRing);
    }
    animateRing();

    var hoverTargets = document.querySelectorAll('a, button, input, textarea, .service-card, .faq-item summary');
    hoverTargets.forEach(function (el) {
      el.addEventListener('mouseenter', function () { cursorRing.classList.add('hover'); });
      el.addEventListener('mouseleave', function () { cursorRing.classList.remove('hover'); });
    });
  }

  /* ========================================
     Contact Form — Budget slider + counter + submit anim
     ======================================== */
  var form = document.getElementById('contact-form');
  var formSuccess = document.getElementById('form-success');

  // Budget slider: map 0-5 to ranges with DE/EN labels
  var BUDGET_STEPS = [
    { de: '< 1.000 €',            en: '< €1,000' },
    { de: '1.000 – 2.500 €',      en: '€1,000 – €2,500' },
    { de: '2.500 – 5.000 €',      en: '€2,500 – €5,000' },
    { de: '5.000 – 10.000 €',     en: '€5,000 – €10,000' },
    { de: '10.000 – 25.000 €',    en: '€10,000 – €25,000' },
    { de: '25.000 €+',            en: '€25,000+' }
  ];

  (function initBudgetSlider() {
    var slider = document.getElementById('budget');
    var display = document.querySelector('.budget-value');
    if (!slider || !display) return;

    function currentLang() {
      return (window.brenntelLang && window.brenntelLang.get()) || 'de';
    }

    function update() {
      var v = parseInt(slider.value, 10) || 0;
      var step = BUDGET_STEPS[v] || BUDGET_STEPS[0];
      var pct = (v / (slider.max - slider.min)) * 100;
      slider.style.setProperty('--budget-percent', pct + '%');

      display.setAttribute('data-de', step.de);
      display.setAttribute('data-en', step.en);
      display.textContent = step[currentLang()];
    }

    slider.addEventListener('input', update);
    document.addEventListener('langchange', update);
    update();
  })();

  (function initMessageCounter() {
    var ta = document.getElementById('message');
    var counter = document.querySelector('.form-counter');
    if (!ta || !counter) return;

    function update() {
      var len = ta.value.length;
      counter.textContent = len;
      counter.dataset.counter = String(len);
    }
    ta.addEventListener('input', update);
    update();
  })();

  function spawnConfetti(container) {
    if (!container) return;
    var colors = ['#e8720c', '#ffb347', '#1b9c3f', '#1a1a1a', '#f5c088', '#d06000'];
    for (var i = 0; i < 32; i++) {
      var piece = document.createElement('span');
      piece.className = 'confetti-piece';
      var angle = Math.random() * Math.PI * 2;
      var distance = 80 + Math.random() * 160;
      var cx = Math.cos(angle) * distance;
      var cy = Math.sin(angle) * distance - 40; // bias upward
      piece.style.setProperty('--cx', cx.toFixed(1) + 'px');
      piece.style.setProperty('--cy', cy.toFixed(1) + 'px');
      piece.style.setProperty('--r', (Math.random() * 720 - 360).toFixed(0) + 'deg');
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = (Math.random() * 0.15).toFixed(2) + 's';
      piece.style.animationDuration = (1.6 + Math.random() * 0.8).toFixed(2) + 's';
      if (Math.random() > 0.5) {
        piece.style.width = '6px';
        piece.style.height = '10px';
      }
      container.appendChild(piece);
    }
  }

  if (form && formSuccess) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var name = document.getElementById('name');
      var email = document.getElementById('email');
      var subject = document.getElementById('subject');
      var message = document.getElementById('message');
      var privacy = document.getElementById('privacy');
      var budget = document.getElementById('budget');
      var projectTypes = Array.prototype.slice
        .call(form.querySelectorAll('input[name="projectType"]:checked'))
        .map(function (el) { return el.value; });

      if (!name.value.trim() || !email.value.trim() || !message.value.trim() || !privacy.checked) {
        form.reportValidity();
        return;
      }

      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add('is-sending');
      }

      var budgetIdx = budget ? parseInt(budget.value, 10) : null;
      var budgetLabel = budgetIdx !== null && BUDGET_STEPS[budgetIdx]
        ? BUDGET_STEPS[budgetIdx].de
        : null;

      fetch('/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.value.trim(),
          email: email.value.trim(),
          subject: subject ? subject.value.trim() : '',
          message: message.value.trim(),
          privacy: privacy.checked ? 'on' : 'off',
          projectTypes: projectTypes,
          budget: budgetLabel
        })
      })
        .then(function (res) {
          return res.text().then(function (raw) {
            var parsed;
            try { parsed = JSON.parse(raw); } catch (_) { parsed = null; }
            return { ok: res.ok, status: res.status, raw: raw, data: parsed };
          });
        })
        .then(function (result) {
          if (!result.ok) {
            throw new Error(
              (result.data && (result.data.error || result.data.detail)) ||
              ('Request failed (HTTP ' + result.status + ')')
            );
          }
          if (submitBtn) {
            submitBtn.classList.remove('is-sending');
            submitBtn.classList.add('is-sent');
          }
          // Show success after a brief pause so the checkmark anim is visible
          setTimeout(function () {
            form.style.display = 'none';
            formSuccess.classList.add('show');
            spawnConfetti(formSuccess.querySelector('.confetti'));
          }, 650);
        })
        .catch(function (err) {
          if (submitBtn) {
            submitBtn.disabled = false;
            submitBtn.classList.remove('is-sending');
          }
          // eslint-disable-next-line no-console
          console.error('Contact form error:', err);
        });
    });
  }
})();