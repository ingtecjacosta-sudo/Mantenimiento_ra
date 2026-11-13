// Croquis del equipo (vista lateral y en planta) para guiar dónde marcar los 2 puntos de ubicación.
import * as THREE from 'three';
import { previewBounds } from './preview.js';

const C = {
  body: 'rgba(255, 176, 0, 0.22)', edge: '#ffb000', ground: '#9aa4af', text: '#f0f3f6', muted: '#9aa4af',
  now: '#ffb000', done: '#3fb950', todo: '#6e7681', guide: 'rgba(240, 246, 252, 0.55)',
};

/** Polígonos (envolvente convexa) de cada caja de la maqueta proyectada en un plano. */
function projectedParts(machine, axisH, axisV) {
  const parts = [];
  const obj = new THREE.Object3D();
  const v = new THREE.Vector3();
  for (const part of machine.preview ?? []) {
    obj.position.fromArray(part.pos);
    obj.rotation.set(...(part.rot ?? [0, 0, 0]).map(THREE.MathUtils.degToRad));
    obj.updateMatrix();
    const [w, h, d] = part.size;
    const pts = [];
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) {
      v.set((sx * w) / 2, (sy * h) / 2, (sz * d) / 2).applyMatrix4(obj.matrix);
      pts.push([v[axisH], v[axisV]]);
    }
    parts.push(hull(pts));
  }
  return parts;
}

