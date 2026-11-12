// Modelo simplificado del equipo (cajas definidas en el JSON).
// - "solid": maqueta para probar en PC o en modo VR (entrenamiento).
// - "guide": contorno en alambre para alinear con la máquina real en RA.
import * as THREE from 'three';

export function buildPreview(machine) {
  const solid = new THREE.Group();
  const guide = new THREE.Group();
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x37c8ff, transparent: true, opacity: 0.6, depthWrite: false });
  for (const part of machine.preview ?? []) {
    const geo = new THREE.BoxGeometry(...part.size);
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: part.color ?? '#d9a400', roughness: 0.75, metalness: 0.15 }));
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geo), edgeMat);
    for (const o of [mesh, edges]) {
      o.position.fromArray(part.pos);
      if (part.rot) o.rotation.set(...part.rot.map(THREE.MathUtils.degToRad));
    }
    solid.add(mesh);
    guide.add(edges);
  }
  return { solid, guide };
}

export function disposeTree(obj) {
  obj.traverse((o) => {
    o.geometry?.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
  });
}

/** Caja que envuelve al equipo (coordenadas del equipo), a partir de la maqueta o de sus medidas. */
export function previewBounds(machine) {
  const box = new THREE.Box3();
  const tmp = new THREE.Box3();
  const obj = new THREE.Object3D();
  for (const part of machine.preview ?? []) {
    obj.position.fromArray(part.pos);
    obj.rotation.set(...(part.rot ?? [0, 0, 0]).map(THREE.MathUtils.degToRad));
    obj.updateMatrix();
    const [w, h, d] = part.size;
    tmp.min.set(-w / 2, -h / 2, -d / 2);
    tmp.max.set(w / 2, h / 2, d / 2);
    box.union(tmp.applyMatrix4(obj.matrix));
  }
  if (box.isEmpty() && machine.dimensions) {
    const [w, h, l] = machine.dimensions;
    box.min.set(-w / 2, 0, -l / 2);
    box.max.set(w / 2, h, l / 2);
  }
  return box;
}
