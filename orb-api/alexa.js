// Amazon Echo(Alexaカスタムスキル)の入口。ルミ本体の chat / 声(ttsBuffer)をそのまま使う。
//  - Alexaは返事を約8秒しか待たない → 返事を文に分け、間に合う分だけ声にして返す。残りは「続き」で読む
//  - 声はMP3を <audio> で再生させる。Alexaの形式(MPEG2 / 48kbps / 16kHz)に ffmpeg で変換して、短時間だけ公開する
//  - Alexaにはルミのログインがない → URLの秘密キー(ALEXA_KEY)で呼び出し元を確かめ、ALEXA_USER のルミに話す
const crypto = require('crypto');
const { spawn } = require('child_process');

const BUDGET_MS = +process.env.ALEXA_BUDGET_MS || 6000;     // Alexaの約8秒から、通信と変換の余裕を引いた「声を作ってよい時間」
const TTL_MS = 5 * 60 * 1000;
const clips = new Map();     // id -> mp3 Buffer
const pending = new Map();   // sessionId -> まだ読んでいない残りの文

function splitSentences(t) {   // index.html の splitSentences と同じ考え方(。！？で切り、短すぎる断片は前にくっつける)
  const parts = String(t).replace(/\s+/g, ' ').split(/(?<=[。！？!?])/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) { if (out.length && out[out.length - 1].length < 8) out[out.length - 1] += p; else out.push(p); }
  return out;
}

function toAlexaMp3(buf) {   // MPEG2 / 48kbps / 16kHz / mono
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-ac', '1', '-ar', '16000', '-b:a', '48k', '-codec:a', 'libmp3lame', '-f', 'mp3', 'pipe:1']);
    const out = [], err = [];
    p.stdout.on('data', d => out.push(d)); p.stderr.on('data', d => err.push(d));
    p.on('error', reject);
    p.on('close', code => code === 0 ? resolve(Buffer.concat(out)) : reject(new Error('ffmpeg ' + Buffer.concat(err).toString().slice(0, 120))));
    p.stdin.on('error', () => {}); p.stdin.end(buf);
  });
}

const addClip = (mp3) => { const id = crypto.randomUUID(); clips.set(id, mp3); setTimeout(() => clips.delete(id), TTL_MS).unref(); return id; };
const getClip = (id) => clips.get(id) || null;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// body: Alexaのリクエスト。chat(text) → {reply, emotion}、tts(text, emotion) → mp3 Buffer、origin: 音声の公開URLの頭(https://holo.s-quad.com)
async function handle({ body, origin, chat, tts, log }) {
  const t0 = Date.now(), rq = body.request || {}, sid = (body.session || {}).sessionId || 'local';
  if (rq.type === 'SessionEndedRequest') { pending.delete(sid); return { version: '1.0', response: {} }; }
  let sentences, emotion = 'happy';
  const said = ((rq.intent || {}).slots || {}).text?.value || '';
  if (rq.type === 'LaunchRequest') sentences = ['はーい、ルミだよ。なんでも話しかけてね。'];
  else if (rq.intent && /AMAZON\.(Stop|Cancel)Intent/.test(rq.intent.name)) return { version: '1.0', response: { outputSpeech: { type: 'PlainText', text: 'またね。' }, shouldEndSession: true } };
  else if (/^(つづき|続き)/.test(said) && pending.get(sid)?.length) { sentences = pending.get(sid); pending.delete(sid); }
  else if (!said) return { version: '1.0', response: { outputSpeech: { type: 'PlainText', text: 'ごめんね、聞き取れなかったよ。もう一回言って？' }, reprompt: { outputSpeech: { type: 'PlainText', text: 'なにか話して？' } }, shouldEndSession: false } };
  else {
    const r = await chat(said);
    sentences = splitSentences(r.reply); emotion = r.emotion || 'happy';
  }
  // 間に合う分だけ声にする。次の1文は、ここまでの最長と同じだけかかる、と見て入らなければ打ち切る
  const done = []; let worst = 0, last = Date.now();
  for (const s of sentences) {
    const left = BUDGET_MS - (Date.now() - t0);
    if (done.length && worst > left) break;
    try {
      const mp3 = await Promise.race([tts(s, emotion).then(toAlexaMp3), new Promise((_, rej) => setTimeout(() => rej(new Error('budget')), Math.max(1500, left)))]);
      done.push({ text: s, id: addClip(mp3) });
    } catch (e) { log(`[alexa] 声が間に合わず/失敗: ${e.message}`); if (!done.length) done.push({ text: s, id: null }); break; }
    worst = Math.max(worst, Date.now() - last); last = Date.now();
  }
  const rest = sentences.slice(done.length);
  if (rest.length) pending.set(sid, rest); else pending.delete(sid);
  let ssml = '<speak>';
  for (const d of done) ssml += d.id ? `<audio src="${origin}/api/alexa/audio/${d.id}.mp3"/>` : esc(d.text);   // 声が作れなかった文は、Alexa自身の声で読む
  if (rest.length) ssml += '<break time="300ms"/>続きは、「続き」って言ってね。';
  ssml += '</speak>';
  log(`[alexa] ${Date.now() - t0}ms ${done.length}/${sentences.length}文 「${said.slice(0, 20)}」`);
  // reprompt: 黙っていても「アレクサ」なしで聞き続ける時間を延ばす(返すのは待ちの一言だけ)
  return { version: '1.0', response: { outputSpeech: { type: 'SSML', ssml }, reprompt: { outputSpeech: { type: 'PlainText', text: 'まだいるよ。なにか話して？' } }, shouldEndSession: false } };
}

module.exports = { handle, getClip };
