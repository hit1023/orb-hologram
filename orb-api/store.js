'use strict';
// SQLite(Node標準の node:sqlite)で、ユーザー・ログインセッション・ルミの気分を保存する。
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DB_PATH = process.env.DB_PATH || '/data/db/orb.db';
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pw_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'user',
    created_at INTEGER NOT NULL,
    last_login INTEGER
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS moods (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    joy REAL NOT NULL, anger REAL NOT NULL, sadness REAL NOT NULL,
    streak INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  );
  PRAGMA foreign_keys = ON;
`);
db.exec('PRAGMA foreign_keys = ON');

const now = () => Date.now();
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

// ---- パスワード(scrypt) ----
function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  return `scrypt$${salt.toString('hex')}$${crypto.scryptSync(pw, salt, 64).toString('hex')}`;
}
function verifyPassword(pw, stored) {
  const [alg, saltHex, hashHex] = String(stored || '').split('$');
  if (alg !== 'scrypt' || !saltHex || !hashHex) return false;
  const want = Buffer.from(hashHex, 'hex');
  const got = crypto.scryptSync(pw, Buffer.from(saltHex, 'hex'), want.length);
  return crypto.timingSafeEqual(got, want);
}
const DUMMY_HASH = hashPassword('dummy-password-for-timing');   // 存在しないユーザーでも同じ時間をかける

const USERNAME_RE = /^[A-Za-z0-9_.-]{3,32}$/;
function validateNewUser(username, password, role) {
  if (!USERNAME_RE.test(username || '')) return 'ユーザー名は英数字と _ . - の3〜32文字にしてください';
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) return 'パスワードは8文字以上にしてください';
  if (role !== 'user' && role !== 'admin') return '権限が正しくありません';
  return null;
}

// ---- ユーザー ----
const pub = (u) => u && ({ id: u.id, username: u.username, role: u.role, created_at: u.created_at, last_login: u.last_login });
function createUser(username, password, role = 'user') {
  const err = validateNewUser(username, password, role);
  if (err) throw Object.assign(new Error(err), { status: 400 });
  try {
    const r = db.prepare('INSERT INTO users (username, pw_hash, role, created_at) VALUES (?, ?, ?, ?)').run(username, hashPassword(password), role, now());
    return pub(db.prepare('SELECT * FROM users WHERE id = ?').get(Number(r.lastInsertRowid)));
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) throw Object.assign(new Error('そのユーザー名はもう使われています'), { status: 409 });
    throw e;
  }
}
const countUsers = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
const countAdmins = () => db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get().n;
const listUsers = () => db.prepare('SELECT id, username, role, created_at, last_login FROM users ORDER BY id').all();
const getUser = (id) => pub(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
function deleteUser(id) {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!u) throw Object.assign(new Error('ユーザーが見つかりません'), { status: 404 });
  if (u.role === 'admin' && countAdmins() <= 1) throw Object.assign(new Error('最後の管理者は削除できません'), { status: 400 });
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
}
function setPassword(id, password) {
  if (typeof password !== 'string' || password.length < 8 || password.length > 200) throw Object.assign(new Error('パスワードは8文字以上にしてください'), { status: 400 });
  const r = db.prepare('UPDATE users SET pw_hash = ? WHERE id = ?').run(hashPassword(password), id);
  if (!r.changes) throw Object.assign(new Error('ユーザーが見つかりません'), { status: 404 });
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(id);   // パスワードを変えたら、ほかの端末のログインは外す
}
function checkLogin(username, password) {
  const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username || ''));
  const ok = verifyPassword(String(password || ''), u ? u.pw_hash : DUMMY_HASH);
  if (!u || !ok) return null;
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now(), u.id);
  return pub(u);
}
const verifyUserPassword = (id, password) => {
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return !!u && verifyPassword(String(password || ''), u.pw_hash);
};

// ---- ログインセッション ----
const SESSION_MS = 30 * 24 * 3600 * 1000;
function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(sha(token), userId, now(), now() + SESSION_MS);
  return { token, maxAge: SESSION_MS / 1000 };
}
function sessionUser(token) {
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(sha(token));
  if (!s) return null;
  if (s.expires_at < now()) { db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.token_hash); return null; }
  return getUser(s.user_id);
}
const deleteSession = (token) => token && db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha(token));
setInterval(() => { try { db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now()); } catch (_) {} }, 3600 * 1000).unref();

// ---- 気分 ----
function loadMoodRow(userId) {
  return db.prepare('SELECT joy, anger, sadness, streak, updated_at FROM moods WHERE user_id = ?').get(userId) || null;
}
function saveMoodRow(userId, m) {
  db.prepare(`INSERT INTO moods (user_id, joy, anger, sadness, streak, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET joy = excluded.joy, anger = excluded.anger, sadness = excluded.sadness, streak = excluded.streak, updated_at = excluded.updated_at`)
    .run(userId, m.joy, m.anger, m.sadness, m.streak | 0, m.updated_at || now());
}
const resetMood = (userId) => db.prepare('DELETE FROM moods WHERE user_id = ?').run(userId);

module.exports = { createUser, countUsers, countAdmins, listUsers, getUser, deleteUser, setPassword, checkLogin, verifyUserPassword,
  createSession, sessionUser, deleteSession, loadMoodRow, saveMoodRow, resetMood, validateNewUser };
