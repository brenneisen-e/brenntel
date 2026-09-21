/* ========================================
   Mail-Generator — Bausteine, Vorschau, .eml, Vorlagen

   Gerendert wird ausschließlich über js/mail-layout.js. Was in der Vorschau
   steht, ist deshalb Zeichen für Zeichen das, was als .eml herunterkommt und
   was als Vorlage gespeichert wird — es gibt keinen zweiten Renderer, der
   davon abweichen könnte.
   ======================================== */
import { renderMailHtml, renderMailText, buildEml } from './mail-layout.js';

(function () {
  'use strict';

  /* ----------------------------------------
     Zugangscode — wie beim Rechnungsersteller rein clientseitig,
     also Sichtschutz und keine Sicherheit. Die Vorlagen hängen am
     Token der API, nicht hieran.
     ---------------------------------------- */
  var ACCESS_CODE = 'brenntel2026';
  var UNLOCK_KEY = 'brenntel-mg-unlocked';
  var DRAFT_KEY = 'brenntel-mg-draft';
  var TOKEN_KEY = 'brenntel-mg-token';
  var API = '/mailgen-api';

  var $ = function (id) { return document.getElementById(id); };

  var LEER = {
    subject: '',
    preheader: '',
    blocks: [{ type: 'text', text: '' }],
    footer: [
      'brenntel mediadesign GbR',
      'Schirmerstr. 18 · 50823 Köln',
      'kontakt@brenntelmediadesign.com · +49 171 5518420',
    ],
  };

  var BEZEICHNUNG = {
    text: 'Absatz',
    heading: 'Überschrift',
    list: 'Liste',
    note: 'Hinweis',
    button: 'Knopf',
    divider: 'Trenner',
  };

  var doc = null;

  /* ----------------------------------------
     Zugang
     ---------------------------------------- */
  var entry = $('mg-entry');
  var app = $('mg-app');

  function unlock() {
    entry.classList.add('hidden');
    app.hidden = false;
    init();
  }

  try {
    if (sessionStorage.getItem(UNLOCK_KEY) === 'yes') unlock();
  } catch (_) { /* Privater Modus: dann eben mit Code */ }

  $('mg-code-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var feld = $('mg-code-input');
    if (feld.value.trim().toLowerCase() === ACCESS_CODE) {
      try { sessionStorage.setItem(UNLOCK_KEY, 'yes'); } catch (_) {}
      unlock();
    } else {
      feld.classList.add('error');
      $('mg-error').classList.add('visible');
      setTimeout(function () { feld.classList.remove('error'); }, 600);
    }
  });

  /* ----------------------------------------
     Entwurf halten
     ---------------------------------------- */
  function ladeEntwurf() {
    try {
      var roh = localStorage.getItem(DRAFT_KEY);
      if (!roh) return JSON.parse(JSON.stringify(LEER));
      var gelesen = JSON.parse(roh);
      return {
        subject: String(gelesen.subject || ''),
        preheader: String(gelesen.preheader || ''),
        blocks: Array.isArray(gelesen.blocks) && gelesen.blocks.length
          ? gelesen.blocks
          : JSON.parse(JSON.stringify(LEER.blocks)),
        footer: Array.isArray(gelesen.footer) ? gelesen.footer : LEER.footer.slice(),
      };
    } catch (_) {
      return JSON.parse(JSON.stringify(LEER));
    }
  }

  function sichereEntwurf() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(doc)); } catch (_) {}
  }

  /* ----------------------------------------
     Editor
     ---------------------------------------- */
  var ICON = {
    hoch: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
    runter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M19 12l-7 7-7-7"/></svg>',
    weg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6"/></svg>',
  };

  function iconBtn(icon, titel, deaktiviert) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mg-icon-btn';
    b.title = titel;
    b.setAttribute('aria-label', titel);
    b.innerHTML = icon;
    if (deaktiviert) b.disabled = true;
    return b;
  }

  function feld(tag, wert, platzhalter, beiEingabe) {
    var el = document.createElement(tag);
    if (tag === 'textarea') {
      el.rows = 3;
      el.value = wert || '';
    } else {
      el.type = 'text';
      el.value = wert || '';
    }
    el.placeholder = platzhalter;
    el.addEventListener('input', function () {
      beiEingabe(el.value);
      aktualisiere();
    });
    return el;
  }

  function blockKarte(block, index) {
    var karte = document.createElement('div');
    karte.className = 'mg-block';

    var kopf = document.createElement('div');
    kopf.className = 'mg-block-head';
    var art = document.createElement('span');
    art.className = 'mg-block-kind';
    art.textContent = BEZEICHNUNG[block.type] || block.type;
    kopf.appendChild(art);

    var werkzeuge = document.createElement('div');
    werkzeuge.className = 'mg-block-tools';
    var hoch = iconBtn(ICON.hoch, 'Nach oben', index === 0);
    hoch.addEventListener('click', function () { verschiebe(index, -1); });
    var runter = iconBtn(ICON.runter, 'Nach unten', index === doc.blocks.length - 1);
    runter.addEventListener('click', function () { verschiebe(index, 1); });
    var weg = iconBtn(ICON.weg, 'Entfernen');
    weg.addEventListener('click', function () { entferne(index); });
    werkzeuge.appendChild(hoch);
    werkzeuge.appendChild(runter);
    werkzeuge.appendChild(weg);
    kopf.appendChild(werkzeuge);
    karte.appendChild(kopf);

    if (block.type === 'text' || block.type === 'note') {
      karte.appendChild(feld('textarea', block.text,
        block.type === 'note' ? 'Hervorgehobener Hinweis' : 'Leerzeile trennt Absätze',
        function (v) { block.text = v; }));
    } else if (block.type === 'heading') {
      karte.appendChild(feld('input', block.text, 'Überschrift',
        function (v) { block.text = v; }));
    } else if (block.type === 'list') {
      karte.appendChild(feld('textarea', (block.items || []).join('\n'), 'Ein Punkt je Zeile',
        function (v) { block.items = v.split('\n'); }));
    } else if (block.type === 'button') {
      karte.appendChild(feld('input', block.text, 'Beschriftung',
        function (v) { block.text = v; }));
      karte.appendChild(feld('input', block.url, 'https://…',
        function (v) { block.url = v; }));
    } else {
      var hinweis = document.createElement('p');
      hinweis.className = 'mg-block-empty';
      hinweis.textContent = 'Eine waagerechte Linie.';
      karte.appendChild(hinweis);
    }

    return karte;
  }

  function zeichneBloecke() {
    var behaelter = $('mg-blocks');
    behaelter.innerHTML = '';
    doc.blocks.forEach(function (block, i) {
      behaelter.appendChild(blockKarte(block, i));
    });
  }

  function verschiebe(index, richtung) {
    var ziel = index + richtung;
    if (ziel < 0 || ziel >= doc.blocks.length) return;
    var raus = doc.blocks.splice(index, 1)[0];
    doc.blocks.splice(ziel, 0, raus);
    zeichneBloecke();
    aktualisiere();
  }

  function entferne(index) {
    doc.blocks.splice(index, 1);
    if (!doc.blocks.length) doc.blocks.push({ type: 'text', text: '' });
    zeichneBloecke();
    aktualisiere();
  }

  function ergaenze(type) {
    var neu = { type: type };
    if (type === 'list') neu.items = [''];
    else if (type === 'button') { neu.text = ''; neu.url = ''; }
    else if (type !== 'divider') neu.text = '';
    doc.blocks.push(neu);
    zeichneBloecke();
    aktualisiere();
    // Ein neuer Baustein ohne Fokus heißt am Handy: erst suchen, dann tippen.
    var karten = $('mg-blocks').querySelectorAll('.mg-block');
    var letzte = karten[karten.length - 1];
    var eingabe = letzte && letzte.querySelector('textarea, input');
    if (eingabe) eingabe.focus();
  }

  /* ----------------------------------------
     Vorschau und Ausgabe
     ---------------------------------------- */
  function aktuellesDoc() {
    return {
      subject: doc.subject,
      preheader: doc.preheader,
      blocks: doc.blocks,
      footer: doc.footer,
    };
  }

  function aktualisiere() {
    $('mg-frame').srcdoc = renderMailHtml(aktuellesDoc());
    sichereEntwurf();
  }

  function melde(text, art) {
    var el = $('mg-status');
    el.textContent = text;
    el.className = 'mg-status' + (art ? ' is-' + art : '');
    if (text) setTimeout(function () {
      if (el.textContent === text) { el.textContent = ''; el.className = 'mg-status'; }
    }, 6000);
  }

  function dateiname() {
    var roh = (doc.subject || 'mail').trim().replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_');
    return (roh || 'mail').slice(0, 60) + '.eml';
  }

  function ladeEml() {
    var d = aktuellesDoc();
    var eml = buildEml({
      from: 'brenntel mediadesign <kontakt@brenntelmediadesign.com>',
      subject: d.subject,
      html: renderMailHtml(d),
      text: renderMailText(d),
    });
    var url = URL.createObjectURL(new Blob([eml], { type: 'message/rfc822' }));
    var a = document.createElement('a');
    a.href = url;
    a.download = dateiname();
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Erst freigeben, wenn der Download angestoßen ist.
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    melde('.eml gespeichert. Am Rechner in Thunderbird über „Als neue Nachricht bearbeiten“ öffnen.', 'ok');
  }

  async function kopiereHtml() {
    var html = renderMailHtml(aktuellesDoc());
    try {
      await navigator.clipboard.writeText(html);
      melde('HTML in der Zwischenablage.', 'ok');
    } catch (_) {
      melde('Kopieren hat der Browser abgelehnt — .eml herunterladen geht immer.', 'error');
    }
  }

  /* ----------------------------------------
     Vorlagen
     ---------------------------------------- */
  function token() {
    return $('mg-token').value.trim();
  }

  function meldeVorlage(text, art) {
    var el = $('mg-tpl-status');
    el.textContent = text;
    el.className = 'mg-status' + (art ? ' is-' + art : '');
  }

  async function api(methode, koerper) {
    var t = token();
    if (!t) {
      meldeVorlage('Ohne Token geht nichts — er steht als MAILGEN_TOKEN in den Pages-Einstellungen.', 'error');
      return null;
    }
    try { localStorage.setItem(TOKEN_KEY, t); } catch (_) {}

    var antwort = await fetch(API, {
      method: methode,
      headers: Object.assign(
        { Authorization: 'Bearer ' + t },
        koerper ? { 'Content-Type': 'application/json' } : {}
      ),
      body: koerper ? JSON.stringify(koerper) : undefined,
    });
    var text = await antwort.text();
    var daten = null;
    try { daten = JSON.parse(text); } catch (_) {}
    if (!antwort.ok) {
      meldeVorlage((daten && daten.error) || ('Fehler ' + antwort.status), 'error');
      return null;
    }
    return daten;
  }

  async function ladeVorlagen(still) {
    var daten = await api('GET');
    if (!daten) return null;
    zeichneVorlagen(daten.templates || []);
    if (!still) {
      var n = (daten.templates || []).length;
      meldeVorlage(n ? n + ' Vorlage(n) geladen.' : 'Noch keine Vorlage gespeichert.', 'ok');
    }
    return daten.templates || [];
  }

  function zeichneVorlagen(liste) {
    var behaelter = $('mg-tpl-list');
    behaelter.innerHTML = '';
    behaelter.hidden = !liste.length;
    liste.forEach(function (v) {
      var zeile = document.createElement('div');
      zeile.className = 'mg-tpl-item';

      var links = document.createElement('div');
      var name = document.createElement('strong');
      name.textContent = v.name;
      var wann = document.createElement('small');
      wann.textContent = v.subject || '—';
      links.appendChild(name);
      links.appendChild(wann);
      zeile.appendChild(links);

      var oeffnen = document.createElement('button');
      oeffnen.type = 'button';
      oeffnen.className = 'mg-btn mg-btn-ghost';
      oeffnen.textContent = 'Öffnen';
      oeffnen.disabled = !v.doc;
      oeffnen.title = v.doc ? 'Diese Vorlage bearbeiten' : 'Diese Vorlage enthält keine Bausteine';
      oeffnen.addEventListener('click', function () {
        doc = {
          subject: String(v.doc.subject || ''),
          preheader: String(v.doc.preheader || ''),
          blocks: Array.isArray(v.doc.blocks) && v.doc.blocks.length
            ? v.doc.blocks
            : JSON.parse(JSON.stringify(LEER.blocks)),
          footer: Array.isArray(v.doc.footer) ? v.doc.footer : LEER.footer.slice(),
        };
        $('mg-tpl-name').value = v.name;
        fuelleFelder();
        meldeVorlage('„' + v.name + '“ geöffnet.', 'ok');
      });
      zeile.appendChild(oeffnen);

      behaelter.appendChild(zeile);
    });
  }

  async function sichereVorlage() {
    var name = $('mg-tpl-name').value.trim();
    if (!name) {
      meldeVorlage('Die Vorlage braucht einen Namen.', 'error');
      $('mg-tpl-name').focus();
      return;
    }

    // Erst den aktuellen Stand holen, sonst löscht das Sichern einer Vorlage
    // alle anderen — geschrieben wird immer die vollständige Liste.
    var vorhanden = await ladeVorlagen(true);
    if (vorhanden === null) return;

    var d = aktuellesDoc();
    var eintrag = {
      name: name,
      subject: d.subject,
      html: renderMailHtml(d),
      text: renderMailText(d),
      doc: d,
    };
    var gleiche = vorhanden.filter(function (v) { return v.name === name; })[0];
    if (gleiche) eintrag.id = gleiche.id;

    var liste = vorhanden.filter(function (v) { return v.name !== name; }).concat([eintrag]);
    var antwort = await api('PUT', { templates: liste });
    if (!antwort) return;
    await ladeVorlagen(true);
    meldeVorlage('Gesichert. In der Mail-App unter „Vorlage“ zu finden.', 'ok');
  }

  /* ----------------------------------------
     Verdrahtung
     ---------------------------------------- */
  function fuelleFelder() {
    $('mg-subject').value = doc.subject;
    $('mg-preheader').value = doc.preheader;
    $('mg-footer').value = (doc.footer || []).join('\n');
    zeichneBloecke();
    aktualisiere();
  }

  function init() {
    doc = ladeEntwurf();
    fuelleFelder();

    try {
      var gemerkt = localStorage.getItem(TOKEN_KEY);
      if (gemerkt) $('mg-token').value = gemerkt;
    } catch (_) {}

    $('mg-subject').addEventListener('input', function (e) {
      doc.subject = e.target.value;
      aktualisiere();
    });
    $('mg-preheader').addEventListener('input', function (e) {
      doc.preheader = e.target.value;
      aktualisiere();
    });
    $('mg-footer').addEventListener('input', function (e) {
      doc.footer = e.target.value.split('\n');
      aktualisiere();
    });

    document.querySelectorAll('[data-add]').forEach(function (b) {
      b.addEventListener('click', function () { ergaenze(b.getAttribute('data-add')); });
    });

    var layout = document.querySelector('.mg-layout');
    function zeige(vorschau) {
      layout.classList.toggle('show-preview', vorschau);
      $('mg-tab-edit').classList.toggle('is-active', !vorschau);
      $('mg-tab-edit').setAttribute('aria-selected', String(!vorschau));
      $('mg-tab-preview').classList.toggle('is-active', vorschau);
      $('mg-tab-preview').setAttribute('aria-selected', String(vorschau));
    }
    $('mg-tab-edit').addEventListener('click', function () { zeige(false); });
    $('mg-tab-preview').addEventListener('click', function () { zeige(true); });

    $('mg-eml').addEventListener('click', ladeEml);
    $('mg-copy').addEventListener('click', kopiereHtml);
    $('mg-new').addEventListener('click', function () {
      if (!window.confirm('Alles leeren? Der aktuelle Entwurf ist danach weg.')) return;
      doc = JSON.parse(JSON.stringify(LEER));
      $('mg-tpl-name').value = '';
      fuelleFelder();
    });

    $('mg-tpl-save').addEventListener('click', sichereVorlage);
    $('mg-tpl-load').addEventListener('click', function () { ladeVorlagen(false); });
  }
})();
