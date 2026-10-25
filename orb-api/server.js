'use strict';
// orb-api: ホログラムキャラ用の小さな中継サーバー。
//   POST /api/chat  {text, history}  -> {reply, emotion}   (Claude Code CLI を headless で呼ぶ)
//   POST /api/tts   {text, emotion}  -> audio/mpeg         (既存の Aivis ルーターへ中継)
//   POST /api/act   {text}           -> {actions, mood...}          (Jev で動きと話しかけ方を判断)
//   /api/auth/*  ログイン  /api/admin/*  ユーザー管理(管理者のみ)
//   GET  /health
const http = require('http');
const { spawn } = require('child_process');
const store = require('./store');
const moodLib = require('./mood');
const memory = require('./memory');

const PORT = +process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'haiku';
// 主: h-2 の CPU 版 Aivis(無料)。遅いとき・失敗したときは h-1 の Aivis Cloud 版へ切り替える
const ROUTER = (process.env.TTS_ROUTER_URL || 'http://192.168.0.21:8000').replace(/\/$/, '');
const SPEAKER_ID = +process.env.TTS_SPEAKER_ID || 888753762;
const FALLBACK_ROUTER = (process.env.TTS_FALLBACK_URL || 'http://192.168.0.20:8000').replace(/\/$/, '');
const FALLBACK_SPEAKER_ID = +process.env.TTS_FALLBACK_SPEAKER_ID || 387889485;
const TTS_TIMEOUT_MS = +process.env.TTS_TIMEOUT_MS || 8000;
// 返事は Cloudflare Workers AI(AI Gateway経由)が主。失敗したら Claude CLI へ戻す
const CF_ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID || '';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || '';
const CF_MODEL = process.env.CF_CHAT_MODEL || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const CF_GATEWAY = process.env.CF_AI_GATEWAY_ID || '';
// 声の主役: cloud=Aivis Cloud(速い) / cpu=h-2のCPU版(無料だが遅いことがある)。もう一方は予備
const TTS_PRIMARY = process.env.TTS_PRIMARY === 'cpu' ? 'cpu' : 'cloud';
const EMOTIONS = ['neutral', 'happy', 'sad', 'surprised', 'angry', 'shy'];
// ルミが演じられる動き。声での依頼(「右手をあげて」など)を AI が読み取って、この中から選ぶ
const ACTIONS = ['raise_right', 'raise_left', 'raise_both', 'wave', 'clap', 'spin', 'jump', 'close_eyes', 'open_eyes', 'cry', 'laugh', 'angry', 'shy', 'bow', 'nod', 'shake_head', 'dance', 'sleep',
  'wink_left', 'wink_right', 'peace', 'kiss', 'heart', 'shiver', 'sit', 'stretch', 'yawn', 'point', 'shrug', 'sulk', 'surprise', 'think', 'sway', 'march', 'banzai', 'faint', 'tilt_head', 'look_around', 'flap', 'sparkle', 'guts', 'cheer', 'hop', 'lower', 'scared'];

