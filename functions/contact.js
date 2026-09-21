/**
 * Cloudflare Pages Function — Kontaktformular
 *
 * Nimmt das Formular auf der Startseite entgegen und schickt die Nachricht
 * weiter. Der Versand läuft über functions/_mail.js: Cloudflare Email Service
 * mit Resend als Rückfallebene — die nötigen Variablen stehen dort im Kopf.
 *
 * Als Antwortadresse steht die Adresse der anfragenden Person in der Mail.
 * Ein Klick auf „Antworten“ im Mailprogramm geht damit direkt an sie.
 *
 * Optional:
 *   MAIL_TO  — abweichendes Zielpostfach (Standard: eike@brenneisen.info)
 */

import { sendMail } from './_mail.js';

const ALLOWED_ORIGINS = [
  'https://brenntel.pages.dev',
  'https://brenntelmediadesign.com',
  'https://www.brenntelmediadesign.com',
  'http://localhost',
];

const RECIPIENT = 'eike@brenneisen.info';

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.some(
    (o) => origin === o || origin.startsWith(o + ':') || origin.startsWith('http://localhost')
  );
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
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

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || ALLOWED_ORIGINS[0];
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405, cors);
  }

  let payload;
  try {
    const contentType = request.headers.get('Content-Type') || '';
    if (contentType.includes('application/json')) {
      payload = await request.json();
    } else {
      const form = await request.formData();
      payload = Object.fromEntries(form.entries());
    }
  } catch (err) {
    return jsonResponse({ error: 'Invalid request body' }, 400, cors);
  }

  const name = (payload.name || '').toString().trim();
  const email = (payload.email || '').toString().trim();
  const subject = (payload.subject || '').toString().trim();
  const message = (payload.message || '').toString().trim();
  const privacy = payload.privacy;

  // Honeypot — silently accept if bots fill this hidden field.
  if (payload.website || payload.company_url) {
    return jsonResponse({ ok: true }, 200, cors);
  }

  if (!name || !email || !message) {
    return jsonResponse({ error: 'Missing required fields' }, 400, cors);
  }
  if (!isValidEmail(email)) {
    return jsonResponse({ error: 'Invalid email address' }, 400, cors);
  }
  if (!privacy || privacy === 'false' || privacy === 'off') {
    return jsonResponse({ error: 'Privacy policy must be accepted' }, 400, cors);
  }
  if (name.length > 200 || email.length > 200 || subject.length > 300 || message.length > 10000) {
    return jsonResponse({ error: 'Input too long' }, 400, cors);
  }

  const from = env.MAIL_FROM || env.RESEND_FROM || 'brenntel mediadesign <kontakt@brenntelmediadesign.com>';
  const recipient = env.MAIL_TO || RECIPIENT;
  const mailSubject = subject
    ? `Kontaktformular: ${subject}`
    : `Kontaktformular: Nachricht von ${name}`;

  const textBody =
    `Neue Nachricht über das Kontaktformular\n\n` +
    `Name: ${name}\n` +
    `E-Mail: ${email}\n` +
    (subject ? `Betreff: ${subject}\n` : '') +
    `\nNachricht:\n${message}\n`;

  const htmlBody =
    `<h2>Neue Nachricht über das Kontaktformular</h2>` +
    `<p><strong>Name:</strong> ${escapeHtml(name)}</p>` +
    `<p><strong>E-Mail:</strong> <a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></p>` +
    (subject ? `<p><strong>Betreff:</strong> ${escapeHtml(subject)}</p>` : '') +
    `<p><strong>Nachricht:</strong></p>` +
    `<p style="white-space:pre-wrap">${escapeHtml(message)}</p>`;

  const result = await sendMail(env, {
    from,
    to: recipient,
    replyTo: email,
    subject: mailSubject,
    text: textBody,
    html: htmlBody,
  });

  if (!result.ok) {
    const status = result.provider === 'keiner' ? 500 : 502;
    return jsonResponse(
      { error: 'Mail delivery failed', provider: result.provider, detail: result.error },
      status,
      cors
    );
  }

  return jsonResponse(
    { ok: true, provider: result.provider, id: result.id, from, to: recipient },
    200,
    cors
  );
}
