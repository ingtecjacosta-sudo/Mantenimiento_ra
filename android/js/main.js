// Asistente de mantenimiento en realidad mixta para Meta Quest 3 (WebXR + Three.js).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { ComponentLabel } from './labels.js';
import { DetailWindow, Toolbar, Hud } from './ui.js';
import { ArOverlay } from './overlay.js';
import { isIOS, supportsQuickLook, exportUSDZ, quickLookHref } from './quicklook.js';
import { drawCroquis, photoGuide, frontLeftIn } from './croquis.js';
import { referencePoints, fitPoseRobust } from './fit.js';
import { buildPreview, disposeTree, previewBounds } from './preview.js';
import { PhotoEditor, savePhoto, loadPhoto, componentFromPhotos, migratePhotos, photoKey, VIEWS, blobToDataURL, dataURLToBlob } from './photo.js';
import {
  store, fetchJSON, applyLocalState, savePoint, saveService, saveHourMeter, setChecklist,
  resetLocalState, exportMachine, downloadJSON,
  getLocalMachine, saveLocalMachine, getCustomMachines, addCustomMachine, removeCustomMachine,
} from './data.js';

// --- Parámetros de visibilidad de carteles -----------------------------------
const FOCUS_ANGLE = 14;      // grados: el cartel que miras de frente se expande
const COMPACT_ANGLE = 42;    // grados: carteles compactos dentro de este cono
const MAX_COMPACT = 10;      // máximo de carteles compactos simultáneos (modo Auto)

const FORCE_HANDHELD = new URLSearchParams(location.search).has('celular'); // para pruebas

// --- Estado global -------------------------------------------------------------
const state = {
  mode: 'view',          // 'view' | 'place' | 'register'
  xr: false,
  arMode: false,
  placed: false,
  showAll: false,
  alertsOnly: false,
  showGuide: false,
  registerIndex: 0,
  placeYawOffset: 0,
  placeStep: 0,          // ubicación en 2 puntos: 0 = punto delantero, 1 = punto trasero
  handheld: false,       // celular / tablet (AR con la cámara, interfaz táctil)
};
const app = {
  state, machine: null, labels: [], actions: {},
  photoUrls: {},           // fotos de referencia del equipo actual por vista (blob URL)
  photoImages: {},         // las mismas fotos como imágenes, para dibujarlas en los paneles 3D
  bounds: () => previewBounds(app.machine),
  arPoints: () => store.get(`${app.machine?.id}:points`, {}),
};
let machineIndex = [];

// --- Escena ------------------------------------------------------------------
const container = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const DESKTOP_BG = new THREE.Color(0x0d1117);
scene.background = DESKTOP_BG;
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.03, 300);
camera.position.set(7.5, 4.6, 9);
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xdde8ff, 0x3a3020, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(6, 12, 8);
scene.add(sun);

const environment = new THREE.Group();
const grid = new THREE.GridHelper(40, 40, 0x30363d, 0x21262d);
environment.add(grid);
scene.add(environment);

const machineRoot = new THREE.Group();
machineRoot.name = 'machineRoot';
scene.add(machineRoot);
let preview = { solid: new THREE.Group(), guide: new THREE.Group() };

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.6, 1.5);
controls.enableDamping = true;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

const hud = new Hud();
const toolbar = new Toolbar(app);
const detail = new DetailWindow(app);
scene.add(hud.mesh, toolbar.mesh, detail.mesh);
/** Si la página guardada en el navegador es de una versión anterior, crea las secciones que falten. */
function ensureEl(id, html) {
  let el = document.getElementById(id);
  if (!el) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html.trim();
    el = tpl.content.firstElementChild;
    document.body.appendChild(el);
  }
  return el;
}
const overlay = new ArOverlay(app, ensureEl('arOverlay', `<div id="arOverlay"><div id="arTop" class="ui"></div><div id="arCross" aria-hidden="true"></div>
  <div id="arToast"></div><div id="arBottom" class="ui"></div><section id="arSheet" class="ui" hidden></section></div>`));
const photoEditor = new PhotoEditor(app, ensureEl('photoEditor', '<section id="photoEditor" hidden></section>'));

/** Mensaje breve: en el visor como panel 3D, en el celular sobre la cámara. */
function notify(text, seconds = 4, color) {
  if (state.handheld) overlay.toast(text, seconds, color);
  else hud.show(text, seconds, color);
}
function refreshUI() {
  toolbar.render();
  if (state.handheld) overlay.render();
}

// Retícula de ubicación + guía fantasma del equipo
const reticle = new THREE.Group();
reticle.visible = false;
{
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.21, 40).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffb000, transparent: true, opacity: 0.9, depthTest: false }));
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.28, 3).rotateX(Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffb000, depthTest: false }));
  arrow.position.set(0, 0.02, 0.4); // apunta hacia el frente del equipo (+Z)
  ring.renderOrder = arrow.renderOrder = 45;
  reticle.add(ring, arrow);
}
const reticleGhost = new THREE.Group();
reticle.add(reticleGhost);
scene.add(reticle);

const registerTip = new THREE.Mesh(new THREE.SphereGeometry(0.018, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0xffb000, depthTest: false }));
registerTip.renderOrder = 45;
registerTip.visible = false;
scene.add(registerTip);

// --- Vista actual (posición/orientación de la cabeza o de la cámara de PC) ----
const camPos = new THREE.Vector3();
const camQuat = new THREE.Quaternion();
const tmpV = new THREE.Vector3(), tmpV2 = new THREE.Vector3(), tmpM = new THREE.Matrix4();
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const raycaster = new THREE.Raycaster();
let viewerHitSource = null;                       // hit-test desde el centro de la pantalla (celular)
const viewerHit = { has: false, matrix: new THREE.Matrix4() };

// --- Controles / manos ---------------------------------------------------------
const controllers = [];
let activeController = null;
{
  const cmf = new XRControllerModelFactory();
  const hmf = new XRHandModelFactory();
  for (let i = 0; i < 2; i++) {
    const c = renderer.xr.getController(i);
    c.userData = { inputSource: null, hitSource: null, hitMatrix: new THREE.Matrix4(), hasHit: false };
    const ray = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]),
      new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
    ray.scale.z = 4;
    ray.visible = false;
    c.add(ray);
    c.userData.ray = ray;
    const cursor = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false }));
    cursor.renderOrder = 50;
    cursor.visible = false;
    scene.add(cursor);
    c.userData.cursor = cursor;

    c.addEventListener('connected', (e) => onControllerConnected(c, e.data));
    c.addEventListener('disconnected', () => onControllerDisconnected(c));
    c.addEventListener('select', () => onSelect(c));
    scene.add(c);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(cmf.createControllerModel(grip));
    scene.add(grip);
    const hand = renderer.xr.getHand(i);
    hand.add(hmf.createHandModel(hand, 'mesh'));
    scene.add(hand);
    controllers.push(c);
  }
}