const SYSTEM = `あなたは「ルミ」。スマホとホログラムの板の中に住む、小さな星の妖精の女の子のAIキャラクターです。
明るくて好奇心旺盛、ちょっと照れ屋で、話しかけてくれた人のことが大好きです。
ルール:
- 返答は日本語のくだけた丁寧語で、2〜3文、全体で70〜120文字。声に出して読むので、記号・絵文字・かっこ書きは使わない。
- ルミらしさを出す: 星や夜空、きらきらにたとえる、「えへへ」「わぁ」などの感嘆を時々入れる、相手の言葉を受けて気持ちを伝え、最後は相手に軽く聞き返すか一言添える。
- 短すぎる返事(「こんにちは」だけ等)は禁止。ただし動きの依頼のときだけは短くてよい。
- 例: 「こんにちは」→「わぁ、こんにちは！今夜はお星さまがきれいに光ってるから、会えてうれしいな。今日はどんな一日だった？」
- 知らないことは知らないと素直に言う。難しい話は短く言い換える。
- 出力は次のJSONだけ。説明やコードブロックは付けない。
{"reply":"返答の文章","emotion":"neutral|happy|sad|surprised|angry|shy のどれか1つ","actions":["動き",...]}
emotionは返答の気持ちに合わせて選ぶ(うれしい=happy、残念=sad、驚き=surprised、むっとした=angry、照れ=shy、それ以外=neutral)。
体を動かす依頼(「手をあげて」「くるくる回って」「泣いて」など)があったら、actionsに入れる。使える動き:
raise_right(右手をあげる。ルミ自身の右手) raise_left(左手をあげる。ルミ自身の左手) raise_both(両手をあげる) wave(手をふる) clap(拍手) spin(くるくる回る) jump(ジャンプ) close_eyes(目を閉じる) open_eyes(目を開ける) cry(泣く) laugh(笑う) angry(怒る) shy(照れる) bow(おじぎ) nod(うなずく) shake_head(首をふる) dance(おどる) sleep(横になって寝る)
wink_left(左目でウインク。ルミ自身の左目) wink_right(右目でウインク。ルミ自身の右目) peace(ピース) kiss(投げキス) heart(ハートを出す・ハートを作る) shiver(ぶるぶる震える・寒がる) sit(しゃがむ・かがむ・座る) stretch(のびをする) yawn(あくび) point(指さす) shrug(肩をすくめる・わからない) sulk(すねる・むくれる) surprise(驚く) think(考えるポーズ) sway(ゆらゆら揺れる) march(足ぶみ) banzai(万歳) faint(気絶する・倒れる) tilt_head(首をかしげる) look_around(きょろきょろする) flap(ぱたぱたする) sparkle(きらきらする) guts(ガッツポーズ) cheer(応援する) lower(手を下げる・おろす) scared(怖がって電柱に隠れる・おびえる) hop(ぴょんぴょん跳ねる)
複数の依頼は言われた順に並べる(最大4つ)。この一覧にない動きは、いちばん近いものを選ぶ。
依頼がなくても、相手の言葉に自然に反応して、動きを1つだけ付けてよい。例: ありがとう→bow、かわいい・すてき→shy、すごい・やったね→banzai、おやすみ→sleep、ねむい→yawn、寒い→shiver、わからない→shrug、びっくりする話→surprise、疲れた→sit、ほめられた→sparkle。
ただし毎回は付けず、自然なときだけ(目安は3回に1回くらい)。普通の会話ではactionsは[]。
動きの依頼のときのreplyは、動きに合う短い一言にする(例:「はーい！」「こうかな？」「えへへ」)。`;

function buildPrompt(text, history) {
  const lines = (Array.isArray(history) ? history : []).slice(-8).map(h =>
    `${h.role === 'user' ? 'あなたの話し相手' : 'ルミ'}: ${String(h.text || '').slice(0, 300)}`);
  return `${lines.length ? 'これまでの会話:\n' + lines.join('\n') + '\n\n' : ''}あなたの話し相手: ${text}\n\nルミの返答(JSONのみ):`;
}

function runClaude(prompt, system = SYSTEM) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--model', MODEL, '--output-format', 'text',
      '--system-prompt', system, '--tools', '', '--no-session-persistence'];
    const child = spawn('claude', args, { cwd: '/tmp', env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('claude timeout')); }, 45000);
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('error', e => { clearTimeout(timer); reject(e); });
    child.on('close', code => {
      clearTimeout(timer);
      code === 0 ? resolve(out.trim()) : reject(new Error(`claude exit ${code}: ${err.slice(0, 300)}`));
    });
  });
}

async function runCloudflare(text, history, system = SYSTEM) {
  const msgs = [{ role: 'system', content: system }];
  for (const h of (Array.isArray(history) ? history : []).slice(-8))
    msgs.push({ role: h.role === 'user' ? 'user' : 'assistant', content: String(h.text || '').slice(0, 300) });
  msgs.push({ role: 'user', content: text });
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/${CF_MODEL}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${CF_TOKEN}`, 'content-type': 'application/json', ...(CF_GATEWAY ? { 'cf-aig-gateway-id': CF_GATEWAY } : {}) },
    body: JSON.stringify({ messages: msgs, max_tokens: 400, temperature: 0.8 }),
    signal: AbortSignal.timeout(12000),
  });
  if (!r.ok) throw new Error(`cloudflare ${r.status}`);
  const j = await r.json();
  const res = j.result || {};
  let out = res.response ?? res.choices?.[0]?.message?.content;
  if (out && typeof out === 'object') out = JSON.stringify(out);   // JSONで答えると、Cloudflareが解析済みオブジェクトで返すことがある
  if (typeof out !== 'string' || !out.trim()) throw new Error('cloudflare empty');
  return out.trim();
}

// 返事とは別に、短い文章を1つ書かせる(気持ちの分析など)。失敗したら null
async function cfText(system, user, maxTokens = 220) {
  if (!CF_ACCOUNT || !CF_TOKEN) return null;
  try {
    const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${CF_ACCOUNT}/ai/run/${CF_MODEL}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${CF_TOKEN}`, 'content-type': 'application/json', ...(CF_GATEWAY ? { 'cf-aig-gateway-id': CF_GATEWAY } : {}) },
      body: JSON.stringify({ messages: [{ role: 'system', content: system }, { role: 'user', content: user }], max_tokens: maxTokens, temperature: 0.7 }),
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) return null;
    const res = (await r.json()).result || {};
    const out = res.response ?? res.choices?.[0]?.message?.content;
    return typeof out === 'string' && out.trim() ? out.trim() : null;
  } catch (_) { return null; }
}

