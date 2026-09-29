// MCC room: 4 line-ups x 5 sections x 6 buckets, bird's-eye default, click to fly in and open a bucket,
// click the contactor for a macro close-up, T toggles an ironbow thermal view driven by the 10 Hz sim.
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { CSS2DRenderer, CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { Bucket, BW, BH, BD, ironbow } from "./bucket.js";
import { Sim } from "./sim.js";
import { ThermalCam, tempMaterial, tnorm } from "./thermal.js";
import { buildProps } from "./props.js";

const host = document.getElementById("host");
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .82;
host.append(renderer.domElement);
const css = new CSS2DRenderer(); css.domElement.className = "css2d"; host.append(css.domElement);

const scene = new THREE.Scene();
const BG = new THREE.Color(0x9aa3ab), TBG = new THREE.Color(tnorm(21), tnorm(21), tnorm(21));
const tcam = new ThermalCam(renderer);
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
const props = buildProps(scene);
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
setTimeout(() => tickSim(), 0);

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
  thermalMats(on); hotLabels(sim.s);
}
function thermalMats(on) {
  scene.background.copy(on ? TBG : BG); scene.fog.color.copy(on ? TBG : BG);
  scene.traverse((o) => {
    if (!o.isMesh || !o.userData.static) return;
    if (on) { o.userData.orig = o.userData.orig || o.material; o.material = tempMaterial(o.userData.temp ?? (24.5 + o.getWorldPosition(new THREE.Vector3()).y * 1.2 + (o === floor ? -1.5 : 0))); }
    else if (o.userData.orig) { o.material.dispose(); o.material = o.userData.orig; }
  });
  for (const b of buckets.values()) b.setThermal(on);
}

