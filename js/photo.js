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

/**
 * Distancia focal equivalente a 35 mm guardada por la cámara (EXIF 0xA405).
 * Sirve para conocer el ángulo de visión real y corregir la perspectiva. null si no la hay.
 */
export async function readFocal35(file) {
  try {
    const dv = new DataView(await file.slice(0, 256 * 1024).arrayBuffer());
    if (dv.getUint16(0) !== 0xFFD8) return null; // no es JPEG
    let off = 2;
    while (off < dv.byteLength - 10) {
      const marker = dv.getUint16(off), len = dv.getUint16(off + 2);
      if ((marker & 0xFF00) !== 0xFF00) break;
      if (marker === 0xFFE1 && dv.getUint32(off + 4) === 0x45786966) { // "Exif"
        const tiff = off + 10, le = dv.getUint16(tiff) === 0x4949;
        const u16 = (o) => dv.getUint16(o, le), u32 = (o) => dv.getUint32(o, le);
        const findTag = (ifd, tag) => { const n = u16(ifd); for (let i = 0; i < n; i++) { const e = ifd + 2 + i * 12; if (u16(e) === tag) return e; } return null; };
        const exifPtr = findTag(tiff + u32(tiff + 4), 0x8769);
        if (!exifPtr) return null;
        const e35 = findTag(tiff + u32(exifPtr + 8), 0xA405);
        const v = e35 ? u16(e35 + 8) : 0;
        return v >= 8 && v <= 600 ? v : null;
      }
      off += 2 + len;
    }
  } catch { /* EXIF ilegible */ }
  return null;
}

/** Devuelve { blob, width, height } con la foto reducida. */
export async function resizeImage(file, max = 1600) {
  const bmp = await decodeImage(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * s);
  canvas.height = Math.round(bmp.height * s);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  if (!canvas.width || !canvas.height) throw new Error('la imagen está vacía');
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  return { blob, width: canvas.width, height: canvas.height };
}
export const blobToDataURL = (blob) => new Promise((resolve) => {
  const fr = new FileReader();
  fr.onload = () => resolve(fr.result);
  fr.readAsDataURL(blob);
});
export const dataURLToBlob = async (url) => (await fetch(url)).blob();

// --- Vistas del equipo ----------------------------------------------------------
// Coordenadas del equipo: +Z = frente (implemento), +Y = arriba,
// +X = lado izquierdo del equipo (a la derecha de quien lo mira de frente).
export const VIEWS = { izq: 'Izquierdo', frente: 'Frente', der: 'Derecho', atras: 'Atrás' };
const VIEW_HELP = {
  izq: 'Foto del costado IZQUIERDO (el lado izquierdo del operador sentado mirando hacia adelante).',
  frente: 'Foto de FRENTE (desde el lado del implemento / cucharón).',
  der: 'Foto del costado DERECHO (el lado derecho del operador).',
  atras: 'Foto desde ATRÁS (lado del contrapeso / motor).',
};
const isSide = (view) => view === 'izq' || view === 'der';
export const photoKey = (machineId, view) => `${machineId}:${view}`;

export function calibSteps(view) {
  return isSide(view)
    ? ['el extremo DELANTERO del equipo, a nivel del suelo', 'el extremo TRASERO del equipo', 'el punto MÁS ALTO del equipo']
    : ['el extremo IZQUIERDO del equipo en la foto, a nivel del suelo', 'el extremo DERECHO del equipo en la foto', 'el punto MÁS ALTO del equipo'];
}

/** Lo que una sola foto dice de un punto: altura y una coordenada horizontal (la profundidad no se ve). */
function viewEstimate(view, calib, uv, b) {
  const [p0, p1, p2] = calib;
  const [u, v] = uv;
  const clamp = (t) => Math.min(1.3, Math.max(-0.3, t));
  const div = (a, c) => (Math.abs(c) < 1e-6 ? 0 : a / c);
  const ty = clamp(div(p0[1] - v, p0[1] - p2[1]));
  const th = clamp(div(u - p0[0], p1[0] - p0[0]));
  const y = b.min.y + ty * (b.max.y - b.min.y);
  if (isSide(view)) return { y, z: b.max.z + th * (b.min.z - b.max.z), faceX: view === 'izq' ? b.max.x : b.min.x };
  if (view === 'frente') return { y, x: b.min.x + th * (b.max.x - b.min.x), faceZ: b.max.z };
  return { y, x: b.max.x - th * (b.max.x - b.min.x), faceZ: b.min.z }; // atrás: la izquierda de la foto es +X
}