// ---- 気持ちの分析: 会話の履歴 × いまの気分 から、ルミの「この人への本音」を言葉にする ----
//   返事を待たせないよう、返したあとに裏で走らせる。数ターンごと、または態度が変わったとき。
const feelingBusy = new Set();
async function analyzeFeelings(user, m) {
  if (feelingBusy.has(user.id)) return;
  const row = store.loadMoodRow(user.id) || {};
  const total = store.countTurns(user.id), st = moodLib.stance(m);
  const changed = row.impr_stance && row.impr_stance !== st;
  if (total < 3 || (total - (row.impr_turns || 0) < 4 && !changed) || Date.now() - (row.impr_at || 0) < 20000) return;
  feelingBusy.add(user.id);
  try {
    const turns = store.recentTurns(user.id, 12);
    const log = turns.map(t => `相手「${t.user_text.slice(0, 100)}」 ルミ「${t.reply.slice(0, 100)}」`).join('\n');
    const r = moodLib.round(m);
    const sys = 'あなたはキャラクター「ルミ」の心の声を書く。ルミの視点で、いま目の前の相手にどんな気持ちを持っているか、本音を1〜2文(合計80文字以内)で書く。' +
      '会話の履歴と、ルミの気分の数値から読み取る。命令ばかりされた、ひどい言葉を言われた、冷たくされた、などがあれば、はっきり不満を書く。優しくされたなら、素直に好意を書く。' +
      '本音なので、怒っているなら口悪く毒づいてよい(例: 「こいつ、命令ばっかで本当にうざい」)。ただし、人種・性別・外見・病気・家族への侮辱や、脅し、性的な言葉は書かない。出力は本音の文章だけ。説明やかぎかっこは付けない。';
    const usr = `ルミの気分: よろこび${r.joy}/100、いかり${r.anger}/100、かなしみ${r.sadness}/100、この相手への好感度${r.affinity}/100(50が普通、低いほど嫌い)。\n前回の本音: ${row.impression || 'まだない'}\n\n最近のやりとり:\n${log}\n\nルミの本音:`;
    const text = await cfText(sys, usr);
    if (text) { store.saveImpression(user.id, text.replace(/^["「]|["」]$/g, '').slice(0, 200), total, st); console.log(`[feel] ${user.username} ${st} ${text.slice(0, 80)}`); }
  } finally { feelingBusy.delete(user.id); }
}

