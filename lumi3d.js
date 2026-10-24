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
      case 'angry': return [0, s * 0.55];
      case 'sad': return [0, s * 0.05];
      default: return talk ? [-0.5, s * (0.5 + talk * 0.2) + Math.sin(t * 6 + s) * 0.08] : [0, s * (0.16 + Math.sin(t * 1.7) * 0.03)];
    }
  };
  const cur = { hue: 190 };

  function render(p) {
    const t = p.time;
    const fx = p.fx || {};                           // 声の指示による動き(index.html の動きエンジンが作る)
    root.rotation.set(fx.bodyPitch || 0, p.spin + (fx.spinAdd || 0), fx.roll || 0);
    root.scale.set(1, 1 - (fx.squash || 0), 1);
    camera.position.z = 10.6 + (fx.jump || 0) * 2.0;     // 跳ぶときは少し引いて、画面の上に突き抜けないようにする(高く跳んで見える)
    root.position.y = Math.sin(t * 1.8) * 0.06 + (p.pose === 'happy' ? Math.abs(Math.sin(t * 5)) * 0.06 : 0) + (fx.jump || 0);
    head.rotation.set(0.05 + Math.sin(t * 1.3) * 0.02 + (fx.pitch || 0), fx.yaw || 0, p.tilt + Math.sin(t * 1.7) * 0.02 + (fx.headRoll || 0));
    updateHearts(t, !!fx.hearts);
    ahogePivot.rotation.z = -0.1 + Math.sin(t * 1.7) * 0.12; ahogeStar.rotation.y = t * 0.8;
    tails.forEach((piv, i) => { const s = i ? 1 : -1; piv.rotation.z = s * (0.12 + (Math.sin(t * 1.6 + i * 1.5) * 0.1) + p.talk * 0.05); piv.rotation.x = Math.sin(t * 1.3 + i) * 0.06; });
    arms.forEach(({ piv, s }) => {
      const ov = fx.arms && fx.arms[s < 0 ? 'L' : 'R'];                // 指示があれば、その腕はそのとおりに動かす
      const [rx, rz] = ov || armPose(p.pose, s, t, p.talk);
      const k = ov ? 0.3 : 0.18;
      piv.rotation.x = lerp(piv.rotation.x, rx, k); piv.rotation.z = lerp(piv.rotation.z, rz, k);
      // 頭が大きいので、腕をあげるときは肩を外側・手前に出して、頭の陰に隠れないようにする
      piv.position.x = lerp(piv.position.x, s * (0.46 + ((ov && ov[2]) || 0)), 0.2);
      piv.position.z = lerp(piv.position.z, (ov && ov[3]) || 0, 0.2);
    });
    const sig = [p.wink || '', p.eye, p.mouth, Math.round(p.open * 12), p.blink > 0.55 ? 1 : 0, Math.round(p.blush * 10), Math.round(p.brow * 8), Math.round(p.raise * 20), p.listening ? 1 : 0, p.tear ? Math.round(p.tear * 20) : 0, p.mouth === 'wavy' ? Math.round(t * 10) : 0].join('|');
    if (sig !== lastSig) { paintFace(fg, p); faceTex.needsUpdate = true; lastSig = sig; }
    renderer.render(scene, camera);
    return renderer.domElement;
  }
  return { render, width, height, dispose() { renderer.dispose(); } };
}

try { window.Lumi3D = createLumi3D(); } catch (e) { console.warn('Lumi3D unavailable:', e && e.message); }
