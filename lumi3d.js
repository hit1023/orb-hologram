// 3D のルミ(オリジナルの星の妖精)。球・円すい・カプセルなどの形だけで組み立てる。
// 画面外の WebGL キャンバスに描き、index.html 側の 2D キャンバスへ drawImage で貼る
// (板の上下反転やピラミッドの 4 方向配置を、2D 側の仕組みのまま使うため)。
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const COL = { hair1: 0xff8fd8, hair2: 0xa98bff, skin: 0xffe6d8, mint: 0x7ff5df, dress: 0xb9fbee, star: 0xffe66d, boot: 0xff7fc0, sleeve: 0xe8fffb, lock: 0xd99bff };
const DARK = '#4a2f7a', MOUTH = '#ff6b8e';
const FACE_W = 640, FACE_H = 505, FACE_U = 337;        // 顔のテクスチャ(1 単位 = 約 1 ラジアン = 337px)

function toonGradient() {
  const d = new Uint8Array([110, 190, 255]);
  const t = new THREE.DataTexture(d, 3, 1, THREE.RedFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
}
function starGeometry(r, depth) {
  const s = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r;
    i ? s.lineTo(Math.cos(a) * rr, Math.sin(a) * rr) : s.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
  }
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: depth * 0.4, bevelSize: r * 0.08, bevelSegments: 2 });
  g.translate(0, 0, -depth / 2); return g;
}
function gradientColors(geo, top, bottom, y0, y1) {
  const pos = geo.attributes.position, col = new Float32Array(pos.count * 3);
  const a = new THREE.Color(top), b = new THREE.Color(bottom), c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, (pos.getY(i) - y0) / (y1 - y0)));
    c.copy(b).lerp(a, t); col.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

