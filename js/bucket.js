// One MCC bucket: door with disconnect, pilot lights and nameplate; interior (breaker, K1 contactor,
// overload relay, control transformer, wire duct, cables) is built the first time the door opens.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { CSS2DObject } from "three/addons/renderers/CSS2DRenderer.js";
import { tempMaterial } from "./thermal.js";

export const BW = 0.6, BH = 0.3, BD = 0.44;

export function ironbow(t, lo = 20, hi = 80) {
  const x = Math.min(1, Math.max(0, (t - lo) / (hi - lo)));
  const S = [[0, 8, 4, 28], [.18, 46, 6, 110], [.36, 128, 10, 140], [.52, 200, 30, 110], [.66, 236, 80, 30], [.8, 252, 160, 10], [.92, 255, 226, 90], [1, 255, 255, 240]];
  for (let i = 1; i < S.length; i++) if (x <= S[i][0]) {
    const a = S[i - 1], b = S[i], f = (x - a[0]) / (b[0] - a[0]);
    return new THREE.Color((a[1] + (b[1] - a[1]) * f) / 255, (a[2] + (b[2] - a[2]) * f) / 255, (a[3] + (b[3] - a[3]) * f) / 255);
  }
  return new THREE.Color(1, 1, 1);
}

const std = (c, r = .5, m = .1, extra = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m, ...extra });
const MAT = {
  door: std(0xc8cdd2, .42, .35), black: std(0x151618, .5, .2), handle: std(0x202124, .35, .4),
  redOn: std(0xff2a1a, .3, 0, { emissive: 0xff2010, emissiveIntensity: 3 }), redOff: std(0x5a1410, .3, 0),
  grnOn: std(0x2aff5a, .3, 0, { emissive: 0x18ff40, emissiveIntensity: 3 }), grnOff: std(0x12401c, .3, 0),
  chrome: std(0xd8dde2, .2, .9), galv: std(0xa9b0b6, .38, .75), grey: std(0xb9bec4, .55, .05),
  charcoal: std(0x34373b, .5, .05), duct: std(0x8c9196, .7, 0), cable: std(0x0e0e10, .6, 0),
  copper: std(0xc8753a, .3, .9), blue: std(0x1f5fd6, .35, .1), red: std(0xd8201a, .4, .05), redWire: std(0xc01818, .5, 0),
  rail: std(0x9aa1a7, .3, .85), xfmr: std(0x2b3a4a, .55, .2), coil: std(0x8a5a2a, .5, .3),
};

function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function plateTex(line1, line2) {
  return canvasTex(256, 80, (g, w, h) => {
    g.fillStyle = "#f4f4f0"; g.fillRect(0, 0, w, h); g.strokeStyle = "#222"; g.lineWidth = 4; g.strokeRect(3, 3, w - 6, h - 6);
    g.fillStyle = "#111"; g.textAlign = "center"; g.font = "bold 30px Arial"; g.fillText(line1, w / 2, 36);
    g.font = "20px Arial"; g.fillText(line2, w / 2, 64);
  });
}
const K1TEX = canvasTex(64, 32, (g) => { g.fillStyle = "#f2f2ee"; g.fillRect(0, 0, 64, 32); g.fillStyle = "#111"; g.font = "bold 22px Arial"; g.textAlign = "center"; g.fillText("K1", 32, 24); });
export const GLOW = canvasTex(128, 128, (g) => {
  const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  r.addColorStop(0, "rgba(255,255,230,1)"); r.addColorStop(.25, "rgba(255,200,60,.8)"); r.addColorStop(.6, "rgba(255,80,20,.25)"); r.addColorStop(1, "rgba(255,40,0,0)");
  g.fillStyle = r; g.fillRect(0, 0, 128, 128);
});

const G = {
  door: new RoundedBoxGeometry(BW - .012, BH - .01, .02, 2, .004),
  hub: new THREE.CylinderGeometry(.03, .034, .02, 24), lever: new RoundedBoxGeometry(.018, .085, .02, 2, .006),
  pilot: new THREE.CylinderGeometry(.011, .011, .012, 16), bezel: new THREE.CylinderGeometry(.016, .016, .006, 16),
  plate: new THREE.PlaneGeometry(.16, .05),
};

