/**
 * Shared Cloudflare challenge detection.
 * Pure logic — safe to import from both server routes and client components.
 */

/** Indicator strings that appear in Cloudflare challenge / block pages */
const CLOUDFLARE_INDICATORS = [
  'challenges.cloudflare.com',
  'cf_chl_',
  'cf_clearance',
  '__cf_chl',
  'just a moment',
  'enable javascript and cookies',
] as const

/**
 * Detect whether a response body or error message indicates a Cloudflare
 * managed-challenge / bot-protection page (the "Just a moment..." interstitial).
 */
export function isCloudflareError(input: string): boolean {
  if (!input) return false
  const lower = input.toLowerCase()
  return CLOUDFLARE_INDICATORS.some((indicator) => lower.includes(indicator))
}
