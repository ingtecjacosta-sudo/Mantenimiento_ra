// Asistente de mantenimiento en realidad mixta para Meta Quest 3 (WebXR + Three.js).
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { XRHandModelFactory } from 'three/addons/webxr/XRHandModelFactory.js';
import { ComponentLabel } from './labels.js';
import { DetailWindow, Toolbar, Hud } from './ui.js';
import { buildPreview, disposeTree } from './preview.js';
import {
  store, fetchJSON, applyLocalState, savePoint, saveService, saveHourMeter, setChecklist,
  resetLocalState, exportMachine, downloadJSON,
} from './data.js';

// --- Parámetros de visibilidad de carteles -----------------------------------
const FOCUS_ANGLE = 14;      // grados: el cartel que miras de frente se expande
const COMPACT_ANGLE = 42;    // grados: carteles compactos dentro de este cono
const MAX_COMPACT = 10;      // máximo de carteles compactos simultáneos (modo Auto)

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
};
const app = { state, machine: null, labels: [], actions: {} };
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
  if (panel && panel.regions.length && panel.click(hit.uv)) { toolbar.render(); return true; }
  if (o.userData.label) { openDetail(o.userData.label); return true; }
  return !!panel?.consumesClicks;
}

function onSelect(c) {
  activeController = c;
  setRayFromController(c);
  const hit = pick();
  if (hit && activate(hit)) return;
  if (state.mode === 'place' && reticle.visible) confirmPlacement();
  else if (state.mode === 'register' && registerTip.visible) registerPoint();
}

function openDetail(label) {
  for (const l of app.labels) l.highlight = false;
  label.highlight = true;
  detail.open(label, camPos, camQuat);
}

// --- Ubicación del equipo (alinear el modelo con la máquina real) -------------
let anchor = null;            // XRAnchor que mantiene el equipo fijo en el espacio real
let anchorDueAt = 0;          // cuándo (re)crear el ancla tras un ajuste
const refOffset = new THREE.Vector3();

function startPlace() {
  if (!state.xr) return;
  detail.close();
  state.mode = 'place';
  state.placeYawOffset = 0;
  reticleGhost.visible = true;
  hud.show('Apunta al punto de referencia en el suelo y presiona el gatillo', 6);
  toolbar.render();
}

function updatePlacement() {
  const c = activeController;
  if (!c?.userData.inputSource) { reticle.visible = false; return; }
  let ok = false;
  if (c.userData.hasHit) {
    tmpV.setFromMatrixPosition(c.userData.hitMatrix);
    ok = true;
  } else {
    setRayFromController(c);
    ok = !!raycaster.ray.intersectPlane(floorPlane, tmpV) && tmpV.distanceTo(raycaster.ray.origin) < 30;
  }
  reticle.visible = ok;
  if (!ok) return;
  reticle.position.lerp(tmpV, reticle.userData.init ? 0.5 : 1);
  reticle.userData.init = true;
  // Por defecto el frente del equipo (+Z) mira hacia el técnico.
  const baseYaw = Math.atan2(camPos.x - reticle.position.x, camPos.z - reticle.position.z);
  reticle.rotation.set(0, baseYaw + state.placeYawOffset, 0);
}

function confirmPlacement() {
  machineRoot.quaternion.copy(reticle.quaternion);
  machineRoot.position.copy(reticle.position).sub(tmpV2.copy(refOffset).applyQuaternion(reticle.quaternion));
  machineRoot.visible = true;
  machineRoot.updateMatrixWorld(true);
  state.placed = true;
  state.mode = 'view';
  reticle.visible = false;
  reticle.userData.init = false;
  dropAnchor();
  anchorDueAt = performance.now() + 300;
  hud.show('Equipo ubicado. Mira las piezas para ver sus carteles.', 4, '#3fb950');
  toolbar.render();
}

/** Gira el equipo alrededor del punto de referencia (afinar la alineación). */
function rotate(deg) {
  const rad = THREE.MathUtils.degToRad(deg);
  if (state.mode === 'place') { state.placeYawOffset += rad; return; }
  if (!state.placed) return;
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
      hud.show('Posición guardada: la próxima vez se ubica sola', 3, '#3fb950');
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
    state.placed = true;
    state.mode = 'view';
    hud.show('Equipo ubicado desde la última sesión. Usa "Ubicar equipo" si no coincide.', 5, '#3fb950');
    toolbar.render();
    return true;
  } catch (e) {
    console.warn('Ancla no encontrada', e);
    store.del(`${app.machine.id}:anchor`);
    return false;
  }
}

// --- Registro de puntos de componentes ----------------------------------------
function startRegister() {
  if (!state.placed) { hud.show('Primero ubica el equipo', 3, '#e3b341'); return; }
  detail.close();
  state.mode = 'register';
  const firstMissing = app.machine.components.findIndex((c) => !Array.isArray(c.position));
  state.registerIndex = firstMissing >= 0 ? firstMissing : 0;
  state.showAll = true;
  toolbar.render();
}