export class Bucket {
  constructor(spec) {
    Object.assign(this, spec); // id, tag, name, lineup, section, row, hot, fla
    this.group = new THREE.Group(); this.group.name = spec.id;
    this.parts = []; this.tmats = {}; this.thermal = false; this.openT = 0; this.openTarget = 0; this.openV = 0; this.pop = 0; this.popT = 0; this.flick = 0; this.state = null;

    // door hinged on its left edge
    this.hinge = new THREE.Group(); this.hinge.position.set(-BW / 2 + .006, 0, .012); this.group.add(this.hinge);
    const door = this.mesh(G.door, MAT.door, "door", this.hinge); door.position.x = BW / 2 - .006; door.userData.pick = "door";
    const hub = this.mesh(G.hub, MAT.handle, "door", door); hub.rotation.x = Math.PI / 2; hub.position.set(.16, -.02, .02);
    const lever = this.mesh(G.lever, MAT.handle, "door", door); lever.position.set(.16, -.02, .035); lever.rotation.z = -.8; this.lever = lever;
    const plate = this.mesh(G.plate, new THREE.MeshStandardMaterial({ map: plateTex(spec.tag, spec.name), roughness: .6 }), "door", door);
    plate.position.set(-.12, .06, .011);
    this.pilots = [];
    [[-.19, MAT.redOff], [-.145, MAT.grnOff]].forEach(([x, m]) => {
      const b = this.mesh(G.bezel, MAT.chrome, "door", door); b.rotation.x = Math.PI / 2; b.position.set(x, -.07, .012);
      const p = this.mesh(G.pilot, m, "door", door); p.rotation.x = Math.PI / 2; p.position.set(x, -.07, .017); this.pilots.push(p);
    });
    this.doorMesh = door;

    // hotspot glow shown through the door in thermal view
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.position.set(0, 0, .06); this.glow.visible = false; this.group.add(this.glow);
  }

  mesh(geo, mat, tkey, parent) {
    const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
    m.userData.bucket = this; m.userData.tkey = tkey; m.userData.orig = mat;
    (parent || this.group).add(m); this.parts.push(m);
    if (this.thermal) m.material = this.tmat(tkey);
    return m;
  }
  tmat(k) { return this.tmats[k] || (this.tmats[k] = tempMaterial(this.temp(k))); }
  temp(k) {
    const s = this.state; if (!s) return 26;
    return s.temps[k] ?? s.temps.door;
  }

  buildInterior() {
    if (this.interior) return;
    const I = this.interior = new THREE.Group(); this.group.add(I);
    const box = (w, h, d, mat, k, x, y, z, r = .004) => { const m = this.mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat, k, I); m.position.set(x, y, z); return m; };
    const zb = -BD + .03; // back panel face
    box(BW - .03, BH - .02, .006, MAT.galv, "back", 0, 0, zb - .003, .001);
    // wire duct: top run and right riser
    box(BW - .05, .035, .05, MAT.duct, "back", 0, .11, zb + .025, .002);
    box(.035, .2, .05, MAT.duct, "back", .245, -.02, zb + .025, .002);
    // DIN rail
    box(.36, .012, .007, MAT.rail, "back", -.02, -.02, zb + .004, .001);
    // molded-case breaker
    box(.1, .17, .09, MAT.black, "brk", -.17, -.015, zb + .045, .008);
    box(.02, .035, .02, MAT.charcoal, "brk", -.17, -.01, zb + .1, .004);
    // K1 contactor: grey base, charcoal top, three line terminals
    const cx = .0, cz = zb + .045;
    const body = box(.08, .065, .085, MAT.grey, "body", cx, -.005, cz, .006); body.userData.pick = "contactor";
    const top = box(.08, .03, .075, MAT.charcoal, "body", cx, .042, cz - .005, .005); top.userData.pick = "contactor";
    const lbl = this.mesh(new THREE.PlaneGeometry(.028, .014), new THREE.MeshStandardMaterial({ map: K1TEX, roughness: .6 }), "body", I);
    lbl.position.set(cx, -.005, cz + .0435); lbl.userData.pick = "contactor";
    this.terms = {};
    ["L1", "L2", "L3"].forEach((ph, i) => {
      const x = cx - .026 + i * .026;
      const s = this.mesh(new THREE.CylinderGeometry(.0065, .0065, .006, 12), MAT.chrome, ph, I); s.position.set(x, .06, cz + .02); s.userData.pick = "contactor";
      const f = this.mesh(new THREE.CylinderGeometry(.0045, .0045, .016, 10), MAT.copper, ph, I); f.position.set(x, .068, cz + .01);
      const c = this.mesh(new THREE.CylinderGeometry(.0055, .0055, .06, 10), MAT.cable, ph, I); c.position.set(x, .1, cz + .01);
      this.terms[ph] = s;
    });
    // coil wire
    const cw = this.mesh(new THREE.CylinderGeometry(.0018, .0018, .09, 6), MAT.redWire, "body", I); cw.rotation.z = 1.2; cw.position.set(cx + .075, .035, cz + .03);
    // overload relay below, blue dial and red test button
    const ol = box(.08, .045, .075, MAT.grey, "ol", cx, -.064, cz - .004, .005); ol.userData.pick = "contactor";
    const dial = this.mesh(new THREE.CylinderGeometry(.009, .009, .006, 16), MAT.blue, "ol", I); dial.rotation.x = Math.PI / 2; dial.position.set(cx - .018, -.062, cz + .036);
    const btn = this.mesh(new THREE.CylinderGeometry(.005, .005, .007, 12), MAT.red, "ol", I); btn.rotation.x = Math.PI / 2; btn.position.set(cx + .02, -.062, cz + .036);
    // load cables out the bottom
    [-1, 0, 1].forEach((i) => { const c = this.mesh(new THREE.CylinderGeometry(.005, .005, .05, 10), MAT.cable, "ol", I); c.position.set(cx + i * .026, -.11, cz); });
    // control transformer
    box(.075, .07, .065, MAT.xfmr, "brk", .15, -.035, zb + .035, .004);
    box(.05, .03, .03, MAT.coil, "brk", .15, .015, zb + .035, .004);
    this.contactor = body;

