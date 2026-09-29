// MCC room: 4 line-ups x 5 sections x 6 buckets, bird's-eye default, click to fly in and open a bucket,
// click the contactor for a macro close-up, T toggles an ironbow thermal view driven by the 10 Hz sim.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Bucket, BW, BH, BD, ironbow } from "./bucket.js";
import { Sim } from "./sim.js";

const host = document.getElementById("host");
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .82;
host.append(renderer.domElement);
const css = new CSS2DRenderer(); css.domElement.className = "css2d"; host.append(css.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color(0x9aa3ab), TBG = new THREE.Color(0x06031a);
scene.background = BG.clone(); scene.fog = new THREE.Fog(0x9aa3ab, 22, 48);
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), .04).texture; scene.environmentIntensity = .35;

const camera = new THREE.PerspectiveCamera(38, 1, .02, 200);
const HOME = { pos: new THREE.Vector3(5.6, 5.4, 5.2), target: new THREE.Vector3(0, .9, -3) };
camera.position.copy(HOME.pos);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.copy(HOME.target); controls.enableDamping = true; controls.dampingFactor = .08;
controls.maxPolarAngle = 1.5; controls.minDistance = .12; controls.maxDistance = 40; controls.screenSpacePanning = true;
let flight = null, idle = 0, droneA = null, autoThermal = false;
controls.addEventListener("start", () => { flight = null; idle = 0; droneA = null; stage(""); });

// ---------------------------------------------------------------- lights
scene.add(new THREE.HemisphereLight(0xf4f7fb, 0x6a6f76, .7));
const key = new THREE.DirectionalLight(0xfff3e2, 2.6); key.position.set(6, 12, 7); key.target.position.set(0, 0, -3);
key.castShadow = true; key.shadow.mapSize.set(4096, 4096);
Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 40 }); key.shadow.bias = -.0004; key.shadow.normalBias = .02;
scene.add(key, key.target);
const fill = new THREE.DirectionalLight(0xcfe0f2, .6); fill.position.set(-8, 6, 4); scene.add(fill);

// ---------------------------------------------------------------- textures
function tex(w, h, draw, rep) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  if (rep) t.repeat.set(rep, rep); return t;
}
const concrete = tex(1024, 1024, (g, w, h) => {
  g.fillStyle = "#b9bcbd"; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 26000; i++) { const v = 150 + Math.random() * 70 | 0; g.fillStyle = `rgba(${v},${v},${v - 4},${Math.random() * .18})`; g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 3, 1 + Math.random() * 3); }
  for (let i = 0; i < 40; i++) { const r = g.createRadialGradient(0, 0, 0, 0, 0, 120); const x = Math.random() * w, y = Math.random() * h; g.save(); g.translate(x, y); r.addColorStop(0, "rgba(90,95,100,.08)"); r.addColorStop(1, "rgba(90,95,100,0)"); g.fillStyle = r; g.fillRect(-120, -120, 240, 240); g.restore(); }
  g.strokeStyle = "rgba(60,64,68,.35)"; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
}, 6);

// ---------------------------------------------------------------- room shell (cutaway: two walls)
const room = new THREE.Group(); scene.add(room);
const RW = 22, RD = 18, RZ = -3;
const floor = new THREE.Mesh(new THREE.PlaneGeometry(RW, RD), new THREE.MeshStandardMaterial({ map: concrete, roughness: .28, metalness: .05, color: 0x9a9d9f }));
floor.rotation.x = -Math.PI / 2; floor.position.z = RZ; floor.receiveShadow = true; room.add(floor);
const wallM = new THREE.MeshStandardMaterial({ color: 0xb8bec4, roughness: .9 });
const wallB = new THREE.Mesh(new THREE.BoxGeometry(RW, 4.2, .2), wallM); wallB.position.set(0, 2.1, RZ - RD / 2); wallB.receiveShadow = true; room.add(wallB);
const wallL = new THREE.Mesh(new THREE.BoxGeometry(.2, 4.2, RD), wallM); wallL.position.set(-RW / 2, 2.1, RZ); wallL.receiveShadow = true; room.add(wallL);
const trim = new THREE.MeshStandardMaterial({ color: 0x3d4650, roughness: .6 });
[[RW, .2, .22, 0, .1, RZ - RD / 2 + .02], [.22, .2, RD, -RW / 2 + .02, .1, RZ]].forEach(([w, h, d, x, y, z]) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), trim); m.position.set(x, y, z); room.add(m); });
// yellow aisle lines and black rubber arc-flash mats in front of each line-up
const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c200, roughness: .5 });
const mat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: .95 });

