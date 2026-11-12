// Interfaz dentro del visor: ficha completa del componente, menú flotante y mensajes.
import * as THREE from 'three';
import { CanvasPanel, COLORS, STATUS, font, fitText, roundRect, drawWrapped, drawButton } from './panel.js';
import { maintenanceInfo, hoursText, getChecklist, setChecklist } from './data.js';

const _v = new THREE.Vector3();

function headingYaw(quat) {
  _v.set(0, 0, -1).applyQuaternion(quat);
  return Math.atan2(-_v.x, -_v.z);
}

/** Panel que sigue a la vista "con pereza": solo se reacomoda cuando giras la cabeza. */
class LazyFollower {
  constructor(mesh, { dist, yawOffset, down, threshold, speed }) {
    Object.assign(this, { mesh, dist, yawOffset, down, threshold, speed });
    this.yaw = 0;
    this.following = true;
    this.initialized = false;
    this.target = new THREE.Vector3();
  }
  update(camPos, camQuat, dt) {
    const camYaw = headingYaw(camQuat);
    let diff = Math.atan2(Math.sin(camYaw - this.yaw), Math.cos(camYaw - this.yaw));
    if (!this.initialized) { this.yaw = camYaw; diff = 0; }
    if (Math.abs(diff) > this.threshold) this.following = true;
    if (this.following) {
      this.yaw += diff * (1 - Math.exp(-dt * this.speed));
      if (Math.abs(diff) < 0.03) this.following = false;
    }
    const a = this.yaw + this.yawOffset;
    this.target.set(camPos.x - Math.sin(a) * this.dist, camPos.y - this.down, camPos.z - Math.cos(a) * this.dist);
    if (!this.initialized) { this.mesh.position.copy(this.target); this.initialized = true; }
    else this.mesh.position.lerp(this.target, 1 - Math.exp(-dt * this.speed));
    this.mesh.lookAt(camPos);
  }
  reset() { this.initialized = false; }
}

// ---------------------------------------------------------------------------

export class Hud {
  constructor() {
    this.panel = new CanvasPanel(0.62, 0.085, { name: 'hud' });
    this.panel.mesh.renderOrder = 40;
    this.panel.mesh.visible = false;
    this.follower = new LazyFollower(this.panel.mesh, { dist: 1.0, yawOffset: 0, down: 0.22, threshold: 0.25, speed: 5 });
    this.timeLeft = 0;
    this.opacity = 0;
  }
  get mesh() { return this.panel.mesh; }
  show(text, seconds = 4, color = COLORS.accent) {
    this.timeLeft = seconds;
    this.panel.draw((ctx, p) => {
      roundRect(ctx, 2, 2, p.W - 4, p.H - 4, 20);
      ctx.fillStyle = COLORS.bgSolid; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.stroke();
      ctx.fillStyle = COLORS.text; ctx.font = font(28, 600); ctx.textAlign = 'center';
      ctx.fillText(fitText(ctx, text, p.W - 40), p.W / 2, p.H / 2 + 10);
    });
  }
  update(dt, camPos, camQuat, enabled) {
    this.timeLeft -= dt;
    const target = enabled && this.timeLeft > 0 ? 1 : 0;
    this.opacity += (target - this.opacity) * (1 - Math.exp(-dt * 8));
    this.panel.setOpacity(this.opacity);
    this.panel.mesh.visible = this.opacity > 0.02;
    if (enabled) this.follower.update(camPos, camQuat, dt);
  }
}

// ---------------------------------------------------------------------------

export class Toolbar {
  constructor(app) {
    this.app = app;
    this.panel = new CanvasPanel(0.36, 0.34, { name: 'toolbar', consumesClicks: true });
    this.panel.mesh.renderOrder = 35;
    this.panel.mesh.visible = false;
    this.follower = new LazyFollower(this.panel.mesh, { dist: 0.55, yawOffset: 0.6, down: 0.3, threshold: 0.7, speed: 3 });
  }
  get mesh() { return this.panel.mesh; }
  update(dt, camPos, camQuat) { this.follower.update(camPos, camQuat, dt); }

