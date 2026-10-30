/**
 * Cloudflare Pages Function — Projektcenter im Admin Center (/admin)
 *
 * GET  /projekte-api                         → Rechnungen und Angebotsstatus
 * POST /projekte-api  { action: 'save',    invoice }          → Rechnung anlegen/ändern
 * POST /projekte-api  { action: 'delete',  id }               → Rechnung löschen
 * POST /projekte-api  { action: 'angebot', code, status }     → Status eines Angebots
 * POST /projekte-api  { action: 'entwurf', prompt, draft?, angebot?, projects? }
 *                                                             → Rechnungsentwurf von Claude
 * POST /projekte-api  { action: 'nummer',  rname, angebot? }  → nächste Nummer für den Kunden
 *
 * Rechnungsnummern laufen je Kunde: RE-<Kürzel>-<Jahr>-<lfd. Nr.>, etwa
 * RE-CZ-2026-01 für die erste Rechnung an Czekalla 2026. So sieht ein Kunde
 * nur seine eigene Zählung. Mehrere Nummernkreise sind nach § 14 Abs. 4
 * Nr. 4 UStG zulässig, solange jede Nummer nur einmal vergeben wird.
 *
 * Zugang: Anmeldung im Admin Center (Sitzungs-Cookie, siehe _auth.js) oder
 * für Werkzeuge ohne Browser ein Bearer-Token (ADMIN_TOKEN bzw. MAILGEN_TOKEN).
 *
 * Nötig im Cloudflare-Dashboard:
 *   KV-Namespace  PROJEKTE      (Pages → Settings → Bindings)
 *   Secret        ANTHROPIC_API_KEY (für Entwürfe, derselbe wie beim Chat)
 * Optional:
 *   PROJEKT_MODEL — Claude-Modell für Entwürfe, Standard claude-opus-5-5
 *
 * Solange PROJEKTE fehlt, nimmt die Funktion den Vorlagenspeicher MAILGEN
 * des Mail-Generators. Die Daten liegen dort unter eigenen Schlüsseln und
 * stören die Vorlagen nicht.
 *
 * Ohne Anmeldung gibt es nichts: Hier liegen Kundendaten und Beträge, und
 * jeder Entwurf kostet API-Guthaben.
 */

import { store, authorized } from './_auth.js';

const KV_KEY = 'projektcenter-v1';
const MAX_BODY = 256 * 1024;
const MAX_INVOICES = 500;
const DEFAULT_MODEL = 'claude-opus-5-5';

const STATUSES = ['entwurf', 'versendet', 'bezahlt'];
const ANGEBOT_STATUSES = ['offen', 'angenommen', 'abgelehnt', 'ersetzt'];

function json(data, status, extra) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...(extra || {}),
    },
  });
}

/* ----------------------------------------
   Startbestand: Rechnungen, die vor dem Projektcenter entstanden sind.
   Jede wird genau einmal übernommen (Liste „seeded“), danach lässt sie
   sich wie jede andere bearbeiten oder löschen.
   ---------------------------------------- */