    // spot meter label on L2 terminal (thermal view)
    const el = document.createElement("div"); el.className = "spot"; el.innerHTML = '<i></i><b></b>';
    this.spot = new CSS2DObject(el); this.spot.position.set(cx, .064, cz + .02); this.spot.visible = false; I.add(this.spot);
    // interior light while open
    const lamp = new THREE.PointLight(0xfff2de, 0, .9, 1.6); lamp.position.set(0, .09, -.05); I.add(lamp); this.lamp = lamp;
    this.applyThermal();
  }

  setOpen(v) { this.openTarget = v ? 1 : 0; if (v) this.buildInterior(); }
  setThermal(on) { this.thermal = on; this.applyThermal(); }
  applyThermal() {
    for (const m of this.parts) m.material = this.thermal ? this.tmat(m.userData.tkey) : m.userData.orig;
    this.refreshThermal();
  }
  refreshThermal() {
    const s = this.state;
    if (this.thermal) for (const k in this.tmats) this.tmats[k].userData.setT(this.temp(k));
    const hot = s ? Math.max(s.temps.L1, s.temps.L2, s.temps.L3) : 0;
    this.glow.visible = this.thermal && hot > 55;
    if (this.glow.visible) { const k = Math.min(1, (hot - 55) / 20); this.glow.scale.setScalar(.35 + k * .9); this.glow.material.opacity = .15 + k * .25; }
    if (this.spot) {
      this.spot.visible = this.thermal && this.openTarget > 0 && !!s;
      if (this.spot.visible) this.spot.element.querySelector("b").textContent = s.temps.L2.toFixed(1) + " °C";
    }
  }

  apply(s) {
    if (this.state && s.running && !this.wasRunning) this.flick = .7; // pilot flickers as the contactor pulls in
    this.wasRunning = s.running;
    this.state = s;
    const run = s.running;
    this.pilots[0].userData.orig = run ? MAT.redOn : MAT.redOff; // red = running (US convention)
    this.pilots[1].userData.orig = run ? MAT.grnOff : MAT.grnOn; // green = stopped / ready
    if (!this.thermal) { this.pilots[0].material = this.pilots[0].userData.orig; this.pilots[1].material = this.pilots[1].userData.orig; }
    this.refreshThermal();
  }

  hover(v) { this.pop = v ? 1 : 0; }
  get busy() { return this.openT > .001 || this.openTarget || this.popT > .001 || this.pop || this.flick > 0 || Math.abs(this.openV) > .001; }
  update(dt) {
    // spring door: slight overshoot as it swings open and settles
    this.openV += ((this.openTarget - this.openT) * 38 - this.openV * 7.5) * dt;
    this.openT = Math.max(0, this.openT + this.openV * dt);
    this.popT += (this.pop - this.popT) * (1 - Math.exp(-dt * 14));
    this.doorMesh.position.z = this.popT * .008;
    this.doorMesh.scale.setScalar(1 + this.popT * .012);
    if (this.flick > 0) {
      this.flick -= dt; const on = this.flick <= 0 || Math.sin(this.flick * 60) > 0;
      if (!this.thermal) this.pilots[0].material = on ? this.pilots[0].userData.orig : MAT.redOff;
    }
    this.hinge.rotation.y = -this.openT * 1.95;
    this.lever.rotation.z = -.8 + this.openT * .8;
    if (this.lamp) this.lamp.intensity = this.openT * .5;
  }
}