  render() {
    const { state, actions, machine } = this.app;
    if (!machine) return;
    this.panel.draw((ctx, p) => {
      const W = p.W, H = p.H;
      roundRect(ctx, 2, 2, W - 4, H - 4, 22);
      ctx.fillStyle = COLORS.bgSolid; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = COLORS.border; ctx.stroke();
      ctx.fillStyle = COLORS.text; ctx.font = font(25, 700);
      ctx.fillText(fitText(ctx, machine.name, W - 36), 18, 40);
      const alerts = this.app.labels.filter((l) => l.status !== 'ok').length;
      ctx.font = font(19, 500); ctx.fillStyle = COLORS.muted;
      const hm = `Horómetro ${hoursText(machine.hourMeter)} · `;
      ctx.fillText(hm, 18, 70);
      ctx.fillStyle = alerts ? COLORS.warn : COLORS.ok; ctx.font = font(19, 700);
      ctx.fillText(alerts ? `${alerts} con alerta` : 'Sin alertas', 18 + ctx.measureText(hm).width, 70);

      const bw = (W - 3 * 14) / 2, bh = 46;
      const col = (i) => 14 + (i % 2) * (bw + 14);
      const row = (i, y0) => y0 + Math.floor(i / 2) * (bh + 11);
      const grid = (buttons, y0) => buttons.forEach((b, i) => b && drawButton(ctx, p, { x: col(i), y: row(i, y0), w: bw, h: bh, size: 20, ...b }));

      if (state.mode === 'place') {
        ctx.fillStyle = COLORS.accent; ctx.font = font(21, 700);
        ctx.fillText('UBICAR EQUIPO', 18, 108);
        ctx.fillStyle = COLORS.text; ctx.font = font(19, 400);
        let y = drawWrapped(ctx, `Apunta a: ${machine.reference?.description ?? 'el centro del equipo, en el suelo'}.`, 18, 136, W - 36, 25, 210);
        ctx.fillStyle = COLORS.muted;
        drawWrapped(ctx, 'Gatillo/pellizco = confirmar. Stick o botones = girar.', 18, y + 2, W - 36, 25, 240);
        grid([
          { label: 'Girar ⟲ 5°', onClick: () => actions.rotate(5) },
          { label: 'Girar ⟳ 5°', onClick: () => actions.rotate(-5) },
          state.placed ? { label: 'Cancelar', onClick: actions.cancelPlace } : null,
          { label: 'Salir de RA', onClick: actions.exitXR },
        ], H - 2 * (bh + 11) - 6);
      } else if (state.mode === 'register') {
        const comps = machine.components;
        const comp = comps[state.registerIndex];
        const done = comps.filter((c) => Array.isArray(c.position)).length;
        ctx.fillStyle = COLORS.accent; ctx.font = font(21, 700);
        ctx.fillText(`REGISTRAR PUNTOS  ${state.registerIndex + 1}/${comps.length}`, 18, 108);
        ctx.fillStyle = COLORS.text; ctx.font = font(26, 700);
        ctx.fillText(fitText(ctx, comp?.name ?? '-', W - 36), 18, 142);
        ctx.font = font(18, 500);
        ctx.fillStyle = Array.isArray(comp?.position) ? COLORS.ok : COLORS.muted;
        ctx.fillText(Array.isArray(comp?.position) ? '✔ Ya registrado (gatillo para corregir)' : 'Sin registrar', 18, 168);
        ctx.fillStyle = COLORS.muted;
        drawWrapped(ctx, `Toca la pieza con el control o apunta y presiona gatillo. Registrados: ${done}/${comps.length}`, 18, 194, W - 36, 23, 220);
        grid([
          { label: '◀ Anterior', onClick: () => actions.registerStep(-1) },
          { label: 'Siguiente ▶', onClick: () => actions.registerStep(1) },
          { label: 'Borrar punto', onClick: actions.clearPoint, disabled: !Array.isArray(comp?.position) },
          { label: 'Terminar', onClick: actions.finishRegister, active: true },
        ], H - 2 * (bh + 11) - 6);
      } else {
        grid([
          { label: 'Ubicar equipo', onClick: actions.startPlace },
          { label: 'Registrar puntos', onClick: actions.startRegister },
          { label: `Carteles: ${state.showAll ? 'Todos' : 'Auto'}`, onClick: actions.toggleShowAll, active: state.showAll },
          { label: `Ver: ${state.alertsOnly ? 'Alertas' : 'Todo'}`, onClick: actions.toggleAlertsOnly, active: state.alertsOnly },
          { label: 'Girar ⟲ 2°', onClick: () => actions.rotate(2), disabled: !state.placed },
          { label: 'Girar ⟳ 2°', onClick: () => actions.rotate(-2), disabled: !state.placed },
          { label: `Guía 3D: ${state.showGuide ? 'Sí' : 'No'}`, onClick: actions.toggleGuide, active: state.showGuide },
          { label: 'Salir de RA', onClick: actions.exitXR },
        ], 88);
      }
    });
  }
}