// ---- 顔(目・まゆ・くち・ほお)を 2D で描いて、頭の球に貼る ----
function paintFace(g, p) {
  g.clearRect(0, 0, FACE_W, FACE_H);
  g.save(); g.translate(FACE_W / 2, 243); g.scale(FACE_U, FACE_U); g.translate(0, 0.45);
  g.lineCap = 'round';
  g.fillStyle = `hsla(340,100%,76%,${p.blush * 0.8})`;
  for (const s of [-1, 1]) { g.beginPath(); g.ellipse(s * 0.62, -0.02, 0.16, 0.085, 0, 0, Math.PI * 2); g.fill(); }
  for (const s of [-1, 1]) eye(g, s, p);
  g.strokeStyle = '#8a5fc9'; g.lineWidth = 0.045;
  for (const s of [-1, 1]) {
    const inY = -0.64 - p.brow * 0.08 - p.raise, outY = -0.58 + p.brow * 0.04 - p.raise;
    g.beginPath(); g.moveTo(s * 0.2, inY); g.lineTo(s * 0.62, outY); g.stroke();
  }
  g.strokeStyle = DARK; g.lineWidth = 0.045;
  if (p.open > 0.06) {
    g.fillStyle = MOUTH; g.beginPath(); g.ellipse(0, 0.1, 0.1 + 0.05 * p.open, 0.03 + p.open * 0.17, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffa3b8'; g.beginPath(); g.ellipse(0, 0.1 + p.open * 0.08, 0.06, p.open * 0.07 + 0.01, 0, 0, Math.PI * 2); g.fill();
  } else {
    const m = p.mouth;
    if (m === 'smile') { g.beginPath(); g.arc(0, 0.04, 0.1, Math.PI * 0.2, Math.PI * 0.8); g.stroke(); }
    else if (m === 'grin') { g.fillStyle = MOUTH; g.beginPath(); g.arc(0, 0.04, 0.15, 0, Math.PI); g.closePath(); g.fill(); g.stroke(); }
    else if (m === 'frown') { g.beginPath(); g.arc(0, 0.2, 0.09, Math.PI * 1.2, Math.PI * 1.8); g.stroke(); }
    else if (m === 'o') { g.fillStyle = MOUTH; g.beginPath(); g.ellipse(0, 0.12, 0.07, 0.09, 0, 0, Math.PI * 2); g.fill(); }
    else if (m === 'pout') { g.beginPath(); g.arc(0, 0.19, 0.08, Math.PI * 1.15, Math.PI * 1.85); g.stroke(); }
    else if (m === 'wavy') { g.beginPath(); for (let i = -10; i <= 10; i++) { const x = i * 0.01, y = 0.1 + Math.sin(i * 0.5 + p.t * 8) * 0.015; i === -10 ? g.moveTo(x, y) : g.lineTo(x, y); } g.stroke(); }
    else { g.beginPath(); g.moveTo(-0.07, 0.1); g.lineTo(0.07, 0.1); g.stroke(); }
  }
  if (p.tear) {                                                              // 涙: 両目から2粒ずつ、順番に流れ落ちる
    const ph0 = (1 - p.tear) / 0.8;
    for (const sx2 of [-1, 1]) for (const k of [0, 0.5]) {
      const ph = (ph0 + k) % 1;
      g.fillStyle = `rgba(150,230,255,${Math.max(0, 1 - ph * 0.9)})`;
      g.beginPath(); g.ellipse(sx2 * 0.5, 0.05 + ph * 0.6, 0.1, 0.17, 0, 0, Math.PI * 2); g.fill();
    }
    g.strokeStyle = 'rgba(150,230,255,0.45)'; g.lineWidth = 0.07;
    for (const sx2 of [-1, 1]) { g.beginPath(); g.moveTo(sx2 * 0.5, 0.05); g.lineTo(sx2 * 0.5, 0.6); g.stroke(); }
  }
  g.restore();
}
function eye(g, sx, p) {
  const x = sx * 0.4, y = -0.28, k = p.eye;
  g.strokeStyle = DARK;
  if (p.wink && ((p.wink === 'L' && sx < 0) || (p.wink === 'R' && sx > 0))) {           // ウインク(画面の左・右の目)
    g.lineWidth = 0.065; g.beginPath(); g.arc(x, y + 0.06, 0.17, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); return;
  }
  if (k === 'happy') { g.lineWidth = 0.065; g.beginPath(); g.arc(x, y + 0.06, 0.17, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); return; }
  if (p.blink > 0.55) { g.lineWidth = 0.055; g.beginPath(); g.arc(x, y - 0.04, 0.16, Math.PI * 0.15, Math.PI * 0.85); g.stroke(); return; }
  const rx = k === 'wide' ? 0.21 : 0.19;
  const ry = (k === 'wide' ? 0.30 : k === 'angry' ? 0.20 : k === 'shy' ? 0.23 : 0.26) * (1 - p.blink * 0.9);
  let ox = 0, oy = 0;
  if (k === 'up') { ox = -0.04; oy = -0.07; }
  if (k === 'shy') { ox = -0.05; oy = 0.04; }
  g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill();
  const ir = g.createRadialGradient(x + ox, y + oy - 0.05, 0.02, x + ox, y + oy, ry);
  ir.addColorStop(0, '#d6fcff'); ir.addColorStop(0.5, '#6ee0ff'); ir.addColorStop(1, '#8a6bff');
  g.fillStyle = ir; g.beginPath(); g.ellipse(x + ox, y + oy, rx * 0.84, ry * 0.93, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#2b1a5e'; g.beginPath(); g.ellipse(x + ox, y + oy + 0.02, rx * (k === 'wide' ? 0.28 : 0.42), ry * (k === 'wide' ? 0.35 : 0.52), 0, 0, Math.PI * 2); g.fill();
  const hs = 1 + (p.listening ? 0.4 : 0);
  g.fillStyle = '#fff';
  g.beginPath(); g.arc(x + ox - 0.06, y + oy - 0.09, 0.055 * hs, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.arc(x + ox + 0.06, y + oy + 0.07, 0.03 * hs, 0, Math.PI * 2); g.fill();
  g.lineWidth = k === 'angry' ? 0.075 : 0.05;
  g.beginPath(); g.ellipse(x, y, rx, ry, 0, Math.PI * 1.05, Math.PI * 1.95); g.stroke();
}

export function createLumi3D({ width = 560, height = 720 } = {}) {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, premultipliedAlpha: true });
  renderer.setPixelRatio(1); renderer.setSize(width, height, false); renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(30, width / height, 0.1, 50);
  camera.position.set(0, 2.0, 10.6); camera.lookAt(0, 1.95, 0);
  scene.add(new THREE.AmbientLight(0xffffff, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.5); key.position.set(2, 5, 6); scene.add(key);
  const rim = new THREE.DirectionalLight(0xbfe9ff, 0.8); rim.position.set(-4, 3, -5); scene.add(rim);

  const grad = toonGradient();
  const toon = (color, extra = {}) => new THREE.MeshToonMaterial({ color, gradientMap: grad, ...extra });
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent && parent.add(m); return m; };

  const root = new THREE.Group(); scene.add(root);

  // 頭
  const head = new THREE.Group(); head.position.set(0, 2.15, 0); root.add(head);
  const skinHead = mesh(new THREE.SphereGeometry(1, 48, 36), toon(COL.skin), head); skinHead.scale.set(1, 0.95, 0.97);
  const faceCanvas = document.createElement('canvas'); faceCanvas.width = FACE_W; faceCanvas.height = FACE_H;
  const fg = faceCanvas.getContext('2d');
  const faceTex = new THREE.CanvasTexture(faceCanvas); faceTex.colorSpace = THREE.SRGBColorSpace; faceTex.anisotropy = 4;
  const faceGeo = new THREE.SphereGeometry(1.012, 64, 48, Math.PI / 2 - 0.95, 1.9, 0.85, 1.5);
  const face = mesh(faceGeo, new THREE.MeshBasicMaterial({ map: faceTex, transparent: true, depthWrite: false }), head); face.scale.set(1, 0.95, 0.97);
  face.renderOrder = 2;

  // 髪(上のかぶり・うしろ・前髪のぎざぎざ)
  const hairMat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: grad });
  const capGeo = new THREE.SphereGeometry(1.06, 48, 32, 0, Math.PI * 2, 0, 1.28); gradientColors(capGeo, COL.hair1, COL.hair2, 0, 1.06);
  mesh(capGeo, hairMat, head);
  // うしろ髪: 顔の前は空けて、うしろ側(z がマイナス側)だけ覆う
  const backGeo = new THREE.SphereGeometry(1.06, 48, 32, Math.PI - 0.5, Math.PI + 1.0, 1.1, 1.25);
  gradientColors(backGeo, COL.hair1, COL.hair2, -1.06, 1.06);
  mesh(backGeo, hairMat, head);
  const bangMat = toon(COL.hair1);
  for (let i = 0; i < 9; i++) {
    const phi = Math.PI / 2 - 0.95 + (i / 8) * 1.9, th = 1.22 + 0.1 * Math.cos((i / 8 - 0.5) * Math.PI) * -1 + 0.12 * Math.abs(i / 8 - 0.5);
    const r = 1.05, x = -r * Math.cos(phi) * Math.sin(th), y = r * Math.cos(th), z = r * Math.sin(phi) * Math.sin(th);
    mesh(new THREE.SphereGeometry(0.2, 16, 12), bangMat, head, x, y * 0.95, z * 0.97);
  }
  const starGeo = starGeometry(0.2, 0.12), starMat = toon(COL.star, { emissive: 0x7a6a10, emissiveIntensity: 0.6 });
  for (const s of [-1, 1]) { const st = mesh(starGeo, starMat, head, s * 0.72, 0.82, 0.62); st.rotation.set(0.2, s * 0.5, s * 0.3); }
  // アホ毛
  const ahogePivot = new THREE.Group(); ahogePivot.position.set(0, 0.98, 0); head.add(ahogePivot);
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.2, 0.35, 0), new THREE.Vector3(0.1, 0.7, 0), new THREE.Vector3(0.18, 0.95, 0)]);
  mesh(new THREE.TubeGeometry(curve, 16, 0.05, 8, false), toon(COL.hair1), ahogePivot);
  const ahogeStar = mesh(starGeometry(0.24, 0.12), starMat, ahogePivot, 0.18, 1.08, 0);

  // ツインテール
  const tails = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * 1.0, 0.45, -0.1); head.add(piv);
    const c = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0, 0), new THREE.Vector3(s * 0.35, -0.5, -0.05), new THREE.Vector3(s * 0.5, -1.2, 0), new THREE.Vector3(s * 0.45, -1.9, 0.05)]);
    const tg = new THREE.TubeGeometry(c, 24, 0.26, 12, false); gradientColors(tg, COL.hair1, COL.hair2, -1.9, 0);
    mesh(tg, hairMat, piv);
    const tip = new THREE.SphereGeometry(0.26, 16, 12); const tm = mesh(tip, toon(COL.hair2), piv, s * 0.45, -1.9, 0.05);
    tails.push(piv);
  }

  // からだ(ワンピース・リボン・星)
  const body = new THREE.Group(); root.add(body);
  mesh(new THREE.CylinderGeometry(0.36, 0.74, 1.15, 32, 1, false), toon(COL.dress), body, 0, 0.98, 0);
  const hem = toon(COL.mint);
  for (let i = 0; i < 14; i++) { const a = (i / 14) * Math.PI * 2; mesh(new THREE.SphereGeometry(0.17, 12, 10), hem, body, Math.cos(a) * 0.68, 0.42, Math.sin(a) * 0.68); }
  mesh(new THREE.TorusGeometry(0.69, 0.1, 10, 36), hem, body, 0, 0.43, 0).rotation.x = Math.PI / 2;
  const bowMat = toon(COL.hair1);
  for (const s of [-1, 1]) { const b = mesh(new THREE.ConeGeometry(0.17, 0.3, 16), bowMat, body, s * 0.17, 1.54, 0.3); b.rotation.z = -s * Math.PI / 2; }
  mesh(new THREE.SphereGeometry(0.08, 12, 10), bowMat, body, 0, 1.54, 0.32);
  const emblem = mesh(starGeometry(0.17, 0.08), starMat, body, 0, 0.98, 0.58); emblem.rotation.x = -0.12;
  // 足
  for (const s of [-1, 1]) {
    mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.4, 12), toon(COL.skin), body, s * 0.2, 0.28, 0);
    const bt = mesh(new THREE.SphereGeometry(0.15, 16, 12), toon(COL.boot), body, s * 0.21, 0.09, 0.05); bt.scale.set(1, 0.7, 1.3);
  }
  // 腕
  const arms = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * 0.46, 1.5, 0); body.add(piv);
    mesh(new THREE.CapsuleGeometry(0.12, 0.46, 6, 12), toon(COL.sleeve), piv, 0, -0.35, 0);
    mesh(new THREE.SphereGeometry(0.13, 14, 10), toon(COL.skin), piv, 0, -0.76, 0);
    arms.push({ piv, s });
  }

  // めがね(分析のとき): 顔の前にかけて、ぽんっと出る。ホログラム板では黒が透明なので、明るい色にする
  const glasses = new THREE.Group(); glasses.position.set(0, -0.02, 1.0); head.add(glasses); glasses.visible = false;
  const gfMat = new THREE.MeshBasicMaterial({ color: 0xffd23f }), glMat = new THREE.MeshBasicMaterial({ color: 0xa8ecff, transparent: true, opacity: 0.2, depthWrite: false });
  for (const sx of [-1, 1]) {
    mesh(new THREE.TorusGeometry(0.31, 0.05, 10, 36), gfMat, glasses, sx * 0.4, 0, 0);
    mesh(new THREE.CircleGeometry(0.3, 28), glMat, glasses, sx * 0.4, 0, 0);
    const tp = mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8), gfMat, glasses, sx * 0.74, 0, -0.33); tp.rotation.x = Math.PI / 2;   // つる(耳のほうへ)
  }
  mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 8), gfMat, glasses, 0, 0.05, 0).rotation.z = Math.PI / 2;
  const glint = mesh(new THREE.PlaneGeometry(0.1, 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }), glasses, -0.5, 0.05, 0.01);
  glint.rotation.z = 0.6;

  // メモ帳とペン(分析のとき): おなかの前で持って、さらさら書く
  const notebook = new THREE.Group(); notebook.position.set(0, 0.82, 0.82); notebook.rotation.x = -0.45; root.add(notebook); notebook.visible = false;
  mesh(new THREE.BoxGeometry(1.0, 1.25, 0.07), new THREE.MeshBasicMaterial({ color: 0xfff6d8 }), notebook);
  mesh(new THREE.BoxGeometry(1.0, 0.16, 0.09), new THREE.MeshBasicMaterial({ color: 0x4fd2ff }), notebook, 0, 0.55, 0);   // 上の見出し帯
  const lineMat = new THREE.MeshBasicMaterial({ color: 0x6f8aa8 });
  for (let i = 0; i < 5; i++) mesh(new THREE.BoxGeometry(0.72 - (i % 2) * 0.18, 0.04, 0.09), lineMat, notebook, -0.05, 0.28 - i * 0.2, 0);
  const pen = new THREE.Group(); root.add(pen); pen.visible = false;
  mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.6, 8), new THREE.MeshBasicMaterial({ color: 0xff5f8f }), pen, 0, 0.3, 0);
  mesh(new THREE.ConeGeometry(0.035, 0.1, 8), new THREE.MeshBasicMaterial({ color: 0x333333 }), pen, 0, -0.04, 0).rotation.x = Math.PI;
  const penTip = mesh(new THREE.SphereGeometry(0.05, 8, 6), new THREE.MeshBasicMaterial({ color: 0x9dffb0 }), pen, 0, -0.1, 0);

  // 鎧とたて(威圧されたとき): ぱっと身につけて、たてで身を守る。ホログラム板では黒が透明なので、明るい銀と金にする
  const armor = new THREE.Group(); root.add(armor); armor.visible = false;
  const steel = new THREE.MeshToonMaterial({ color: 0xd6e6fb, gradientMap: grad, emissive: 0x2a4670, emissiveIntensity: 0.6 });
  const gold = new THREE.MeshToonMaterial({ color: 0xffd23f, gradientMap: grad, emissive: 0x8a6a10, emissiveIntensity: 0.6 });
  mesh(new THREE.CylinderGeometry(0.5, 0.66, 0.72, 28), steel, armor, 0, 1.18, 0);                       // むね当て
  mesh(new THREE.TorusGeometry(0.52, 0.045, 8, 32), gold, armor, 0, 1.54, 0).rotation.x = Math.PI / 2;
  mesh(new THREE.TorusGeometry(0.66, 0.045, 8, 32), gold, armor, 0, 0.83, 0).rotation.x = Math.PI / 2;
  for (const sx of [-1, 1]) { const pd = mesh(new THREE.SphereGeometry(0.28, 16, 12), steel, armor, sx * 0.58, 1.58, 0); pd.scale.set(1, 0.75, 1.15); }   // 肩当て
  const shield = new THREE.Group(); shield.position.set(0, 0.86, 1.0); shield.scale.setScalar(0.86); armor.add(shield);                  // たて
  mesh(new THREE.CylinderGeometry(0.68, 0.68, 0.1, 40), steel, shield).rotation.x = Math.PI / 2;
  mesh(new THREE.TorusGeometry(0.68, 0.06, 10, 40), gold, shield);
  mesh(starGeometry(0.34, 0.17), gold, shield, 0, 0, 0.09);
  const tiara = new THREE.Group(); tiara.position.set(0, 0.62, 0); head.add(tiara); tiara.visible = false;   // 頭の鎧(ティアラ)
  mesh(new THREE.TorusGeometry(0.83, 0.05, 8, 40), steel, tiara).rotation.x = Math.PI / 2;
  mesh(new THREE.ConeGeometry(0.1, 0.34, 4), gold, tiara, 0, 0.14, 0.82);
  for (const sx of [-1, 1]) { const wg = mesh(new THREE.ConeGeometry(0.09, 0.42, 4), steel, tiara, sx * 0.86, 0.12, 0.1); wg.rotation.z = -sx * 0.9; }

  // ハート(投げキス・ハートを出す): ルミの前にふわっと浮かんで消える
  const heartShape = new THREE.Shape();
  heartShape.moveTo(0, -0.3); heartShape.bezierCurveTo(-0.55, 0.05, -0.3, 0.5, 0, 0.22); heartShape.bezierCurveTo(0.3, 0.5, 0.55, 0.05, 0, -0.3);
  const heartGeo = new THREE.ExtrudeGeometry(heartShape, { depth: 0.08, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
  heartGeo.translate(0, 0, -0.04);
  const heartMat = new THREE.MeshBasicMaterial({ color: 0xff5fa2 });
  const hearts = []; let lastHeart = -9;
  function updateHearts(t, on) {
    if (on && t - lastHeart > 0.28) {
      lastHeart = t; const m = new THREE.Mesh(heartGeo, heartMat); scene.add(m);
      hearts.push({ m, t0: t, x: (Math.random() - 0.5) * 1.6, ph: Math.random() * 6 });
    }
    for (let i = hearts.length - 1; i >= 0; i--) {
      const h = hearts[i], u = (t - h.t0) / 1.8;
      if (u >= 1) { scene.remove(h.m); hearts.splice(i, 1); continue; }
      h.m.position.set(h.x + Math.sin(u * 5 + h.ph) * 0.2, 2.2 + u * 1.9, 1.3);
      const sc = 0.75 * Math.sin(Math.min(1, u * 3) * Math.PI / 2) * (1 - Math.max(0, u - 0.7) / 0.3); h.m.scale.setScalar(Math.max(0.001, sc));
      h.m.rotation.y = Math.sin(u * 6 + h.ph) * 0.4;
    }
  }

  // ---- 毎フレームの更新 ----
  let lastSig = '';
  const lerp = (a, b, k) => a + (b - a) * k;
  const armPose = (key, s, t, talk) => {   // [前後の回転 rx, 左右の回転 rz]
    switch (key) {
      case 'happy': return [0, s * (2.7 + Math.sin(t * 7 + (s > 0 ? 0 : 1.5)) * 0.25)];
      case 'surprised': return [0, s * 2.0];
      case 'shy': return [-2.2, -s * 0.25];
      case 'thinking': return s > 0 ? [-2.3, -s * 0.2] : [0, s * 0.15];
      case 'angry': return [0, s * 0.6];
      case 'sad': return [0, s * 0.34];
      default: return talk ? [-0.5, s * (0.55 + talk * 0.2) + Math.sin(t * 6 + s) * 0.08] : [0, s * (0.3 + Math.sin(t * 1.7) * 0.03)];
    }
  };
  // 電柱(怖がって隠れるときに、横からにゅっと出てくる)
  const pole = new THREE.Group(); scene.add(pole); pole.visible = false;
  const poleMat = new THREE.MeshStandardMaterial({ color: 0xa9b0d8, emissive: 0x30365f, roughness: 0.7 });
  const insMat = new THREE.MeshStandardMaterial({ color: 0xd9f2ff, emissive: 0x3a5d70 });
  mesh(new THREE.CylinderGeometry(0.34, 0.42, 12, 20), poleMat, pole, 0, 2.5, 0);
  for (const [y, w] of [[4.25, 2.8], [3.75, 2.1]]) {
    mesh(new THREE.BoxGeometry(w, 0.15, 0.22), poleMat, pole, 0, y, 0);
    for (const sx of [-1, 1]) mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.28, 10), insMat, pole, sx * (w / 2 - 0.15), y + 0.2, 0);
  }
  for (const y of [0.8, 2.2]) mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.1, 20), insMat, pole, 0, y, 0);
  // 怖がるとき、電柱のまわりをふよふよ漂うお化け(目と口は黒=ホログラムでは透けて、穴のように見える)
  const ghosts = [];
  { const gm = new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.88 }), black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    for (let i = 0; i < 4; i++) {
      const g = new THREE.Group(), sc = 0.8 + (i % 2) * 0.35;
      mesh(new THREE.SphereGeometry(0.42, 16, 12), gm, g, 0, 0.25, 0);
      mesh(new THREE.CylinderGeometry(0.42, 0.5, 0.62, 16), gm, g, 0, -0.06, 0);
      for (let k = 0; k < 5; k++) mesh(new THREE.SphereGeometry(0.17, 8, 6), gm, g, Math.cos(k / 5 * Math.PI * 2) * 0.33, -0.4 - (k % 2) * 0.07, Math.sin(k / 5 * Math.PI * 2) * 0.33);
      for (const sx of [-1, 1]) { const e = mesh(new THREE.SphereGeometry(0.09, 8, 8), black, g, sx * 0.16, 0.3, 0.37); e.scale.set(1, 1.5, 0.5); }
      const mo = mesh(new THREE.SphereGeometry(0.1, 8, 8), black, g, 0, 0.06, 0.4); mo.scale.set(1, 1.3, 0.5);
      g.scale.setScalar(sc); g.visible = false; scene.add(g); ghosts.push({ g, ph: i * 1.7, r: 1.5 + (i % 3) * 0.45, base: sc });
    } }
  // 寝るとき、まくら・敷きぶとん・かけぶとんが、ぽんっと湧いてくる(横になった体の位置に合わせる)
  const bed = new THREE.Group(); bed.position.set(0.5, 0.6, 0); scene.add(bed); bed.visible = false;
  const bm = (c, e) => new THREE.MeshStandardMaterial({ color: c, emissive: e, roughness: 0.9 });
  const rbox = (w, h, d, mat, x, y, z) => mesh(new THREE.BoxGeometry(w, h, d), mat, bed, x, y, z);
  rbox(5.4, 0.34, 2.2, bm(0xe4ecff, 0x22304f), -0.0, -1.1, -0.5);                                  // 敷きぶとん
  const pil = mesh(new THREE.SphereGeometry(1, 20, 14), bm(0xfff1f7, 0x4a3040), bed, -0.75, -0.75, -0.35); pil.scale.set(1.35, 0.4, 0.95);   // まくら
  rbox(2.3, 1.55, 0.3, bm(0xb99cff, 0x2e2358), 1.15, -0.1, 0.85);                                 // かけぶとん
  rbox(2.3, 0.2, 0.34, bm(0xe3d6ff, 0x3a3060), 1.15, 0.45, 0.86);                                  // えりの縁どり
  for (const [x, y] of [[0.6, -0.2], [1.3, -0.5], [1.8, 0.1]]) { const st = mesh(new THREE.SphereGeometry(0.13, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffe36b }), bed, x, y, 1.03); st.scale.set(1, 1, 0.3); }
  const easeBack = (t) => 1 + 2.70158 * Math.pow(t - 1, 3) + 1.70158 * Math.pow(t - 1, 2);
  const cur = { hue: 190 };

  function render(p) {
    const t = p.time;
    const fx = p.fx || {};                           // 声の指示による動き(index.html の動きエンジンが作る)
    const sr = Math.sin(Math.min(fx.roll || 0, 1.6));    // 横になる(寝る・気絶)ときは、画面の中央に収まるよう寄せて、引く
    root.rotation.set(fx.bodyPitch || 0, p.spin + (fx.spinAdd || 0), fx.roll || 0);
    root.position.x = sr * 2.1 + (fx.hide || 0) * 0.45 + (fx.shakeX || 0);
    const ba = Math.max(0, Math.min(1, ((fx.bed || 0) - 0.3) / 0.7));              // 寝具が湧く量(ぽよんと弾みながら)
    bed.visible = ba > 0.02; bed.scale.setScalar(Math.max(0.001, easeBack(ba)));
    const pa = fx.pole || 0;                              // 電柱が出てくる量(0〜1)。右から滑り込み、手前に立つ
    ghosts.forEach((o, i) => {                            // 電柱(x≈1.0)のまわりを、ふよふよ回りながら浮かぶ
      o.g.visible = pa > 0.15;
      if (!o.g.visible) return;
      const a = t * 0.9 + o.ph;
      o.g.position.set(1.0 + Math.cos(a) * o.r, 1.6 + Math.sin(t * 1.6 + o.ph) * 0.45 + i * 0.35, 0.4 + Math.sin(a) * 1.2);
      o.g.rotation.z = Math.sin(t * 2 + o.ph) * 0.18; o.g.scale.setScalar(o.base * Math.min(1, (pa - 0.15) * 1.6));
    });
    pole.visible = pa > 0.01; pole.position.set(4.4 - 3.4 * (1 - Math.pow(1 - pa, 3)), 0, 1.3);
    root.scale.set(1, 1 - (fx.squash || 0), 1);
    camera.position.z = 10.6 + (fx.jump || 0) * 2.0 + Math.abs(sr) * 3.2;     // 跳ぶときは少し引いて、画面の上に突き抜けないようにする(高く跳んで見える)
    root.position.y = Math.sin(t * 1.8) * 0.06 + (p.pose === 'happy' ? Math.abs(Math.sin(t * 5)) * 0.06 : 0) + (fx.jump || 0) + Math.abs(sr) * 1.0;
    head.rotation.set(0.05 + Math.sin(t * 1.3) * 0.02 + (fx.pitch || 0), fx.yaw || 0, p.tilt + Math.sin(t * 1.7) * 0.02 + (fx.headRoll || 0));
    updateHearts(t, !!fx.hearts);
    ahogePivot.rotation.z = -0.1 + Math.sin(t * 1.7) * 0.12; ahogeStar.rotation.y = t * 0.8;
    tails.forEach((piv, i) => { const s = i ? 1 : -1; piv.rotation.z = s * (0.12 + (Math.sin(t * 1.6 + i * 1.5) * 0.1) + p.talk * 0.05); piv.rotation.x = Math.sin(t * 1.3 + i) * 0.06; });
    arms.forEach(({ piv, s }) => {
      const ov = fx.arms && fx.arms[s < 0 ? 'L' : 'R'];                // 指示があれば、その腕はそのとおりに動かす
      const [rx, rz] = ov || (fx.arms ? [0, s * 0.3] : armPose(p.pose, s, t, p.talk));   // 腕の指示中は、指示のない腕は感情ポーズ(ばんざい等)にせず下ろしておく
      const k = ov ? 0.3 : 0.18;
      piv.rotation.x = lerp(piv.rotation.x, rx, k); piv.rotation.z = lerp(piv.rotation.z, rz, k);
      // 頭が大きいので、腕をあげるときは肩を外側・手前に出して、頭の陰に隠れないようにする
      // 肩の位置: 腕を高くあげる・顔に近づけるほど顔の高さ(1.5)、下げているほど胴体の高さ(1.27)。角度に応じて滑らかに切り替える
      //   (しきい値で切り替えると、話しているときなど中くらいの角度で肩が顔の高さに残って、顔から手が生えて見える)
      const up = Math.max(Math.min(1, Math.max(0, (Math.abs(rz) - 0.7) / 0.8)), Math.min(1, Math.max(0, (-rx - 0.6) / 0.8)));
      piv.position.y = lerp(piv.position.y, lerp(1.27, 1.5, up), 0.2);
      piv.position.x = lerp(piv.position.x, s * lerp(0.5, 0.46 + ((ov && ov[2]) || 0), up), 0.2);
      piv.position.z = lerp(piv.position.z, lerp(0.2, (ov && ov[3]) || 0, up), 0.2);
    });
    const an = fx.analyze || 0;                                       // 分析: めがねがぽんっと出て、メモ帳にさらさら書く
    glasses.visible = notebook.visible = pen.visible = an > 0.02;
    if (an > 0.02) {
      glasses.scale.setScalar(Math.min(1, an * 1.15) * (1 + Math.max(0, 1 - an) * 0.2)); glasses.position.y = -0.02 + (1 - an) * 0.5;
      notebook.scale.setScalar(an); notebook.position.y = 0.82 - (1 - an) * 0.3;
      const wr = t * 14;                                                // 書く手の動き(小刻みに左右へ)
      pen.position.set(0.12 + Math.sin(wr) * 0.14, 0.72 + Math.cos(wr * 0.5) * 0.06 - (1 - an) * 0.3, 1.0); pen.rotation.set(-0.5, 0, -0.5);
      pen.scale.setScalar(an); penTip.scale.setScalar(0.7 + Math.abs(Math.sin(wr)) * 0.8);
    }
    const gd = fx.guard || 0;                                          // ガード: 鎧とたてが、ぱっと出る
    armor.visible = tiara.visible = gd > 0.02;
    if (gd > 0.02) {
      armor.scale.setScalar(Math.min(1, 0.35 + gd * 0.75)); armor.position.y = (1 - gd) * 0.25;
      shield.position.set(Math.sin(t * 44) * 0.015 * gd, 0.86, 1.0 + Math.sin(t * 9) * 0.02);            // 攻撃にたえて、かすかにふるえる
    }
    const sig = [p.wink || '', p.eye, p.mouth, Math.round(p.open * 12), p.blink > 0.55 ? 1 : 0, Math.round(p.blush * 10), Math.round(p.brow * 8), Math.round(p.raise * 20), p.listening ? 1 : 0, p.tear ? Math.round(p.tear * 20) : 0, p.mouth === 'wavy' ? Math.round(t * 10) : 0].join('|');
    if (sig !== lastSig) { paintFace(fg, p); faceTex.needsUpdate = true; lastSig = sig; }
    renderer.render(scene, camera);
    return renderer.domElement;
  }
  return { render, width, height, dispose() { renderer.dispose(); } };
}

try { window.Lumi3D = createLumi3D(); } catch (e) { console.warn('Lumi3D unavailable:', e && e.message); }
