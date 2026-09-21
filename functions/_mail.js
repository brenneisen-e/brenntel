/**
 * Gemeinsamer Mailversand für alle Pages Functions.
 *
 * Verschickt wird über Cloudflare Email Service (REST-API) mit Resend als
 * Rückfallebene — dieselbe Aufteilung wie im Wildwege-Backend.
 *
 * Bewusst die REST-API und nicht die send_email-Bindung: Die Bindung darf nur
 * an Adressen schicken, die im Cloudflare-Konto als Ziel bestätigt sind. Für
 * Post an Kunden, die wir vorher nicht kennen, ist sie damit unbrauchbar.
 *
 * Environment-Variablen (Cloudflare Pages → Settings → Variables and Secrets):
 *   CLOUDFLARE_EMAIL_TOKEN  — API-Token mit dem Recht „Email Sending: Edit“ (Secret)
 *   CLOUDFLARE_ACCOUNT_ID   — Konto-ID aus dem Cloudflare-Dashboard
 *   RESEND_API_KEY          — optional, Rückfallebene (Secret)
 *   MAIL_PROVIDER           — optional, "cloudflare" (Standard) oder "resend"
 *   MAIL_FROM               — optional, Standardabsender
 *   MAIL_REPLY_TO           — optional, Standard-Antwortadresse
 *
 * Voraussetzung auf Cloudflare-Seite: Die Absenderdomain muss unter
 * Compute → Email Service → Email Sending eingerichtet sein (DNS-Einträge für
 * DKIM, SPF und DMARC setzt Cloudflare selbst, wenn die Domain dort liegt).
 *
 * Aus demselben Token heraus lässt sich auch ein Mailprogramm zum Senden
 * überreden — so kann man auf Post an kontakt@brenntelmediadesign.com aus
 * Thunderbird, Apple Mail oder Gmail unter derselben Adresse antworten:
 *   Postausgang  smtp.mx.cloudflare.net, Port 465, SSL/TLS (kein STARTTLS)
 *   Benutzername api_token
 *   Passwort     derselbe Token wie CLOUDFLARE_EMAIL_TOKEN
 */

/** Cloudflare nimmt Nachrichten bis 5 MiB an — inklusive Anhängen. */
const CLOUDFLARE_MAX_MESSAGE = 5 * 1024 * 1024;

/** Sicherheitsabstand für MIME-Rahmen, Header und Umlaute in der Zählung. */
const SIZE_MARGIN = 96 * 1024;

const DEFAULT_FROM = 'brenntel mediadesign <kontakt@brenntelmediadesign.com>';

/** Zerlegt „brenntel mediadesign <kontakt@…>“ in Name und Adresse. */
export function splitAddress(value) {
  const raw = String(value || '').trim();
  const match = raw.match(/^(.*?)\s*<([^>]+)>$/);
  if (!match) return { address: raw };
  const name = match[1].trim().replace(/^"(.*)"$/, '$1');
  return name ? { address: match[2].trim(), name } : { address: match[2].trim() };
}

/** Nur die nackte Adresse, egal ob mit oder ohne Anzeigenamen übergeben. */
export function bareAddress(value) {
  return splitAddress(value).address;
}