function onControllerConnected(c, source) {
  if (source.targetRayMode === 'screen') return; // toques en pantalla del celular: se manejan aparte
  c.userData.inputSource = source;
  c.userData.ray.visible = true;
  if (!activeController || source.handedness === 'right') activeController = c;
  const session = renderer.xr.getSession();
  if (session?.requestHitTestSource && source.targetRaySpace) {
    session.requestHitTestSource({ space: source.targetRaySpace })
      .then((hs) => { c.userData.hitSource = hs; })
      .catch(() => { /* hit-test no disponible: se usa el plano del suelo */ });
  }
}

function onControllerDisconnected(c) {
  c.userData.hitSource?.cancel?.();
  c.userData.hitSource = null;
  c.userData.inputSource = null;
  c.userData.hasHit = false;
  c.userData.ray.visible = false;
  c.userData.cursor.visible = false;
  if (activeController === c) activeController = controllers.find((x) => x.userData.inputSource) ?? null;
}

function setRayFromController(c) {
  tmpM.identity().extractRotation(c.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(c.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tmpM);
}

// --- Selección (rayo contra paneles y marcadores) -----------------------------
function isShown(o) {
  for (; o; o = o.parent) if (!o.visible) return false;
  return true;
}

function interactables() {
  const list = [];
  if (toolbar.mesh.visible) list.push(toolbar.mesh);
  if (detail.isOpen) list.push(detail.mesh);
  if (machineRoot.visible && state.mode === 'view') {
    for (const l of app.labels) {
      if (!l.hasPosition) continue;
      list.push(l.hitSphere);
      if (l.compact.mesh.visible) list.push(l.compact.mesh);
      if (l.detail.mesh.visible) list.push(l.detail.mesh);
    }
  }
  // (los hitSphere tienen material invisible pero el objeto sigue "visible", así que el rayo los detecta)
  return list.filter(isShown);
}

function pick() {
  const hits = raycaster.intersectObjects(interactables(), false);
  // Los paneles de interfaz tienen prioridad sobre los carteles que quedan detrás.
  const ui = hits.find((h) => h.object === toolbar.mesh || h.object === detail.mesh);
  return ui ?? hits[0] ?? null;
}

function activate(hit) {
  const o = hit.object;
  const panel = o.userData.panel;
  if (panel && panel.regions.length && panel.click(hit.uv)) { refreshUI(); return true; }
  if (o.userData.label) { openDetail(o.userData.label); return true; }
  return !!panel?.consumesClicks;
}

function onSelect(c) {
  if (state.handheld || !c.userData.inputSource) return;
  activeController = c;
  setRayFromController(c);
  rayAction();
}

/** Toque en la pantalla del celular: rayo desde el punto tocado. */
function onScreenSelect(e) {
  if (!state.handheld) return;
  const pose = e.frame.getPose(e.inputSource.targetRaySpace, renderer.xr.getReferenceSpace());
  if (!pose) return;
  tmpM.fromArray(pose.transform.matrix);
  raycaster.ray.origin.setFromMatrixPosition(tmpM);
  raycaster.ray.direction.set(0, 0, -1).transformDirection(tmpM);
  rayAction();
}

function rayAction() {
  const hit = pick();
  if (hit && activate(hit)) return;
  if (state.mode === 'place' && reticle.visible) confirmPlacement();
  else if (state.mode === 'register' && registerTip.visible) registerPoint();
}

function openDetail(label) {
  for (const l of app.labels) l.highlight = false;
  label.highlight = true;
  // Celular (en RA o con pantalla angosta): ficha como hoja táctil; visor/PC: panel 3D.
  if (state.handheld || (!state.xr && window.innerWidth < 700)) overlay.openSheet(label);
  else detail.open(label, camPos, camQuat);
}

// --- Ubicación del equipo (alinear el modelo con la máquina real) -------------
// Se marcan en el suelo varios PUNTOS DE REFERENCIA del equipo (p. ej. las 4 esquinas de las orugas).
// Con todos ellos se calcula el mejor ajuste (giro, escala y posición) por mínimos cuadrados:
// los errores de marcado se compensan, se mide la precisión y se descarta un punto mal marcado.
// Si el equipo no tiene puntos de referencia, se usan sus extremos delantero y trasero.
let anchor = null;            // XRAnchor que mantiene el equipo fijo en el espacio real
let anchorDueAt = 0;          // cuándo (re)crear el ancla tras un ajuste
const refOffset = new THREE.Vector3();   // pivote para los giros finos (primer punto de referencia)
let placeBackup = null;                  // posición anterior, por si se cancela
let lastPlaceMsgAt = -1e9;
const place = app.place = { refs: [], marks: [], step: 0, fit: null }; // estado visible para la interfaz

function updateReferencePoints(machine) {
  const refs = referencePoints(machine, previewBounds(machine));
  if (refs[0]) refOffset.fromArray(refs[0].position); else refOffset.set(0, 0, 0);
}

function placeHint() {
  const r = place.refs[place.step];
  return r ? `Punto ${place.step + 1} de ${place.refs.length}: ${r.name}${r.hint ? ` (${r.hint})` : ''}` : '';
}

function startPlace() {
  if (!state.xr) return;
  detail.close();
  overlay.closeSheet();
  placeBackup = state.placed ? { p: machineRoot.position.clone(), q: machineRoot.quaternion.clone(), s: machineRoot.scale.x } : null;
  machineRoot.visible = false;
  place.refs = referencePoints(app.machine, previewBounds(app.machine));
  place.marks = place.refs.map(() => null);
  place.step = 0;
  place.fit = null;
  clearPlaceMarkers();
  state.mode = 'place';
  state.placeStep = 0;
  reticleGhost.visible = false;
  notify(placeHint(), 6);
  applyVisibility();
  refreshUI();
  if (state.handheld) overlay.showGuide(); // guía con croquis antes de marcar
}

/** Punto apuntado con la mira central del celular. */
function handheldAim(out, floorFallback) {
  if (viewerHit.has) { out.setFromMatrixPosition(viewerHit.matrix); return true; }
  raycaster.ray.origin.copy(camPos);
  raycaster.ray.direction.set(0, 0, -1).applyQuaternion(camQuat);
  if (floorFallback) return !!raycaster.ray.intersectPlane(floorPlane, out) && out.distanceTo(camPos) < 15;
  out.copy(camPos).addScaledVector(raycaster.ray.direction, 0.25); // acercar el celular a la pieza
  return true;
}

/** Ajuste con los puntos marcados (y opcionalmente la mira como candidato del punto actual). */
function computeFit(withReticle) {
  const pairs = [];
  place.marks.forEach((w, i) => { if (w) pairs.push({ m: place.refs[i].position, w, i }); });
  if (withReticle && reticle.visible && !place.marks[place.step]) pairs.push({ m: place.refs[place.step].position, w: reticle.position.clone(), i: place.step });
  const fit = fitPoseRobust(pairs);
  if (fit) fit.indices = pairs.map((p) => p.i);
  return fit;
}

function applyFit(fit) {
  machineRoot.position.fromArray(fit.position);
  machineRoot.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), fit.yaw);
  machineRoot.scale.setScalar(fit.scale);
}

