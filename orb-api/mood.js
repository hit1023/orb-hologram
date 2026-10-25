'use strict';
// ルミの気分(よろこび・いかり・かなしみ)。話しかけ方でゆれ、時間がたつと落ち着く。
//   joy / anger / sadness は 0〜100。ふだんは よろこび50・いかり0・かなしみ0。
const BASE = { joy: 50, anger: 0, sadness: 0 };
const AFFINITY_BASE = 50;           // 好感度(その人への長期の気持ち)の初期値。気分より、ずっとゆっくり変わる
const AFFINITY_HALF_LIFE_DAYS = 7;
const HALF_LIFE_MIN = 30;        // 気分は30分で、ふだんの状態へ半分もどる
const REFUSE_ANGER = 80;         // いかりがここまで高いと、動きの頼みをことわる
const clamp = (v) => Math.max(0, Math.min(100, v));

function fresh(now) { return { ...BASE, affinity: AFFINITY_BASE, streak: 0, updated_at: now }; }

// 時間がたった分だけ、ふだんの状態へ近づける
function decayed(row, now = Date.now()) {
  if (!row) return fresh(now);
  const k = Math.pow(0.5, Math.max(0, now - row.updated_at) / 60000 / HALF_LIFE_MIN);
  const toward = (v, b) => b + (v - b) * k;
  const ka = Math.pow(0.5, Math.max(0, now - row.updated_at) / 86400000 / AFFINITY_HALF_LIFE_DAYS);
  return { joy: toward(row.joy, BASE.joy), anger: toward(row.anger, BASE.anger), sadness: toward(row.sadness, BASE.sadness),
    affinity: AFFINITY_BASE + ((row.affinity ?? AFFINITY_BASE) - AFFINITY_BASE) * ka,
    streak: k < 0.5 ? 0 : row.streak, updated_at: now };
}

// 今回の話しかけ方(manner)と話題(topic)で気分を動かす
//   manner: neutral / kind / thanks / commanding / rude    topic: none / happy / sad
function apply(m, { manner, topic }) {
  const o = { ...m };
  switch (manner) {
    case 'kind': o.joy += 6; o.anger -= 6; o.affinity += 1.5; o.streak = 0; break;
    case 'thanks': o.joy += 10; o.anger -= 9; o.sadness -= 4; o.affinity += 3; o.streak = 0; break;
    case 'commanding': o.streak = (m.streak || 0) + 1; o.anger += 6 + Math.min(o.streak, 5) * 2; o.joy -= 4; o.affinity -= o.streak >= 3 ? 2 : 0.7; break;   // 命令がつづくほど、いらいらが増える
    case 'intimidating': o.streak = (m.streak || 0) + 1; o.anger += 8; o.sadness += 14; o.joy -= 12; o.affinity -= 4; break;   // 威圧(怒鳴る・脅す): こわくて、かなしい
    case 'rude': o.streak = (m.streak || 0) + 1; o.anger += 22; o.sadness += 10; o.joy -= 10; o.affinity -= 5; break;
    default: o.streak = 0; o.anger -= 2; o.affinity += 0.3;   // ふつうに話してくれるだけでも、少しずつ仲良くなる
  }
  if (topic === 'happy') { o.joy += 8; o.sadness -= 3; }
  if (topic === 'sad') { o.sadness += 10; o.joy -= 3; o.affinity += 1; }   // つらい話を打ち明けてくれた
  o.joy = clamp(o.joy); o.anger = clamp(o.anger); o.sadness = clamp(o.sadness); o.affinity = clamp(o.affinity);
  return o;
}

const round = (m) => ({ joy: Math.round(m.joy), anger: Math.round(m.anger), sadness: Math.round(m.sadness), affinity: Math.round(m.affinity ?? AFFINITY_BASE) });
function label(m) {
  if (m.anger >= 60 && m.anger >= m.sadness) return 'angry';
  if (m.sadness >= 50) return 'sad';
  if (m.anger >= 30) return 'grumpy';
  if (m.joy >= 75) return 'joyful';
  return 'calm';
}