const DEFAULT_F35 = 26; // cámara principal típica de un celular (si la foto no trae EXIF)

/** Distancia aproximada de la cámara al plano calibrado, a partir del ángulo de visión y del tamaño real del equipo. */
function cameraDistance(view, pv, b) {
  if (!pv?.aspect || !Array.isArray(pv.calib)) return null;
  const tanHalfDiag = 43.27 / (2 * (pv.f35 || DEFAULT_F35)); // diagonal del cuadro de 35 mm
  const tanHalfW = tanHalfDiag * pv.aspect / Math.hypot(pv.aspect, 1);
  const du = Math.abs(pv.calib[1][0] - pv.calib[0][0]);
  if (du < 0.02) return null;
  const span = isSide(view) ? b.max.z - b.min.z : b.max.x - b.min.x;
  return span / (du * 2 * tanHalfW);
}

/** Cuánto más lejos de la cámara que la cara visible está el punto (lo da otra vista). */
function depthBehindFace(view, x, z, b) {
  if (view === 'izq') return b.max.x - x;
  if (view === 'der') return x - b.min.x;
  if (view === 'frente') return b.max.z - z;
  return z - b.min.z;
}

function combine(est) {
  const avg = (a) => a.reduce((s, n) => s + n, 0) / a.length;
  const xs = est.filter((e) => e.x !== undefined).map((e) => e.x);
  const zs = est.filter((e) => e.z !== undefined).map((e) => e.z);
  return {
    x: xs.length ? avg(xs) : avg(est.map((e) => e.faceX)),
    z: zs.length ? avg(zs) : avg(est.map((e) => e.faceZ)),
    y: avg(est.map((e) => e.y)),
    full: xs.length > 0 && zs.length > 0,
  };
}

/**
 * Posición 3D de un componente combinando todas las fotos donde está marcado.
 * Costado → largo (Z) y altura; frente/atrás → ancho (X) y altura.
 * Con al menos una de cada tipo la posición es completa y además se corrige la perspectiva
 * (lo que está más lejos de la cámara se ve más chico). Con una sola foto se asume la cara visible.
 */
export function componentFromPhotos(machine, comp, bounds) {
  if (!bounds || bounds.isEmpty()) return null;
  const entries = [];
  for (const view of Object.keys(VIEWS)) {
    const uv = comp.photos?.[view];
    const pv = machine.photos?.[view];
    if (Array.isArray(uv) && Array.isArray(pv?.calib) && pv.calib.length === 3) {
      entries.push({ view, uv, pv, d: cameraDistance(view, pv, bounds) });
    }
  }
  if (!entries.length) return null;
  let uvs = entries.map((e) => e.uv);
  let r;
  for (let it = 0; it < 5; it++) {
    r = combine(entries.map((e, i) => viewEstimate(e.view, e.pv.calib, uvs[i], bounds)));
    if (!r.full) break; // sin vista cruzada no se conoce la profundidad
    uvs = entries.map((e) => {
      if (!e.d) return e.uv;
      const k = (e.d + Math.max(0, depthBehindFace(e.view, r.x, r.z, bounds))) / e.d;
      return [0.5 + (e.uv[0] - 0.5) * k, 0.5 + (e.uv[1] - 0.5) * k];
    });
  }
  return { position: [r.x, r.y, r.z].map((n) => Math.round(n * 1000) / 1000), full: r.full, views: entries.length };
}

export function defaultLabelOffset(view) {
  if (view === 'frente') return [0, 0.3, 0.5];
  if (view === 'atras') return [0, 0.3, -0.5];
  return [view === 'der' ? -0.5 : 0.5, 0.3, 0];
}

/** Convierte equipos guardados con el formato de una sola foto. Devuelve la vista migrada (o null). */
export function migratePhotos(machine) {
  machine.photos ??= {};
  if (!machine.photoView && !machine.photoCalib) return null;
  const view = machine.photoView || 'izq';
  machine.photos[view] ??= { calib: machine.photoCalib ?? null };
  for (const c of machine.components) {
    if (Array.isArray(c.photo)) { c.photos = { ...(c.photos ?? {}), [view]: c.photo }; }
    delete c.photo;
  }
  delete machine.photoView;
  delete machine.photoCalib;
  return view;
}

/** La primera vista con foto donde el componente está marcado (para la ficha). */
export function bestViewFor(app, comp) {
  return Object.keys(VIEWS).find((v) => app.photoUrls[v] && Array.isArray(comp.photos?.[v])) ?? null;
}