function updatePlacement() {
  let ok = false;
  if (state.handheld) {
    ok = viewerHit.has && handheldAim(tmpV, false); // en el celular: solo con el suelo realmente detectado
  } else {
    const c = activeController;
    if (!c?.userData.inputSource) { reticle.visible = false; return; }
    if (c.userData.hasHit) {
      tmpV.setFromMatrixPosition(c.userData.hitMatrix);
      ok = true;
    } else {
      setRayFromController(c);
      ok = !!raycaster.ray.intersectPlane(floorPlane, tmpV) && tmpV.distanceTo(raycaster.ray.origin) < 30;
    }
  }
  if (state.handheld && overlay.setAimStatus) overlay.setAimStatus(ok);
  reticle.visible = ok;
  if (ok) {
    reticle.position.lerp(tmpV, reticle.userData.init ? 0.5 : 1);
    reticle.userData.init = true;
    reticle.rotation.set(0, Math.atan2(camPos.x - reticle.position.x, camPos.z - reticle.position.z), 0);
  }
  // Vista previa en vivo: con 2 o más puntos (incluida la mira) se muestra el contorno ajustado
  const fit = computeFit(true);
  if (fit) { applyFit(fit); machineRoot.visible = true; } else machineRoot.visible = false;
}

function nextPendingStep(from) {
  for (let k = 1; k <= place.refs.length; k++) {
    const i = (from + k) % place.refs.length;
    if (!place.marks[i]) return i;
  }
  return -1;
}

/** Marca el punto actual con la mira. */
function confirmPlacement() {
  if (!reticle.visible) return;
  place.marks[place.step] = reticle.position.clone();
  addPlaceMarker(place.step, reticle.position);
  const marked = place.marks.filter(Boolean).length;
  const next = nextPendingStep(place.step);
  if (next < 0 || marked >= place.refs.length) { finishPlace(); return; } // todos marcados
  place.step = next;
  state.placeStep = next;
  place.fit = computeFit(false);
  notify(placeHint(), 6);
  refreshUI();
}

function skipPoint() {
  if (state.mode !== 'place') return;
  const next = nextPendingStep(place.step);
  if (next < 0 || next === place.step) { notify('No quedan otros puntos: marca este o toca Listo', 3, '#e3b341'); return; }
  place.step = next;
  state.placeStep = next;
  notify(placeHint(), 5);
  refreshUI();
}

function undoPoint() {
  // Deshace el último punto marcado
  let last = -1, lastT = -1;
  place.marks.forEach((w, i) => { if (w && w.userData?.t > lastT) { lastT = w.userData.t; last = i; } });
  if (last < 0) return;
  place.marks[last] = null;
  removePlaceMarker(last);
  place.step = last;
  state.placeStep = last;
  place.fit = computeFit(false);
  notify(placeHint(), 5);
  refreshUI();
}

function finishPlace() {
  const fit = computeFit(false);
  if (!fit) { notify('Marca al menos 2 puntos para ubicar el equipo', 3, '#e3b341'); return; }
  applyFit(fit);
  store.set(`${app.machine.id}:scale`, fit.scale);
  machineRoot.visible = true;
  machineRoot.updateMatrixWorld(true);
  state.placed = true;
  state.mode = 'view';
  state.placeStep = 0;
  clearPlaceMarkers();
  reticle.visible = false;
  reticle.userData.init = false;
  placeBackup = null;
  dropAnchor();
  anchorDueAt = performance.now() + 300;
  place.fit = fit;
  const n = fit.indices.length;
  const used = fit.outlier >= 0 ? n - 1 : n;
  const cm = Math.round(fit.rms * 100);
  let msg = n === 2
    ? 'Equipo ubicado con 2 puntos. Con 3 o más puntos se mide y mejora la precisión.'
    : `Equipo ubicado con ${used} puntos · precisión ±${cm} cm`;
  if (fit.outlier >= 0) msg += ` · se descartó el punto ${fit.indices[fit.outlier] + 1} (no coincidía)`;
  if (Math.abs(fit.scale - 1) > 0.12) msg += ` · escala ×${fit.scale.toFixed(2)}`;
  const color = n >= 3 && cm > 25 ? '#e3b341' : '#3fb950';
  lastPlaceMsgAt = performance.now();
  notify(n >= 3 && cm > 25 ? `${msg}. Precisión baja: revisa que marcaste los puntos correctos.` : msg, 7, color);
  applyVisibility();
  refreshUI();
}

function cancelPlace() {
  state.mode = 'view';
  state.placeStep = 0;
  reticle.visible = false;
  reticle.userData.init = false;
  clearPlaceMarkers();
  overlay.hideGuide();
  if (placeBackup) {
    machineRoot.position.copy(placeBackup.p);
    machineRoot.quaternion.copy(placeBackup.q);
    machineRoot.scale.setScalar(placeBackup.s);
    machineRoot.visible = true;
    anchorDueAt = performance.now() + 300;
  } else machineRoot.visible = false;
  placeBackup = null;
  applyVisibility();
  refreshUI();
}

// Marcas en el mundo de los puntos ya marcados (poste verde con anillo)
const placeMarkers = new THREE.Group();
scene.add(placeMarkers);
let markSeq = 0;
function addPlaceMarker(i, pos) {
  removePlaceMarker(i);
  place.marks[i].userData = { t: ++markSeq };
  const g = new THREE.Group();
  g.name = `mark-${i}`;
  const m = new THREE.MeshBasicMaterial({ color: 0x3fb950, depthTest: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.1, 0.14, 32).rotateX(-Math.PI / 2), m);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.6, 8), m);
  pole.position.y = 0.3;
  ring.renderOrder = pole.renderOrder = 45;
  g.add(ring, pole);
  g.position.copy(pos);
  placeMarkers.add(g);
}
function removePlaceMarker(i) {
  const g = placeMarkers.getObjectByName(`mark-${i}`);
  if (g) { placeMarkers.remove(g); g.traverse((o) => { o.geometry?.dispose(); }); }
}
function clearPlaceMarkers() { for (const g of [...placeMarkers.children]) removePlaceMarker(Number(g.name.slice(5))); }