const SEED_INVOICES = [
  {
    id: 'seed-br-2026-001',
    number: 'BR-2026-001',
    date: '2026-07-20',
    service: 'Juli 2026',
    paystatus: 'open',
    rname: 'Malte Brenneisen',
    rstreet: 'Ohlendorffs Tannen 12',
    rcity: '22359 Hamburg',
    project: 'Nordantech',
    closing: 'Vielen Dank für die gute Zusammenarbeit!',
    greeting: 'Liebe Grüße',
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
      price: '4975',
    }],
    total: 4975,
    status: 'versendet',
  },
  {
    // Abschlag nach der App-Vorstellung am 28.10.2026: 50 % des
    // Gesamtpreises aus Angebot KVA-CZ-2611 (Architektur, Module A bis E),
    // auf Ansage Eike 30.10.2026. Ersetzt die früheren Fassungen unter
    // BR-2026-002 (vor dem Nummernkreis je Kunde).
    id: 'seed-re-cz-2026-01',
    replaces: ['seed-br-2026-002', 'seed-br-2026-002-v2'],
    number: 'RE-CZ-2026-01',
    date: '2026-10-30',
    service: '09.10. bis 28.10.2026',
    paystatus: 'open',
    rname: 'Czekalla Malereifachbetrieb',
    rextra: 'z. Hd. Elmar Czekalla',
    rstreet: 'Lehmbergstraße 25',
    rcity: '25548 Kellinghusen',
    remail: 'czekalla@malereifachbetrieb.de',
    project: 'Czekalla @ work',
    angebot: 'KVA-CZ-2611',
    intro: 'Lieber Elmar,\n\nwie am 28.10. bei der Vorstellung der App besprochen, berechnen wir dir mit dieser Rechnung ' +
      'die erste Hälfte des Gesamtpreises aus dem Angebot KVA‑CZ‑2611. Darunter steht, was bis zur Vorstellung fertig war.',
    closing: 'Vielen Dank für die tolle Zusammenarbeit! Wir freuen uns auf den Testlauf mit euch.',
    greeting: 'Viele Grüße',
    mailsubject: 'Rechnung RE-CZ-2026-01 – Abschlag Czekalla @ work',
    mailtext: 'Lieber Elmar,\n\nwie am 28.10. besprochen, findest du anbei die Rechnung über die erste Hälfte des Gesamtpreises ' +
      'von 11.500,00 €. Darin haben wir aufgeführt, was bis zur Vorstellung der App fertig war.\n\n' +
      'Die zweite Hälfte stellen wir bei Projektende in Rechnung.\n\nMelde dich jederzeit, wenn du Fragen hast.\n\nViele Grüße\nEike',
    items: [{
      title: 'Abschlagszahlung 1 von 2 (50 %) nach der App‑Vorstellung am 28.10.2026',
      // Was bis zur Vorstellung fertig war (Stand im Repo czekallaAtWork)
      details: 'Architektur: Infrastruktur bei Cloudflare, Backend mit Datenbank, Web‑App für iPhone, Android und Büro‑PC, automatische Tests und Deployment unter czekallaatwork.app\n' +
               'Android‑App mit automatischem Ausstempeln beim Verlassen der Baustelle\n' +
               'Modul A Zeiterfassung: Ein-, Aus- und Umstempeln mit Baustellenerkennung, Stempeln ohne Netz, Pausen nach Arbeitszeitgesetz\n' +
               'Modul A Büro‑Auswertung: Übersicht, Auswertungen nach Tag, Woche, Monat, Baustelle und Mitarbeiter, Lohnexport als CSV, Excel und PDF\n' +
               'Modul B Baustellen‑Controlling: Faktor je Mitarbeiter, effektive Stunden, Stundenbudget mit Ampel, Zusatzstunden mit Nachweis\n' +
               'Modul C Baustellenakte: Fotos, Dokumente und Notizen je Baustelle, geordnet nach Raum und Art\n' +
               'Modul D Wochen- und Einsatzplanung: Wochenplan für Baustellen und Mitarbeiter, Ansicht für den Fernseher im Teamraum\n' +
               'Modul E Urlaub und Krankmeldungen: Anträge und Genehmigung, Urlaubskonten, Stundenkonto und Anwesenheit\n' +
               'Dazu: Mitarbeiterverwaltung mit Einrichtung der Handys per QR‑Code, Aufgaben, Nachrichten und Mitteilungen aufs Handy, Datenschutz‑Paket mit Löschkonzept\n' +
               'Einführung: Handout und Vorführung „Ein Tag mit der App“ am 28.10.2026\n' +
               'Gesamtpreis laut Angebot KVA‑CZ‑2611: 11.500,00 €\n' +
               'Mit dieser Rechnung (Abschlag 1 von 2): 5.750,00 €\n' +
               'Noch abzurechnen mit der Schlussrechnung bei Projektende: 5.750,00 €',
      qty: '1',
      unit: 'Pauschal',
      price: '5750',
    }],
    total: 5750,
    status: 'entwurf',
  },
];

