/**
 * Cloudflare Pages Function – Contact Form Handler
 * Sends an email via the Resend API.
 *
 * Required environment variable (set in Cloudflare Pages → Settings → Environment variables):
 *   RESEND_API_KEY  – API key from https://resend.com
 */

export async function onRequestPost(context) {
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': context.request.headers.get('Origin') || '*',
  };

  try {
    const body = await context.request.json();
    const { name, email, subject, message } = body;

    if (!name || !email || !message) {
      return new Response(JSON.stringify({ error: 'Pflichtfelder fehlen.' }), {
        status: 400,
        headers,
      });
    }

    const apiKey = context.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error('RESEND_API_KEY is not configured');
      return new Response(JSON.stringify({ error: 'Server-Konfigurationsfehler.' }), {
        status: 500,
        headers,
      });
    }

    const emailSubject = subject
      ? `Kontaktanfrage: ${subject}`
      : `Kontaktanfrage von ${name}`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Kontaktformular <noreply@brenntelmediadesign.com>',
        to: ['eike@brenneisen.info'],
        subject: emailSubject,
        reply_to: email,
        text: [
          `Name: ${name}`,
          `E-Mail: ${email}`,
          subject ? `Betreff: ${subject}` : null,
          '',
          'Nachricht:',
          message,
        ].filter(Boolean).join('\n'),
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      console.error('Resend API error:', err);
      return new Response(JSON.stringify({ error: 'E-Mail konnte nicht gesendet werden.' }), {
        status: 502,
        headers,
      });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch (err) {
    console.error('Contact handler error:', err);
    return new Response(JSON.stringify({ error: 'Interner Serverfehler.' }), {
      status: 500,
      headers,
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}