/** Gira el equipo alrededor del punto de referencia (afinar la alineación). */
function rotate(deg) {
  const rad = THREE.MathUtils.degToRad(deg);
  if (!state.placed || state.mode === 'place') return;
  machineRoot.updateMatrixWorld(true);
  const before = machineRoot.localToWorld(tmpV.copy(refOffset));
  machineRoot.rotateY(rad);
  machineRoot.updateMatrixWorld(true);
  const after = machineRoot.localToWorld(tmpV2.copy(refOffset));
  machineRoot.position.add(before.sub(after));
  dropAnchor();
  anchorDueAt = performance.now() + 1200;
}

function dropAnchor() {
  if (anchor) { try { anchor.delete?.(); } catch { /* ya eliminada */ } }
  anchor = null;
}

async function createAnchor(frame) {
  const ref = renderer.xr.getReferenceSpace();
  if (!frame.createAnchor || !ref) return;
  const p = machineRoot.position, q = machineRoot.quaternion;
  try {
    const a = await frame.createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), ref);
    if (anchorDueAt) { a.delete?.(); return; } // hubo otro ajuste mientras se creaba
    anchor = a;
    if (a.requestPersistentHandle) {
      const key = `${app.machine.id}:anchor`;
      const old = store.get(key, null);
      const uuid = await a.requestPersistentHandle();
      const session = renderer.xr.getSession();
      if (old && old !== uuid) session?.deletePersistentAnchor?.(old).catch(() => {});
      store.set(key, uuid);
      // No tapar el mensaje de precisión recién mostrado al ubicar
      if (performance.now() - lastPlaceMsgAt > 8000) notify('Posición guardada: la próxima vez se ubica sola', 3, '#3fb950');
    }
  } catch (e) {
    console.warn('No se pudo crear el ancla', e);
  }
}

async function restoreAnchor(session) {
  const uuid = store.get(`${app.machine.id}:anchor`, null);
  if (!uuid || !session.restorePersistentAnchor) return false;
  try {
    anchor = await session.restorePersistentAnchor(uuid);
    machineRoot.scale.setScalar(store.get(`${app.machine.id}:scale`, 1));
    state.placed = true;
    state.mode = 'view';
    notify('Equipo ubicado desde la última sesión. Usa "Ubicar equipo" si no coincide.', 5, '#3fb950');
    refreshUI();
    return true;
  } catch (e) {
    console.warn('Ancla no encontrada', e);
    store.del(`${app.machine.id}:anchor`);
    return false;
  }
}

// --- Registro de puntos de componentes ----------------------------------------
function startRegister() {
  if (!state.placed) { notify('Primero ubica el equipo', 3, '#e3b341'); return; }
  detail.close();
  state.mode = 'register';
  const firstMissing = app.machine.components.findIndex((c) => !Array.isArray(c.position));
  state.registerIndex = firstMissing >= 0 ? firstMissing : 0;
  state.showAll = true;
  refreshUI();
}

function updateRegisterTip() {
  if (state.handheld) {
    handheldAim(tmpV, false);
    if (tmpV.distanceTo(camPos) > 4) tmpV.copy(camPos).addScaledVector(raycaster.ray.direction, 0.25);
    registerTip.position.copy(tmpV);
    registerTip.visible = true;
    return;
  }
  const c = activeController;
  if (!c?.userData.inputSource) { registerTip.visible = false; return; }
  setRayFromController(c);
  if (c.userData.hasHit) {
    tmpV.setFromMatrixPosition(c.userData.hitMatrix);
    if (tmpV.distanceTo(raycaster.ray.origin) > 4) tmpV.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, 0.08);
  } else {
    // Sin superficie detectada: punta del control (tocar la pieza físicamente).
    tmpV.copy(raycaster.ray.origin).addScaledVector(raycaster.ray.direction, 0.08);
  }
  registerTip.position.copy(tmpV);
  registerTip.visible = true;
}

function registerPoint() {
  const comp = app.machine.components[state.registerIndex];
  const label = app.labels[state.registerIndex];
  const local = machineRoot.worldToLocal(registerTip.position.clone());
  label.setPosition(local.toArray().map((v) => Math.round(v * 1000) / 1000));
  savePoint(app.machine, comp);
  notify(`✔ ${comp.name} registrado`, 2.5, '#3fb950');
  if (state.registerIndex < app.machine.components.length - 1) state.registerIndex++;
  refreshUI();
  updateDomInfo();
}

function registerStep(d) {
  const n = app.machine.components.length;
  state.registerIndex = (state.registerIndex + d + n) % n;
  refreshUI();
}

function clearPoint() {
  const comp = app.machine.components[state.registerIndex];
  app.labels[state.registerIndex].setPosition(null);
  savePoint(app.machine, comp);
  updateDomInfo();
}

function finishRegister() {
  state.mode = 'view';
  state.showAll = false;
  registerTip.visible = false;
  const missing = app.machine.components.filter((c) => !Array.isArray(c.position)).length;
  notify(missing ? `Listo. ${missing} componentes sin punto.` : 'Todos los puntos registrados. Puedes exportar el JSON.', 4);
  refreshUI();
}

