// Foto de referencia del equipo: guardado, calibración y editor para ubicar componentes tocando la foto.

// --- Guardado de la foto (IndexedDB: las fotos no caben en localStorage) ---------
const DB_NAME = 'mant-ra', DB_STORE = 'photos';
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function savePhoto(id, blob) {
  const db = await openDb();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, 'readwrite');
    if (blob) tx.objectStore(DB_STORE).put(blob, id); else tx.objectStore(DB_STORE).delete(id);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
  });
}
export async function loadPhoto(id) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(DB_STORE).objectStore(DB_STORE).get(id);
      req.onsuccess = () => resolve(req.result ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch { return null; }
}

/** Reduce la foto (máx. 1600 px) para que ocupe poco y cargue rápido. */
async function decodeImage(file) {
  try { return await createImageBitmap(file); } catch {
    // Respaldo para navegadores/formatos donde createImageBitmap falla
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return img;
    } catch {
      throw new Error('formato de imagen no compatible (usa JPG o PNG)');
    } finally { URL.revokeObjectURL(url); }
  }
}

export async function resizeImage(file, max = 1600) {
  const bmp = await decodeImage(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * s);
  canvas.height = Math.round(bmp.height * s);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  if (!canvas.width || !canvas.height) throw new Error('la imagen está vacía');
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
}
export const blobToDataURL = (blob) => new Promise((resolve) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.readAsDataURL(blob);
});
export const dataURLToBlob = async (url) => (await fetch(url)).blob();

// --- De la foto al espacio 3D ---------------------------------------------------
export const VIEWS = {
  izq: 'Lado izquierdo del equipo',
  der: 'Lado derecho del equipo',
  frente: 'Frente del equipo',
};

export function calibSteps(view) {
  return view === 'frente'
    ? ['el extremo IZQUIERDO del equipo, a nivel del suelo', 'el extremo DERECHO del equipo', 'el punto MÁS ALTO del equipo']
    : ['el extremo DELANTERO del equipo (implemento), a nivel del suelo', 'el extremo TRASERO del equipo', 'el punto MÁS ALTO del equipo'];
}

/**
 * Convierte un punto de la foto (u, v entre 0 y 1) en coordenadas del equipo,
 * usando la calibración de 3 toques y las medidas del equipo (bounds = THREE.Box3).
 * La profundidad no se ve en una foto: se asume la cara visible del equipo.
 */
export function photoTo3D(machine, uv, bounds) {
  const cal = machine.photoCalib;
  if (!Array.isArray(cal) || cal.length < 3 || !bounds || bounds.isEmpty()) return null;
  const [p0, p1, p2] = cal;
  const [u, v] = uv;
  const clamp = (t) => Math.min(1.3, Math.max(-0.3, t));
  const div = (a, b) => (Math.abs(b) < 1e-6 ? 0 : a / b);
  const ty = clamp(div(p0[1] - v, p0[1] - p2[1]));
  const th = clamp(div(u - p0[0], p1[0] - p0[0]));
  const y = bounds.min.y + ty * (bounds.max.y - bounds.min.y);
  let x, z;
  if (machine.photoView === 'frente') {
    x = bounds.min.x + th * (bounds.max.x - bounds.min.x);
    z = bounds.max.z;
  } else {
    // +Z es el frente; +X es el lado izquierdo del equipo (derecha de quien lo mira de frente)
    z = bounds.max.z + th * (bounds.min.z - bounds.max.z);
    x = machine.photoView === 'der' ? bounds.min.x : bounds.max.x;
  }
  return [x, y, z].map((n) => Math.round(n * 1000) / 1000);
}

export function defaultLabelOffset(machine) {
  if (machine.photoView === 'frente') return [0, 0.3, 0.5];
  return [machine.photoView === 'der' ? -0.5 : 0.5, 0.3, 0];
}

// --- Editor ----------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'componente';