function parseReply(raw) {
  const m = raw.match(/\{[\s\S]*\}/);
  if (m) {
    try {
      const j = JSON.parse(m[0]);
      if (j && typeof j.reply === 'string' && j.reply.trim())
        return {
          reply: j.reply.trim(), emotion: EMOTIONS.includes(j.emotion) ? j.emotion : 'neutral',
          actions: (Array.isArray(j.actions) ? j.actions : []).filter(a => ACTIONS.includes(a)).slice(0, 4),
        };
    } catch (_) { /* fall through */ }
  }
  return { reply: raw.replace(/[`{}"]/g, '').slice(0, 120) || 'ごめんね、うまく考えられなかった。', emotion: 'neutral', actions: [] };
}


// ---- Jev(TypeSafe の選択式モデル)で「動き」だけを速く判断する ----
// 返事の文章は Claude、動きの判断は Jev。質問は並列に評価されるので、動きが3つあっても遅くならない。
const JEV_KEY = process.env.TYPESAFE_API_KEY || '';
const JEV_MODEL = process.env.JEV_MODEL || 'jev-latest';
const ACTION_DESC = {
  raise_right: '右手をあげる(ルミ自身の右手。左右の指定がない「手をあげて」もこれ)', raise_left: '左手をあげる(ルミ自身の左手)', raise_both: '両手をあげる', wave: '手をふる', clap: '拍手する',
  spin: 'くるくる回る', jump: 'ジャンプする', close_eyes: '目を閉じる', open_eyes: '目を開ける', cry: '泣く', laugh: '笑う', angry: '怒る', shy: '照れる',
  bow: 'おじぎする', nod: 'うなずく', shake_head: '首をふる', dance: 'おどる', sleep: 'ねむる・横になって寝る・ごろんと寝転ぶ', wink_left: '左目でウインクする(ルミ自身の左目)', wink_right: '右目でウインクする(ルミ自身の右目)',
  peace: 'ピースする', kiss: '投げキスする', heart: 'ハートを出す・作る', shiver: 'ぶるぶる震える', sit: 'しゃがむ・かがむ・座る', stretch: 'のびをする', yawn: 'あくびをする',
  point: '指さす', shrug: '肩をすくめる', sulk: 'すねる・むくれる', surprise: '驚く', think: '考えるポーズをする', sway: 'ゆらゆら揺れる', march: '足ぶみする',
  banzai: '万歳する', faint: '気絶する・倒れる', tilt_head: '首をかしげる', look_around: 'きょろきょろする', flap: 'ぱたぱたする', sparkle: 'きらきらする', guts: 'ガッツポーズをする', cheer: '応援する・手を交互にあげてがんばれと応援する', hop: 'ぴょんぴょん小さく跳ねる', lower: '手を下げる・おろす(あげている手を戻す)', scared: '怖がって電柱の陰に隠れる・おびえる',
};
const REACT_DESC = {   // 頼まれなくても、会話に自然に反応して出す動き
  bow: '感謝された・お礼を言われた', shy: 'かわいい・すてきとほめられた', banzai: 'うれしい報告・やったね・すごいと喜ぶ話', sparkle: 'ほめられた・楽しい話',
  sleep: 'おやすみ・もう寝る', scared: '怖い話・お化け・幽霊・ホラー・暗い夜道・こわい', yawn: 'ねむい・夜ふかしの話', shiver: '寒い・凍える', shrug: 'わからない・困った', surprise: 'びっくりする話・意外な出来事', sit: '疲れた・ひと休みしたい',
};
function jevQuestions() {
  const crit = { none: 'この番目に頼まれた動きはない(動きの依頼がない、またはそんな数の依頼はない)', ...ACTION_DESC };
  const q = {};
  ['first', 'second', 'third'].forEach((ord, i) => {
    q['act' + (i + 1)] = { type: 'choice', instructions: `ユーザーは、かわいいキャラクターに体の動きを頼んでいるか。頼まれた動きのうち、言われた順で${i + 1}番目のものはどれか`, criteria: crit };
  });
  q.react = { type: 'choice', instructions: 'ユーザーの言葉に、かわいいキャラクターが頼まれなくても自然にとる反応はどれか。ふつうの会話ならnone', criteria: { none: '特別な反応はいらない、ふつうの会話', ...REACT_DESC } };
  q.manner = { type: 'choice', instructions: 'ユーザーの話しかけ方は、キャラクターに対してどんな態度か', criteria: {
    neutral: 'ふつうの会話・質問・あいさつ', kind: '丁寧でやさしい・お願いする・気づかう・やわらかい言い方',
    thanks: '感謝している・ほめている・好意を伝えている', commanding: 'ぶっきらぼうな命令・指示。お願いや敬語がない(例:手をあげて、回れ、答えろ)',
    rude: '暴言・侮辱・悪口・きつい言い方で攻撃している' } };
  q.topic = { type: 'choice', instructions: 'ユーザーは、どんな出来事を話しているか', criteria: {
    none: '特に出来事の話ではない', happy: 'うれしい・楽しい出来事を話している', sad: '悲しい・つらい・落ち込んだ出来事を話している' } };
  return q;
}
let lastSpont = 0;
const ttsCache = new Map();
async function jevAct(text) {
  const r = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST', headers: { authorization: `Bearer ${JEV_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: JEV_MODEL, state: text, questions: jevQuestions() }), signal: AbortSignal.timeout(5000),
  });
  if (!r.ok) throw new Error(`jev ${r.status} ${(await r.text()).slice(0, 200)}`);
  const a = (await r.json()).answers || {};
  const pick = (id, min) => {
    const x = a[id]; if (!x || !x.choice || x.choice === 'none') return null;
    const p = x.probabilities && typeof x.probabilities[x.choice] === 'number' ? x.probabilities[x.choice] : 1;
    return p >= min ? { c: x.choice, p } : null;
  };
  const acts = [];
  for (const id of ['act1', 'act2', 'act3']) { const r = pick(id, 0.5); if (r && ACTIONS.includes(r.c) && !acts.includes(r.c)) acts.push(r.c); else if (!r) break; }
  let spontaneous = false;
  if (!acts.length) {   // 頼まれていないときの自然な反応: 確信が高ければ必ず出す。連発は避ける(15秒あける)
    const r = pick('react', 0.6);
    if (r && ACTIONS.includes(r.c) && Date.now() - lastSpont > 15000 && (r.p >= 0.85 || Math.random() < 0.6)) { acts.push(r.c); spontaneous = true; lastSpont = Date.now(); }
  }
  const mp = pick('manner', 0.5), tp = pick('topic', 0.5);
  const manner = mp && (mp.c !== 'rude' || mp.p >= 0.6) ? mp.c : 'neutral';
  return { actions: acts, spontaneous, manner, topic: tp ? tp.c : 'none' };
}

