/**
 * Versand über den Mail-Connector (Repo emailapp, mcp-server auf Fly.io).
 *
 * Seit brenntelmediadesign.com bei Migadu liegt, hat jede Adresse ein echtes
 * Postfach. Der Connector schickt per SMTP aus diesem Postfach und legt die
 * Mail danach in dessen Ordner „Gesendet“ ab — so steht eine Rechnung, die
 * von eike@ rausgeht, auch in Eikes Gesendet-Ordner. Der Cloudflare Email
 * Service kann das nicht, er hat kein Postfach.
 *
 * Aufgerufen wird das Werkzeug send_mail per MCP (JSON-RPC über HTTP). Der
 * Connector läuft zustandslos, ein einzelner tools/call genügt.
 *
 * Environment-Variablen (Cloudflare Pages → Settings → Variables and Secrets):
 *   MAIL_CONNECTOR_TOKEN     — MCP_AUTH_TOKEN des Connectors (Secret). Ohne ihn
 *                              bleibt es beim Cloudflare Email Service.
 *   MAIL_CONNECTOR_URL       — optional, Standard https://emailapp-mcp.fly.dev/mcp
 *   MAIL_CONNECTOR_ACCOUNTS  — optional, JSON {"adresse": "konto-id", …}
 */

const DEFAULT_URL = 'https://emailapp-mcp.fly.dev/mcp';

// Absenderadresse → Konto im Connector (mail-accounts.yml im Repo emailapp)
const DEFAULT_ACCOUNTS = {
  'eike@brenntelmediadesign.com': 'brenntel-eike',
  'kontakt@brenntelmediadesign.com': 'brenntel',
};

function accountMap(env) {
  try {
    const eigene = env.MAIL_CONNECTOR_ACCOUNTS ? JSON.parse(env.MAIL_CONNECTOR_ACCOUNTS) : null;
    if (eigene && typeof eigene === 'object') return eigene;
  } catch (_) { /* ungültiges JSON: Standard nehmen */ }
  return DEFAULT_ACCOUNTS;
}

/** Konto im Connector für eine Absenderadresse, oder null. */
export function connectorAccount(env, address) {
  if (!env.MAIL_CONNECTOR_TOKEN) return null;
  return accountMap(env)[String(address || '').trim().toLowerCase()] || null;
}

// Antwort als JSON oder als Server-Sent Events („data: {…}“)
function parseRpc(raw) {
  try {
    return JSON.parse(raw);
  } catch (_) {
    const daten = raw.split(/\r?\n/)
      .filter((zeile) => zeile.startsWith('data:'))
      .map((zeile) => zeile.slice(5).trim());
    for (let i = daten.length - 1; i >= 0; i--) {
      try {
        const nachricht = JSON.parse(daten[i]);
        if (nachricht && (nachricht.result || nachricht.error)) return nachricht;
      } catch (_) { /* nächste Zeile */ }
    }
    return null;
  }
}

/**
 * Ruft ein Werkzeug des Connectors auf.
 * → { ok: true, text } oder { ok: false, error }
 */
async function callTool(env, name, args) {
  let res;
  try {
    res = await fetch(env.MAIL_CONNECTOR_URL || DEFAULT_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.MAIL_CONNECTOR_TOKEN}`,
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    });
  } catch (err) {
    return { ok: false, error: 'Connector nicht erreichbar: ' + err.message };
  }
  const raw = await res.text();
  if (!res.ok) return { ok: false, error: `Connector antwortet ${res.status}: ${raw.slice(0, 200)}` };
  const rpc = parseRpc(raw);
  if (!rpc) return { ok: false, error: 'Antwort des Connectors unlesbar' };
  if (rpc.error) return { ok: false, error: String(rpc.error.message || 'Fehler').slice(0, 300) };
  const result = rpc.result || {};
  const text = (result.content || []).map((block) => block.text || '').join('\n');
  if (result.isError) return { ok: false, error: text.slice(0, 500) };
  return { ok: true, text };
}

/**
 * Standard-Signatur eines Postfachs für die Vorschau: { name, html } oder null.
 * Bilder stehen darin als cid:-Verweise, ihre Bytes liefert der Connector nicht.
 */
export async function defaultSignature(env, account) {
  const r = await callTool(env, 'list_signatures', { withHtml: true, account });
  if (!r.ok) return null;
  try {
    const list = JSON.parse(r.text).signatures || [];
    const sig = list.find((s) => Array.isArray(s.defaultFor) && s.defaultFor.indexOf(account) !== -1);
    return sig && sig.html ? { name: sig.name, html: sig.html } : null;
  } catch (_) {
    return null;
  }
}

/**
 * Schickt eine Mail über das Postfach `account`.
 * mail = { to: [..], cc: [..], bcc: [..], subject, text, html,
 *          attachments: [{ filename, contentBase64, type }] }
 * → { ok, provider: 'connector', id, sentFolder } oder { ok: false, error }
 */
export async function sendViaConnector(env, account, mail) {
  const args = {
    account,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
  };
  if (mail.html) args.html = mail.html;
  if (mail.signature) args.signature = mail.signature;
  if (mail.cc && mail.cc.length) args.cc = mail.cc;
  if (mail.bcc && mail.bcc.length) args.bcc = mail.bcc;
  if (mail.attachments && mail.attachments.length) {
    args.attachments = mail.attachments.map((file) => ({
      filename: file.filename,
      contentBase64: file.contentBase64,
      contentType: file.type || 'application/octet-stream',
    }));
  }

  const r = await callTool(env, 'send_mail', args);
  if (!r.ok) return { ok: false, provider: 'connector', error: r.error };
  const text = r.text;

  let daten = {};
  try { daten = JSON.parse(text); } catch (_) { /* Text statt JSON: trotzdem gesendet */ }
  return {
    ok: true,
    provider: 'connector',
    id: daten.messageId || '',
    sentFolder: daten.appendedTo || null,
  };
}
