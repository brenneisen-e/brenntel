/**
 * Cloudflare Pages Function — WordPress REST API Proxy
 *
 * Solves CORS issues when the frontend (brenntel.pages.dev) fetches
 * from arbitrary WordPress sites that don't send Access-Control-Allow-Origin.
 *
 * Usage:  GET /wp-proxy?url=https://example.com/wp-json/wp/v2/posts
 *         (forwards Authorization header if present)
 */

const ALLOWED_ORIGINS = [
  'https://brenntel.pages.dev',
  'https://brenntelmediadesign.com',
  'https://www.brenntelmediadesign.com',
  'http://localhost',
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.some(
    (o) => origin === o || origin.startsWith(o + ':') || origin.startsWith('http://localhost')
  );
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Expose-Headers': 'X-WP-Total, X-WP-TotalPages',
    'Access-Control-Max-Age': '86400',
  };
}

function isWordPressApiUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      (parsed.pathname.includes('/wp-json') || parsed.searchParams.has('rest_route'))
    );
  } catch {
    return false;
  }
}

function isWordPressMediaUrl(url) {
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'https:' || parsed.protocol === 'http:') &&
      parsed.pathname.includes('/wp-content/uploads/')
    );
  } catch {
    return false;
  }
}

export async function onRequest(context) {
  const { request } = context;
  const origin = request.headers.get('Origin') || ALLOWED_ORIGINS[0];
  const cors = corsHeaders(origin);

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Only allow GET
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const targetUrl = url.searchParams.get('url');

  if (!targetUrl) {
    return new Response(JSON.stringify({ error: 'Missing "url" query parameter' }), {
      status: 400,
      headers: { ...cors, 'Content-Type': 'application/json' },
    });
  }

  const isApi = isWordPressApiUrl(targetUrl);
  const isMedia = isWordPressMediaUrl(targetUrl);

  if (!isApi && !isMedia) {
    return new Response(
      JSON.stringify({ error: 'Only WordPress REST API and media URLs are allowed' }),
      { status: 403, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }

  // Build upstream request headers
  const upstreamHeaders = new Headers();
  if (isApi) {
    upstreamHeaders.set('Accept', 'application/json');
  }

  // Forward Authorization header (for Application Passwords)
  const authHeader = request.headers.get('Authorization');
  if (authHeader) {
    upstreamHeaders.set('Authorization', authHeader);
  }

  try {
    const upstream = await fetch(targetUrl, {
      method: 'GET',
      headers: upstreamHeaders,
      redirect: 'follow',
    });

    // Build response with CORS headers + expose WP pagination headers
    const responseHeaders = new Headers(cors);
    const contentType = upstream.headers.get('Content-Type') || (isMedia ? 'application/octet-stream' : 'application/json');
    responseHeaders.set('Content-Type', contentType);

    if (isApi) {
      const wpTotal = upstream.headers.get('X-WP-Total');
      const wpTotalPages = upstream.headers.get('X-WP-TotalPages');
      if (wpTotal) responseHeaders.set('X-WP-Total', wpTotal);
      if (wpTotalPages) responseHeaders.set('X-WP-TotalPages', wpTotalPages);
    }

    // For media downloads, expose content-length
    const contentLength = upstream.headers.get('Content-Length');
    if (contentLength) {
      responseHeaders.set('Content-Length', contentLength);
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  } catch (err) {
    return new Response(
      JSON.stringify({ error: 'Upstream request failed', detail: err.message }),
      { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } }
    );
  }
}