// ---------------------------------------------------------------- handheld thermal camera
// When a bucket is open, a handheld IR camera slides in on the right and shoots the K1 contactor
// from a fixed macro pose, refreshing about once a second. The main view stays in visible light.
const dev = { b: null, mode: null, aimT: 0, last: -9, shots: 13, cv: document.getElementById("ir") };
const capCam = new THREE.PerspectiveCamera(30, 4 / 3, .01, 60);
const devEl = document.getElementById("device"), $ = (id) => document.getElementById(id);
// phone rises to the center, shows a live IR viewfinder, fires the shutter, then docks right as the report
function openDevice(b) {
  $("s1").innerHTML = "<i></i>Captured"; ["done", "done", "cur", ""].forEach((c, i) => $("s" + (i + 1)).className = c); $("r-ai").textContent = "Demo capture. Upload a real image to run backend analysis.";
  dev.b = b; dev.mode = "aim"; dev.aimT = 0; dev.last = -9; dev.shots++;
  document.body.classList.add("device", "aim"); $("r-body").scrollTop = 0;
}
function closeDevice() { dev.b = null; dev.mode = null; document.body.classList.remove("device", "aim", "scanning"); }
function shoot() {
  const b = dev.b; dev.mode = "shot";
  devEl.classList.remove("fire"); void devEl.offsetWidth; devEl.classList.add("fire");
  $("ir-shot").getContext("2d").drawImage(dev.cv, 0, 0); $("ir-thumb").getContext("2d").drawImage(dev.cv, 0, 0, 160, 120);
  fillReport(b);
  setTimeout(() => { if (dev.b === b) document.body.classList.remove("aim"); }, 650);
  setTimeout(() => { if (dev.b === b) scrollReport(); }, 2600);
}
function scrollReport() {
  const el = $("r-body"), end = el.scrollHeight - el.clientHeight; let t0 = null;
  const step = (ts) => { if (!dev.b) return; t0 ??= ts; const u = Math.min(1, (ts - t0) / 5000); el.scrollTop = end * (u < .5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2); if (u < 1) requestAnimationFrame(step); };
  requestAnimationFrame(step);
}
function fillReport(b) {
  const s = b.state, T = s.temps, ph = ["L1", "L2", "L3"], mx = Math.max(...ph.map((p) => T[p])), mn = Math.min(...ph.map((p) => T[p]));
  const hp = ph.reduce((a, p) => T[p] > T[a] ? p : a, "L1"), cp = ph.reduce((a, p) => T[p] < T[a] ? p : a, "L1"), d = mx - mn, hot = d > 15;
  const no = String(dev.shots).padStart(3, "0"), now = new Date();
  const col = (t) => t > 60 ? "#d42a1c" : t > 48 ? "#b86e00" : "#1a8a44";
  $("r-no").textContent = `Inspection #${no}`; $("r-file").textContent = `IR_${String(dev.shots).padStart(4, "0")}.jpg · ${now.toTimeString().slice(0, 8)}`;
  $("r-chip").textContent = hot ? "P1" : "OK"; $("r-chip").style.background = hot ? "#e5352b" : "#34c759";
  $("r-tag").textContent = `${b.tag} · ${b.name}`;
  $("r-loc").textContent = `${b.lineup} · Sec ${b.section} · Bkt ${b.row} · 480 V 3Φ 60 Hz`;
  $("r-np").textContent = `MCCB 50 A · K1 3-pole contactor 32 A AC-3 · coil 120 VAC · OL ${(b.fla * .9).toFixed(0)}–${(b.fla * 1.2).toFixed(0)} A`;
  const rows = [
    ["01", "Sp1 · L1 line terminal", T.L1.toFixed(1) + " °C", col(T.L1)],
    ["02", "Sp2 · L2 line terminal", T.L2.toFixed(1) + " °C", col(T.L2)],
    ["03", "Sp3 · L3 line terminal", T.L3.toFixed(1) + " °C", col(T.L3)],
    ["04", "Bx1 max / avg", `${mx.toFixed(1)} / ${((T.L1 + T.L2 + T.L3) / 3).toFixed(1)} °C`],
    ["05", `ΔT ${hp}–${cp}`, d.toFixed(1) + " °C", hot ? "#d42a1c" : "#111"],
    ["06", "Contactor body", T.body.toFixed(1) + " °C"],
    ["07", "Overload relay", T.ol.toFixed(1) + " °C"],
    ["08", "Breaker case", T.brk.toFixed(1) + " °C"],
    ["09", "Load current L1/L2/L3", s.amps.map((x) => x.toFixed(1)).join(" / ") + " A"],
    ["10", "Load vs FLA", Math.round(s.load * 100) + " %"],
  ];
  $("r-tbl").innerHTML = rows.map(([n, k, v, c]) => `<tr><td>${n}</td><td>${k}</td><td style="color:${c || "#111"}">${v}</td></tr>`).join("");
  $("r-cond").innerHTML = [["Ambient", sim.amb.toFixed(1) + " °C"], ["Reflected temp", "27.0 °C"], ["Emissivity", "0.95"], ["Distance", "0.5 m"], ["Rel. humidity", "42 %"], ["Camera", "640×480 · NETD <30 mK"], ["Inspector", "Route 4 · Z. Zafar"]]
    .map(([k, v], i) => `<tr><td>${String(11 + i)}</td><td>${k}</td><td>${v}</td></tr>`).join("");
  $("r-sev").textContent = hot ? "PRIORITY 1 · REPAIR IMMEDIATELY" : "NO ANOMALY"; $("r-sev").className = "sev " + (hot ? "crit" : "ok");
  $("r-fnd").textContent = hot ? `${hp} line terminal ${T[hp].toFixed(1)} °C, ${d.toFixed(1)} °C above ${cp} under ${Math.round(s.load * 100)}% load. Likely loose or oxidized lug.` : `All three phases within ${d.toFixed(1)} °C.`;
  $("r-act").textContent = hot ? "De-energize and LOTO, re-torque lug to spec, inspect ferrule and contact tips, re-scan under load." : "No action. Next scan on the quarterly route.";
  $("r-wo").textContent = hot ? "Create work order" : "Mark inspected";
}
function captureIR(t) {
  const b = dev.b; if (!b || !b.terms || !b.state) return;
  const c0 = b.group.getWorldPosition(new THREE.Vector3());
  capCam.position.copy(c0).add(new THREE.Vector3(.02, .015, .5)); capCam.lookAt(c0.clone().add(new THREE.Vector3(0, 0, -.3))); capCam.updateMatrixWorld();
  const gv = b.glow.visible; b.glow.visible = false;
  if (!thermal) thermalMats(true);
  tcam.resize(640, 480); tcam.render(scene, capCam, t);
  const g = dev.cv.getContext("2d"), W = dev.cv.width, H = dev.cv.height;
  g.drawImage(renderer.domElement, 0, 0, W, H);
  if (!thermal) thermalMats(false);
  b.glow.visible = gv; tcam.resize(host.clientWidth, host.clientHeight);
  const T = b.state.temps, mono = "'JetBrains Mono', Consolas, monospace";
  g.shadowColor = "#000"; g.shadowBlur = 3; g.strokeStyle = "#fff"; g.fillStyle = "#fff";
  ["L1", "L2", "L3"].forEach((p, i) => {
    const q = b.terms[p].getWorldPosition(new THREE.Vector3()).project(capCam), x = (q.x + 1) / 2 * W, y = (1 - q.y) / 2 * H, big = p === "L2";
    const r = big ? 11 : 7; g.lineWidth = big ? 2.5 : 1.8;
    g.beginPath(); g.moveTo(x - r * 2, y); g.lineTo(x - r * .5, y); g.moveTo(x + r * .5, y); g.lineTo(x + r * 2, y); g.moveTo(x, y - r * 2); g.lineTo(x, y - r * .5); g.moveTo(x, y + r * .5); g.lineTo(x, y + r * 2); g.stroke();
    g.font = `bold ${big ? 22 : 16}px ${mono}`; g.fillText(`Sp${i + 1} ${T[p].toFixed(1)}`, x - 40 + (i - 1) * 55, y - 34 - (big ? 18 : 0) - (i === 0 ? 20 : 0));
  });
  // measurement box around the contactor
  const bx = b.contactor.getWorldPosition(new THREE.Vector3()).project(capCam), bxX = (bx.x + 1) / 2 * W, bxY = (1 - bx.y) / 2 * H;
  g.lineWidth = 1.5; g.setLineDash([6, 4]); g.strokeRect(bxX - 70, bxY - 95, 140, 175); g.setLineDash([]);
  const mx = Math.max(T.L1, T.L2, T.L3);
  g.font = `bold 18px ${mono}`; g.fillText(`Bx1 Max ${mx.toFixed(1)}`, 14, 28); g.fillText(`ΔT ${(mx - Math.min(T.L1, T.L2, T.L3)).toFixed(1)}`, 14, 52); g.fillText("ε 0.95", 14, H - 14);
  const gr = g.createLinearGradient(0, H - 40, 0, 40);
  ["#08041c", "#2e066e", "#800a8c", "#c81e6e", "#ec501e", "#fca00a", "#ffe25a", "#fffff0"].forEach((c, i, a) => gr.addColorStop(i / (a.length - 1), c));
  g.shadowBlur = 0; g.fillStyle = gr; g.fillRect(W - 28, 40, 14, H - 80); g.strokeStyle = "#fff8"; g.lineWidth = 1; g.strokeRect(W - 28, 40, 14, H - 80);
  g.fillStyle = "#fff"; g.font = `bold 15px ${mono}`; g.textAlign = "right"; g.fillText("80", W - 34, 52); g.fillText("20", W - 34, H - 42); g.textAlign = "left";
  $("cam-sp").textContent = `Sp2 ${T.L2.toFixed(1)}°C`;
  document.querySelectorAll("#device .clk").forEach((e) => e.textContent = new Date().toTimeString().slice(0, 5));
}

