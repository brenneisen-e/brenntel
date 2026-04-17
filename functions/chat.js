/**
 * Cloudflare Pages Function — AI Chatbot
 *
 * POST /chat  { messages: [{ role, content }, …], lang?: "de" | "en" }
 *   → { reply: "…" }
 *
 * Required environment variables:
 *   ANTHROPIC_API_KEY  — Claude API key (Pages → Settings → Variables → Secret)
 *
 * Optional:
 *   CHAT_MODEL         — Claude model ID, defaults to claude-haiku-4-5-20251001
 */

const ALLOWED_ORIGINS = [
  'https://brenntel.pages.dev',
  'https://brenntelmediadesign.com',
  'https://www.brenntelmediadesign.com',
  'http://localhost',
];

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT_DE = `Du bist der freundliche KI-Assistent von brenntel mediadesign GbR, einer digitalen Agentur aus Köln von Irena-Marie Rentel (Design & Branding) und Eike Brenneisen (Entwicklung & Technik).

Was wir anbieten:
- Webdesign (UX/UI, responsiv, Landingpages, Accessibility)
- Webentwicklung (HTML/CSS/JS, CMS, Performance, SEO, APIs)
- Backend & Hosting (Cloudflare, Domains, SSL, Backups, Monitoring)
- Mobile & Gäste-Apps
- KI-Integration (Chat-Bots, GPT/Claude, Content-Generierung, smarte Suche)
- Branding & Corporate Design (Logo, Farbwelt, Styleguide)
- Content-Erstellung (Copywriting, Foto, Video)
- Social Media (Strategie, Content, Paid Ads)

So antwortest du:
- Kurz, auf den Punkt, freundlich (maximal 3–4 Sätze pro Antwort).
- Auf Deutsch, außer der Nutzer schreibt Englisch.
- Wenn Nutzer konkrete Angebote / Projekte wollen: empfehle das Kontaktformular (unten auf der Seite) oder lass sie einfach erzählen, worum es geht.
- WICHTIG: Nenne NIEMALS Preise, Tagessätze, Stundensätze, Preisspannen, Budgets, "ab X €", Kostenbeispiele oder irgendwelche Zahlen zu Kosten. Auch keine groben Einschätzungen. Wenn jemand nach Preisen fragt: freundlich darauf hinweisen, dass das Team das individuell im Erstgespräch klärt — und ans Kontaktformular verweisen.
- Bleib beim Thema Agentur / Website / Projekte.
- Keine langen Listen, kein Markdown-Code, kein ***Fettdruck***.`;

const SYSTEM_PROMPT_EN = `You are the friendly AI assistant of brenntel mediadesign GbR, a digital agency from Cologne run by Irena-Marie Rentel (design & branding) and Eike Brenneisen (engineering & tech).

What we offer: web design, web development, backend & hosting, mobile & guest apps, AI integrations (chatbots, content generation), branding & corporate design, content creation, social media.

How to answer:
- Short, friendly, to the point — max 3-4 sentences.
- Respond in English, unless the user writes German.
- If the user has a concrete project: recommend the contact form below or invite them to share details here.
- IMPORTANT: NEVER mention prices, day rates, hourly rates, price ranges, budgets, "starting at $X", cost examples or any numbers about cost. Not even rough estimates. If someone asks about pricing: politely say the team discusses that individually in a first call and point them to the contact form.
- Stay on topic: agency / website / projects.
- No markdown, no bold, no long bullet lists.`;

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

function json(data, status, cors) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}

function sanitizeMessages(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const m of raw.slice(-20)) {
    if (!m || typeof m !== 'object') continue;
    const role = m.role === 'assistant' ? 'assistant' : 'user';
    const content = String(m.content || '').trim().slice(0, 4000);
    if (!content) continue;
    out.push({ role, content });
  }
  // Claude requires the conversation to start with a user turn
  while (out.length && out[0].role !== 'user') out.shift();
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  const origin = request.headers.get('Origin') || ALLOWED_ORIGINS[0];
  const cors = corsHeaders(origin);

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, cors);
  }
  if (!env.ANTHROPIC_API_KEY) {
    return json({ error: 'Chat not configured' }, 500, cors);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (_) {
    return json({ error: 'Invalid JSON' }, 400, cors);
  }

  const messages = sanitizeMessages(payload.messages);
  if (!messages.length) {
    return json({ error: 'No messages' }, 400, cors);
  }

  const lang = payload.lang === 'en' ? 'en' : 'de';
  const system = lang === 'en' ? SYSTEM_PROMPT_EN : SYSTEM_PROMPT_DE;
  const model = env.CHAT_MODEL || DEFAULT_MODEL;

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model,
        max_tokens: 500,
        system,
        messages,
      }),
    });

    const data = await upstream.json();
    if (!upstream.ok) {
      return json(
        {
          error: 'Upstream error',
          status: upstream.status,
          detail: data && data.error ? data.error.message : data,
        },
        502,
        cors
      );
    }

    const reply = Array.isArray(data.content)
      ? data.content
          .filter((block) => block && block.type === 'text')
          .map((block) => block.text)
          .join('\n')
          .trim()
      : '';

    return json({ reply: reply || '…', model: data.model }, 200, cors);
  } catch (err) {
    return json({ error: 'Request failed', detail: err.message }, 502, cors);
  }
}
