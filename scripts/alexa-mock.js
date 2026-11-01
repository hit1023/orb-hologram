#!/usr/bin/env node
// Alexa(Echo)対応のモック: 「Echoに話しかけたら、8秒以内にルミの声で返せるか」を手元で試す。
//   node scripts/alexa-mock.js   →   http://localhost:8899/  (Echo役のページ)
// 実際のAlexaは POST /alexa に下のJSON形式でリクエストを送ってくる(このモックは同じ形式で受ける)。
// 依存なし(Node 18+)。ルミ本体(認証つき)には繋がず、返事は用意した例文+LLMの待ち時間を疑似的に足す。
//   ROUTER=http://192.168.0.21:8000  SPEAKER_ID=888753762  LLM_MS=1500  BUDGET_MS=6500  PORT=8899
const http = require('http');
const crypto = require('crypto');

const PORT = +process.env.PORT || 8899;
const ROUTER = (process.env.ROUTER || 'http://192.168.0.21:8000').replace(/\/$/, '');
const SPEAKER_ID = +process.env.SPEAKER_ID || 888753762;
const LLM_MS = +process.env.LLM_MS || 1500;          // 返事を作る時間(Cloudflare Workers AI の実測は1〜2秒)
const BUDGET_MS = +process.env.BUDGET_MS || 6500;    // Alexaの約8秒から、通信と余裕を引いた「声を作ってよい時間」
const ALEXA_LIMIT_MS = 8000;

const SAMPLES = [
  'おかえりなさい！今日もおつかれさま。ごはんは食べた？私はね、さっきまで窓の外の雨をずっと眺めてたの。静かでちょっと好きだったよ。',
  'うーん、それはいい質問だね。まず落ち着いて考えると、やり方は二つあると思う。急ぐなら一つ目、ていねいにやるなら二つ目がおすすめだよ。',
  'わあ、うれしい！ありがとう。そんなふうに言ってもらえると、私もがんばろうって気持ちになるよ。また明日もお話ししようね。',
];
const pending = new Map();   // sessionId -> まだ読んでいない残りの文
const audio = new Map();     // id -> mp3 Buffer (数分で捨てる)

// ルミと同じ分割: 。！？改行で切る(短すぎは次とくっつける)
function splitSentences(t) {
  const parts = t.replace(/\s+/g, ' ').split(/(?<=[。！？!?])/).map(s => s.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) { if (out.length && out[out.length - 1].length < 8) out[out.length - 1] += p; else out.push(p); }
  return out;
}

const last0 = (t) => t + LLM_MS;
// 予算(BUDGET_MS)の範囲で、できた文までを返す。次の1文に、ここまでの最長と同じだけかかる、と見て入りそうになければ打ち切る。
async function synth(sentences, startedAt) {
  const got = [], marks = [];
  const ac = new AbortController();
  const res = await fetch(`${ROUTER}/speak_stream`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': 'alexa-mock' },
    body: JSON.stringify({ text: sentences.join(''), speaker_id: SPEAKER_ID, max_len: 60 }), signal: ac.signal,
  });
  if (!res.ok) throw new Error('router ' + res.status);
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', last = Date.now(), worst = 0;
  outer: for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      const j = JSON.parse(line);
      if (j.error) throw new Error(j.error);
      const now = Date.now();
      got.push({ text: j.text, mp3: Buffer.from(j.audio, 'base64') });
      marks.push({ text: j.text, ms: now - startedAt, took: now - last }); last = now;
      worst = Math.max(worst, now - (marks.length > 1 ? startedAt + marks[marks.length - 2].ms : last0(startedAt)));
      if (got.length < j.n && now - startedAt + worst > BUDGET_MS) { ac.abort(); break outer; }   // 次の文は間に合わない
    }
  }
  return { got, marks };
}

async function handleAlexa(body, host) {
  const t0 = Date.now(), rq = body.request || {}, sid = (body.session || {}).sessionId || 'local';
  const tl = [];   // 疑似タイムライン(ページで表示する)
  let sentences, pre = '';
  if (rq.type === 'LaunchRequest') { sentences = ['はーい、ルミだよ。なんでも話しかけてね。']; }
  else if (rq.type === 'SessionEndedRequest') return { version: '1.0', response: {} };
  else {
    const said = ((rq.intent || {}).slots || {}).text?.value || '';
    if (/^(つづき|続き)/.test(said) && pending.get(sid)?.length) { sentences = pending.get(sid); pending.delete(sid); pre = ''; }
    else {
      await new Promise(r => setTimeout(r, LLM_MS)); tl.push({ label: '返事を作る(疑似)', ms: Date.now() - t0 });
      sentences = splitSentences(SAMPLES[Math.floor(Math.random() * SAMPLES.length)]);
    }
  }
  const { got, marks } = await synth(sentences, t0);
  for (const m of marks) tl.push({ label: `声: ${m.text.slice(0, 14)}…`, ms: m.ms });
  const rest = sentences.join('').slice(got.map(g => g.text).join('').length);
  const restSentences = rest ? splitSentences(rest) : [];
  if (restSentences.length) pending.set(sid, restSentences); else pending.delete(sid);
  let ssml = '<speak>';
  for (const g of got) { const id = crypto.randomUUID(); audio.set(id, g.mp3); setTimeout(() => audio.delete(id), 300000); ssml += `<audio src="https://${host}/audio/${id}.mp3"/>`; }
  if (restSentences.length) ssml += '<break time="300ms"/>続きは、「続き」って言ってね。';
  ssml += '</speak>';
  const total = Date.now() - t0;
  return {
    version: '1.0',
    response: { outputSpeech: { type: 'SSML', ssml }, shouldEndSession: false },
    _mock: { totalMs: total, limitMs: ALEXA_LIMIT_MS, ok: total < ALEXA_LIMIT_MS, timeline: tl, spoken: got.map(g => g.text), remaining: restSentences },
  };
}

