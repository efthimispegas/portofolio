/** Treat a QR payload as data, and return only a canonical profile slug. */
export function parseTrustedCardLink(
  input: string,
  trustedOrigin: string,
  allowDevelopmentHttp = false,
): string | null {
  try {
    const url = new URL(input.trim());
    const trusted = new URL(trustedOrigin);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.origin !== trusted.origin
    )
      return null;
    if (
      url.protocol !== "https:" &&
      !(allowDevelopmentHttp && url.protocol === "http:")
    )
      return null;
    return (
      /^\/c\/([a-z0-9][a-z0-9-]{0,79})\/?$/.exec(url.pathname)?.[1] ?? null
    );
  } catch {
    return null;
  }
}
