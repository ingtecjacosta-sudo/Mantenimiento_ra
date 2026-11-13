// Puntos de referencia para ubicar el equipo y ajuste por mínimos cuadrados.
import { componentFromPhotos } from './photo.js';

/**
 * Puntos de referencia del equipo con su posición en coordenadas del equipo.
 * Vienen del JSON (position) o de las fotos (marcados en el editor). Los de suelo quedan en y = 0.
 * Si hay menos de 2, se usan los extremos delantero y trasero (método simple).
 */
export function referencePoints(machine, bounds) {
  const list = [];
  for (const r of machine.refPoints ?? []) {
    let pos = Array.isArray(r.position) ? r.position.slice() : null;
    if (!pos) {
      // Desde las fotos solo sirve si está marcado en un costado Y en frente/atrás:
      // con una sola foto no se conoce la profundidad y el ajuste quedaría mal.
      const res = componentFromPhotos(machine, r, bounds);
      if (res?.full) pos = res.position.slice();
    }
    if (!pos) continue;
    const ground = r.ground !== false;
    if (ground) pos[1] = 0;
    list.push({ id: r.id, name: r.name, hint: r.hint ?? '', ground, position: pos });
  }
  if (list.length >= 2) {
    // Orden de una vuelta alrededor del equipo: frente-izquierda → frente-derecha → atrás-derecha → atrás-izquierda
    const cx = list.reduce((a, r) => a + r.position[0], 0) / list.length;
    const cz = list.reduce((a, r) => a + r.position[2], 0) / list.length;
    const key = (r) => (Math.PI / 2 - Math.atan2(r.position[0] - cx, r.position[2] - cz) + 4 * Math.PI) % (2 * Math.PI);
    return list.sort((a, b) => key(a) - key(b));
  }
  if (!bounds || bounds.isEmpty()) return list;
  const cx = (bounds.min.x + bounds.max.x) / 2;
  const ref = machine.reference ?? {};
  return [
    { id: 'extremo-delantero', name: 'Extremo delantero', hint: ref.frontHint ? `suelo ${ref.frontHint}` : 'suelo justo debajo del extremo más adelantado', ground: true, position: [cx, 0, bounds.max.z], auto: true },
    { id: 'extremo-trasero', name: 'Extremo trasero', hint: ref.rearHint ? `suelo ${ref.rearHint}` : 'suelo justo debajo del extremo más atrasado', ground: true, position: [cx, 0, bounds.min.z], auto: true },
  ];
}

/**
 * Mejor giro (sobre el eje vertical), escala y desplazamiento que llevan los puntos del modelo
 * a los puntos marcados en el mundo (similitud 2D de Umeyama en el plano del suelo + altura media).
 * pairs: [{ m: [x, y, z] (modelo), w: {x, y, z} (mundo) }]
 */
export function fitPose(pairs, { allowScale = true } = {}) {
  const n = pairs.length;
  if (n < 2) return null;
  let mx = 0, mz = 0, wx = 0, wz = 0;
  for (const p of pairs) { mx += p.m[0]; mz += p.m[2]; wx += p.w.x; wz += p.w.z; }
  mx /= n; mz /= n; wx /= n; wz /= n;
  let A = 0, B = 0, M2 = 0;
  for (const p of pairs) {
    const ax = p.m[0] - mx, az = p.m[2] - mz, bx = p.w.x - wx, bz = p.w.z - wz;
    A += bx * ax + bz * az;
    B += bx * az - bz * ax;
    M2 += ax * ax + az * az;
  }
  const yaw = Math.atan2(B, A);
  const c = Math.cos(yaw), s = Math.sin(yaw);
  // Con puntos muy juntos la escala no es confiable: se deja en 1
  let scale = 1;
  if (allowScale && M2 > 1.5 * 1.5) scale = Math.min(2, Math.max(0.5, (A * c + B * s) / M2));
  const tx = wx - scale * (mx * c + mz * s);
  const tz = wz - scale * (-mx * s + mz * c);
  let ty = 0;
  for (const p of pairs) ty += p.w.y - scale * p.m[1];
  ty /= n;
  const apply = (m) => [tx + scale * (m[0] * c + m[2] * s), ty + scale * m[1], tz + scale * (-m[0] * s + m[2] * c)];
  const residuals = pairs.map((p) => { const q = apply(p.m); return Math.hypot(q[0] - p.w.x, q[1] - p.w.y, q[2] - p.w.z); });
  const rms = Math.sqrt(residuals.reduce((a, r) => a + r * r, 0) / n);
  return { yaw, scale, position: [tx, ty, tz], residuals, rms, apply };
}

/**
 * Igual que fitPose, pero con 4 o más puntos detecta uno mal marcado:
 * si al quitarlo el error baja mucho, se descarta y se informa (outlier).
 */
export function fitPoseRobust(pairs, opts) {
  const all = fitPose(pairs, opts);
  if (!all || pairs.length < 4) return all && { ...all, outlier: -1 };
  const worst = all.residuals.indexOf(Math.max(...all.residuals));
  const rest = fitPose(pairs.filter((_, i) => i !== worst), opts);
  const q = rest.apply(pairs[worst].m), w = pairs[worst].w;
  const worstErr = Math.hypot(q[0] - w.x, q[1] - w.y, q[2] - w.z);
  if (worstErr > 0.25 && rest.rms < all.rms * 0.5) {
    const residuals = pairs.map((p) => { const r = rest.apply(p.m); return Math.hypot(r[0] - p.w.x, r[1] - p.w.y, r[2] - p.w.z); });
    return { ...rest, residuals, outlier: worst };
  }
  return { ...all, outlier: -1 };
}
