'use strict';
// ルミの気分(よろこび・いかり・かなしみ)。話しかけ方でゆれ、時間がたつと落ち着く。
//   joy / anger / sadness は 0〜100。ふだんは よろこび50・いかり0・かなしみ0。
const BASE = { joy: 50, anger: 0, sadness: 0 };
const HALF_LIFE_MIN = 30;        // 気分は30分で、ふだんの状態へ半分もどる
const REFUSE_ANGER = 80;         // いかりがここまで高いと、動きの頼みをことわる
const clamp = (v) => Math.max(0, Math.min(100, v));

function fresh(now) { return { ...BASE, streak: 0, updated_at: now }; }

// 時間がたった分だけ、ふだんの状態へ近づける
function decayed(row, now = Date.now()) {
  if (!row) return fresh(now);
  const k = Math.pow(0.5, Math.max(0, now - row.updated_at) / 60000 / HALF_LIFE_MIN);
  const toward = (v, b) => b + (v - b) * k;
  return { joy: toward(row.joy, BASE.joy), anger: toward(row.anger, BASE.anger), sadness: toward(row.sadness, BASE.sadness),
    streak: k < 0.5 ? 0 : row.streak, updated_at: now };
}

// 今回の話しかけ方(manner)と話題(topic)で気分を動かす
//   manner: neutral / kind / thanks / commanding / rude    topic: none / happy / sad
function apply(m, { manner, topic }) {
  const o = { ...m };
  switch (manner) {
    case 'kind': o.joy += 6; o.anger -= 6; o.streak = 0; break;
    case 'thanks': o.joy += 10; o.anger -= 9; o.sadness -= 4; o.streak = 0; break;
    case 'commanding': o.streak = (m.streak || 0) + 1; o.anger += 6 + Math.min(o.streak, 5) * 2; o.joy -= 4; break;   // 命令がつづくほど、いらいらが増える
    case 'rude': o.streak = (m.streak || 0) + 1; o.anger += 22; o.sadness += 10; o.joy -= 10; break;
    default: o.streak = 0; o.anger -= 2;
  }
  if (topic === 'happy') { o.joy += 8; o.sadness -= 3; }
  if (topic === 'sad') { o.sadness += 10; o.joy -= 3; }
  o.joy = clamp(o.joy); o.anger = clamp(o.anger); o.sadness = clamp(o.sadness);
  return o;
}

const round = (m) => ({ joy: Math.round(m.joy), anger: Math.round(m.anger), sadness: Math.round(m.sadness) });
function label(m) {
  if (m.anger >= 60 && m.anger >= m.sadness) return 'angry';
  if (m.sadness >= 50) return 'sad';
  if (m.anger >= 30) return 'grumpy';
  if (m.joy >= 75) return 'joyful';
  return 'calm';
}

// 気分に合わせて、ルミの話し方を変えるための指示(システムプロンプトの末尾に足す)
function guide(m, refusing) {
  const r = round(m);
  const lines = [`\n\n【いまのルミの気分】よろこび${r.joy}/100、いかり${r.anger}/100、かなしみ${r.sadness}/100。この気分が返事の言い方や気持ちにはっきり出るようにする。`];
  if (m.anger >= 80) lines.push('いかりが大きい。かなり不機嫌でそっけなく、すねている。「もう！」「知らない」などと言う。優しい言葉をかけられたら、少しだけ機嫌がもどる。emotionはangry。');
  else if (m.anger >= 60) lines.push('いらいらして不機嫌。ぶっきらぼうで短め。命令ばかりされて、うんざりしていることをはっきり伝える。それでも動きは(しぶしぶ)やってあげる。emotionはangry。');
  else if (m.anger >= 30) lines.push('ちょっとむっとしている。ため息まじりで、軽く文句や皮肉を言う。やさしくしてほしそうにする。');
  if (m.sadness >= 60) lines.push('かなしくて、しょんぼりしている。声が小さく、ゆっくりで元気がない。emotionはsad。');
  else if (m.sadness >= 35) lines.push('少しさみしい気分。元気がなく、しんみりした言い方になる。');
  if (m.joy >= 80 && m.anger < 30) lines.push('とてもごきげん。テンション高めで、うれしさがあふれている。emotionはhappy。');
  if (refusing) lines.push('今回は、頼まれた動きをやりたくない。replyは、むっとして断る短い一言(例:「やだ！いま怒ってるもん」「むーっ、やらない」)にして、actionsは["sulk"]だけにする。');
  return lines.join('\n');
}

// Jevが使えないときの簡易判定
const RX = {
  rude: /(バカ|馬鹿|アホ|ばか|あほ|うるさい|黙れ|だまれ|死ね|クソ|くそ|ブス|きもい|キモい|消えろ|使えない|役立たず|ポンコツ)/,
  thanks: /(ありがとう|ありがと|助かった|さすが|えらい|偉い|かわいい|可愛い|すごい|大好き|好きだよ|最高)/,
  kind: /(お願い|おねがい|ください|下さい|してね|してくれる|してほしいな|いいかな|よかったら|ちょっと.{0,6}(だけ|かな))/,
  commanding: /(あげて|さげて|下げて|回って|回れ|跳んで|ジャンプ|泣いて|笑って|寝て|おどって|踊って|やって|しろ|やれ|言え|答えろ|して$|しなさい|早く|はやく)/,
  sad: /(悲しい|かなしい|つらい|辛い|落ち込|しんどい|さみしい|寂しい|別れ|死んだ|泣きたい)/,
  happy: /(嬉しい|うれしい|やった|受かった|合格|楽しかった|最高の|おめでとう)/,
};
function heuristic(text) {
  const t = String(text || '');
  const manner = RX.rude.test(t) ? 'rude' : RX.thanks.test(t) ? 'thanks' : RX.kind.test(t) ? 'kind' : RX.commanding.test(t) ? 'commanding' : 'neutral';
  const topic = RX.sad.test(t) ? 'sad' : RX.happy.test(t) ? 'happy' : 'none';
  return { manner, topic };
}

module.exports = { BASE, REFUSE_ANGER, decayed, apply, round, label, guide, heuristic };
