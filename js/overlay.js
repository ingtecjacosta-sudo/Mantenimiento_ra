// Interfaz táctil para el modo celular (AR con la cámara del teléfono).
// Se muestra encima de la cámara mediante WebXR DOM Overlay.
import { STATUS } from './panel.js';
import { maintenanceInfo, hoursText, getChecklist, setChecklist } from './data.js';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

export class ArOverlay {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.top = root.querySelector('#arTop');
    this.bottom = root.querySelector('#arBottom');
    this.toastEl = root.querySelector('#arToast');
    this.sheet = root.querySelector('#arSheet');
    this.label = null;
    this.tab = 'resumen';
    this.step = 0;
    this.toastTimer = null;

    // Los toques sobre la interfaz no deben llegar a la escena AR como "select".
    root.addEventListener('beforexrselect', (e) => { if (e.target.closest('.ui')) e.preventDefault(); });
    root.addEventListener('click', (e) => {
      const el = e.target.closest('[data-act]');
      if (el && !el.disabled) this.onAction(el.dataset.act, el.dataset.arg);
    });
  }

  toast(text, seconds = 3, color = '#ffb000') {
    this.toastEl.textContent = text;
    this.toastEl.style.borderColor = color;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), seconds * 1000);
  }

  onAction(act, arg) {
    const a = this.app.actions;
    switch (act) {
      case 'close': this.closeSheet(); break;
      case 'tab': this.tab = arg; this.renderSheet(); break;
      case 'step': this.step += Number(arg); this.renderSheet(); break;
      case 'check': {
        const c = this.label.comp, m = this.app.machine;
        const v = getChecklist(m, c); v[Number(arg)] = !v[Number(arg)];
        setChecklist(m, c, v); this.renderSheet(); break;
      }
      case 'service': a.registerService(this.label); break;
      case 'rotate': a.rotate(Number(arg)); break;
      case 'registerStep': a.registerStep(Number(arg)); break;
      default: a[act]?.(); break;
    }
    this.render();
  }

  openSheet(label) {
    this.label = label;
    this.tab = 'resumen';
    this.step = 0;
    this.sheet.hidden = false;
    document.body.classList.add('sheet-open');
    this.renderSheet();
  }
  closeSheet() {
    this.sheet.hidden = true;
    document.body.classList.remove('sheet-open');
    if (this.label) this.label.highlight = false;
    this.label = null;
  }
  get sheetOpen() { return !!this.label; }

  render() {
    const { state, machine, labels } = this.app;
    if (!machine) return;
    const alerts = labels.filter((l) => l.status !== 'ok').length;
    this.top.innerHTML = `<div class="ar-title"><b>${esc(machine.name)}</b>
      <span>${hoursText(machine.hourMeter)} · <em class="${alerts ? 'warn' : 'ok'}">${alerts ? `${alerts} con alerta` : 'sin alertas'}</em></span></div>
      <button data-act="exitXR">Salir</button>`;

    const b = (act, label, { arg = '', cls = '', disabled = false } = {}) =>
      `<button data-act="${act}" data-arg="${esc(arg)}" class="${cls}" ${disabled ? 'disabled' : ''}>${label}</button>`;

    if (state.mode === 'place') {
      this.bottom.innerHTML = `<p>Apunta la <b>mira</b> a ${esc(machine.reference?.description ?? 'el centro del equipo, en el suelo')} y toca <b>Ubicar aquí</b>.
        Mueve el celular despacio para que detecte el suelo.</p>
        <div class="ar-row">${b('rotate', '⟲ 5°', { arg: 5 })}${b('placeHere', 'Ubicar aquí', { cls: 'primary' })}${b('rotate', '⟳ 5°', { arg: -5 })}</div>
        ${state.placed ? `<div class="ar-row">${b('cancelPlace', 'Cancelar')}</div>` : ''}`;
    } else if (state.mode === 'register') {
      const comps = machine.components, comp = comps[state.registerIndex];
      const done = comps.filter((c) => Array.isArray(c.position)).length;
      const has = Array.isArray(comp?.position);
      this.bottom.innerHTML = `<p class="ar-reg">Registrar ${state.registerIndex + 1}/${comps.length} · ${done} listos<br>
        <b>${esc(comp?.name)}</b> <em class="${has ? 'ok' : ''}">${has ? '✔ registrado' : 'sin registrar'}</em></p>
        <p>Apunta la mira a la pieza (o acerca el celular a ella) y toca <b>Marcar</b>.</p>
        <div class="ar-row">${b('registerStep', '◀', { arg: -1 })}${b('markPoint', 'Marcar', { cls: 'primary' })}${b('registerStep', '▶', { arg: 1 })}</div>
        <div class="ar-row">${b('clearPoint', 'Borrar punto', { disabled: !has })}${b('finishRegister', 'Terminar')}</div>`;
    } else {
      this.bottom.innerHTML = `<p>Mira las piezas con la cámara: aparecen sus carteles. <b>Toca un cartel</b> para ver la ficha.</p>
        <div class="ar-row">${b('startPlace', 'Ubicar equipo')}${b('startRegister', 'Registrar puntos')}</div>
        <div class="ar-row">
          ${b('toggleShowAll', `Carteles: ${state.showAll ? 'Todos' : 'Auto'}`, { cls: state.showAll ? 'active' : '' })}
          ${b('toggleAlertsOnly', `Ver: ${state.alertsOnly ? 'Alertas' : 'Todo'}`, { cls: state.alertsOnly ? 'active' : '' })}
        </div>
        <div class="ar-row">${b('rotate', '⟲ 2°', { arg: 2, disabled: !state.placed })}${b('toggleGuide', `Guía 3D: ${state.showGuide ? 'Sí' : 'No'}`, { cls: state.showGuide ? 'active' : '' })}${b('rotate', '⟳ 2°', { arg: -2, disabled: !state.placed })}</div>`;
    }
    if (this.label) this.renderSheet();
  }

  renderSheet() {
    if (!this.label) return;
    const label = this.label, c = label.comp, m = this.app.machine;
    const st = STATUS[label.status];
    const tabs = [['resumen', 'Resumen'], ['proc', 'Pasos'], ['check', 'Checklist'], ['parts', 'Repuestos']];
    if (this.app.photoUrl && Array.isArray(c.photo)) tabs.push(['foto', 'Foto']);
    else if (this.tab === 'foto') this.tab = 'resumen';
    let body = '';
    if (this.tab === 'resumen') {
      const mi = maintenanceInfo(c, m);
      const color = mi && (mi.remaining < 0 ? 'crit' : (mi.remaining <= mi.interval * 0.1 ? 'warn' : 'ok'));
      body += (c.alerts ?? []).map((a) => `<p class="crit">● ${esc(a)}</p>`).join('');
      if (mi) {
        body += `<h4>Mantenimiento</h4><p><b>${esc(mi.task)}</b><br><small>Cada ${hoursText(mi.interval)} · último a las ${hoursText(mi.last)}</small></p>
          <p class="${color}"><b>${mi.remaining < 0 ? `VENCIDO hace ${hoursText(-mi.remaining)}` : `Próximo: ${hoursText(mi.due)} (en ${hoursText(mi.remaining)})`}</b></p>
          <div class="bar"><i class="${color}" style="width:${Math.round(mi.progress * 100)}%"></i></div>`;
      }
      const specs = Object.entries(c.specs ?? {});
      if (specs.length) body += `<h4>Especificaciones</h4><dl>${specs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
      if (c.description) body += `<p>${esc(c.description)}</p>`;
      if (c.safety?.length) body += `<h4 class="warn">Seguridad</h4>${c.safety.map((s) => `<p>⚠ ${esc(s)}</p>`).join('')}`;
    } else if (this.tab === 'proc') {
      const steps = c.procedure ?? [];
      if (!steps.length) body = '<p class="muted">Sin procedimiento cargado.</p>';
      else {
        this.step = Math.max(0, Math.min(this.step, steps.length - 1));
        const last = this.step === steps.length - 1;
        body = `<h4>Paso ${this.step + 1} de ${steps.length}</h4>
          <p class="step ${/^⚠/.test(steps[this.step]) ? 'warn' : ''}">${esc(steps[this.step])}</p>
          <div class="dots">${steps.map((_, i) => `<i class="${i === this.step ? 'on' : ''}"></i>`).join('')}</div>
          <div class="ar-row"><button data-act="step" data-arg="-1" ${this.step === 0 ? 'disabled' : ''}>◀ Anterior</button>
          ${last ? '<button data-act="tab" data-arg="check" class="primary">Checklist ▶</button>' : '<button data-act="step" data-arg="1" class="primary">Siguiente ▶</button>'}</div>`;
      }
    } else if (this.tab === 'check') {
      const items = c.checklist ?? [];
      if (!items.length) body = '<p class="muted">Sin checklist.</p>';
      else {
        const v = getChecklist(m, c), done = v.filter(Boolean).length;
        body = `<ul class="check">${items.map((t, i) => `<li data-act="check" data-arg="${i}" class="${v[i] ? 'on' : ''}"><span></span>${esc(t)}</li>`).join('')}</ul>
          <p class="${done === items.length ? 'ok' : 'muted'}">${done}/${items.length} completados</p>
          ${c.maintenance ? `<button data-act="service" class="primary wide" ${done < items.length ? 'disabled' : ''}>Registrar servicio (${hoursText(m.hourMeter)})</button>` : ''}`;
      }
    } else if (this.tab === 'foto') {
      body = `<div class="sheet-photo"><img src="${this.app.photoUrl}" alt="Foto del equipo"><i class="${label.status}" style="left:${c.photo[0] * 100}%;top:${c.photo[1] * 100}%"></i></div>`;
    } else {
      const parts = c.parts ?? [];
      body = parts.length
        ? `<table><tr><th>N° parte</th><th>Descripción</th><th>Cant.</th></tr>${parts.map((p) => `<tr><td><b>${esc(p.pn)}</b></td><td>${esc(p.desc)}</td><td>${esc(p.qty ?? 1)}</td></tr>`).join('')}</table>`
        : '<p class="muted">Sin repuestos cargados.</p>';
    }
    this.sheet.style.borderTopColor = st.color;
    this.sheet.innerHTML = `<header><div><h3>${esc(c.name)}</h3><small>${esc(c.system ?? '')} · <b style="color:${st.color}">${st.label}</b></small></div>
      <button data-act="close" aria-label="Cerrar">✕</button></header>
      <nav>${tabs.map(([id, n]) => `<button data-act="tab" data-arg="${id}" class="${this.tab === id ? 'active' : ''}">${n}</button>`).join('')}</nav>
      <div class="sheet-body">${body}</div>`;
  }
}
