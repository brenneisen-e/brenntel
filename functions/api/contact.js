/**
 * Cloudflare Pages Function – Contact Form Handler
 * POST /api/contact
 *
 * Required env vars (set in Cloudflare Pages → Settings → Environment variables):
 *   RESEND_API_KEY  – API key from https://resend.com
 *   CONTACT_EMAIL   – recipient address (e.g. kontakt@brenntelmediadesign.com)
 */

const RATE_LIMIT_SECONDS = 30;
const MAX_FIELD_LENGTH = 5000;

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const origin = request.headers.get('Origin') || '';
  const allowedOrigins = [
    'https://brenntelmediadesign.com',
    'https://www.brenntelmediadesign.com',
    'https://brenntel.pages.dev',
    'http://localhost:8788',
  ];
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  const corsHeaders = {
    'Access-Control-Allow-Origin': corsOrigin,
    'Content-Type': 'application/json',
  };

  // Check env vars
  if (!env.RESEND_API_KEY || !env.CONTACT_EMAIL) {
    return new Response(
      JSON.stringify({ error: 'Server configuration incomplete.' }),
      { status: 500, headers: corsHeaders }
    );
  }

  // Parse body
  let data;
  try {
    data = await request.json();
  } catch {
    return new Response(
      JSON.stringify({ error: 'Invalid request body.' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const name = (data.name || '').trim().slice(0, MAX_FIELD_LENGTH);
  const email = (data.email || '').trim().slice(0, 320);
  const subject = (data.subject || '').trim().slice(0, MAX_FIELD_LENGTH);
  const message = (data.message || '').trim().slice(0, MAX_FIELD_LENGTH);

  // Validate required fields
  if (!name || !email || !message) {
    return new Response(
      JSON.stringify({ error: 'Name, email, and message are required.' }),
      { status: 400, headers: corsHeaders }
    );
  }

  // Basic email format check
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return new Response(
      JSON.stringify({ error: 'Invalid email address.' }),
      { status: 400, headers: corsHeaders }
    );
  }

  // Simple rate limiting via CF KV (optional) or skip if KV not bound
  if (env.CONTACT_KV) {
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const key = `rate:${ip}`;
    const last = await env.CONTACT_KV.get(key);
    if (last) {
      return new Response(
        JSON.stringify({ error: 'Please wait before sending another message.' }),
        { status: 429, headers: corsHeaders }
      );
    }
    await env.CONTACT_KV.put(key, '1', { expirationTtl: RATE_LIMIT_SECONDS });
  }

  // Send email via Resend
  const emailSubject = subject
    ? `Kontaktanfrage: ${subject}`
    : `Kontaktanfrage von ${name}`;

  const htmlBody = `
    <h2>Neue Kontaktanfrage</h2>
    <p><strong>Name:</strong> ${escapeHtml(name)}</p>
    <p><strong>E-Mail:</strong> ${escapeHtml(email)}</p>
    ${subject ? `<p><strong>Betreff:</strong> ${escapeHtml(subject)}</p>` : ''}
    <hr>
    <p>${escapeHtml(message).replace(/\n/g, '<br>')}</p>
  `;

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Kontaktformular <onboarding@resend.dev>',
        to: [env.CONTACT_EMAIL],
        reply_to: email,
        subject: emailSubject,
        html: htmlBody,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend error:', err);
      return new Response(
        JSON.stringify({ error: 'Failed to send email.' }),
        { status: 502, headers: corsHeaders }
      );
    }

    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error('Send error:', err);
    return new Response(
      JSON.stringify({ error: 'Failed to send email.' }),
      { status: 502, headers: corsHeaders }
    );
  }
}

// Handle CORS preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
