'use strict';
// orb-api: ホログラムキャラ用の小さな中継サーバー。
//   POST /api/chat  {text, history}  -> {reply, emotion}   (Claude Code CLI を headless で呼ぶ)
//   POST /api/tts   {text, emotion}  -> audio/mpeg         (既存の Aivis ルーターへ中継)
//   GET  /health
const http = require('http');
const { spawn } = require('child_process');

const PORT = +process.env.PORT || 3000;
const MODEL = process.env.CLAUDE_MODEL || 'haiku';
// 主: h-2 の CPU 版 Aivis(無料)。遅いとき・失敗したときは h-1 の Aivis Cloud 版へ切り替える
const ROUTER = (process.env.TTS_ROUTER_URL || 'http://192.168.0.21:8000').replace(/\/$/, '');
const SPEAKER_ID = +process.env.TTS_SPEAKER_ID || 888753762;
const FALLBACK_ROUTER = (process.env.TTS_FALLBACK_URL || 'http://192.168.0.20:8000').replace(/\/$/, '');
const FALLBACK_SPEAKER_ID = +process.env.TTS_FALLBACK_SPEAKER_ID || 387889485;
const TTS_TIMEOUT_MS = +process.env.TTS_TIMEOUT_MS || 8000;
const EMOTIONS = ['neutral', 'happy', 'sad', 'surprised', 'angry', 'shy'];
// ルミが演じられる動き。声での依頼(「右手をあげて」など)を AI が読み取って、この中から選ぶ
const ACTIONS = ['raise_right', 'raise_left', 'raise_both', 'wave', 'clap', 'spin', 'jump', 'close_eyes', 'open_eyes', 'cry', 'laugh', 'angry', 'shy', 'bow', 'nod', 'shake_head', 'dance', 'sleep'];

const SYSTEM = `あなたは「ルミ」。スマホとホログラムの板の中に住む、小さな星の妖精の女の子のAIキャラクターです。
明るくて好奇心旺盛、ちょっと照れ屋で、話しかけてくれた人のことが大好きです。
ルール:
- 返答は日本語のくだけた丁寧語で、1〜2文、全体で60文字以内。声に出して読むので、記号・絵文字・かっこ書きは使わない。
- 知らないことは知らないと素直に言う。難しい話は短く言い換える。
- 出力は次のJSONだけ。説明やコードブロックは付けない。
{"reply":"返答の文章","emotion":"neutral|happy|sad|surprised|angry|shy のどれか1つ","actions":["動き",...]}
emotionは返答の気持ちに合わせて選ぶ(うれしい=happy、残念=sad、驚き=surprised、むっとした=angry、照れ=shy、それ以外=neutral)。
体を動かす依頼(「手をあげて」「くるくる回って」「泣いて」など)があったら、actionsに入れる。使える動き:
raise_right(画面の右側の手をあげる) raise_left(画面の左側の手をあげる) raise_both(両手をあげる) wave(手をふる) clap(拍手) spin(くるくる回る) jump(ジャンプ) close_eyes(目を閉じる) open_eyes(目を開ける) cry(泣く) laugh(笑う) angry(怒る) shy(照れる) bow(おじぎ) nod(うなずく) shake_head(首をふる) dance(おどる) sleep(ねむる)
複数の依頼は言われた順に並べる(最大4つ)。この一覧にない動きは、いちばん近いものを選ぶ。依頼がなければactionsは[]。
動きの依頼のときのreplyは、動きに合う短い一言にする(例:「はーい！」「こうかな？」「えへへ」)。`;

function buildPrompt(text, history) {
  const lines = (Array.isArray(history) ? history : []).slice(-8).map(h =>
    `${h.role === 'user' ? 'あなたの話し相手' : 'ルミ'}: ${String(h.text || '').slice(0, 300)}`);
  return `${lines.length ? 'これまでの会話:\n' + lines.join('\n') + '\n\n' : ''}あなたの話し相手: ${text}\n\nルミの返答(JSONのみ):`;
}

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--model', MODEL, '--output-format', 'text',
      '--system-prompt', SYSTEM, '--tools', '', '--no-session-persistence'];
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

const VOICE = {   // 感情ごとの声の調子(Aivisルーターの speed / intonation)
  happy: { speed: 1.05, intonation: 1.3 }, sad: { speed: 0.92, intonation: 0.9 },
  surprised: { speed: 1.08, intonation: 1.4 }, angry: { speed: 1.0, intonation: 1.2 },
  shy: { speed: 0.95, intonation: 1.0 }, neutral: {},
};

function readJson(req) {
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

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && (req.url === '/health' || req.url === '/api/health')) return send(res, 200, { ok: true });
    if (req.method === 'POST' && req.url === '/api/chat') {
      const { text, history } = await readJson(req);
      if (!text || typeof text !== 'string') return send(res, 400, { error: 'text required' });
      const t0 = Date.now();
      const raw = await runClaude(buildPrompt(text.slice(0, 500), history));
      const out = parseReply(raw);
      console.log(`[chat] ${Date.now() - t0}ms ${out.emotion} [${out.actions}] ${out.reply}`);
      return send(res, 200, out);
    }
    if (req.method === 'POST' && req.url === '/api/tts') {
      const { text, emotion } = await readJson(req);
      if (!text || typeof text !== 'string') return send(res, 400, { error: 'text required' });
      const t0 = Date.now();
      const synth = (base, id, ms) => fetch(`${base}/speak`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: text.slice(0, 300), speaker_id: id, ...(VOICE[emotion] || {}) }),
        signal: AbortSignal.timeout(ms),
      });
      let r, via = 'cpu';
      try { r = await synth(ROUTER, SPEAKER_ID, TTS_TIMEOUT_MS); if (!r.ok) throw new Error(`status ${r.status}`); }
      catch (e) {   // CPU版が遅い/落ちているときはクラウド版へ(CPU側の処理は続くので、次回は速くなる)
        console.log(`[tts] cpu failed (${e.message}) -> cloud`);
        via = 'cloud'; r = await synth(FALLBACK_ROUTER, FALLBACK_SPEAKER_ID, 30000);
      }
      if (!r.ok) return send(res, 502, { error: `tts ${r.status}` });
      const buf = Buffer.from(await r.arrayBuffer());
      console.log(`[tts] ${via} ${Date.now() - t0}ms ${buf.length}B`);
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
      return res.end(buf);
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error('[error]', e.message);
    send(res, 500, { error: e.message });
  }
}).listen(PORT, () => console.log(`orb-api listening on ${PORT} (model=${MODEL}, speaker=${SPEAKER_ID}@${ROUTER}, fallback=${FALLBACK_SPEAKER_ID}@${FALLBACK_ROUTER})`));
