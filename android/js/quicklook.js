// Realidad aumentada en iPhone/iPad: Safari de iOS no tiene WebXR, así que se genera un modelo USDZ
// (equipo + carteles) y se abre con AR Quick Look, el visor de realidad aumentada nativo de Apple (ARKit).
import * as THREE from 'three';
import { USDZExporter } from 'three/addons/exporters/USDZExporter.js';
import { ComponentLabel } from './labels.js';
import { previewBounds } from './preview.js';
import { STATUS } from './panel.js';

export const isIOS = () => /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); // iPad con iPadOS "de escritorio"

/** Safari de iOS indica soporte de Quick Look en <a rel="ar">. */
export function supportsQuickLook() {
  const a = document.createElement('a');
  return !!a.relList?.supports?.('ar');
}

const LABEL_SCALE = 1.5;   // los carteles son más grandes que en el visor: no se acercan solos a la vista
const PANEL = [0.56, 0.34];

const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

function numberTexture(n) {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffb000';
  ctx.beginPath(); ctx.arc(128, 128, 120, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.font = '800 170px system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(n), 128, 140);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Escena a escala real (metros), con el origen en el suelo al centro del equipo. */
export function buildQuickLookScene(machine, { guide = true } = {}) {
  const root = new THREE.Group();
  const b = previewBounds(machine);
  const cx = b.isEmpty() ? 0 : (b.min.x + b.max.x) / 2;
  const cz = b.isEmpty() ? 0 : (b.min.z + b.max.z) / 2;

  // Contorno translúcido del equipo para alinearlo con la máquina real
  if (guide) {
    const gm = mat(0x37c8ff, { transparent: true, opacity: 0.16, emissive: 0x0b3a52 });
    for (const part of machine.preview ?? []) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...part.size), gm);
      m.position.fromArray(part.pos);
      if (part.rot) m.rotation.set(...part.rot.map(THREE.MathUtils.degToRad));
      root.add(m);
    }
  }

  // Puntos 1 (extremo delantero) y 2 (extremo trasero) en el suelo, como en la guía de Android/Quest
  if (!b.isEmpty()) {
    for (const [n, z] of [[1, b.max.z], [2, b.min.z]]) {
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.01, 40), mat(0xffb000, { emissive: 0x553a00 }));
      disc.position.set(cx, 0.005, z);
      const tex = numberTexture(n);
      const num = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), mat(0xffffff, { map: tex, emissiveMap: tex, emissive: 0xffffff, transparent: true }));
      num.rotation.x = -Math.PI / 2;
      num.position.set(cx, 0.012, z);
      root.add(disc, num);
    }
  }

  // Componentes: marcador de color por estado, varilla y cartel legible desde ambos lados
  const labels = [];
  for (const c of machine.components) {
    if (!Array.isArray(c.position)) continue;
    const label = new ComponentLabel(c, machine);
    label.footer = 'Ficha completa: toca la pieza en la app';
    label.drawDetail();
    labels.push(label);
    const color = new THREE.Color(STATUS[label.status].color);

    const p = new THREE.Vector3().fromArray(c.position);
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(0.06, 20, 14), mat(color, { emissive: color.clone().multiplyScalar(0.6) }));
    sphere.position.copy(p);
    root.add(sphere);

    const w = PANEL[0] * LABEL_SCALE, h = PANEL[1] * LABEL_SCALE;
    const off = new THREE.Vector3().fromArray(c.labelOffset ?? [0, 0.35, 0]).multiplyScalar(1.6);
    const bottom = p.clone().add(off);
    const center = bottom.clone().add(new THREE.Vector3(0, h / 2, 0));

    const seg = bottom.clone().sub(p);
    if (seg.length() > 0.02) {
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, seg.length(), 8), mat(color, { emissive: color }));
      pole.position.copy(p).addScaledVector(seg, 0.5);
      pole.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), seg.clone().normalize());
      root.add(pole);
    }

    const tex = new THREE.CanvasTexture(label.detail.canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const pm = mat(0xffffff, { map: tex, emissiveMap: tex, emissive: 0xffffff, transparent: true });
    // Mirando hacia afuera del equipo (desde su eje central)
    let dx = center.x - cx, dz = center.z - cz;
    if (Math.hypot(dx, dz) < 0.05) { dx = 0; dz = 1; }
    const yaw = Math.atan2(dx, dz);
    for (const [k, extra] of [[1, 0], [-1, Math.PI]]) {
      const panel = new THREE.Mesh(new THREE.PlaneGeometry(w, h), pm);
      panel.position.copy(center).add(new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)).multiplyScalar(0.004 * k));
      panel.rotation.set(0, yaw + extra, 0);
      root.add(panel);
    }
  }
  return { root, dispose: () => { labels.forEach((l) => l.dispose()); } };
}

/** Genera el archivo USDZ del equipo. */
export async function exportUSDZ(machine, opts) {
  const scene = new THREE.Scene();
  const { root, dispose } = buildQuickLookScene(machine, opts);
  scene.add(root);
  scene.updateMatrixWorld(true);
  try {
    const data = await new USDZExporter().parse(scene, { quickLookCompatible: true });
    return new Blob([data], { type: 'model/vnd.usdz+zip' });
  } finally {
    dispose();
    root.traverse((o) => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose?.(); });
  }
}

/**
 * URL para <a rel="ar">: escala fija 100 % (no se puede agrandar/achicar por error) y
 * un rótulo con el nombre del equipo en el visor de Apple.
 */
export function quickLookHref(blobUrl, machine) {
  const p = new URLSearchParams({
    allowsContentScaling: '0',
    checkoutTitle: machine.name,
    checkoutSubtitle: 'Alinea los puntos 1 y 2 con la máquina',
  });
  return `${blobUrl}#${p.toString()}`;
}
