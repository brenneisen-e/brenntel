/**
 * Cloudflare Pages Function — Anmeldung im Admin Center
 *
 * GET  /admin-auth                                → { email } oder 401
 * POST /admin-auth { action: 'login',  email, password }
 * POST /admin-auth { action: 'logout' }
 * POST /admin-auth { action: 'forgot', email }    → Mail mit Link zum Kennwort
 * POST /admin-auth { action: 'reset',  token, password }
 *
 * Konten, Hashes und Sitzungen: siehe functions/_auth.js. Das erste Kennwort
 * wird genauso vergeben wie ein vergessenes: über den Link aus der Mail.
 *
 * Die Antwort auf „Kennwort vergessen“ ist immer dieselbe, ob es die Adresse
 * gibt oder nicht — sonst ließe sich damit abfragen, wer ein Konto hat.
 */

import { sendMail } from './_mail.js';
import {
  store, admins, normalizeEmail, randomToken, sha256, hashPassword, verifyPassword,
  createSession, destroySession, sessionCookie, clearCookie, sessionEmail,
  RESET_TTL, MIN_PASSWORD,
} from './_auth.js';

const MAX_FAILS = 8;
const FAIL_TTL = 15 * 60;
const MAX_RESET_MAILS = 3;
const FROM = 'brenntel mediadesign <kontakt@brenntelmediadesign.com>';

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

// Nur vom eigenen Auftritt aus; Formulare fremder Seiten bleiben draußen
function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

async function countUp(kv, key, ttl) {
  const n = Number(await kv.get(key)) || 0;
  await kv.put(key, String(n + 1), { expirationTtl: ttl });
  return n + 1;
}

function resetMail(link) {
  const font = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
  const html = `<!DOCTYPE html><html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Kennwort festlegen</title></head>
<body style="margin:0;padding:0;background:#f5ecdb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f5ecdb;">
<tr><td align="center" style="padding:32px 14px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" border="0"
       style="width:100%;max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;">
  <tr><td bgcolor="#e8720c" style="height:5px;line-height:5px;font-size:0;background:#e8720c;">&nbsp;</td></tr>
  <tr><td style="padding:30px 34px 0;font:800 21px ${font};letter-spacing:-0.03em;color:#14100c;">
    brenntel<span style="color:#e8720c;">.</span> <span style="font-weight:300;color:#6f665c;">Admin Center</span>
  </td></tr>
  <tr><td style="padding:22px 34px 0;font:400 15px/1.7 ${font};color:#14100c;">
    Über diesen Link legst du ein neues Kennwort für das Admin Center fest. Er gilt eine Stunde und nur einmal.
  </td></tr>
  <tr><td style="padding:22px 34px 0;">
    <a href="${link}" style="display:inline-block;background:#c05600;color:#ffffff;text-decoration:none;
       font:600 15px ${font};padding:13px 22px;border-radius:10px;">Kennwort festlegen</a>
  </td></tr>
  <tr><td style="padding:22px 34px 30px;font:400 12px/1.6 ${font};color:#8a8074;">
    Hast du das nicht angefordert, kannst du diese Mail ignorieren. Dein bisheriges Kennwort bleibt gültig.
  </td></tr>
</table></td></tr></table></body></html>`;
  const text = 'Über diesen Link legst du ein neues Kennwort für das Admin Center fest. ' +
    'Er gilt eine Stunde und nur einmal.\n\n' + link +
    '\n\nHast du das nicht angefordert, kannst du diese Mail ignorieren.';
  return { html, text };
}

export async function onRequest(context) {
  const { request, env } = context;
  const kv = store(env);
  if (!kv) return json({ error: 'Speicher nicht eingerichtet (KV-Bindung PROJEKTE fehlt).' }, 500);

  if (request.method === 'GET') {
    const email = await sessionEmail(request, env);
    return email ? json({ email }, 200) : json({ error: 'Nicht angemeldet' }, 401);
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!sameOrigin(request)) return json({ error: 'Nicht berechtigt' }, 403);

  let body;
  try {
    body = JSON.parse((await request.text()).slice(0, 4096));
  } catch (_) {
    return json({ error: 'Ungültige Anfrage' }, 400);
  }

  if (body.action === 'login') {
    const email = normalizeEmail(body.email);
    const password = String(body.password || '');
    const failKey = 'adm-fail:' + email;
    if ((Number(await kv.get(failKey)) || 0) >= MAX_FAILS) {
      return json({ error: 'Zu viele Versuche. Bitte in 15 Minuten erneut versuchen oder das Kennwort zurücksetzen.' }, 429);
    }
    const roh = admins(env).indexOf(email) !== -1 ? await kv.get('adm-user:' + email) : null;
    const user = roh ? JSON.parse(roh) : null;
    if (!user || !(await verifyPassword(password, user))) {
      await countUp(kv, failKey, FAIL_TTL);
      return json({ error: 'E-Mail oder Kennwort stimmen nicht.' }, 401);
    }
    await kv.delete(failKey);
    const token = await createSession(kv, email);
    return json({ ok: true, email }, 200, { 'Set-Cookie': sessionCookie(token) });
  }

  if (body.action === 'logout') {
    await destroySession(kv, request);
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookie() });
  }

  if (body.action === 'forgot') {
    const email = normalizeEmail(body.email);
    const antwort = { ok: true, message: 'Wenn die Adresse ein Konto hat, ist eine Mail mit einem Link unterwegs.' };
    if (admins(env).indexOf(email) === -1) return json(antwort, 200);
    if ((await countUp(kv, 'adm-resetmail:' + email, RESET_TTL)) > MAX_RESET_MAILS) return json(antwort, 200);

    const token = randomToken();
    await kv.put('adm-reset:' + (await sha256(token)), JSON.stringify({ email }), { expirationTtl: RESET_TTL });
    const link = new URL(request.url).origin + '/admin?reset=' + token;
    const mail = resetMail(link);
    const result = await sendMail(env, {
      from: FROM,
      to: email,
      subject: 'Kennwort für das Admin Center festlegen',
      text: mail.text,
      html: mail.html,
    });
    if (!result.ok) return json({ error: 'Die Mail konnte nicht verschickt werden.' }, 502);
    return json(antwort, 200);
  }

  if (body.action === 'reset') {
    const token = String(body.token || '');
    const password = String(body.password || '');
    if (password.length < MIN_PASSWORD) {
      return json({ error: 'Das Kennwort braucht mindestens ' + MIN_PASSWORD + ' Zeichen.' }, 400);
    }
    if (!/^[0-9a-f]{64}$/.test(token)) return json({ error: 'Der Link ist ungültig.' }, 400);
    const key = 'adm-reset:' + (await sha256(token));
    const roh = await kv.get(key);
    if (!roh) return json({ error: 'Der Link ist abgelaufen oder wurde schon benutzt. Bitte einen neuen anfordern.' }, 400);
    const { email } = JSON.parse(roh);
    if (admins(env).indexOf(email) === -1) return json({ error: 'Der Link ist ungültig.' }, 400);

    await kv.delete(key);
    const hashed = await hashPassword(password);
    await kv.put('adm-user:' + email, JSON.stringify({ email, ...hashed, updatedAt: new Date().toISOString() }));
    await kv.delete('adm-fail:' + email);
    const session = await createSession(kv, email);
    return json({ ok: true, email }, 200, { 'Set-Cookie': sessionCookie(session) });
  }

  return json({ error: 'Unbekannte Aktion' }, 400);
}