// ---------------------------------------------------------------- line-ups
const cab = new THREE.MeshStandardMaterial({ color: 0xc3c8cd, roughness: .45, metalness: .35 });
const cabIn = new THREE.MeshStandardMaterial({ color: 0x9da4aa, roughness: .5, metalness: .5 });
const plinth = new THREE.MeshStandardMaterial({ color: 0x2a2e33, roughness: .6 });
const SW = BW, SH = 2.3, SD = .5, NS = 5, NB = 6, Y0 = .22;
const LINEUPS = [{ name: "MCC-1", x: -2.1, z: -1.2 }, { name: "MCC-2", x: 2.1, z: -1.2 }, { name: "MCC-3", x: -2.1, z: -5.4 }, { name: "MCC-4", x: 2.1, z: -5.4 }];
const LOADS = [["P-1", "FEED PUMP"], ["F-2", "EXHAUST FAN"], ["CV-3", "CONVEYOR"], ["AG-4", "AGITATOR"], ["CP-5", "AIR COMPRESSOR"], ["P-6", "COOLING WATER PUMP"], ["M-7", "MIXER"], ["B-8", "BLOWER"], ["CT-9", "COOLING TOWER FAN"], ["HP-10", "HYDRAULIC PUMP"]];
const HOT = "MCC-2-S3-B4";
const buckets = new Map(), pickables = [];
const box = (w, h, d, m, x, y, z, parent) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };

