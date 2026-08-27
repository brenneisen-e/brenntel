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

  /* ----------------------------------------
     Startentwurf — die aktuell offene Rechnung.
     "Neue Rechnung" leert Empfänger + Positionen und zählt die Nummer hoch.
     ---------------------------------------- */
  var DEFAULT_DRAFT = {
    number: 'BR-2026-001',
    date: '2026-07-27',
    service: 'Juli 2026',
    paystatus: 'paid',
    paiddate: '2026-07-27',
    rname: 'Malte Brenneisen',
    rextra: '',
    rstreet: 'Ohlendorffs Tannen 12',
    rcity: '22359 Hamburg',
    closing: 'Vielen Dank für die gute Zusammenarbeit!',
    items: [{
      desc: 'Dienstleistungen Website-Aufbau — Konzeption, Entwicklung und technische Umsetzung',
      qty: '1',
      unit: 'Pauschal',
      price: '5000'
    }]
  };

  var SENDER_FIELDS = ['company', 'owners', 'street', 'city', 'email', 'phone',
                       'taxid', 'iban', 'holder', 'bank', 'vatmode', 'paydays'];
  var DRAFT_FIELDS = ['number', 'date', 'service', 'paystatus', 'paiddate',
                      'rname', 'rextra', 'rstreet', 'rcity', 'closing'];

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

  // "BR-2026-001" → "BR-2026-002" (Stellenzahl bleibt erhalten)
  function nextNumber(current) {
    var m = String(current || '').match(/^(.*?)(\d+)(\D*)$/);
    if (!m) return current;
    var digits = m[2];
    var incremented = String(Number(digits) + 1);
    while (incremented.length < digits.length) incremented = '0' + incremented;
    return m[1] + incremented + m[3];
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

  if (sessionStorage.getItem(UNLOCK_KEY) === 'yes') {
    unlock();
  }

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

  function init() {
    if (initialised) return;
    initialised = true;

    itemsWrap = $('re-items');

    restore();
    bindInputs();
    bindButtons();
    render();
  }

  function restore() {
    var sender = load(SENDER_KEY);
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
      '<label class="re-field"><span>Beschreibung</span>' +
        '<textarea class="re-i-desc" rows="2" placeholder="Was wurde geleistet?"></textarea>' +
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

    row.querySelector('.re-i-desc').value = data.desc || '';
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
          desc: row.querySelector('.re-i-desc').value,
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
      if (!window.confirm('Neue Rechnung anlegen? Empfänger und Positionen werden geleert, die Rechnungsnummer zählt hoch.')) return;

      $('f-number').value = nextNumber($('f-number').value);
      $('f-date').value = todayISO();
      $('f-paystatus').value = 'open';
      ['service', 'paiddate', 'rname', 'rextra', 'rstreet', 'rcity'].forEach(function (key) {
        $('f-' + key).value = '';
      });
      itemsWrap.innerHTML = '';
      addItem();
      onChange();
      $('f-rname').focus();
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

    /* --- Positionen --- */
    var tbody = $('p-items');
    tbody.innerHTML = '';
    var net = 0;
    var filled = 0;

    items.forEach(function (item) {
      var hasContent = item.desc.trim() || num(item.price) > 0;
      if (!hasContent) return;
      filled++;

      var amount = num(item.qty) * num(item.price);
      net += amount;

      var tr = document.createElement('tr');

      var tdPos = document.createElement('td');
      tdPos.textContent = filled;

      var tdDesc = document.createElement('td');
      tdDesc.className = 'desc';
      tdDesc.textContent = item.desc.trim();

      var tdQty = document.createElement('td');
      tdQty.className = 'num';
      tdQty.textContent = qty(num(item.qty));

      var tdUnit = document.createElement('td');
      tdUnit.className = 'unit';
      tdUnit.textContent = item.unit.trim();

      var tdPrice = document.createElement('td');
      tdPrice.className = 'num';
      tdPrice.textContent = euro(num(item.price));

      var tdTotal = document.createElement('td');
      tdTotal.className = 'num';
      tdTotal.textContent = euro(amount);

      [tdPos, tdDesc, tdQty, tdUnit, tdPrice, tdTotal].forEach(function (td) {
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });

    if (!filled) {
      var emptyRow = document.createElement('tr');
      var emptyCell = document.createElement('td');
      emptyCell.className = 're-doc-empty';
      emptyCell.colSpan = 6;
      emptyCell.textContent = 'Noch keine Positionen erfasst.';
      emptyRow.appendChild(emptyCell);
      tbody.appendChild(emptyRow);
    }

    /* --- Summen --- */
    var vat = isKlein ? 0 : net * 0.19;
    var total = net + vat;

    $('p-netrow').hidden = isKlein;
    $('p-vatrow').hidden = isKlein;
    $('p-net').textContent = euro(net);
    $('p-vat').textContent = euro(vat);
    $('p-total').textContent = euro(total);

    var hint = $('p-kleinhinweis');
    hint.hidden = !isKlein;
    hint.textContent = 'Gemäß § 19 UStG wird keine Umsatzsteuer berechnet.';

    /* --- Zahlung --- */
    var isPaid = v.paystatus === 'paid';

    if (isPaid) {
      $('p-payment').textContent = v.paiddate
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
      $('p-payment').textContent = dueText + ' Bitte gib dabei die Rechnungsnummer ' +
        (v.number || '') + ' an.';
    }

    // Bei bereits erhaltener Zahlung wäre eine IBAN nur verwirrend
    var bank = $('p-bank');
    bank.hidden = isPaid || !(v.iban || v.bank || v.holder);
    $('p-iban').textContent = v.iban;
    $('p-holder').textContent = v.holder;
    $('p-holder-wrap').hidden = !v.holder;
    $('p-bankname').textContent = v.bank;
    $('p-bankname-wrap').hidden = !v.bank;

    /* --- Abschluss + Fußzeile --- */
    $('p-closing').textContent = v.closing;
    $('p-owners').textContent = v.owners;
    $('p-foot-company').textContent = [v.company, v.owners].filter(Boolean).join(' · ');
    $('p-foot-addr').textContent = [v.street, v.city].filter(Boolean).join(' · ');
    $('p-foot-tax').textContent = v.taxid ? 'Steuernummer: ' + v.taxid : '';
    $('p-foot-contact').textContent = [v.email, v.phone].filter(Boolean).join(' · ');

    var described = items.filter(function (item) {
      return item.desc.trim() || num(item.price) > 0;
    }).every(function (item) {
      return !!item.desc.trim();
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
