// Cartel flotante de un componente: marcador sobre la pieza + línea guía + panel.
// Tiene dos niveles: "compacto" (nombre y estado) y "detalle" (cuando lo miras directamente).
import * as THREE from 'three';
import { CanvasPanel, COLORS, STATUS, font, fitText, roundRect, drawWrapped } from './panel.js';
import { maintenanceInfo, statusOf, hoursText } from './data.js';

const COMPACT = [0.38, 0.075];
const DETAIL = [0.56, 0.34];

export class ComponentLabel {
  constructor(comp, machine) {
    this.comp = comp;
    this.machine = machine;
    this.group = new THREE.Group();
    this.group.name = `label:${comp.id}`;

    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 16, 12),
      new THREE.MeshBasicMaterial({ transparent: true, depthTest: false }),
    );
    this.marker.renderOrder = 10;
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.065, 32),
      new THREE.MeshBasicMaterial({ transparent: true, side: THREE.DoubleSide, depthTest: false }),
    );
    this.ring.renderOrder = 10;
    // Esfera invisible más grande para que sea fácil apuntarle.
    this.hitSphere = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    this.hitSphere.userData.label = this;

    this.holder = new THREE.Group();
    this.compact = new CanvasPanel(...COMPACT, { name: 'compact' });
    this.detail = new CanvasPanel(...DETAIL, { name: 'detail' });
    for (const p of [this.compact, this.detail]) {
      p.mesh.userData.label = this;
      p.mesh.renderOrder = 20;
      p.mesh.visible = false;
      p.setOpacity(0);
      this.holder.add(p.mesh);
    }

    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineBasicMaterial({ transparent: true, opacity: 0, depthTest: false }),
    );
    this.line.renderOrder = 9;
    this.line.frustumCulled = false;

    this.group.add(this.marker, this.ring, this.hitSphere, this.holder, this.line);
    this.offset = new THREE.Vector3().fromArray(comp.labelOffset ?? [0, 0.35, 0]);
    this.op = { compact: 0, detail: 0 };
    this.state = 'hidden';
    this.t = Math.random() * 10;
    this.highlight = false;

    this.redraw();
    this.setPosition(comp.position);
  }

  get hasPosition() { return Array.isArray(this.comp.position); }

  setPosition(p) {
    this.comp.position = p ?? null;
    this.group.visible = this.hasPosition;
    if (this.hasPosition) {
      this.marker.position.fromArray(p);
      this.ring.position.copy(this.marker.position);
      this.hitSphere.position.copy(this.marker.position);
    }
  }

  worldPosition(target) { return this.marker.getWorldPosition(target); }

  redraw() {
    this.status = statusOf(this.comp, this.machine);
    const color = new THREE.Color(STATUS[this.status].color);
    this.marker.material.color.copy(color);
    this.ring.material.color.copy(color);
    this.line.material.color.copy(color);
    this.drawCompact();
    this.drawDetail();
  }

  drawCompact() {
    const c = this.comp, st = STATUS[this.status];
    const mi = maintenanceInfo(c, this.machine);
    this.compact.draw((ctx, p) => {
      roundRect(ctx, 2, 2, p.W - 4, p.H - 4, 18);
      ctx.fillStyle = COLORS.bg; ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = st.color; ctx.stroke();
      ctx.fillStyle = st.color;
      ctx.beginPath(); ctx.arc(34, p.H / 2, 11, 0, Math.PI * 2); ctx.fill();
      let right = '';
      if (this.status !== 'ok') right = mi && mi.remaining < 0 ? 'VENCIDO' : st.label;
      ctx.font = font(20, 700);
      const rw = right ? ctx.measureText(right).width + 16 : 0;
      if (right) { ctx.fillStyle = st.color; ctx.fillText(right, p.W - rw, p.H / 2 + 7); }
      ctx.fillStyle = COLORS.text; ctx.font = font(28, 700);
      ctx.fillText(fitText(ctx, c.name, p.W - 70 - rw), 56, p.H / 2 + 10);
    });
  }

  drawDetail() {
    const c = this.comp, m = this.machine, st = STATUS[this.status];
    const mi = maintenanceInfo(c, m);
    this.detail.draw((ctx, p) => {
      const W = p.W, H = p.H;
      roundRect(ctx, 2, 2, W - 4, H - 4, 22);
      ctx.fillStyle = COLORS.bg; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = st.color; ctx.stroke();
      // Encabezado
      ctx.fillStyle = st.color; roundRect(ctx, 22, 22, 10, 62, 5); ctx.fill();
      ctx.fillStyle = COLORS.text; ctx.font = font(34, 700);
      ctx.fillText(fitText(ctx, c.name, W - 70), 46, 54);
      ctx.font = font(21, 500); ctx.fillStyle = COLORS.muted;
      const sys = c.system ? `${c.system} · ` : '';
      ctx.fillText(sys, 46, 82);
      ctx.fillStyle = st.color; ctx.font = font(21, 700);
      ctx.fillText(st.label, 46 + ctx.measureText(sys).width + 2, 82);

      let y = 122;
      // Alertas abiertas
      for (const a of (c.alerts ?? []).slice(0, 2)) {
        ctx.fillStyle = COLORS.crit; ctx.font = font(22, 600);
        ctx.fillText(fitText(ctx, `● ${a}`, W - 50), 24, y); y += 32;
      }
      // Mantenimiento
      if (mi) {
        ctx.fillStyle = COLORS.muted; ctx.font = font(20, 500);
        ctx.fillText(fitText(ctx, mi.task, W - 50), 24, y); y += 30;
        const txt = mi.remaining < 0 ? `Vencido hace ${hoursText(-mi.remaining)}` : `Próximo servicio en ${hoursText(mi.remaining)}`;
        ctx.fillStyle = mi.remaining < 0 ? COLORS.crit : (this.status === 'warn' ? COLORS.warn : COLORS.text);
        ctx.font = font(24, 700); ctx.fillText(txt, 24, y); y += 14;
        roundRect(ctx, 24, y, W - 48, 12, 6); ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fill();
        roundRect(ctx, 24, y, Math.max(12, (W - 48) * mi.progress), 12, 6);
        ctx.fillStyle = mi.remaining < 0 ? COLORS.crit : (mi.progress > 0.9 ? COLORS.warn : COLORS.ok); ctx.fill();
        y += 44;
      }
      // Especificaciones clave
      const specs = Object.entries(c.specs ?? {}).slice(0, 3);
      for (const [k, v] of specs) {
        if (y > H - 50) break;
        ctx.font = font(20, 500); ctx.fillStyle = COLORS.muted;
        const kw = Math.min(200, ctx.measureText(`${k}:`).width + 10);
        ctx.fillText(fitText(ctx, `${k}:`, 200), 24, y);
        ctx.font = font(22, 600); ctx.fillStyle = COLORS.text;
        ctx.fillText(fitText(ctx, v, W - 60 - kw), 24 + kw, y);
        y += 32;
      }
      if (!specs.length && c.description) {
        ctx.font = font(21, 400); ctx.fillStyle = COLORS.text;
        drawWrapped(ctx, c.description, 24, y, W - 48, 28, H - 50);
      }
      ctx.font = font(18, 500); ctx.fillStyle = COLORS.accent;
      ctx.fillText('Gatillo / pellizco: abrir ficha completa', 24, H - 20);
    });
  }

  /**
   * @param state 'hidden' | 'compact' | 'detail'
   * @param scale tamaño según distancia, para que el texto se lea igual de cerca y de lejos
   */
  update(dt, camPos, state, scale) {
    this.state = state;
    this.t += dt;
    const k = 1 - Math.exp(-dt * 10);
    this.op.compact += ((state === 'compact' ? 1 : 0) - this.op.compact) * k;
    this.op.detail += ((state === 'detail' ? 1 : 0) - this.op.detail) * k;
    for (const key of ['compact', 'detail']) {
      const panel = this[key];
      panel.mesh.visible = this.op[key] > 0.02;
      panel.setOpacity(this.op[key]);
    }
    const shown = Math.max(this.op.compact, this.op.detail);

    const pulse = this.status === 'ok' ? 0 : 0.25 * (0.5 + 0.5 * Math.sin(this.t * (this.status === 'crit' ? 6 : 3)));
    const ms = Math.max(1, scale * 0.6) * (this.highlight ? 1.6 : 1);
    this.marker.scale.setScalar(ms);
    this.ring.scale.setScalar(ms * (1 + pulse));
    this.marker.material.opacity = 0.55 + 0.45 * Math.max(shown, this.status === 'ok' ? 0 : 0.6);
    this.ring.material.opacity = 0.35 + 0.5 * shown + pulse;
    this.ring.lookAt(camPos);

    this.holder.position.copy(this.marker.position).addScaledVector(this.offset, 0.6 + 0.4 * scale);
    this.holder.scale.setScalar(scale);
    this.holder.lookAt(camPos);

    // Línea guía desde la pieza hasta el borde inferior del cartel
    const h = (this.op.detail > this.op.compact ? DETAIL[1] : COMPACT[1]) * scale;
    const pos = this.line.geometry.attributes.position;
    pos.setXYZ(0, this.marker.position.x, this.marker.position.y, this.marker.position.z);
    pos.setXYZ(1, this.holder.position.x, this.holder.position.y - h / 2, this.holder.position.z);
    pos.needsUpdate = true;
    this.line.material.opacity = 0.85 * shown;
    this.line.visible = shown > 0.02;
  }

  dispose() {
    this.compact.dispose();
    this.detail.dispose();
    for (const o of [this.marker, this.ring, this.hitSphere, this.line]) { o.geometry.dispose(); o.material.dispose(); }
  }
}