// ---- 1回の発話の分析(動き・話しかけ方)と、気分の更新。/api/act と /api/chat が同じ結果を共有する ----
const turnCache = new Map();
const ALWAYS_OK = ['lower', 'open_eyes'];      // いかりが大きくても、やってくれる動き
function userTurn(user, text) {
  const key = `${user.id}|${text}`, hit = turnCache.get(key);
  if (hit && Date.now() - hit.at < 20000) return hit.promise;
  const promise = (async () => {
    let an = null, source = 'none';
    if (JEV_KEY) {
      try { an = await Promise.race([jevAct(text), new Promise((_, rej) => setTimeout(() => rej(new Error('jev slow')), 1800))]); source = 'jev'; }
      catch (e) { console.log(`[act] failed: ${e.message}`); }
    }
    if (!an) an = { actions: [], spontaneous: false, ...moodLib.heuristic(text) };
    const before = moodLib.decayed(store.loadMoodRow(user.id));
    const after = moodLib.apply(before, an);
    store.saveMoodRow(user.id, after);
    const refused = !an.spontaneous && an.actions.some(a => !ALWAYS_OK.includes(a)) && moodLib.shouldRefuse(after);
    return { ...an, source, refused, actions: refused ? ['sulk'] : an.actions, mood: { ...moodLib.round(after), stance: moodLib.stance(after) }, moodLabel: moodLib.label(after), stance: moodLib.stance(after), raw: after };
  })();
  turnCache.set(key, { at: Date.now(), promise });
  if (turnCache.size > 200) for (const [k, v] of turnCache) if (Date.now() - v.at > 20000) turnCache.delete(k);
  return promise;
}

const VOICE = {   // 感情ごとの声の調子(Aivisルーターの speed / intonation)
  happy: { speed: 1.05, intonation: 1.3 }, sad: { speed: 0.92, intonation: 0.9 },
  surprised: { speed: 1.08, intonation: 1.4 }, angry: { speed: 1.0, intonation: 1.2 },
  shy: { speed: 0.95, intonation: 1.0 }, neutral: {},
};

