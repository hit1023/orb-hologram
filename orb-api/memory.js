'use strict';
// ルミの長期記憶(RAG)。過去のやりとりを埋め込みベクトルにして保存し、いまの話に近いものを思い出す。
//   埋め込み: Cloudflare Workers AI の bge-m3(日本語に強い・約0.15秒)。失敗しても会話は止めない。
const store = require('./store');

const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CF_GATEWAY = process.env.CF_AI_GATEWAY_ID || '';
const EMBED_MODEL = process.env.CF_EMBED_MODEL || '@cf/baai/bge-m3';
const MIN_SCORE = +process.env.MEMORY_MIN_SCORE || 0.55;   // これ以上似ているものだけ思い出す
const TOP_K = 3;
const SKIP_RECENT = 6;                                      // 直近のやりとりは会話履歴で渡すので、記憶からは除く

const enabled = () => !!(CF_ACCOUNT && CF_TOKEN);

function normalize(v) {
  let n = 0; for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n) || 1; const o = new Float32Array(v.length);
  for (let i = 0; i < v.length; i++) o[i] = v[i] / n;
  return o;
}

async function embed(text, timeoutMs = 3000) {
  if (!enabled()) return null;
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/${EMBED_MODEL}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${CF_TOKEN}`, 'content-type': 'application/json', ...(CF_GATEWAY ? { 'cf-aig-gateway-id': CF_GATEWAY } : {}) },
    body: JSON.stringify({ text: [String(text).slice(0, 500)] }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!r.ok) throw new Error(`embed ${r.status}`);
  const v = (await r.json()).result?.data?.[0];
  if (!Array.isArray(v) || !v.length) throw new Error('embed empty');
  return normalize(Float32Array.from(v));
}
// 話しかけの検索用: 遅いときはあきらめて、記憶なしで答える
const embedQuery = (text, ms = 900) => embed(text, ms).catch(() => null);

// ユーザーごとのベクトルをメモリに置いておく(書き込みで更新)
const cache = new Map();
function vectorsOf(userId) {
  let c = cache.get(userId);
  if (!c) {
    c = store.turnsWithVec(userId).map(t => ({ id: t.id, user_text: t.user_text, reply: t.reply, created_at: t.created_at,
      vec: new Float32Array(t.vec.buffer.slice(t.vec.byteOffset, t.vec.byteOffset + t.vec.byteLength)) }));
    cache.set(userId, c);
  }
  return c;
}

function recall(userId, qvec) {
  if (!qvec) return [];
  const all = vectorsOf(userId), skip = new Set(store.recentTurns(userId, SKIP_RECENT).map(t => t.id));
  const scored = [];
  for (const t of all) {
    if (skip.has(t.id) || t.vec.length !== qvec.length) continue;
    let d = 0; for (let i = 0; i < qvec.length; i++) d += t.vec[i] * qvec[i];
    if (d >= MIN_SCORE) scored.push({ ...t, score: d });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, TOP_K);
}

function ago(ts, now = Date.now()) {
  const m = Math.floor((now - ts) / 60000);
  if (m < 60) return `${Math.max(1, m)}分前`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}時間前`;
  const d = Math.floor(h / 24); if (d < 31) return `${d}日前`;
  return `${Math.floor(d / 30)}か月前`;
}
function block(mems) {
  if (!mems.length) return '';
  const lines = mems.map(m => `- ${ago(m.created_at)}: 相手「${m.user_text.slice(0, 120)}」→ ルミ「${m.reply.slice(0, 120)}」`);
  return `\n\n【この相手との過去の会話の記憶】\n${lines.join('\n')}\n今の話に関係があるときだけ、自然に思い出して触れてよい(「前に〜って言ってたよね」など)。関係ないときは触れない。毎回は言わない。記憶にないことは作らない。`;
}

// 返事のあとに保存する(声を待たせないよう、埋め込みはあとから)
function remember(userId, userText, reply, emotion) {
  const id = store.addTurn(userId, userText, reply, emotion);
  if (userText.length < 5 || !enabled()) return id;       // 「うん」「ありがとう」だけのものは意味検索の対象にしない
  embed(`相手: ${userText}\nルミ: ${reply}`, 8000).then(v => {
    if (!v) return;
    store.setTurnVec(id, v);
    const c = cache.get(userId); if (c) c.push({ id, user_text: userText, reply, created_at: Date.now(), vec: v });
  }).catch(e => console.log(`[memory] embed failed: ${e.message}`));
  return id;
}
const forget = (userId) => { cache.delete(userId); try { store.clearEnv(userId); store.clearJobs(userId); } catch (_) {} return store.clearTurns(userId); };

module.exports = { enabled, embedQuery, recall, block, remember, forget };
