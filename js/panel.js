// Paneles 2D dibujados con <canvas> y mostrados como planos en 3D.
// Cada panel puede registrar "regiones" clicables (botones) en coordenadas de píxel.
import * as THREE from 'three';

export const COLORS = {
  bg: 'rgba(13, 17, 23, 0.86)',
  bgSolid: 'rgba(13, 17, 23, 0.96)',
  card: 'rgba(33, 38, 45, 0.95)',
  border: 'rgba(240, 246, 252, 0.18)',
  text: '#f0f3f6',
  muted: '#9aa4af',
  accent: '#ffb000',
  btn: '#2b3139',
  btnActive: '#1f6feb',
  ok: '#3fb950',
  warn: '#e3b341',
  crit: '#ff5d55',
};

export const STATUS = {
  ok: { label: 'OK', color: COLORS.ok },
  warn: { label: 'ATENCIÓN', color: COLORS.warn },
  crit: { label: 'CRÍTICO', color: COLORS.crit },
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
export const font = (size, weight = 400) => `${weight} ${size}px ${FONT}`;

export class CanvasPanel {
  constructor(widthM, heightM, { pxPerMeter = 1200, name = 'panel', consumesClicks = false } = {}) {
    this.widthM = widthM;
    this.heightM = heightM;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(widthM * pxPerMeter);
    this.canvas.height = Math.round(heightM * pxPerMeter);
    this.ctx = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const material = new THREE.MeshBasicMaterial({
      map: this.texture, transparent: true, depthWrite: false, depthTest: false,
      side: THREE.DoubleSide, toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), material);
    this.mesh.name = name;
    this.mesh.userData.panel = this;
    this.consumesClicks = consumesClicks;
    this.regions = [];
  }

  get W() { return this.canvas.width; }
  get H() { return this.canvas.height; }

  draw(fn) {
    this.ctx.clearRect(0, 0, this.W, this.H);
    this.regions = [];
    this.ctx.textBaseline = 'alphabetic';
    this.ctx.textAlign = 'left';
    fn(this.ctx, this);
    this.texture.needsUpdate = true;
  }

  region(x, y, w, h, onClick) { this.regions.push({ x, y, w, h, onClick }); }

  hit(uv) {
    const px = uv.x * this.W, py = (1 - uv.y) * this.H;
    for (let i = this.regions.length - 1; i >= 0; i--) {
      const r = this.regions[i];
      if (px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) return r;
    }
    return null;
  }

  /** Devuelve true si se activó un botón. */
  click(uv) {
    const r = uv && this.hit(uv);
    if (r) { r.onClick(); return true; }
    return false;
  }

  setOpacity(o) { this.mesh.material.opacity = o; }

  dispose() {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Recorta el texto con "…" para que quepa en maxW. */
export function fitText(ctx, text, maxW) {
  text = String(text ?? '');
  if (ctx.measureText(text).width <= maxW) return text;
  let lo = 0, hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(text.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
  }
  return text.slice(0, lo) + '…';
}

/** Parte el texto en líneas de ancho maxW. */
export function wrapText(ctx, text, maxW) {
  const lines = [];
  for (const para of String(text ?? '').split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? `${line} ${word}` : word;
      if (ctx.measureText(test).width <= maxW || !line) line = test;
      else { lines.push(line); line = word; }
    }
    lines.push(line);
  }
  return lines;
}

/** Dibuja líneas envueltas; devuelve la Y siguiente. Respeta maxY. */
export function drawWrapped(ctx, text, x, y, maxW, lineH, maxY = Infinity) {
  const lines = wrapText(ctx, text, maxW);
  for (let i = 0; i < lines.length; i++) {
    if (y > maxY) break;
    const last = y + lineH > maxY && i < lines.length - 1;
    ctx.fillText(last ? fitText(ctx, lines[i] + '…', maxW) : lines[i], x, y);
    y += lineH;
  }
  return y;
}

export function drawButton(ctx, panel, { x, y, w, h, label, onClick, active = false, disabled = false, size = 22, color }) {
  roundRect(ctx, x, y, w, h, Math.min(14, h / 3));
  ctx.fillStyle = disabled ? 'rgba(43,49,57,0.5)' : (color || (active ? COLORS.btnActive : COLORS.btn));
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = COLORS.border;
  ctx.stroke();
  ctx.fillStyle = disabled ? COLORS.muted : COLORS.text;
  ctx.font = font(size, 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, label, w - 16), x + w / 2, y + h / 2 + 1);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  if (!disabled && onClick) panel.region(x, y, w, h, onClick);
}