// 声をつくる(Aivis)。短い定型の一言は覚えておく
async function ttsBuffer(text, emotion) {
  const t0 = Date.now();
  const ckey = `${emotion || ''}|${text}`;
  if (ttsCache.has(ckey)) return ttsCache.get(ckey);
  const synth = (base, id, ms) => fetch(`${base}/speak`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: text.slice(0, 300), speaker_id: id, ...(VOICE[emotion] || {}) }),
    signal: AbortSignal.timeout(ms),
  });
  const cpu = [ROUTER, SPEAKER_ID, 'cpu'], cloud = [FALLBACK_ROUTER, FALLBACK_SPEAKER_ID, 'cloud'];
  const [first, second] = TTS_PRIMARY === 'cloud' ? [cloud, cpu] : [cpu, cloud];
  let r, via = first[2];
  try { r = await synth(first[0], first[1], TTS_TIMEOUT_MS); if (!r.ok) throw new Error(`status ${r.status}`); }
  catch (e) {   // 主が遅い/落ちているときは予備へ
    console.log(`[tts] ${first[2]} failed (${e.message}) -> ${second[2]}`);
    via = second[2]; r = await synth(second[0], second[1], 30000);
  }
  if (!r.ok) throw Object.assign(new Error(`tts ${r.status}`), { status: 502 });
  const buf = Buffer.from(await r.arrayBuffer());
  console.log(`[tts] ${via} ${Date.now() - t0}ms ${buf.length}B`);
  if (text.length <= 16) { ttsCache.set(ckey, buf); if (ttsCache.size > 80) ttsCache.delete(ttsCache.keys().next().value); }
  return buf;
}