// ---------------------------------------------------------------- upload + analysis
// The open bucket gets an Upload pin in the 3D scene. An uploaded IR image is analyzed on the device
// (hotspot from the actual pixels) and sent to the ThermalDesk backend: /api/evidence, then "analyze".
const API = new URLSearchParams(location.search).get("api") || (() => { try { return localStorage.getItem("thermaldesk-api"); } catch { return null; } })() || "http://127.0.0.1:3001";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const fileIn = Object.assign(document.createElement("input"), { type: "file", accept: "image/png,image/jpeg", hidden: true });
document.body.append(fileIn);
fileIn.onchange = () => { const f = fileIn.files[0]; fileIn.value = ""; if (f) analyzeUpload(f); };
const upEl = document.createElement("div"); upEl.className = "uppin";
upEl.innerHTML = `<button class="up-main"><b>⇪</b>Upload IR image</button><button class="up-plaud">Import latest Plaud recording</button><button class="up-alt">Capture with phone (demo)</button><small>or drop a PNG / JPEG on the scene</small>`;
upEl.addEventListener("pointerdown", (e) => e.stopPropagation());
upEl.querySelector(".up-main").onclick = (e) => { e.stopPropagation(); fileIn.click(); };
upEl.querySelector(".up-plaud").onclick = async (e) => {
  e.stopPropagation();
  const button = e.currentTarget, original = button.textContent;
  button.disabled = true; button.textContent = "Importing Plaud…";
  try {
    const caseResponse = await fetch(API + "/api/case", { cache: "no-store" });
    const st = await caseResponse.json();
    if (!caseResponse.ok) throw new Error(st.error || `case ${caseResponse.status}`);
    const plaudResponse = await fetch(API + "/api/plaud", { cache: "no-store" });
    const plaud = await plaudResponse.json();
    if (!plaudResponse.ok) throw new Error(plaud.error || `Plaud ${plaudResponse.status}`);
    const asset = st.inspection?.asset_id;
    const recording = pickRecording(plaud.recordings, asset);
    if (!recording) throw new Error(`No Plaud recording from the last hour or mentioning ${asset || "this asset"}. Run the Plaud pull.`);
    const importResponse = await fetch(API + "/api/plaud", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ recording_id: recording.id, expectedRevision: st.revision }),
    });
    const next = await importResponse.json();
    if (!importResponse.ok) throw new Error(next.error || `Plaud import ${importResponse.status}`);
    stage("PLAUD RECORDING IMPORTED");
    window.dispatchEvent(new CustomEvent("thermaldesk:state", { detail: structuredClone(next) }));
    if (window.thermaldeskWorkflow?.refresh) await window.thermaldeskWorkflow.refresh();
  } catch (error) {
    stage(`PLAUD: ${String(error.message || error).toUpperCase()}`);
  } finally {
    button.disabled = false; button.textContent = original;
  }
};
upEl.querySelector(".up-alt").onclick = (e) => { e.stopPropagation(); if (selected) { hideUpload(); openDevice(selected); } };
const upPin = new CSS2DObject(upEl); upPin.visible = false;
function showUpload(b) { b.group.add(upPin); upPin.position.set(BW / 2 + .02, .06, .04); upPin.visible = true; upEl.classList.remove("in"); void upEl.offsetWidth; upEl.classList.add("in"); }
function hideUpload() { upPin.visible = false; }
host.addEventListener("dragover", (e) => { if (selected) { e.preventDefault(); document.body.classList.add("dropping"); } });
host.addEventListener("dragleave", () => document.body.classList.remove("dropping"));
host.addEventListener("drop", (e) => { document.body.classList.remove("dropping"); if (!selected) return; e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) analyzeUpload(f); });