async function loadState(kv) {
  const roh = await kv.get(KV_KEY);
  let state = { updatedAt: null, invoices: [], angebote: {}, seeded: [] };
  if (roh) {
    try {
      const gelesen = JSON.parse(roh);
      state = {
        updatedAt: gelesen.updatedAt || null,
        invoices: Array.isArray(gelesen.invoices) ? gelesen.invoices : [],
        angebote: gelesen.angebote && typeof gelesen.angebote === 'object' ? gelesen.angebote : {},
        seeded: Array.isArray(gelesen.seeded) ? gelesen.seeded : [],
      };
    } catch (_) {}
  }

  const neu = SEED_INVOICES.filter((seed) => state.seeded.indexOf(seed.id) === -1);
  if (neu.length) {
    neu.forEach((seed) => {
      state.seeded.push(seed.id);
      // Eine neuere Fassung ersetzt eine ältere nur, solange diese ein
      // unberührter Entwurf ist; Bearbeitetes oder Versendetes bleibt stehen
      // und die neue Fassung kommt dann nicht dazu
      const alt = state.invoices.findIndex((r) => (seed.replaces || []).indexOf(r.id) !== -1);
      if (alt !== -1) {
        const r = state.invoices[alt];
        if (r.status === 'entwurf' && r.updatedAt === r.createdAt &&
            !state.invoices.some((x) => x.number === seed.number)) {
          state.invoices[alt] = sanitizeInvoice(seed, null);
        }
        return;
      }
      if (!state.invoices.some((r) => r.number === seed.number)) {
        state.invoices.push(sanitizeInvoice(seed, null));
      }
    });
    await saveState(kv, state);
  }
  return state;
}

async function saveState(kv, state) {
  state.updatedAt = new Date().toISOString();
  await kv.put(KV_KEY, JSON.stringify(state));
  return state;
}

/* ----------------------------------------
   Rechnung bereinigen — nur die Felder, die der Rechnungseditor kennt
   ---------------------------------------- */
const str = (wert, max) => String(wert == null ? '' : wert).slice(0, max);
const isoDate = (wert) => (/^\d{4}-\d{2}-\d{2}$/.test(String(wert || '')) ? String(wert) : '');

function sanitizeItem(item) {
  return {
    title: str(item && item.title, 300),
    details: str(item && item.details, 4000),
    qty: str(item && item.qty, 20) || '1',
    unit: str(item && item.unit, 40) || 'Pauschal',
    price: str(item && item.price, 20),
  };
}

function sanitizeInvoice(eingang, vorher) {
  const e = eingang || {};
  const items = Array.isArray(e.items) ? e.items.slice(0, 40).map(sanitizeItem) : [];
  const status = STATUSES.indexOf(e.status) !== -1 ? e.status : (vorher && vorher.status) || 'entwurf';
  const total = Number(e.total);
  const jetzt = new Date().toISOString();
  return {
    id: str(e.id, 64) || (vorher && vorher.id) || crypto.randomUUID(),
    number: str(e.number, 40).trim(),
    date: isoDate(e.date),
    service: str(e.service, 120),
    paystatus: e.paystatus === 'paid' ? 'paid' : 'open',
    paiddate: isoDate(e.paiddate),
    rname: str(e.rname, 160),
    rextra: str(e.rextra, 160),
    rstreet: str(e.rstreet, 160),
    rcity: str(e.rcity, 160),
    remail: str(e.remail, 200),
    mailsubject: str(e.mailsubject, 300),
    mailtext: str(e.mailtext, 5000),
    intro: str(e.intro, 1500),
    closing: str(e.closing, 1000),
    greeting: str(e.greeting, 120),
    items,
    total: isFinite(total) ? Math.round(total * 100) / 100 : 0,
    project: str(e.project, 120).trim() || (vorher && vorher.project) || str(e.rname, 120).trim(),
    angebot: str(e.angebot, 40).trim() || (vorher && vorher.angebot) || '',
    status,
    sentAt: str(e.sentAt, 40) || (vorher && vorher.sentAt) || '',
    sentTo: str(e.sentTo, 200) || (vorher && vorher.sentTo) || '',
    // Zahlungseingang laut Projektcenter — unabhängig vom Zahlungsstatus auf
    // dem Blatt, damit eine versendete Rechnung unverändert bleibt
    paidAt: isoDate(e.paidAt) || (status === 'bezahlt' && vorher && vorher.paidAt) || '',
    createdAt: (vorher && vorher.createdAt) || jetzt,
    updatedAt: jetzt,
  };
}

