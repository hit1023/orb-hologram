'use strict';
// 出来事を配る小さな pub/sub。
//   - ブラウザ: SSE(/api/events)でユーザーごとに受け取る(ログインのcookieで認証)
//   - ブラウザ以外(Mac miniのスクリプト・ロボット・別の端末): Zenoh に同じ出来事を publish する
//     キー: orb/user/<ユーザー名>/<出来事>   例) orb/user/hit/research_done , orb/user/hit/mood , orb/user/hit/reply
//   Zenoh は任意。zenohd がなくても本体は動く(失敗は最初の1回だけログに出す)
const subs = new Map();            // userId → Set<res>
const ZENOH_URL = (process.env.ZENOH_REST_URL || '').replace(/\/$/, '');   // zenohd の REST プラグイン(例 http://zenohd:8000)
const ZENOH_PREFIX = process.env.ZENOH_PREFIX || 'orb';
const stats = { published: 0, failed: 0, lastError: '' };

function subscribe(userId, res) {
  let set = subs.get(userId); if (!set) { set = new Set(); subs.set(userId, set); }
  set.add(res);
  res.on('close', () => { set.delete(res); if (!set.size) subs.delete(userId); });
}

function zenohPut(key, value) {
  if (!ZENOH_URL) return;
  fetch(`${ZENOH_URL}/${ZENOH_PREFIX}/${key}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value), signal: AbortSignal.timeout(2000) })
    .then((r) => { if (r.ok) stats.published++; else throw new Error(`zenoh REST ${r.status}`); })
    .catch((e) => { stats.failed++; if (!stats.lastError) console.log(`[zenoh] publish failed: ${e.message}`); stats.lastError = e.message; });
}

function publish(userId, username, event, data = {}) {
  const body = { event, user: username, ...data, ts: Date.now() };
  const payload = JSON.stringify(body);
  for (const res of subs.get(userId) || []) { try { res.write(`event: ${event}\ndata: ${payload}\n\n`); } catch (_) {} }
  zenohPut(`user/${username}/${event}`, body);
}

setInterval(() => { for (const set of subs.values()) for (const res of set) { try { res.write(': ping\n\n'); } catch (_) {} } }, 20000).unref();   // プロキシに切られないように

module.exports = { subscribe, publish, stats, zenohEnabled: () => !!ZENOH_URL };
