/* ========================================
   Main page JS — animations, cursor, form
   ======================================== */
(function () {
  'use strict';

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

    // --- Pre-calculate set width & initial scroll position ---
    var oneSetWidth = 0;

    requestAnimationFrame(function () {
      // Width of exactly one full set of items (incl. gaps)
      oneSetWidth = allItems[count].offsetLeft - allItems[0].offsetLeft;

      // Scroll to first real item instantly
      var target = allItems[realStartIdx];
      container.scrollLeft = target.offsetLeft
        - (container.offsetWidth / 2)
        + (target.offsetWidth / 2);
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
    }

    // Silent reposition: only when user has scrolled 2+ sets away,
    // keeping 1 full clone set as a "free roaming" buffer on each
    // side so slow swiping across the boundary never triggers a jump.
    function onScrollEnd() {
      if (isRepositioning || oneSetWidth === 0) return;

      var viewCenter = container.scrollLeft + container.offsetWidth / 2;
      var realCenter = allItems[realStartIdx].offsetLeft + oneSetWidth / 2;
      var setsAway = Math.round((viewCenter - realCenter) / oneSetWidth);

      if (Math.abs(setsAway) < 2) return; // allow 1 set free roaming

      isRepositioning = true;
      container.scrollLeft -= setsAway * oneSetWidth;
      requestAnimationFrame(function () {
        isRepositioning = false;
      });
    }

    // Track touch to avoid repositioning while user interacts
    var isTouching = false;
    container.addEventListener('touchstart', function () {
      isTouching = true;
      clearTimeout(scrollTimer);
    }, { passive: true });
    container.addEventListener('touchend', function () {
      isTouching = false;
    }, { passive: true });

    container.addEventListener('scroll', function () {
      if (isRepositioning) return;
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateDotsLive);
      // Only schedule reposition when finger is off screen
      if (!isTouching) {
        clearTimeout(scrollTimer);
        scrollTimer = setTimeout(onScrollEnd, 800);
      }
    }, { passive: true });
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

    var hoverTargets = document.querySelectorAll('a, button, input, textarea, .service-card');
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
     Contact Form
     ======================================== */
  var form = document.getElementById('contact-form');
  var formSuccess = document.getElementById('form-success');

  if (form && formSuccess) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();

      var name = document.getElementById('name');
      var email = document.getElementById('email');
      var message = document.getElementById('message');
      var privacy = document.getElementById('privacy');

      if (!name.value.trim() || !email.value.trim() || !message.value.trim() || !privacy.checked) {
        form.reportValidity();
        return;
      }

      form.style.display = 'none';
      formSuccess.classList.add('show');
    });
  }
})();