/**
 * Cloudflare Pages Function — Projektcenter im Admin Center (/admin)
 *
 * GET  /projekte-api                         → Rechnungen und Angebotsstatus
 * POST /projekte-api  { action: 'save',    invoice }          → Rechnung anlegen/ändern
 * POST /projekte-api  { action: 'delete',  id }               → Rechnung löschen
 * POST /projekte-api  { action: 'angebot', code, status }     → Status eines Angebots
 * POST /projekte-api  { action: 'entwurf', prompt, draft?, angebot?, projects?, lastNumber? }
 *                                                             → Rechnungsentwurf von Claude
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
    // Abschlag nach MVP 1: 50 % des Gesamtpreises aus Angebot KVA-CZ-2611
    // (Architektur, Module A bis E), auf Ansage Eike 30.10.2026
    id: 'seed-br-2026-002',
    number: 'BR-2026-002',
    date: '2026-10-30',
    service: 'Oktober 2026 (MVP 1)',
    paystatus: 'open',
    rname: 'Czekalla Malereifachbetrieb',
    rextra: 'z. Hd. Elmar Czekalla',
    rstreet: 'Lehmbergstraße 25',
    rcity: '25548 Kellinghusen',
    remail: 'czekalla@malereifachbetrieb.de',
    project: 'Czekalla @ work',
    angebot: 'KVA-CZ-2611',
    closing: 'Vielen Dank für die gute Zusammenarbeit!',
    greeting: 'Viele Grüße',
    mailsubject: 'Rechnung BR-2026-002 – Abschlag Czekalla @ work',
    mailtext: 'Lieber Elmar,\n\nMVP 1 von Czekalla @ work steht, die App ist seit dieser Woche bei euch im Einsatz. ' +
      'Anbei findest du die Rechnung über die erste Hälfte des Gesamtpreises von 11.500,00 €.\n\n' +
      'Die zweite Hälfte stellen wir bei Projektende in Rechnung.\n\nMelde dich jederzeit, wenn du Fragen hast.\n\nViele Grüße\nEike',
    items: [{
      title: 'Abschlagszahlung 1 von 2 (50 %) nach MVP 1: App „Czekalla @ work“',
      details: 'Grundlage: Angebot KVA-CZ-2611 vom 13.10.2026, Gesamtpreis 11.500,00 €\n' +
               'Architektur: Infrastruktur, Backend, Android-App, Automatismen, Tests und Go-Live\n' +
               'Module A bis C: Zeiterfassung, Baustellen-Controlling und Baustellenakte\n' +
               'Module D und E: Wochen- und Einsatzplanung, Urlaub und Krankmeldungen\n' +
               'Die zweite Hälfte über 5.750,00 € wird bei Projektende fällig',
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
   Rechnungsnummer: BR-JJJJ-NNN, fortlaufend über gespeicherte Rechnungen
   und die zuletzt im Editor verwendete Nummer
   ---------------------------------------- */
function nextNumber(invoices, lastNumber) {
  const jahr = new Date().getFullYear();
  let max = 0;
  const nummern = invoices.map((r) => r.number).concat(lastNumber ? [lastNumber] : []);
  nummern.forEach((nr) => {
    const m = String(nr || '').match(/^BR-(\d{4})-(\d+)$/);
    if (m && Number(m[1]) === jahr) max = Math.max(max, Number(m[2]));
  });
  return 'BR-' + jahr + '-' + String(max + 1).padStart(3, '0');
}

/* ----------------------------------------
   Entwurf von Claude
   ---------------------------------------- */
const DRAFT_SCHEMA = {
  type: 'object',
  properties: {
    project: { type: 'string', description: 'Projektname, z. B. „Czekalla @ work“' },
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
  required: ['project', 'angebot', 'rname', 'rextra', 'rstreet', 'rcity', 'remail',
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
- Mailtext: kurz, freundlich, Ansprache wie im Angebot (du oder Sie), Gruß „Liebe Grüße“ bzw. „Viele Grüße“ und darunter „Eike und Irena“. Absätze durch Leerzeilen. Betreff im Stil „Rechnung BR-2026-002 – Projektname“.
- Wird ein bestehender Entwurf mitgeschickt, ändere nur, was Eike verlangt, und gib den vollständigen Entwurf zurück.
- Schreibe in „hinweis“ höchstens zwei Sätze.`;

function buildUserMessage(body, number) {
  const teile = [];
  teile.push('Heute ist der ' + new Date().toISOString().slice(0, 10) + '. Rechnungsnummer: ' + number + '.');
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

async function draftWithClaude(env, body, number) {
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
      messages: [{ role: 'user', content: buildUserMessage(body, number) }],
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
    // Ohne ID zählt die Rechnungsnummer: Wer im Editor eine schon bekannte
    // Rechnung speichert oder versendet, aktualisiert sie statt sie zu doppeln
    let index = eingang.id ? state.invoices.findIndex((r) => r.id === eingang.id) : -1;
    if (index === -1 && !eingang.id && eingang.number) {
      index = state.invoices.findIndex((r) => r.number === String(eingang.number).trim());
    }
    const vorher = index === -1 ? null : state.invoices[index];
    const invoice = sanitizeInvoice(eingang, vorher);
    if (!invoice.number) invoice.number = nextNumber(state.invoices, body.lastNumber);
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

  if (body.action === 'entwurf') {
    if (!env.ANTHROPIC_API_KEY) {
      return json({ error: 'Claude ist nicht eingerichtet (ANTHROPIC_API_KEY fehlt).' }, 500);
    }
    if (!str(body.prompt, 4000).trim()) {
      return json({ error: 'Bitte beschreiben, was berechnet werden soll.' }, 400);
    }
    const number = (body.draft && str(body.draft.number, 40).trim()) ||
                   nextNumber(state.invoices, body.lastNumber);
    try {
      const entwurf = await draftWithClaude(env, body, number);
      const items = Array.isArray(entwurf.items) ? entwurf.items.map(sanitizeItem) : [];
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
          mailsubject: str(entwurf.mailsubject, 300),
          mailtext: str(entwurf.mailtext, 5000),
        },
      }, 200);
    } catch (err) {
      return json({ error: err.message || 'Entwurf fehlgeschlagen' }, 502);
    }
  }

  return json({ error: 'Unbekannte Aktion' }, 400);
}
