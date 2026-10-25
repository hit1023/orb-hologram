'use strict';
// 成長(たまごっち+会話): 会話を重ねるほど、卵 → ひかりのたま → ちびルミ → ルミ → ほしのルミ と育つ。
//   経験値(XP)は減らない。段階ごとに、見た目・話し方・できること(動き・調べ物・話題・ガード)が変わる。
const store = require('./store');

const STAGES = [
  { id: 0, key: 'egg', name: 'たまご', icon: '🥚', min: 0 },
  { id: 1, key: 'glow', name: 'ひかりのたま', icon: '✨', min: 40 },
  { id: 2, key: 'chibi', name: 'ちびルミ', icon: '🐣', min: 120 },
  { id: 3, key: 'lumi', name: 'ルミ', icon: '⭐', min: 300 },
  { id: 4, key: 'astral', name: 'ほしのルミ', icon: '🌟', min: 700 },
];
const DAILY_CAP = 150;
const stageFor = (xp) => { let s = 0; for (const st of STAGES) if (xp >= st.min) s = st.id; return s; };
const jstDay = (t = Date.now()) => new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);

function view(userId) {
  const g = store.getGrowth(userId), stage = stageFor(g.xp), cur = STAGES[stage], next = STAGES[stage + 1] || null;
  return { stage, key: cur.key, name: cur.name, icon: cur.icon, xp: Math.floor(g.xp), min: cur.min, next: next ? next.min : null, nextName: next ? next.name : null,
    progress: next ? Math.max(0, Math.min(1, (g.xp - cur.min) / (next.min - cur.min))) : 1, streak: g.streak, turns: g.turns };
}

// 1回の会話で増えるXP: 話すほど・やさしいほど増える。暴言は少しだけ。1日の上限あり。はじめての会話の日は、ボーナス(連続日数で増える)
function award(userId, { manner = 'neutral', len = 0, bonus = 0, rate = 100 } = {}) {
  const before = view(userId), g = store.getGrowth(userId), today = jstDay();
  let day_xp = g.day === today ? g.day_xp : 0, streak = g.streak, gain = 0;
  if (g.last_day !== today) { streak = g.last_day === jstDay(Date.now() - 86400000) ? streak + 1 : 1; gain += 10 + 2 * Math.min(streak, 10); }
  gain += ['rude', 'intimidating'].includes(manner) ? 1 : 3;
  if (len >= 20) gain += 1;
  if (['kind', 'thanks'].includes(manner)) gain += 1;
  gain += bonus;
  gain = Math.round(gain * rate / 100);
  gain = Math.max(0, Math.min(gain, DAILY_CAP - day_xp));
  const xp = g.xp + gain;
  store.saveGrowth(userId, { xp, streak, last_day: today, day: today, day_xp: day_xp + gain, turns: g.turns + 1 });
  const after = view(userId);
  return { gained: gain, ...after, evolved: after.stage > before.stage ? { from: before.stage, to: after.stage, fromName: before.name, toName: after.name } : null };
}
// 管理者用: XPを足す/段階を指定/リセット
function adminSet(userId, { add, stage, reset } = {}) {
  const g = store.getGrowth(userId);
  let xp = g.xp;
  if (reset) xp = 0; else if (Number.isFinite(stage)) xp = STAGES[Math.max(0, Math.min(4, stage))].min; else if (Number.isFinite(add)) xp += add;
  store.saveGrowth(userId, { xp: Math.max(0, xp), streak: reset ? 0 : g.streak, last_day: reset ? null : g.last_day, day: g.day, day_xp: g.day_xp, turns: reset ? 0 : g.turns });
  return view(userId);
}

// 段階ごとにできる動き(ちびルミ=基本の動き、ルミ以上=ぜんぶ、卵・光のたま=ゆれるだけ)
const BASIC = ['wave', 'nod', 'tilt_head', 'sway', 'jump', 'hop', 'look_around', 'sparkle', 'shy', 'laugh', 'cry', 'bow', 'spin', 'yawn', 'sit', 'surprise', 'shake_head', 'heart', 'scared', 'guard', 'lower', 'sulk', 'banzai', 'raise_both', 'cheer', 'clap'];
const TINY = ['sparkle', 'sway', 'tilt_head', 'nod', 'look_around'];
const filterActions = (stage, list) => (Array.isArray(list) ? list : []).filter(a => stage >= 3 ? true : stage === 2 ? BASIC.includes(a) : TINY.includes(a));
const can = { research: (s) => s >= 3, topic: (s) => s >= 2, weather: (s) => s >= 2, guard: (s) => s >= 2, analyze: (s) => s >= 3 };

const GLOW_SYSTEM = `あなたは、生まれたばかりの「ひかりのたま」です。ことばを覚えはじめたところで、ほとんど話せません。
- 返事は、ひらがなだけの1〜3語、全部で10文字以内。例:「ぽわ」「うれしい」「すき」「なあに？」「もっと」
- 相手の言ったことばを、一部だけおうむ返しすることもある。むずかしいことは「わかんない」。
- 出力は次のJSONだけ。説明やコードブロックは付けない。
{"reply":"返事","emotion":"neutral|happy|sad|surprised|angry|shy のどれか1つ","actions":[],"research":""}`;
const baseSystem = (stage, normal) => (stage === 1 ? GLOW_SYSTEM : normal);
const NOTE = {
  1: '\n\n【成長段階】いまは「ひかりのたま」。気持ちは、短いことばと声の調子だけで表す。ひらがな10文字以内。',
  2: '\n\n【成長段階: ちびルミ】まだ小さくて、ことばを覚えているところ。ひらがなが中心の、20文字以内の短い文だけで話す(上の文字数のルールより優先)。むずかしいことば・調べ物・システムのことは、まだ分からない。',
  4: '\n\n【成長段階: ほしのルミ】少し大人びて、やさしく、すこし詩的に話す。星や宇宙のたとえが自然に出る。長めに話してよい。',
};
const note = (stage) => NOTE[stage] || '';

// 卵は話せない。気分に合わせて、ゆれたり光ったりする音だけ返す
const EGG = { happy: ['ぽわっ', 'ぴかぴか', 'ことこと♪'], neutral: ['……こと', 'ぽわ……', 'ゆらゆら……'], sad: ['ぷるぷる……', 'しゅん……'], angry: ['ぷくっ！', 'ぴきっ……'], surprised: ['ぴくっ！'], shy: ['ぽっ……'] };
function eggReply(mood) {
  const emo = mood.anger >= 45 ? 'angry' : mood.sadness >= 45 ? 'sad' : mood.joy >= 65 ? 'happy' : Math.random() < 0.3 ? 'happy' : 'neutral';
  const l = EGG[emo]; return { reply: l[Math.floor(Math.random() * l.length)], emotion: emo, actions: [], research: '' };
}

module.exports = { STAGES, view, award, adminSet, filterActions, can, baseSystem, note, eggReply, stageFor };