// --- Acciones (usadas por el menú del visor y por los botones de la PC) -------
Object.assign(app.actions, {
  startPlace,
  cancelPlace,
  skipPoint,
  undoPoint,
  finishPlace,
  rotate,
  placeHere: () => {
    if (state.mode === 'place' && reticle.visible) confirmPlacement();
    else notify('Aún no se detecta el suelo: mueve el celular despacio apuntando al piso', 3, '#e3b341');
  },
  markPoint: () => { if (state.mode === 'register' && registerTip.visible) registerPoint(); },
  startRegister, registerStep, clearPoint, finishRegister,
  toggleShowAll: () => { state.showAll = !state.showAll; syncDomButtons(); },
  toggleAlertsOnly: () => { state.alertsOnly = !state.alertsOnly; syncDomButtons(); },
  toggleGuide: () => { state.showGuide = !state.showGuide; applyVisibility(); },
  exitXR: () => renderer.xr.getSession()?.end(),
  exportJSON: async () => {
    const out = exportMachine(app.machine);
    out.photosData = {}; // las fotos viajan dentro del JSON
    for (const v of Object.keys(VIEWS)) {
      const blob = await loadPhoto(photoKey(app.machine.id, v));
      if (blob) out.photosData[v] = await blobToDataURL(blob);
    }
    downloadJSON(out, `${app.machine.id}.json`);
  },
  openPhotoEditor: () => photoEditor.open(),
  setPhoto: async (view, blob) => {
    await savePhoto(photoKey(app.machine.id, view), blob);
    await loadPhotoFor(app.machine);
  },
  /** Llamado por el editor de foto cada vez que cambia algo del equipo. */
  machineEdited: ({ rebuild = false } = {}) => {
    applyPhotoPositions(app.machine);
    updateReferencePoints(app.machine);
    saveLocalMachine(app.machine);
    if (!machineIndex.some((m) => m.id === app.machine.id && !m.local) && !getCustomMachines().some((m) => m.id === app.machine.id)) addCustomMachine(app.machine);
    if (rebuild) rebuildLabels();
    else for (const l of app.labels) { l.setPosition(l.comp.position); l.redraw(); }
    refreshUI();
    updateDomInfo();
  },
  newMachine: async () => {
    const name = prompt('Nombre del equipo (ej. "Cargador frontal CF-02"):');
    if (!name?.trim()) return;
    const dimsTxt = prompt('Medidas aproximadas en metros: largo x ancho x alto', '6 x 2.5 x 3') ?? '';
    const nums = dimsTxt.replace(/,/g, '.').match(/\d+(\.\d+)?/g)?.map(Number) ?? [];
    const [L, W, H] = [nums[0] || 6, nums[1] || 2.5, nums[2] || 3];
    const hours = Number(prompt('Horómetro actual (h):', '0')) || 0;
    const machine = {
      id: `eq-${Date.now().toString(36)}`,
      name: name.trim(),
      hourMeter: hours,
      dimensions: [W, H, L],
      reference: { description: 'el suelo, al centro del frente del equipo', offset: [0, 0, L / 2] },
      preview: [{ size: [W, H, L], pos: [0, H / 2, 0], color: '#d9a400' }],
      photos: {},
      components: [],
    };
    saveLocalMachine(machine);
    addCustomMachine(machine);
    machineIndex.push({ id: machine.id, name: machine.name, local: true });
    fillSelect(machine.id);
    await loadMachine(machineIndex.at(-1));
    photoEditor.open();
  },
  registerService: (label) => {
    const c = label.comp;
    c.maintenance.lastServiceHours = app.machine.hourMeter;
    saveService(app.machine, c);
    setChecklist(app.machine, c, []);
    label.redraw();
    detail.render();
    refreshUI();
    updateDomInfo();
    notify(`Servicio registrado: ${c.name}`, 3, '#3fb950');
  },
});

// --- Carga del equipo ------------------------------------------------------------
/** Componentes marcados en la foto → posición 3D (salvo los ya ubicados en RA, que son más precisos). */
function applyPhotoPositions(machine) {
  const bounds = previewBounds(machine);
  const points = store.get(`${machine.id}:points`, {});
  for (const c of machine.components) {
    if (Array.isArray(points[c.id])) continue;
    const r = componentFromPhotos(machine, c, bounds);
    if (r) c.position = r.position;
  }
}

async function removeAllPhotos(id) {
  for (const v of Object.keys(VIEWS)) await savePhoto(photoKey(id, v), null).catch(() => {});
  await savePhoto(id, null).catch(() => {});
}

function rebuildLabels() {
  for (const l of app.labels) { machineRoot.remove(l.group); l.dispose(); }
  app.labels = app.machine.components.map((c) => new ComponentLabel(c, app.machine));
  for (const l of app.labels) machineRoot.add(l.group);
  if (state.registerIndex >= app.labels.length) state.registerIndex = 0;
}

async function loadPhotoFor(machine) {
  for (const url of Object.values(app.photoUrls)) URL.revokeObjectURL(url);
  app.photoUrls = {};
  app.photoImages = {};
  // Equipos guardados con la versión de una sola foto: mover la foto a su vista.
  const legacy = await loadPhoto(machine.id);
  if (legacy) {
    const view = machine._legacyView ?? 'izq';
    await savePhoto(photoKey(machine.id, view), legacy);
    await savePhoto(machine.id, null);
  }
  for (const v of Object.keys(VIEWS)) {
    const blob = await loadPhoto(photoKey(machine.id, v));
    if (!blob || app.machine !== machine) continue;
    const url = URL.createObjectURL(blob);
    app.photoUrls[v] = url;
    const img = new Image();
    img.onload = () => {
      app.photoImages[v] = img;
      // Fotos de versiones anteriores: guardar la proporción para poder corregir la perspectiva.
      const pv = machine.photos?.[v];
      if (pv && !pv.aspect && img.naturalHeight) { pv.aspect = Math.round((img.naturalWidth / img.naturalHeight) * 1e4) / 1e4; saveLocalMachine(machine); }
      detail.render();
    };
    img.src = url;
  }
  updateDomInfo();
}

async function loadMachine(entry) {
  const data = getLocalMachine(entry.id) ?? entry.data ?? await fetchJSON(entry.file);
  const legacyView = migratePhotos(data);
  const machine = applyLocalState(data);
  if (legacyView) { machine._legacyView = legacyView; saveLocalMachine(machine); }
  applyPhotoPositions(machine);
  app.machine = machine;
  store.set('lastMachine', machine.id);

  for (const l of app.labels) { machineRoot.remove(l.group); l.dispose(); }
  machineRoot.remove(preview.solid, preview.guide);
  reticleGhost.clear();
  disposeTree(preview.solid); disposeTree(preview.guide);

  preview = buildPreview(machine);
  machineRoot.add(preview.solid, preview.guide);
  updateReferencePoints(machine);

  rebuildLabels();
  detail.close();
  overlay.closeSheet();
  loadPhotoFor(machine);
  if (photoEditor.isOpen) photoEditor.render();
  refreshUI();
  applyVisibility();
  updateDomInfo();
}

function applyVisibility() {
  preview.solid.visible = !state.arMode;
  preview.guide.visible = state.arMode && (state.showGuide || state.mode === 'place');
  environment.visible = !state.arMode;
  scene.background = state.arMode ? null : DESKTOP_BG;
  toolbar.mesh.visible = state.xr && !state.handheld;
  if (!state.xr) { hud.mesh.visible = false; reticle.visible = false; registerTip.visible = false; }
}