LINEUPS.forEach((L, li) => {
  const g = new THREE.Group(); g.position.set(L.x, 0, L.z); scene.add(g); L.group = g;
  const W = SW * NS;
  box(W + .04, .1, SD, plinth, 0, .05, -SD / 2, g);
  box(W + .04, .03, SD + .02, cab, 0, SH + .015, -SD / 2, g);
  box(.03, SH, SD, cab, -W / 2 - .005, SH / 2, -SD / 2, g); box(.03, SH, SD, cab, W / 2 + .005, SH / 2, -SD / 2, g);
  box(W, SH, .02, cabIn, 0, SH / 2, -SD + .01, g);
  box(W, .25, .03, yellow, 0, .001, 1.05, g).scale.y = .004;
  box(W + .3, .01, .9, mat, 0, .005, .5, g);
  for (let s = 0; s < NS; s++) {
    const sx = -W / 2 + SW / 2 + s * SW;
    box(.012, SH, SD, cabIn, sx - SW / 2, SH / 2, -SD / 2, g);
    // horizontal wireway covers top and bottom
    box(SW - .012, Y0 - .1 - .006, .02, cab, sx, .1 + (Y0 - .1) / 2, .005, g);
    const topY = Y0 + NB * BH; box(SW - .012, SH - topY - .006, .02, cab, sx, topY + (SH - topY) / 2, .005, g);
    for (let r = 0; r <= NB; r++) box(SW - .014, .008, SD - .04, cabIn, sx, Y0 + r * BH, -SD / 2, g);
    for (let r = 0; r < NB; r++) {
      const id = `${L.name}-S${s + 1}-B${NB - r}`;
      const ld = LOADS[(li * 13 + s * 7 + r * 3) % LOADS.length];
      const tag = `${ld[0]}${String.fromCharCode(65 + li)}${s + 1}${NB - r}`;
      const b = new Bucket({ id, tag, name: ld[1], lineup: L.name, section: s + 1, row: NB - r, hot: id === HOT, fla: [14, 22, 28, 34, 48][(s + r) % 5] });
      b.group.position.set(sx, Y0 + r * BH + BH / 2, 0); g.add(b.group);
      buckets.set(id, b);
    }
  }
  const el = document.createElement("div"); el.className = "lbl"; el.innerHTML = `${L.name}<small>480V · ${NS * NB} BKT</small>`;
  el.onclick = () => flyTo(new THREE.Vector3(L.x + 1.8, 2.6, L.z + 4.2), new THREE.Vector3(L.x, 1.2, L.z), 1.8, .6);
  const lbl = new CSS2DObject(el); lbl.position.set(0, SH + .35, -SD / 2); g.add(lbl);
});
// placards: DANGER 480 V on each line-up end, section numbers on the top wireway
function plate(w, h, draw) { const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return new THREE.MeshStandardMaterial({ map: t, roughness: .55 }); }
const danger = plate(256, 180, (g, w, h) => { g.fillStyle = "#fff"; g.fillRect(0, 0, w, h); g.fillStyle = "#d4101a"; g.fillRect(0, 0, w, 56); g.fillStyle = "#111"; g.fillRect(0, 56, w, 4);
  g.fillStyle = "#fff"; g.font = "bold 40px Arial"; g.textAlign = "center"; g.fillText("DANGER", w / 2, 43); g.fillStyle = "#111"; g.font = "bold 34px Arial"; g.fillText("480 VOLTS", w / 2, 102); g.font = "bold 19px Arial"; g.fillText("ARC FLASH HAZARD", w / 2, 134); g.font = "16px Arial"; g.fillText("PPE CAT 2 · 8 cal/cm²", w / 2, 162); });
const secMats = [1, 2, 3, 4, 5].map((n) => plate(128, 48, (g, w, h) => { g.fillStyle = "#1c1f23"; g.fillRect(0, 0, w, h); g.fillStyle = "#e8e8e8"; g.font = "bold 28px Arial"; g.textAlign = "center"; g.fillText("SEC " + n, w / 2, 34); }));
LINEUPS.forEach((L) => {
  const W = SW * NS;
  for (const side of [-1, 1]) { const d = new THREE.Mesh(new THREE.PlaneGeometry(.34, .24), danger); d.position.set(side * (W / 2 + .022), 1.55, -SD / 2); d.rotation.y = side * Math.PI / 2; L.group.add(d); }
  for (let s = 0; s < NS; s++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(.2, .075), secMats[s]); m.position.set(-W / 2 + SW / 2 + s * SW, Y0 + NB * BH + .14, .017); L.group.add(m); }
});
const seam = new THREE.MeshStandardMaterial({ color: 0x55595d, roughness: .8 });
for (let x = -10; x <= 10; x += 2.5) { const m = new THREE.Mesh(new THREE.BoxGeometry(.012, .002, RD), seam); m.position.set(x, .001, RZ); scene.add(m); }
for (let z = RZ - 8.5; z <= RZ + 8.5; z += 2.5) { const m = new THREE.Mesh(new THREE.BoxGeometry(RW, .002, .012), seam); m.position.set(0, .001, z); scene.add(m); }
scene.updateMatrixWorld(true);
for (const b of buckets.values()) b.group.traverse((o) => { if (o.isMesh) pickables.push(o); });

