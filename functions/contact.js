/**
 * Cloudflare Pages Function — Contact Form via Resend
 *
 * Accepts POST from the contact form on the homepage and forwards
 * the message to eike@brenneisen.info using the Resend API.
 *
 * Required environment variables (configured in Cloudflare Pages):
 *   RESEND_API_KEY  — API key from https://resend.com
 *   RESEND_FROM     — Verified sender address, e.g. "kontakt@brenntelmediadesign.com"
 *                     (falls back to "onboarding@resend.dev" if unset)
 */

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

  if (!env.RESEND_API_KEY) {
    return jsonResponse({ error: 'Mail service not configured' }, 500, cors);
  }

  const from = env.RESEND_FROM || 'Kontaktformular <onboarding@resend.dev>';
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

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [RECIPIENT],
        reply_to: email,
        subject: mailSubject,
        text: textBody,
        html: htmlBody,
      }),
    });

    const resendBodyText = await resendRes.text();
    let resendBody;
    try { resendBody = JSON.parse(resendBodyText); } catch (_) { resendBody = resendBodyText; }

    if (!resendRes.ok) {
      return jsonResponse(
        {
          error: 'Mail delivery failed',
          status: resendRes.status,
          detail: resendBody,
          from,
          to: RECIPIENT,
        },
        502,
        cors
      );
    }

    return jsonResponse(
      { ok: true, resend: resendBody, from, to: RECIPIENT },
      200,
      cors
    );
  } catch (err) {
    return jsonResponse({ error: 'Upstream request failed', detail: err.message }, 502, cors);
  }
}