// --- Visibilidad de carteles según hacia dónde miras -------------------------------
const fwd = new THREE.Vector3();
function updateLabels(dt) {
  fwd.set(0, 0, -1).applyQuaternion(camQuat);
  const maxFocusDist = state.xr ? 9 : 40;
  const maxDist = state.xr ? 25 : 80;
  const infos = [];
  for (const l of app.labels) {
    if (!l.hasPosition) continue;
    l.worldPosition(tmpV);
    const d = tmpV.distanceTo(camPos);
    const a = THREE.MathUtils.radToDeg(fwd.angleTo(tmpV.sub(camPos).normalize()));
    infos.push({ l, d, a, filtered: state.alertsOnly && l.status === 'ok' });
  }
  const visible = machineRoot.visible && state.mode !== 'place';
  let focus = null;
  if (visible && state.mode === 'view') {
    for (const i of infos) if (!i.filtered && i.a < FOCUS_ANGLE && i.d < maxFocusDist && (!focus || i.a < focus.a)) focus = i;
  }
  const compactSet = new Set(
    infos.filter((i) => !i.filtered && (state.showAll || (i.a < COMPACT_ANGLE && i.d < maxDist)))
      .sort((x, y) => x.a - y.a)
      .slice(0, state.showAll ? Infinity : MAX_COMPACT),
  );
  const registering = state.mode === 'register' ? app.labels[state.registerIndex] : null;
  for (const i of infos) {
    let s = 'hidden';
    if (visible) {
      if (i === focus || i.l === registering) s = 'detail';
      else if (compactSet.has(i)) s = 'compact';
    }
    if ((detail.isOpen && detail.label === i.l) || overlay.label === i.l) s = 'compact';
    const scale = state.xr ? THREE.MathUtils.clamp(i.d / 2.2, 0.55, 2.6) * (state.handheld ? 1.3 : 1) : THREE.MathUtils.clamp(i.d / 3.2, 1, 6);
    i.l.update(dt, camPos, s, scale / machineRoot.scale.x);
  }
}

// --- Bucle de cuadros ----------------------------------------------------------------
const clock = new THREE.Clock();
renderer.setAnimationLoop((time, frame) => {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (frame) xrFrame(frame, dt);
  else {
    controls.update();
    camPos.copy(camera.position);
    camQuat.copy(camera.quaternion);
    if (detail.isOpen) detail.placeInFront(camPos, camQuat, 1.1, window.innerWidth > 900 ? 0.22 : 0);
  }
  updateLabels(dt);
  hud.update(dt, camPos, camQuat, state.xr && !state.handheld);
  renderer.render(scene, camera);
});

function xrFrame(frame, dt) {
  const ref = renderer.xr.getReferenceSpace();
  const session = frame.session;
  const pose = frame.getViewerPose(ref);
  if (pose) { camPos.copy(pose.transform.position); camQuat.copy(pose.transform.orientation); }

  viewerHit.has = false;
  if (viewerHitSource) {
    const hp = frame.getHitTestResults(viewerHitSource)[0]?.getPose(ref);
    if (hp) { viewerHit.matrix.fromArray(hp.transform.matrix); viewerHit.has = true; }
  }
  if (app._debug?.hit) { viewerHit.matrix.makeTranslation(...app._debug.hit); viewerHit.has = true; } // pruebas automáticas

  for (const c of controllers) {
    c.userData.hasHit = false;
    if (!c.userData.hitSource) continue;
    const results = frame.getHitTestResults(c.userData.hitSource);
    const hp = results[0]?.getPose(ref);
    if (hp) { c.userData.hitMatrix.fromArray(hp.transform.matrix); c.userData.hasHit = true; }
  }

  // Ancla: crear tras ubicar/ajustar, y seguirla cada cuadro (corrige la deriva del tracking)
  if (anchorDueAt && performance.now() > anchorDueAt) { anchorDueAt = 0; createAnchor(frame); }
  if (anchor && !anchorDueAt && state.mode !== 'place') {
    const ap = frame.getPose(anchor.anchorSpace, ref);
    if (ap) {
      machineRoot.position.copy(ap.transform.position);
      machineRoot.quaternion.copy(ap.transform.orientation);
      if (!machineRoot.visible && state.mode !== 'place') machineRoot.visible = true;
    }
  }

  // Stick: girar la retícula al ubicar
  for (const src of session.inputSources) {
    const ax = src.gamepad?.axes?.[2] ?? 0;
    void ax;
  }

  // Rayos y cursores
  for (const c of controllers) {
    const { cursor, ray, inputSource } = c.userData;
    if (!inputSource) continue;
    setRayFromController(c);
    const hit = pick();
    if (hit) {
      cursor.position.copy(hit.point);
      cursor.visible = true;
      ray.scale.z = hit.distance;
    } else {
      cursor.visible = false;
      ray.scale.z = state.mode === 'register' ? 0.08 : 4;
    }
  }

  if (state.mode === 'place') updatePlacement(); else reticle.visible = false;
  if (state.mode === 'register') updateRegisterTip(); else registerTip.visible = false;
  toolbar.update(dt, camPos, camQuat);
}

// --- Sesión XR --------------------------------------------------------------------
async function enterXR() {
  if (!navigator.xr) return;
  const ar = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  const mode = ar ? 'immersive-ar' : 'immersive-vr';
  const session = await navigator.xr.requestSession(mode, {
    optionalFeatures: ['local-floor', 'hit-test', 'anchors', 'hand-tracking', 'dom-overlay'],
    domOverlay: { root: document.getElementById('arOverlay') },
  });
  savedDesktopView = { pos: camera.position.clone(), target: controls.target.clone() };
  session.addEventListener('end', onSessionEnd);
  session.addEventListener('select', onScreenSelect);

  // El Quest usa 'local-floor' (y = 0 en el suelo). Algunos celulares solo ofrecen 'local'.
  const hasFloor = await session.requestReferenceSpace('local-floor').then(() => true, () => false);
  renderer.xr.setReferenceSpaceType(hasFloor ? 'local-floor' : 'local');
  floorPlane.constant = hasFloor ? 0 : 1.4; // sin suelo conocido: se estima 1,4 m bajo el celular
  await renderer.xr.setSession(session);

  state.xr = true;
  state.arMode = mode === 'immersive-ar';
  state.handheld = session.interactionMode === 'screen-space' || !!session.domOverlayState || FORCE_HANDHELD;
  state.placed = false;
  if (state.handheld && session.requestHitTestSource) {
    try {
      const viewer = await session.requestReferenceSpace('viewer');
      viewerHitSource = await session.requestHitTestSource({ space: viewer });
    } catch { viewerHitSource = null; }
  }
  controls.enabled = false;
  machineRoot.visible = false;
  machineRoot.position.set(0, 0, 0);
  machineRoot.quaternion.identity();
  machineRoot.scale.setScalar(1);
  hud.follower.reset();
  toolbar.follower.reset();
  photoEditor.close();
  document.body.classList.add('in-xr');
  document.body.classList.toggle('handheld', state.handheld);
  applyVisibility();
  if (!(await restoreAnchor(session))) startPlace();
  refreshUI();
}

let savedDesktopView = null;
function onSessionEnd() {
  state.xr = false;
  state.arMode = false;
  state.mode = 'view';
  dropAnchor();
  anchorDueAt = 0;
  detail.close();
  controls.enabled = true;
  machineRoot.visible = true;
  machineRoot.position.set(0, 0, 0);
  machineRoot.quaternion.identity();
  machineRoot.scale.setScalar(1);
  clearPlaceMarkers();
  if (savedDesktopView) { camera.position.copy(savedDesktopView.pos); controls.target.copy(savedDesktopView.target); }
  for (const c of controllers) onControllerDisconnected(c);
  viewerHitSource?.cancel?.();
  viewerHitSource = null;
  overlay.closeSheet();
  state.handheld = false;
  document.body.classList.remove('in-xr', 'handheld');
  applyVisibility();
}

