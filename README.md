# orb-hologram

<p align="center"><img src="docs/lumi.png" alt="ルミ（星の妖精のAIキャラクター）" width="360"></p>

<p align="center"><b>ホログラム表示に特化した AI チャットボット</b><br>スマホと透明な板だけで、AI キャラクター「ルミ」を空中に浮かべて、声で会話します。</p>

## これは何か

**ペッパーズゴースト（板の反射を使った簡易ホログラム）で見せることを前提に作った、AI チャットボットです。**
普通のチャット画面ではなく、「板に映して空中に浮かぶ」ことを最初から設計に入れています。

- **ホログラム向けの表示**: 板で上下が反転して見えるので、あらかじめ反転して描きます。黒背景に明るい色で描き、暗い反射でも見えやすくしています。
- **AI と声で会話**: 話しかけると、AI（Claude）が返事をして、声で読み上げます。返事の気持ちに合わせて、キャラの表情・色・身ぶりが変わります。
- **GPU なし・工作は最小限**: スマホのブラウザと、板・黒プラダンだけで動きます。材料は総額 300 円ほどです。

## できること

- キャラクターを 5 種類から選べます: **ルミ3D（立体で回る・既定）** / ルミ（平ら）/ リング / ダンスする女の子 / 球体
- ルミは AI（Claude）と会話します。返答の気持ちに合わせて表情・色・身ぶりが変わります（うれしい・かなしい・おどろき・おこる・てれる・考え中）
- どのキャラでも、話す・聞く・考えるに合わせて色と動きが変わり、返事の文章が下の帯に流れます
- 4 つの状態で色と動きが変わります: 待機（青）・聞いている（緑）・考え中（紫）・話している（橙）
- キャラの下に、決まった文章が左から右へ流れます
- マイクでの音声会話（音声認識は hit-whisper-stt）と、文字入力に対応しています
- 表示モードを切り替えられます: `plain`（画面確認用）/ `board`（斜め板・上下反転）/ `pyramid`（4 方向）

`index.html` 1 枚（Canvas 2D）で動きます。

## 動かし方

### ローカルで確認する

```bash
python3 -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開きます。確認だけなら、表示モードは `plain` にします。

### Docker（nginx）で配信する

```bash
docker compose up -d
```

`http://<ホスト>:8897/` で開けます。

`index.html` など個別のファイルを bind mount しているので、ファイルを差し替えたあとは再起動が必要です。

```bash
docker compose restart
```

マウントするファイルを増やしたときは `docker compose up -d --force-recreate` にします。

### マイクを使うとき

マイクの利用には HTTPS が必要です。HTTP の LAN アドレスでは使えません。音声認識は Chrome（Android）を推奨します。Brave は非対応です。

## 工作

| 材料 | 内容 |
|---|---|
| 透明な板 | 透明シュリンクプラスチック（厚さ 0.3mm）を 9×17cm に切る。つるつるの面を下（スマホ側）にする |
| 支え | 黒プラダン（3mm）で直角二等辺三角形（直角を挟む辺 12cm）を 2 枚。スマホを挟んで約 8cm 離して立てる |
| 背景 | スマホの奥に黒プラダンを立てる |

1. 板を三角の斜辺にテープで貼ります。**見る人側が高く、スマホの奥の端側が低い**坂（45°）にします。
2. スマホは縦向き・画面を上向きにして、自動回転オフ、輝度は最大にします。
3. 部屋を暗くします。

### 見る位置

板の**高い側**に座り、**目を机の高さ（机から 5〜8cm）まで下げて水平に**見ます。上から見下ろすと反射は見えません。

## 描画の決まりごと

板で反射すると、画面の**上下が反転**して見えます（左右は反転しません）。
そのため `board` モードでは `ctx.scale(1, -1)` した座標空間で描きます。この空間で普通に文字やキャラを描けば、板に映ったときに正しい向きになります。この空間では y+ が空中の「下」にあたり、頭は y < 0 に描きます。

画面の操作 UI も反射して浮いて見えます。実演のときは「UI を隠す」を押してください（画面をタップすると戻ります）。

## AI会話（返答・声・認識）

```
ブラウザ ── /api/chat ──▶ orb-api ──▶ Claude Code CLI (haiku)  → {reply, emotion}
        ── /api/tts  ──▶ orb-api ──▶ Aivis ルーター(:8000)   → mp3
        ── /ws/stt   ──▶ hit-whisper-stt(:18010, ElevenLabs Scribe)
```

