import { randomUUID } from 'node:crypto';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export function success(data: unknown, status = 200, headers?: HeadersInit) {
  return Response.json({ data }, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

export async function endpoint(handler: () => Promise<Response> | Response): Promise<Response> {
  try { return await handler(); } catch (error) {
    if (error instanceof ApiError) return Response.json({ error: { code: error.code, message: error.message } }, { status: error.status, headers: { 'Cache-Control': 'no-store' } });
    const incident = randomUUID();
    console.error('API failure', incident, error instanceof Error ? error.message : 'unknown');
    return Response.json({ error: { code: 'INTERNAL_ERROR', message: `The request could not be completed. Reference: ${incident}` } }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}

export function requireLocalBackend() {
  if (process.env.NODE_ENV === 'production') throw new ApiError(503, 'PRODUCTION_BACKEND_REQUIRED', 'Provider accounts require the production backend. The local review environment is unavailable here.');
}

export function requireMutationOrigin(request: Request) {
  const origin = request.headers.get('origin');
  const expected = new URL(process.env.APP_ORIGIN || 'http://localhost:3000').origin;
  if (!origin || origin !== expected) throw new ApiError(403, 'INVALID_ORIGIN', 'This request must come from the application.');
  const fetchSite = request.headers.get('sec-fetch-site');
  if (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none') throw new ApiError(403, 'INVALID_ORIGIN', 'Cross-site requests are not allowed.');
  const host = request.headers.get('host') || new URL(request.url).host;
  if (host !== new URL(expected).host) throw new ApiError(403, 'INVALID_HOST', 'The application host does not match its configuration.');
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) throw new ApiError(415, 'JSON_REQUIRED', 'Send this request as JSON.');
  if (Number(request.headers.get('content-length') || 0) > 24_000) throw new ApiError(413, 'BODY_TOO_LARGE', 'The form is too large.');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'INVALID_JSON', 'The request body is missing.');
  const chunks: Uint8Array[] = []; let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > 24_000) { await reader.cancel(); throw new ApiError(413, 'BODY_TOO_LARGE', 'The form is too large.'); }
    chunks.push(part.value);
  }
  let result: unknown;
  try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new ApiError(400, 'INVALID_JSON', 'The form could not be read.'); }
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new ApiError(400, 'INVALID_JSON', 'Send an object containing the form fields.');
  return result as Record<string, unknown>;
}

const attempts = new Map<string, { count: number; reset: number }>();
export function rateLimit(key: string, max = 12, windowMs = 60_000) {
  const now = Date.now();
  if (attempts.size > 5000) for (const [k, value] of attempts) if (value.reset < now) attempts.delete(k);
  let value = attempts.get(key);
  if (!value || value.reset < now) { value = { count: 0, reset: now + windowMs }; attempts.set(key, value); }
  if (++value.count > max) throw new ApiError(429, 'RATE_LIMITED', 'Too many attempts. Wait a minute and try again.');
}

export function boundedString(value: unknown, label: string, max: number, required = false): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new ApiError(422, 'INVALID_FIELD', `${label} is invalid or too long.`);
  const result = value.trim();
  if (required && !result) throw new ApiError(422, 'INVALID_FIELD', `${label} is required.`);
  return result;
}

export function publicOrigin() {
  const value = process.env.NEXT_PUBLIC_SITE_URL || process.env.APP_ORIGIN || 'http://localhost:3000';
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new ApiError(503, 'INVALID_CONFIGURATION', 'Public site URL is not configured correctly.');
  return url.origin;
}
