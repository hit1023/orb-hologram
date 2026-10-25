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
  CREATE TABLE IF NOT EXISTS turns (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_text TEXT NOT NULL, reply TEXT NOT NULL, emotion TEXT,
    created_at INTEGER NOT NULL,
    vec BLOB
  );
  CREATE INDEX IF NOT EXISTS turns_user ON turns (user_id, id);
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    query TEXT NOT NULL, ask TEXT,
    status TEXT NOT NULL DEFAULT 'pending',   -- pending / running / done / failed
    result TEXT, sources TEXT,
    delivered INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, done_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS jobs_user ON jobs (user_id, status);
  CREATE TABLE IF NOT EXISTS user_env (
    user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    lat REAL, lng REAL, weather TEXT, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS news_told (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    h TEXT NOT NULL, ts INTEGER NOT NULL,
    PRIMARY KEY (user_id, h)
  );
  PRAGMA foreign_keys = ON;
`);
db.exec('PRAGMA foreign_keys = ON');
for (const col of ["interests TEXT", "int_turns INTEGER NOT NULL DEFAULT 0", "affinity REAL NOT NULL DEFAULT 50", "impression TEXT", "impr_turns INTEGER NOT NULL DEFAULT 0", "impr_stance TEXT", "impr_at INTEGER NOT NULL DEFAULT 0"]) {
  try { db.exec(`ALTER TABLE moods ADD COLUMN ${col}`); } catch (_) { /* もうある */ }
}

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
  return db.prepare('SELECT joy, anger, sadness, affinity, streak, updated_at, impression, impr_turns, impr_stance, impr_at FROM moods WHERE user_id = ?').get(userId) || null;
}
function saveMoodRow(userId, m) {
  db.prepare(`INSERT INTO moods (user_id, joy, anger, sadness, affinity, streak, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET joy = excluded.joy, anger = excluded.anger, sadness = excluded.sadness, affinity = excluded.affinity, streak = excluded.streak, updated_at = excluded.updated_at`)
    .run(userId, m.joy, m.anger, m.sadness, m.affinity ?? 50, m.streak | 0, m.updated_at || now());
}
// ルミの「この人への本音」メモ(LLMが履歴と気分から書く)
const saveImpression = (userId, text, turns, stance) =>
  db.prepare('UPDATE moods SET impression = ?, impr_turns = ?, impr_stance = ?, impr_at = ? WHERE user_id = ?').run(text, turns, stance, now(), userId);
// ---- 管理者が決める設定(ルミの動かし方) ----
const SETTING_DEFAULTS = { research_enabled: 1, topic_enabled: 1, topic_first_sec: 75, topic_interval_sec: 240, weather_enabled: 1, guard_enabled: 1, particle_level: 2 };
function getSettings() {
  const out = { ...SETTING_DEFAULTS };
  for (const r of db.prepare('SELECT key, value FROM settings').all()) if (r.key in out) out[r.key] = Number(r.value);
  return out;
}
function setSettings(patch) {
  const lim = { research_enabled: [0, 1], topic_enabled: [0, 1], topic_first_sec: [10, 3600], topic_interval_sec: [30, 86400], weather_enabled: [0, 1], guard_enabled: [0, 1], particle_level: [1, 3] };
  for (const [k, v] of Object.entries(patch || {})) {
    if (!(k in lim)) continue; const n = Math.round(Number(v)); if (!Number.isFinite(n)) continue;
    db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(k, String(Math.max(lim[k][0], Math.min(lim[k][1], n))));
  }
  return getSettings();
}
// ---- ユーザーの場所と天気(場所は小数2桁=約1kmに丸めて保存) ----
const saveEnv = (userId, lat, lng, weather) => db.prepare(`INSERT INTO user_env (user_id, lat, lng, weather, updated_at) VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(user_id) DO UPDATE SET lat = excluded.lat, lng = excluded.lng, weather = excluded.weather, updated_at = excluded.updated_at`).run(userId, lat, lng, JSON.stringify(weather), now());
function getEnv(userId) {
  const r = db.prepare('SELECT lat, lng, weather, updated_at FROM user_env WHERE user_id = ?').get(userId);
  if (!r) return null; let w = null; try { w = JSON.parse(r.weather); } catch (_) {}
  return w ? { lat: r.lat, lng: r.lng, weather: w, updated_at: r.updated_at } : null;
}
const clearEnv = (userId) => db.prepare('DELETE FROM user_env WHERE user_id = ?').run(userId);

// ---- 調査の依頼(あとで調べて報告する) ----
const MAX_PENDING_PER_USER = 5, MAX_PER_DAY = 20;
function addJob(userId, query, ask) {
  const dup = db.prepare('SELECT id FROM jobs WHERE user_id = ? AND query = ? AND created_at > ?').get(userId, query, now() - 3600000);
  if (dup) return Number(dup.id);
  if (db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND status IN ('pending','running')").get(userId).n >= MAX_PENDING_PER_USER) return null;
  if (db.prepare('SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND created_at > ?').get(userId, now() - 86400000).n >= MAX_PER_DAY) return null;
  return Number(db.prepare('INSERT INTO jobs (user_id, query, ask, created_at) VALUES (?, ?, ?, ?)').run(userId, query, ask || null, now()).lastInsertRowid);
}
const nextPendingJob = () => db.prepare("SELECT j.*, u.username FROM jobs j JOIN users u ON u.id = j.user_id WHERE j.status = 'pending' ORDER BY j.id LIMIT 1").get() || null;
const setJobRunning = (id) => db.prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(id);
const finishJob = (id, status, result, sources) => db.prepare('UPDATE jobs SET status = ?, result = ?, sources = ?, done_at = ? WHERE id = ?').run(status, result || null, sources ? JSON.stringify(sources) : null, now(), id);
const takeDoneJob = (userId) => db.prepare("SELECT * FROM jobs WHERE user_id = ? AND status = 'done' AND delivered = 0 ORDER BY id LIMIT 1").get(userId) || null;
const markJobDelivered = (id) => db.prepare('UPDATE jobs SET delivered = 1 WHERE id = ?').run(id);
const failStaleJobs = () => db.prepare("UPDATE jobs SET status = 'failed', done_at = ? WHERE status IN ('pending','running') AND created_at < ?").run(now(), now() - 20 * 60000).changes;
const listJobs = (userId, n = 10) => db.prepare('SELECT id, query, status, delivered, result, sources, created_at, done_at FROM jobs WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, n);
const countJobs = (userId) => db.prepare("SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND status IN ('pending','running')").get(userId).n;

// 興味のあるキーワード(会話の履歴からLLMが拾う)と、もう話したニュース
const saveInterests = (userId, list, turns) => db.prepare('UPDATE moods SET interests = ?, int_turns = ? WHERE user_id = ?').run(JSON.stringify(list), turns, userId);
function getInterests(userId) {
  const r = db.prepare('SELECT interests, int_turns FROM moods WHERE user_id = ?').get(userId);
  let list = []; try { list = JSON.parse((r && r.interests) || '[]'); } catch (_) {}
  return { list: Array.isArray(list) ? list : [], turns: (r && r.int_turns) || 0 };
}
const toldNews = (userId) => new Set(db.prepare('SELECT h FROM news_told WHERE user_id = ?').all(userId).map(r => r.h));
function markNewsTold(userId, h) {
  db.prepare('INSERT OR IGNORE INTO news_told (user_id, h, ts) VALUES (?, ?, ?)').run(userId, h, now());
  db.prepare('DELETE FROM news_told WHERE user_id = ? AND ts < ?').run(userId, now() - 30 * 86400000);
}
const resetMood = (userId) => db.prepare('DELETE FROM moods WHERE user_id = ?').run(userId);

// ---- 会話履歴(1回のやりとり=1行)。vec は意味検索用の埋め込みベクトル ----
const MAX_TURNS = 3000;           // 1人あたりの保存上限(古いものから消す)
function addTurn(userId, userText, reply, emotion) {
  const r = db.prepare('INSERT INTO turns (user_id, user_text, reply, emotion, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, userText, reply, emotion || null, now());
  const n = db.prepare('SELECT COUNT(*) AS n FROM turns WHERE user_id = ?').get(userId).n;
  if (n > MAX_TURNS) db.prepare('DELETE FROM turns WHERE id IN (SELECT id FROM turns WHERE user_id = ? ORDER BY id LIMIT ?)').run(userId, n - MAX_TURNS);
  return Number(r.lastInsertRowid);
}
const setTurnVec = (id, f32) => db.prepare('UPDATE turns SET vec = ? WHERE id = ?').run(Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength), id);
const recentTurns = (userId, n) => db.prepare('SELECT id, user_text, reply, created_at FROM turns WHERE user_id = ? ORDER BY id DESC LIMIT ?').all(userId, n).reverse();
const turnsWithVec = (userId) => db.prepare('SELECT id, user_text, reply, created_at, vec FROM turns WHERE user_id = ? AND vec IS NOT NULL').all(userId);
const turnStats = (userId) => db.prepare('SELECT COUNT(*) AS n, MIN(created_at) AS first, MAX(created_at) AS last FROM turns WHERE user_id = ?').get(userId);
const countTurns = (userId) => db.prepare('SELECT COUNT(*) AS n FROM turns WHERE user_id = ?').get(userId).n;
const clearTurns = (userId) => db.prepare('DELETE FROM turns WHERE user_id = ?').run(userId).changes;

module.exports = { listJobs, addJob, nextPendingJob, setJobRunning, finishJob, takeDoneJob, markJobDelivered, failStaleJobs, countJobs, getSettings, setSettings, saveEnv, getEnv, clearEnv, saveInterests, getInterests, toldNews, markNewsTold, turnStats, addTurn, setTurnVec, recentTurns, turnsWithVec, countTurns, clearTurns, createUser, countUsers, countAdmins, listUsers, getUser, deleteUser, setPassword, checkLogin, verifyUserPassword,
  createSession, sessionUser, deleteSession, loadMoodRow, saveMoodRow, saveImpression, resetMood, validateNewUser };
