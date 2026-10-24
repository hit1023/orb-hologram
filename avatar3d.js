import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const WIDTH = 512;
const HEIGHT = 768;
const canvas = document.createElement('canvas');
canvas.width = WIDTH;
canvas.height = HEIGHT;

const renderer = new THREE.WebGLRenderer({
  canvas,
  alpha: true,
  antialias: true,
  powerPreference: 'high-performance',
  premultipliedAlpha: true,
});
renderer.setPixelRatio(1);
renderer.setSize(WIDTH, HEIGHT, false);
renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(25, WIDTH / HEIGHT, 0.01, 100);
const clock = new THREE.Clock();

scene.add(new THREE.HemisphereLight(0xb9f8ff, 0x12051f, 1.25));
const cyan = new THREE.DirectionalLight(0x42f5ff, 2.4);
cyan.position.set(-2.5, 3.5, 3.5);
scene.add(cyan);
const magenta = new THREE.DirectionalLight(0xff3bd4, 2.1);
magenta.position.set(2.8, 2.0, 1.8);
scene.add(magenta);
const front = new THREE.DirectionalLight(0xffffff, 1.35);
front.position.set(0, 2.5, 4.5);
scene.add(front);

let avatar = null;
let mixer = null;
const animatedAccessories = [];
let loading = false;
let ready = false;
let error = '';

function frameModel(model) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= box.min.y;
  model.position.z -= center.z;
  const height = Math.max(1.2, size.y);
  camera.position.set(0, height * 0.52, height * 2.15);
  camera.lookAt(0, height * 0.52, 0);
  camera.updateProjectionMatrix();
}

function enhanceForHologram(root) {
  root.traverse((node) => {
    if (!node.isMesh) return;
    node.frustumCulled = false;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    for (const material of materials) {
      if (!material) continue;
      const materialName = (material.name || '').toLowerCase();
      if (material.color) {
        if (materialName === 'hair') {
          material.color.set(0x22eaff);
          material.metalness = 0.16;
          material.roughness = 0.28;
        } else if (material.map) {
          material.color.set(0xffffff);
          material.metalness = 0.08;
          material.roughness = 0.48;
        } else if (materialName.includes('joint')) {
          material.color.set(0xff39cf);
        } else {
          material.color.set(0x03111f);
          material.metalness = 0.48;
          material.roughness = 0.28;
        }
      }
      if (material.emissive) {
        material.emissive.set(materialName === 'hair' ? 0x05cce5 : materialName.includes('joint') ? 0xff24c7 : material.map ? 0x001018 : 0x00758a);
        material.emissiveIntensity = materialName === 'hair' ? 1.25 : materialName.includes('joint') ? 1.35 : material.map ? 0.12 : 0.24;
      }
      if ('outlineWidthFactor' in material) material.outlineWidthFactor = Math.max(material.outlineWidthFactor || 0, 0.003);
      material.needsUpdate = true;
    }
  });
}

function addNeonAccessories(root) {
  const head = root.getObjectByName('head');
  if (!head) return;
  let hasDetailedFace = false;
  root.traverse((node) => {
    if (!node.isMesh) return;
    const materials = Array.isArray(node.material) ? node.material : [node.material];
    if (materials.some((material) => material?.map)) hasDetailedFace = true;
  });
  const hairMaterial = new THREE.MeshStandardMaterial({
    color: 0x22eaff,
    emissive: 0x08dff5,
    emissiveIntensity: 1.7,
    metalness: 0.18,
    roughness: 0.24,
  });
  for (const side of [-1, 1]) {
    const tail = new THREE.Group();
    tail.position.set(side * 0.14, 0.04, -0.015);
    tail.rotation.z = side * 0.34;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(side * 0.08, -0.13, 0),
      new THREE.Vector3(side * 0.12, -0.31, 0.015),
      new THREE.Vector3(side * 0.07, -0.50, 0.025),
      new THREE.Vector3(side * 0.02, -0.66, 0.04),
    ]);
    const hair = new THREE.Mesh(new THREE.TubeGeometry(curve, 28, 0.047, 10, false), hairMaterial);
    tail.add(hair);
    head.add(tail);
    animatedAccessories.push({ object: tail, side, baseZ: tail.rotation.z });
  }

  if (hasDetailedFace) return;
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0x9cffff,
    emissive: 0x30efff,
    emissiveIntensity: 2.8,
    metalness: 0.3,
    roughness: 0.12,
  });
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.018, 12, 8), eyeMaterial);
    eye.position.set(side * 0.047, 0.078, 0.112);
    eye.scale.set(1.6, 0.65, 0.5);
    head.add(eye);
  }
}

async function init() {
  if (loading || ready) return;
  loading = true;
  error = '';
  try {
    const loader = new GLTFLoader();
    const [modelGltf, animationGltf] = await Promise.all([
      loader.loadAsync('dancer-avatar.glb?v=6'),
      loader.loadAsync('dancer-motion.glb?v=1'),
    ]);
    avatar = modelGltf.scene;
    enhanceForHologram(avatar);
    addNeonAccessories(avatar);
    scene.add(avatar);
    frameModel(avatar);

    const clip = THREE.AnimationClip.findByName(animationGltf.animations, 'Dance Body Roll');
    if (!clip) throw new Error('Dance Body Roll animation was not found');
    mixer = new THREE.AnimationMixer(avatar);
    const action = mixer.clipAction(clip);
    action.setLoop(THREE.LoopRepeat, Infinity);
    action.clampWhenFinished = false;
    action.play();
    ready = true;
    clock.start();
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    console.error('[avatar3d]', e);
  } finally {
    loading = false;
  }
}

function render(state = 'idle', level = 0) {
  if (!ready || !avatar || !mixer) return false;
  const dt = Math.min(0.05, clock.getDelta());
  const targetRate = state === 'speaking' ? 1.13 + level * 0.20 : state === 'thinking' ? 0.96 : 1.05;
  mixer.timeScale += (targetRate - mixer.timeScale) * 0.08;
  mixer.update(dt);
  const sway = performance.now() * 0.001;
  for (const accessory of animatedAccessories) {
    accessory.object.rotation.z = accessory.baseZ + accessory.side * Math.sin(sway * 2.4) * 0.16;
    accessory.object.rotation.x = Math.sin(sway * 1.7 + accessory.side) * 0.10;
  }
  renderer.render(scene, camera);
  return true;
}

function status() {
  return { ready, loading, error };
}

export { canvas, init, render, status };
