// Carga de datos del equipo, cálculo de estado y persistencia local.

const PREFIX = 'qm:';
export const store = {
  get(key, def) {
    try { const v = localStorage.getItem(PREFIX + key); return v == null ? def : JSON.parse(v); }
    catch { return def; }
  },
  set(key, value) { try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* sin almacenamiento */ } },
  del(key) { try { localStorage.removeItem(PREFIX + key); } catch { /* sin almacenamiento */ } },
};

export async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** Copia local de un equipo editado en este dispositivo (componentes agregados, foto, etc.). */
export function getLocalMachine(id) { return store.get(`machine:${id}`, null); }
export function saveLocalMachine(machine) {
  const copy = structuredClone({ ...machine, _original: undefined });
  delete copy._original;
  store.set(`machine:${machine.id}`, copy);
  machine._original = structuredClone(copy);
}

/** Equipos creados en este dispositivo (no vienen en data/machines.json). */
export function getCustomMachines() { return store.get('customMachines', []); }
export function addCustomMachine(machine) {
  const list = getCustomMachines().filter((m) => m.id !== machine.id);
  list.push({ id: machine.id, name: machine.name, local: true });
  store.set('customMachines', list);
}
export function removeCustomMachine(id) {
  store.set('customMachines', getCustomMachines().filter((m) => m.id !== id));
  store.del(`machine:${id}`);
}

/** Aplica lo que el técnico guardó en este visor: puntos registrados, servicios y horómetro. */
export function applyLocalState(machine) {
  machine._original = structuredClone(machine);
  const points = store.get(`${machine.id}:points`, {});
  const service = store.get(`${machine.id}:service`, {});
  const hours = store.get(`${machine.id}:hourMeter`, null);
  if (typeof hours === 'number') machine.hourMeter = hours;
  for (const c of machine.components) {
    if (points[c.id] !== undefined) c.position = points[c.id];
    if (service[c.id] !== undefined && c.maintenance) c.maintenance.lastServiceHours = service[c.id];
  }
  return machine;
}

export function savePoint(machine, comp) {
  const points = store.get(`${machine.id}:points`, {});
  points[comp.id] = comp.position ?? null;
  store.set(`${machine.id}:points`, points);
}

export function saveService(machine, comp) {
  const service = store.get(`${machine.id}:service`, {});
  service[comp.id] = comp.maintenance.lastServiceHours;
  store.set(`${machine.id}:service`, service);
}

export function saveHourMeter(machine) { store.set(`${machine.id}:hourMeter`, machine.hourMeter); }

export function getChecklist(machine, comp) {
  const n = comp.checklist?.length ?? 0;
  const saved = store.get(`${machine.id}:check:${comp.id}`, []);
  return Array.from({ length: n }, (_, i) => !!saved[i]);
}
export function setChecklist(machine, comp, values) { store.set(`${machine.id}:check:${comp.id}`, values); }

export function resetLocalState(machine) {
  for (const k of ['points', 'service', 'hourMeter', 'anchor']) store.del(`${machine.id}:${k}`);
  store.del(`machine:${machine.id}`);
  for (const c of machine.components) store.del(`${machine.id}:check:${c.id}`);
}

export function maintenanceInfo(comp, machine) {
  const m = comp.maintenance;
  if (!m || !m.intervalHours) return null;
  const due = m.lastServiceHours + m.intervalHours;
  const remaining = due - machine.hourMeter;
  return {
    task: m.task, interval: m.intervalHours, last: m.lastServiceHours, due, remaining,
    progress: Math.min(1, Math.max(0, (machine.hourMeter - m.lastServiceHours) / m.intervalHours)),
  };
}

const SEVERITY = { ok: 0, warn: 1, crit: 2 };
const SEVERITY_NAME = ['ok', 'warn', 'crit'];

/** Estado = el peor entre: estado manual, alertas abiertas y mantenimiento vencido/próximo. */
export function statusOf(comp, machine) {
  let s = SEVERITY[comp.status] ?? 0;
  if (comp.alerts?.length) s = Math.max(s, 1);
  const mi = maintenanceInfo(comp, machine);
  if (mi) {
    if (mi.remaining < 0) s = 2;
    else if (mi.remaining <= mi.interval * 0.1) s = Math.max(s, 1);
  }
  return SEVERITY_NAME[s];
}

export function hoursText(h) {
  return `${Math.round(h).toLocaleString('es')} h`;
}

/** JSON del equipo con los puntos y servicios actuales, listo para volver a cargar. */
export function exportMachine(machine) {
  const out = structuredClone(machine._original ?? machine);
  out.hourMeter = machine.hourMeter;
  out.components = machine.components.map((c) => {
    const o = out.components.find((x) => x.id === c.id) ?? structuredClone(c);
    o.position = c.position ?? null;
    if (c.photo) o.photo = c.photo;
    if (c.maintenance && o.maintenance) o.maintenance.lastServiceHours = c.maintenance.lastServiceHours;
    return o;
  });
  for (const k of ['photoView', 'photoCalib']) if (machine[k] !== undefined) out[k] = machine[k];
  out.exportedAt = new Date().toISOString();
  return out;
}

export function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