/* ----------------------------------------
   Rechnungsnummer je Kunde: RE-<Kürzel>-<Jahr>-<NN>
   ---------------------------------------- */
const NUMMER_MUSTER = /^RE-([A-Z]{2,3})-(\d{4})-(\d+)$/;

function sameCustomer(a, b) {
  return String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();
}

// Kürzel aus dem Namen: Initialen der ersten beiden Wörter, Rechtsformen
// und Umlaute bereinigt („Malte Brenneisen“ → MB, „Nordantech“ → NO)
function kuerzelAusName(name) {
  const woerter = String(name || '')
    .replace(/Ä/g, 'AE').replace(/Ö/g, 'OE').replace(/Ü/g, 'UE')
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\b(GmbH|GbR|UG|AG|KG|OHG|e\.?\s?V\.?|mbH|Co\.?)\b/gi, ' ')
    .replace(/[^A-Za-z\s-]/g, ' ')
    .split(/[\s-]+/)
    .filter(Boolean);
  if (!woerter.length) return 'XX';
  if (woerter.length === 1) return woerter[0].slice(0, 2).toUpperCase();
  return (woerter[0][0] + woerter[1][0]).toUpperCase();
}

/**
 * Kürzel für einen Kunden. Vorrang: schon verwendetes Kürzel desselben
 * Kunden, dann das Kürzel aus dem Angebot (KVA-CZ-2611 → CZ), dann ein
 * Vorschlag (von Claude), zuletzt die Initialen. Ein Kürzel, das schon ein
 * anderer Kunde trägt, wird um einen Buchstaben verlängert.
 */
function kuerzelFuer(invoices, rname, angebot, vorschlag) {
  for (const r of invoices) {
    const m = String(r.number || '').match(NUMMER_MUSTER);
    if (m && sameCustomer(r.rname, rname)) return m[1];
  }
  const ausAngebot = String(angebot || '').match(/^KVA-([A-Z]{2})-/);
  let code = ausAngebot ? ausAngebot[1]
    : /^[A-Z]{2,3}$/.test(String(vorschlag || '')) ? vorschlag
    : kuerzelAusName(rname);

  const belegt = (k) => invoices.some((r) => {
    const m = String(r.number || '').match(NUMMER_MUSTER);
    return m && m[1] === k && !sameCustomer(r.rname, rname);
  });
  if (belegt(code)) {
    // weitere Buchstaben aus dem Namen (Malte Brenneisen: MBR, MBE …)
    const name = String(rname || '').toUpperCase().replace(/Ä/g, 'AE').replace(/Ö/g, 'OE')
      .replace(/Ü/g, 'UE').replace(/[^A-Z\s]/g, '').split(/\s+/).filter(Boolean);
    const buchstaben = (name.slice(1).join('').slice(1) + name.join('') + 'XYZ').split('');
    for (const b of buchstaben) {
      if (!belegt(code.slice(0, 2) + b)) { code = code.slice(0, 2) + b; break; }
    }
  }
  return code;
}