// cable trays above the line-ups, with drops into each line-up
const trayM = new THREE.MeshStandardMaterial({ color: 0xa6adb3, roughness: .4, metalness: .8 });
const cableM = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: .7 });
for (const z of [-1.45, -5.65]) {
  const t = new THREE.Group(); t.position.set(0, 3.05, z); scene.add(t);
  box(8.8, .08, .03, trayM, 0, 0, -.22, t); box(8.8, .08, .03, trayM, 0, 0, .22, t);
  for (let x = -4.3; x <= 4.3; x += .3) box(.03, .02, .44, trayM, x, -.03, 0, t);
  for (let i = 0; i < 6; i++) { const c = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, 8.6, 8), cableM); c.rotation.z = Math.PI / 2; c.position.set(0, .0, -.15 + i * .06); t.add(c); }
  for (const x of [-2.1, 2.1]) { const d = new THREE.Mesh(new THREE.CylinderGeometry(.05, .05, .72, 10), cableM); d.position.set(x, -.38, 0); t.add(d); }
}
// overhead LED fixtures
const ledM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 2.2 });
for (const x of [-4.5, 0, 4.5]) for (const z of [0.8, -3.3, -7.4]) { const l = new THREE.Mesh(new THREE.BoxGeometry(1.2, .04, .25), ledM); l.position.set(x, 3.9, z); scene.add(l); }
// props: transformer, fire extinguisher, panelboard on wall, door
const xf = new THREE.MeshStandardMaterial({ color: 0x5f6b58, roughness: .55, metalness: .3 });
box(1.6, 1.8, 1.2, xf, -8.6, .9, -9.5, scene); for (let i = 0; i < 7; i++) box(.05, 1.3, 1.25, xf, -9.2 + i * .2, .9, -9.5, scene);
const red = new THREE.MeshStandardMaterial({ color: 0xc81d14, roughness: .35 });
const fe = new THREE.Mesh(new THREE.CylinderGeometry(.09, .09, .55, 16), red); fe.position.set(-10.7, .45, -3); fe.castShadow = true; scene.add(fe);
box(.8, 1.2, .2, cab, 5.5, 1.5, -11.85, scene); box(.6, .9, .02, new THREE.MeshStandardMaterial({ color: 0x2b2f35 }), 5.5, 1.5, -11.74, scene);
box(1.2, 2.3, .06, new THREE.MeshStandardMaterial({ color: 0x3a4a5c, roughness: .5, metalness: .3 }), -10.86, 1.15, 2.5, scene).rotation.y = Math.PI / 2;
scene.traverse((o) => { if (o.isMesh && !o.userData.bucket) o.userData.static = true; });

// ---------------------------------------------------------------- sim
const sim = new Sim([...buckets.values()], HOT);
let simAcc = 0, selected = null, thermal = false, macro = false, thermalT0 = 0;
function tickSim() {
  const S = sim.step(.1);
  let run = 0, alarms = 0;
  for (const [id, s] of S) { buckets.get(id).apply(s); if (s.running) run++; if (Math.max(s.temps.L1, s.temps.L2, s.temps.L3) > 60) alarms++; }
  document.getElementById("c-run").textContent = `${run}/${buckets.size}`;
  document.getElementById("c-alarm").textContent = alarms;
  document.getElementById("st-alarm").classList.toggle("blink", alarms > 0);
  if (thermal) { const r = sim.t - thermalT0; document.getElementById("rec").textContent = `IR REC ${String(Math.floor(r / 60)).padStart(2, "0")}:${String(Math.floor(r % 60)).padStart(2, "0")}`; }
  document.getElementById("c-t").textContent = sim.t.toFixed(1) + "s";
  hotLabels(S);
}
for (let i = 0; i < 20; i++) sim.step(.1);
for (const [id, s] of sim.s) buckets.get(id).apply(s);

// floating labels for hot buckets in thermal view
const hotL = new Map();
function hotLabels(S) {
  for (const [id, s] of S) {
    const mx = Math.max(s.temps.L1, s.temps.L2, s.temps.L3), b = buckets.get(id);
    let l = hotL.get(id);
    if (mx > 55 && !l) {
      const el = document.createElement("div"); el.className = "hotlbl"; el.onclick = (e) => { e.stopPropagation(); select(b); };
      l = new CSS2DObject(el); l.position.set(0, .22, .05); b.group.add(l); hotL.set(id, l);
    }
    if (l) { l.visible = thermal && mx > 55 && selected !== b; l.element.textContent = `${b.lineup} S${b.section}·B${b.row}  ${mx.toFixed(1)} °C`; }
  }
}

