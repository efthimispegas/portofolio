import { cardUrl as publicCardUrl } from "@mastoli/core";
import { parseTrustedCardLink } from "./card-links";
function origin(value: string) {
  const url = new URL(value);
  if (
    (url.protocol !== "https:" &&
      !(
        typeof __DEV__ !== "undefined" &&
        __DEV__ &&
        url.protocol === "http:"
      )) ||
    url.username ||
    url.password
  )
    throw new Error("Use an HTTPS public origin (HTTP is development-only)");
  return url.origin;
}
const development = typeof __DEV__ !== "undefined" && __DEV__;
// Keep the offline wallet usable in an unconfigured release. .invalid can never
// resolve to a real service; release builds must set both HTTPS origins.
const fallbackOrigin = development
  ? "http://localhost:3000"
  : "https://portofolio.invalid";
export const API_ORIGIN = origin(
  process.env.EXPO_PUBLIC_API_URL || fallbackOrigin,
);
export const WEB_ORIGIN = origin(process.env.EXPO_PUBLIC_WEB_URL || API_ORIGIN);
export function cardSlugFromInput(input: string): string | null {
  return parseTrustedCardLink(input, WEB_ORIGIN, development);
}
export function cardUrl(slug: string) {
  return publicCardUrl(slug, WEB_ORIGIN);
}
export function safeContactUrl(value: string): string | null {
  try {
    const u = new URL(value);
    return u.protocol === "https:" &&
      !u.username &&
      !u.password &&
      !/[\r\n]/.test(value)
      ? u.toString()
      : null;
  } catch {
    return null;
  }
}
