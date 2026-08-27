/**
 * Cloudflare Pages Function — Rechnungsversand via Resend
 *
 * Nimmt vom Rechnungsersteller (/rechnung) eine fertig gerenderte PDF
 * entgegen und verschickt sie als Anhang an die angegebene Adresse.
 *
 * Einzige nötige Environment-Variable (Cloudflare Pages → Settings →
 * Environment variables, als "Secret"):
 *   RESEND_API_KEY  — API-Key von https://resend.com
 *
 * Absender, BCC und Empfänger kommen aus dem Formular, nicht aus der
 * Konfiguration.
 *
 * Missbrauchsschutz ohne weitere Konfiguration: Anfragen werden nur mit
 * einem Origin-Header aus ALLOWED_ORIGINS angenommen, und als Absender
 * sind nur eigene Domains erlaubt. Das hält fremde Seiten und einfache
 * Skripte draußen; wer den Header selbst setzt, kommt daran vorbei —
 * für echte Zugangskontrolle müsste Cloudflare Access vor /rechnung.
 */

const ALLOWED_ORIGINS = [
  'https://brenntel.pages.dev',
  'https://brenntelmediadesign.com',
  'https://www.brenntelmediadesign.com',
];

// Absenderdomains, über die verschickt werden darf
const ALLOWED_SENDER_DOMAINS = [
  'brenntelmediadesign.com',
  'brenneisen.info',
  'resend.dev',
];

const MAX_PDF_BASE64 = 8 * 1024 * 1024; // ~6 MB PDF

function isAllowedOrigin(origin) {
  if (!origin) return false;
  if (ALLOWED_ORIGINS.indexOf(origin) !== -1) return true;
  // lokale Entwicklung
  return /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': isAllowedOrigin(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400',
  };
}

function jsonResponse(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

// Akzeptiert "name@domain.de" und "Anzeigename <name@domain.de>"
function extractEmail(value) {
  const match = String(value).match(/<([^>]+)>\s*$/);
  return (match ? match[1] : String(value)).trim();
}

function senderDomainAllowed(from) {
  const email = extractEmail(from).toLowerCase();
  if (!isValidEmail(email)) return false;
  const domain = email.split('@')[1];
  return ALLOWED_SENDER_DOMAINS.some(
    (d) => domain === d || domain.endsWith('.' + d)
  );
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || '';
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }
  if (!isAllowedOrigin(origin)) {
    return jsonResponse({ error: 'Nicht berechtigt' }, 403, cors);
  }
  if (!env.RESEND_API_KEY) {
    return jsonResponse({ error: 'Mail service not configured' }, 500, cors);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid request body' }, 400, cors);
  }

  const to = (payload.to || '').toString().trim();
  const from = (payload.from || '').toString().trim();
  const bcc = (payload.bcc || '').toString().trim();
  const subject = (payload.subject || '').toString().trim();
  const message = (payload.message || '').toString().trim();
  const filename = (payload.filename || 'Rechnung.pdf').toString().trim();
  const pdfBase64 = (payload.pdfBase64 || '').toString();
  const replyTo = (payload.replyTo || '').toString().trim();

  if (!isValidEmail(to)) {
    return jsonResponse({ error: 'Ungültige Empfängeradresse' }, 400, cors);
  }
  if (!senderDomainAllowed(from)) {
    return jsonResponse(
      { error: 'Absenderadresse gehört nicht zu einer erlaubten Domain' },
      400,
      cors
    );
  }
  if (bcc && !isValidEmail(bcc)) {
    return jsonResponse({ error: 'Ungültige BCC-Adresse' }, 400, cors);
  }
  if (!subject || subject.length > 300) {
    return jsonResponse({ error: 'Betreff fehlt oder ist zu lang' }, 400, cors);
  }
  if (message.length > 5000) {
    return jsonResponse({ error: 'Nachricht zu lang' }, 400, cors);
  }
  if (!pdfBase64) {
    return jsonResponse({ error: 'PDF fehlt' }, 400, cors);
  }
  if (pdfBase64.length > MAX_PDF_BASE64) {
    return jsonResponse({ error: 'PDF zu groß' }, 413, cors);
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(pdfBase64)) {
    return jsonResponse({ error: 'PDF-Daten ungültig' }, 400, cors);
  }
  if (!/^[\w .,()-]+\.pdf$/i.test(filename)) {
    return jsonResponse({ error: 'Ungültiger Dateiname' }, 400, cors);
  }

  const textBody = message || 'Im Anhang findest du unsere Rechnung.';
  const htmlBody =
    `<div style="font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;` +
    `font-size:15px;line-height:1.65;color:#1a1410">` +
    `<p style="white-space:pre-wrap;margin:0 0 1.25rem">${escapeHtml(textBody)}</p>` +
    `<p style="margin:0;color:#6a5e52;font-size:13px">` +
    `Die Rechnung liegt dieser E-Mail als PDF bei.</p>` +
    `</div>`;

  const mail = {
    from,
    to: [to],
    subject,
    text: textBody,
    html: htmlBody,
    attachments: [{ filename, content: pdfBase64 }],
  };
  if (bcc) mail.bcc = [bcc];
  if (replyTo && isValidEmail(replyTo)) mail.reply_to = replyTo;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(mail),
    });

    const raw = await res.text();
    let body;
    try { body = JSON.parse(raw); } catch (_) { body = raw; }

    if (!res.ok) {
      return jsonResponse(
        { error: 'Versand fehlgeschlagen', status: res.status, detail: body },
        502,
        cors
      );
    }
    return jsonResponse({ ok: true, id: body && body.id, to }, 200, cors);
  } catch (err) {
    return jsonResponse({ error: 'Upstream request failed', detail: err.message }, 502, cors);
  }
}
