/* ========================================
   brenntel AI Chat Widget
   ======================================== */
(function () {
  'use strict';

  var fab = document.getElementById('chat-fab');
  var panel = document.getElementById('chat-panel');
  var messagesEl = document.getElementById('chat-messages');
  var form = document.getElementById('chat-form');
  var input = document.getElementById('chat-input');
  var closeBtn = panel ? panel.querySelector('.chat-close') : null;
  var suggestions = document.getElementById('chat-suggestions');

  if (!fab || !panel || !messagesEl || !form || !input) return;

  var history = []; // { role: 'user' | 'assistant', content: string }
  var sending = false;
  var demoPlayed = false;

  function currentLang() {
    return (window.brenntelLang && window.brenntelLang.get()) || 'de';
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  function openPanel() {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    fab.classList.add('open');
    fab.setAttribute('aria-expanded', 'true');
    if (!demoPlayed) {
      demoPlayed = true;
      playDemo();
    }
  }

  function closePanel() {
    panel.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    fab.classList.remove('open');
    fab.setAttribute('aria-expanded', 'false');
  }

  fab.addEventListener('click', function () {
    if (panel.classList.contains('open')) closePanel();
    else openPanel();
  });

  if (closeBtn) closeBtn.addEventListener('click', closePanel);

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && panel.classList.contains('open')) closePanel();
  });

  // Auto-open on first downward scroll (desktop & mobile).
  // Only fires once — if the user closes the panel, we don't reopen it.
  var autoOpened = false;
  function autoOpen() {
    if (autoOpened) return;
    autoOpened = true;
    if (!panel.classList.contains('open')) openPanel();
  }

  var onFirstScroll = function () {
    if (window.scrollY > 40) {
      autoOpen();
      window.removeEventListener('scroll', onFirstScroll);
    }
  };
  window.addEventListener('scroll', onFirstScroll, { passive: true });

  // Append a message element to the DOM. Returns the bubble el for streaming updates.
  function appendMessage(role, text, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'chat-msg chat-msg-' + role + (opts.extra ? ' ' + opts.extra : '');
    var bubble = document.createElement('div');
    bubble.className = 'chat-msg-bubble';
    if (opts.typing) {
      bubble.innerHTML = '<span></span><span></span><span></span>';
    } else {
      bubble.textContent = text;
    }
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return wrap;
  }

  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  }

  input.addEventListener('input', autoGrow);

  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      form.requestSubmit();
    }
  });

  // Suggestion chips
  if (suggestions) {
    suggestions.querySelectorAll('.chat-chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        var lang = currentLang();
        var msg = chip.getAttribute('data-msg-' + lang) ||
                  chip.getAttribute('data-msg-de') || '';
        if (!msg) return;
        input.value = msg;
        form.requestSubmit();
      });
    });
  }

  function hideSuggestions() {
    if (suggestions) suggestions.classList.add('hide');
  }

  function showSuggestions() {
    if (suggestions) suggestions.classList.remove('hide');
  }

  function appendTyping() {
    return appendMessage('ai', '', { typing: true, extra: 'chat-msg-typing' });
  }

  function appendHtmlMessage(html) {
    var wrap = document.createElement('div');
    wrap.className = 'chat-msg chat-msg-ai';
    var bubble = document.createElement('div');
    bubble.className = 'chat-msg-bubble chat-msg-rich';
    bubble.innerHTML = html;
    wrap.appendChild(bubble);
    messagesEl.appendChild(wrap);
    messagesEl.scrollTop = messagesEl.scrollHeight;
    return wrap;
  }

  async function playDemo() {
    hideSuggestions();
    var lang = currentLang();

    // Step 1: typing → greeting
    var t1 = appendTyping();
    await sleep(1100);
    t1.remove();
    appendMessage('ai', lang === 'en'
      ? "Hey! Something like this could live on your site too ✨"
      : "Hey! Sowas kannst du auch auf deiner Website haben ✨"
    );

    // Step 2: typing → animated capabilities card
    await sleep(400);
    var t2 = appendTyping();
    await sleep(1300);
    t2.remove();

    var cardHtml =
      '<div class="chat-demo-card">' +
        '<div class="chat-demo-title">' +
          (lang === 'en' ? 'What we can build for you' : 'Was wir für dich bauen') +
        '</div>' +
        '<ul class="chat-demo-bars">' +
          '<li><span class="cd-label">' + (lang === 'en' ? 'Websites' : 'Websites') + '</span>' +
            '<span class="cd-bar"><i style="--w:92%"></i></span></li>' +
          '<li><span class="cd-label">' + (lang === 'en' ? 'Mobile & Guest Apps' : 'Mobile & Gäste-Apps') + '</span>' +
            '<span class="cd-bar"><i style="--w:84%"></i></span></li>' +
          '<li><span class="cd-label">' + (lang === 'en' ? 'AI integrations' : 'KI-Integrationen') + '</span>' +
            '<span class="cd-bar"><i style="--w:96%"></i></span></li>' +
          '<li><span class="cd-label">' + (lang === 'en' ? 'Branding & UX' : 'Branding & UX') + '</span>' +
            '<span class="cd-bar"><i style="--w:88%"></i></span></li>' +
        '</ul>' +
        '<div class="chat-demo-foot"><span class="chat-demo-dot"></span>' +
          (lang === 'en' ? 'Live on your site in weeks' : 'In wenigen Wochen live') +
        '</div>' +
      '</div>';
    appendHtmlMessage(cardHtml);

    // Step 3: invitation
    await sleep(900);
    var t3 = appendTyping();
    await sleep(900);
    t3.remove();
    appendMessage('ai', lang === 'en'
      ? "Tell me what you're planning — I'll point you in the right direction."
      : "Erzähl mir, was du vorhast — ich helfe dir weiter."
    );

    showSuggestions();
  }

  async function sendMessage(text) {
    if (sending) return;
    sending = true;

    appendMessage('user', text);
    history.push({ role: 'user', content: text });
    hideSuggestions();

    input.value = '';
    autoGrow();
    input.disabled = true;
    form.querySelector('.chat-send').disabled = true;

    var typingEl = appendMessage('ai', '', { typing: true, extra: 'chat-msg-typing' });

    try {
      var res = await fetch('/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: history,
          lang: currentLang(),
        }),
      });

      var raw = await res.text();
      var data;
      try { data = JSON.parse(raw); } catch (_) { data = null; }

      typingEl.remove();

      if (!res.ok || !data || !data.reply) {
        var errText = currentLang() === 'en'
          ? 'The chat is unavailable right now. Please try again in a moment or use the contact form.'
          : 'Der Chat ist gerade nicht erreichbar. Versuch es gleich nochmal oder nutz das Kontaktformular.';
        appendMessage('ai', errText, { extra: 'chat-msg-error' });
      } else {
        appendMessage('ai', data.reply);
        history.push({ role: 'assistant', content: data.reply });
      }
    } catch (err) {
      typingEl.remove();
      var errText2 = currentLang() === 'en'
        ? 'Connection failed. Please try again.'
        : 'Verbindung fehlgeschlagen. Bitte erneut versuchen.';
      appendMessage('ai', errText2, { extra: 'chat-msg-error' });
    } finally {
      sending = false;
      input.disabled = false;
      form.querySelector('.chat-send').disabled = false;
      input.focus();
    }
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var text = input.value.trim();
    if (!text) return;
    sendMessage(text);
  });
})();
