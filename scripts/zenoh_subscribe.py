#!/usr/bin/env python3
"""ルミの出来事を Zenoh で受け取るサンプル(勉強用)。

orb-api は、出来事を Zenoh に publish している。キーは  orb/user/<ユーザー名>/<出来事>
  research_queued : 調べ物の依頼を受けた      research_done : 調べ終わった
  report          : ルミが調査結果を報告した   mood : 気分が変わった(manner=命令口調・暴言など)
  reply           : ルミが返事をした(text / emotion / stance)

使い方:
  pip install eclipse-zenoh
  python3 scripts/zenoh_subscribe.py                       # h-1 (192.168.0.20) につなぐ
  python3 scripts/zenoh_subscribe.py 192.168.0.20 'orb/user/hit/**'   # ユーザーを絞る
ロボットや別の端末は、この subscribe を元に「ルミが怒ったら赤く光る」「報告が出たら画面に出す」などができる。
"""
import json
import sys

import zenoh

host = sys.argv[1] if len(sys.argv) > 1 else "192.168.0.20"
key = sys.argv[2] if len(sys.argv) > 2 else "orb/**"

conf = zenoh.Config()
conf.insert_json5("connect/endpoints", json.dumps([f"tcp/{host}:7447"]))
session = zenoh.open(conf)


def on_sample(sample):
    try:
        body = json.loads(sample.payload.to_string())
        print(f"{sample.key_expr}  {json.dumps(body, ensure_ascii=False)[:200]}")
    except Exception:
        print(f"{sample.key_expr}  {sample.payload.to_string()[:200]}")


session.declare_subscriber(key, on_sample)
print(f"subscribed: {key} @ tcp/{host}:7447  (Ctrl+C で終了)")
try:
    while True:
        import time
        time.sleep(1)
except KeyboardInterrupt:
    session.close()
