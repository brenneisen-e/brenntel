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
        ? 'brenntel mediadesign GbR — Kreative digitale Lösungen: Webdesign, Webentwicklung, Branding und Beratung von Irena-Marie Rentel und Eike Brenneisen in Köln.'
        : 'brenntel mediadesign GbR — Creative digital solutions: web design, development, branding, and consulting by Irena-Marie Rentel and Eike Brenneisen in Cologne.';
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