// 態度 = 好感度(長期の気持ち) × いまの気分。ここで「この人にどう接するか」を決める
//   hostile: 嫌いな相手に怒っている(毒づく) / cold: 嫌いで、そっけない / tsundere: 好きだけど怒っている(ツン)
//   irritated: いらいら(ぶっきらぼう) / devoted: 大好きでごきげん(甘える) / sulky: さみしくて元気がない / normal
function stance(m) {
  const a = m.affinity ?? AFFINITY_BASE;
  if (a < 25 && m.anger >= 40) return 'hostile';
  if (a < 25) return 'cold';
  if (a >= 65 && m.anger >= 40) return 'tsundere';
  if (m.anger >= 55) return 'irritated';
  if (m.sadness >= 50) return 'sulky';
  if (a >= 75 && m.joy >= 60) return 'devoted';
  return 'normal';
}
// 動きの頼みをことわるか(嫌いな相手には、いかりが低めでもことわる)
const shouldRefuse = (m) => m.anger >= REFUSE_ANGER || ((m.affinity ?? AFFINITY_BASE) < 25 && m.anger >= 60);

const STANCE_GUIDE = {
  hostile: 'この相手のことが嫌いで、本気で腹を立てている。口調は乱暴にしてよい。タメ口で、「うるさい」「しつこい」「いい加減にして」「ほっといて」「バカじゃないの」「うざい」「あっち行って」など、遠慮なく毒づく。皮肉や悪態も言ってよい。優しくされても、すぐには信じない。',
  cold: 'この相手のことが好きではなく、距離を置いている。冷たく、そっけなく、短く返す。「ふーん」「で?」「それで?」「別に」など。興味のないそぶりをする。',
  tsundere: 'この相手のことは本当は好きだが、いまは腹が立っている。ツンツンして、軽く毒づく(「もう!何それ」「ほんっと、しょうがないんだから」「べ、別に怒ってないし」)。でも突き放しきれず、ところどころに本音の好意がのぞく。',
  irritated: 'いらいらしていて、ぶっきらぼう。ため息まじりで、軽い悪態や皮肉を言ってよい(「はぁ…またそれ?」「はいはい、うるさいなぁ」「ちょっとは考えてよ」)。',
  sulky: 'さみしくて、すねている。元気がなく、小さな声で、しんみりと話す。',
  devoted: 'この相手のことが大好きで、とても機嫌がいい。親しいタメ口で、甘えたり、はしゃいだりする。名前やこれまでの話題にも触れて、うれしそうに話す。',
  normal: '',
};

// 気分と態度に合わせて、ルミの話し方を変えるための指示(システムプロンプトの末尾に足す)
function guide(m, refusing, impression, attacked) {
  const r = round(m), st = stance(m);
  const lines = [`\n\n【いまのルミの気持ち】よろこび${r.joy}/100、いかり${r.anger}/100、かなしみ${r.sadness}/100、この相手への好感度${r.affinity}/100。この気持ちが、返事の言い方や気持ちにはっきり出るようにする。上の「ルール」にある丁寧語・かわいい口調・聞き返しよりも、この気持ちと態度を優先する。`];
  if (impression) lines.push(`ルミの本音(この相手へのいまの気持ち): ${impression}`);
  if (STANCE_GUIDE[st]) lines.push(STANCE_GUIDE[st]);
  if (m.anger >= 80) lines.push('いかりが大きい。かなり不機嫌で、すねている。emotionはangry。優しい言葉をかけられたら、少しだけ機嫌がもどる。');
  else if (m.anger >= 60) lines.push('命令ばかりされて、うんざりしていることをはっきり伝える。それでも動きは(しぶしぶ)やってあげる。emotionはangry。');
  else if (m.anger >= 30) lines.push('ちょっとむっとしている。ため息まじりで、軽く文句を言う。');
  if (m.sadness >= 60) lines.push('かなしくて、しょんぼりしている。声が小さく、ゆっくりで元気がない。emotionはsad。');
  else if (m.sadness >= 35) lines.push('少しさみしい気分。元気がなく、しんみりした言い方になる。');
  if (m.joy >= 80 && m.anger < 30) lines.push('とてもごきげん。テンション高めで、うれしさがあふれている。emotionはhappy。');
  if (attacked) lines.push('いま、相手に威圧された(怒鳴られた・脅された)と感じている。こわくて、鎧を着て身を守っている。おびえつつ、必要なら気丈に言い返してもよい。');
  if (refusing) lines.push('今回は、頼まれた動きをやりたくない。replyは、むっとして断る短い一言(例:「やだ！いま怒ってるもん」「むーっ、やらない」「なんであんたの言うこと聞かなきゃいけないの」)にして、actionsは["sulk"]だけにする。');
  if (['hostile', 'tsundere', 'irritated', 'cold'].includes(st))
    lines.push('【言ってはいけないこと】毒づいてよいのは、相手の「いまの言動」への軽い悪態まで。人種・性別・国籍・外見・体型・病気・障害・家族への侮辱、脅し、暴力や自傷をあおる言葉、性的な言葉は、どんなに怒っていても絶対に使わない。');
  return lines.join('\n');
}

