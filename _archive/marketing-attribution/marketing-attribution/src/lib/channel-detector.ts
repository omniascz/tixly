/**
 * channel-detector.ts
 *
 * Resolves a canonical marketing channel from UTM parameters and HTTP referrer.
 * Rules mirror the conventions used by Google Analytics' default channel grouping.
 */

import type { UtmParams } from "../types/attribution.types";

export type Channel =
  | "direct"
  | "organic_search"
  | "paid_search"
  | "social_organic"
  | "social_paid"
  | "email"
  | "referral"
  | "affiliate";

const SEARCH_ENGINE_HOSTS = [
  "google.",
  "bing.com",
  "duckduckgo.com",
  "seznam.cz",
  "yahoo.",
  "yandex.",
];

const SOCIAL_HOSTS = [
  "facebook.com",
  "fb.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "linkedin.com",
  "tiktok.com",
  "youtube.com",
  "pinterest.com",
  "reddit.com",
];

function hostFromReferrer(referrer: string | null): string | null {
  if (!referrer) return null;
  try {
    return new URL(referrer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isPaidMedium(medium: string): boolean {
  const m = medium.toLowerCase();
  return (
    m === "cpc" ||
    m === "ppc" ||
    m === "paid" ||
    m === "paidsocial" ||
    m === "paid_social" ||
    m === "display" ||
    m === "cpm"
  );
}

/**
 * Returns the canonical channel for a landing event.
 *
 * Priority:
 *   1. utm_medium=affiliate
 *   2. utm_source=newsletter / utm_medium=email → email
 *   3. Paid search: google/bing + cpc/ppc/paid → paid_search
 *   4. Paid social: facebook/instagram/tiktok + paid-ish medium → social_paid
 *   5. Organic social: social host referrer OR utm_source on known social → social_organic
 *   6. Organic search: search host referrer OR utm_medium=organic → organic_search
 *   7. Any utm_source + medium=referral → referral
 *   8. Referrer present (no UTM) → referral
 *   9. Else → direct
 */
export function detectChannel(
  referrer: string | null,
  utm: UtmParams,
): Channel {
  const source = (utm.source ?? "").toLowerCase().trim();
  const medium = (utm.medium ?? "").toLowerCase().trim();
  const host = hostFromReferrer(referrer);

  // 1. Affiliate
  if (medium === "affiliate" || source === "affiliate") return "affiliate";

  // 2. Email
  if (
    medium === "email" ||
    source === "email" ||
    source === "newsletter" ||
    source === "mailchimp" ||
    source === "sendgrid"
  ) {
    return "email";
  }

  const isSocialSource = [
    "facebook",
    "fb",
    "instagram",
    "ig",
    "tiktok",
    "twitter",
    "x",
    "linkedin",
    "pinterest",
    "reddit",
    "youtube",
  ].includes(source);

  const isSearchSource = ["google", "bing", "seznam", "yahoo", "duckduckgo", "yandex"].includes(source);

  // 3. Paid search
  if (isSearchSource && isPaidMedium(medium)) return "paid_search";

  // 4. Paid social
  if (isSocialSource && isPaidMedium(medium)) return "social_paid";

  // 5. Organic social
  if (isSocialSource) return "social_organic";
  if (host && SOCIAL_HOSTS.some((h) => host.includes(h))) return "social_organic";

  // 6. Organic search
  if (isSearchSource && (medium === "organic" || medium === "")) return "organic_search";
  if (medium === "organic") return "organic_search";
  if (host && SEARCH_ENGINE_HOSTS.some((h) => host.includes(h))) return "organic_search";

  // 7. Explicit referral medium
  if (medium === "referral") return "referral";

  // 8. Referrer fallback
  if (host) return "referral";

  // 9. Nothing known
  return "direct";
}
