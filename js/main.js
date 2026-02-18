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
    // Layout: [clone-set] [real items] [clone-set]
    var fragBefore = document.createDocumentFragment();
    var fragAfter = document.createDocumentFragment();

    origItems.forEach(function (item) {
      var cloneBefore = item.cloneNode(true);
      cloneBefore.classList.add('carousel-clone');
      cloneBefore.setAttribute('aria-hidden', 'true');
      fragBefore.appendChild(cloneBefore);

      var cloneAfter = item.cloneNode(true);
      cloneAfter.classList.add('carousel-clone');
      cloneAfter.setAttribute('aria-hidden', 'true');
      fragAfter.appendChild(cloneAfter);
    });

    container.insertBefore(fragBefore, container.firstChild);
    container.appendChild(fragAfter);

    // All items now: [5 clones] [5 real] [5 clones]
    var allItems = Array.from(container.querySelectorAll('.hero-preview'));

    // --- Create dots (only for real items) ---
    for (var i = 0; i < count; i++) {
      var dot = document.createElement('button');
      dot.className = 'carousel-dot' + (i === 0 ? ' active' : '');
      dot.setAttribute('aria-label', 'Slide ' + (i + 1));
      (function (idx) {
        dot.addEventListener('click', function () {
          allItems[count + idx].scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        });
      })(i);
      dotsContainer.appendChild(dot);
    }
    var dots = dotsContainer.querySelectorAll('.carousel-dot');

    // --- Scroll to first real item instantly ---
    function scrollToItem(item) {
      var itemRect = item.getBoundingClientRect();
      var containerRect = container.getBoundingClientRect();
      var offset = itemRect.left - containerRect.left + container.scrollLeft;
      container.scrollLeft = offset - (containerRect.width / 2) + (itemRect.width / 2);
    }

    // Initial position (no animation)
    requestAnimationFrame(function () {
      scrollToItem(allItems[count]); // first real item
    });

    // --- Live dot updates + infinite loop reposition ---
    var isRepositioning = false;
    var scrollTimer;
    var rafId;

    function getClosestIndex() {
      var containerRect = container.getBoundingClientRect();
      var center = containerRect.left + containerRect.width / 2;
      var closest = 0;
      var minDist = Infinity;
      allItems.forEach(function (item, i) {
        var rect = item.getBoundingClientRect();
        var itemCenter = rect.left + rect.width / 2;
        var dist = Math.abs(itemCenter - center);
        if (dist < minDist) {
          minDist = dist;
          closest = i;
        }
      });
      return closest;
    }

    // Live dot update (runs every frame during scroll)
    function updateDotsLive() {
      var idx = getClosestIndex();
      var realIdx = idx % count;
      dots.forEach(function (d, i) {
        d.classList.toggle('active', i === realIdx);
      });
    }

    // Reposition to real items when scroll settles on a clone
    function onScrollEnd() {
      if (isRepositioning) return;

      var idx = getClosestIndex();
      var realIdx = idx % count;

      if (idx < count || idx >= count * 2) {
        isRepositioning = true;
        scrollToItem(allItems[count + realIdx]);
        requestAnimationFrame(function () {
          requestAnimationFrame(function () {
            isRepositioning = false;
          });
        });
      }
    }

    container.addEventListener('scroll', function () {
      if (isRepositioning) return;

      // Live dot update via rAF (smooth, not debounced)
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(updateDotsLive);

      // Reposition check only after scroll stops
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(onScrollEnd, 150);
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