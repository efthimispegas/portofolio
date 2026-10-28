import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { database } from './database';
import { ApiError, boundedString, rateLimit, requireLocalBackend } from './http';

export interface SessionUser { id: string; email: string; name: string; role: 'provider' | 'reviewer'; }
type UserRecord = SessionUser & { password_hash: string };
export const SESSION_COOKIE = 'portofolio_session';
const MAX_AGE = 60 * 60 * 24 * 7;

function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  return `${salt}:${scryptSync(password, salt, 64).toString('hex')}`;
}
function matchesPassword(password: string, stored: string) {
  const [salt, key] = stored.split(':');
  if (!salt || !key || key.length !== 128) return false;
  return timingSafeEqual(scryptSync(password, salt, 64), Buffer.from(key, 'hex'));
}
function emailOf(value: unknown) {
  const email = boundedString(value, 'Email', 254, true).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(422, 'INVALID_EMAIL', 'Enter a valid email address.');
  return email;
}
function passwordOf(value:unknown) {
  if(typeof value!=='string'||!value||value.length>128)throw new ApiError(422,'INVALID_PASSWORD','Enter a password of at most 128 characters.');
  return value;
}
function publicUser(user: UserRecord): SessionUser { return { id: user.id, email: user.email, name: user.name, role: user.role }; }

export function register(input: Record<string, unknown>): SessionUser {
  requireLocalBackend(); rateLimit('register', 8);
  const email = emailOf(input.email);
  const password = passwordOf(input.password);
  if (password.length < 12) throw new ApiError(422, 'WEAK_PASSWORD', 'Use a password with at least 12 characters.');
  const name = boundedString(input.name, 'Name', 100) || email.split('@')[0];
  const db = database();
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) throw new ApiError(409, 'ACCOUNT_EXISTS', 'An account already exists for this email. Sign in instead.');
  const user: SessionUser = { id: randomUUID(), email, name, role: 'provider' };
  db.prepare('INSERT INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(user.id, email, name, hashPassword(password), user.role, new Date().toISOString());
  return user;
}

export function login(input: Record<string, unknown>): SessionUser {
  requireLocalBackend(); rateLimit('login:global', 30);
  const email = emailOf(input.email); rateLimit(`login:${email}`, 8);
  const password = passwordOf(input.password);
  const row = database().prepare('SELECT * FROM users WHERE email = ?').get(email) as unknown as UserRecord | undefined;
  if (!row) { scryptSync(password, 'nonexistent-account', 64); throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.'); }
  if (!matchesPassword(password, row.password_hash)) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect.');
  return publicUser(row);
}

const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');
export function createSession(user: SessionUser) {
  const token = randomBytes(32).toString('base64url');
  const db = database();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
  db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)').run(tokenHash(token), user.id, Date.now() + MAX_AGE * 1000);
  return token;
}
function tokenFrom(request: Request) {
  const raw = request.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
  return raw && /^[A-Za-z0-9_-]{43}$/.test(raw) ? raw : undefined;
}
export function sessionUser(request: Request): SessionUser | null {
  if (process.env.NODE_ENV === 'production') return null;
  const token = tokenFrom(request); if (!token) return null;
  const row = database().prepare('SELECT users.* FROM sessions JOIN users ON users.id=sessions.user_id WHERE token_hash=? AND expires_at>?').get(tokenHash(token), Date.now()) as unknown as UserRecord | undefined;
  return row ? publicUser(row) : null;
}
export function requireUser(request: Request, role?: SessionUser['role']): SessionUser {
  requireLocalBackend();
  const user = sessionUser(request);
  if (!user) throw new ApiError(401, 'AUTH_REQUIRED', 'Sign in to continue.');
  if (role && user.role !== role) throw new ApiError(403, 'FORBIDDEN', 'This action is not available to your account.');
  return user;
}
export function revokeSession(request: Request) {
  const token = tokenFrom(request);
  if (token) database().prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash(token));
}
export function sessionCookie(token: string, clear = false) {
  const secure = (process.env.APP_ORIGIN || '').startsWith('https:');
  return `${SESSION_COOKIE}=${clear ? '' : token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : MAX_AGE}${secure ? '; Secure' : ''}`;
}

export function developmentReviewer(request: Request): SessionUser {
  requireLocalBackend();
  if (process.env.ALLOW_DEV_REVIEWER !== '1') throw new ApiError(404, 'NOT_FOUND', 'This route is not available.');
  rateLimit('dev-reviewer', 5);
  const configured = process.env.LOCAL_REVIEWER_KEY || '';
  const supplied = request.headers.get('x-dev-reviewer-key') || '';
  if (configured.length < 32 || supplied.length > 256 || !timingSafeEqual(createHash('sha256').update(supplied).digest(), createHash('sha256').update(configured).digest())) throw new ApiError(403, 'REVIEW_KEY_REQUIRED', 'Enter the review key configured for this local environment.');
  const hostname = new URL(request.url).hostname;
  const originHost = new URL(request.headers.get('origin') || 'http://invalid').hostname;
  if (![hostname, originHost].every(h => ['localhost','127.0.0.1','[::1]'].includes(h))) throw new ApiError(403, 'LOCAL_ONLY', 'The development reviewer is only available on this computer.');
  const db = database(); const id = 'local-reviewer';
  db.prepare('INSERT OR IGNORE INTO users(id,email,name,password_hash,role,created_at) VALUES(?,?,?,?,?,?)').run(id, 'reviewer@localhost.invalid', 'Local reviewer', hashPassword(randomBytes(32).toString('hex')), 'reviewer', new Date().toISOString());
  return { id, email: 'reviewer@localhost.invalid', name: 'Local reviewer', role: 'reviewer' };
}