function nextNumber(invoices, code) {
  const jahr = new Date().getFullYear();
  let max = 0;
  invoices.forEach((r) => {
    const m = String(r.number || '').match(NUMMER_MUSTER);
    if (m && m[1] === code && Number(m[2]) === jahr) max = Math.max(max, Number(m[3]));
  });
  return 'RE-' + code + '-' + jahr + '-' + String(max + 1).padStart(2, '0');
}

/* ----------------------------------------
   Entwurf von Claude
   ---------------------------------------- */
const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Projektname, z. B. „Czekalla @ work“' },
    kuerzel: { type: 'string', description: 'Kundenkürzel aus 2 Großbuchstaben (A–Z), bei bekannten Kunden das vorhandene' },
    angebot: { type: 'string', description: 'Referenz des zugrunde liegenden Angebots oder leer' },
    rname: { type: 'string' },
    rextra: { type: 'string' },
    rstreet: { type: 'string' },
    rcity: { type: 'string' },
    remail: { type: 'string' },
    service: { type: 'string', description: 'Leistungsdatum oder -zeitraum, z. B. „Oktober 2026“' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          details: { type: 'string', description: 'Ein Punkt pro Zeile, durch \\n getrennt' },
          qty: { type: 'string' },
          unit: { type: 'string' },
          price: { type: 'string', description: 'Einzelpreis in Euro, z. B. „1100“ oder „85,50“' },
        },
        required: ['title', 'details', 'qty', 'unit', 'price'],
        additionalProperties: false,
      },
    },
    mailsubject: { type: 'string' },
    mailtext: { type: 'string' },
    hinweis: { type: 'string', description: 'Kurze Rückmeldung an Eike: Annahmen, offene Punkte. Leer, wenn nichts offen ist.' },
  },
  required: ['project', 'kuerzel', 'angebot', 'rname', 'rextra', 'rstreet', 'rcity', 'remail',
             'service', 'items', 'mailsubject', 'mailtext', 'hinweis'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `Du erstellst Rechnungsentwürfe für brenntel mediadesign GbR (Eike und Irena Brenneisen, Köln). Eike beschreibt in eigenen Worten, was berechnet werden soll. Du lieferst daraus die Felder für den Rechnungseditor.

Rahmen:
- Kleinunternehmer nach § 19 UStG: Preise sind Endbeträge, keine Umsatzsteuer ausweisen oder aufschlagen.
- Die Leistungsbeschreibung muss Art und Umfang so benennen, dass sie eindeutig und leicht nachprüfbar ist (§ 14 Abs. 4 Nr. 5 UStG). Je Position ein klarer Titel und darunter die wichtigsten Bestandteile, ein Punkt pro Zeile, ohne Aufzählungszeichen.
- Liegt ein Angebot bei, übernimm Empfänger, Projektname und die Formulierungen der Leistungen von dort. Berechne nur, was Eike nennt, zum Beispiel eine Abschlagszahlung oder einzelne Module. Bei einer Abschlagszahlung nenne im Titel, welcher Anteil von welchem Angebot berechnet wird.
- Einheit: „Pauschal“ für Festpreise, „Std.“ für Stunden. Menge und Preis als Zahl ohne Währungszeichen.
- Erfinde keine Adressen oder E-Mail-Adressen. Was du nicht weißt, bleibt leer und gehört in „hinweis“.
- Mailtext: kurz, freundlich, Ansprache wie im Angebot (du oder Sie), Gruß „Liebe Grüße“ bzw. „Viele Grüße“ und darunter „Eike und Irena“. Absätze durch Leerzeilen. Betreff im Stil „Rechnung {NR} – Projektname“. Schreibe für die Rechnungsnummer immer den Platzhalter {NR}, sie wird danach eingesetzt.
- Wird ein bestehender Entwurf mitgeschickt, ändere nur, was Eike verlangt, und gib den vollständigen Entwurf zurück.
- Schreibe in „hinweis“ höchstens zwei Sätze.`;

function buildUserMessage(body, kunden) {
  const teile = [];
  teile.push('Heute ist der ' + new Date().toISOString().slice(0, 10) + '.');
  if (kunden.length) {
    teile.push('Bekannte Kunden mit Kürzel: ' + kunden.join(', ') + '.');
  }
  if (Array.isArray(body.projects) && body.projects.length) {
    teile.push('Bestehende Projekte: ' + body.projects.slice(0, 40).map((p) => str(p, 120)).join(', ') + '.');
  }
  if (body.angebot && typeof body.angebot === 'object') {
    teile.push('Zugrunde liegendes Angebot:\n' + str(JSON.stringify(body.angebot, null, 2), 8000));
  }
  if (body.draft && typeof body.draft === 'object') {
    teile.push('Bisheriger Entwurf:\n' + str(JSON.stringify(body.draft, null, 2), 16000));
  }
  teile.push('Eikes Auftrag:\n' + str(body.prompt, 4000));
  return teile.join('\n\n');
}

async function draftWithClaude(env, body, kunden) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: env.PROJEKT_MODEL || DEFAULT_MODEL,
      max_tokens: 16000,
      fallbacks: 'default',
      output_config: {
        effort: 'medium',
        format: { type: 'json_schema', schema: DRAFT_SCHEMA },
      },
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: buildUserMessage(body, kunden) }],
    }),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const detail = data && data.error ? data.error.message : 'HTTP ' + response.status;
    throw new Error('Claude: ' + detail);
  }
  if (data.stop_reason === 'refusal') {
    throw new Error('Claude hat den Entwurf abgelehnt.');
  }
  if (data.stop_reason === 'max_tokens') {
    throw new Error('Der Entwurf wurde zu lang und ist abgebrochen.');
  }
  const text = (data.content || [])
    .filter((block) => block && block.type === 'text')
    .map((block) => block.text)
    .join('');
  try {
    return JSON.parse(text);
  } catch (_) {
    throw new Error('Claude hat keinen lesbaren Entwurf geliefert.');
  }
}

