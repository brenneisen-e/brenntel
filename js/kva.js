/* ========================================
   KVA Page — Code Entry, Animations & Display
   ======================================== */
(function () {
  'use strict';

  /* ----------------------------------------
     KVA Registry — add new KVA codes here
     ---------------------------------------- */
  var VALID_CODES = {
    'KVA-AF-2602': true
  };

  /* ----------------------------------------
     DOM References
     ---------------------------------------- */
  var entryScreen = document.getElementById('kva-entry');
  var codeForm    = document.getElementById('kva-code-form');
  var codeInput   = document.getElementById('kva-code-input');
  var errorMsg    = document.getElementById('kva-error');
  var kvaDoc      = document.getElementById('kva-document');
  var canvas      = document.getElementById('kva-particles');
  var footer      = document.getElementById('site-footer');
  var dateEl      = document.getElementById('kva-date');
  var validEl     = document.getElementById('kva-valid-until');

  /* ----------------------------------------
     Set Dates
     ---------------------------------------- */
  function formatDate(d) {
    var dd = String(d.getDate()).padStart(2, '0');
    var mm = String(d.getMonth() + 1).padStart(2, '0');
    return dd + '.' + mm + '.' + d.getFullYear();
  }

  var today = new Date();
  if (dateEl) dateEl.textContent = formatDate(today);

  var validDate = new Date(today);
  validDate.setDate(validDate.getDate() + 30);
  if (validEl) validEl.textContent = formatDate(validDate);

  /* ----------------------------------------
     Check URL parameter
     ---------------------------------------- */
  var params = new URLSearchParams(window.location.search);
  var urlCode = params.get('code');
  if (urlCode) {
    codeInput.value = urlCode.toUpperCase();
    // Small delay so entry animation plays first
    setTimeout(function () {
      handleCodeSubmit(urlCode.toUpperCase());
    }, 1200);
  }

  /* ----------------------------------------
     Form Submission
     ---------------------------------------- */
  codeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var code = codeInput.value.trim().toUpperCase();
    handleCodeSubmit(code);
  });

  function handleCodeSubmit(code) {
    errorMsg.classList.remove('visible');
    codeInput.classList.remove('error', 'success');

    if (!code) {
      showError();
      return;
    }

    if (VALID_CODES[code]) {
      codeInput.classList.add('success');
      codeInput.disabled = true;
      setTimeout(function () {
        launchTransition();
      }, 400);
    } else {
      showError();
    }
  }

  function showError() {
    codeInput.classList.add('error');
    errorMsg.classList.add('visible');
    codeInput.focus();
    setTimeout(function () {
      codeInput.classList.remove('error');
    }, 600);
  }

  /* ----------------------------------------
     DOM: Showcase
     ---------------------------------------- */
  var showcase    = document.getElementById('kva-showcase');
  var stepOld     = document.getElementById('showcase-old');
  var stepLogo    = document.getElementById('showcase-logo');
  var stepNew     = document.getElementById('showcase-new');

  var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----------------------------------------
     Transition: Entry → Showcase → Document
     ---------------------------------------- */
  function launchTransition() {
    // 1. Fire particles
    fireParticles();

    // 2. Exit entry screen
    entryScreen.classList.add('exit');

    setTimeout(function () {
      entryScreen.classList.add('hidden');

      // Skip showcase if reduced motion
      if (prefersReduced || !showcase) {
        showDocument();
        return;
      }

      // 3. Start showcase
      runShowcase();
    }, 700);
  }

  function showDocument() {
    kvaDoc.classList.add('visible');
    if (footer) footer.classList.add('visible');
    initScrollReveal();
    setTimeout(triggerVisibleReveals, 200);
  }

  function runShowcase() {
    showcase.classList.add('active');

    // Load iframe
    var iframe = showcase.querySelector('iframe[data-src]');
    if (iframe) iframe.src = iframe.getAttribute('data-src');

    // Timeline (ms)
    var t = 0;

    // Step 1: Show old site
    setTimeout(function () {
      stepOld.classList.add('visible');
    }, t += 200);

    // Step 1b: Blur out old site
    setTimeout(function () {
      stepOld.classList.add('blur-out');
    }, t += 2200);

    // Step 1c: Hide old
    setTimeout(function () {
      stepOld.style.display = 'none';
    }, t += 800);

    // Step 2: Logo
    setTimeout(function () {
      stepLogo.classList.add('visible');
    }, t += 100);

    // Step 2b: Hide logo
    setTimeout(function () {
      stepLogo.classList.remove('visible');
    }, t += 1800);

    // Step 3: Modern preview
    setTimeout(function () {
      stepNew.classList.add('visible');
    }, t += 500);

    // Step 3b: Fade out showcase
    setTimeout(function () {
      showcase.style.opacity = '0';
      showcase.style.transition = 'opacity 0.6s ease';
    }, t += 2000);

    // Step 4: Show document
    setTimeout(function () {
      showcase.classList.remove('active');
      showcase.style.display = 'none';
      showDocument();
    }, t += 700);
  }

  /* ----------------------------------------
     Particle Effect (Canvas)
     ---------------------------------------- */
  function fireParticles() {
    if (!canvas) return;

    var ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.classList.add('active');

    var particles = [];
    var centerX = canvas.width / 2;
    var centerY = canvas.height / 2;
    var colors = ['#e8720c', '#f5a623', '#1a1a1a', '#e8720c', '#d06000', '#ffb84d'];
    var particleCount = 80;

    for (var i = 0; i < particleCount; i++) {
      var angle = (Math.PI * 2 * i) / particleCount + (Math.random() - 0.5) * 0.5;
      var speed = 3 + Math.random() * 8;
      var size = 2 + Math.random() * 5;
      particles.push({
        x: centerX,
        y: centerY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: size,
        color: colors[Math.floor(Math.random() * colors.length)],
        alpha: 1,
        decay: 0.012 + Math.random() * 0.015,
        gravity: 0.08 + Math.random() * 0.04,
        rotation: Math.random() * Math.PI * 2,
        rotSpeed: (Math.random() - 0.5) * 0.2,
        shape: Math.random() > 0.5 ? 'circle' : 'square'
      });
    }

    var startTime = Date.now();
    var duration = 2000;

    function animate() {
      var elapsed = Date.now() - startTime;
      if (elapsed > duration) {
        canvas.classList.remove('active');
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        return;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (var j = 0; j < particles.length; j++) {
        var p = particles[j];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += p.gravity;
        p.vx *= 0.99;
        p.alpha -= p.decay;
        p.rotation += p.rotSpeed;

        if (p.alpha <= 0) continue;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;

        if (p.shape === 'circle') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size, -p.size, p.size * 2, p.size * 2);
        }

        ctx.restore();
      }

      requestAnimationFrame(animate);
    }

    requestAnimationFrame(animate);
  }

  /* ----------------------------------------
     Scroll-Reveal for KVA Sections
     ---------------------------------------- */
  function initScrollReveal() {
    var reveals = document.querySelectorAll('.kva-reveal');

    if (!('IntersectionObserver' in window)) {
      // Fallback: show everything
      reveals.forEach(function (el) { el.classList.add('visible'); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');

          // Trigger counter animation for sum values
          var counters = entry.target.querySelectorAll('[data-count]');
          counters.forEach(function (el) {
            animateCounter(el);
          });

          observer.unobserve(entry.target);
        }
      });
    }, {
      threshold: 0.15,
      rootMargin: '0px 0px -40px 0px'
    });

    reveals.forEach(function (el) {
      observer.observe(el);
    });
  }

  function triggerVisibleReveals() {
    var reveals = document.querySelectorAll('.kva-reveal');
    reveals.forEach(function (el) {
      var rect = el.getBoundingClientRect();
      if (rect.top < window.innerHeight * 0.85) {
        el.classList.add('visible');

        var counters = el.querySelectorAll('[data-count]');
        counters.forEach(function (c) { animateCounter(c); });
      }
    });
  }

  /* ----------------------------------------
     Counter Animation
     ---------------------------------------- */
  function animateCounter(el) {
    if (el.dataset.counted) return;
    el.dataset.counted = 'true';

    var target = parseInt(el.dataset.count, 10);
    if (isNaN(target)) return;

    var prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) return;

    var duration = 1200;
    var startTime = null;
    var originalText = el.textContent;

    function formatEuro(val) {
      return val.toLocaleString('de-DE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      }) + ' EUR';
    }

    function step(timestamp) {
      if (!startTime) startTime = timestamp;
      var progress = Math.min((timestamp - startTime) / duration, 1);

      // Ease out cubic
      var eased = 1 - Math.pow(1 - progress, 3);
      var current = Math.round(eased * target);

      el.textContent = formatEuro(current);

      if (progress < 1) {
        requestAnimationFrame(step);
      } else {
        el.textContent = originalText;
        if (el.classList.contains('kva-total-value')) {
          el.classList.add('counting');
          setTimeout(function () {
            el.classList.remove('counting');
          }, 600);
        }
      }
    }

    requestAnimationFrame(step);
  }

})();
