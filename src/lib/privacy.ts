/**
 * Privacy utilities — route all external requests through local proxies
 * so external servers never see the user's IP or browsing behavior.
 */

/** Proxy an external image URL through the local server */
export function proxyImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined
  // Already local — no proxy needed
  if (url.startsWith('/') || url.startsWith('blob:') || url.startsWith('data:')) return url
  // Route through local proxy
  return `/local-api/proxy-image?url=${encodeURIComponent(url)}`
}