// ---------------------------------------------------------------------------

const TABS = [['resumen', 'Resumen'], ['proc', 'Procedimiento'], ['check', 'Checklist'], ['parts', 'Repuestos']];

export class DetailWindow {
  constructor(app) {
    this.app = app;
    this.panel = new CanvasPanel(0.9, 0.62, { pxPerMeter: 1100, name: 'detail-window', consumesClicks: true });
    this.panel.mesh.renderOrder = 30;
    this.panel.mesh.visible = false;
    this.label = null;
  }
  get mesh() { return this.panel.mesh; }
  get isOpen() { return this.panel.mesh.visible; }

  open(label, camPos, camQuat) {
    this.label = label;
    this.tab = 'resumen';
    this.step = 0;
    this.placeInFront(camPos, camQuat, 0.95);
    this.panel.mesh.visible = true;
    this.render();
  }
  close() {
    this.panel.mesh.visible = false;
    if (this.label) this.label.highlight = false;
    this.label = null;
  }
  placeInFront(camPos, camQuat, dist, side = 0) {
    const yaw = headingYaw(camQuat) - side;
    _v.set(0, 0, -1).applyQuaternion(camQuat);
    const pitchY = THREE.MathUtils.clamp(_v.y, -0.5, 0.5);
    this.panel.mesh.position.set(camPos.x - Math.sin(yaw) * dist, camPos.y + pitchY * dist - 0.05, camPos.z - Math.cos(yaw) * dist);
    this.panel.mesh.lookAt(camPos);
  }

  render() {
    if (!this.label) return;
    const label = this.label, c = label.comp, m = this.app.machine;
    const st = STATUS[label.status];
    this.panel.draw((ctx, p) => {
      const W = p.W, H = p.H;
      roundRect(ctx, 3, 3, W - 6, H - 6, 28);
      ctx.fillStyle = COLORS.bgSolid; ctx.fill();
      ctx.lineWidth = 5; ctx.strokeStyle = st.color; ctx.stroke();

      ctx.fillStyle = st.color; roundRect(ctx, 26, 26, 12, 66, 6); ctx.fill();
      ctx.fillStyle = COLORS.text; ctx.font = font(40, 700);
      ctx.fillText(fitText(ctx, c.name, W - 180), 54, 62);
      ctx.font = font(24, 500); ctx.fillStyle = COLORS.muted;
      const sys = `${c.system ?? ''}${c.system ? ' · ' : ''}`;
      ctx.fillText(sys, 54, 92);
      ctx.fillStyle = st.color; ctx.font = font(24, 700);
      ctx.fillText(st.label, 54 + ctx.measureText(sys).width, 92);
      drawButton(ctx, p, { x: W - 96, y: 24, w: 72, h: 72, label: '✕', size: 34, onClick: () => this.close() });

      const tabs = this.app.photoImage && Array.isArray(c.photo) ? [...TABS, ['foto', 'Foto']] : TABS;
      if (!tabs.some(([id]) => id === this.tab)) this.tab = 'resumen';
      const tw = (W - 48 - (tabs.length - 1) * 10) / tabs.length;
      tabs.forEach(([id, name], i) => drawButton(ctx, p, {
        x: 24 + i * (tw + 10), y: 116, w: tw, h: 56, label: name, size: 24,
        active: this.tab === id, onClick: () => { this.tab = id; this.render(); },
      }));

      const top = 214;
      if (this.tab === 'resumen') this.drawSummary(ctx, p, c, m, top);
      else if (this.tab === 'proc') this.drawProcedure(ctx, p, c, top);
      else if (this.tab === 'check') this.drawChecklist(ctx, p, c, m, top);
      else if (this.tab === 'foto') this.drawPhoto(ctx, p, c, top);
      else this.drawParts(ctx, p, c, top);
    });
  }