// --- Editor ----------------------------------------------------------------------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'componente';

export class PhotoEditor {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.view = 'izq';
    this.mode = 'idle';     // 'idle' | 'calib' | 'place' | 'add'
    this.sel = null;        // id del componente seleccionado
    this.calibTmp = [];
    root.addEventListener('click', (e) => this.onClick(e));
    root.addEventListener('change', (e) => this.onChange(e));
  }

  get machine() { return this.app.machine; }
  get viewData() { return this.machine.photos?.[this.view]; }

  open() {
    this.mode = 'idle';
    this.sel = null;
    this.view = Object.keys(VIEWS).find((v) => this.app.photoUrls[v]) ?? 'izq';
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
    if (this.mode === 'calib') return `Calibrar (${this.calibTmp.length + 1}/3): toca ${calibSteps(this.view)[this.calibTmp.length]}.`;
    if (this.mode === 'add') return 'Toca en la foto dónde está el nuevo componente.';
    if (this.sel) {
      const c = m.components.find((x) => x.id === this.sel);
      return `Toca en esta foto dónde está: <b>${esc(c?.name)}</b>. Márcalo también en otra vista (costado + frente o atrás) para ubicarlo en 3D completo.`;
    }
    if (!this.viewData?.calib) return 'Primero <b>calibra</b> esta foto: 3 toques en los extremos del equipo.';
    return 'Elige un componente de la lista y toca la foto donde está. Con 2 vistas (un costado y frente o atrás) la ubicación es mucho más precisa.';
  }

  render() {
    const m = this.machine;
    if (!m) return;
    const url = this.app.photoUrls[this.view];
    const points = this.app.arPoints();
    const bounds = this.app.bounds();
    const tabs = Object.entries(VIEWS).map(([v, name]) => {
      const has = !!this.app.photoUrls[v], cal = !!m.photos?.[v]?.calib;
      const mark = has ? (cal ? '✔' : '●') : '';
      return `<button data-a="tab" data-v="${v}" class="${v === this.view ? 'active' : ''}">${name}${mark ? ` <b class="${cal ? 'ok' : 'warn'}">${mark}</b>` : ''}</button>`;
    }).join('');
    let html = `<header><div><h2>Fotos de referencia</h2><small>${esc(m.name)}</small></div>
      <button data-a="close">Listo</button></header>
      <nav class="pe-views">${tabs}</nav>`;
    if (!url) {
      html += `<div class="pe-empty">
        <p>${VIEW_HELP[this.view]} Que se vea la máquina completa, desde unos metros y a media altura.</p>
        <div class="row"><label class="button primary">📷 Tomar foto<input data-a="file" type="file" accept="image/*" capture="environment" hidden></label>
        <label class="button">🖼️ Galería<input data-a="file" type="file" accept="image/*" hidden></label></div>
      </div>`;
    } else {
      const pins = m.components.filter((c) => Array.isArray(c.photos?.[this.view])).map((c) => {
        const st = this.app.labels.find((l) => l.comp === c)?.status ?? 'ok';
        const [u, v] = c.photos[this.view];
        return `<button data-a="sel" data-id="${esc(c.id)}" class="pin ${st} ${c.id === this.sel ? 'on' : ''}" style="left:${u * 100}%;top:${v * 100}%"><span>${esc(c.name)}</span></button>`;
      }).join('');
      const cal = (this.mode === 'calib' ? this.calibTmp : (this.viewData?.calib ?? []))
        .map((p, i) => `<i class="cal" style="left:${p[0] * 100}%;top:${p[1] * 100}%">${i + 1}</i>`).join('');
      const selMarked = this.sel && Array.isArray(m.components.find((c) => c.id === this.sel)?.photos?.[this.view]);
      html += `<div class="pe-tools">
          <button data-a="calib" class="${this.mode === 'calib' ? 'active' : (!this.viewData?.calib ? 'primary' : '')}">${this.mode === 'calib' ? 'Cancelar' : 'Calibrar'}</button>
          <label class="button">📷 Nueva<input data-a="file" type="file" accept="image/*" capture="environment" hidden></label>
          <label class="button">🖼️ Galería<input data-a="file" type="file" accept="image/*" hidden></label>
          <button data-a="removePhoto" aria-label="Quitar esta foto">🗑</button>
        </div>
        <p class="pe-hint">${this.hint()}</p>
        <div class="pe-photo ${this.mode !== 'idle' || this.sel ? 'aiming' : ''}"><img data-a="photo" src="${url}" alt="Foto ${VIEWS[this.view]}" draggable="false">${cal}${pins}</div>
        <div class="row"><button data-a="add" class="${this.mode === 'add' ? 'active' : ''}">+ Agregar componente</button>
          ${selMarked ? '<button data-a="unmark">Quitar marca aquí</button>' : ''}
          <button data-a="del" ${this.sel ? '' : 'disabled'}>Eliminar componente</button></div>`;
    }
    html += `<ul class="pe-list">${m.components.map((c) => {
      const st = this.app.labels.find((l) => l.comp === c)?.status ?? 'ok';
      const marks = Object.entries(VIEWS).map(([v, n]) => `<i class="${Array.isArray(c.photos?.[v]) ? 'on' : ''}" title="${n}">${n[0]}</i>`).join('');
      let src = 'sin ubicar';
      if (Array.isArray(points[c.id])) src = 'ubicado en RA';
      else {
        const r = componentFromPhotos(m, c, bounds);
        if (r) src = r.full ? '3D completo ✔' : 'aproximado';
        else if (c.photos && Object.keys(c.photos).length) src = 'falta calibrar';
      }
      return `<li><button data-a="sel" data-id="${esc(c.id)}" class="${c.id === this.sel ? 'active' : ''}">
        <i class="dot ${st}"></i><span>${esc(c.name)}</span><em class="marks">${marks}</em><small>${src}</small></button></li>`;
    }).join('')}</ul>
    ${m.components.length ? '' : '<p class="muted">Este equipo aún no tiene componentes. Usa “+ Agregar componente”.</p>'}`;
    this.root.innerHTML = html;
  }

  async onChange(e) {
    if (e.target.dataset.a !== 'file' || !e.target.files[0]) return;
    const view = this.view;
    const hint = this.root.querySelector('.pe-hint, .pe-empty p');
    if (hint) hint.textContent = 'Cargando foto…';
    try {
      const file = e.target.files[0];
      const [{ blob, width, height }, f35] = await Promise.all([resizeImage(file), readFocal35(file)]);
      await this.app.actions.setPhoto(view, blob);
      this.machine.photos ??= {};
      // Foto nueva: hay que volver a calibrar. f35 y aspect sirven para corregir la perspectiva.
      this.machine.photos[view] = { calib: null, f35, aspect: Math.round((width / height) * 1e4) / 1e4 };
      this.app.actions.machineEdited();
      this.mode = 'idle';
    } catch (err) {
      alert(`No se pudo cargar la foto: ${err.message}`);
    }
    e.target.value = '';
    this.render();
  }

  async onClick(e) {
    const el = e.target.closest('[data-a]');
    if (!el || el.tagName === 'INPUT') return;
    const m = this.machine;
    switch (el.dataset.a) {
      case 'close': this.close(); return;
      case 'tab':
        this.view = el.dataset.v;
        this.mode = this.sel ? 'place' : 'idle';
        this.calibTmp = [];
        break;
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
      case 'unmark': {
        const c = m.components.find((x) => x.id === this.sel);
        if (c?.photos) { delete c.photos[this.view]; this.app.actions.machineEdited(); }
        break;
      }
      case 'removePhoto':
        if (!confirm(`¿Quitar la foto "${VIEWS[this.view]}" y sus marcas?`)) return;
        await this.app.actions.setPhoto(this.view, null);
        delete m.photos?.[this.view];
        for (const c of m.components) if (c.photos) delete c.photos[this.view];
        this.mode = 'idle';
        this.app.actions.machineEdited();
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
    m.photos ??= {};
    m.photos[this.view] ??= { calib: null };
    if (this.mode === 'calib') {
      this.calibTmp.push(uv);
      if (this.calibTmp.length === 3) {
        m.photos[this.view].calib = this.calibTmp;
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
          id, name: name.trim(), system: system.trim() || undefined, photos: { [this.view]: uv },
          position: null, labelOffset: defaultLabelOffset(this.view), specs: {},
        });
        this.sel = id;
        this.mode = 'place';
        this.app.actions.machineEdited({ rebuild: true });
      }
    } else if (this.sel) {
      const c = m.components.find((x) => x.id === this.sel);
      if (c) { c.photos = { ...(c.photos ?? {}), [this.view]: uv }; this.app.actions.machineEdited(); }
    }
    this.render();
  }
}