function updateRegisterTip() {
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
  hud.show(`✔ ${comp.name} registrado`, 2.5, '#3fb950');
  if (state.registerIndex < app.machine.components.length - 1) state.registerIndex++;
  toolbar.render();
  updateDomInfo();
}

function registerStep(d) {
  const n = app.machine.components.length;
  state.registerIndex = (state.registerIndex + d + n) % n;
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
  hud.show(missing ? `Listo. ${missing} componentes sin punto.` : 'Todos los puntos registrados. Puedes exportar el JSON.', 4);
}

// --- Acciones (usadas por el menú del visor y por los botones de la PC) -------
Object.assign(app.actions, {
  startPlace,
  cancelPlace: () => { state.mode = 'view'; reticle.visible = false; reticle.userData.init = false; },
  rotate,
  startRegister, registerStep, clearPoint, finishRegister,
  toggleShowAll: () => { state.showAll = !state.showAll; syncDomButtons(); },
  toggleAlertsOnly: () => { state.alertsOnly = !state.alertsOnly; syncDomButtons(); },
  toggleGuide: () => { state.showGuide = !state.showGuide; applyVisibility(); },
  exitXR: () => renderer.xr.getSession()?.end(),
  exportJSON: () => downloadJSON(exportMachine(app.machine), `${app.machine.id}.json`),
  registerService: (label) => {
    const c = label.comp;
    c.maintenance.lastServiceHours = app.machine.hourMeter;
    saveService(app.machine, c);
    setChecklist(app.machine, c, []);
    label.redraw();
    detail.render();
    toolbar.render();
    updateDomInfo();
    hud.show(`Servicio registrado: ${c.name}`, 3, '#3fb950');
  },
});

// --- Carga del equipo ------------------------------------------------------------
async function loadMachine(entry) {
  const data = entry.data ?? await fetchJSON(entry.file);
  const machine = applyLocalState(data);
  app.machine = machine;
  store.set('lastMachine', machine.id);

  for (const l of app.labels) { machineRoot.remove(l.group); l.dispose(); }
  machineRoot.remove(preview.solid, preview.guide);
  reticleGhost.clear();
  disposeTree(preview.solid); disposeTree(preview.guide);

  preview = buildPreview(machine);
  machineRoot.add(preview.solid, preview.guide);
  refOffset.fromArray(machine.reference?.offset ?? [0, 0, 0]);
  const ghost = preview.guide.clone();
  ghost.position.copy(refOffset).negate();
  reticleGhost.add(ghost);

  app.labels = machine.components.map((c) => new ComponentLabel(c, machine));
  for (const l of app.labels) machineRoot.add(l.group);
  detail.close();
  toolbar.render();
  applyVisibility();
  updateDomInfo();
}

function applyVisibility() {
  preview.solid.visible = !state.arMode;
  preview.guide.visible = state.arMode && state.showGuide;
  environment.visible = !state.arMode;
  scene.background = state.arMode ? null : DESKTOP_BG;
  toolbar.mesh.visible = state.xr;
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
    if (detail.isOpen && detail.label === i.l) s = 'compact';
    const scale = state.xr ? THREE.MathUtils.clamp(i.d / 2.2, 0.55, 2.6) : THREE.MathUtils.clamp(i.d / 3.2, 1, 6);
    i.l.update(dt, camPos, s, scale);
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
  hud.update(dt, camPos, camQuat, state.xr);
  renderer.render(scene, camera);
});

function xrFrame(frame, dt) {
  const ref = renderer.xr.getReferenceSpace();
  const session = frame.session;
  const pose = frame.getViewerPose(ref);
  if (pose) { camPos.copy(pose.transform.position); camQuat.copy(pose.transform.orientation); }

  for (const c of controllers) {
    c.userData.hasHit = false;
    if (!c.userData.hitSource) continue;
    const results = frame.getHitTestResults(c.userData.hitSource);
    const hp = results[0]?.getPose(ref);
    if (hp) { c.userData.hitMatrix.fromArray(hp.transform.matrix); c.userData.hasHit = true; }
  }

  // Ancla: crear tras ubicar/ajustar, y seguirla cada cuadro (corrige la deriva del tracking)
  if (anchorDueAt && performance.now() > anchorDueAt) { anchorDueAt = 0; createAnchor(frame); }
  if (anchor && !anchorDueAt) {
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
    if (state.mode === 'place' && Math.abs(ax) > 0.25) state.placeYawOffset -= ax * dt * 1.2;
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
    requiredFeatures: ['local-floor'],
    optionalFeatures: ['hit-test', 'anchors', 'hand-tracking'],
  });
  savedDesktopView = { pos: camera.position.clone(), target: controls.target.clone() };
  session.addEventListener('end', onSessionEnd);
  await renderer.xr.setSession(session);

  state.xr = true;
  state.arMode = mode === 'immersive-ar';
  state.placed = false;
  controls.enabled = false;
  machineRoot.visible = false;
  machineRoot.position.set(0, 0, 0);
  machineRoot.quaternion.identity();
  hud.follower.reset();
  toolbar.follower.reset();
  document.body.classList.add('in-xr');
  applyVisibility();
  if (!(await restoreAnchor(session))) startPlace();
  toolbar.render();
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
  if (savedDesktopView) { camera.position.copy(savedDesktopView.pos); controls.target.copy(savedDesktopView.target); }
  for (const c of controllers) onControllerDisconnected(c);
  document.body.classList.remove('in-xr');
  applyVisibility();
}