  drawSummary(ctx, p, c, m, top) {
    const W = p.W, H = p.H, colW = (W - 90) / 2;
    const section = (t, x, y, color = COLORS.muted) => { ctx.fillStyle = color; ctx.font = font(20, 700); ctx.fillText(t, x, y); return y + 34; };

    let y = section('ESPECIFICACIONES', 30, top);
    const specs = Object.entries(c.specs ?? {});
    if (!specs.length) { ctx.fillStyle = COLORS.muted; ctx.font = font(22, 400); ctx.fillText('Sin datos', 30, y); }
    for (const [k, v] of specs) {
      if (y > H - 50) break;
      ctx.fillStyle = COLORS.muted; ctx.font = font(20, 500); ctx.fillText(fitText(ctx, k, colW), 30, y);
      ctx.fillStyle = COLORS.text; ctx.font = font(25, 600); ctx.fillText(fitText(ctx, v, colW), 30, y + 29);
      y += 66;
    }
    if (c.description && y < H - 80) {
      ctx.fillStyle = COLORS.text; ctx.font = font(21, 400);
      drawWrapped(ctx, c.description, 30, y + 4, colW, 28, H - 30);
    }

    const x = 60 + colW;
    y = section('MANTENIMIENTO', x, top);
    const mi = maintenanceInfo(c, m);
    if (mi) {
      ctx.fillStyle = COLORS.text; ctx.font = font(23, 600);
      y = drawWrapped(ctx, mi.task, x, y, colW, 30, y + 60);
      ctx.fillStyle = COLORS.muted; ctx.font = font(20, 500);
      ctx.fillText(`Cada ${hoursText(mi.interval)} · último a las ${hoursText(mi.last)}`, x, y); y += 30;
      ctx.fillStyle = mi.remaining < 0 ? COLORS.crit : (isWarn(mi) ? COLORS.warn : COLORS.ok);
      ctx.font = font(24, 700);
      ctx.fillText(mi.remaining < 0 ? `VENCIDO hace ${hoursText(-mi.remaining)}` : `Próximo: ${hoursText(mi.due)} (en ${hoursText(mi.remaining)})`, x, y);
      y += 16;
      roundRect(ctx, x, y, colW, 14, 7); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
      roundRect(ctx, x, y, Math.max(14, colW * mi.progress), 14, 7); ctx.fillStyle = mi.remaining < 0 ? COLORS.crit : (isWarn(mi) ? COLORS.warn : COLORS.ok); ctx.fill();
      y += 50;
    } else {
      ctx.fillStyle = COLORS.muted; ctx.font = font(22, 400); ctx.fillText('Sin plan cargado', x, y); y += 44;
    }
    if (c.alerts?.length) {
      y = section('ALERTAS', x, y, COLORS.crit);
      ctx.fillStyle = COLORS.text; ctx.font = font(22, 500);
      for (const a of c.alerts) y = drawWrapped(ctx, `● ${a}`, x, y, colW, 28, H - 40) + 4;
      y += 10;
    }
    if (c.safety?.length && y < H - 70) {
      y = section('SEGURIDAD', x, y, COLORS.warn);
      ctx.fillStyle = COLORS.text; ctx.font = font(21, 500);
      for (const s of c.safety) { if (y > H - 40) break; y = drawWrapped(ctx, `⚠ ${s}`, x, y, colW, 27, H - 30) + 4; }
    }
  }

  drawProcedure(ctx, p, c, top) {
    const W = p.W, H = p.H;
    const steps = c.procedure ?? [];
    if (!steps.length) { ctx.fillStyle = COLORS.muted; ctx.font = font(26, 400); ctx.fillText('Sin procedimiento cargado para este componente.', 30, top + 20); return; }
    this.step = THREE.MathUtils.clamp(this.step, 0, steps.length - 1);
    ctx.fillStyle = COLORS.accent; ctx.font = font(26, 700);
    ctx.fillText(`PASO ${this.step + 1} DE ${steps.length}`, 30, top);
    const text = steps[this.step];
    const danger = /^⚠/.test(text);
    ctx.fillStyle = danger ? COLORS.warn : COLORS.text; ctx.font = font(34, 500);
    drawWrapped(ctx, text, 30, top + 60, W - 60, 46, H - 130);
    // Puntos de avance
    const dotsW = steps.length * 22;
    steps.forEach((_, i) => {
      ctx.beginPath(); ctx.arc(W / 2 - dotsW / 2 + i * 22 + 11, H - 58, 7, 0, Math.PI * 2);
      ctx.fillStyle = i === this.step ? COLORS.accent : 'rgba(255,255,255,0.25)'; ctx.fill();
    });
    drawButton(ctx, p, { x: 24, y: H - 92, w: 230, h: 68, label: '◀ Anterior', size: 26, disabled: this.step === 0, onClick: () => { this.step--; this.render(); } });
    const last = this.step === steps.length - 1;
    drawButton(ctx, p, {
      x: W - 254, y: H - 92, w: 230, h: 68, size: 26, active: true,
      label: last ? 'Checklist ▶' : 'Siguiente ▶',
      onClick: () => { if (last) this.tab = 'check'; else this.step++; this.render(); },
    });
  }