function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function marker(ctx, x, y, n, state, r) {
  const color = state === 'now' ? C.now : state === 'done' ? C.done : C.todo;
  ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
  ctx.lineWidth = Math.max(2, r / 6); ctx.strokeStyle = '#0d1117'; ctx.stroke();
  ctx.fillStyle = '#0d1117';
  ctx.font = `800 ${Math.round(r * 1.15)}px system-ui, sans-serif`;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(state === 'done' ? '✓' : String(n), x, y + 1);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

/**
 * Dibuja el croquis en un rectángulo del canvas.
 * step: 0 = toca el punto 1, 1 = toca el punto 2, 2 = ambos listos.
 * views: 'side' | 'both' (lateral + planta).
 */
export function drawCroquis(ctx, machine, x, y, w, h, { step = 0, views = 'both', scale = 1, pulse = 0, frontLeft = false, points = null } = {}) {
  const b = previewBounds(machine);
  if (b.isEmpty()) return;
  const len = b.max.z - b.min.z, wid = b.max.x - b.min.x, hei = b.max.y - b.min.y;
  const pad = 26 * scale;
  const fs = Math.round(15 * scale);
  const both = views === 'both';
  const topOnly = views === 'top';
  const sideH = both ? h * 0.6 : topOnly ? 0 : h;
  const planH = h - sideH;
  // Escala común para que ambas vistas tengan el mismo largo
  // Vista en planta: espacio arriba para el título y el rótulo de un lado, y abajo para el otro
  const planTop = fs + 26 * scale, planBot = 24 * scale;
  const k = Math.min((w - 2 * pad) / len, sideH ? (sideH - pad * 1.6) / hei : Infinity, planH ? (planH - planTop - planBot) / wid : Infinity);
  // El frente (+Z) queda a la derecha del croquis, o a la izquierda si así se ve en la foto del técnico
  const X0 = (z) => pad + (z - b.min.z) * k + ((w - 2 * pad) - len * k) / 2;
  const X = (z) => (frontLeft ? x + w - X0(z) : x + X0(z));
  // Puntos a marcar: los de referencia del equipo, o los 2 extremos por defecto
  const cxb = (b.min.x + b.max.x) / 2;
  const pts = points ?? [
    { pos: [cxb, 0, b.max.z], state: step > 0 ? 'done' : 'now' },
    { pos: [cxb, 0, b.min.z], state: step > 1 ? 'done' : step === 1 ? 'now' : 'todo' },
  ];
  const r = (p) => (p.state === 'now' ? 13 + 2 * pulse : 11) * scale;
  // El punto actual se dibuja al final para que quede encima
  const order = pts.map((p, i) => i).sort((a, c) => (pts[a].state === 'now') - (pts[c].state === 'now'));

  // --- Vista lateral ---
  const groundY = y + sideH - pad * 0.9;
  const Y = (yy) => groundY - (yy - b.min.y) * k;
  ctx.save();
  if (sideH) {
  ctx.fillStyle = C.muted; ctx.font = `600 ${fs}px system-ui, sans-serif`;
  ctx.fillText('VISTA LATERAL', x + 8 * scale, y + fs + 2);
  ctx.fillStyle = C.edge;
  if (frontLeft) { ctx.textAlign = 'center'; ctx.fillText('◀ FRENTE', x + w / 2, y + fs + 2); }
  else { ctx.textAlign = 'right'; ctx.fillText('FRENTE ▶', x + w - 8 * scale, y + fs + 2); }
  ctx.textAlign = 'left';
  ctx.lineWidth = 2 * scale; ctx.strokeStyle = C.ground;
  ctx.beginPath(); ctx.moveTo(x + 6, groundY); ctx.lineTo(x + w - 6, groundY); ctx.stroke();
  for (let i = x + 10; i < x + w - 10; i += 14 * scale) { ctx.beginPath(); ctx.moveTo(i, groundY); ctx.lineTo(i - 6 * scale, groundY + 6 * scale); ctx.stroke(); }
  const side = projectedParts(machine, 'z', 'y');
  ctx.lineWidth = 1.5 * scale;
  let front = null, rear = null;
  for (const poly of side) {
    ctx.beginPath();
    poly.forEach(([zz, yy], i) => (i ? ctx.lineTo(X(zz), Y(yy)) : ctx.moveTo(X(zz), Y(yy))));
    ctx.closePath();
    ctx.fillStyle = C.body; ctx.fill(); ctx.strokeStyle = C.edge; ctx.stroke();
    for (const p of poly) { if (!front || p[0] > front[0]) front = p; if (!rear || p[0] < rear[0]) rear = p; }
  }
  // Línea punteada desde cada extremo hasta el suelo (solo en el método de 2 extremos)
  if (!points) {
    ctx.setLineDash([5 * scale, 4 * scale]); ctx.strokeStyle = C.guide; ctx.lineWidth = 1.5 * scale;
    for (const p of [front, rear]) { ctx.beginPath(); ctx.moveTo(X(p[0]), Y(p[1])); ctx.lineTo(X(p[0]), groundY); ctx.stroke(); }
    ctx.setLineDash([]);
  }
  for (const i of order) marker(ctx, X(pts[i].pos[2]), Y(pts[i].pos[1]), i + 1, pts[i].state, r(pts[i]));
  ctx.fillStyle = C.muted; ctx.font = `500 ${Math.round(13 * scale)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`${len.toFixed(1)} m`, (X(b.min.z) + X(b.max.z)) / 2, groundY + 20 * scale);
  ctx.textAlign = 'left';
  }

  // --- Vista en planta (desde arriba) ---
  if (planH) {
    const y0 = y + sideH;
    const cxw = (b.min.x + b.max.x) / 2;
    const midY = y0 + planTop + (planH - planTop - planBot) / 2;
    // Visto desde arriba con el frente a la derecha, el lado izquierdo del equipo (+X) queda ARRIBA;
    // con el frente a la izquierda, queda abajo.
    const sgn = frontLeft ? 1 : -1;
    const Yp = (xx) => midY + sgn * (xx - cxw) * k;
    ctx.fillStyle = C.muted; ctx.font = `600 ${fs}px system-ui, sans-serif`;
    ctx.fillText('VISTA DESDE ARRIBA', x + 8 * scale, y0 + fs);
    if (topOnly) {
      ctx.fillStyle = C.edge; ctx.textAlign = 'right';
      ctx.fillText(frontLeft ? '◀ FRENTE' : 'FRENTE ▶', x + w - 8 * scale, y0 + fs);
      ctx.textAlign = 'left';
    }
    // Lados del equipo (izquierdo = +X, abajo en el croquis cuando el frente está a la derecha)
    ctx.fillStyle = C.muted; ctx.font = `600 ${Math.round(11 * scale)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    const midX = (X(b.min.z) + X(b.max.z)) / 2;
    const sideTop = frontLeft ? 'LADO DERECHO' : 'LADO IZQUIERDO', sideBot = frontLeft ? 'LADO IZQUIERDO' : 'LADO DERECHO';
    for (const poly of projectedParts(machine, 'z', 'x')) {
      ctx.beginPath();
      poly.forEach(([zz, xx], i) => (i ? ctx.lineTo(X(zz), Yp(xx)) : ctx.moveTo(X(zz), Yp(xx))));
      ctx.closePath();
      ctx.fillStyle = C.body; ctx.fill(); ctx.strokeStyle = C.edge; ctx.lineWidth = 1.2 * scale; ctx.stroke();
    }
    ctx.fillStyle = C.muted;
    const yA = Yp(b.max.x), yB = Yp(b.min.x);
    ctx.fillText(sideTop, midX, Math.min(yA, yB) - 6 * scale);
    ctx.fillText(sideBot, midX, Math.max(yA, yB) + 15 * scale);
    ctx.textAlign = 'left';
    // Eje central: los puntos van en la línea media del ancho
    ctx.setLineDash([6 * scale, 5 * scale]); ctx.strokeStyle = C.guide; ctx.lineWidth = 1.5 * scale;
    ctx.beginPath(); ctx.moveTo(X(b.min.z) - 16 * scale, Yp(cxw)); ctx.lineTo(X(b.max.z) + 16 * scale, Yp(cxw)); ctx.stroke();
    ctx.setLineDash([]);
    for (const i of order) marker(ctx, X(pts[i].pos[2]), Yp(pts[i].pos[0]), i + 1, pts[i].state, r(pts[i]));
  }
  ctx.restore();
}

/** true si en la foto de costado del técnico el frente del equipo aparece a la izquierda. */
export function frontLeftIn(app) {
  const g = photoGuide(app);
  return !!g && g.p1[0] < g.p2[0];
}

/** Foto de costado calibrada con la posición de los puntos 1 y 2 (en coordenadas 0..1), o null. */
export function photoGuide(app) {
  const m = app.machine;
  for (const view of ['izq', 'der']) {
    const cal = m?.photos?.[view]?.calib;
    if (app.photoUrls?.[view] && Array.isArray(cal) && cal.length === 3) {
      return { view, url: app.photoUrls[view], p1: cal[0], p2: [cal[1][0], cal[0][1]] };
    }
  }
  return null;
}
