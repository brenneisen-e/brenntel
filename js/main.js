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
      }, 300);
    });

    // Safety fallback: hide after 3.5s no matter what
    setTimeout(function () {
      if (!preloader.classList.contains('done')) {
        preloader.classList.add('done');
      }
    }, 3500);
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
        ? 'brenntel mediadesign GbR — Wir gestalten digitale Erlebnisse: Webdesign, Webentwicklung, Branding und Beratung von Irena-Marie Rentel und Eike Brenneisen in Köln.'
        : 'brenntel mediadesign GbR — We create digital experiences: web design, development, branding, and consulting by Irena-Marie Rentel and Eike Brenneisen in Cologne.';
    }

    // Update page title
    document.title = lang === 'de'
      ? 'brenntel mediadesign GbR — Webdesign, Entwicklung & Branding'
      : 'brenntel mediadesign GbR — Web Design, Development & Branding';
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
     Hero preview visibility fallback (mobile)
     ======================================== */
  setTimeout(function () {
    var previews = document.querySelector('.hero-previews');
    if (previews) {
      previews.style.opacity = '1';
      previews.style.transform = 'translateY(0)';
    }
    var subtitle = document.querySelector('.hero .subtitle');
    if (subtitle) {
      subtitle.style.opacity = '1';
      subtitle.style.transform = 'translateY(0)';
    }
    var cta = document.querySelector('.hero-cta');
    if (cta) {
      cta.style.opacity = '1';
      cta.style.transform = 'translateY(0)';
    }
    // Force all inner preview elements visible
    document.querySelectorAll('.preview-square *').forEach(function (el) {
      el.style.opacity = '1';
    });
  }, 3500);

  /* ========================================
     Hero Previews Mobile Carousel (Infinite)
     ======================================== */
  (function initCarousel() {
    var container = document.querySelector('.hero-previews');
    var dotsContainer = document.querySelector('.carousel-dots');
    if (!container || !dotsContainer) return;

    var origItems = Array.from(container.querySelectorAll('.hero-preview'));
    var count = origItems.length;
    if (count === 0) return;

    // Only run carousel logic on mobile
    var mql = window.matchMedia('(max-width: 600px)');
    if (!mql.matches) {
      // On desktop: just create dots (hidden via CSS) and bail
      origItems.forEach(function (_, i) {
        var dot = document.createElement('button');
        dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
        dotsContainer.appendChild(dot);
      });
      return;
    }

    // --- Clone items for infinite loop ---
    // 3 full sets on each side = enough buffer for fast swipes
    var CLONE_SETS = 3;
    var fragBefore = document.createDocumentFragment();
    var fragAfter = document.createDocumentFragment();

    for (var s = 0; s < CLONE_SETS; s++) {
      origItems.forEach(function (item) {
        var cb = item.cloneNode(true);
        cb.classList.add('carousel-clone');
        cb.setAttribute('aria-hidden', 'true');
        fragBefore.appendChild(cb);

        var ca = item.cloneNode(true);
        ca.classList.add('carousel-clone');
        ca.setAttribute('aria-hidden', 'true');
        fragAfter.appendChild(ca);
      });
    }

    container.insertBefore(fragBefore, container.firstChild);
    container.appendChild(fragAfter);

    // Layout: [15 clones] [5 real] [15 clones] = 35 items
    var allItems = Array.from(container.querySelectorAll('.hero-preview'));
    var realStartIdx = CLONE_SETS * count;

    // --- Create dots (only for real items) ---
    for (var i = 0; i < count; i++) {
      var dot = document.createElement('button');
      dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', 'Slide ' + (i + 1));
      (function (idx) {
        dot.addEventListener('click', function () {
          allItems[realStartIdx + idx].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        });
      })(i);
      dotsContainer.appendChild(dot);
    }
    var dots = dotsContainer.querySelectorAll('.carousel-dot');

    // --- Pre-calculate set width & item step ---
    var oneSetWidth = 0;
    var itemStep = 0; // single item width + gap

    requestAnimationFrame(function () {
      // Width of exactly one full set of items (incl. gaps)
      oneSetWidth = allItems[count].offsetLeft - allItems[0].offsetLeft;
      // Distance between two consecutive item centres
      itemStep = allItems[1].offsetLeft - allItems[0].offsetLeft;

      // Scroll to first real item instantly
      var target = allItems[realStartIdx];
      container.scrollLeft = target.offsetLeft
        - (container.offsetWidth / 2)
        + (target.offsetWidth / 2);

      // Apply initial spotlight styling
      updateVisuals();
    });

    // --- Scroll handling ---
    var isRepositioning = false;
    var scrollTimer;
    var rafId;

    // Live dot update based on modulo distance to real items
    function updateDotsLive() {
      if (oneSetWidth === 0) return;
      var viewCenter = container.scrollLeft + container.offsetWidth / 2;
      var closest = 0;
      var minDist = Infinity;
      for (var i = 0; i < count; i++) {
        var item = allItems[realStartIdx + i];
        var itemCenter = item.offsetLeft + item.offsetWidth / 2;
        var rawDist = Math.abs(viewCenter - itemCenter) % oneSetWidth;
        var dist = rawDist > oneSetWidth / 2 ? oneSetWidth - rawDist : rawDist;
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      }
      dots.forEach(function (d, i) {
        d.classList.toggle('active', i === closest);
      });
      updateVisuals();
    }

    // Spotlight effect: center item = full color, others fade to gray
    function updateVisuals() {
      if (itemStep === 0) return;
      var viewCenter = container.scrollLeft + container.offsetWidth / 2;
      for (var j = 0; j < allItems.length; j++) {
        var itemCenter = allItems[j].offsetLeft + allItems[j].offsetWidth / 2;
        var norm = Math.abs(viewCenter - itemCenter) / itemStep; // 0 = centered, 1 = one slot away
        var gray = Math.min(norm, 1);
        var alpha = Math.max(1 - norm * 0.45, 0.35);
        allItems[j].style.filter = 'grayscale(' + gray + ')';
        allItems[j].style.opacity = alpha;
      }
    }

    // Silent reposition: snap back to the real-items zone whenever
    // the view is outside it.  Only fires when the user's finger is
    // off-screen AND momentum scrolling has fully stopped (300 ms).
    function onScrollEnd() {
      if (isRepositioning || isTouching || oneSetWidth === 0) return;

      var viewCenter = container.scrollLeft + container.offsetWidth / 2;
      var realCenter = allItems[realStartIdx].offsetLeft + oneSetWidth / 2;
      var setsAway = Math.round((viewCenter - realCenter) / oneSetWidth);

      if (setsAway === 0) return;

      isRepositioning = true;
      container.scrollLeft -= setsAway * oneSetWidth;
      updateVisuals();
      requestAnimationFrame(function () {
        isRepositioning = false;
      });
    }

    // Track touch to never reposition while finger is on screen
    var isTouching = false;
    container.addEventListener('touchstart', function () {
      isTouching = true;
      clearTimeout(scrollTimer);
    }, { passive: true });
    container.addEventListener('touchend', function () {
      isTouching = false;
      // Kick off the timer — momentum scroll events will keep
      // resetting it until the scroll truly stops.
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(onScrollEnd, 300);
    }, { passive: true });

    container.addEventListener('scroll', function () {
      if (isRepositioning) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateDotsLive);
      if (!isTouching) {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(onScrollEnd, 300);
      }
    }, { passive: true });
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

    // --- Hero preview click → scroll + expand ---
    var container = document.querySelector('.hero-previews');
    if (!container) return;

    var touchStartX = 0;
    var touchStartY = 0;
    var touchMoved = false;
    var MOVE_THRESHOLD = 10;

    container.addEventListener('touchstart', function (e) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      touchMoved = false;
    }, { passive: true });

    container.addEventListener('touchmove', function (e) {
      var dx = Math.abs(e.touches[0].clientX - touchStartX);
      var dy = Math.abs(e.touches[0].clientY - touchStartY);
      if (dx > MOVE_THRESHOLD || dy > MOVE_THRESHOLD) {
        touchMoved = true;
      }
    }, { passive: true });

    container.addEventListener('click', function (e) {
      if (touchMoved) return;

      var preview = e.target.closest('.hero-preview');
      if (!preview) return;

      var targetId = preview.getAttribute('data-scroll-target');
      if (!targetId) return;

      var targetCard = document.getElementById(targetId);
      if (!targetCard) return;

      // Open the card (close others)
      toggleCard(targetCard, true);

      // Scroll to the card
      targetCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

      // Add highlight animation
      targetCard.classList.remove('service-card-highlight');
      void targetCard.offsetWidth;
      targetCard.classList.add('service-card-highlight');

      targetCard.addEventListener('animationend', function handler() {
        targetCard.classList.remove('service-card-highlight');
        targetCard.removeEventListener('animationend', handler);
      });
    });
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
        if (!iframe) return;
        var w = vp.clientWidth;
        var h = vp.clientHeight;
        if (w === 0 || h === 0) return;
        var scale = w / IFRAME_WIDTH;
        iframe.style.transform = 'scale(' + scale + ')';
        iframe.style.height = Math.round(h / scale) + 'px';
      });
    }

    // Mark iframes as loaded to fade them in
    viewports.forEach(function (vp) {
      var iframe = vp.querySelector('iframe');
      if (!iframe) return;
      function markLoaded() {
        iframe.classList.add('loaded');
        vp.classList.add('is-loaded');
      }
      iframe.addEventListener('load', markLoaded);
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

    var hoverTargets = document.querySelectorAll('a, button, input, textarea, .service-card, .hero-preview');
    hoverTargets.forEach(function (el) {
      el.addEventListener('mouseenter', function () { cursorRing.classList.add('hover'); });
      el.addEventListener('mouseleave', function () { cursorRing.classList.remove('hover'); });
    });
  }

  /* ========================================
     Parallax on Hero Shapes
     ======================================== */
  var heroShapes = document.querySelectorAll('.hero-shapes .shape');
  if (heroShapes.length > 0 && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    window.addEventListener('scroll', function () {
      var scrollY = window.scrollY;
      if (scrollY < window.innerHeight) {
        var factor = scrollY * 0.3;
        heroShapes.forEach(function (shape, i) {
          var speed = (i + 1) * 0.08;
          shape.style.transform = 'translateY(' + (factor * speed) + 'px)';
        });
      }
    }, { passive: true });
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