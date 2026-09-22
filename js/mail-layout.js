/**
 * Das brenntel-Maillayout — eine Quelle für Vorschau, .eml und Versand.
 *
 * Ein ES-Modul unter /js, weil der Generator es im Browser per `import` lädt.
 * Gerendert wird genau einmal, im Browser: Was in der Vorschau steht, ist
 * Zeichen für Zeichen das, was als .eml heruntergeladen und als Vorlage
 * gespeichert wird. Ein zweiter Renderer auf dem Server könnte davon
 * abweichen, ohne dass es jemandem auffällt — gesehen wird ja die Vorschau.
 *
 * Tabellen und Inline-Styles, weil Outlook & Co. weder Flexbox noch Grid noch
 * <style>-Blöcke zuverlässig können. Gleiche Anmutung wie die Rechnungs- und
 * KVA-Mails aus functions/invoice-mail.js; deren Zahlenkasten bleibt dort,
 * hier steht der allgemeine Brief.
 */

const FONT = "'Inter',-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";

const FARBE = {
  seite: '#f5ecdb',
  karte: '#ffffff',
  akzent: '#e8720c',
  text: '#14100c',
  leise: '#6f665c',
  fuss: '#8a8074',
  linie: '#e6ded0',
  kastenFlaeche: '#fdf6ec',
  kastenRand: '#f3d9bb',
};

