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

  function currentLang() {
    return (window.brenntelLang && window.brenntelLang.get()) || 'de';
  }

  function openPanel() {
    panel.classList.add('open');
    panel.setAttribute('aria-hidden', 'false');
    fab.classList.add('open');
    fab.setAttribute('aria-expanded', 'true');
    setTimeout(function () { input.focus(); }, 280);
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