export class PhotoEditor {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.mode = 'idle';     // 'idle' | 'calib' | 'place' | 'add'
    this.sel = null;        // id del componente seleccionado
    this.calibTmp = [];
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => this.onChange(e));
  }

  get machine() { return this.app.machine; }

  open() {
    this.mode = 'idle';
    this.sel = null;
    this.root.hidden = false;
    document.body.classList.add('editing');
    this.render();
  }
  close() {
    this.root.hidden = true;
    document.body.classList.remove('editing');
  }
  get isOpen() { return !this.root.hidden; }

  hint() {
    const m = this.machine;
    if (this.mode === 'calib') return `Calibrar (${this.calibTmp.length + 1}/3): toca ${calibSteps(m.photoView)[this.calibTmp.length]}.`;
    if (this.mode === 'add') return 'Toca en la foto dónde está el nuevo componente.';
    if (this.sel) {
      const c = m.components.find((x) => x.id === this.sel);
      return `Toca en la foto dónde está: <b>${esc(c?.name)}</b>. Toca otra vez para corregir.`;
    }
    if (!m.photoCalib) return 'Primero <b>calibra</b>: 3 toques para marcar los extremos del equipo. Así la app ubica los carteles en 3D.';
    return 'Elige un componente de la lista y toca la foto donde está, o agrega uno nuevo.';
  }

  render() {
    const m = this.machine;
    if (!m) return;
    const url = this.app.photoUrl;
    const points = this.app.arPoints();
    let html = `<header><div><h2>Foto de referencia</h2><small>${esc(m.name)}</small></div>
      <button data-a="close">Listo</button></header>`;
    if (!url) {
      html += `<div class="pe-empty">
        <p>Toma una foto <b>de costado</b> (o de frente) donde se vea la máquina completa. Luego tocas sobre la foto dónde está cada componente.</p>
        <div class="row"><label class="button primary">📷 Tomar foto<input data-a="file" type="file" accept="image/*" capture="environment" hidden></label><label class="button">🖼️ Galería<input data-a="file" type="file" accept="image/*" hidden></label></div>
      </div>`;
    } else {
      const pins = m.components.filter((c) => Array.isArray(c.photo)).map((c) => {
        const st = this.app.labels.find((l) => l.comp === c)?.status ?? 'ok';
        return `<button data-a="sel" data-id="${esc(c.id)}" class="pin ${st} ${c.id === this.sel ? 'on' : ''}" style="left:${c.photo[0] * 100}%;top:${c.photo[1] * 100}%"><span>${esc(c.name)}</span></button>`;
      }).join('');
      const cal = (this.mode === 'calib' ? this.calibTmp : (m.photoCalib ?? []))
        .map((p, i) => `<i class="cal" style="left:${p[0] * 100}%;top:${p[1] * 100}%">${i + 1}</i>`).join('');
      html += `<div class="pe-tools">
          <select data-a="view" aria-label="Qué lado muestra la foto">${Object.entries(VIEWS).map(([k, v]) => `<option value="${k}" ${m.photoView === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <button data-a="calib" class="${this.mode === 'calib' ? 'active' : (!m.photoCalib ? 'primary' : '')}">${this.mode === 'calib' ? 'Cancelar' : 'Calibrar'}</button>
          <label class="button">📷 Nueva foto<input data-a="file" type="file" accept="image/*" capture="environment" hidden></label>
          <label class="button">🖼️ Galería<input data-a="file" type="file" accept="image/*" hidden></label>
        </div>
        <p class="pe-hint">${this.hint()}</p>
        <div class="pe-photo ${this.mode !== 'idle' || this.sel ? 'aiming' : ''}"><img data-a="photo" src="${url}" alt="Foto del equipo" draggable="false">${cal}${pins}</div>
        <div class="row"><button data-a="add" class="${this.mode === 'add' ? 'active' : ''}">+ Agregar componente</button>
          <button data-a="del" ${this.sel ? '' : 'disabled'}>Eliminar seleccionado</button></div>`;
    }
    html += `<ul class="pe-list">${m.components.map((c) => {
      const st = this.app.labels.find((l) => l.comp === c)?.status ?? 'ok';
      const src = Array.isArray(points[c.id]) ? 'ubicado en RA' : (Array.isArray(c.photo) ? (m.photoCalib ? 'en foto → 3D' : 'en foto') : 'sin ubicar');
      return `<li><button data-a="sel" data-id="${esc(c.id)}" class="${c.id === this.sel ? 'active' : ''}">
        <i class="dot ${st}"></i><span>${esc(c.name)}</span><small>${src}</small></button></li>`;
    }).join('')}</ul>
    ${m.components.length ? '' : '<p class="muted">Este equipo aún no tiene componentes. Usa “+ Agregar componente”.</p>'}`;
    this.root.innerHTML = html;
  }

  async onChange(e) {
    const a = e.target.dataset.a;
    if (a === 'file' && e.target.files[0]) {
      const hint = this.root.querySelector('.pe-hint, .pe-empty p');
      if (hint) hint.textContent = 'Cargando foto…';
      try {
        const blob = await resizeImage(e.target.files[0]);
        await this.app.actions.setPhoto(blob);
        if (!this.machine.photoView) this.machine.photoView = 'izq';
        this.machine.photoCalib = null; // foto nueva: hay que volver a calibrar
        this.app.actions.machineEdited();
        this.mode = 'idle';
      } catch (err) {
        alert(`No se pudo cargar la foto: ${err.message}`);
      }
      e.target.value = '';
      this.render();
    } else if (a === 'view') {
      this.machine.photoView = e.target.value;
      this.machine.photoCalib = null;
      this.app.actions.machineEdited();
      this.render();
    }
  }

  onClick(e) {
    const el = e.target.closest('[data-a]');
    if (!el || el.tagName === 'SELECT' || el.tagName === 'INPUT') return;
    const m = this.machine;
    switch (el.dataset.a) {
      case 'close': this.close(); break;
      case 'calib':
        this.mode = this.mode === 'calib' ? 'idle' : 'calib';
        this.calibTmp = [];
        this.sel = null;
        break;
      case 'add':
        this.mode = this.mode === 'add' ? 'idle' : 'add';
        this.sel = null;
        break;
      case 'sel':
        this.sel = this.sel === el.dataset.id ? null : el.dataset.id;
        this.mode = this.sel ? 'place' : 'idle';
        break;
      case 'del': {
        const c = m.components.find((x) => x.id === this.sel);
        if (c && confirm(`¿Eliminar "${c.name}" de este equipo?`)) {
          m.components = m.components.filter((x) => x !== c);
          this.sel = null;
          this.mode = 'idle';
          this.app.actions.machineEdited({ rebuild: true });
        }
        break;
      }
      case 'photo': this.onPhotoTap(e, el); return;
      default: return;
    }
    this.render();
  }

  onPhotoTap(e, img) {
    const r = img.getBoundingClientRect();
    const uv = [(e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height].map((n) => Math.round(Math.min(1, Math.max(0, n)) * 10000) / 10000);
    const m = this.machine;
    if (this.mode === 'calib') {
      this.calibTmp.push(uv);
      if (this.calibTmp.length === 3) {
        m.photoCalib = this.calibTmp;
        this.calibTmp = [];
        this.mode = 'idle';
        this.app.actions.machineEdited();
      }
    } else if (this.mode === 'add') {
      const name = prompt('Nombre del componente (ej. "Filtro hidráulico"):');
      if (name?.trim()) {
        const system = prompt('Sistema (opcional, ej. "Hidráulico"):') ?? '';
        let id = slug(name);
        while (m.components.some((c) => c.id === id)) id += '-2';
        m.components.push({
          id, name: name.trim(), system: system.trim() || undefined, photo: uv,
          position: null, labelOffset: defaultLabelOffset(m), specs: {},
        });
        this.sel = id;
        this.mode = 'place';
        this.app.actions.machineEdited({ rebuild: true });
      }
    } else if (this.sel) {
      const c = m.components.find((x) => x.id === this.sel);
      if (c) { c.photo = uv; this.app.actions.machineEdited(); }
    }
    this.render();
  }
}