const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>Echo モック</title>
<style>body{font:15px system-ui;max-width:640px;margin:24px auto;padding:0 16px;background:#0e1020;color:#e8eaf6}
input{width:70%;padding:10px;border-radius:8px;border:1px solid #3a3f6b;background:#171a33;color:inherit}button{padding:10px 14px;border-radius:8px;border:0;background:#6c7bff;color:#fff}
.card{background:#171a33;border-radius:10px;padding:12px;margin:12px 0}.bar{height:10px;background:#2a2f55;border-radius:5px;position:relative;margin:10px 0}
.fill{height:100%;border-radius:5px}.ok{background:#4cd08a}.ng{background:#ff6b6b}.lim{position:absolute;right:0;top:-4px;bottom:-4px;border-right:2px dashed #ffd166}small{color:#9aa0c8}</style>
<h2>Echo モック(Alexaスキル)</h2><small>Alexaの待ち時間 8 秒。声はLAN内のCPU版(ルーター経由)。実際のEchoでは再生されません、ここで再生します。</small>
<div class=card><input id=t placeholder="Echoに話しかける(例: 今日どうだった?)"> <button id=go>話しかける</button> <button id=launch>「ルミを開いて」</button></div><div id=log></div>
<script>
const log=document.getElementById('log');
async function call(req){
  const t=performance.now();
  const r=await fetch('/alexa',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({version:'1.0',session:{sessionId:'page'},request:req})});
  const j=await r.json(), m=j._mock, wall=Math.round(performance.now()-t), pct=Math.min(100,m.totalMs/m.limitMs*100);
  const urls=[...j.response.outputSpeech.ssml.matchAll(/src="([^"]+)"/g)].map(x=>x[1].replace(/^https:\\/\\/[^/]+/,''));
  const d=document.createElement('div');d.className='card';
  d.innerHTML='<b>'+(m.ok?'✅ 8秒以内':'❌ 8秒超え')+' '+m.totalMs+' ms</b><div class=bar><div class="fill '+(m.ok?'ok':'ng')+'" style="width:'+pct+'%"></div><div class=lim></div></div>'
   +m.timeline.map(x=>'<small>'+x.ms+' ms　'+x.label+'</small>').join('<br>')
   +'<p>読んだ: '+(m.spoken.join(' / ')||'なし')+'</p>'+(m.remaining.length?'<p><small>残り '+m.remaining.length+' 文 →「続き」で読む</small></p>':'');
  log.prepend(d);
  for(const u of urls){await new Promise(res=>{const a=new Audio(u);a.onended=a.onerror=res;a.play().catch(res);});}
}
document.getElementById('go').onclick=()=>{const v=document.getElementById('t').value||'こんにちは';call({type:'IntentRequest',intent:{name:'ChatIntent',slots:{text:{value:v}}}})};
document.getElementById('launch').onclick=()=>call({type:'LaunchRequest'});
document.getElementById('t').onkeydown=e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229)document.getElementById('go').click()};
</script>`;

http.createServer(async (req, res) => {
  try {
    if (req.method === 'GET' && req.url === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(PAGE); }
    const am = req.url.match(/^\/audio\/([\w-]+)\.mp3$/);
    if (req.method === 'GET' && am) { const b = audio.get(am[1]); if (!b) { res.writeHead(404); return res.end(); } res.writeHead(200, { 'content-type': 'audio/mpeg' }); return res.end(b); }
    if (req.method === 'POST' && req.url === '/alexa') {
      let s = ''; for await (const c of req) s += c;
      const out = await handleAlexa(JSON.parse(s || '{}'), req.headers.host || `localhost:${PORT}`);
      res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(out));
    }
    res.writeHead(404); res.end();
  } catch (e) { console.error(e); res.writeHead(500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: e.message })); }
}).listen(PORT, () => console.log(`alexa-mock http://localhost:${PORT}/  router=${ROUTER} budget=${BUDGET_MS}ms llm=${LLM_MS}ms`));