function list(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return String(value)
    .split(/[,;\s]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/**
 * Grobe Größe der fertigen Nachricht. Base64 wandert unverändert in die
 * MIME-Fassung, dort aber mit Zeilenumbrüchen — daher der Aufschlag.
 */
function messageSize(mail) {
  let size =
    (mail.subject || '').length + (mail.text || '').length + (mail.html || '').length;
  for (const file of mail.attachments || []) {
    size += Math.ceil(String(file.contentBase64 || '').length * 1.02) +
      (file.filename || '').length;
  }
  return size;
}

function cloudflareReady(env) {
  return Boolean(env.CLOUDFLARE_EMAIL_TOKEN && env.CLOUDFLARE_ACCOUNT_ID);
}

function resendReady(env) {
  return Boolean(env.RESEND_API_KEY);
}

/**
 * Der Anbieter, der tatsächlich verschicken kann.
 *
 * MAIL_PROVIDER entscheidet, solange die Voraussetzung dafür da ist. Fehlt sie
 * — MAIL_PROVIDER steht auf "resend", aber das Secret ist nicht gesetzt —
 * springt der andere ein, statt den Versand kommentarlos ausfallen zu lassen.
 * Zu große Nachrichten gehen an Resend, weil Cloudflare bei 5 MiB abriegelt.
 */
export function pickProvider(env, mail) {
  const wanted = String(env.MAIL_PROVIDER || '').trim().toLowerCase();
  const zuGrossFuerCloudflare =
    mail && messageSize(mail) + SIZE_MARGIN > CLOUDFLARE_MAX_MESSAGE;

  if (wanted === 'resend' && resendReady(env)) return 'resend';
  if (zuGrossFuerCloudflare && resendReady(env)) return 'resend';
  if (wanted === 'cloudflare' && cloudflareReady(env) && !zuGrossFuerCloudflare) {
    return 'cloudflare';
  }
  if (cloudflareReady(env) && !zuGrossFuerCloudflare) return 'cloudflare';
  if (resendReady(env)) return 'resend';
  if (cloudflareReady(env)) return 'cloudflare'; // zu groß, aber der einzige Weg
  return 'keiner';
}

async function viaCloudflare(env, mail) {
  const cc = list(mail.cc);
  const bcc = list(mail.bcc);
  const body = {
    from: splitAddress(mail.from || env.MAIL_FROM || DEFAULT_FROM),
    to: list(mail.to),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  };
  if (cc.length) body.cc = cc;
  if (bcc.length) body.bcc = bcc;

  const replyTo = mail.replyTo || env.MAIL_REPLY_TO;
  if (replyTo) body.reply_to = bareAddress(replyTo);

  if (mail.attachments && mail.attachments.length) {
    body.attachments = mail.attachments.map((file) => ({
      content: file.contentBase64,
      filename: file.filename,
      type: file.type || 'application/octet-stream',
      disposition: 'attachment',
    }));
  }

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/email/sending/send`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.CLOUDFLARE_EMAIL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    }
  );

  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) { /* Antwort war kein JSON */ }

  if (!res.ok || !data || data.success === false) {
    const grund =
      (data && data.errors && data.errors.map((e) => e.message).filter(Boolean).join('; ')) ||
      raw.slice(0, 300) ||
      `${res.status} ${res.statusText}`;
    return { ok: false, provider: 'cloudflare', rejected: true, error: grund.slice(0, 500) };
  }

  const result = data.result || {};
  return {
    ok: true,
    provider: 'cloudflare',
    id: result.id || result.message_id || result.messageId,
  };
}

async function viaResend(env, mail) {
  const cc = list(mail.cc);
  const bcc = list(mail.bcc);
  const body = {
    from: mail.from || env.MAIL_FROM || DEFAULT_FROM,
    to: list(mail.to),
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  };
  if (cc.length) body.cc = cc;
  if (bcc.length) body.bcc = bcc;

  const replyTo = mail.replyTo || env.MAIL_REPLY_TO;
  if (replyTo) body.reply_to = bareAddress(replyTo);

  if (mail.attachments && mail.attachments.length) {
    body.attachments = mail.attachments.map((file) => ({
      filename: file.filename,
      content: file.contentBase64,
    }));
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const raw = await res.text();
  let data = null;
  try { data = JSON.parse(raw); } catch (_) { /* Antwort war kein JSON */ }

  if (!res.ok) {
    const grund =
      (data && (data.message || data.error)) || raw.slice(0, 300) ||
      `${res.status} ${res.statusText}`;
    return {
      ok: false,
      provider: 'resend',
      rejected: true,
      error: String(grund).slice(0, 500),
    };
  }

  return { ok: true, provider: 'resend', id: data && data.id };
}

async function versenden(env, mail, provider) {
  try {
    return provider === 'resend' ? await viaResend(env, mail) : await viaCloudflare(env, mail);
  } catch (err) {
    // Netzwerkfehler: Die Nachricht kann unterwegs trotzdem angekommen sein,
    // deshalb ist das kein Fall für den zweiten Anbieter (rejected bleibt aus).
    return {
      ok: false,
      provider,
      error: (err && err.message ? err.message : String(err)).slice(0, 500),
    };
  }
}

/**
 * Verschickt eine Mail und gibt zurück, was dabei herauskam.
 *
 * mail = { from, to, cc, bcc, replyTo, subject, text, html,
 *          attachments: [{ filename, contentBase64, type }] }
 *
 * Lehnt der eingestellte Anbieter die Nachricht ab, übernimmt der andere,
 * sofern er eingerichtet ist. Ein abgebrochener Netzwerkaufruf löst keinen
 * zweiten Versuch aus — sonst läge die Mail am Ende zweimal im Postfach.
 */
export async function sendMail(env, mail) {
  const provider = pickProvider(env, mail);

  if (provider === 'keiner') {
    return {
      ok: false,
      provider: 'keiner',
      error: 'Kein Mailanbieter eingerichtet (CLOUDFLARE_EMAIL_TOKEN oder RESEND_API_KEY fehlt).',
    };
  }

  const ergebnis = await versenden(env, mail, provider);
  if (ergebnis.ok || !ergebnis.rejected) return ergebnis;

  const ersatz = provider === 'cloudflare' ? 'resend' : 'cloudflare';
  const ersatzBereit = ersatz === 'resend' ? resendReady(env) : cloudflareReady(env);
  if (!ersatzBereit) return ergebnis;

  const zweiterVersuch = await versenden(env, mail, ersatz);
  if (zweiterVersuch.ok) return { ...zweiterVersuch, fallbackVon: provider };

  return {
    ...zweiterVersuch,
    error: `${provider}: ${ergebnis.error} | ${ersatz}: ${zweiterVersuch.error}`.slice(0, 500),
  };
}
