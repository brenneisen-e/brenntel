/**
 * Cloudflare Pages Middleware — www → non-www redirect
 *
 * _redirects only supports relative URLs, so host-based redirects
 * must be handled here.  Runs before every request.
 */
export async function onRequest(context) {
  const url = new URL(context.request.url);

  if (url.hostname === 'www.brenntelmediadesign.com') {
    url.hostname = 'brenntelmediadesign.com';
    return Response.redirect(url.toString(), 301);
  }

  return context.next();
}
