/**
 * Cloudflare Pages Function — Vorlagen des Mail-Generators
 *
 * GET  /mailgen-api  → die gespeicherten Vorlagen als JSON (liest die Mail-App)
 * PUT  /mailgen-api  → Vorlagen ersetzen (schreibt der Generator auf /mailgen)
 *
 * Nötig sind zwei Dinge im Cloudflare-Dashboard:
 *   KV-Namespace, gebunden als  MAILGEN      (Pages → Settings → Bindings)
 *   Secret                      MAILGEN_TOKEN (mindestens 24 Zeichen)
 *
 * Beides wird verlangt, nicht optional behandelt: Fehlt der Token, lehnt die
 * Funktion ab, statt auf „kein Schutz" zurückzufallen. Hier liegt der
 * Schriftverkehr einer Firma, und ein fehlendes Geheimnis darf sich nie
 * stillschweigend in einen offenen Endpunkt verwandeln.
 *
 * Der Origin-Trick der anderen Functions reicht dafür nicht: Die Mail-App ist
 * kein Browser und schickt keinen Origin-Header, den man prüfen könnte.
 */

const MAX_BYTES = 512 * 1024; // ~50 Vorlagen mit Layout
const MAX_TEMPLATES = 50;
const KV_KEY = 'templates-v1';
const MIN_TOKEN_LENGTH = 24;

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

/** Vergleich über SHA-256-Digests, damit die Laufzeit nichts über den Token verrät. */
async function tokenOk(request, env) {
  const erwartet = (env.MAILGEN_TOKEN || '').trim();
  if (erwartet.length < MIN_TOKEN_LENGTH) return false;

  const header = request.headers.get('Authorization') || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;

  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(match[1].trim())),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(erwartet)),
  ]);
  const x = new Uint8Array(a);
  const y = new Uint8Array(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.min(x.length, y.length); i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

/** Nimmt nur, was die App und der Generator wirklich lesen — nichts Fremdes durch. */
function sanitize(eintrag) {
  const str = (wert, max) => String(wert == null ? '' : wert).slice(0, max);
  const name = str(eintrag && eintrag.name, 120).trim();
  const html = str(eintrag && eintrag.html, 200 * 1024);
  if (!name || !html) return null;
  return {
    id: str(eintrag.id, 64) || crypto.randomUUID(),
    name,
    // 'signature' = nur der Block unter einer Mail, sonst eine ganze Vorlage.
    // Unbekanntes wird zu 'mail', damit die App nie raten muss.
    kind: eintrag && eintrag.kind === 'signature' ? 'signature' : 'mail',
    subject: str(eintrag.subject, 300),
    html,
    text: str(eintrag.text, 100 * 1024),
    // Die Bausteine, damit der Generator eine Vorlage wieder aufmachen kann.
    doc: eintrag.doc && typeof eintrag.doc === 'object' ? eintrag.doc : null,
    updatedAt: new Date().toISOString(),
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, {
      status: 204,
      headers: {
        'Access-Control-Allow-Origin': 'https://brenntelmediadesign.com',
        'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '86400',
      },
    });
  }

  if (!env.MAILGEN) {
    return json({ error: 'Vorlagenspeicher nicht eingerichtet (KV-Bindung MAILGEN fehlt).' }, 500);
  }
  if (!(await tokenOk(request, env))) {
    // Kein Hinweis darauf, ob der Token fehlt, zu kurz ist oder nicht passt.
    return json({ error: 'Nicht berechtigt' }, 401, { 'WWW-Authenticate': 'Bearer' });
  }

  if (request.method === 'GET') {
    const roh = await env.MAILGEN.get(KV_KEY);
    if (!roh) return json({ updatedAt: null, templates: [] }, 200);
    return new Response(roh, {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }

  if (request.method !== 'PUT') {
    return json({ error: 'Method not allowed' }, 405);
  }

  const roh = await request.text();
  if (roh.length > MAX_BYTES) {
    return json({ error: 'Vorlagen zu groß' }, 413);
  }

  let payload;
  try {
    payload = JSON.parse(roh);
  } catch (_) {
    return json({ error: 'Ungültiges JSON' }, 400);
  }

  const eingang = Array.isArray(payload && payload.templates) ? payload.templates : null;
  if (!eingang) return json({ error: 'Feld „templates" fehlt' }, 400);
  if (eingang.length > MAX_TEMPLATES) {
    return json({ error: `Höchstens ${MAX_TEMPLATES} Vorlagen` }, 400);
  }

  const templates = eingang.map(sanitize).filter(Boolean);
  const stand = { updatedAt: new Date().toISOString(), templates };
  await env.MAILGEN.put(KV_KEY, JSON.stringify(stand));

  return json({ ok: true, count: templates.length, updatedAt: stand.updatedAt }, 200);
}
