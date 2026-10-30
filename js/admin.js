/* ========================================
   Admin Center — Werkzeuge und Projektcenter
   Rechnungen und Angebotsstatus liegen über /projekte-api in Cloudflare KV,
   Entwürfe schreibt Claude über dieselbe Funktion. Geprüft und versendet
   wird im Rechnungseditor (/rechnung), der Entwurf wandert per localStorage
   dorthin und bleibt mit dem Projektcenter verknüpft.
   ======================================== */
(function () {
  'use strict';

  var CLAUDE_DRAFT_KEY = 'brenntel-ad-draft';

  // Schlüssel des Rechnungseditors (js/rechnung.js)
  var RE_DRAFT_KEY = 'brenntel-re-draft';
  var RE_SENDER_KEY = 'brenntel-re-sender';
  var RE_LINK_KEY = 'brenntel-re-link';
  var RE_UNLOCK_KEY = 'brenntel-re-unlocked';

  var API = '/projekte-api';
  var AUTH = '/admin-auth';

  /* ----------------------------------------
     Angebote — dieselben Seiten wie im Register VALID_CODES (js/kva.js).
     Neue Angebote hier mit Eckdaten nachtragen, damit Claude sie als
     Grundlage für Rechnungen kennt.
     ---------------------------------------- */
  var ANGEBOTE = [
    {
      code: 'KVA-CZ-2611',
      kind: 'Angebot',
      title: 'App „Czekalla @ work“ mit Personalplanung',
      project: 'Czekalla @ work',
      recipient: ['Czekalla Malereifachbetrieb', 'z. Hd. Elmar Czekalla', 'Lehmbergstraße 25', '25548 Kellinghusen'],
      anrede: 'du',
      date: '2026-10-13',
      valid: '2026-11-13',
      total: 11500,
      status: 'angenommen',
      leistungen: 'Architektur mit Infrastruktur, Backend, Android-App, Automatismen, Tests und Go-Live: 6.500 €. ' +
        'Module: A Zeiterfassung mit Büro-Auswertung 1.700 €, B Baustellen-Controlling 800 €, C Baustellenakte 500 €, ' +
        'D Wochen- und Einsatzplanung 900 €, E Urlaub und Krankmeldungen 1.100 €. ' +
        'Optional Betrieb durch brenntel für 150 € im Monat. Ersetzt KVA-CZ-2610.'
    },
    {
      code: 'KVA-CZ-2610',
      kind: 'Angebot',
      title: 'App „Czekalla @ work“ Zeiterfassung und Stundenkontrolle',
      project: 'Czekalla @ work',
      recipient: ['Czekalla Malereifachbetrieb', 'z. Hd. Elmar Czekalla', 'Lehmbergstraße 25', '25548 Kellinghusen'],
      anrede: 'du',
      date: '2026-10-08',
      valid: '2026-10-31',
      total: 9500,
      status: 'ersetzt',
      leistungen: 'Konzeption und Design 1.000 €, Zeiterfassung und Baustellenzuordnung 2.400 €, ' +
        'Faktor, Stundenbudget und Zusatzstunden 1.800 €, Büro: Dashboard, Verwaltung und Auswertungen 1.500 €, ' +
        'Baustellenakte 600 €, Android-App 1.000 €, Einrichtung, Testlauf und Einführung 700 €, ' +
        'Betreuung nach dem Go-Live 500 €.'
    },
    {
      code: 'KVA-FA-2609',
      kind: 'Kostenvoranschlag',
      title: 'Neue Website der Freiwilligen Feuerwehr Ahrensburg',
      project: 'Website Feuerwehr Ahrensburg',
      recipient: ['Freiwillige Feuerwehr Ahrensburg', 'z. Hd. Florian Stephani', 'Am Weinberg 2', '22926 Ahrensburg'],
      anrede: 'Sie',
      date: '2026-09-04',
      valid: '2026-09-30',
      total: 7950,
      status: 'offen',
      leistungen: 'Konzeption, UI/UX-Design und Freigabe 1.050 €, Entwicklung und Deployment 2.900 €, ' +
        'Content, Redaktion, Social-Media-Schnittstelle und Rechtliches 1.000 €, ' +
        'Foto- und Videoproduktion vor Ort 1.900 €, Go-Live-Begleitung und Support 1.100 €.'
    },
    {
      code: 'KVA-AF-2602',
      kind: 'Kostenvoranschlag',
      title: 'Frontend-Redesign almhuette-falkert.at mit Smoobu-Buchung und CMS',
      project: 'Website Almhütte Falkert',
      recipient: ['Almhütte Falkert', 'Natalie und Marcel'],
      anrede: 'ihr',
      date: '',
      valid: '',
      total: 5700,
      status: 'offen',
      leistungen: 'Frontend-Redesign für Murmeltierhütte und Steinbockhütte mit integriertem Smoobu-Buchungssystem und CMS.'
    }
  ];

  var STATUS_LABEL = {
    entwurf: 'Entwurf',
    versendet: 'Versendet',
    bezahlt: 'Bezahlt',
    ueberfaellig: 'Überfällig',
    offen: 'Offen',
    angenommen: 'Angenommen',
    abgelehnt: 'Abgelehnt',
    ersetzt: 'Ersetzt'
  };

  /* ----------------------------------------
     Helfer
     ---------------------------------------- */
  function $(id) { return document.getElementById(id); }

  function load(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
  }

  function store(key, value) {
    try {
      if (value === null) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function el(tag, cls, text) {
    var node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }

  // Akzeptiert "5.000,00", "5000,5", "5000.50" und "5000"
  function num(value) {
    if (typeof value === 'number') return value;
    var s = String(value || '').trim();
    if (!s) return 0;
    if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
    var n = parseFloat(s);
    return isNaN(n) ? 0 : n;
  }

  function euro(n) {
    return n.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  function formatDateDE(iso) {
    if (!iso) return '—';
    var p = iso.split('-');
    return p.length === 3 ? p[2] + '.' + p[1] + '.' + p[0] : iso;
  }

  function addDays(iso, days) {
    var p = (iso || todayISO()).split('-');
    var d = new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  function sender() {
    return load(RE_SENDER_KEY) || {};
  }

  // Wie im Rechnungseditor: Kleinunternehmer ohne USt, sonst 19 % auf netto
  function itemsTotal(items) {
    var net = (items || []).reduce(function (sum, item) {
      return sum + num(item.qty || 1) * num(item.price);
    }, 0);
    return sender().vatmode === 'ust19' ? net * 1.19 : net;
  }

  function invoiceTotal(inv) {
    return inv.total > 0 ? inv.total : itemsTotal(inv.items);
  }

  function payDays() {
    var d = parseInt(sender().paydays, 10);
    return isNaN(d) || d < 0 ? 14 : d;
  }

  // Bezahlte Rechnungen bleiben bezahlt; versendete gelten nach dem
  // Zahlungsziel als überfällig
  function invoiceState(inv) {
    if (inv.status === 'bezahlt' || inv.paystatus === 'paid') return 'bezahlt';
    if (inv.status === 'versendet') {
      return addDays(inv.date, payDays()) < todayISO() ? 'ueberfaellig' : 'versendet';
    }
    return 'entwurf';
  }

  function offerStatus(offer) {
    var saved = state.angebote[offer.code];
    return saved && saved.status ? saved.status : offer.status;
  }

  function findOffer(code) {
    for (var i = 0; i < ANGEBOTE.length; i++) {
      if (ANGEBOTE[i].code === code) return ANGEBOTE[i];
    }
    return null;
  }

  /* ----------------------------------------
     Anmeldung (functions/admin-auth.js)
     ---------------------------------------- */
  function postJSON(url, body) {
    return fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  function setAuthStatus(text, cls) {
    var node = $('ad-auth-status');
    node.textContent = text;
    node.className = 'ad-status' + (cls ? ' ' + cls : '');
  }

  var VIEW_SUB = {
    login: 'Bitte anmelden.',
    forgot: 'Wir schicken dir einen Link, mit dem du ein neues Kennwort festlegst.',
    reset: 'Lege dein Kennwort fest.'
  };

  function showView(view) {
    document.querySelectorAll('.ad-auth-form').forEach(function (form) {
      form.hidden = form.getAttribute('data-view') !== view;
    });
    $('ad-entry-sub').textContent = VIEW_SUB[view];
    setAuthStatus('', '');
    if (view === 'forgot') $('ad-forgot-email').value = $('ad-login-email').value;
    var first = document.querySelector('.ad-auth-form[data-view="' + view + '"] .ad-input');
    // Bei vorausgefüllter Adresse gleich ins Kennwortfeld
    if (view === 'login' && $('ad-login-email').value) first = $('ad-login-password');
    if (first) first.focus();
  }

  function showLoggedIn(email) {
    $('ad-entry').classList.add('hidden');
    $('ad-app').hidden = false;
    $('ad-account-email').textContent = email;
    init();
  }

  function showLoggedOut() {
    $('ad-app').hidden = true;
    $('ad-entry').classList.remove('hidden');
    showView(resetToken ? 'reset' : 'login');
  }

  // Link aus der Mail: /admin?reset=<token>
  var resetToken = new URLSearchParams(window.location.search).get('reset') || '';
  if (resetToken) history.replaceState(null, '', window.location.pathname);

  document.querySelectorAll('[data-goto]').forEach(function (btn) {
    btn.addEventListener('click', function () { showView(btn.getAttribute('data-goto')); });
  });

  function busy(form, on) {
    form.querySelectorAll('button').forEach(function (b) { b.disabled = on; });
  }

  $('ad-login').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    busy(form, true);
    setAuthStatus('Anmelden …', 'busy');
    postJSON(AUTH, {
      action: 'login',
      email: $('ad-login-email').value,
      password: $('ad-login-password').value
    }).then(function (data) {
      $('ad-login-password').value = '';
      setAuthStatus('', '');
      showLoggedIn(data.email);
    }).catch(function (err) {
      setAuthStatus(err.message, 'err');
      $('ad-login-password').select();
    }).then(function () { busy(form, false); });
  });

  $('ad-forgot').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    busy(form, true);
    setAuthStatus('Sende …', 'busy');
    postJSON(AUTH, { action: 'forgot', email: $('ad-forgot-email').value }).then(function (data) {
      setAuthStatus(data.message + ' Der Link gilt eine Stunde.', 'ok');
    }).catch(function (err) {
      setAuthStatus(err.message, 'err');
    }).then(function () { busy(form, false); });
  });

  $('ad-reset').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target;
    var pw = $('ad-reset-password').value;
    if (pw !== $('ad-reset-password2').value) {
      setAuthStatus('Die beiden Kennwörter stimmen nicht überein.', 'err');
      $('ad-reset-password2').focus();
      return;
    }
    busy(form, true);
    setAuthStatus('Speichere …', 'busy');
    postJSON(AUTH, { action: 'reset', token: resetToken, password: pw }).then(function (data) {
      resetToken = '';
      form.reset();
      setAuthStatus('', '');
      showLoggedIn(data.email);
    }).catch(function (err) {
      setAuthStatus(err.message, 'err');
    }).then(function () { busy(form, false); });
  });

  $('ad-logout').addEventListener('click', function () {
    postJSON(AUTH, { action: 'logout' }).catch(function () {}).then(function () {
      state = { invoices: [], angebote: {} };
      connected = false;
      showLoggedOut();
    });
  });

  /* ----------------------------------------
     API
     ---------------------------------------- */
  var state = { invoices: [], angebote: {} };
  var connected = false;

  function api(method, body) {
    return fetch(API, {
      method: method,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (res) {
      return res.text().then(function (raw) {
        var data;
        try { data = JSON.parse(raw); } catch (_) { data = null; }
        if (res.status === 401) {
          // Sitzung abgelaufen
          showLoggedOut();
          throw new Error('Bitte erneut anmelden.');
        }
        if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
        return data;
      });
    });
  }

  function setSync(text, cls) {
    var node = $('pc-sync');
    node.textContent = text;
    node.className = 'ad-sync' + (cls ? ' ' + cls : '');
  }

  function refresh() {
    setSync('Lade …', '');
    return api('GET').then(function (data) {
      state.invoices = Array.isArray(data.invoices) ? data.invoices : [];
      state.angebote = data.angebote || {};
      connected = true;
      setSync(data.updatedAt
        ? 'Verbunden · zuletzt geändert ' + new Date(data.updatedAt).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' })
        : 'Verbunden · noch keine Rechnungen gespeichert', 'ok');
      render();
    }).catch(function (err) {
      connected = false;
      setSync('Fehler: ' + err.message, 'err');
      render();
    });
  }

  function saveInvoice(invoice) {
    return api('POST', {
      action: 'save',
      invoice: invoice
    }).then(function (data) {
      var i = state.invoices.findIndex(function (r) { return r.id === data.invoice.id; });
      if (i === -1) state.invoices.push(data.invoice);
      else state.invoices[i] = data.invoice;
      render();
      return data.invoice;
    });
  }

  /* ----------------------------------------
     Übergabe an den Rechnungseditor
     ---------------------------------------- */
  var EDITOR_FIELDS = ['number', 'date', 'service', 'paystatus', 'paiddate',
                       'rname', 'rextra', 'rstreet', 'rcity', 'intro', 'closing', 'greeting',
                       'remail', 'mailsubject', 'mailtext'];

  function openInEditor(invoice) {
    var current = load(RE_DRAFT_KEY);
    var link = load(RE_LINK_KEY);
    // Ein offener, nicht verknüpfter Entwurf im Editor würde sonst
    // stillschweigend überschrieben
    var unsaved = current && current.number && !(link && link.id) &&
      current.number !== invoice.number &&
      !state.invoices.some(function (r) { return r.number === current.number; });
    if (unsaved && !window.confirm('Im Rechnungseditor liegt noch die Rechnung ' + current.number +
        ', die nicht im Projektcenter gespeichert ist. Trotzdem ersetzen?')) return;

    var draft = {};
    EDITOR_FIELDS.forEach(function (key) {
      draft[key] = typeof invoice[key] === 'string' ? invoice[key] : '';
    });
    draft.paystatus = draft.paystatus || 'open';
    draft.date = draft.date || todayISO();
    draft.closing = draft.closing || 'Vielen Dank für die gute Zusammenarbeit!';
    draft.greeting = draft.greeting || 'Liebe Grüße';
    draft.items = (invoice.items || []).map(function (item) {
      return { title: item.title, details: item.details, qty: item.qty, unit: item.unit, price: item.price };
    });

    store(RE_DRAFT_KEY, draft);
    store(RE_LINK_KEY, { id: invoice.id, number: invoice.number, project: invoice.project || '', angebot: invoice.angebot || '' });
    try { sessionStorage.setItem(RE_UNLOCK_KEY, 'yes'); } catch (_) {}
    window.location.href = 'rechnung.html';
  }

  /* ----------------------------------------
     Entwurf mit Claude
     ---------------------------------------- */
  var claudeDraft = null;
  var claudeHint = '';

  function offerContext(offer) {
    if (!offer) return null;
    return {
      referenz: offer.code,
      art: offer.kind,
      titel: offer.title,
      projekt: offer.project,
      empfaenger: offer.recipient,
      anrede: offer.anrede,
      datum: offer.date ? formatDateDE(offer.date) : '',
      gesamtbetrag: euro(offer.total),
      leistungen: offer.leistungen,
      status: offerStatus(offer),
      bisher_berechnet: state.invoices.filter(function (r) {
        return r.angebot === offer.code && invoiceState(r) !== 'entwurf';
      }).map(function (r) {
        return r.number + ': ' + euro(invoiceTotal(r));
      })
    };
  }

  function projectNames() {
    var names = {};
    ANGEBOTE.forEach(function (o) { names[o.project] = true; });
    state.invoices.forEach(function (r) { if (r.project) names[r.project] = true; });
    return Object.keys(names);
  }

  function setDraftStatus(text, cls) {
    var node = $('pc-draft-status');
    node.textContent = text;
    node.className = 'ad-status' + (cls ? ' ' + cls : '');
  }

  function requestDraft() {
    var prompt = $('pc-prompt').value.trim();
    if (!prompt) {
      setDraftStatus(claudeDraft ? 'Bitte beschreiben, was Claude ändern soll.' : 'Bitte beschreiben, was berechnet werden soll.', 'err');
      $('pc-prompt').focus();
      return;
    }

    var btn = $('pc-draft-btn');
    btn.disabled = true;
    setDraftStatus(claudeDraft ? 'Claude passt den Entwurf an …' : 'Claude schreibt den Entwurf …', 'busy');

    api('POST', {
      action: 'entwurf',
      prompt: prompt,
      draft: claudeDraft || undefined,
      angebot: offerContext(findOffer($('pc-angebot').value)),
      projects: projectNames()
    }).then(function (data) {
      var draft = data.draft;
      draft.date = draft.date || todayISO();
      draft.paystatus = draft.paystatus || 'open';
      if (draft.angebot && !findOffer(draft.angebot)) draft.angebot = '';
      claudeDraft = draft;
      claudeHint = data.hinweis || '';
      store(CLAUDE_DRAFT_KEY, { draft: claudeDraft, hint: claudeHint });
      $('pc-prompt').value = '';
      setDraftStatus('', '');
      renderDraft();
    }).catch(function (err) {
      setDraftStatus('Entwurf fehlgeschlagen: ' + err.message, 'err');
    }).then(function () {
      btn.disabled = false;
    });
  }

  function resetDraft() {
    claudeDraft = null;
    claudeHint = '';
    store(CLAUDE_DRAFT_KEY, null);
    $('pc-prompt').value = '';
    setDraftStatus('', '');
    renderDraft();
  }

  function draftAsInvoice() {
    var inv = {};
    Object.keys(claudeDraft).forEach(function (key) { inv[key] = claudeDraft[key]; });
    inv.total = Math.round(itemsTotal(inv.items) * 100) / 100;
    inv.status = inv.status || 'entwurf';
    return inv;
  }

  function saveDraft(thenOpen) {
    var btns = [$('pc-open-editor'), $('pc-save-draft')];
    btns.forEach(function (b) { b.disabled = true; });
    setDraftStatus('Speichere …', 'busy');
    saveInvoice(draftAsInvoice()).then(function (invoice) {
      claudeDraft.id = invoice.id;
      claudeDraft.number = invoice.number;
      if (thenOpen) {
        store(CLAUDE_DRAFT_KEY, null);
        openInEditor(invoice);
        return;
      }
      resetDraft();
      setDraftStatus('Entwurf ' + invoice.number + ' gespeichert.', 'ok');
    }).catch(function (err) {
      setDraftStatus('Speichern fehlgeschlagen: ' + err.message, 'err');
    }).then(function () {
      btns.forEach(function (b) { b.disabled = false; });
    });
  }

  function renderDraft() {
    var has = !!claudeDraft;
    $('pc-draft').hidden = !has;
    $('pc-draft-reset').hidden = !has;
    $('pc-draft-label').textContent = has ? 'Entwurf anpassen' : 'Entwurf erstellen';
    $('pc-prompt-label').textContent = has ? 'Was soll Claude ändern?' : 'Was soll berechnet werden?';
    $('pc-prompt').placeholder = has
      ? 'z. B. Position 2 auf 900 € setzen und im Mailtext siezen'
      : 'z. B. 50 % Abschlag auf das Angebot KVA-CZ-2611, Leistungszeitraum Oktober 2026, Mail an elmar@czekalla.de';
    if (!has) return;

    var d = claudeDraft;
    $('pc-draft-hint').hidden = !claudeHint;
    $('pc-draft-hint').textContent = claudeHint;
    $('pc-d-number').textContent = d.number;
    $('pc-d-meta').textContent = [formatDateDE(d.date), d.service, d.project, d.angebot]
      .filter(Boolean).join(' · ');

    var rec = $('pc-d-recipient');
    rec.textContent = '';
    [d.rname, d.rextra, d.rstreet, d.rcity].filter(Boolean).forEach(function (line, i) {
      rec.appendChild(el(i === 0 ? 'strong' : 'span', null, line));
    });
    if (!rec.childNodes.length) rec.appendChild(el('span', 'ad-muted', 'Noch kein Empfänger'));

    var list = $('pc-d-items');
    list.textContent = '';
    (d.items || []).forEach(function (item) {
      var li = el('li');
      var head = el('div', 'ad-draft-item-head');
      head.appendChild(el('strong', null, item.title || '—'));
      head.appendChild(el('span', null, euro(num(item.qty || 1) * num(item.price))));
      li.appendChild(head);
      var details = String(item.details || '').split('\n').filter(function (l) { return l.trim(); });
      if (details.length) li.appendChild(el('p', 'ad-muted', details.join(' · ')));
      list.appendChild(li);
    });

    $('pc-d-total').textContent = euro(itemsTotal(d.items));
    $('pc-d-to').textContent = d.remail || 'noch ohne Adresse';
    $('pc-d-subject').textContent = d.mailsubject || '';
    $('pc-d-text').textContent = d.mailtext || '';
  }

  /* ----------------------------------------
     Übersicht
     ---------------------------------------- */
  function badge(status) {
    return el('span', 'ad-badge ad-badge-' + status, STATUS_LABEL[status] || status);
  }

  function button(label, cls, onClick) {
    var b = el('button', 'ad-btn ' + (cls || 'ad-btn-ghost') + ' ad-btn-sm', label);
    b.type = 'button';
    b.addEventListener('click', onClick);
    return b;
  }

  function renderKpis() {
    var year = String(new Date().getFullYear());
    var open = 0, openCount = 0, overdue = 0, paid = 0, paidCount = 0;
    state.invoices.forEach(function (r) {
      var s = invoiceState(r);
      var total = invoiceTotal(r);
      if (s === 'versendet' || s === 'ueberfaellig') {
        open += total; openCount++;
        if (s === 'ueberfaellig') overdue++;
      }
      if (s === 'bezahlt' && String(r.paidAt || r.paiddate || r.date).slice(0, 4) === year) {
        paid += total; paidCount++;
      }
    });
    var offers = 0, offerCount = 0;
    ANGEBOTE.forEach(function (o) {
      if (offerStatus(o) === 'offen') { offers += o.total; offerCount++; }
    });

    $('kpi-year').textContent = year;
    $('kpi-open').textContent = connected ? euro(open) : '—';
    $('kpi-open-sub').textContent = connected
      ? openCount + (openCount === 1 ? ' Rechnung' : ' Rechnungen') + (overdue ? ', davon ' + overdue + ' überfällig' : '')
      : '';
    $('kpi-paid').textContent = connected ? euro(paid) : '—';
    $('kpi-paid-sub').textContent = connected ? paidCount + (paidCount === 1 ? ' Rechnung' : ' Rechnungen') : '';
    $('kpi-offers').textContent = euro(offers);
    $('kpi-offers-sub').textContent = offerCount + (offerCount === 1 ? ' Angebot' : ' Angebote');
  }

  function renderOfferSelect() {
    var select = $('pc-angebot');
    var current = select.value;
    select.textContent = '';
    select.appendChild(el('option', null, 'Kein Angebot'));
    select.firstChild.value = '';
    ANGEBOTE.forEach(function (o) {
      var opt = el('option', null, o.code + ' · ' + o.project + ' · ' + euro(o.total));
      opt.value = o.code;
      select.appendChild(opt);
    });
    select.value = current;
  }

  function renderProjects() {
    var wrap = $('pc-projects');
    wrap.textContent = '';
    var projects = {};
    var order = [];

    function project(name) {
      if (!projects[name]) {
        projects[name] = { name: name, client: '', offered: 0, billed: 0, paid: 0, docs: [] };
        order.push(name);
      }
      return projects[name];
    }

    ANGEBOTE.forEach(function (o) {
      var p = project(o.project);
      var s = offerStatus(o);
      p.client = p.client || o.recipient[0];
      if (s === 'offen' || s === 'angenommen') p.offered = Math.max(p.offered, o.total);
      p.docs.push({ label: o.code, status: s });
    });

    state.invoices.forEach(function (r) {
      var p = project(r.project || r.rname || 'Ohne Projekt');
      var s = invoiceState(r);
      p.client = p.client || r.rname;
      if (s !== 'entwurf') p.billed += invoiceTotal(r);
      if (s === 'bezahlt') p.paid += invoiceTotal(r);
      p.docs.push({ label: r.number, status: s });
    });

    order.forEach(function (name) {
      var p = projects[name];
      var card = el('article', 'ad-card ad-project');
      card.appendChild(el('h4', null, p.name));
      if (p.client && p.client !== p.name) card.appendChild(el('p', 'ad-muted', p.client));

      var nums = el('dl', 'ad-project-nums');
      [['Angeboten', p.offered], ['Berechnet', p.billed], ['Bezahlt', p.paid]].forEach(function (pair) {
        nums.appendChild(el('dt', null, pair[0]));
        nums.appendChild(el('dd', null, connected || pair[0] === 'Angeboten' ? euro(pair[1]) : '—'));
      });
      card.appendChild(nums);

      if (p.offered > 0) {
        var bar = el('div', 'ad-progress');
        bar.setAttribute('role', 'img');
        var share = Math.min(100, Math.round(p.billed / p.offered * 100));
        bar.setAttribute('aria-label', share + ' % des Angebots berechnet');
        var fill = el('span');
        fill.style.width = share + '%';
        bar.appendChild(fill);
        card.appendChild(bar);
      }

      var chips = el('div', 'ad-chips');
      p.docs.forEach(function (d) {
        var chip = el('span', 'ad-chip ad-chip-' + d.status, d.label);
        chip.title = STATUS_LABEL[d.status] || d.status;
        chips.appendChild(chip);
      });
      card.appendChild(chips);
      wrap.appendChild(card);
    });
  }

  function renderInvoices() {
    var wrap = $('pc-invoices');
    wrap.textContent = '';

    if (!connected) {
      wrap.appendChild(el('p', 'ad-empty', 'Rechnungen erscheinen, sobald das Projektcenter verbunden ist.'));
      return;
    }
    if (!state.invoices.length) {
      wrap.appendChild(el('p', 'ad-empty', 'Noch keine Rechnungen. Lass Claude oben eine erstellen oder speichere eine aus dem Rechnungseditor.'));
      return;
    }

    state.invoices.slice().sort(function (a, b) {
      return (b.date || '').localeCompare(a.date || '') || b.number.localeCompare(a.number);
    }).forEach(function (r) {
      var s = invoiceState(r);
      var row = el('article', 'ad-row');

      var main = el('div', 'ad-row-main');
      var title = el('div', 'ad-row-title');
      title.appendChild(el('strong', null, r.number));
      title.appendChild(badge(s));
      main.appendChild(title);
      main.appendChild(el('p', null, [r.rname, r.project && r.project !== r.rname ? r.project : ''].filter(Boolean).join(' · ') || '—'));
      var meta = [formatDateDE(r.date)];
      if (s === 'versendet' || s === 'ueberfaellig') meta.push('fällig ' + formatDateDE(addDays(r.date, payDays())));
      if (r.sentTo) meta.push('an ' + r.sentTo);
      if (s === 'bezahlt' && r.paidAt) meta.push('bezahlt am ' + formatDateDE(r.paidAt));
      main.appendChild(el('p', 'ad-muted', meta.join(' · ')));
      row.appendChild(main);

      row.appendChild(el('strong', 'ad-row-amount', euro(invoiceTotal(r))));

      var actions = el('div', 'ad-row-actions');
      actions.appendChild(button(s === 'entwurf' ? 'Prüfen und versenden' : 'Öffnen',
        s === 'entwurf' ? 'ad-btn-primary' : 'ad-btn-ghost', function () { openInEditor(r); }));
      if (s === 'versendet' || s === 'ueberfaellig') {
        actions.appendChild(button('Bezahlt', 'ad-btn-ghost', function () {
          var copy = JSON.parse(JSON.stringify(r));
          copy.status = 'bezahlt';
          copy.paidAt = todayISO();
          saveInvoice(copy).catch(function (err) { window.alert('Speichern fehlgeschlagen: ' + err.message); });
        }));
      }
      actions.appendChild(button('Löschen', 'ad-btn-quiet', function () {
        if (!window.confirm('Rechnung ' + r.number + ' aus dem Projektcenter löschen?')) return;
        api('POST', { action: 'delete', id: r.id }).then(function () {
          state.invoices = state.invoices.filter(function (x) { return x.id !== r.id; });
          var link = load(RE_LINK_KEY);
          if (link && link.id === r.id) store(RE_LINK_KEY, null);
          render();
        }).catch(function (err) { window.alert('Löschen fehlgeschlagen: ' + err.message); });
      }));
      row.appendChild(actions);
      wrap.appendChild(row);
    });
  }

  function renderOffers() {
    var wrap = $('pc-offers');
    wrap.textContent = '';

    ANGEBOTE.forEach(function (o) {
      var s = offerStatus(o);
      var row = el('article', 'ad-row');

      var main = el('div', 'ad-row-main');
      var title = el('div', 'ad-row-title');
      title.appendChild(el('strong', null, o.code));
      title.appendChild(badge(s));
      main.appendChild(title);
      main.appendChild(el('p', null, o.title));
      main.appendChild(el('p', 'ad-muted', [o.kind, o.recipient[0],
        o.date ? formatDateDE(o.date) : '', o.valid ? 'gültig bis ' + formatDateDE(o.valid) : '']
        .filter(Boolean).join(' · ')));
      row.appendChild(main);

      row.appendChild(el('strong', 'ad-row-amount', euro(o.total)));

      var actions = el('div', 'ad-row-actions');
      var select = el('select', 'ad-input ad-select-sm');
      select.setAttribute('aria-label', 'Status von ' + o.code);
      ['offen', 'angenommen', 'abgelehnt', 'ersetzt'].forEach(function (key) {
        var opt = el('option', null, STATUS_LABEL[key]);
        opt.value = key;
        select.appendChild(opt);
      });
      select.value = s;
      select.disabled = !connected;
      select.addEventListener('change', function () {
        api('POST', { action: 'angebot', code: o.code, status: select.value }).then(function (data) {
          state.angebote = data.angebote;
          render();
        }).catch(function (err) {
          select.value = s;
          window.alert('Speichern fehlgeschlagen: ' + err.message);
        });
      });
      actions.appendChild(select);

      var view = el('a', 'ad-btn ad-btn-ghost ad-btn-sm', 'Ansehen');
      view.href = '/kva?code=' + encodeURIComponent(o.code);
      actions.appendChild(view);

      actions.appendChild(button('Rechnung', 'ad-btn-ghost', function () {
        resetDraft();
        $('pc-angebot').value = o.code;
        $('pc-claude').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('pc-prompt').focus({ preventScroll: true });
      }));
      row.appendChild(actions);
      wrap.appendChild(row);
    });
  }

  function render() {
    renderKpis();
    renderProjects();
    renderInvoices();
    renderOffers();
  }

  /* ----------------------------------------
     Start
     ---------------------------------------- */
  var initialised = false;

  function init() {
    if (initialised) {
      refresh();
      return;
    }
    initialised = true;

    renderOfferSelect();

    var saved = load(CLAUDE_DRAFT_KEY);
    if (saved && saved.draft) {
      claudeDraft = saved.draft;
      claudeHint = saved.hint || '';
    }
    renderDraft();

    $('pc-reload').addEventListener('click', refresh);
    $('pc-draft-btn').addEventListener('click', requestDraft);
    $('pc-prompt').addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) requestDraft();
    });
    $('pc-draft-reset').addEventListener('click', resetDraft);
    $('pc-open-editor').addEventListener('click', function () { saveDraft(true); });
    $('pc-save-draft').addEventListener('click', function () { saveDraft(false); });

    // Von Hand: leerer Editor, ohne Verknüpfung zu einer gespeicherten Rechnung
    $('pc-new-manual').addEventListener('click', function () {
      try { sessionStorage.setItem(RE_UNLOCK_KEY, 'yes'); } catch (_) {}
    });

    render();
    refresh();
  }

  // Beim Laden: bestehende Sitzung? Der Link aus der Mail geht vor.
  if (resetToken) {
    showLoggedOut();
  } else {
    fetch(AUTH, { credentials: 'same-origin' }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (data) {
      if (data && data.email) showLoggedIn(data.email);
      else showLoggedOut();
    }).catch(showLoggedOut);
  }
})();