  drawChecklist(ctx, p, c, m, top) {
    const W = p.W, H = p.H;
    const items = c.checklist ?? [];
    if (!items.length) { ctx.fillStyle = COLORS.muted; ctx.font = font(26, 400); ctx.fillText('Sin checklist para este componente.', 30, top + 20); return; }
    const values = getChecklist(m, c);
    const rowH = 58, maxRows = Math.floor((H - 110 - (top - 30)) / rowH);
    items.slice(0, maxRows).forEach((item, i) => {
      const y = top - 30 + i * rowH;
      roundRect(ctx, 24, y, W - 48, rowH - 8, 12);
      ctx.fillStyle = values[i] ? 'rgba(63,185,80,0.16)' : COLORS.card; ctx.fill();
      roundRect(ctx, 40, y + 9, 32, 32, 7);
      ctx.lineWidth = 3; ctx.strokeStyle = values[i] ? COLORS.ok : COLORS.muted; ctx.stroke();
      if (values[i]) { ctx.fillStyle = COLORS.ok; ctx.font = font(30, 700); ctx.fillText('✓', 43, y + 37); }
      ctx.fillStyle = values[i] ? COLORS.muted : COLORS.text; ctx.font = font(24, 500);
      ctx.fillText(fitText(ctx, item, W - 140), 90, y + 34);
      p.region(24, y, W - 48, rowH - 8, () => { values[i] = !values[i]; setChecklist(m, c, values); this.render(); });
    });
    const done = values.filter(Boolean).length;
    ctx.fillStyle = done === items.length ? COLORS.ok : COLORS.muted; ctx.font = font(24, 600);
    ctx.fillText(`${done}/${items.length} completados`, 30, H - 48);
    if (c.maintenance) {
      drawButton(ctx, p, {
        x: W - 444, y: H - 92, w: 420, h: 68, size: 24, active: true, disabled: done < items.length,
        label: `Registrar servicio (${hoursText(m.hourMeter)})`,
        onClick: () => this.app.actions.registerService(this.label),
      });
    }
  }

  drawPhoto(ctx, p, c, top) {
    const img = this.app.photoImage;
    const x0 = 24, y0 = top - 30, w = p.W - 48, h = p.H - y0 - 20;
    const s = Math.min(w / img.width, h / img.height);
    const iw = img.width * s, ih = img.height * s, ix = x0 + (w - iw) / 2, iy = y0 + (h - ih) / 2;
    ctx.save();
    roundRect(ctx, ix, iy, iw, ih, 14); ctx.clip();
    ctx.drawImage(img, ix, iy, iw, ih);
    ctx.restore();
    const px = ix + c.photo[0] * iw, py = iy + c.photo[1] * ih;
    const color = STATUS[this.label.status].color;
    ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.beginPath(); ctx.arc(px, py, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 5; ctx.strokeStyle = color;
    ctx.beginPath(); ctx.arc(px, py, 30, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = color; ctx.beginPath(); ctx.arc(px, py, 7, 0, Math.PI * 2); ctx.fill();
  }

  drawParts(ctx, p, c, top) {
    const W = p.W, H = p.H;
    const parts = c.parts ?? [];
    if (!parts.length) { ctx.fillStyle = COLORS.muted; ctx.font = font(26, 400); ctx.fillText('Sin repuestos cargados.', 30, top + 20); return; }
    const cols = [30, 290, W - 110];
    ctx.fillStyle = COLORS.muted; ctx.font = font(20, 700);
    ['N° DE PARTE', 'DESCRIPCIÓN', 'CANT.'].forEach((t, i) => ctx.fillText(t, cols[i], top));
    let y = top + 46;
    for (const part of parts) {
      if (y > H - 30) break;
      ctx.fillStyle = COLORS.accent; ctx.font = font(23, 700); ctx.fillText(fitText(ctx, part.pn, 240), cols[0], y);
      ctx.fillStyle = COLORS.text; ctx.font = font(23, 500); ctx.fillText(fitText(ctx, part.desc, cols[2] - cols[1] - 20), cols[1], y);
      ctx.fillText(String(part.qty ?? 1), cols[2], y);
      ctx.strokeStyle = COLORS.border; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(24, y + 18); ctx.lineTo(W - 24, y + 18); ctx.stroke();
      y += 52;
    }
  }
}

function isWarn(mi) { return mi.remaining <= mi.interval * 0.1; }
