/* ========================================
   Rechnungsersteller — Editor, Live-Vorschau, Druck
   Alle Daten bleiben im Browser (localStorage), nichts geht an einen Server.
   ======================================== */
(function () {
  'use strict';

  /* ----------------------------------------
     Zugangscode — hier änderbar.
     Hinweis: rein clientseitig, also Sichtschutz, keine echte Sicherheit.
     ---------------------------------------- */
  var ACCESS_CODE = 'brenntel2026';
  var UNLOCK_KEY = 'brenntel-re-unlocked';
  var DRAFT_KEY = 'brenntel-re-draft';
  var SENDER_KEY = 'brenntel-re-sender';
  // Projektcenter im Admin Center (/admin): Verknüpfung zur gespeicherten Rechnung
  var LINK_KEY = 'brenntel-re-link';

  // Früherer Standardabsender: steht er noch im Browser, wird auf das eigene
  // Postfach umgestellt (seit dem Umzug zu Migadu, mit Ablage in „Gesendet“)
  var LEGACY_MAILFROM = 'brenntel mediadesign <kontakt@brenntelmediadesign.com>';

  /* ----------------------------------------
     Startentwurf — die aktuell offene Rechnung.
     "Neue Rechnung" leert Empfänger + Positionen und zählt die Nummer hoch.
     ---------------------------------------- */
  var DEFAULT_DRAFT = {
    number: 'BR-2026-001',
    date: '2026-07-20',
    service: 'Juli 2026',
    paystatus: 'open',
    paiddate: '',
    rname: 'Malte Brenneisen',
    rextra: '',
    rstreet: 'Ohlendorffs Tannen 12',
    rcity: '22359 Hamburg',
    closing: 'Vielen Dank für die gute Zusammenarbeit!',
    greeting: 'Liebe Grüße',
    remail: '',
    mailsubject: '',
    mailtext: 'Hallo Malte,\n\nvielen Dank für die gute Zusammenarbeit — anbei findest du unsere Rechnung als PDF.\n\nMelde dich jederzeit, wenn du Fragen hast.\n\nLiebe Grüße\nEike und Irena',
    items: [{
      title: 'Konzeption, Gestaltung und technische Umsetzung einer Website',
      details: 'Screendesign und responsives Layout für Desktop, Tablet und Mobile\n' +
               'Frontend-Entwicklung inklusive Integration sämtlicher Texte und Medien\n' +
               'Technische Grundeinrichtung: Seitenstruktur, Meta- und Open-Graph-Daten, SSL sowie datenschutzkonforme Einbindung eingesetzter Dienste\n' +
               'Qualitätssicherung: Cross-Browser- und Gerätetests, Performance-Optimierung\n' +
               'Launch-Begleitung und Übergabe',
      qty: '1',
      unit: 'Pauschal',
      price: '4975'
    }]
  };

  // Neutraler Anschreiben-Text ohne Namen — für neue Rechnungen und Reset
  var GENERIC_MAILTEXT =
    'Hallo,\n\nanbei findest du unsere Rechnung als PDF.\n\n' +
    'Melde dich jederzeit, wenn du Fragen hast.\n\nLiebe Grüße\nEike und Irena';

  // Frühere Standardtexte: steht so etwas noch im Browser-Speicher, war es
  // nie angepasst und wird durch den aktuellen Text ersetzt.
  var LEGACY_MAILTEXTS = [
    'Hallo,\n\nanbei unsere Rechnung als PDF. Bei Fragen melde dich gern jederzeit.\n\nViele Grüße\nEike und Irena'
  ];

  var SENDER_FIELDS = ['company', 'owners', 'street', 'city', 'email', 'phone',
                       'taxid', 'iban', 'holder', 'bank', 'vatmode', 'paydays',
                       'mailfrom', 'mailcc', 'mailbcc'];
  var DRAFT_FIELDS = ['number', 'date', 'service', 'paystatus', 'paiddate',
                      'rname', 'rextra', 'rstreet', 'rcity', 'intro', 'closing', 'greeting',
                      'remail', 'mailsubject', 'mailtext'];

  /* ----------------------------------------
     Helfer
     ---------------------------------------- */
  function $(id) { return document.getElementById(id); }

  function store(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
  }

  function load(key) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) { return null; }
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
    return n.toLocaleString('de-DE', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }) + ' €';
  }

  function qty(n) {
    return n.toLocaleString('de-DE', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2
    });
  }

  function todayISO() {
    var d = new Date();
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  function formatDateDE(iso) {
    if (!iso) return '—';
    var parts = iso.split('-');
    if (parts.length !== 3) return iso;
    return parts[2] + '.' + parts[1] + '.' + parts[0];
  }

  function addDays(iso, days) {
    var parts = (iso || todayISO()).split('-');
    var d = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    d.setDate(d.getDate() + days);
    return d.getFullYear() + '-' +
           String(d.getMonth() + 1).padStart(2, '0') + '-' +
           String(d.getDate()).padStart(2, '0');
  }

  /* ----------------------------------------
     Zugangs-Screen
     ---------------------------------------- */
  var entry = $('re-entry');
  var app = $('re-app');
  var codeForm = $('re-code-form');
  var codeInput = $('re-code-input');
  var errorMsg = $('re-error');

  function unlock() {
    entry.classList.add('hidden');
    app.hidden = false;
    init();
  }

  // Angemeldet im Admin Center (Sitzungs-Cookie): kein Code nötig
  var pcLoggedIn = false;

  if (sessionStorage.getItem(UNLOCK_KEY) === 'yes') {
    unlock();
  }

  fetch('/admin-auth', { credentials: 'same-origin' }).then(function (res) {
    pcLoggedIn = res.ok;
    if (!pcLoggedIn) return;
    if (app.hidden) unlock();
    else updatePcBar();
    refreshFromServer();
  }).catch(function () {});

  codeForm.addEventListener('submit', function (e) {
    e.preventDefault();
    if (codeInput.value.trim().toLowerCase() === ACCESS_CODE) {
      try { sessionStorage.setItem(UNLOCK_KEY, 'yes'); } catch (_) {}
      unlock();
    } else {
      codeInput.classList.add('error');
      errorMsg.classList.add('visible');
      setTimeout(function () { codeInput.classList.remove('error'); }, 600);
    }
  });

  /* ----------------------------------------
     App
     ---------------------------------------- */
  var itemsWrap, initialised = false;
  var currentTotal = 0;

  function init() {
    if (initialised) return;
    initialised = true;

    itemsWrap = $('re-items');

    restore();
    bindInputs();
    bindButtons();
    render();
    updatePcBar();
  }

  function restore() {
    var sender = load(SENDER_KEY);
    if (sender && sender.mailfrom === LEGACY_MAILFROM) delete sender.mailfrom;
    if (sender) {
      SENDER_FIELDS.forEach(function (key) {
        if (typeof sender[key] === 'string' && $('f-' + key)) {
          $('f-' + key).value = sender[key];
        }
      });
    }

    var draft = load(DRAFT_KEY) || DEFAULT_DRAFT;

    DRAFT_FIELDS.forEach(function (key) {
      var el = $('f-' + key);
      if (el && typeof draft[key] === 'string') el.value = draft[key];
    });

    if (!$('f-date').value) $('f-date').value = todayISO();

    // Nie angepasster Alt-Text: auf den aktuellen Standard heben
    if (LEGACY_MAILTEXTS.indexOf($('f-mailtext').value) !== -1) {
      $('f-mailtext').value = DEFAULT_DRAFT.mailtext;
    }

    var items = Array.isArray(draft.items) && draft.items.length
      ? draft.items
      : [{ desc: '', qty: '1', unit: 'Pauschal', price: '' }];
    items.forEach(addItem);
  }

  function save() {
    var sender = {};
    SENDER_FIELDS.forEach(function (key) {
      var el = $('f-' + key);
      if (el) sender[key] = el.value;
    });
    store(SENDER_KEY, sender);

    var draft = {};
    DRAFT_FIELDS.forEach(function (key) {
      var el = $('f-' + key);
      if (el) draft[key] = el.value;
    });
    draft.items = readItems();
    store(DRAFT_KEY, draft);
  }

  /* ----------------------------------------
     Positionen
     ---------------------------------------- */
  function addItem(data) {
    data = data || {};
    var row = document.createElement('div');
    row.className = 're-item';
    row.innerHTML =
      '<div class="re-item-head">' +
        '<span class="re-item-num"></span>' +
        '<button type="button" class="re-item-del" aria-label="Position entfernen">&times;</button>' +
      '</div>' +
      '<label class="re-field"><span>Leistung</span>' +
        '<input type="text" class="re-i-title" placeholder="z. B. Konzeption und Umsetzung einer Website">' +
      '</label>' +
      '<label class="re-field"><span>Details — eine Zeile pro Punkt</span>' +
        '<textarea class="re-i-details" rows="4" placeholder="Screendesign und responsives Layout&#10;Frontend-Entwicklung"></textarea>' +
      '</label>' +
      '<div class="re-item-grid">' +
        '<label class="re-field"><span>Menge</span>' +
          '<input type="text" class="re-i-qty" inputmode="decimal" placeholder="1"></label>' +
        '<label class="re-field"><span>Einheit</span>' +
          '<input type="text" class="re-i-unit" placeholder="Pauschal"></label>' +
        '<label class="re-field"><span>Einzelpreis €</span>' +
          '<input type="text" class="re-i-price" inputmode="decimal" placeholder="0,00"></label>' +
      '</div>' +
      '<div class="re-item-sum">Betrag: <strong>0,00 €</strong></div>';

    // Ältere Entwürfe hatten nur ein desc-Feld: erste Zeile wird zum Titel
    var title = data.title;
    var details = data.details;
    if (title === undefined && typeof data.desc === 'string') {
      var lines = data.desc.split('\n');
      title = (lines.shift() || '').trim();
      details = lines
        .map(function (l) { return l.replace(/^[\s·•-]+/, '').trim(); })
        .filter(Boolean)
        .join('\n');
    }

    row.querySelector('.re-i-title').value = title || '';
    row.querySelector('.re-i-details').value = details || '';
    row.querySelector('.re-i-qty').value = data.qty || '1';
    row.querySelector('.re-i-unit').value = data.unit || 'Pauschal';
    row.querySelector('.re-i-price').value = data.price || '';

    row.querySelectorAll('input, textarea').forEach(function (el) {
      el.addEventListener('input', onChange);
    });

    row.querySelector('.re-item-del').addEventListener('click', function () {
      row.remove();
      if (!itemsWrap.querySelector('.re-item')) addItem();
      renumberItems();
      onChange();
    });

    itemsWrap.appendChild(row);
    renumberItems();
  }

  function renumberItems() {
    Array.prototype.forEach.call(
      itemsWrap.querySelectorAll('.re-item'),
      function (row, i) {
        row.querySelector('.re-item-num').textContent = i + 1;
      }
    );
  }

  function readItems() {
    return Array.prototype.map.call(
      itemsWrap.querySelectorAll('.re-item'),
      function (row) {
        return {
          title: row.querySelector('.re-i-title').value,
          details: row.querySelector('.re-i-details').value,
          qty: row.querySelector('.re-i-qty').value,
          unit: row.querySelector('.re-i-unit').value,
          price: row.querySelector('.re-i-price').value
        };
      }
    );
  }

  /* ----------------------------------------
     Bindings
     ---------------------------------------- */
  function onChange() {
    save();
    render();
    scheduleSync();
  }

  function bindInputs() {
    SENDER_FIELDS.concat(DRAFT_FIELDS).forEach(function (key) {
      var el = $('f-' + key);
      if (el) {
        el.addEventListener('input', onChange);
        el.addEventListener('change', onChange);
      }
    });
  }

  function bindButtons() {
    $('re-add-item').addEventListener('click', function () {
      addItem();
      onChange();
    });

    $('re-new-btn').addEventListener('click', function () {
      if (!window.confirm('Neue Rechnung anlegen? Empfänger und Positionen werden geleert. Die Nummer wird für den neuen Kunden vergeben.')) return;

      // Nummernkreis je Kunde: die Nummer kommt, sobald der Empfänger steht
      $('f-number').value = '';
      $('f-date').value = todayISO();
      $('f-paystatus').value = 'open';
      ['service', 'paiddate', 'rname', 'rextra', 'rstreet', 'rcity', 'intro',
       'remail', 'mailsubject'].forEach(function (key) {
        $('f-' + key).value = '';
      });
      $('f-mailtext').value = GENERIC_MAILTEXT;
      // Neue Rechnung gehört (noch) zu keinem Eintrag im Projektcenter
      store(LINK_KEY, null);
      updatePcBar();
      itemsWrap.innerHTML = '';
      addItem();
      setSendStatus('', '');
      onChange();
      $('f-rname').focus();
    });

    $('re-reset-mailtext').addEventListener('click', function () {
      $('f-mailtext').value = GENERIC_MAILTEXT;
      onChange();
      $('f-mailtext').focus();
    });

    $('re-send-btn').addEventListener('click', function () {
      // Ohne Nummer erst eine für den Kunden holen, dann versenden
      if ($('f-number').value.trim() || !pcLoggedIn) return sendMail();
      assignNumber().then(sendMail, function () {});
    });

    $('re-number-btn').addEventListener('click', function () {
      if ($('f-number').value.trim() &&
          !window.confirm('Die Rechnung hat schon die Nummer ' + $('f-number').value.trim() + '. Durch die nächste Nummer für diesen Kunden ersetzen?')) return;
      assignNumber().catch(function () {});
    });

    $('re-pc-save').addEventListener('click', function () {
      pcSave({}).catch(function () {});
    });

    $('re-print-btn').addEventListener('click', function () {
      var original = document.title;
      document.title = 'Rechnung_' + ($('f-number').value || 'brenntel').replace(/\s+/g, '_');
      window.addEventListener('afterprint', function restoreTitle() {
        document.title = original;
        window.removeEventListener('afterprint', restoreTitle);
      });
      window.print();
    });
  }

  /* ----------------------------------------
     Versand per E-Mail (Cloudflare Email Service über /invoice-mail)
     ---------------------------------------- */
  function setSendStatus(text, cls) {
    var el = $('re-send-status');
    el.textContent = text;
    el.className = 're-send-status' + (cls ? ' ' + cls : '');
  }

  function safeFilename(number) {
    return 'Rechnung_' + (number || 'brenntel').replace(/[^\w.-]+/g, '_') + '.pdf';
  }

  // Erzeugt die PDF aus der Vorschau — im Aufnahme-Zustand, damit sie
  // exakt der gedruckten Fassung entspricht.
  function buildPdfBase64() {
    var sheet = $('re-sheet');
    sheet.classList.add('pdf-capture');

    function done(value, isError) {
      sheet.classList.remove('pdf-capture');
      if (isError) throw value;
      return value;
    }

    return html2pdf()
      .set({
        margin: [12, 12, 12, 12],
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        // Nicht „avoid-all“: Eine lange Position (z. B. eine Abschlagsrechnung
        // mit Leistungsstand) darf zwischen ihren Punkten umbrechen, statt als
        // Ganzes auf die nächste Seite zu springen. Zusammen bleiben einzelne
        // Punkte, Summe, Zahlung, Gruß und Fußzeile.
        pagebreak: {
          mode: ['css', 'legacy'],
          avoid: ['.re-doc-addr-row', '.re-doc-titlebar', '.re-doc-intro p', '.re-items-head',
                  '.re-item-title', '.re-item-details li', '.re-item-price', '.re-doc-empty',
                  '.re-doc-sums', '.re-doc-payment', '.re-doc-closing', '.re-doc-foot']
        }
      })
      .from(sheet)
      .outputPdf('datauristring')
      .then(function (uri) {
        return done(uri.substring(uri.indexOf(',') + 1), false);
      })
      .catch(function (err) {
        return done(err, true);
      });
  }

  function sendMail() {
    var btn = $('re-send-btn');
    var to = $('f-remail').value.trim();
    var number = $('f-number').value.trim();
    var subject = $('f-mailsubject').value.trim() ||
                  ('Rechnung ' + (number || '') + ' — brenntel mediadesign').replace(/\s+/g, ' ').trim();
    var message = $('f-mailtext').value;

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      setSendStatus('Bitte eine gültige E-Mail-Adresse des Empfängers eingeben.', 'err');
      $('f-remail').focus();
      return;
    }
    if (!$('f-mailfrom').value.trim()) {
      setSendStatus('Bitte den Absender für den Versand eintragen (Panel „Absender & Konto“).', 'err');
      return;
    }
    if (typeof html2pdf === 'undefined') {
      setSendStatus('PDF-Bibliothek konnte nicht geladen werden — bitte Seite neu laden.', 'err');
      return;
    }

    btn.disabled = true;
    setSendStatus('PDF wird erzeugt…', 'busy');

    buildPdfBase64()
      .then(function (pdfBase64) {
        setSendStatus('E-Mail wird gesendet…', 'busy');
        return fetch('/invoice-mail', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: to,
            from: $('f-mailfrom').value.trim(),
            cc: $('f-mailcc').value.trim(),
            bcc: $('f-mailbcc').value.trim(),
            subject: subject,
            message: message,
            filename: safeFilename(number),
            pdfBase64: pdfBase64,
            // Für die Rechnungs-Übersicht in der Mail
            meta: {
              number: number,
              total: $('p-total').textContent,
              paid: $('f-paystatus').value === 'paid',
              paidDate: formatDateDE($('f-paiddate').value),
              dueDate: formatDateDE(addDays($('f-date').value || todayISO(),
                                            parseInt($('f-paydays').value, 10) || 0)),
              company: $('f-company').value.trim(),
              owners: $('f-owners').value.trim(),
              street: $('f-street').value.trim(),
              city: $('f-city').value.trim(),
              email: $('f-email').value.trim(),
              phone: $('f-phone').value.trim(),
              taxid: $('f-taxid').value.trim()
            }
          })
        });
      })
      .then(function (res) {
        return res.text().then(function (raw) {
          var data;
          try { data = JSON.parse(raw); } catch (_) { data = null; }
          if (!res.ok) {
            throw new Error((data && (data.error || data.detail)) || ('HTTP ' + res.status));
          }
          return data;
        });
      })
      .then(function (data) {
        var sentText = 'Rechnung wurde an ' + to + ' gesendet' +
          (data && data.sentFolder ? ' und liegt in „Gesendet“' : '') + '.';
        setSendStatus(sentText, 'ok');
        // Im Projektcenter als versendet vermerken, sofern angemeldet
        if (!pcLoggedIn) return;
        return pcSave({
          status: $('f-paystatus').value === 'paid' ? 'bezahlt' : 'versendet',
          sentAt: new Date().toISOString(),
          sentTo: to
        }).then(function () {
          setSendStatus(sentText.replace(/\.$/, '') + ', im Projektcenter vermerkt.', 'ok');
        }, function () {
          setSendStatus(sentText + ' Im Projektcenter konnte sie nicht vermerkt werden.', 'ok');
        });
      })
      .catch(function (err) {
        setSendStatus('Versand fehlgeschlagen: ' + (err && err.message ? err.message : err), 'err');
      })
      .then(function () {
        btn.disabled = false;
      });
  }

  /* ----------------------------------------
     Projektcenter (/projekte-api)
     Eine aus dem Admin Center geöffnete Rechnung bleibt verknüpft: Änderungen
     werden kurz nach dem Tippen gespeichert, der Versand wird vermerkt.
     ---------------------------------------- */
  var syncTimer = null;

  function pcLink() {
    var link = load(LINK_KEY);
    return link && link.id ? link : null;
  }

  function setPc(text, cls) {
    var bar = $('re-pc');
    bar.className = 're-pc' + (cls ? ' ' + cls : '');
    $('re-pc-text').textContent = text;
  }

  function updatePcBar() {
    var bar = $('re-pc');
    var link = pcLink();
    bar.hidden = false;
    $('re-pc-save').hidden = !pcLoggedIn || !!link;

    if (!pcLoggedIn) {
      $('re-pc-text').innerHTML = 'Projektcenter nicht verbunden — <a href="admin.html">im Admin Center anmelden</a>';
      bar.className = 're-pc';
      return;
    }
    setPc(link ? 'Verknüpft mit dem Projektcenter' + (link.project ? ' · ' + link.project : '')
               : 'Nicht im Projektcenter gespeichert', '');
  }

  function scheduleSync() {
    if (!pcLink() || !pcLoggedIn) return;
    clearTimeout(syncTimer);
    setPc('Änderungen werden gespeichert …', '');
    syncTimer = setTimeout(function () {
      pcSave({}).catch(function () {});
    }, 1500);
  }

  // Nächste Nummer im Kreis des Kunden: RE-<Kürzel>-<Jahr>-<NN>
  function assignNumber() {
    if (!pcLoggedIn) {
      setPc('Nummern vergibt das Projektcenter — bitte im Admin Center anmelden.', 'err');
      return Promise.reject(new Error('nicht angemeldet'));
    }
    var link = pcLink();
    return fetch('/projekte-api', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'nummer', rname: $('f-rname').value, angebot: link ? link.angebot : '' })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
        $('f-number').value = data.number;
        onChange();
        return data.number;
      });
    }).catch(function (err) {
      setPc('Nummer: ' + err.message, 'err');
      throw err;
    });
  }

  // Eine verknüpfte Rechnung kommt beim Öffnen frisch aus dem Projektcenter:
  // Dort liegt der maßgebliche Stand (Änderungen werden laufend gespeichert,
  // eine überarbeitete Vorlage kann den Entwurf ersetzt haben)
  function refreshFromServer() {
    var link = pcLink();
    if (!link) return;
    fetch('/projekte-api', { credentials: 'same-origin' }).then(function (res) {
      return res.ok ? res.json() : null;
    }).then(function (data) {
      var inv = data && (data.invoices || []).filter(function (r) {
        return r.id === link.id || r.number === link.number;
      })[0];
      if (!inv) return;
      DRAFT_FIELDS.forEach(function (key) {
        if (typeof inv[key] === 'string' && $('f-' + key)) $('f-' + key).value = inv[key];
      });
      if (!$('f-date').value) $('f-date').value = todayISO();
      itemsWrap.innerHTML = '';
      (inv.items && inv.items.length ? inv.items : [{}]).forEach(addItem);
      store(LINK_KEY, { id: inv.id, number: inv.number, project: inv.project, angebot: inv.angebot });
      save();
      render();
      updatePcBar();
    }).catch(function () {});
  }

  function pcSave(extra) {
    clearTimeout(syncTimer);
    var link = pcLink();
    var invoice = {};
    DRAFT_FIELDS.forEach(function (key) {
      var el = $('f-' + key);
      if (el) invoice[key] = el.value;
    });
    invoice.items = readItems();
    invoice.total = currentTotal;
    if (link) {
      invoice.id = link.id;
      invoice.project = link.project || '';
      invoice.angebot = link.angebot || '';
    }
    Object.keys(extra || {}).forEach(function (key) { invoice[key] = extra[key]; });

    return fetch('/projekte-api', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'save', invoice: invoice })
    }).then(function (res) {
      return res.json().catch(function () { return null; }).then(function (data) {
        if (!res.ok) throw new Error((data && data.error) || ('HTTP ' + res.status));
        return data.invoice;
      });
    }).then(function (saved) {
      store(LINK_KEY, { id: saved.id, number: saved.number, project: saved.project, angebot: saved.angebot });
      updatePcBar();
      var time = new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
      setPc('Im Projektcenter gespeichert · ' + time + (saved.project ? ' · ' + saved.project : ''), 'ok');
      return saved;
    }).catch(function (err) {
      setPc('Projektcenter: ' + err.message, 'err');
      throw err;
    });
  }

  /* ----------------------------------------
     Vorschau rendern
     ---------------------------------------- */
  function render() {
    var v = {};
    SENDER_FIELDS.concat(DRAFT_FIELDS).forEach(function (key) {
      var el = $('f-' + key);
      v[key] = el ? el.value.trim() : '';
    });

    var items = readItems();
    var isKlein = v.vatmode !== 'ust19';

    // Betrag je Position im Editor mitschreiben
    Array.prototype.forEach.call(
      itemsWrap.querySelectorAll('.re-item'),
      function (row, i) {
        var item = items[i];
        row.querySelector('.re-item-sum strong').textContent =
          euro(num(item.qty) * num(item.price));
      }
    );

    /* --- Kopf --- */
    var senderLine = [v.company, v.street, v.city].filter(Boolean).join(' · ');
    $('p-senderline').textContent = senderLine;

    /* --- Empfänger --- */
    var recipient = $('p-recipient');
    recipient.innerHTML = '';
    var lines = [v.rname, v.rextra, v.rstreet, v.rcity].filter(Boolean);
    if (!lines.length) lines = ['—'];
    lines.forEach(function (line, i) {
      var p = document.createElement('p');
      if (i === 0) p.className = 're-doc-r-name';
      p.textContent = line;
      recipient.appendChild(p);
    });

    /* --- Meta --- */
    $('p-number').textContent = v.number || '—';
    $('p-number-title').textContent = v.number || '';
    $('p-date').textContent = formatDateDE(v.date);
    $('p-service').textContent = v.service || '—';
    $('p-taxid').textContent = v.taxid || '—';

    /* --- Positionen als gesetzte Blöcke --- */
    var list = $('p-items');
    list.innerHTML = '';
    var net = 0;
    var filled = 0;

    function el(tag, cls, text) {
      var node = document.createElement(tag);
      if (cls) node.className = cls;
      if (text !== undefined) node.textContent = text;
      return node;
    }

    items.forEach(function (item) {
      if (!item.title.trim() && !item.details.trim() && !(num(item.price) > 0)) return;
      filled++;

      var amount = num(item.qty) * num(item.price);
      net += amount;

      var row = el('div', 're-item-row');
      row.appendChild(el('span', 're-item-index', filled < 10 ? '0' + filled : String(filled)));

      var main = el('div', 're-item-main');
      main.appendChild(el('h3', 're-item-title', item.title.trim() || '—'));

      var detailLines = item.details.split('\n')
        .map(function (line) { return line.replace(/^[\s·•-]+/, '').trim(); })
        .filter(Boolean);
      if (detailLines.length) {
        var ul = el('ul', 're-item-details');
        detailLines.forEach(function (line) { ul.appendChild(el('li', null, line)); });
        main.appendChild(ul);
      }
      row.appendChild(main);

      var price = el('div', 're-item-price');
      price.appendChild(el('span', 're-item-qty',
        qty(num(item.qty)) + ' × ' + (item.unit.trim() || 'Pauschal')));
      price.appendChild(el('strong', 're-item-amount', euro(amount)));
      row.appendChild(price);

      list.appendChild(row);
    });

    if (!filled) {
      list.appendChild(el('div', 're-doc-empty', 'Noch keine Positionen erfasst.'));
    }

    /* --- Summen --- */
    var vat = isKlein ? 0 : net * 0.19;
    var total = net + vat;

    $('p-netrow').hidden = isKlein;
    $('p-vatrow').hidden = isKlein;
    $('p-net').textContent = euro(net);
    $('p-vat').textContent = euro(vat);
    $('p-total').textContent = euro(total);
    currentTotal = Math.round(total * 100) / 100;
    $('p-total-badge').textContent = euro(total);

    var hint = $('p-kleinhinweis');
    hint.hidden = !isKlein;
    hint.textContent = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

    /* --- Zahlung --- */
    var isPaid = v.paystatus === 'paid';

    var paymentEl = $('p-payment');
    paymentEl.textContent = '';

    // Die Rechnungsnummer darf nicht umbrechen — html2canvas rendert
    // umbrochene Tokens im PDF sonst überlagert.
    function appendNumber(prefix, suffix) {
      paymentEl.appendChild(document.createTextNode(prefix));
      var nr = document.createElement('span');
      nr.style.whiteSpace = 'nowrap';
      nr.textContent = v.number || '';
      paymentEl.appendChild(nr);
      paymentEl.appendChild(document.createTextNode(suffix));
    }

    if (isPaid) {
      paymentEl.textContent = v.paiddate
        ? 'Der Rechnungsbetrag wurde am ' + formatDateDE(v.paiddate) +
          ' vollständig erhalten. Diese Rechnung dient der Dokumentation, eine weitere Zahlung ist nicht erforderlich.'
        : 'Der Rechnungsbetrag wurde bereits vollständig erhalten. Eine weitere Zahlung ist nicht erforderlich.';
    } else {
      var days = parseInt(v.paydays, 10);
      if (isNaN(days) || days < 0) days = 14;
      var dueText = days === 0
        ? 'Der Betrag ist sofort nach Rechnungserhalt fällig.'
        : 'Bitte überweise den Betrag ohne Abzug bis zum ' +
          formatDateDE(addDays(v.date || todayISO(), days)) +
          ' (' + days + ' Tage).';
      appendNumber(dueText + ' Bitte gib dabei die Rechnungsnummer ', ' an.');
    }

    // Bei bereits erhaltener Zahlung wäre eine IBAN nur verwirrend
    var bank = $('p-bank');
    bank.hidden = isPaid || !(v.iban || v.bank || v.holder);
    $('p-iban').textContent = v.iban;
    $('p-holder').textContent = v.holder;
    $('p-holder-wrap').hidden = !v.holder;
    $('p-bankname').textContent = v.bank;
    $('p-bankname-wrap').hidden = !v.bank;

    /* --- Anrede: Leerzeilen trennen Absätze --- */
    var intro = $('p-intro');
    intro.textContent = '';
    v.intro.split(/\n{2,}/).map(function (t) { return t.trim(); }).filter(Boolean)
      .forEach(function (t) { intro.appendChild(el('p', null, t)); });
    intro.hidden = !intro.childNodes.length;

    /* --- Abschluss + Fußzeile --- */
    $('p-closing').textContent = v.closing;
    $('p-greeting').textContent = v.greeting || 'Liebe Grüße';
    $('p-owners').textContent = v.owners;
    $('p-foot-company').textContent = [v.company, v.owners].filter(Boolean).join(' · ');
    $('p-foot-addr').textContent = [v.street, v.city].filter(Boolean).join(' · ');
    $('p-foot-tax').textContent = v.taxid ? 'Steuernummer: ' + v.taxid : '';
    $('p-foot-contact').textContent = [v.email, v.phone].filter(Boolean).join(' · ');

    $('p-badge-label').textContent = isPaid ? 'Betrag (bezahlt)' : 'Gesamtbetrag';

    var described = items.filter(function (item) {
      return item.title.trim() || item.details.trim() || num(item.price) > 0;
    }).every(function (item) {
      return !!item.title.trim();
    });

    updateChecklist(v, filled, described, isPaid);
  }

  /* ----------------------------------------
     Pflichtangaben-Check (§ 14 UStG)
     ---------------------------------------- */
  function updateChecklist(v, itemCount, described, isPaid) {
    var state = {
      sender: !!(v.company && v.street && v.city),
      taxid: !!v.taxid,
      recipient: !!(v.rname && v.rstreet && v.rcity),
      number: !!v.number,
      date: !!v.date,
      service: !!v.service,
      items: itemCount > 0,
      desc: itemCount > 0 && described,
      iban: !!v.iban || isPaid
    };

    document.querySelectorAll('#re-checklist li').forEach(function (li) {
      li.classList.toggle('ok', !!state[li.getAttribute('data-check')]);
    });
  }
})();