// Plaud: the newest recording if it was made in the last hour (the live walk-down note);
// otherwise the newest one that names the asset. Older unrelated recordings are never attached.
function pickRecording(recs = [], asset) {
  const sorted = [...recs].sort((a, b) => String(b.start_at ?? "").localeCompare(String(a.start_at ?? "")));
  const newest = sorted[0];
  if (newest && Date.now() - Date.parse(newest.start_at) < 60 * 60 * 1000) return newest;
  return sorted.find((r) => (r.asset_mentions || []).includes(asset)) || null;
}
// map image colors back onto the ironbow scale (or luminance for white-hot grayscale) and find the hot region
const LUT = Array.from({ length: 64 }, (_, i) => { const c = ironbow(20 + 60 * i / 63); return [c.r * 255, c.g * 255, c.b * 255]; });
function analyzePixels(img) {
  const W = 256, H = Math.max(1, Math.round(256 * img.height / img.width));
  const c = Object.assign(document.createElement("canvas"), { width: W, height: H }), g = c.getContext("2d");
  g.drawImage(img, 0, 0, W, H); const d = g.getImageData(0, 0, W, H).data;
  let sat = 0; for (let i = 0; i < d.length; i += 16) { const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2]); sat += mx ? (mx - mn) / mx : 0; }
  const gray = sat / (d.length / 16) < .08;
  const heat = new Float32Array(W * H), vals = [];
  const x0 = Math.floor(W * .05), x1 = Math.floor(W * .88), y0 = Math.floor(H * .06), y1 = Math.floor(H * .94); // skip scale bar and edge text
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, r = d[i], gg = d[i + 1], b = d[i + 2];
    let v;
    if (gray) v = (.299 * r + .587 * gg + .114 * b) / 255;
    else { let best = 1e9, bi = 0; for (let k = 0; k < 64; k++) { const L = LUT[k], e = (L[0] - r) ** 2 + (L[1] - gg) ** 2 + (L[2] - b) ** 2; if (e < best) { best = e; bi = k; } } v = bi / 63; }
    heat[y * W + x] = v; if (x >= x0 && x < x1 && y >= y0 && y < y1) vals.push(v);
  }
  const sorted = Float32Array.from(vals).sort(), q = (p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const med = q(.5), p99 = q(.99), thr = Math.max(p99 - .04, med + (p99 - med) * .75);
  let sx = 0, sy = 0, n = 0, bx0 = W, by0 = H, bx1 = 0, by1 = 0, peak = 0, px = 0, py = 0;
  for (let y = Math.max(1, y0); y < Math.min(H - 1, y1); y++) for (let x = Math.max(1, x0); x < Math.min(W - 1, x1); x++) {
    const v = heat[y * W + x];
    if (v >= thr) { sx += x; sy += y; n++; bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
    const s = (heat[y * W + x] * 4 + heat[y * W + x - 1] + heat[y * W + x + 1] + heat[(y - 1) * W + x] + heat[(y + 1) * W + x]) / 8;
    if (s > peak) { peak = s; px = x; py = y; }
  }
  const T = (v) => 20 + 60 * v;
  let sum = 0; for (const v of vals) sum += v;
  const stats = { minT: T(q(.005)), maxT: T(q(.999)), avgT: T(sum / vals.length) };
  return { ...stats, gray, W, H, cx: (n ? sx / n : px) / W, cy: (n ? sy / n : py) / H, px: px / W, py: py / H, box: [bx0 / W, by0 / H, (bx1 + 1) / W, (by1 + 1) / H], areaPct: n / vals.length * 100,
    peakT: T(peak), medT: T(med), dT: T(peak) - T(med), iw: img.width, ih: img.height };
}
function drawContain(g, img, W, H) {
  const s = Math.min(W / img.width, H / img.height), w = img.width * s, h = img.height * s, ox = (W - w) / 2, oy = (H - h) / 2;
  g.fillStyle = "#000"; g.fillRect(0, 0, W, H); g.drawImage(img, ox, oy, w, h); return { ox, oy, w, h };
}
function drawDetection(g, px, m) {
  const X = (u) => m.ox + u * m.w, Y = (v) => m.oy + v * m.h, mono = "'JetBrains Mono', Consolas, monospace";
  const [a, b, c, d] = px.box; g.save(); g.shadowColor = "#000"; g.shadowBlur = 4;
  g.strokeStyle = "#5cf08a"; g.lineWidth = 2.5; g.setLineDash([8, 5]); g.strokeRect(X(a) - 6, Y(b) - 6, X(c) - X(a) + 12, Y(d) - Y(b) + 12); g.setLineDash([]);
  const x = X(px.px), y = Y(px.py); g.strokeStyle = "#fff"; g.lineWidth = 2.5;
  g.beginPath(); g.arc(x, y, 14, 0, 7); g.moveTo(x - 30, y); g.lineTo(x - 8, y); g.moveTo(x + 8, y); g.lineTo(x + 30, y); g.moveTo(x, y - 30); g.lineTo(x, y - 8); g.moveTo(x, y + 8); g.lineTo(x, y + 30); g.stroke();
  g.fillStyle = "#fff"; g.font = `bold 22px ${mono}`; g.fillText(`HOT ${px.peakT.toFixed(1)}°C est`, Math.min(m.ox + m.w - 250, x + 22), Math.max(28, y - 22));
  g.font = `bold 16px ${mono}`; g.fillStyle = "#5cf08a"; g.fillText(`ΔT ${px.dT.toFixed(1)} · area ${px.areaPct.toFixed(1)}%`, 12, 470); g.restore();
}
async function backendAnalyze(file, ctx) {
  const get = async () => { const r = await fetch(API + "/api/case", { cache: "no-store" }); if (!r.ok) throw new Error("case " + r.status); return r.json(); };
  const post = async (body) => { const r = await fetch(API + "/api/case", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || r.status); return j; };
  const upload = async (f, revision) => {
    const fd = new FormData(); fd.append("file", f); fd.append("expectedRevision", String(revision));
    const r = await fetch(API + "/api/evidence", { method: "POST", body: fd }); const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `upload ${r.status}`); return j;
  };
  let st = await get(), note = "";
  if (st.job || st.recommendation) { st = await post({ command: "reset_demo", expectedRevision: st.revision }); note = "Previous demo case was reset for this inspection."; }
  // context note: what the HMI knows about this asset, so the model has operating conditions
  const T = ctx.b.state.temps, A = ctx.b.state.amps, px = ctx.px;
  const text = [
    `Asset: ${ctx.b.lineup} section ${ctx.b.section} bucket ${ctx.b.row}, ${ctx.b.tag} ${ctx.b.name}. Device: molded-case breaker, K1 3-pole contactor 32 A AC-3 with thermal overload relay, 480 V 3-phase.`,
    `Operating condition at capture (HMI telemetry, simulated sensors): load ${Math.round(ctx.b.state.load * 100)}% of ${ctx.b.fla} A FLA; phase currents L1 ${A[0].toFixed(1)} A, L2 ${A[1].toFixed(1)} A, L3 ${A[2].toFixed(1)} A; ambient ${sim.amb} C.`,
    `Line terminal sensor temperatures (simulated): L1 ${T.L1.toFixed(1)} C, L2 ${T.L2.toFixed(1)} C, L3 ${T.L3.toFixed(1)} C.`,
    `On-device image screening of ${file.name} (color-based estimate, not radiometric): hottest region at ${Math.round(px.px * px.iw)},${Math.round(px.py * px.ih)} px, about ${px.dT.toFixed(0)} C above background assuming a 20-80 C ironbow scale, ${px.areaPct.toFixed(1)}% of frame.`,
  ].join("\n");
  const noteFile = new File([text], `hmi-context-${ctx.b.id}.txt`, { type: "text/plain" });
  await upload(file, st.revision); st = await get();
  await upload(noteFile, st.revision); st = await get();
  const ev = [...st.inspection.evidence].reverse().find((e) => e.source === "upload" && e.kind === "thermal_image");
  if (!ev) throw new Error("The backend did not record the image.");
  // Plaud: attach the newest voice note that mentions this case's asset (others are never sent)
  let voice = null;
  try {
    const pl = await (await fetch(API + "/api/plaud", { cache: "no-store" })).json();
    const asset = st.inspection.asset_id, hit = pickRecording(pl.recordings, asset);
    if (hit) {
      const r = await fetch(API + "/api/plaud", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recording_id: hit.id, expectedRevision: st.revision }) });
      if (r.ok) { st = await r.json(); voice = hit; }
    }
  } catch { /* Plaud optional */ }
  st = await post({ command: "analyze", expectedRevision: st.revision });
  return { rec: st.recommendation, ev, note, voice };
}
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
function renderBackend(res, err) {
  const el = $("r-ai");
  if (err) { el.innerHTML = `<span class="sev crit">BACKEND</span> ${esc(err.message)}<div class="f">Backend: ${esc(API)}. On-device result above still stands.</div>`; $("s2").className = "done"; return; }
  const r = res.rec, sevMap = { high: "crit", medium: "crit", low: "ok", unassessed: "ok" };
  el.innerHTML = `<b>${esc(r.recommendation_id)}</b> · ${esc(r.status.replace("_", " "))} · mode <b>${esc(r.analysis_mode)}</b>
    ${res.note ? `<div class="f">${esc(res.note)}</div>` : ""}
    <div class="f">Evidence ${esc(res.ev.id)} · ${esc(res.ev.kind)}</div>
    ${res.voice ? `<div class="f"><span class="sev ok">PLAUD · LIVE</span> Voice note ${esc(new Date(res.voice.start_at).toLocaleString())}: “${esc(res.voice.text.replace(/^Speaker \d+:\s*/, "").slice(0, 160))}”</div>` : `<div class="f">No Plaud recording from the last hour or naming this asset.</div>`}
    ${(r.findings || []).map((f) => `<div class="f"><span class="sev ${sevMap[f.severity] || "ok"}">${esc(f.severity.toUpperCase())}</span> ${esc(f.description)}${f.uncertainties?.length ? `<br><i>${esc(f.uncertainties.join(" · "))}</i>` : ""}</div>`).join("")}
    ${r.repair_scope ? `<div class="f"><b>Scope:</b> ${esc(r.repair_scope)}</div>` : ""}
    ${r.missing_information?.length ? `<div class="f"><b>Needs:</b> ${esc(r.missing_information.join(" · "))}</div>` : ""}
    ${r.analysis_mode !== "live" ? `<div class="f">Simulated analysis. Not a live Crusoe call.</div>` : `<div class="f">Live Crusoe draft for qualified review. Not an approval.</div>`}`;
  $("s2").className = "done"; $("s3").className = "cur";
}
async function analyzeUpload(file) {
  const b = selected; if (!b) return;
  if (!/^image\/(png|jpeg)$/.test(file.type)) { stage("PNG OR JPEG ONLY"); return; }
  hideUpload(); dev.b = b; dev.mode = "upload"; dev.shots++;
  let img; try { img = await createImageBitmap(file); } catch { stage("COULD NOT READ THAT IMAGE"); closeDevice(); showUpload(b); return; }
  const backend = backendAnalyze(file, { b, px: analyzePixels(img) }).then((r) => ({ r }), (e) => ({ e }));
  document.body.classList.add("device", "aim", "scanning"); $("r-body").scrollTop = 0;
  const g = dev.cv.getContext("2d"), m = drawContain(g, img, 640, 480);
  $("cam-sp").textContent = "ANALYZING…"; stage("3 / 3 · ANALYZING UPLOADED IR IMAGE");
  const px = analyzePixels(img);
  await wait(1900); if (dev.b !== b) return;
  document.body.classList.remove("scanning"); drawDetection(g, px, m);
  $("cam-sp").textContent = `HOT ${px.peakT.toFixed(1)}°C est`;
  await wait(900); if (dev.b !== b) return;
  dev.mode = "shot"; devEl.classList.remove("fire"); void devEl.offsetWidth; devEl.classList.add("fire");
  $("ir-shot").getContext("2d").drawImage(dev.cv, 0, 0); $("ir-thumb").getContext("2d").drawImage(dev.cv, 0, 0, 160, 120);
  fillReport(b); fillUpload(b, px, file);
  report = { b, px, file, no: dev.shots, at: new Date(), ir: $("ir-shot").toDataURL("image/png"), raw: await toDataURL(img), res: null, err: null, pending: true };
  $("b-report").hidden = false; $("b-report").classList.add("pending");
  $("r-ai").innerHTML = `<span class="spin"></span>Uploading to ${esc(API)} · attaching Plaud voice note · Crusoe vision model analyzing (up to 45 s)…`;
  setTimeout(() => { if (dev.b === b) document.body.classList.remove("aim"); }, 650);
  setTimeout(() => { if (dev.b === b) scrollReport(); }, 3200);
  const out = await backend;
  if (report && report.b === b) { report.res = out.r || null; report.err = out.e || null; report.pending = false; if (selected === b) { renderPanel(); requestAnimationFrame(() => panel.scrollTo({ top: panel.scrollHeight, behavior: "smooth" })); } $("b-report").classList.remove("pending"); stage("REPORT READY · PRESS R"); setTimeout(() => stage(""), 2500); }
  if (dev.b !== b) return;
  renderBackend(out.r, out.e);
}
function fillUpload(b, px, file) {
  const hot = px.dT > 15, T = b.state.temps, col = (t) => t > 60 ? "#d42a1c" : t > 48 ? "#b86e00" : "#1a8a44";
  $("s1").innerHTML = "<i></i>Uploaded"; $("s1").className = "done"; $("s2").className = "cur"; $("s3").className = ""; $("s4").className = "";
  $("r-file").textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB`;
  $("r-chip").textContent = hot ? "P1" : "OK"; $("r-chip").style.background = hot ? "#e5352b" : "#34c759";
  const rows = [
    ["01", "Hotspot peak (est.)", px.peakT.toFixed(1) + " °C", col(px.peakT)],
    ["02", "Background median (est.)", px.medT.toFixed(1) + " °C"],
    ["03", "ΔT hotspot vs background", px.dT.toFixed(1) + " °C", hot ? "#d42a1c" : "#111"],
    ["04", "Hot region area", px.areaPct.toFixed(1) + " % of frame"],
    ["05", "Hotspot position", `${Math.round(px.px * px.iw)}, ${Math.round(px.py * px.ih)} px`],
    ["06", "Palette detected", px.gray ? "grayscale (white-hot)" : "ironbow"],
    ["07", "Live sensor L1 / L2 / L3 (sim)", `${T.L1.toFixed(1)} / ${T.L2.toFixed(1)} / ${T.L3.toFixed(1)}`],
    ["08", "Load current (sim)", b.state.amps.map((x) => x.toFixed(1)).join(" / ") + " A"],
  ];
  $("r-tbl").innerHTML = rows.map(([n, k, v, c]) => `<tr><td>${n}</td><td>${k}</td><td style="color:${c || "#111"}">${v}</td></tr>`).join("");
  $("r-cond").innerHTML = [["File", file.name], ["Image size", `${px.iw}×${px.ih}`], ["Temperature scale", "assumed 20–80 °C"], ["Radiometric data", "no (color image)"], ["Uploaded", new Date().toTimeString().slice(0, 8)], ["Backend", API.replace(/^https?:\/\//, "")]]
    .map(([k, v], i) => `<tr><td>${String(9 + i).padStart(2, "0")}</td><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("");
  $("r-sev").textContent = hot ? "PRIORITY 1 · HOT SPOT" : "NO CLEAR ANOMALY"; $("r-sev").className = "sev " + (hot ? "crit" : "ok");
  $("r-fnd").textContent = hot ? `Hot region about ${px.dT.toFixed(0)} °C above background at the marked point. Estimated from image colors, not radiometric data.` : `Hottest area only ${px.dT.toFixed(1)} °C above background (estimated from colors).`;
  $("r-act").textContent = hot ? "Confirm with a radiometric scan under load; if confirmed, de-energize, LOTO and re-torque the connection." : "No action from this image. Keep on the quarterly route.";
}

// ---------------------------------------------------------------- inspection report (Fluke-style)
let report = null;
async function toDataURL(img) { const c = Object.assign(document.createElement("canvas"), { width: img.width, height: img.height }); c.getContext("2d").drawImage(img, 0, 0); return c.toDataURL("image/png"); }
const F = (c) => (c * 9 / 5 + 32).toFixed(1);
const CF = (c) => `${c.toFixed(1)} °C (${F(c)} °F)`;
function netaOverRef(dT) { // NETA MTS Table 100.18, temperature rise over ambient/reference
  if (dT > 40) return ["Major discrepancy · repair immediately", "crit"];
  if (dT > 20) return ["Monitor until corrective measures can be accomplished", "crit"];
  if (dT > 10) return ["Indicates probable deficiency · repair as time permits", "warn"];
  if (dT >= 1) return ["Possible deficiency · warrants investigation", "ok"];
  return ["No deficiency", "ok"];
}
async function openReport() {
  if (!report) { stage("UPLOAD AN IR IMAGE FIRST"); setTimeout(() => stage(""), 1800); return; }
  const r = report, b = r.b, px = r.px, n = String(r.no).padStart(2, "0");
  let st = null; try { st = await (await fetch(API + "/api/case", { cache: "no-store" })).json(); } catch { /* offline */ }
  const transcripts = (st?.inspection?.evidence || []).filter((e) => e.kind === "transcript");
  const [sev, sevCls] = netaOverRef(px.dT), rec = r.res?.rec, img = (st?.inspection?.evidence || []).find((e) => e.id === r.res?.ev?.id);
  const rows = [
    ["File Location", img ? img.uri : r.file.name],
    ["File Name", r.file.name],
    ["Image Time", r.at.toLocaleString()],
    ["Emissivity", "0.95 (default setting)"],
    ["Background Temp", CF(px.medT) + " · estimated"],
    ["Transmission", "100% (default setting)"],
    ["Image Range", `${CF(px.minT)} to ${CF(px.maxT)} · estimated`],
    ["Average Temp", CF(px.avgT) + " · estimated"],
    ["Hot Spot", `${CF(px.peakT)} at ${Math.round(px.px * px.iw)}, ${Math.round(px.py * px.ih)} px · estimated`],
    ["ΔT Hot Spot vs Background", `${px.dT.toFixed(1)} °C (${(px.dT * 9 / 5).toFixed(1)} °F)`],
    ["Severity (NETA MTS 100.18)", sev],
    ["Camera Model", "Not in file (PNG/JPEG upload)"],
    ["IR Sensor Size", `${px.iw} × ${px.ih} (image)`],
    ["Camera Manufacturer", "Not in file"],
    ["Calibration Range", "Assumed 20 °C to 80 °C (68 °F to 176 °F) palette scale"],
    ["Camera Serial Number", "Not in file"],
    ["Palette", px.gray ? "Grayscale (white-hot)" : "Ironbow"],
    ["Analysis", rec ? `${rec.recommendation_id} · ${rec.analysis_mode === "live" ? "live Crusoe" : "simulated"} · ${rec.status.replace("_", " ")}` : r.pending ? "Crusoe analysis running…" : `Unavailable: ${r.err?.message || "no result"}`],
  ];
  const fnd = rec?.findings?.map((f) => f.description).join(" ") || "";
  const desc = `This ${b.tag} ${b.name.toLowerCase()} K1 contactor is showing an infrared hot spot about ${px.dT.toFixed(0)} °C (${(px.dT * 9 / 5).toFixed(0)} °F) above background${px.peakT > 60 ? ", consistent with a high-resistance connection" : ""}. ${fnd}`.trim();
  const reco = `${rec?.repair_scope ? rec.repair_scope.replace(/[.\s]+$/, "") + ". " : ""}${px.dT > 20 ? "We recommend de-energizing, lockout/tagout, inspecting and re-torquing the affected terminal, and replacing the contactor and any damaged cable if heat damage is found." : "Re-scan under load at the next route."} This must be done by qualified personnel.${rec?.missing_information?.length ? " Still needed: " + rec.missing_information.join("; ") + "." : ""}`;
  const tx = transcripts.length ? transcripts.map((t) => {
    const lines = (t.segments?.length ? t.segments.map((s) => `${s.speaker ? `<b>${esc(s.speaker)}:</b> ` : ""}${esc(s.text)}`) : String(t.text || "").split("\n").map((l) => esc(l).replace(/^([^:]{1,40}):/, "<b>$1:</b>")));
    return `<div class="tx"><div class="txh">${t.source === "plaud" ? "PLAUD" : esc(t.source).toUpperCase()} · ${t.mode.toUpperCase()} · ${t.captured_at ? new Date(t.captured_at).toLocaleString() : "time not recorded"}${t.provider_record_id ? ` · ${esc(t.provider_record_id)}` : ""}</div>${lines.map((l) => `<p>${l}</p>`).join("")}</div>`;
  }).join("") : `<p class="none">No transcription attached to this case yet. Record a Plaud note that names the asset, run the Plaud pull, and upload again.</p>`;
  $("rpt-doc").innerHTML = `
    <h1>REPORT #${n} <span class="ir">( IR#${n} )</span> <span class="as">${esc(b.lineup)} · ${esc(b.tag)} ${esc(b.name)}</span></h1>
    <div class="pics"><figure><img src="${r.ir}" alt="Infrared image with spot markers"><figcaption>Infrared · ${esc(r.file.name)}</figcaption></figure><figure><img src="${r.raw}" alt="Uploaded image"><figcaption>Uploaded image</figcaption></figure></div>
    <ul><li><b>CLIENT:</b> ${esc(st?.inspection?.site_id || "DEMO-SITE")}</li><li><b>LOCATION:</b> MCC Room 1 · Building 4</li><li><b>AREA 1:</b> ${esc(b.lineup)} · Section ${b.section} · Bucket ${b.row}</li>
      <li><b>EQUIPMENT NAME:</b> <span class="eq">${esc(b.tag)} ${esc(b.name)} · K1 3-pole contactor 32 A AC-3 with overload relay · 480 V</span></li></ul>
    <table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td class="${k.startsWith("Severity") ? sevCls : ""}">${esc(v)}</td></tr>`).join("")}</table>
    <h2>DESCRIPTION &amp; RECOMMENDATION <small>(Please also review the transcription below)</small>: <span class="o">${esc(desc)} ${esc(reco)}</span></h2>
    <h2 class="t">TRANSCRIPTION <small>(Plaud voice notes attached to this case)</small></h2>${tx}
    <p class="foot">Temperatures are estimated from image colors, not radiometric data. ${rec?.analysis_mode === "live" ? "Analysis drafted by Crusoe for qualified review; not an approval." : "Analysis mode: simulated."} Generated ${new Date().toLocaleString()} · ThermalDesk</p>`;
  document.body.classList.add("rpt-open");
}
function closeReport() { document.body.classList.remove("rpt-open"); }

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
  if (selected && selected !== b) { selected.setOpen(false); closeDevice(); } hideUpload();
  if (!b) {
    selected = null; macro = false; renderPanel(); enterPanel();
    closeDevice(); hideUpload();
    flyPath([{ pos: HOME.pos.clone(), target: HOME.target.clone(), dur: 2.4, lift: 1.4, label: "RETURNING TO OVERVIEW" }]);
    return;
  }
  selected = b; macro = false; renderPanel(); enterPanel();
  const c = b.group.getWorldPosition(new THREE.Vector3()), v = bucketView(b), m = macroPose(b);
  flyPath([
    { pos: c.clone().add(new THREE.Vector3(1.5, 1.1, 3.1)), target: c.clone().add(new THREE.Vector3(0, -.15, 0)), dur: 1.7, lift: .9, hold: .3, label: `1 / 3 · ${b.lineup} · SECTION ${b.section}` },
    { pos: v.pos, target: v.target, dur: 1.4, hold: .9, label: `2 / 3 · BUCKET ${b.row} · ${b.tag} ${b.name}`, onStart: () => b.setOpen(true) },
    { pos: v.pos, target: v.target, dur: .01, label: "3 / 3 · UPLOAD IR IMAGE OF K1", onArrive: () => showUpload(b) },
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
let lastMove = 0, hovered = null;
renderer.domElement.addEventListener("pointermove", (e) => {
  const now = performance.now(); if (now - lastMove < 50) return; lastMove = now;
  const h = pick(e.clientX, e.clientY);
  const hb = h && h.b !== selected ? h.b : null; if (hb !== hovered) { hovered && hovered.hover(false); hb && hb.hover(true); hovered = hb; }
  renderer.domElement.style.cursor = h ? "pointer" : "grab";
  if (h) {
    const s = h.b.state, mx = s ? Math.max(s.temps.L1, s.temps.L2, s.temps.L3) : 0;
    tip.style.display = "block"; tip.style.left = e.clientX + 14 + "px"; tip.style.top = e.clientY + 12 + "px";
    tip.innerHTML = h.part === "contactor" ? `<b>K1 contactor</b> · click for close-up` : `<b>${h.b.tag}</b> ${h.b.name}<br>${h.b.lineup} · S${h.b.section} · B${h.b.row} · ${s && s.running ? "running" : "stopped"} · ${mx.toFixed(1)} °C`;
  } else tip.style.display = "none";
});
document.getElementById("b-home").onclick = () => select(null);
document.getElementById("b-report").onclick = () => openReport();
document.getElementById("rpt-close").onclick = () => closeReport();
document.getElementById("rpt-print").onclick = () => window.print();
document.getElementById("b-start").onclick = () => select(buckets.get(HOT));
document.getElementById("b-thermal").onclick = () => setThermal(!thermal);
addEventListener("keydown", (e) => { if (e.key === "t" || e.key === "T") setThermal(!thermal); if (e.key === "Escape") { if (document.body.classList.contains("rpt-open")) { closeReport(); return; } select(null); } if ((e.key === "r" || e.key === "R") && !e.ctrlKey && !e.metaKey) openReport(); if ((e.key === "s" || e.key === "S") && !selected) select(buckets.get(HOT)); });

// pulsing warning rings on the floor in front of the hot bucket
const ringM = new THREE.MeshBasicMaterial({ color: 0xff5a1f, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
const rings = [0, 1, 2].map(() => { const m = new THREE.Mesh(new THREE.RingGeometry(.3, .34, 48), ringM.clone()); m.rotation.x = -Math.PI / 2; scene.add(m); return m; });
{ const p = buckets.get(HOT).group.getWorldPosition(new THREE.Vector3()); rings.forEach((m) => m.position.set(p.x, .012, p.z + .55)); }
function pulseRing(t) {
  rings.forEach((m, i) => { const u = (t * .45 + i / 3) % 1; m.scale.setScalar(.6 + u * 1.6); m.material.opacity = (1 - u) * .7; m.visible = !thermal; });
}
function enterPanel() { panel.classList.remove("enter"); void panel.offsetWidth; panel.classList.add("enter"); }
// stat chips bump when their value changes
const bumpObs = new MutationObserver((ms) => ms.forEach((m) => { const el = m.target.nodeType === 3 ? m.target.parentElement : m.target; if (el.id === "c-t") return; el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }));
["c-run", "c-alarm"].forEach((id) => bumpObs.observe(document.getElementById(id), { childList: true, characterData: true, subtree: true }));

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
    ${report && report.b === b && report.res?.rec ? `<div class="find"><div class="tag">LIVE CRUSOE FINDING · ${esc(report.res.rec.status.replace("_", " ").toUpperCase())}</div>${report.res.rec.findings.map((f) => `<div style="margin:4px 0"><b>${esc(f.description)}</b></div><div class="sub">Severity: <b style="color:${f.severity === "high" ? "var(--crit)" : "var(--warn)"}">${esc(f.severity)}</b></div>`).join("")}<div class="sub">Scope: ${esc(report.res.rec.repair_scope)}</div><div class="sub">Hotspot ${report.px.peakT.toFixed(1)} °C est · ΔT ${report.px.dT.toFixed(1)} °C · press R for the report</div></div>`
      : report && report.b === b && report.pending ? `<div class="find"><div class="tag">CRUSOE ANALYZING…</div><div class="sub">Image, HMI context and Plaud note sent. Result appears here.</div></div>`
      : b.hot && finding ? `<div class="find"><div class="tag">PRIOR INSPECTION FINDING (SIMULATED)</div><div style="margin:4px 0"><b>${finding.finding}</b></div>
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
function resize() { const w = host.clientWidth, h = host.clientHeight; renderer.setSize(w, h); css.setSize(w, h); tcam.resize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener("resize", resize); resize();
const clock = new THREE.Clock(); let panelAcc = 0;
renderer.setAnimationLoop(() => {
  const dt = Math.min(.05, clock.getDelta());
  simAcc += dt; while (simAcc >= .1) { simAcc -= .1; tickSim(); }
  panelAcc += dt; if (panelAcc > .25) { panelAcc = 0; selected ? livePanel() : (Math.random() < .15 && renderPanel()); }
  for (const b of buckets.values()) if (b.busy) b.update(dt);
  pulseRing(clock.elapsedTime); if (!thermal) props.update(dt, clock.elapsedTime);
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
  if (dev.b && dev.mode === "aim") {
    dev.aimT += dt;
    if (clock.elapsedTime - dev.last > .2) { dev.last = clock.elapsedTime; captureIR(clock.elapsedTime); }
    if (dev.aimT > 2.2) shoot();
  }
  controls.update(); if (thermal) tcam.render(scene, camera, clock.elapsedTime); else renderer.render(scene, camera); css.render(scene, camera);
});
renderPanel();
window.__mcc = { scene, camera, buckets, select, setThermal, sim, analyzeUpload, captureIR, dev, openReport };