- `orb-api/` が返答（Claude Code CLI を headless で実行）と読み上げ（既存の Aivis ルーターへ中継）を担当します。読み上げは、GPU なしで動く CPU 版 Aivis を主に使い、遅いときだけ Aivis Cloud 版に切り替えます。
- 音声認識は、既存の `hit-whisper-stt` の WebSocket（16kHz PCM）へ nginx 経由でつなぎます。
- 認証は `.env` の `CLAUDE_CODE_OAUTH_TOKEN`（`claude setup-token` で発行）。`.env` は git に入れません。声は `TTS_SPEAKER_ID`（CPU版）と `TTS_FALLBACK_SPEAKER_ID`（クラウド版）で変えられます。
- マイクは HTTPS が必要なので、`https://holo.s-quad.com/` で開きます。

### 返答 API の仕様

`POST /api/chat` に `{ "text": "...", "history": [...] }` を送ると、`{ "reply": "...", "emotion": "happy" }` が返ります。`CONFIG.chatEndpoint` を空にするとデモ返答になります。TTS が使えないときは、ブラウザの `speechSynthesis` で代用します。

## 声で動きを頼む

話しかけた言葉の意味を AI（Claude）が読み取って、ルミの体を動かします。決まった合言葉ではなく、自然な言い方で頼めます。

- 例: 「右手をあげて」「くるくる回って、そのあとジャンプして」「目を瞑って」「泣いて」「笑って」「怒って」「おじぎして」「おどって」
- 動き: 右手・左手・両手をあげる／手をふる／拍手／くるくる回る／ジャンプ／目を閉じる・開ける／泣く／笑う／怒る／照れる／おじぎ／うなずく／首をふる／おどる／ねむる
- 「右手」「左手」は、**画面の右側・左側の手**です。2つ以上頼むと、言った順に演じます。
- 仕組み: `/api/chat` が `{reply, emotion, actions}` を返し、`index.html` の動きエンジン（`actPose`）が、3Dのルミ（`lumi3d.js`）に演じさせます。動きを増やすには、`orb-api/server.js` の `ACTIONS` と `index.html` の `ACT_DUR`・`actPose` に足します。
- 確認用: URL に `?char=mascot3d&mode=plain&spin=0&act=raise_both` のように付けると、文字を打たなくても、動きを確認できます。

## CI/CD

`main` に push すると、自動でテストとデプロイが走ります。

- **CI（GitHub Actions）**: `.github/workflows/ci.yml`。`index.html` と `orb-api` の構文チェック、compose の検証、イメージのビルド、起動して `/api/health` などを確認するスモークテストを行います。
- **CD（h-1 の cron）**: `scripts/autodeploy.sh` を3分ごとに実行します。`origin/main` に新しいコミットがあれば、取り込んでコンテナを作り直します。ヘルスチェックが通らなければ、直前のコミットに戻します。ログは h-1 の `~/docker/hit-orb-hologram/autodeploy.log` です。
- `.env`（Claude のトークン）は git に入れず、h-1 にだけ置きます。KOTOCO や motion-scope と同じ方式です。

## ファイル

| ファイル | 内容 |
|---|---|
| `index.html` | 本体（描画・入力・状態管理・動きエンジン） |
| `lumi3d.js` | 3D のルミ（three.js、球や円すいで組み立てたオリジナル） |
| `dancer-concept.png` | ダンスキャラの透過画像（現在の表示に使用） |
| `orb-api/` | 返答（Claude）と読み上げ（Aivis中継）の小さな API サーバー |
| `scripts/autodeploy.sh` / `.github/workflows/ci.yml` | 自動デプロイ(h-1 の cron)と CI |
| `nginx.conf` / `docker-compose.yml` | 配信と `/api` `/ws/stt` の中継設定 |
| `docs/lumi.png` | READMEの画像（ルミ） |
| `HANDOFF.md` | 開発の引き継ぎメモ（設計・TODO・ハマりどころ） |
| `hologram-deck.pptx` | 製作の紹介スライド |
| `ASSET-LICENSE.txt` | 素材の出典とライセンス |
| `avatar3d.js` / `avatar3d.bundle.js` / `dancer-avatar.glb` / `dancer-motion.glb` / `dancer.mp4` / `dancer-sprite.png` | 旧 3D・動画・スプライト素材（現在は読み込んでいません） |

## 今後

- 基準デザインを保ったまま、ダンスをより本格的にする
- ルミの独り言（話しかけられていないときの一言）や、会話の記憶
- 板に映した実機で、文字の濃さ・リングの太さ・キャラの大きさを調整する

詳しくは [HANDOFF.md](HANDOFF.md) を見てください。

## ライセンスと素材

素材の出典は [ASSET-LICENSE.txt](ASSET-LICENSE.txt) にまとめています。旧 3D モデルは CC-BY（Blender Foundation）、動画は Pexels ライセンス、Three.js は MIT です。