// ---------------------------------------------------------------- thermal view
function setThermal(on) {
  thermal = on; thermalT0 = sim.t; document.body.classList.toggle("thermal", on); document.getElementById("b-thermal").classList.toggle("on", on);
  scene.background.copy(on ? TBG : BG); scene.fog.color.copy(on ? TBG : BG);
  scene.traverse((o) => {
    if (!o.isMesh || !o.userData.static) return;
    if (on) { o.userData.orig = o.userData.orig || o.material; o.material = new THREE.MeshBasicMaterial({ color: ironbow(24 + o.getWorldPosition(new THREE.Vector3()).y * 1.4 + (o === floor ? -1 : 0)), fog: true }); }
    else if (o.userData.orig) { o.material.dispose(); o.material = o.userData.orig; }
  });
  for (const b of buckets.values()) b.setThermal(on);
  hotLabels(sim.s);
}
const scaleEl = document.getElementById("scale");
scaleEl.innerHTML = '<div class="grad"></div>' + [80, 70, 60, 50, 40, 30, 20].map((t, i) => `<span style="top:calc(${i / 6 * 100}% - 7px)">${t}°C</span>`).join("");

// ---------------------------------------------------------------- camera flights
const ease = (u) => u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
const stageEl = document.getElementById("stage");
function stage(t) { stageEl.textContent = t; stageEl.classList.toggle("on", !!t); }
// a flight is a list of legs; each leg eases from wherever the camera is to pos/target, arcing up by `lift`
function flyPath(legs) { flight = { legs, i: 0 }; startLeg(); }
function startLeg() {
  const L = flight.legs[flight.i]; flight.t = 0; flight.done = false;
  flight.fp = camera.position.clone(); flight.ft = controls.target.clone();
  L.onStart && L.onStart(); stage(L.label || "");
}
function flyTo(pos, target, dur = 1.6, lift = 0, label = "") { flyPath([{ pos: pos.clone(), target: target.clone(), dur, lift, label }]); }
function stepFlight(dt) {
  const L = flight.legs[flight.i]; flight.t += dt;
  const u = Math.min(1, flight.t / L.dur), e = ease(u);
  camera.position.lerpVectors(flight.fp, L.pos, e); camera.position.y += Math.sin(Math.PI * e) * (L.lift || 0);
  controls.target.lerpVectors(flight.ft, L.target, e);
  if (u >= 1 && !flight.done) { flight.done = true; L.onArrive && L.onArrive(); }
  if (flight.t >= L.dur + (L.hold || 0)) { if (++flight.i < flight.legs.length) startLeg(); else { flight = null; setTimeout(() => !flight && stage(""), 900); } }
}
function bucketView(b) {
  const c = b.group.getWorldPosition(new THREE.Vector3());
  return { pos: c.clone().add(new THREE.Vector3(.12, .03, .62)), target: c.clone().add(new THREE.Vector3(0, -.01, -.22)) };
}
function macroPose(b) {
  const c = b.group.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, -.005, -BD + .075));
  return { pos: c.clone().add(new THREE.Vector3(.04, .03, .19)), target: c.clone().add(new THREE.Vector3(0, .012, 0)) };
}
// three-stage zoom: 1 approach the line-up, 2 bucket front while the door swings open, 3 K1 macro in thermal
function select(b) {
  if (selected && selected !== b) selected.setOpen(false);
  if (!b) {
    selected = null; macro = false; renderPanel();
    if (autoThermal && thermal) setThermal(false); autoThermal = false;
    flyPath([{ pos: HOME.pos.clone(), target: HOME.target.clone(), dur: 2.4, lift: 1.4, label: "RETURNING TO OVERVIEW" }]);
    return;
  }
  selected = b; macro = false; renderPanel();
  const c = b.group.getWorldPosition(new THREE.Vector3()), v = bucketView(b), m = macroPose(b);
  flyPath([
    { pos: c.clone().add(new THREE.Vector3(1.5, 1.1, 3.1)), target: c.clone().add(new THREE.Vector3(0, -.15, 0)), dur: 1.7, lift: .9, hold: .3, label: `1 / 3 · ${b.lineup} · SECTION ${b.section}` },
    { pos: v.pos, target: v.target, dur: 1.4, hold: .7, label: `2 / 3 · BUCKET ${b.row} · ${b.tag} ${b.name}`, onStart: () => b.setOpen(true) },
    { pos: m.pos, target: m.target, dur: 1.5, label: "3 / 3 · K1 CONTACTOR · THERMAL SCAN", onArrive: () => { macro = true; if (!thermal) { autoThermal = true; setThermal(true); } } },
  ]);
}
function macroView(b) {
  const m = macroPose(b);
  flyPath([{ pos: m.pos, target: m.target, dur: 1.3, label: "K1 CONTACTOR", onArrive: () => { macro = true; } }]);
}