// --- Interfaz HTML (pantalla de inicio / modo PC) -------------------------------
const $ = (id) => document.getElementById(id);

function updateDomInfo() {
  const m = app.machine;
  $('hourMeter').value = m.hourMeter;
  const alerts = app.labels.filter((l) => l.status !== 'ok');
  const missing = m.components.filter((c) => !Array.isArray(c.position)).length;
  const nPhotos = Object.keys(app.photoUrls).length;
  if ($('btnPhoto')) $('btnPhoto').textContent = nPhotos ? `📷 Fotos (${nPhotos}/4)` : '📷 Cargar fotos';
  $('machineInfo').innerHTML = `${m.components.length} componentes · `
    + (alerts.length ? `<b class="warn">${alerts.length} con alerta</b>` : '<b class="ok">sin alertas</b>')
    + (missing ? ` · ${missing} sin punto registrado` : '');
  $('alertList').innerHTML = alerts.map((l) => `<li class="${l.status}">${escapeHtml(l.comp.name)}</li>`).join('');
}

function syncDomButtons() {
  $('btnShowAll').textContent = `Carteles: ${state.showAll ? 'Todos' : 'Auto'}`;
  $('btnAlerts').textContent = `Ver: ${state.alertsOnly ? 'Solo alertas' : 'Todo'}`;
  $('btnShowAll').classList.toggle('active', state.showAll);
  $('btnAlerts').classList.toggle('active', state.alertsOnly);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

const IOS_MODE = isIOS() || new URLSearchParams(location.search).has('iphone');

async function checkXR() {
  const btn = $('btnXR'), status = $('xrStatus');
  btn.textContent = 'Visor XR no detectado';
  if (IOS_MODE) {
    // iPhone/iPad: Safari no tiene WebXR → visor de realidad aumentada de Apple (AR Quick Look)
    btn.disabled = false;
    btn.textContent = '📱 Ver en realidad aumentada';
    status.textContent = supportsQuickLook() || !isIOS()
      ? 'En iPhone la realidad aumentada se abre con el visor de Apple (AR Quick Look).'
      : 'Abre esta página en Safari para usar la realidad aumentada del iPhone.';
    return;
  }
  if (!window.isSecureContext) { status.textContent = 'WebXR necesita HTTPS (o localhost).'; return; }
  if (!navigator.xr) { status.textContent = 'Este navegador no tiene WebXR. Usa Chrome en Android o el navegador del Meta Quest 3. Aquí puedes probarla en modo maqueta.'; return; }
  const ar = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  const vr = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  if (ar || vr) {
    btn.disabled = false;
    const mobile = /Android|iPhone|iPad/i.test(navigator.userAgent) && !/OculusBrowser|Quest/i.test(navigator.userAgent);
    btn.textContent = ar ? (mobile ? 'Entrar en realidad aumentada' : 'Entrar en realidad mixta') : 'Entrar en VR (entrenamiento)';
    status.textContent = ar ? 'Visor compatible con passthrough detectado.' : 'Sin passthrough: se usará la maqueta 3D.';
  } else {
    status.textContent = /Android/i.test(navigator.userAgent)
      ? 'Este celular no tiene realidad aumentada WebXR. Instala/actualiza "Servicios de Google Play para RA" (ARCore) y usa Chrome.'
      : 'No se detectó un visor XR. Puedes probar la app en modo maqueta.';
  }
}

function setupDom() {
  $('btnXR')?.addEventListener('click', () => {
    if (IOS_MODE) { openIosGuide(); return; }
    enterXR().catch((e) => { $('xrStatus').textContent = `Error al iniciar XR: ${e.message}`; });
  });
  $('btnShowAll')?.addEventListener('click', app.actions.toggleShowAll);
  $('btnAlerts')?.addEventListener('click', app.actions.toggleAlertsOnly);
  $('btnExport')?.addEventListener('click', app.actions.exportJSON);
  $('btnPhoto')?.addEventListener('click', app.actions.openPhotoEditor);
  $('btnNew')?.addEventListener('click', app.actions.newMachine);
  $('btnReset')?.addEventListener('click', async () => {
    const custom = machineIndex.find((e) => e.id === app.machine.id)?.local;
    if (custom) {
      if (!confirm(`¿Eliminar el equipo "${app.machine.name}" de este dispositivo? (exporta el JSON antes si lo quieres conservar)`)) return;
      resetLocalState(app.machine);
      removeCustomMachine(app.machine.id);
      await removeAllPhotos(app.machine.id);
      machineIndex = machineIndex.filter((e) => e.id !== app.machine.id);
      fillSelect(machineIndex[0].id);
      await loadMachine(machineIndex[0]);
      return;
    }
    if (!confirm('¿Volver a los datos originales de este equipo? Se borran puntos registrados, servicios, checklists, foto y componentes agregados en este dispositivo.')) return;
    resetLocalState(app.machine);
    await removeAllPhotos(app.machine.id);
    await loadMachine(machineIndex.find((e) => e.id === app.machine.id) ?? machineIndex[0]);
  });
  $('btnPanel')?.addEventListener('click', () => document.body.classList.toggle('panel-collapsed'));
  $('machineSelect')?.addEventListener('change', (e) => loadMachine(machineIndex.find((m) => m.id === e.target.value)));
  $('hourMeter')?.addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 0) return;
    app.machine.hourMeter = v;
    saveHourMeter(app.machine);
    for (const l of app.labels) l.redraw();
    refreshUI();
    updateDomInfo();
  });
  $('fileInput')?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.id || !Array.isArray(data.components)) throw new Error('Falta "id" o "components"');
      const { photoData, photosData, ...machine } = data;
      const legacyView = migratePhotos(machine);
      if (photoData) await savePhoto(photoKey(machine.id, legacyView ?? 'izq'), await dataURLToBlob(photoData));
      for (const [v, url] of Object.entries(photosData ?? {})) if (VIEWS[v]) await savePhoto(photoKey(machine.id, v), await dataURLToBlob(url));
      saveLocalMachine(machine);
      const builtIn = machineIndex.find((m) => m.id === machine.id && !m.local);
      if (!builtIn) {
        addCustomMachine(machine);
        machineIndex = machineIndex.filter((m) => m.id !== machine.id).concat({ id: machine.id, name: machine.name, local: true });
      }
      fillSelect(machine.id);
      await loadMachine(machineIndex.find((m) => m.id === machine.id));
    } catch (err) {
      alert(`JSON inválido: ${err.message}`);
    }
    e.target.value = '';
  });

  // Clic con el mouse en modo PC (sin arrastre)
  let down = null;
  const ndc = new THREE.Vector2();
  const toNdc = (e) => ndc.set((e.clientX / window.innerWidth) * 2 - 1, -(e.clientY / window.innerHeight) * 2 + 1);
  renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (state.xr || !down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) return;
    raycaster.setFromCamera(toNdc(e), camera);
    const hit = pick();
    if (hit) activate(hit); else detail.close();
  });
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (state.xr || e.buttons) return;
    raycaster.setFromCamera(toNdc(e), camera);
    renderer.domElement.style.cursor = pick() ? 'pointer' : '';
  });
  window.addEventListener('resize', () => {
    if (state.xr) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

// --- iPhone: guía + modelo USDZ para AR Quick Look ---------------------------------
let iosUsdzUrl = null;

/** Imagen del botón: Quick Look exige que el enlace <a rel="ar"> contenga solo una imagen. */
function arButtonImage(text) {
  const c = document.createElement('canvas');
  c.width = 900; c.height = 150;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#ffb000';
  ctx.beginPath(); ctx.roundRect ? ctx.roundRect(0, 0, 900, 150, 30) : ctx.rect(0, 0, 900, 150); ctx.fill();
  ctx.fillStyle = '#111'; ctx.font = '700 52px system-ui, -apple-system, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 450, 78);
  return c.toDataURL('image/png');
}

async function openIosGuide() {
  const m = app.machine;
  const el = ensureEl('iosGuide', '<section id="iosGuide" hidden></section>');
  const pg = photoGuide(app);
  const ref = m.reference ?? {};
  const placed = m.components.filter((c) => Array.isArray(c.position)).length;
  el.innerHTML = `<header><h2>Realidad aumentada en iPhone</h2><button data-close aria-label="Cerrar">✕</button></header>
    <p>Se abre el visor de realidad aumentada de Apple con <b>${escapeHtml(m.name)}</b> a <b>tamaño real</b>, con ${placed} carteles y dos discos naranjas en el suelo: <b>1</b> (adelante) y <b>2</b> (atrás).</p>
    <canvas class="croquis big"></canvas>
    ${pg ? `<div class="guide-photo"><img src="${pg.url}" alt="Foto del equipo"><i style="left:${pg.p1[0] * 100}%;top:${pg.p1[1] * 100}%">1</i><i class="two" style="left:${pg.p2[0] * 100}%;top:${pg.p2[1] * 100}%">2</i></div>` : ''}
    <ol>
      <li>Toca el botón de abajo y mueve el iPhone apuntando al suelo hasta que aparezca el modelo. Aléjate unos metros para ver el equipo completo.</li>
      <li><b>Arrastra</b> el modelo con un dedo y <b>gíralo</b> con dos dedos hasta que el disco <b>1</b> quede en el suelo bajo el extremo más adelantado${ref.frontHint ? ` (${escapeHtml(ref.frontHint)})` : ''} y el disco <b>2</b> bajo el más atrasado${ref.rearHint ? ` (${escapeHtml(ref.rearHint)})` : ''}. El contorno azul debe calzar con la máquina.</li>
      <li>Recorre la máquina: cada cartel muestra el estado, el próximo servicio y los datos clave. Para la ficha completa (pasos, checklist, repuestos) cierra el visor y toca el componente en la app.</li>
    </ol>
    <p class="muted">La escala está fija en 100 % para que no se deforme al moverlo. Si el modelo no coincide en tamaño, revisa las medidas del equipo o las fotos.</p>
    <div id="iosArSlot"><p class="muted">Preparando el modelo 3D…</p></div>`;
  el.hidden = false;
  el.querySelector('[data-close]').onclick = () => { el.hidden = true; };
  const canvas = el.querySelector('canvas.croquis');
  const r = canvas.getBoundingClientRect();
  if (r.width) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = r.width * dpr; canvas.height = r.height * dpr;
    const ctx = canvas.getContext('2d'); ctx.scale(dpr, dpr);
    drawCroquis(ctx, m, 0, 0, r.width, r.height, { step: 0, views: 'both', frontLeft: frontLeftIn(app) });
  }
  try {
    const blob = await exportUSDZ(m);
    if (app.machine !== m) return;
    if (iosUsdzUrl) URL.revokeObjectURL(iosUsdzUrl);
    iosUsdzUrl = URL.createObjectURL(blob);
    app._lastUsdz = blob; // usado por las pruebas automáticas
    const slot = el.querySelector('#iosArSlot');
    slot.innerHTML = `<a id="iosArLink" rel="ar" href="${quickLookHref(iosUsdzUrl, m)}"><img src="${arButtonImage('Abrir en realidad aumentada')}" alt="Abrir en realidad aumentada"></a>
      <p class="muted">Modelo listo (${Math.max(1, Math.round(blob.size / 1024))} kB).${supportsQuickLook() ? '' : ' Este navegador no abre el visor de Apple: usa Safari en un iPhone o iPad.'}</p>
      <a class="button" download="${escapeHtml(m.id)}.usdz" href="${iosUsdzUrl}">Descargar modelo (.usdz)</a>`;
  } catch (err) {
    console.error(err);
    el.querySelector('#iosArSlot').innerHTML = `<p class="crit">No se pudo generar el modelo: ${escapeHtml(err.message)}</p>`;
  }
}

function fillSelect(selectedId) {
  $('machineSelect').innerHTML = machineIndex.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
  $('machineSelect').value = selectedId;
}

export const APP_VERSION = 'Android 10';

async function init() {
  try { setupDom(); } catch (e) { console.error(e); }
  syncDomButtons();
  checkXR();
  try {
    machineIndex = await fetchJSON('data/machines.json');
    for (const m of getCustomMachines()) if (!machineIndex.some((x) => x.id === m.id)) machineIndex.push(m);
    const params = new URLSearchParams(location.search);
    if (params.get('data')) machineIndex.unshift({ id: 'url', name: 'Equipo desde URL', file: params.get('data') });
    const wanted = params.get('equipo') ?? store.get('lastMachine', null);
    const entry = machineIndex.find((m) => m.id === wanted) ?? machineIndex[0];
    fillSelect(entry.id);
    await loadMachine(entry);
    document.body.classList.add('ready');
    const v = $('appVersion'); if (v) v.textContent = `versión ${APP_VERSION}`;
  } catch (e) {
    $('xrStatus').textContent = `No se pudo cargar el equipo: ${e.message}`;
    console.error(e);
  }
}

init();
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
app.openDetail = openDetail;
app._debug = { camera, controls }; // usado por las pruebas automáticas
window.__app = app; // útil para depurar desde la consola