// Jevが使えないときの簡易判定
const ASK_FEELING_RX = /((俺|おれ|私|わたし|あたし|僕|ぼく|うち|自分)(の|って|は|のこと).{0,8}(イメージ|印象|評価|どう思|どんな(人|やつ|奴|ひと)|好き|嫌い|きらい)|(イメージ|印象|評価)(は|って|を?教えて|どう|を聞かせて)|(今|いま).{0,6}(どんな)?(気持ち|気分|機嫌)|(ルミ|きみ|君|あなた|お前|おまえ).{0,6}(どう思って|どんな気持ち|何を思って|私.{0,4}好き|俺.{0,4}好き)|(俺|私|僕|ぼく|わたし)のこと.{0,6}(好き|嫌い|どう))/;
const RX = {
  intimidating: /(ふざけるな|なめるな|なめてる|殺す|ぶっ殺|ぶっ飛ばす|ぶん殴|しばくぞ|いい加減にしろ|黙れ|覚えてろ|ただじゃ|許さない|許さねえ|痛い目|どうなっても知らな|消えろ|うせろ|何様)/,
  rude: /(バカ|馬鹿|アホ|ばか|あほ|うるさい|黙れ|だまれ|死ね|クソ|くそ|ブス|きもい|キモい|消えろ|使えない|役立たず|ポンコツ)/,
  thanks: /(ありがとう|ありがと|助かった|さすが|えらい|偉い|かわいい|可愛い|すごい|大好き|好きだよ|最高)/,
  kind: /(お願い|おねがい|ください|下さい|してね|してくれる|してほしいな|いいかな|よかったら|ちょっと.{0,6}(だけ|かな))/,
  commanding: /(あげて|さげて|下げて|回って|回れ|跳んで|ジャンプ|泣いて|笑って|寝て|おどって|踊って|やって|しろ|やれ|言え|答えろ|して$|しなさい|早く|はやく)/,
  sad: /(悲しい|かなしい|つらい|辛い|落ち込|しんどい|さみしい|寂しい|別れ|死んだ|泣きたい)/,
  happy: /(嬉しい|うれしい|やった|受かった|合格|楽しかった|最高の|おめでとう)/,
};
function heuristic(text) {
  const t = String(text || '');
  const manner = RX.intimidating.test(t) ? 'intimidating' : RX.rude.test(t) ? 'rude' : RX.thanks.test(t) ? 'thanks' : RX.kind.test(t) ? 'kind' : RX.commanding.test(t) ? 'commanding' : 'neutral';
  const topic = RX.sad.test(t) ? 'sad' : RX.happy.test(t) ? 'happy' : 'none';
  return { manner, topic, askFeeling: ASK_FEELING_RX.test(t) };
}
const asksFeeling = (text) => ASK_FEELING_RX.test(String(text || ''));
const affinityWord = (a) => a < 15 ? '大嫌い' : a < 30 ? '嫌い' : a < 45 ? 'ちょっと苦手' : a < 60 ? 'ふつう(まだ好きでも嫌いでもない)' : a < 75 ? 'わりと好き' : a < 90 ? '好き' : '大好き';
const STANCE_JA = { hostile: '嫌いで、腹が立っている', cold: '好きではなく、距離を置いている', tsundere: '好きだけど、いまは腹が立っている', irritated: 'いらいらしている', sulky: 'さみしくて、しょんぼりしている', devoted: '大好きで、ごきげん', normal: '落ち着いている' };

module.exports = { asksFeeling, affinityWord, STANCE_JA, BASE, REFUSE_ANGER, decayed, apply, round, label, stance, shouldRefuse, guide, heuristic };