// ---------------------------------------------------------------- picking
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(), tip = document.getElementById("tip");
function pick(x, y) {
  const r = renderer.domElement.getBoundingClientRect();
  ptr.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1); ray.setFromCamera(ptr, camera);
  const h = ray.intersectObjects(pickables, false)[0];
  return h && h.object.userData.bucket ? { b: h.object.userData.bucket, part: h.object.userData.pick } : null;
}
let down = null;
renderer.domElement.addEventListener("pointerdown", (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; });
renderer.domElement.addEventListener("pointerup", (e) => {
  if (!down) return; const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y), quick = performance.now() - down.t < 450; down = null;
  if (moved > 6 || !quick) return;
  const h = pick(e.clientX, e.clientY); if (!h) return;
  if (h.b !== selected) select(h.b); else if (h.part === "contactor") macroView(h.b); else if (macro) { macro = false; const v = bucketView(h.b); flyTo(v.pos, v.target, 1.2, 0, "BUCKET VIEW"); }
});
let lastMove = 0;
renderer.domElement.addEventListener("pointermove", (e) => {
  const now = performance.now(); if (now - lastMove < 50) return; lastMove = now;
  const h = pick(e.clientX, e.clientY);
  renderer.domElement.style.cursor = h ? "pointer" : "grab";
  if (h) {
    const s = h.b.state, mx = s ? Math.max(s.temps.L1, s.temps.L2, s.temps.L3) : 0;
    tip.style.display = "block"; tip.style.left = e.clientX + 14 + "px"; tip.style.top = e.clientY + 12 + "px";
    tip.innerHTML = h.part === "contactor" ? `<b>K1 contactor</b> · click for close-up` : `<b>${h.b.tag}</b> ${h.b.name}<br>${h.b.lineup} · S${h.b.section} · B${h.b.row} · ${s && s.running ? "running" : "stopped"} · ${mx.toFixed(1)} °C`;
  } else tip.style.display = "none";
});
document.getElementById("b-home").onclick = () => select(null);
document.getElementById("b-thermal").onclick = () => setThermal(!thermal);
addEventListener("keydown", (e) => { if (e.key === "t" || e.key === "T") setThermal(!thermal); if (e.key === "Escape") select(null); });

