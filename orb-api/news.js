'use strict';
// ニュースから話題を拾う。Google ニュースの RSS(公開されている配信フィード)を使う。
//   検索結果ページのスクレイピングは規約・ブロック・壊れやすさの点で避け、RSS だけを読む。
const crypto = require('crypto');
const store = require('./store');

const CACHE_MS = 30 * 60 * 1000;
const cache = new Map();          // 検索語 → { at, items }
// ルミから話しかける話題としては重すぎるものは、見出しの時点で外す
const HEAVY = /(殺|死亡|死者|遺体|死去|訃報|逮捕|容疑者|虐待|自殺|テロ|爆発|銃|襲|火災|墜落|行方不明|性的|わいせつ|暴行|詐欺|不倫|事故)/;

const decode = (s) => s.replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").trim();

function parseRss(xml) {
  const out = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const t = /<title>([\s\S]*?)<\/title>/.exec(m[1]), l = /<link>([\s\S]*?)<\/link>/.exec(m[1]), d = /<pubDate>([\s\S]*?)<\/pubDate>/.exec(m[1]);
    if (!t) continue;
    let title = decode(t[1]), source = '';
    const i = title.lastIndexOf(' - '); if (i > 10) { source = title.slice(i + 3); title = title.slice(0, i); }
    out.push({ title, source, url: l ? decode(l[1]) : '', ts: d ? Date.parse(decode(d[1])) || 0 : 0 });
  }
  return out;
}

async function fetchNews(query) {
  const key = query || '';
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.items;
  const url = query
    ? `https://news.google.com/rss/search?q=${encodeURIComponent(query)}%20when:3d&hl=ja&gl=JP&ceid=JP:ja`   // 直近3日のニュース
    : 'https://news.google.com/rss?hl=ja&gl=JP&ceid=JP:ja';
  const r = await fetch(url, { headers: { 'user-agent': 'Mozilla/5.0 (orb-hologram news reader)' }, signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`news ${r.status}`);
  const items = parseRss(await r.text()).filter(n => !HEAVY.test(n.title));
  cache.set(key, { at: Date.now(), items });
  if (cache.size > 100) cache.delete(cache.keys().next().value);
  return items;
}

const hashOf = (n) => crypto.createHash('sha1').update(n.title).digest('hex').slice(0, 16);

// その人の興味(キーワード)から、まだ話していないニュースを1つ選ぶ。興味に合うものがなければ、ふつうのヘッドライン
async function pickNews(userId, interests) {
  const told = store.toldNews(userId);
  const tryList = [...interests.sort(() => Math.random() - 0.5), null];
  for (const q of tryList) {
    let items; try { items = await fetchNews(q); } catch (_) { continue; }
    const fresh = items.filter(n => !told.has(hashOf(n)));
    if (!fresh.length) continue;
    const n = fresh[Math.floor(Math.random() * Math.min(5, fresh.length))];
    store.markNewsTold(userId, hashOf(n));
    return { ...n, keyword: q };
  }
  return null;
}

module.exports = { fetchNews, pickNews, parseRss };