export function escapeHtml(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Nur http(s) und mailto als Ziel.
 *
 * Ein `javascript:`-Ziel wäre in der Vorschau ein ausführbarer Link auf der
 * eigenen Seite — die Vorlagen kommen zwar aus der eigenen Hand, aber sie
 * gehen durch einen Speicher und kommen als Daten zurück.
 */
export function safeUrl(raw) {
  const wert = String(raw == null ? '' : raw).trim();
  if (!wert) return '';
  return /^(https?:\/\/|mailto:)/i.test(wert) ? wert : '';
}

/** Absatztext: Leerzeilen trennen Absätze, einzelne Umbrüche bleiben Umbrüche. */
function absaetze(text, stil) {
  return String(text || '')
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p style="${stil}">${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

const STIL_ABSATZ = `margin:0 0 16px;font:400 15px/1.7 ${FONT};color:${FARBE.text}`;

/**
 * Platzhalter für den in der Mail-App getippten Text.
 *
 * Eine Vorlage ohne diese Marke ist eine fertige Mail; eine MIT ihr ist ein
 * Rahmen, in den die App den Text setzt. Der Wert steht auch in der App
 * (ComposeActivity.BODY_SLOT) — ändert er sich hier, muss er dort mit.
 */
export const BODY_SLOT = '<!--brenntel:body-->';

function blockHtml(block) {
  switch (block && block.type) {
    case 'heading':
      return `<h2 style="margin:26px 0 10px;font:700 19px/1.4 ${FONT};` +
        `color:${FARBE.text};letter-spacing:-0.01em">${escapeHtml(block.text)}</h2>`;

    case 'text':
      return absaetze(block.text, STIL_ABSATZ);

    case 'list': {
      const punkte = (block.items || [])
        .map((p) => String(p).trim())
        .filter(Boolean)
        .map((p) => `<li style="margin:0 0 8px">${escapeHtml(p)}</li>`)
        .join('');
      if (!punkte) return '';
      return `<ul style="margin:0 0 16px;padding-left:20px;font:400 15px/1.7 ${FONT};` +
        `color:${FARBE.text}">${punkte}</ul>`;
    }

    case 'button': {
      const ziel = safeUrl(block.url);
      if (!ziel || !String(block.text || '').trim()) return '';
      // Tabelle statt <a> mit Padding: Outlook ignoriert Padding auf Inline-
      // Elementen, der Knopf wäre dort ein nackter Link.
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
        `style="margin:6px 0 20px"><tr><td bgcolor="${FARBE.akzent}" ` +
        `style="border-radius:10px"><a href="${escapeHtml(ziel)}" ` +
        `style="display:inline-block;padding:12px 24px;font:600 15px ${FONT};` +
        `color:#ffffff;text-decoration:none">${escapeHtml(block.text)}</a></td></tr></table>`;
    }

    case 'note':
      // Hervorgehobener Kasten für Termine, Fristen, Hinweise.
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ` +
        `style="background:${FARBE.kastenFlaeche};border:1px solid ${FARBE.kastenRand};` +
        `border-radius:12px;margin:0 0 18px"><tr><td style="padding:16px 20px">` +
        absaetze(block.text, `margin:0;font:400 15px/1.7 ${FONT};color:${FARBE.text}`) +
        `</td></tr></table>`;

    case 'divider':
      return `<div style="border-top:1px solid ${FARBE.linie};margin:22px 0"></div>`;

    case 'slot':
      // Die Stelle, an der die Mail-App den getippten Text einsetzt. Als
      // Kommentar, damit sie in der Vorschau und in einer verschickten Mail
      // nichts anrichtet: Wer die Vorlage nur als .eml benutzt, sieht sie nie.
      return BODY_SLOT;

    default:
      return '';
  }
}

/**
 * Vorschautext im Postfach — steht vor allem Sichtbaren und bleibt unsichtbar.
 * Ohne ihn zeigt die Übersicht die erste Zeile des Layouts statt des Inhalts.
 */
function preheaderHtml(text) {
  const wert = String(text || '').trim();
  if (!wert) return '';
  return `<div style="display:none;max-height:0;overflow:hidden;opacity:0;` +
    `mso-hide:all">${escapeHtml(wert)}</div>`;
}

function fussHtml(zeilen) {
  const inhalt = (zeilen || [])
    .map((z) => String(z).trim())
    .filter(Boolean)
    .map((z) => `<div style="font:400 11px/1.6 ${FONT};color:${FARBE.fuss}">${escapeHtml(z)}</div>`)
    .join('');
  if (!inhalt) return '';
  return `<tr><td style="padding:26px 36px 30px"><div style="border-top:1px solid ` +
    `${FARBE.linie};padding-top:16px">${inhalt}</div></td></tr>`;
}

/**
 * doc = {
 *   subject, preheader,
 *   blocks: [{type:'heading'|'text'|'list'|'button'|'note'|'divider', …}],
 *   footer: [Zeile, …]
 * }
 */
export function renderMailHtml(doc) {
  const d = doc || {};
  const koerper = (d.blocks || []).map(blockHtml).join('');

  return `<!DOCTYPE html>
<html lang="de"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(d.subject || 'brenntel mediadesign')}</title></head>
<body style="margin:0;padding:0;background:${FARBE.seite};">
${preheaderHtml(d.preheader)}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FARBE.seite};">
<tr><td align="center" style="padding:32px 14px;">

<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0"
       style="width:100%;max-width:600px;background:${FARBE.karte};border-radius:14px;overflow:hidden;">

  <tr><td bgcolor="${FARBE.akzent}" style="height:5px;line-height:5px;font-size:0;
      background:${FARBE.akzent};background:linear-gradient(90deg,${FARBE.akzent},#f5a623 55%,${FARBE.akzent});">&nbsp;</td></tr>

  <tr><td style="padding:30px 36px 0;">
    <div style="font:800 21px ${FONT};letter-spacing:-0.03em;color:${FARBE.text};">
      brenntel<span style="color:${FARBE.akzent};">.</span>
      <span style="font-weight:300;color:${FARBE.leise};">mediadesign</span>
    </div>
  </td></tr>

  <tr><td style="padding:26px 36px 0;">${koerper}</td></tr>

  ${fussHtml(d.footer)}

</table>
</td></tr></table>
</body></html>`;
}

/** Klartextfassung derselben Mail — ohne sie landet HTML-only schneller im Spam. */
export function renderMailText(doc) {
  const d = doc || {};
  const teile = (d.blocks || []).map((block) => {
    switch (block && block.type) {
      case 'heading': return String(block.text || '').trim().toUpperCase();
      case 'text':
      case 'note': return String(block.text || '').trim();
      case 'list':
        return (block.items || [])
          .map((p) => String(p).trim())
          .filter(Boolean)
          .map((p) => '• ' + p)
          .join('\n');
      case 'button': {
        const ziel = safeUrl(block.url);
        return ziel ? `${String(block.text || '').trim()}: ${ziel}` : '';
      }
      case 'divider': return '--';
      case 'slot': return BODY_SLOT;
      default: return '';
    }
  }).filter(Boolean);

  const fuss = (d.footer || []).map((z) => String(z).trim()).filter(Boolean);
  if (fuss.length) teile.push('--\n' + fuss.join('\n'));
  return teile.join('\n\n');
}

/* ----------------------------------------
   Signatur — der kleine Bruder des Layouts

   Kein ganzes Dokument, sondern ein Fragment: Eine Signatur wird in eine
   fremde Mail eingesetzt, und ein zweites <html> darin macht aus der
   Nachricht Müll. Deshalb auch keine Karte, kein Seitenhintergrund, kein
   Vorschautext — nur der Block selbst.
   ---------------------------------------- */

/** Eine Zeile der Signatur; leere Teile fallen weg, statt Trenner zu hinterlassen. */
function sigZeile(teile, stil) {
  const inhalt = teile.filter(Boolean).join(' · ');
  return inhalt ? `<div style="${stil}">${inhalt}</div>` : '';
}

function mailtoLink(adresse) {
  const wert = String(adresse || '').trim();
  if (!wert) return '';
  return `<a href="mailto:${escapeHtml(wert)}" style="color:${FARBE.leise};` +
    `text-decoration:none">${escapeHtml(wert)}</a>`;
}

function webLink(roh) {
  const wert = String(roh || '').trim();
  if (!wert) return '';
  // „https://" nur vor eine Adresse OHNE Schema setzen. Sonst würde aus
  // „javascript:…" ein „https://javascript:…", das die Prüfung passiert —
  // kaputt statt gefährlich, aber es hätte hier nichts zu suchen.
  const hatSchema = /^[a-z][a-z0-9+.-]*:/i.test(wert);
  const ziel = hatSchema ? safeUrl(wert) : safeUrl('https://' + wert);
  if (!ziel) return '';
  // Angezeigt wird die Adresse ohne Protokoll — „https://" liest niemand mit.
  const sichtbar = wert.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return `<a href="${escapeHtml(ziel)}" style="color:${FARBE.akzent};` +
    `text-decoration:none">${escapeHtml(sichtbar)}</a>`;
}

/**
 * sig = { name, role, company, street, city, phone, email, web, extra, wordmark }
 * wordmark = false lässt den Schriftzug weg, etwa wenn die Mail ihn schon trägt.
 */
export function renderSignatureHtml(sig) {
  const s = sig || {};
  const schriftzug = s.wordmark === false ? '' :
    `<div style="font:800 15px ${FONT};letter-spacing:-0.02em;color:${FARBE.text};` +
    `padding-bottom:6px">brenntel<span style="color:${FARBE.akzent}">.</span> ` +
    `<span style="font-weight:300;color:${FARBE.leise}">mediadesign</span></div>`;

  const name = String(s.name || '').trim();
  const rolle = String(s.role || '').trim();
  const kopfzeile = name
    ? `<div style="font:600 14px/1.5 ${FONT};color:${FARBE.text}">${escapeHtml(name)}` +
      (rolle ? `<span style="font-weight:400;color:${FARBE.leise}"> · ${escapeHtml(rolle)}</span>` : '') +
      `</div>`
    : '';

  const leise = `font:400 12px/1.7 ${FONT};color:${FARBE.leise}`;
  const zeilen =
    sigZeile([escapeHtml(String(s.company || '').trim())], leise) +
    sigZeile([
      escapeHtml(String(s.street || '').trim()),
      escapeHtml(String(s.city || '').trim()),
    ], leise) +
    sigZeile([
      escapeHtml(String(s.phone || '').trim()),
      mailtoLink(s.email),
    ], leise) +
    sigZeile([webLink(s.web)], leise) +
    sigZeile([escapeHtml(String(s.extra || '').trim())],
      `font:400 11px/1.6 ${FONT};color:${FARBE.fuss};padding-top:4px`);

  // Die Akzentlinie trennt die Signatur vom Text darüber — schmal gehalten,
  // damit sie in einem Antwortverlauf nicht wie ein Seitenrahmen wirkt.
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `style="border-collapse:collapse;margin-top:18px"><tr><td style="padding-top:12px;` +
    `border-top:2px solid ${FARBE.akzent};min-width:240px">` +
    schriftzug + kopfzeile + zeilen +
    `</td></tr></table>`;
}

/** Klartextfassung derselben Signatur. */
export function renderSignatureText(sig) {
  const s = sig || {};
  const zeilen = [
    s.wordmark === false ? '' : 'brenntel. mediadesign',
    [s.name, s.role].map((x) => String(x || '').trim()).filter(Boolean).join(' · '),
    String(s.company || '').trim(),
    [s.street, s.city].map((x) => String(x || '').trim()).filter(Boolean).join(' · '),
    [s.phone, s.email].map((x) => String(x || '').trim()).filter(Boolean).join(' · '),
    String(s.web || '').trim(),
    String(s.extra || '').trim(),
  ].filter(Boolean);
  return zeilen.length ? '--\n' + zeilen.join('\n') : '';
}

/* ----------------------------------------
   .eml — dieselbe Mail als Datei
   Für Archiv, Weitergabe und zum Öffnen im Mailprogramm am Rechner
   (Thunderbird: „Als neue Nachricht bearbeiten"). NICHT als Antwort
   verwendbar: Eine Antwort braucht In-Reply-To, References und den
   Empfänger der Originalmail, und die kennt nur das Mailprogramm,
   in dem die Originalmail liegt.
   ---------------------------------------- */

/** UTF-8 → base64, stückweise: fromCharCode(...alles) sprengt bei langen Mails den Stack. */
function base64(text) {
  const bytes = new TextEncoder().encode(String(text == null ? '' : text));
  let roh = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    roh += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(roh);
}

/** Base64 in 76er-Zeilen — längere Zeilen lehnen manche Server ab (RFC 2045). */
function umbrochen(b64) {
  return (b64.match(/.{1,76}/g) || []).join('\r\n');
}

/** Kopfzeile mit Umlauten als encoded-word (RFC 2047); reines ASCII bleibt lesbar. */
export function encodeHeader(text) {
  const wert = String(text == null ? '' : text);
  // eslint-disable-next-line no-control-regex
  return /^[\x20-\x7E]*$/.test(wert) ? wert : `=?UTF-8?B?${base64(wert)}?=`;
}

function messageId(from) {
  const domain = (String(from).split('@')[1] || 'brenntelmediadesign.com').replace(/[>\s]/g, '');
  const zufall = Math.random().toString(36).slice(2) + Date.now().toString(36);
  return `<${zufall}@${domain}>`;
}

/**
 * Baut eine vollständige RFC-5322-Nachricht als multipart/alternative.
 *
 * mail = { from, to, cc, subject, html, text, date }
 * Alle Adressfelder dürfen „Name <a@b.de>" oder die nackte Adresse sein.
 */
export function buildEml(mail) {
  const m = mail || {};
  const grenze = '----brenntel-' + Math.random().toString(36).slice(2);
  const datum = (m.date instanceof Date ? m.date : new Date()).toUTCString()
    .replace('GMT', '+0000');

  const kopf = [
    'MIME-Version: 1.0',
    `Date: ${datum}`,
    `Message-ID: ${messageId(m.from || '')}`,
    m.from ? `From: ${encodeHeader(m.from)}` : '',
    m.to ? `To: ${encodeHeader(m.to)}` : '',
    m.cc ? `Cc: ${encodeHeader(m.cc)}` : '',
    `Subject: ${encodeHeader(m.subject || '')}`,
    `Content-Type: multipart/alternative; boundary="${grenze}"`,
  ].filter(Boolean);

  return [
    kopf.join('\r\n'),
    '',
    `--${grenze}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    umbrochen(base64(m.text || '')),
    `--${grenze}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    umbrochen(base64(m.html || '')),
    `--${grenze}--`,
    '',
  ].join('\r\n');
}