// ---------------------------------------------------------------- panel
const panel = document.getElementById("panel");
let finding = null;
fetch("./fixtures/inspection.json").then((r) => r.json()).then((j) => { finding = j; renderPanel(); }).catch(() => {});
const tc = (t) => t > 60 ? "var(--crit)" : t > 48 ? "var(--warn)" : "var(--ok)";
function renderPanel() {
  if (!selected) {
    const list = [...sim.s.values()].map((s) => ({ s, b: buckets.get(s.id), mx: Math.max(s.temps.L1, s.temps.L2, s.temps.L3) })).sort((a, b) => b.mx - a.mx).slice(0, 6);
    panel.innerHTML = `<h2>MCC Room <small>01</small></h2><div class="sub">4 LINE-UPS · 20 SECTIONS · 120 BUCKETS · AMB ${sim.amb}°C</div>
      <h3>Hottest terminals</h3>` + list.map(({ b, s, mx }) => `<div class="hot" data-id="${b.id}"><div class="row"><span><b>${b.tag}</b> ${b.name}</span><span class="num" style="color:${tc(mx)}">${mx.toFixed(1)} °C</span></div>
      <div class="sub">${b.lineup} · S${b.section} · B${b.row} · ${s.running ? "running" : "stopped"}</div><div class="bar"><i style="width:${Math.min(100, (mx - 20) / 60 * 100)}%;background:${tc(mx)}"></i></div></div>`).join("")
      + `<h3>Line-ups</h3><div class="legend">${LINEUPS.map((L) => { const n = [...sim.s.values()].filter((s) => s.id.startsWith(L.name) && s.running).length; return `<span style="color:var(--fg)">${L.name}</span><span>${n}/30 running</span>`; }).join("")}</div>
      <h3>Thermal scale</h3><div class="legend"><i style="background:var(--ok)"></i><span>&lt; 48 °C normal</span><i style="background:var(--warn)"></i><span>48–60 °C watch</span><i style="background:var(--crit)"></i><span>&gt; 60 °C hot joint</span></div>`;
    panel.querySelectorAll(".hot").forEach((el) => el.onclick = () => select(buckets.get(el.dataset.id)));
    return;
  }
  const b = selected, s = b.state, T = s.temps;
  const dT = Math.max(T.L1, T.L2, T.L3) - Math.min(T.L1, T.L2, T.L3);
  panel.innerHTML = `<h2>${b.tag} <small>K1</small></h2><div style="font-weight:600;margin-top:2px">${b.name}</div><div class="sub">${b.lineup} · SEC ${b.section} · BKT ${b.row} · ${b.fla} A FLA</div>
    <div style="margin-top:8px"><span class="pill ${s.running ? "run" : "stop"}">${s.running ? "RUNNING" : "STOPPED"}</span> <span class="sub">load <span class="num" id="p-load"></span></span></div>
    <h3>Phase current</h3>${["L1", "L2", "L3"].map((p, i) => `<div class="row"><span>${p}</span><span class="num" id="p-a${i}"></span></div>`).join("")}
    <h3>Terminal temperature</h3>${["L1", "L2", "L3"].map((p) => `<div><div class="row"><span>${p} line terminal</span><span class="num" id="p-${p}"></span></div><div class="bar"><i id="pb-${p}"></i></div></div>`).join("")}
    <div class="row" style="margin-top:6px"><span>Phase-to-phase ΔT</span><span class="num" id="p-dt"></span></div>
    <h3>Hottest terminal · last 2 min</h3><canvas class="spark" id="spark" width="600" height="140"></canvas>
    ${b.hot && finding ? `<div class="find"><div class="tag">SIMULATED INSPECTION FINDING</div><div style="margin:4px 0"><b>${finding.finding}</b></div>
      <div class="sub">Severity: <b style="color:var(--crit)">${finding.severity}</b></div><div class="sub">Likely cause: ${finding.likely_cause}</div><div class="sub">Action: ${finding.action}</div><div class="sub">Camera: ${finding.camera}, ε ${finding.emissivity}</div></div>`
      : `<div class="sub" style="margin-top:8px">${dT > 15 ? "ΔT above 15 °C between phases: investigate." : "No thermal anomaly on this bucket."}</div>`}
    <div class="acts"><button class="btn" id="p-macro">Close-up K1</button><button class="btn" id="p-close">Close door</button></div>`;
  panel.querySelector("#p-macro").onclick = () => macroView(b);
  panel.querySelector("#p-close").onclick = () => select(null);
  livePanel();
}
function livePanel() {
  if (!selected) return;
  const s = selected.state, T = s.temps, $ = (id) => document.getElementById(id);
  if (!$("p-load")) return;
  $("p-load").textContent = Math.round(s.load * 100) + "%";
  s.amps.forEach((a, i) => $("p-a" + i).textContent = a.toFixed(1) + " A");
  for (const p of ["L1", "L2", "L3"]) { $("p-" + p).textContent = T[p].toFixed(1) + " °C"; $("p-" + p).style.color = tc(T[p]); const bar = $("pb-" + p); bar.style.width = Math.min(100, (T[p] - 20) / 60 * 100) + "%"; bar.style.background = tc(T[p]); }
  const dT = Math.max(T.L1, T.L2, T.L3) - Math.min(T.L1, T.L2, T.L3); $("p-dt").textContent = dT.toFixed(1) + " °C"; $("p-dt").style.color = dT > 15 ? "var(--crit)" : "inherit";
  const cv = $("spark"), g = cv.getContext("2d"), h = s.hist, W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H); g.strokeStyle = "rgba(255,255,255,.08)"; g.lineWidth = 1;
  for (const t of [30, 45, 60, 75]) { const y = H - (t - 20) / 60 * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); g.fillStyle = "rgba(255,255,255,.35)"; g.font = "18px Segoe UI"; g.fillText(t + "°", 4, y - 3); }
  if (h.length > 1) {
    g.beginPath(); h.forEach((v, i) => { const x = i / 239 * W, y = H - (v - 20) / 60 * H; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    const last = h[h.length - 1]; g.strokeStyle = tc(last).startsWith("var") ? getComputedStyle(document.body).getPropertyValue(tc(last).slice(4, -1)) : tc(last); g.lineWidth = 3; g.stroke();
    const lx = (h.length - 1) / 239 * W, ly = H - (last - 20) / 60 * H; g.fillStyle = g.strokeStyle; g.beginPath(); g.arc(lx, ly, 6, 0, 7); g.fill();
  }
}

// ---------------------------------------------------------------- loop
function resize() { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h); css.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();
const clock = new THREE.Clock(); let panelAcc = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(.05, clock.getDelta());
  simAcc += dt; while (simAcc >= .1) { simAcc -= .1; tickSim(); }
  panelAcc += dt; if (panelAcc > .25) { panelAcc = 0; selected ? livePanel() : (Math.random() < .15 && renderPanel()); }
  for (const b of buckets.values()) if (b.openT > .001 || b.openTarget) b.update(dt);
  if (flight) stepFlight(dt);
  else if (!selected) {
    // drone: after a few idle seconds, drift around the room on a slow orbit with a gentle bob
    idle += dt;
    if (idle > 2.5) {
      const T = HOME.target, off = camera.position.clone().sub(T);
      if (droneA === null) droneA = Math.atan2(off.z, off.x);
      droneA += dt * .045;
      const R = Math.hypot(HOME.pos.x - T.x, HOME.pos.z - T.z), now = clock.elapsedTime;
      const dp = new THREE.Vector3(T.x + Math.cos(droneA) * R, HOME.pos.y + Math.sin(now * .31) * .6, T.z + Math.sin(droneA) * R);
      const dtg = T.clone().add(new THREE.Vector3(Math.sin(now * .23) * .6, Math.sin(now * .17) * .15, 0));
      const k = 1 - Math.exp(-dt * .9);
      camera.position.lerp(dp, k); controls.target.lerp(dtg, k);
    }
  }
  controls.update(); renderer.render(scene, camera); css.render(scene, camera);
});
renderPanel();
window.__mcc = { scene, camera, buckets, select, setThermal, sim };
