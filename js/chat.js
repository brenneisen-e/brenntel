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

  // Der Chat öffnet sich nur auf Klick — die Startseite soll erst einmal
  // ohne Panel zu sehen sein.

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // "Titel – Erklärung" oder "Titel: Erklärung" → Titel hervorheben
  function formatListItem(text) {
    var m = text.match(/^(.{2,40}?)\s+[–—-]\s+(.+)$/) || text.match(/^([^:]{2,40}):\s+(.+)$/);
    if (m) {
      return '<strong>' + escapeHtml(m[1]) + ':</strong> ' + escapeHtml(m[2]);
    }
    return escapeHtml(text);
  }

  // Antworttext des Modells in Absätze und Listen umsetzen.
  // Es entsteht nur HTML aus escapetem Text — kein Markdown, keine Links.
  function formatReply(text) {
    var lines = String(text).replace(/\*\*/g, '').split(/\r?\n/);
    var html = '';
    var para = [];
    var list = null; // { type: 'ol' | 'ul', items: [] }

    function flushPara() {
      if (para.length) {
        html += '<p>' + escapeHtml(para.join(' ')) + '</p>';
        para = [];
      }
    }
    function flushList() {
      if (list) {
        html += '<' + list.type + ' class="chat-msg-list">' +
          list.items.map(function (it) { return '<li>' + formatListItem(it) + '</li>'; }).join('') +
          '</' + list.type + '>';
        list = null;
      }
    }

    lines.forEach(function (raw) {
      var line = raw.trim();
      if (!line) { flushPara(); flushList(); return; }
      var ol = line.match(/^(\d{1,2})[.)]\s+(.+)$/);
      var ul = line.match(/^[-•*]\s+(.+)$/);
      if (ol || ul) {
        flushPara();
        var type = ol ? 'ol' : 'ul';
        if (!list || list.type !== type) { flushList(); list = { type: type, items: [] }; }
        list.items.push(ol ? ol[2] : ul[1]);
      } else {
        flushList();
        para.push(line);
      }
    });
    flushPara();
    flushList();
    return html;
  }

  // Append a message element to the DOM. Returns the bubble el for streaming updates.
  function appendMessage(role, text, opts) {
    opts = opts || {};
    var wrap = document.createElement('div');
    wrap.className = 'chat-msg chat-msg-' + role + (opts.extra ? ' ' + opts.extra : '');
    var bubble = document.createElement('div');
    bubble.className = 'chat-msg-bubble';
    if (opts.typing) {
      bubble.innerHTML = '<span></span><span></span><span></span>';
    } else if (role === 'ai' && !opts.extra) {
      bubble.classList.add('chat-msg-formatted');
      bubble.innerHTML = formatReply(text);
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
        if (chip.getAttribute('data-intent') === 'process') {
          answerProcess(msg);
          return;
        }
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

  var PROCESS_STEPS = {
    de: {
      title: 'So läuft ein Projekt bei uns ab',
      steps: [
        ['Erstgespräch', 'Ziel, Zielgruppe und Anforderungen klären'],
        ['Konzept & Planung', 'Lösung, Umfang und Zeitplan skizzieren'],
        ['Design & Entwicklung', 'Gestaltung, Umsetzung und Inhalte'],
        ['Testing & Feedback', 'Prüfen, abstimmen, feinschleifen'],
        ['Launch & Support', 'Go-Live und Begleitung danach']
      ],
      foot: 'Wie intensiv jede Phase ist, hängt vom Projekt ab. Erzähl mir gern, was du vorhast.'
    },
    en: {
      title: 'How a project runs with us',
      steps: [
        ['First call', 'Goals, audience and requirements'],
        ['Concept & planning', 'Solution, scope and timeline'],
        ['Design & development', 'Visuals, build and content'],
        ['Testing & feedback', 'Review, refine, polish'],
        ['Launch & support', 'Go-live and ongoing care']
      ],
      foot: 'How intense each phase is depends on the project. Tell me what you have in mind.'
    }
  };

  function processCardHtml(lang) {
    var c = PROCESS_STEPS[lang] || PROCESS_STEPS.de;
    return '<div class="chat-steps">' +
      '<div class="chat-demo-title">' + escapeHtml(c.title) + '</div>' +
      '<ol class="chat-steps-list">' +
        c.steps.map(function (st) {
          return '<li><strong>' + escapeHtml(st[0]) + '</strong><span>' + escapeHtml(st[1]) + '</span></li>';
        }).join('') +
      '</ol>' +
      '<p class="chat-steps-foot">' + escapeHtml(c.foot) + '</p>' +
    '</div>';
  }

  function processCardText(lang) {
    var c = PROCESS_STEPS[lang] || PROCESS_STEPS.de;
    return c.title + '\n' + c.steps.map(function (st, i) {
      return (i + 1) + '. ' + st[0] + ' – ' + st[1];
    }).join('\n') + '\n' + c.foot;
  }

  // Feste Antwort auf die Ablauf-Frage: schneller und immer sauber formatiert
  async function answerProcess(text) {
    if (sending) return;
    sending = true;
    appendMessage('user', text);
    history.push({ role: 'user', content: text });
    hideSuggestions();
    input.value = '';
    autoGrow();

    var typingEl = appendTyping();
    await sleep(900);
    typingEl.remove();

    var lang = currentLang();
    appendHtmlMessage(processCardHtml(lang));
    history.push({ role: 'assistant', content: processCardText(lang) });
    sending = false;
    input.focus();
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