// --- Interfaz HTML (pantalla de inicio / modo PC) -------------------------------
const $ = (id) => document.getElementById(id);

function updateDomInfo() {
  const m = app.machine;
  $('hourMeter').value = m.hourMeter;
  const alerts = app.labels.filter((l) => l.status !== 'ok');
  const missing = m.components.filter((c) => !Array.isArray(c.position)).length;
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

async function checkXR() {
  const btn = $('btnXR'), status = $('xrStatus');
  btn.textContent = 'Visor XR no detectado';
  if (!window.isSecureContext) { status.textContent = 'WebXR necesita HTTPS (o localhost).'; return; }
  if (!navigator.xr) { status.textContent = 'Este navegador no tiene WebXR. Ábrela en el navegador del Meta Quest 3. Aquí puedes probarla en modo PC.'; return; }
  const ar = await navigator.xr.isSessionSupported('immersive-ar').catch(() => false);
  const vr = await navigator.xr.isSessionSupported('immersive-vr').catch(() => false);
  if (ar || vr) {
    btn.disabled = false;
    btn.textContent = ar ? 'Entrar en realidad mixta' : 'Entrar en VR (entrenamiento)';
    status.textContent = ar ? 'Visor compatible con passthrough detectado.' : 'Sin passthrough: se usará la maqueta 3D.';
  } else {
    status.textContent = 'No se detectó un visor XR. Puedes probar la app en modo PC.';
  }
}

function setupDom() {
  $('btnXR').addEventListener('click', () => enterXR().catch((e) => { $('xrStatus').textContent = `Error al iniciar XR: ${e.message}`; }));
  $('btnShowAll').addEventListener('click', app.actions.toggleShowAll);
  $('btnAlerts').addEventListener('click', app.actions.toggleAlertsOnly);
  $('btnExport').addEventListener('click', app.actions.exportJSON);
  $('btnReset').addEventListener('click', async () => {
    if (!confirm('¿Borrar puntos registrados, servicios y checklists guardados en este dispositivo para este equipo?')) return;
    resetLocalState(app.machine);
    await loadMachine(machineIndex.find((e) => e.id === app.machine.id) ?? machineIndex[0]);
  });
  $('btnPanel').addEventListener('click', () => document.body.classList.toggle('panel-collapsed'));
  $('machineSelect').addEventListener('change', (e) => loadMachine(machineIndex.find((m) => m.id === e.target.value)));
  $('hourMeter').addEventListener('change', (e) => {
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 0) return;
    app.machine.hourMeter = v;
    saveHourMeter(app.machine);
    for (const l of app.labels) l.redraw();
    toolbar.render();
    updateDomInfo();
  });
  $('fileInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!data.id || !Array.isArray(data.components)) throw new Error('Falta "id" o "components"');
      const entry = { id: data.id, name: data.name, data };
      machineIndex = machineIndex.filter((m) => m.id !== data.id).concat(entry);
      fillSelect(data.id);
      await loadMachine(entry);
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

function fillSelect(selectedId) {
  $('machineSelect').innerHTML = machineIndex.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('');
  $('machineSelect').value = selectedId;
}

async function init() {
  setupDom();
  syncDomButtons();
  checkXR();
  try {
    machineIndex = await fetchJSON('data/machines.json');
    const params = new URLSearchParams(location.search);
    if (params.get('data')) machineIndex.unshift({ id: 'url', name: 'Equipo desde URL', file: params.get('data') });
    const wanted = params.get('equipo') ?? store.get('lastMachine', null);
    const entry = machineIndex.find((m) => m.id === wanted) ?? machineIndex[0];
    fillSelect(entry.id);
    await loadMachine(entry);
    document.body.classList.add('ready');
  } catch (e) {
    $('xrStatus').textContent = `No se pudo cargar el equipo: ${e.message}`;
    console.error(e);
  }
}

init();
window.__app = app; // útil para depurar desde la consola