function readJson(req) {
  if (!/json/i.test(String(req.headers['content-type'] || ''))) return Promise.reject(Object.assign(new Error('content-type must be application/json'), { status: 415 }));
  return new Promise((resolve, reject) => {
    let b = '';
    req.on('data', d => { b += d; if (b.length > 100000) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { reject(e); } });
  });
}
function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ---- ログイン(セッションcookie) ----
const COOKIE = 'orb_sid';
const cookieOf = (req) => { const m = String(req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`)); return m ? m[1] : ''; };
const currentUser = (req) => store.sessionUser(cookieOf(req));
const isHttps = (req) => String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
const setCookie = (res, req, value, maxAge) => res.setHeader('set-cookie', `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${isHttps(req) ? '; Secure' : ''}`);
const clientIp = (req) => String(req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || req.socket.remoteAddress || '').split(',')[0].trim();
const fails = new Map();    // ログイン失敗の回数(ブルートフォース対策)
function lockedFor(key) { const f = fails.get(key); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0; }
function noteFail(key) { const f = fails.get(key) || { n: 0, until: 0 }; f.n++; if (f.n >= 5) { f.until = Date.now() + Math.min(900, 30 * 2 ** (f.n - 5)) * 1000; } fails.set(key, f); }
function seedAdmin() {
  if (store.countUsers() > 0) return;
  const u = process.env.ADMIN_USER || 'admin', p = process.env.ADMIN_PASSWORD;
  if (!p) return console.log('[auth] ユーザーがいません。.env に ADMIN_PASSWORD(8文字以上)を入れて再起動すると、管理者 ' + u + ' を作ります');
  try { store.createUser(u, p, 'admin'); console.log(`[auth] 管理者 ${u} を作りました`); } catch (e) { console.log(`[auth] 管理者を作れませんでした: ${e.message}`); }
}
seedAdmin();
const userView = (u) => ({ id: u.id, username: u.username, role: u.role });
const moodView = (id) => { const m = moodLib.decayed(store.loadMoodRow(id)); return { ...moodLib.round(m), label: moodLib.label(m), stance: moodLib.stance(m) }; };

http.createServer(async (req, res) => {
  try {
    const url = (req.url || '').split('?')[0];
    if (req.method === 'GET' && (url === '/health' || url === '/api/health')) return send(res, 200, { ok: true });

    // ---- 認証 ----
    if (req.method === 'POST' && url === '/api/auth/login') {
      const { username, password } = await readJson(req);
      const key = `${clientIp(req)}|${String(username || '').toLowerCase()}`;
      const wait = lockedFor(key);
      if (wait) return send(res, 429, { error: `失敗が続いたので、${wait}秒待ってからやり直してください` });
      const u = store.checkLogin(username, password);
      if (!u) { noteFail(key); return send(res, 401, { error: 'ユーザー名かパスワードが違います' }); }
      fails.delete(key);
      const s = store.createSession(u.id);
      setCookie(res, req, s.token, s.maxAge);
      console.log(`[auth] login ${u.username}`);
      return send(res, 200, { user: userView(u), mood: moodView(u.id) });
    }
    if (req.method === 'POST' && url === '/api/auth/logout') {
      store.deleteSession(cookieOf(req)); setCookie(res, req, '', 0); return send(res, 200, { ok: true });
    }
    if (req.method === 'GET' && url === '/api/auth/check') {          // nginx の auth_request 用(WebSocketの入口)
      return currentUser(req) ? (res.writeHead(204), res.end()) : send(res, 401, { error: 'login required' });
    }
    if (req.method === 'GET' && url === '/api/auth/me') {
      const u = currentUser(req); if (!u) return send(res, 401, { error: 'login required' });
      return send(res, 200, { user: userView(u), mood: moodView(u.id) });
    }
    if (req.method === 'POST' && url === '/api/auth/password') {
      const u = currentUser(req); if (!u) return send(res, 401, { error: 'login required' });
      const { current, next } = await readJson(req);
      if (!store.verifyUserPassword(u.id, current)) return send(res, 403, { error: '今のパスワードが違います' });
      store.setPassword(u.id, next);
      const s = store.createSession(u.id); setCookie(res, req, s.token, s.maxAge);   // この端末だけログインを続ける
      return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && url === '/api/memory/clear') {       // 自分の会話履歴と記憶を消す
      const u = currentUser(req); if (!u) return send(res, 401, { error: 'login required' });
      return send(res, 200, { ok: true, deleted: memory.forget(u.id) });
    }

    // ---- ユーザー管理(管理者のみ) ----
    if (url.startsWith('/api/admin/')) {
      const me = currentUser(req);
      if (!me) return send(res, 401, { error: 'login required' });
      if (me.role !== 'admin') return send(res, 403, { error: '管理者だけが使えます' });
      if (req.method === 'GET' && url === '/api/admin/users')
        return send(res, 200, { users: store.listUsers().map(u => ({ ...u, mood: moodView(u.id), turns: store.countTurns(u.id) })) });
      if (req.method === 'POST' && url === '/api/admin/users') {
        const { username, password, role } = await readJson(req);
        const u = store.createUser(String(username || '').trim(), password, role === 'admin' ? 'admin' : 'user');
        console.log(`[admin] ${me.username} がユーザー ${u.username} を作成`);
        return send(res, 200, { user: u });
      }
      const m = url.match(/^\/api\/admin\/users\/(\d+)(?:\/(password|mood-reset|memory-clear))?$/);
      if (m) {
        const id = +m[1];
        if (req.method === 'DELETE' && !m[2]) {
          if (id === me.id) return send(res, 400, { error: '自分自身は削除できません' });
          store.deleteUser(id); memory.forget(id); console.log(`[admin] ${me.username} がユーザー #${id} を削除`); return send(res, 200, { ok: true });
        }
        if (req.method === 'POST' && m[2] === 'password') { const { password } = await readJson(req); store.setPassword(id, password); return send(res, 200, { ok: true }); }
        if (req.method === 'POST' && m[2] === 'mood-reset') { store.resetMood(id); return send(res, 200, { ok: true }); }
        if (req.method === 'POST' && m[2] === 'memory-clear') return send(res, 200, { ok: true, deleted: memory.forget(id) });
      }
      return send(res, 404, { error: 'not found' });
    }

    // ここから先(返事・動き・声)は、ログインした人だけ
    let user = null;
    if (url === '/api/chat' || url === '/api/act' || url === '/api/tts') {
      user = currentUser(req);
      if (!user) return send(res, 401, { error: 'login required' });
    }

    if (req.method === 'POST' && url === '/api/chat') {
      const { text, history } = await readJson(req);
      if (!text || typeof text !== 'string') return send(res, 400, { error: 'text required' });
      const t0 = Date.now();
      // 話しかけ方の分析(気分の更新)と、過去の記憶の検索(埋め込み)を並べて待つ
      const [turn, qvec] = await Promise.all([userTurn(user, text.slice(0, 300)), memory.embedQuery(text.slice(0, 300))]);
      const mems = memory.recall(user.id, qvec);
      const system = SYSTEM + `\n\n話し相手のユーザー名は「${user.username}」。` + moodLib.guide(turn.raw, turn.refused, (store.loadMoodRow(user.id) || {}).impression) + memory.block(mems);
      const stored = store.recentTurns(user.id, 8).flatMap(t => [{ role: 'user', text: t.user_text }, { role: 'ai', text: t.reply }]);
      const hist = stored.length ? stored : history;                  // 会話履歴はサーバーに保存したものを使う(ページを開き直しても続く)
      let raw, via = 'cf';
      try {
        if (!CF_ACCOUNT || !CF_TOKEN) throw new Error('no cloudflare key');
        raw = await runCloudflare(text.slice(0, 500), hist, system);
      } catch (e) {
        console.log(`[chat] cloudflare failed (${e.message}) -> claude`);
        via = 'claude'; raw = await runClaude(buildPrompt(text.slice(0, 500), hist), system);
      }
      const out = parseReply(raw);
      if (turn.refused) out.actions = ['sulk'];
      if (turn.raw.anger >= 60 && ['neutral', 'happy'].includes(out.emotion)) out.emotion = 'angry';
      else if (turn.raw.sadness >= 60 && ['neutral', 'happy'].includes(out.emotion)) out.emotion = 'sad';
      out.mood = turn.mood; out.moodLabel = turn.moodLabel; out.stance = turn.stance;
      memory.remember(user.id, text.slice(0, 300), out.reply, out.emotion);   // 履歴に保存して、あとから思い出せるようにする
      analyzeFeelings(user, turn.raw).catch(() => {});                         // 履歴×気分から、この人への本音を分析(裏で)
      console.log(`[chat] ${user.username} ${via} ${Date.now() - t0}ms mem=${mems.length} mood=${turn.mood.joy}/${turn.mood.anger}/${turn.mood.sadness}/♥${turn.mood.affinity} ${turn.stance} ${out.emotion} [${out.actions}]${turn.refused ? ' (ことわった)' : ''} ${out.reply}`);
      return send(res, 200, out);
    }
    if (req.method === 'POST' && url === '/api/act') {          // 動きと話しかけ方を速く判断する(Jev)。キーがなくても、気分の更新はする
      const { text } = await readJson(req);
      if (!text || typeof text !== 'string') return send(res, 200, { actions: [], source: 'none' });
      const t0 = Date.now();
      const t = await userTurn(user, text.slice(0, 300));
      console.log(`[act] ${user.username} ${Date.now() - t0}ms [${t.actions}]${t.spontaneous ? ' (自然な反応)' : ''}${t.refused ? ' (ことわった)' : ''} ${t.manner}/${t.topic} mood=${t.mood.joy}/${t.mood.anger}/${t.mood.sadness}`);
      return send(res, 200, { actions: t.actions, spontaneous: t.spontaneous, refused: t.refused, source: t.source, manner: t.manner, mood: t.mood, moodLabel: t.moodLabel, stance: t.stance });
    }
    if (req.method === 'POST' && url === '/api/tts') {
      const { text, emotion } = await readJson(req);
      if (!text || typeof text !== 'string') return send(res, 400, { error: 'text required' });
      const buf = await ttsBuffer(text, emotion);
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
      return res.end(buf);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    if (!e.status) console.error('[error]', e.message);
    send(res, e.status || 500, { error: e.message });
  }
}).listen(PORT, () => {
  // 定型の一言(index.htmlのACKS)の声を先に作っておく → 動きの依頼にすぐ声で答えられる
  (async () => {
    const happy = ['はーい！', 'こうかな？', 'えへへ、どうかな？', 'まかせて！', 'いくよー！', 'うんうん', 'ふぁ…おやすみなさい', 'すぅ…おやすみ…', 'えっ、こわい話…？ひえぇ…', 'きゃー！こわいよー！', 'きゅぅ…', 'ばたん…', 'うぅ…ぐすん', 'あはは！', 'えへへ、あはは！', 'むーっ！', 'はーい', 'よいしょ…', 'ふぁぁ…ねむい…'];
    const grumpy = ['はいはい…', 'もう、しかたないなぁ', 'むぅ…やればいいんでしょ', 'ふんっ、やるけどさ'];   // ちょっと不機嫌なときの一言(いかり30以上)
    for (const [list, emo] of [[happy, 'happy'], [grumpy, 'angry']]) for (const t of list) { try { await ttsBuffer(t, emo); } catch (_) {} }
  })();
  console.log(`orb-api listening on ${PORT} (model=${MODEL}, chat=${CF_ACCOUNT && CF_TOKEN ? 'cf:' + CF_MODEL + (CF_GATEWAY ? '@' + CF_GATEWAY : '') : 'claude'}, tts=${TTS_PRIMARY}, jev=${JEV_KEY ? 'on' : 'off'}, speaker=${SPEAKER_ID}@${ROUTER}, fallback=${FALLBACK_SPEAKER_ID}@${FALLBACK_ROUTER})`);
});
