import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { requireLocalBackend } from './http';

let connection: DatabaseSync | undefined;
let currentPath: string | undefined;

export function database() {
  requireLocalBackend();
  const path = process.env.LOCAL_DATABASE_PATH || resolve(process.cwd(), '.data', 'portofolio.sqlite');
  if (connection && currentPath === path) return connection;
  connection?.close();
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  connection = new DatabaseSync(path); currentPath = path;
  if(path!==':memory:')chmodSync(path,0o600);
  connection.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('provider','reviewer')),
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
    CREATE TABLE IF NOT EXISTS applications (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), input_json TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('draft','submitted','needs_information','approved','rejected')),
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, review_reason TEXT, published_slug TEXT, source_card_slug TEXT
    );
    CREATE INDEX IF NOT EXISTS applications_owner ON applications(owner_id);
    CREATE TABLE IF NOT EXISTS aade_checks (
      request_id TEXT PRIMARY KEY,
      application_id TEXT NOT NULL REFERENCES applications(id),
      application_version TEXT NOT NULL,
      reviewer_id TEXT NOT NULL REFERENCES users(id),
      source TEXT NOT NULL CHECK(source='aade'),
      mode TEXT NOT NULL CHECK(mode='synthetic'),
      state TEXT NOT NULL CHECK(state IN ('running','completed','failed','stale','discarded')),
      created_at INTEGER NOT NULL, finished_at INTEGER,
      key_id TEXT NOT NULL, nonce TEXT, auth_tag TEXT, ciphertext TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS aade_checks_inflight ON aade_checks(application_id) WHERE state='running';
    CREATE INDEX IF NOT EXISTS aade_checks_reviewer_time ON aade_checks(reviewer_id,created_at);
    CREATE INDEX IF NOT EXISTS aade_checks_application_time ON aade_checks(application_id,created_at);

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY, application_id TEXT NOT NULL REFERENCES applications(id),
      reviewer_id TEXT NOT NULL REFERENCES users(id), decision TEXT NOT NULL, reason TEXT NOT NULL,
      checks_json TEXT NOT NULL, scope TEXT NOT NULL, created_at TEXT NOT NULL, input_snapshot TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS cards (
      slug TEXT PRIMARY KEY, application_id TEXT NOT NULL UNIQUE REFERENCES applications(id),
      public_json TEXT NOT NULL, published_at TEXT NOT NULL
    );
  `);
  // Additive upgrades preserve drafts made with an earlier local MVP schema.
  const applicationColumns=connection.prepare('PRAGMA table_info(applications)').all() as {name:string}[];
  if(!applicationColumns.some(x=>x.name==='source_card_slug'))connection.exec('ALTER TABLE applications ADD COLUMN source_card_slug TEXT');
  const reviewColumns=connection.prepare('PRAGMA table_info(reviews)').all() as {name:string}[];
  if(!reviewColumns.some(x=>x.name==='input_snapshot'))connection.exec("ALTER TABLE reviews ADD COLUMN input_snapshot TEXT NOT NULL DEFAULT '{}'");
  return connection;
}

export function closeDatabase() { connection?.close(); connection = undefined; currentPath = undefined; }

export function transaction<T>(action: (db: DatabaseSync) => T): T {
  const db = database();
  db.exec('BEGIN IMMEDIATE');
  try { const value = action(db); db.exec('COMMIT'); return value; }
  catch (error) { db.exec('ROLLBACK'); throw error; }
}