/* ----------------------------------------
   Anfrage
   ---------------------------------------- */
export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204 });
  }

  const kv = store(env);
  if (!kv) {
    return json({ error: 'Speicher nicht eingerichtet (KV-Bindung PROJEKTE fehlt).' }, 500);
  }
  if (!(await authorized(request, env))) {
    return json({ error: 'Nicht berechtigt' }, 401, { 'WWW-Authenticate': 'Bearer' });
  }

  if (request.method === 'GET') {
    const state = await loadState(kv);
    return json(state, 200);
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const roh = await request.text();
  if (roh.length > MAX_BODY) return json({ error: 'Anfrage zu groß' }, 413);
  let body;
  try {
    body = JSON.parse(roh);
  } catch (_) {
    return json({ error: 'Ungültiges JSON' }, 400);
  }

  const state = await loadState(kv);

  if (body.action === 'save') {
    const eingang = body.invoice || {};
    // Ohne passende ID zählt die Rechnungsnummer: Wer im Editor eine schon
    // bekannte Rechnung speichert oder versendet, aktualisiert sie statt sie
    // zu doppeln (auch wenn eine neuere Fassung die ID ersetzt hat)
    let index = eingang.id ? state.invoices.findIndex((r) => r.id === eingang.id) : -1;
    if (index === -1 && eingang.number) {
      index = state.invoices.findIndex((r) => r.number === String(eingang.number).trim());
      if (index !== -1) eingang.id = state.invoices[index].id;
    }
    const vorher = index === -1 ? null : state.invoices[index];
    const invoice = sanitizeInvoice(eingang, vorher);
    if (!invoice.number) {
      invoice.number = nextNumber(state.invoices, kuerzelFuer(state.invoices, invoice.rname, invoice.angebot));
    }
    const doppelt = state.invoices.some((r) => r.number === invoice.number && r.id !== invoice.id);
    if (doppelt) {
      return json({ error: 'Die Rechnungsnummer ' + invoice.number + ' ist schon vergeben.' }, 409);
    }
    if (index === -1) {
      if (state.invoices.length >= MAX_INVOICES) return json({ error: 'Zu viele Rechnungen' }, 400);
      state.invoices.push(invoice);
    } else {
      state.invoices[index] = invoice;
    }
    await saveState(kv, state);
    return json({ ok: true, invoice }, 200);
  }

  if (body.action === 'delete') {
    const vorher = state.invoices.length;
    state.invoices = state.invoices.filter((r) => r.id !== body.id);
    if (state.invoices.length === vorher) return json({ error: 'Rechnung nicht gefunden' }, 404);
    await saveState(kv, state);
    return json({ ok: true }, 200);
  }

  if (body.action === 'angebot') {
    const code = str(body.code, 40).trim();
    if (!/^KVA-[A-Z]{2}-\d{4}$/.test(code) || ANGEBOT_STATUSES.indexOf(body.status) === -1) {
      return json({ error: 'Ungültiges Angebot oder ungültiger Status' }, 400);
    }
    state.angebote[code] = { status: body.status, updatedAt: new Date().toISOString() };
    await saveState(kv, state);
    return json({ ok: true, angebote: state.angebote }, 200);
  }

  if (body.action === 'nummer') {
    const rname = str(body.rname, 160).trim();
    if (!rname) return json({ error: 'Bitte zuerst den Empfänger eintragen.' }, 400);
    const code = kuerzelFuer(state.invoices, rname, str(body.angebot, 40));
    return json({ ok: true, kuerzel: code, number: nextNumber(state.invoices, code) }, 200);
  }

  if (body.action === 'entwurf') {
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Claude ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt).' }, 500);
    }
    if (!str(body.prompt, 4000).trim()) {
      return json({ error: 'Bitte beschreiben, was berechnet werden soll.' }, 400);
    }
    const kunden = [];
    state.invoices.forEach((r) => {
      const m = String(r.number || '').match(NUMMER_MUSTER);
      const eintrag = m && r.rname ? r.rname + ' (' + m[1] + ')' : '';
      if (eintrag && kunden.indexOf(eintrag) === -1) kunden.push(eintrag);
    });
    try {
      const entwurf = await draftWithClaude(env, body, kunden);
      const items = Array.isArray(entwurf.items) ? entwurf.items.map(sanitizeItem) : [];
      // Eine schon vergebene Nummer bleibt, sonst die nächste für den Kunden
      const number = (body.draft && str(body.draft.number, 40).trim()) ||
        nextNumber(state.invoices, kuerzelFuer(state.invoices, entwurf.rname, entwurf.angebot,
                                               String(entwurf.kuerzel || '').toUpperCase()));
      const nr = (text) => String(text || '').replace(/\{NR\}/g, number);
      return json({
        ok: true,
        hinweis: str(entwurf.hinweis, 600),
        draft: {
          ...(body.draft && typeof body.draft === 'object' ? body.draft : {}),
          number,
          project: str(entwurf.project, 120),
          angebot: str(entwurf.angebot, 40),
          rname: str(entwurf.rname, 160),
          rextra: str(entwurf.rextra, 160),
          rstreet: str(entwurf.rstreet, 160),
          rcity: str(entwurf.rcity, 160),
          remail: str(entwurf.remail, 200),
          service: str(entwurf.service, 120),
          items,
          mailsubject: str(nr(entwurf.mailsubject), 300),
          mailtext: str(nr(entwurf.mailtext), 5000),
        },
      }, 200);
    } catch (err) {
      return json({ error: err.message || 'Entwurf fehlgeschlagen' }, 502);
    }
  }

  return json({ error: 'Unbekannte Aktion' }, 400);
}
