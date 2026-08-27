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

/* ----------------------------------------
   Gebrandete HTML-Mail
   Tabellenlayout und Inline-Styles, weil Outlook & Co. weder Flexbox,
   Grid noch <style>-Blöcke zuverlässig unterstützen.
   ---------------------------------------- */
const FONT = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

function metaRow(label, value, strong) {
  if (!value) return '';
  return (
    `<tr>` +
    `<td style="padding:7px 0;font:400 13px ${FONT};color:#6f665c">${escapeHtml(label)}</td>` +
    `<td align="right" style="padding:7px 0;font:${strong ? '700 17px' : '600 13px'} ${FONT};` +
    `color:#14100c;white-space:nowrap">${escapeHtml(value)}</td>` +
    `</tr>`
  );
}

function renderEmail(message, meta, filename) {
  // Leerzeilen trennen Absätze, einzelne Umbrüche bleiben Umbrüche
  const paragraphs = message
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map(
      (block) =>
        `<p style="margin:0 0 16px;font:400 15px/1.7 ${FONT};color:#14100c">` +
        escapeHtml(block).replace(/\n/g, '<br>') +
        `</p>`
    )
    .join('');

  const summary =
    metaRow('Rechnungsnummer', meta.number) +
    metaRow(meta.paid ? 'Betrag (bezahlt)' : 'Gesamtbetrag', meta.total, true) +
    (meta.paid
      ? metaRow('Erhalten am', meta.paidDate)
      : metaRow('Zahlbar bis', meta.dueDate));

  const footerLines = [
    [meta.company, meta.owners].filter(Boolean).join(' · '),
    [meta.street, meta.city].filter(Boolean).join(' · '),
    meta.taxid ? 'Steuernummer: ' + meta.taxid : '',
    [meta.email, meta.phone].filter(Boolean).join(' · '),
  ]
    .filter(Boolean)
    .map(
      (line) =>
        `<div style="font:400 11px/1.6 ${FONT};color:#8a8074">${escapeHtml(line)}</div>`
    )
    .join('');

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Rechnung</title></head>
<body style="margin:0;padding:0;background:#f5ecdb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5ecdb;">
<tr><td align="center" style="padding:32px 14px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
       style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;">

  <tr><td bgcolor="#e8720c" style="height:5px;line-height:5px;font-size:0;
      background:#e8720c;background:linear-gradient(90deg,#e8720c,#f5a623 55%,#e8720c);">&nbsp;</td></tr>

  <tr><td style="padding:30px 36px 0;">
    <div style="font:800 21px ${FONT};letter-spacing:-0.03em;color:#14100c;">
      brenntel<span style="color:#e8720c;">.</span>
      <span style="font-weight:300;color:#6f665c;">mediadesign</span>
    </div>
  </td></tr>

  <tr><td style="padding:26px 36px 0;">${paragraphs}</td></tr>

  ${summary
    ? `<tr><td style="padding:10px 36px 0;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#fdf6ec;border:1px solid #f3d9bb;border-radius:12px;">
      <tr><td style="padding:16px 20px;">
        <div style="font:700 9px ${FONT};letter-spacing:0.2em;text-transform:uppercase;
             color:#8a8074;padding-bottom:6px;">Rechnung</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${summary}</table>
      </td></tr>
    </table>
  </td></tr>`
    : ''}

  <tr><td style="padding:18px 36px 0;">
    <table role="presentation" cellpadding="0" cellspacing="0" border="0"
           style="border:1px solid #e6ded0;border-radius:9px;">
      <tr>
        <td style="padding:9px 12px 9px 14px;font:400 16px ${FONT};color:#e8720c;">&#128206;</td>
        <td style="padding:9px 16px 9px 0;font:600 13px ${FONT};color:#14100c;">
          ${escapeHtml(filename)}
        </td>
      </tr>
    </table>
  </td></tr>

  <tr><td style="padding:26px 36px 30px;">
    <div style="border-top:1px solid #e6ded0;padding-top:16px;">${footerLines}</div>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
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

  const meta = (payload.meta && typeof payload.meta === 'object') ? payload.meta : {};
  const textBody = message || 'Im Anhang findest du unsere Rechnung.';
  const htmlBody = renderEmail(textBody, meta, filename);

  // Klartext-Variante mit derselben Übersicht
  const textSummary = [
    meta.number ? 'Rechnungsnummer: ' + meta.number : '',
    meta.total ? (meta.paid ? 'Betrag (bezahlt): ' : 'Gesamtbetrag: ') + meta.total : '',
    meta.paid
      ? (meta.paidDate ? 'Erhalten am: ' + meta.paidDate : '')
      : (meta.dueDate ? 'Zahlbar bis: ' + meta.dueDate : ''),
  ].filter(Boolean).join('\n');

  const plainText =
    textBody +
    (textSummary ? '\n\n--\n' + textSummary : '') +
    '\n\nAnhang: ' + filename;

  const mail = {
    from,
    to: [to],
    subject,
    text: plainText,
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
