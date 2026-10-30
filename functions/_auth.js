/**
 * Gemeinsame Anmeldung für das Admin Center und seine Functions.
 *
 * Konten liegen in Cloudflare KV (PROJEKTE, ersatzweise MAILGEN):
 *   adm-user:<email>       → { email, salt, hash, iterations }
 *   adm-session:<sha256>   → { email, created }        (läuft nach 30 Tagen ab)
 *   adm-reset:<sha256>     → { email }                 (läuft nach 1 Stunde ab)
 *   adm-fail:<email>       → Fehlversuche              (15 Minuten)
 *
 * Gespeichert werden nur Hashes: Kennwörter mit PBKDF2, Sitzungs- und
 * Rücksetz-Token mit SHA-256. Wer KV lesen kann, kommt damit nicht rein.
 *
 * Wer ein Konto haben darf, steht in ADMIN_EMAILS (kommagetrennt, optional);
 * ohne die Variable gilt DEFAULT_ADMINS. Ein Konto entsteht, indem die
 * Person über „Kennwort vergessen“ ihr erstes Kennwort festlegt.
 */

export const DEFAULT_ADMINS = ['eike@brenntelmediadesign.com'];
export const SESSION_COOKIE = '__Host-brenntel_admin';
export const SESSION_TTL = 30 * 24 * 60 * 60;
export const RESET_TTL = 60 * 60;
export const MIN_PASSWORD = 10;

// Cloudflare Workers erlauben für PBKDF2 höchstens 100.000 Runden
const PBKDF2_ITERATIONS = 100000;
const MIN_TOKEN_LENGTH = 24;

export function store(env) {
  return env.PROJEKTE || env.MAILGEN || null;
}

export function admins(env) {
  const liste = (env.ADMIN_EMAILS || '').split(/[,;\s]+/).map((a) => a.trim().toLowerCase()).filter(Boolean);
  return liste.length ? liste : DEFAULT_ADMINS;
}

export function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase().slice(0, 200);
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

export function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toHex(bytes);
}

export async function sha256(value) {
  return toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
}

/** Vergleich in konstanter Zeit über zwei gleich lange Hex-Strings. */
function sameHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.min(a.length, b.length); i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: fromHex(saltHex), iterations },
    key,
    256
  );
  return toHex(bits);
}

export async function hashPassword(password) {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const saltHex = toHex(salt);
  return {
    salt: saltHex,
    iterations: PBKDF2_ITERATIONS,
    hash: await pbkdf2(password, saltHex, PBKDF2_ITERATIONS),
  };
}

export async function verifyPassword(password, user) {
  if (!user || !user.salt || !user.hash) return false;
  const hash = await pbkdf2(password, user.salt, user.iterations || PBKDF2_ITERATIONS);
  return sameHex(hash, user.hash);
}

/* ----------------------------------------
   Sitzungen
   ---------------------------------------- */
export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(/;\s*/)) {
    const i = part.indexOf('=');
    if (i !== -1 && part.slice(0, i) === name) return part.slice(i + 1);
  }
  return '';
}

export async function createSession(kv, email) {
  const token = randomToken();
  await kv.put('adm-session:' + (await sha256(token)),
    JSON.stringify({ email, created: new Date().toISOString() }),
    { expirationTtl: SESSION_TTL });
  return token;
}

export async function destroySession(kv, request) {
  const token = readCookie(request, SESSION_COOKIE);
  if (/^[0-9a-f]{64}$/.test(token)) await kv.delete('adm-session:' + (await sha256(token)));
}

export function sessionCookie(token) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_TTL}`;
}

export function clearCookie() {
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

/** E-Mail der angemeldeten Person oder null. */
export async function sessionEmail(request, env) {
  const kv = store(env);
  if (!kv) return null;
  const token = readCookie(request, SESSION_COOKIE);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const roh = await kv.get('adm-session:' + (await sha256(token)));
  if (!roh) return null;
  try {
    const session = JSON.parse(roh);
    // Wer aus ADMIN_EMAILS gestrichen wird, verliert auch laufende Sitzungen
    return admins(env).indexOf(session.email) !== -1 ? session.email : null;
  } catch (_) {
    return null;
  }
}

/**
 * Bearer-Token für Werkzeuge ohne Browser (ADMIN_TOKEN, ersatzweise
 * MAILGEN_TOKEN). Vergleich über SHA-256-Digests in konstanter Zeit.
 */
export async function bearerOk(request, env) {
  const erwartet = (env.ADMIN_TOKEN || env.MAILGEN_TOKEN || '').trim();
  if (erwartet.length < MIN_TOKEN_LENGTH) return false;
  const match = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const [a, b] = await Promise.all([sha256(match[1].trim()), sha256(erwartet)]);
  return sameHex(a, b);
}

/** Angemeldet per Sitzung oder per Bearer-Token. */
export async function authorized(request, env) {
  if (await sessionEmail(request, env)) return true;
  return bearerOk(request, env);
}
