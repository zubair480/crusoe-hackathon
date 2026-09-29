// props.js - set dressing for the MCC electrical room diorama.
// Everything is added under one group; update(dt, t) drives the micro animations.
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const BACK_Z = -11.9; // inner face of back wall
const LEFT_X = -10.9; // inner face of left wall
const HALF_PI = Math.PI / 2;

export function buildProps(scene) {
  const root = new THREE.Group();
  root.name = "props";
  scene.add(root);

  // ---------- shared geometry ----------
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1),
    cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
    cylLo: new THREE.CylinderGeometry(0.5, 0.5, 1, 8),
    plane: new THREE.PlaneGeometry(1, 1),
    cone: new THREE.ConeGeometry(0.5, 1, 16, 1, true),
    disc: new THREE.CircleGeometry(0.5, 32),
    torus: new THREE.TorusGeometry(0.5, 0.08, 6, 24),
    shackle: new THREE.TorusGeometry(0.5, 0.12, 6, 12, Math.PI),
  };
  const rboxCache = new Map();
  function rbox(w, h, d, r = 0.015) {
    const k = `${w}|${h}|${d}|${r}`;
    if (!rboxCache.has(k)) rboxCache.set(k, new RoundedBoxGeometry(w, h, d, 2, r));
    return rboxCache.get(k);
  }

  // ---------- shared materials ----------
  const std = (color, rough = 0.6, metal = 0.1, extra = {}) =>
    new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, ...extra });
  const M = {
    cab: std(0x8e959b, 0.55, 0.35), // ANSI 61 grey enclosure
    cabDark: std(0x3a3f44, 0.6, 0.3),
    plinth: std(0x1d1f22, 0.8, 0.1),
    vent: std(0x24282c, 0.7, 0.4),
    galv: std(0xa9aeb2, 0.42, 0.65),
    galvDark: std(0x7c8186, 0.5, 0.6),
    black: std(0x141516, 0.7, 0.1),
    rubber: std(0x1a1a1a, 0.9, 0.0),
    red: std(0xb3261e, 0.45, 0.2),
    redDeep: std(0x8a1c16, 0.5, 0.2),
    yellow: std(0xe8b90e, 0.5, 0.1),
    orange: std(0xe0601a, 0.55, 0.05),
    green: std(0x2e7d32, 0.5, 0.1),
    blue: std(0x1f4f9a, 0.5, 0.1),
    white: std(0xeceae4, 0.5, 0.0),
    beige: std(0xd8d2c2, 0.6, 0.0),
    fiberglass: std(0xf0c21a, 0.45, 0.05),
    alu: std(0xc9ccce, 0.35, 0.75),
    cardboard: std(0xb08a5a, 0.9, 0.0),
    cardboard2: std(0x9c7748, 0.9, 0.0),
    cable: std(0x222222, 0.6, 0.0),
    battery: std(0x2b2d30, 0.7, 0.1),
    battTop: std(0x7a2a24, 0.6, 0.1),
    checker: null, // filled below
    trenchVoid: std(0x0a0b0c, 1.0, 0.0),
    lens: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.2, metalness: 0, emissive: 0xffffff, emissiveIntensity: 0 }),
  };

  let meshCount = 0;
  function add(geo, mat, x, y, z, sx = 1, sy = 1, sz = 1, temp = 26, o = {}) {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    if (o.rx) m.rotation.x = o.rx;
    if (o.ry) m.rotation.y = o.ry;
    if (o.rz) m.rotation.z = o.rz;
    m.castShadow = !!o.cast;
    m.receiveShadow = o.recv !== false;
    m.userData.temp = temp;
    (o.parent || root).add(m);
    meshCount++;
    return m;
  }
  // box by center
  const B = (mat, x, y, z, w, h, d, temp = 26, o) => add(G.box, mat, x, y, z, w, h, d, temp, o);

  function canvasTex(w, h, draw) {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    draw(ctx, w, h);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    return { tex, ctx, canvas: c };
  }
  const labelMat = (tex, emissive = false) =>
    emissive
      ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })
      : new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7, metalness: 0 });

  // plane facing +z (back wall) or +x (left wall)
  const planeZ = (mat, x, y, z, w, h, temp = 26, parent) => add(G.plane, mat, x, y, z, w, h, 1, temp, { parent });
  const planeX = (mat, x, y, z, w, h, temp = 26, parent) => add(G.plane, mat, x, y, z, w, h, 1, temp, { ry: HALF_PI, parent });

  // ---------- LED instancing ----------
  const leds = []; // {pos, color, mode, rate, phase}
  function led(x, y, z, color, mode = "steady", rate = 1, size = 0.014) {
    leds.push({ x, y, z, color: new THREE.Color(color), mode, rate, phase: Math.random() * 10, size, on: true, next: Math.random() });
  }

  // conduit couplings / straps, instanced
  const couplers = []; // {x,y,z,axis}
  const conduitR = 0.0125;
  function runX(y, z, x0, x1) {
    const len = x1 - x0;
    add(G.cylLo, M.galv, (x0 + x1) / 2, y, z, conduitR * 2, len, conduitR * 2, 26, { rz: HALF_PI });
    for (let x = x0 + 1.5; x < x1 - 0.2; x += 3.05) couplers.push({ x, y, z, axis: "x" });
  }
  function runZ(y, x, z0, z1) {
    const len = z1 - z0;
    add(G.cylLo, M.galv, x, y, (z0 + z1) / 2, conduitR * 2, len, conduitR * 2, 26, { rx: HALF_PI });
    for (let z = z0 + 1.5; z < z1 - 0.2; z += 3.05) couplers.push({ x, y, z, axis: "z" });
  }
  function runY(x, z, y0, y1) {
    const len = y1 - y0;
    add(G.cylLo, M.galv, x, (y0 + y1) / 2, z, conduitR * 2, len, conduitR * 2, 26);
    if (len > 1.2) couplers.push({ x, y: (y0 + y1) / 2, z, axis: "y" });
  }
  const jboxBack = (x, y) => B(M.galvDark, x, y, BACK_Z + 0.05, 0.12, 0.12, 0.08, 26);
  const jboxLeft = (z, y) => B(M.galvDark, LEFT_X + 0.05, y, z, 0.08, 0.12, 0.12, 26);

  // =====================================================================
  // BACK WALL LINE-UP
  // =====================================================================

  // ---- VFD drive cabinets ----
  const vfdXs = [-6.4, -5.55, -4.7, -3.85];
  const vfdW = 0.82, vfdH = 2.2, vfdD = 0.6;
  const vfdZ = BACK_Z + vfdD / 2;
  const vfdFront = BACK_Z + vfdD;
  const arcLabel = canvasTex(128, 96, (c, w, h) => {
    c.fillStyle = "#f7f3e8"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#f07b12"; c.fillRect(0, 0, w, 30);
    c.fillStyle = "#111"; c.font = "bold 19px Arial"; c.textAlign = "center";
    c.fillText("WARNING", w / 2, 22);
    c.font = "bold 12px Arial";
    c.fillText("ARC FLASH AND", w / 2, 48);
    c.fillText("SHOCK HAZARD", w / 2, 62);
    c.font = "10px Arial";
    c.fillText("PPE CAT 2  8 cal/cm2", w / 2, 82);
  });
  const arcMat = labelMat(arcLabel.tex);
  const nameplate = (txt) => {
    const t = canvasTex(128, 32, (c, w, h) => {
      c.fillStyle = "#1b1b1b"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#f2f2f2"; c.font = "bold 16px Arial"; c.textAlign = "center";
      c.fillText(txt, w / 2, 22);
    });
    return labelMat(t.tex);
  };

  const vfdData = [
    { name: "VFD-101 AHU-1", hz: 60.0, a: 42.1, run: true },
    { name: "VFD-102 CHWP-1", hz: 45.2, a: 18.6, run: true },
    { name: "VFD-103 CHWP-2", hz: 0.0, a: 0.0, run: false },
    { name: "VFD-104 CT FAN", hz: 52.8, a: 27.3, run: true },
  ];
  const keypads = [];
  vfdXs.forEach((x, i) => {
    B(M.plinth, x, 0.05, vfdZ, vfdW, 0.1, vfdD, 26);
    add(rbox(vfdW, vfdH - 0.1, vfdD, 0.02), M.cab, x, 0.1 + (vfdH - 0.1) / 2, vfdZ, 1, 1, 1, 36 + (i % 2) * 2, { cast: true });
    // top exhaust hood (hot)
    B(M.vent, x, vfdH + 0.04, vfdZ + 0.03, vfdW - 0.14, 0.08, vfdD - 0.16, 45);
    // lower intake grille
    B(M.vent, x, 0.42, vfdFront + 0.004, vfdW - 0.28, 0.32, 0.01, 44);
    // upper filter grille
    B(M.vent, x, 1.95, vfdFront + 0.004, vfdW - 0.36, 0.16, 0.01, 45);
    // handle
    B(M.black, x + vfdW / 2 - 0.08, 1.1, vfdFront + 0.02, 0.03, 0.2, 0.03, 34);
    // keypad bezel + screen
    B(M.black, x - 0.05, 1.5, vfdFront + 0.008, 0.2, 0.2, 0.014, 38);
    const kp = canvasTex(160, 80, () => {});
    const scr = planeZ(labelMat(kp.tex, true), x - 0.05, 1.54, vfdFront + 0.016, 0.16, 0.08, 38);
    scr.receiveShadow = false;
    keypads.push({ ...vfdData[i], kp, base: { hz: vfdData[i].hz, a: vfdData[i].a } });
    // arc flash label + nameplate
    planeZ(arcMat, x + 0.18, 1.52, vfdFront + 0.003, 0.16, 0.12, 36);
    planeZ(nameplate(vfdData[i].name), x - 0.05, 1.8, vfdFront + 0.003, 0.3, 0.075, 36);
    // status LEDs: RUN (green), READY (amber), FAULT (red)
    const ly = 1.43;
    led(x - 0.1, ly, vfdFront + 0.017, 0x28ff5a, vfdData[i].run ? "steady" : "off");
    led(x - 0.05, ly, vfdFront + 0.017, 0xffb020, vfdData[i].run ? "off" : "blink", 1.0);
    led(x, ly, vfdFront + 0.017, 0xff2a1a, i === 3 ? "blink" : "off", 0.35);
    // conduit drop from overhead run
    runY(x, BACK_Z + 0.08, vfdH + 0.08, 3.5);
    jboxBack(x, 3.55);
  });
  // yellow floor tape: working clearance in front of drives
  {
    const x0 = vfdXs[0] - vfdW / 2 - 0.05, x1 = vfdXs[3] + vfdW / 2 + 0.05;
    const z0 = vfdFront + 0.05, z1 = vfdFront + 1.0;
    const tw = 0.05, ty = 0.004;
    B(M.yellow, (x0 + x1) / 2, ty, z1, x1 - x0, 0.004, tw, 26, { recv: true });
    B(M.yellow, x0, ty, (z0 + z1) / 2, tw, 0.004, z1 - z0, 26);
    B(M.yellow, x1, ty, (z0 + z1) / 2, tw, 0.004, z1 - z0, 26);
  }

  // ---- UPS ----
  const upsX = -2.6, upsW = 0.7, upsH = 1.9, upsD = 0.8;
  const upsFront = BACK_Z + upsD;
  add(rbox(upsW, upsH, upsD, 0.025), M.cabDark, upsX, upsH / 2, BACK_Z + upsD / 2, 1, 1, 1, 32, { cast: true });
  B(M.vent, upsX, 0.35, upsFront + 0.004, upsW - 0.2, 0.4, 0.01, 35);
  {
    const t = canvasTex(192, 96, (c, w, h) => {
      c.fillStyle = "#08131e"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#6fd0ff"; c.font = "bold 18px monospace";
      c.fillText("UPS-1  ONLINE", 10, 24);
      c.font = "15px monospace";
      c.fillText("LOAD   42 %", 10, 48);
      c.fillText("BATT  100 %", 10, 68);
      c.fillText("RUNTIME 18 min", 10, 88);
    });
    const s = planeZ(labelMat(t.tex, true), upsX, 1.45, upsFront + 0.006, 0.26, 0.13, 32);
    s.receiveShadow = false;
    planeZ(nameplate("UPS-1 30 kVA"), upsX, 1.7, upsFront + 0.004, 0.3, 0.075, 32);
    led(upsX - 0.08, 1.3, upsFront + 0.008, 0x28ff5a, "steady");
    led(upsX - 0.03, 1.3, upsFront + 0.008, 0x28ff5a, "steady");
    led(upsX + 0.02, 1.3, upsFront + 0.008, 0xffb020, "off");
    led(upsX + 0.07, 1.3, upsFront + 0.008, 0x28ff5a, "blink", 0.5);
  }
  runY(upsX, BACK_Z + 0.08, upsH, 3.5);
  jboxBack(upsX, 3.55);

  // ---- battery rack (open frame, instanced jars) ----
  {
    const bx = -1.55, bw = 0.9, bh = 1.5, bd = 0.55;
    const bz = BACK_Z + bd / 2 + 0.03;
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      B(M.galvDark, bx + sx * (bw / 2 - 0.02), bh / 2, bz + sz * (bd / 2 - 0.02), 0.04, bh, 0.04, 27);
    const shelfYs = [0.08, 0.45, 0.82, 1.19];
    for (const y of shelfYs) B(M.galvDark, bx, y, bz, bw, 0.03, bd, 27);
    B(M.galvDark, bx, bh, bz, bw, 0.03, bd, 27);
    const jar = new THREE.InstancedMesh(G.box, M.battery, shelfYs.length * 4);
    const cap = new THREE.InstancedMesh(G.box, M.battTop, shelfYs.length * 4);
    const d = new THREE.Object3D();
    let k = 0;
    for (const y of shelfYs) for (let j = 0; j < 4; j++) {
      const x = bx - bw / 2 + 0.12 + j * 0.22;
      d.position.set(x, y + 0.015 + 0.14, bz); d.scale.set(0.17, 0.28, 0.45); d.updateMatrix();
      jar.setMatrixAt(k, d.matrix);
      d.position.set(x, y + 0.015 + 0.29, bz); d.scale.set(0.12, 0.02, 0.35); d.updateMatrix();
      cap.setMatrixAt(k, d.matrix);
      k++;
    }
    for (const im of [jar, cap]) {
      im.castShadow = false; im.receiveShadow = true; im.userData.temp = 30; root.add(im); meshCount++;
    }
    planeZ(nameplate("BATT RACK B1"), bx, bh + 0.08, bz + bd / 2, 0.3, 0.075, 27);
  }

  // ---- 42U network / PLC rack ----
  {
    const rx = -0.4, rw = 0.6, rh = 2.05, rd = 1.0;
    const rz = BACK_Z + rd / 2 + 0.02;
    const front = rz + rd / 2;
    // frame: side panels, top, rear
    B(M.black, rx - rw / 2 + 0.01, rh / 2, rz, 0.02, rh, rd, 34, { cast: true });
    B(M.black, rx + rw / 2 - 0.01, rh / 2, rz, 0.02, rh, rd, 34, { cast: true });
    B(M.black, rx, rh - 0.02, rz, rw, 0.04, rd, 38);
    B(M.black, rx, 0.04, rz, rw, 0.08, rd, 30);
    B(M.cabDark, rx, rh / 2, rz - rd / 2 + 0.02, rw - 0.04, rh, 0.02, 34);
    // front rails
    B(M.galvDark, rx - 0.24, rh / 2, front - 0.05, 0.02, rh - 0.1, 0.02, 34);
    B(M.galvDark, rx + 0.24, rh / 2, front - 0.05, 0.02, rh - 0.1, 0.02, 34);
    const U = 0.0445, u0 = 0.1;
    const devs = [
      // [startU, heightU, material, ledCount, ledColor, temp]
      [39, 1, M.alu, 12, 0x28ff5a, 30],
      [37, 1, M.cabDark, 24, 0x28ff5a, 38],
      [35, 1, M.cabDark, 24, 0xffb020, 38],
      [31, 2, M.black, 4, 0x3aa0ff, 40],
      [24, 5, M.cab, 10, 0x28ff5a, 36],
      [18, 3, M.cabDark, 3, 0x28ff5a, 34],
      [13, 2, M.black, 4, 0x3aa0ff, 40],
      [9, 1, M.alu, 12, 0x28ff5a, 30],
    ];
    for (const [su, hu, mat, n, col, temp] of devs) {
      const y = u0 + (su + hu / 2) * U;
      B(mat, rx, y, front - 0.28, 0.48, hu * U - 0.004, 0.44, temp);
      const w = 0.4;
      for (let j = 0; j < n; j++) {
        const lx = rx - w / 2 + (j + 0.5) * (w / n);
        const ly = y + (hu > 2 ? (j % 2 ? 0.04 : -0.04) : 0);
        led(lx, ly, front - 0.055, j % 7 === 3 ? 0xffb020 : col, "rand", 3 + Math.random() * 8, 0.01);
      }
    }
    planeZ(nameplate("NET/PLC RK-1"), rx, rh - 0.1, front + 0.002, 0.3, 0.075, 34);
    runY(rx, BACK_Z + 0.08, rh, 3.5);
    jboxBack(rx, 3.55);
  }

  // ---- whiteboard with single-line diagram + PM schedule ----
  {
    const wx = 1.8, wy = 1.55, ww = 2.0, wh = 1.15;
    const t = canvasTex(1024, 576, (c, w, h) => {
      c.fillStyle = "#f6f7f4"; c.fillRect(0, 0, w, h);
      // faint ghosting of old erased notes
      c.globalAlpha = 0.08; c.fillStyle = "#333"; c.font = "34px 'Comic Sans MS', cursive";
      c.fillText("call Mike re: MCC-2", 540, 520); c.globalAlpha = 1;
      const hand = (x, y, x2, y2, col = "#1a2a6c", wdt = 4) => {
        c.strokeStyle = col; c.lineWidth = wdt; c.lineCap = "round";
        c.beginPath(); c.moveTo(x + Math.random() * 2, y + Math.random() * 2);
        const mx = (x + x2) / 2 + (Math.random() - 0.5) * 4, my = (y + y2) / 2 + (Math.random() - 0.5) * 4;
        c.quadraticCurveTo(mx, my, x2, y2); c.stroke();
      };
      const circ = (x, y, r, col = "#1a2a6c") => { c.strokeStyle = col; c.lineWidth = 4; c.beginPath(); c.arc(x, y, r, 0.1, Math.PI * 2.05); c.stroke(); };
      c.fillStyle = "#1a2a6c"; c.font = "bold 34px 'Comic Sans MS', cursive";
      c.fillText("SINGLE LINE - MCC RM", 30, 50);
      c.font = "24px 'Comic Sans MS', cursive";
      // utility -> xfmr -> bus
      hand(240, 70, 240, 110); c.fillText("UTIL 12.47kV", 260, 95);
      circ(240, 130, 20); circ(240, 162, 20);
      c.fillText("T1 1500kVA", 275, 155);
      hand(240, 182, 240, 225);
      c.fillRect(234, 212, 12, 12);
      c.fillText("MB 2000A", 260, 225);
      hand(60, 250, 470, 250, "#1a2a6c", 7);
      c.fillText("480V BUS", 60, 240);
      const feeds = [90, 180, 270, 360, 450];
      const labels = ["MCC-1", "MCC-2", "VFD", "UPS", "PP-1"];
      feeds.forEach((fx, i) => {
        hand(fx, 250, fx, 300);
        c.strokeStyle = "#1a2a6c"; c.lineWidth = 3; c.strokeRect(fx - 8, 300, 16, 16);
        hand(fx, 316, fx, 370);
        circ(fx, 392, 22, i === 2 ? "#b3261e" : "#1a2a6c");
        c.fillStyle = i === 2 ? "#b3261e" : "#1a2a6c";
        c.fillText("M", fx - 10, 400);
        c.fillStyle = "#1a2a6c"; c.font = "20px 'Comic Sans MS', cursive";
        c.fillText(labels[i], fx - 26, 440); c.font = "24px 'Comic Sans MS', cursive";
      });
      // PM schedule table in red/green
      c.fillStyle = "#b3261e"; c.font = "bold 32px 'Comic Sans MS', cursive";
      c.fillText("PM SCHEDULE", 600, 60);
      hand(600, 70, 820, 72, "#b3261e", 3);
      c.font = "24px 'Comic Sans MS', cursive"; c.fillStyle = "#222";
      const rows = [
        ["IR scan MCC-1/2", "OCT 06", true],
        ["VFD filters", "OCT 13", false],
        ["UPS batt test", "OCT 20", false],
        ["Torque check T1", "NOV 03", false],
        ["Clean HVAC coil", "SEP 22", true],
      ];
      rows.forEach(([a, d, done], i) => {
        const y = 115 + i * 44;
        c.fillStyle = "#222"; c.fillText(a, 610, y); c.fillText(d, 880, y);
        if (done) { hand(590, y - 10, 598, y - 2, "#2e7d32", 4); hand(598, y - 2, 612, y - 22, "#2e7d32", 4); }
      });
      c.fillStyle = "#2e7d32"; c.font = "22px 'Comic Sans MS', cursive";
      c.fillText("LOTO before opening!", 610, 360);
    });
    B(M.alu, wx, wy, BACK_Z + 0.015, ww + 0.05, wh + 0.05, 0.03, 26);
    planeZ(labelMat(t.tex), wx, wy, BACK_Z + 0.032, ww, wh, 26);
    B(M.alu, wx, wy - wh / 2 - 0.03, BACK_Z + 0.05, ww * 0.6, 0.02, 0.07, 26);
    add(G.cylLo, M.blue, wx - 0.2, wy - wh / 2 - 0.01, BACK_Z + 0.05, 0.015, 0.13, 0.015, 26, { rz: HALF_PI });
    add(G.cylLo, M.red, wx - 0.05, wy - wh / 2 - 0.01, BACK_Z + 0.06, 0.015, 0.13, 0.015, 26, { rz: HALF_PI });
    B(M.black, wx + 0.2, wy - wh / 2 - 0.005, BACK_Z + 0.055, 0.12, 0.035, 0.05, 26); // eraser
  }

  // ---- wall clock with ticking second hand ----
  const clock = {};
  {
    const cx = 1.8, cy = 2.58, r = 0.16, cz = BACK_Z + 0.03;
    const face = canvasTex(256, 256, (c, w) => {
      c.fillStyle = "#fbfbf8"; c.beginPath(); c.arc(w / 2, w / 2, w / 2 - 2, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#111";
      for (let i = 0; i < 60; i++) {
        const a = (i / 60) * Math.PI * 2, big = i % 5 === 0;
        c.save(); c.translate(w / 2, w / 2); c.rotate(a);
        c.fillRect(-(big ? 3 : 1), -w / 2 + 12, big ? 6 : 2, big ? 20 : 8); c.restore();
      }
    });
    add(G.cyl, M.black, cx, cy, cz - 0.01, r * 2 + 0.03, 0.04, r * 2 + 0.03, 26, { rx: HALF_PI });
    add(G.disc, labelMat(face.tex), cx, cy, cz + 0.012, r * 2, r * 2, 1, 26);
    const mk = (len, wid, mat, zoff) => {
      const g = new THREE.Group(); g.position.set(cx, cy, cz + 0.015 + zoff); root.add(g);
      B(mat, 0, len / 2 - 0.015, 0, wid, len, 0.003, 26, { parent: g });
      return g;
    };
    clock.h = mk(r * 0.55, 0.012, M.black, 0.0);
    clock.m = mk(r * 0.8, 0.008, M.black, 0.003);
    clock.s = mk(r * 0.9, 0.003, M.red, 0.006);
  }

  // ---- tool cart parked against back wall ----
  {
    const g = new THREE.Group(); g.position.set(3.55, 0, BACK_Z + 0.35); g.rotation.y = -0.06; root.add(g);
    const w = 0.9, d = 0.48, h = 0.82;
    add(rbox(w, h - 0.14, d, 0.02), M.red, 0, 0.14 + (h - 0.14) / 2, 0, 1, 1, 1, 26, { cast: true, parent: g });
    B(M.black, 0, h + 0.012, 0, w + 0.02, 0.025, d + 0.02, 26, { parent: g }); // rubber mat top
    for (let i = 0; i < 4; i++) B(M.redDeep, 0, 0.26 + i * 0.14, d / 2 + 0.002, w - 0.06, 0.004, 0.004, 26, { parent: g });
    for (let i = 0; i < 4; i++) B(M.alu, 0, 0.3 + i * 0.14, d / 2 + 0.012, 0.5, 0.012, 0.012, 26, { parent: g });
    B(M.alu, w / 2 + 0.05, 0.95, 0, 0.02, 0.02, d - 0.05, 26, { parent: g }); // push handle
    for (const sx of [-1, 1]) for (const sz of [-1, 1])
      add(G.cylLo, M.rubber, sx * (w / 2 - 0.07), 0.06, sz * (d / 2 - 0.07), 0.1, 0.035, 0.1, 26, { rx: HALF_PI, parent: g });
    // stuff on top: meter + tape roll
    B(M.yellow, -0.2, h + 0.06, 0.02, 0.1, 0.05, 0.18, 26, { parent: g });
    add(G.cylLo, M.black, 0.15, h + 0.045, -0.05, 0.1, 0.035, 0.1, 26, { parent: g });
  }

  // ---- LOTO station board ----
  {
    const lx = 7.2, ly = 1.5, lz = BACK_Z;
    const t = canvasTex(256, 192, (c, w, h) => {
      c.fillStyle = "#b3261e"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#fff"; c.fillRect(8, 8, w - 16, h - 16);
      c.fillStyle = "#b3261e"; c.fillRect(8, 8, w - 16, 40);
      c.fillStyle = "#fff"; c.font = "bold 24px Arial"; c.textAlign = "center";
      c.fillText("LOCKOUT STATION", w / 2, 37);
      c.fillStyle = "#222"; c.font = "12px Arial";
      c.fillText("AUTHORIZED PERSONNEL ONLY", w / 2, h - 18);
    });
    B(M.red, lx, ly, lz + 0.012, 0.82, 0.62, 0.024, 26);
    planeZ(labelMat(t.tex), lx, ly, lz + 0.025, 0.8, 0.6, 26);
    const cols = [M.red, M.red, M.yellow, M.yellow, M.blue, M.green, M.red, M.blue];
    cols.forEach((mat, i) => {
      const px = lx - 0.28 + (i % 4) * 0.185, py = ly + 0.06 - Math.floor(i / 4) * 0.2;
      if (i === 5) return; // one lock is out on a job
      add(G.shackle, M.alu, px, py + 0.035, lz + 0.05, 0.035, 0.04, 0.035, 26);
      B(mat, px, py, lz + 0.05, 0.04, 0.05, 0.022, 26);
      B(M.white, px + 0.004, py - 0.055, lz + 0.043, 0.035, 0.05, 0.002, 26, { rz: 0.1 }); // tag
    });
    B(M.galvDark, lx, ly - 0.36, lz + 0.05, 0.6, 0.04, 0.08, 26); // hasp tray
  }

  // ---- arc flash PPE cabinet ----
  {
    const px = 8.55, w = 0.9, h = 1.9, d = 0.5;
    const pf = BACK_Z + d;
    add(rbox(w, h, d, 0.02), M.yellow, px, h / 2, BACK_Z + d / 2, 1, 1, 1, 26, { cast: true });
    B(M.black, px, h / 2 + 0.1, pf + 0.002, 0.004, h - 0.3, 0.004, 26);
    B(M.alu, px - 0.05, 1.05, pf + 0.02, 0.02, 0.18, 0.02, 26);
    B(M.alu, px + 0.05, 1.05, pf + 0.02, 0.02, 0.18, 0.02, 26);
    const t = canvasTex(256, 128, (c, w2, h2) => {
      c.fillStyle = "#111"; c.fillRect(0, 0, w2, h2);
      c.fillStyle = "#f7c90e"; c.font = "bold 30px Arial"; c.textAlign = "center";
      c.fillText("ARC FLASH", w2 / 2, 48); c.fillText("PPE", w2 / 2, 86);
      c.font = "15px Arial"; c.fillText("CAT 2 / CAT 4 SUITS - GLOVES", w2 / 2, 114);
    });
    planeZ(labelMat(t.tex), px, 1.55, pf + 0.004, 0.6, 0.3, 26);
  }

  // ---- eyewash station ----
  {
    const ex = 10.2, ez = BACK_Z + 0.25;
    add(G.cylLo, M.green, ex, 0.55, ez, 0.045, 1.1, 0.045, 24);
    add(G.cylLo, M.galvDark, ex, 0.02, ez, 0.2, 0.04, 0.2, 24);
    add(G.cyl, M.yellow, ex, 1.08, ez + 0.08, 0.34, 0.08, 0.3, 24);
    add(G.cylLo, M.green, ex, 1.08, BACK_Z + 0.12, 0.035, 0.25, 0.035, 24, { rx: HALF_PI });
    B(M.green, ex + 0.22, 1.1, ez + 0.02, 0.2, 0.025, 0.025, 24); // push flag
    const t = canvasTex(128, 128, (c, w, h) => {
      c.fillStyle = "#1c7a3a"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#fff"; c.font = "bold 18px Arial"; c.textAlign = "center";
      c.fillText("EMERGENCY", w / 2, 40); c.fillText("EYE WASH", w / 2, 64);
      c.beginPath(); c.arc(w / 2, 96, 16, 0, Math.PI * 2); c.fill();
      c.fillStyle = "#1c7a3a"; c.beginPath(); c.arc(w / 2, 96, 7, 0, Math.PI * 2); c.fill();
    });
    planeZ(labelMat(t.tex), ex, 1.85, BACK_Z + 0.006, 0.3, 0.3, 26);
  }

  // ---- exhaust fan (spinning) on back wall ----
  const fan = {};
  {
    const fx = 7.2, fy = 2.95, fz = BACK_Z;
    B(M.galvDark, fx, fy, fz + 0.1, 0.72, 0.72, 0.2, 30, { cast: true });
    add(G.cyl, M.vent, fx, fy, fz + 0.2, 0.62, 0.02, 0.62, 30, { rx: HALF_PI });
    const g = new THREE.Group(); g.position.set(fx, fy, fz + 0.23); root.add(g);
    add(G.cylLo, M.galv, 0, 0, 0, 0.1, 0.05, 0.1, 34, { rx: HALF_PI, parent: g });
    for (let i = 0; i < 5; i++) {
      const b = B(M.galv, 0, 0, 0, 0.08, 0.26, 0.01, 30, { parent: g });
      const a = (i / 5) * Math.PI * 2;
      b.position.set(Math.sin(a) * 0.15, Math.cos(a) * 0.15, 0); b.rotation.set(0.35, 0, -a);
    }
    fan.blades = g;
    // guard rings
    add(G.torus, M.galv, fx, fy, fz + 0.27, 0.6, 0.6, 0.3, 30);
    add(G.torus, M.galv, fx, fy, fz + 0.27, 0.35, 0.35, 0.3, 30);
    B(M.galv, fx, fy, fz + 0.27, 0.6, 0.01, 0.01, 30);
    B(M.galv, fx, fy, fz + 0.27, 0.01, 0.6, 0.01, 30);
    runY(fx + 0.3, fz + 0.08, fy + 0.36, 3.5);
  }

  // ---- overhead EMT runs on back wall ----
  runX(3.55, BACK_Z + 0.03, LEFT_X + 0.05, 10.9);
  runX(3.7, BACK_Z + 0.03, LEFT_X + 0.05, 10.9);
  runY(5.4, BACK_Z + 0.03, 2.15, 3.55); // feeders into panelboard
  runY(5.6, BACK_Z + 0.03, 2.15, 3.7);
  jboxBack(5.4, 3.55);
  jboxBack(9.2, 3.62);
  jboxBack(-9.0, 3.62);
  jboxBack(2.2, 3.62);

  // =====================================================================
  // LEFT WALL
  // =====================================================================
  runZ(3.55, LEFT_X + 0.03, BACK_Z + 0.03, 1.7);
  runZ(3.7, LEFT_X + 0.03, BACK_Z + 0.03, 1.7);
  jboxLeft(-2.0, 3.62);
  jboxLeft(1.6, 3.62);

  // ---- EXIT sign over door ----
  {
    const t = canvasTex(256, 96, (c, w, h) => {
      c.fillStyle = "#0e1a10"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#39ff6a"; c.font = "bold 64px Arial"; c.textAlign = "center";
      c.fillText("EXIT", w / 2, 70);
      c.beginPath(); c.moveTo(18, 48); c.lineTo(38, 30); c.lineTo(38, 66); c.fill();
    });
    B(M.white, LEFT_X + 0.05, 2.5, 2.5, 0.1, 0.22, 0.4, 30);
    const s = planeX(labelMat(t.tex, true), LEFT_X + 0.102, 2.5, 2.5, 0.36, 0.14, 30);
    s.receiveShadow = false;
  }

  // ---- fire alarm pull station ----
  {
    const t = canvasTex(64, 80, (c, w, h) => {
      c.fillStyle = "#c62a20"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#fff"; c.font = "bold 13px Arial"; c.textAlign = "center";
      c.fillText("FIRE", w / 2, 18); c.fillText("ALARM", w / 2, 32);
      c.fillRect(18, 44, 28, 10); c.font = "bold 10px Arial"; c.fillText("PULL DOWN", w / 2, 72);
    });
    B(M.red, LEFT_X + 0.03, 1.22, 1.55, 0.06, 0.16, 0.13, 26);
    planeX(labelMat(t.tex), LEFT_X + 0.062, 1.22, 1.55, 0.12, 0.15, 26);
    runY(LEFT_X + 0.03, 1.55, 1.3, 3.55);
  }

  // ---- horn/strobe ----
  const strobe = {};
  {
    const sz = 0.7, sy = 2.45;
    B(M.red, LEFT_X + 0.04, sy, sz, 0.08, 0.14, 0.12, 26);
    strobe.lens = B(M.lens, LEFT_X + 0.095, sy + 0.035, sz, 0.03, 0.045, 0.06, 26);
    strobe.light = new THREE.PointLight(0xf4f6ff, 0, 6, 2);
    strobe.light.position.set(LEFT_X + 0.3, sy, sz);
    root.add(strobe.light);
    runY(LEFT_X + 0.03, sz, sy + 0.07, 3.55);
  }

  // ---- thermostat ----
  {
    B(M.beige, LEFT_X + 0.015, 1.5, -0.4, 0.03, 0.12, 0.09, 26);
    const t = canvasTex(64, 32, (c, w, h) => {
      c.fillStyle = "#22313a"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#9fe3ff"; c.font = "bold 18px monospace"; c.fillText("78F", 12, 23);
    });
    const s = planeX(labelMat(t.tex, true), LEFT_X + 0.031, 1.52, -0.4, 0.05, 0.03, 26);
    s.receiveShadow = false;
  }

  // ---- mini-split HVAC head (louver flutters) ----
  const hvac = {};
  {
    const hz = -7.2, hy = 3.1;
    add(rbox(0.26, 0.3, 1.0, 0.04), M.white, LEFT_X + 0.13, hy, hz, 1, 1, 1, 22, { cast: true });
    B(M.vent, LEFT_X + 0.2, hy - 0.13, hz, 0.1, 0.03, 0.9, 16); // supply slot (cold)
    const g = new THREE.Group(); g.position.set(LEFT_X + 0.26, hy - 0.14, hz); root.add(g);
    B(M.white, 0.03, 0, 0, 0.07, 0.008, 0.88, 17, { parent: g });
    hvac.louver = g;
    led(LEFT_X + 0.261, hy + 0.08, hz + 0.4, 0x3aa0ff, "steady", 1, 0.01);
    runY(LEFT_X + 0.03, hz + 0.45, hy + 0.1, 3.55); // line set
    add(G.cylLo, M.white, LEFT_X + 0.04, (hy + 3.9) / 2, hz + 0.55, 0.05, 3.9 - hy, 0.05, 20); // line-set cover
  }

  // ---- unit heater (hot) ----
  {
    const uz = -4.1, uy = 2.95;
    B(M.galvDark, LEFT_X + 0.2, uy + 0.36, uz, 0.4, 0.03, 0.05, 30); // bracket
    B(M.galvDark, LEFT_X + 0.38, uy + 0.3, uz, 0.02, 0.12, 0.02, 40);
    B(std(0x6e6a62, 0.6, 0.3), LEFT_X + 0.42, uy, uz, 0.42, 0.5, 0.6, 55, { cast: true });
    for (let i = 0; i < 5; i++) B(M.vent, LEFT_X + 0.635, uy - 0.18 + i * 0.09, uz, 0.02, 0.018, 0.54, 58, { rz: -0.4 });
    runY(LEFT_X + 0.03, uz, uy + 0.2, 3.55);
  }

  // ---- wall-hung vertical cable ladder with cables ----
  {
    const cz = -5.3, y0 = 0.4, y1 = 3.95, lxv = LEFT_X + 0.08;
    B(M.galv, lxv, (y0 + y1) / 2, cz - 0.2, 0.08, y1 - y0, 0.02, 26);
    B(M.galv, lxv, (y0 + y1) / 2, cz + 0.2, 0.08, y1 - y0, 0.02, 26);
    const n = Math.floor((y1 - y0) / 0.23);
    const rungs = new THREE.InstancedMesh(G.box, M.galv, n);
    const d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      d.position.set(lxv - 0.02, y0 + 0.12 + i * 0.23, cz); d.scale.set(0.025, 0.02, 0.38); d.updateMatrix();
      rungs.setMatrixAt(i, d.matrix);
    }
    rungs.userData.temp = 26; rungs.receiveShadow = true; root.add(rungs); meshCount++;
    [[-0.12, 0.03], [-0.04, 0.025], [0.05, 0.03], [0.13, 0.022]].forEach(([oz, r], i) =>
      add(G.cylLo, M.cable, lxv + 0.03, (y0 + y1) / 2 + 0.1, cz + oz, r * 2, y1 - y0 + 0.2, r * 2, 28 + i));
  }

  // ---- spare parts shelving ----
  {
    const sz = -7.4 + 0.0, len = 1.6, dep = 0.55, h = 2.0;
    const sx = LEFT_X + dep / 2 + 0.03;
    // avoid mini-split (y>2.9) - top of shelf at 2.0 is fine
    for (const a of [-1, 1]) for (const b of [-1, 1])
      B(M.galvDark, sx + a * (dep / 2 - 0.02), h / 2, sz + b * (len / 2 - 0.02), 0.035, h, 0.035, 26, { cast: true });
    const shelves = [0.12, 0.62, 1.12, 1.62, 1.98];
    for (const y of shelves) B(M.galv, sx, y, sz, dep, 0.025, len, 26);
    const boxMats = [M.cardboard, M.cardboard2, M.cardboard, M.galvDark, M.blue];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    shelves.slice(0, 4).forEach((y, si) => {
      let z = sz - len / 2 + 0.06;
      while (z < sz + len / 2 - 0.25) {
        const bw = 0.2 + rnd() * 0.25, bh = 0.14 + rnd() * 0.24, bd = 0.3 + rnd() * 0.18;
        if (rnd() > 0.2) B(boxMats[(si + Math.floor(rnd() * 5)) % 5], sx + (dep - bd) / 2 - 0.02, y + 0.0125 + bh / 2, z + bw / 2, bd, bh, bw, 26);
        z += bw + 0.04;
      }
    });
    // spare contactor + breaker boxes labeled
    const t = canvasTex(128, 32, (c, w, h) => {
      c.fillStyle = "#fff"; c.fillRect(0, 0, w, h); c.fillStyle = "#111"; c.font = "bold 14px Arial";
      c.fillText("SPARE PARTS - MCC", 6, 21);
    });
    planeX(labelMat(t.tex), sx + dep / 2 + 0.002, 1.98, sz, 0.36, 0.09, 26);
  }

  // =====================================================================
  // FLOOR
  // =====================================================================

  // ---- trench cover strip with one plate lifted (work in progress) ----
  {
    const tz = -8.3, x0 = -6.2, x1 = 4.0, tw = 0.6;
    const tt = canvasTex(1024, 64, (c, w, h) => {
      c.fillStyle = "#8b8f92"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#a3a7aa";
      for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 16) {
        c.save(); c.translate(x + ((y / 16) % 2) * 8, y + 4); c.rotate(((x + y) / 16) % 2 ? 0.7 : -0.7);
        c.fillRect(-5, -1.5, 10, 3); c.restore();
      }
      c.fillStyle = "#555a5e";
      for (let x = 0; x < w; x += w / 8.5) c.fillRect(x, 0, 3, h);
    });
    M.checker = std(0xffffff, 0.55, 0.6, { map: tt.tex });
    B(M.checker, (x0 + x1) / 2, 0.006, tz, x1 - x0, 0.012, tw, 26);
    B(M.galvDark, (x0 + 5.2) / 2, 0.008, tz - tw / 2 - 0.02, 5.2 - x0, 0.016, 0.04, 26);
    B(M.galvDark, (x0 + 5.2) / 2, 0.008, tz + tw / 2 + 0.02, 5.2 - x0, 0.016, 0.04, 26);
    // open section (plate removed) + visible cables in the trench
    B(M.trenchVoid, 4.6, 0.003, tz, 1.2, 0.006, tw, 24);
    add(G.cylLo, M.cable, 4.6, 0.012, tz - 0.1, 0.05, 1.2, 0.05, 29, { rz: HALF_PI });
    add(G.cylLo, M.cable, 4.6, 0.012, tz + 0.05, 0.05, 1.2, 0.05, 30, { rz: HALF_PI });
    // lifted plate leaning on a block beside it
    B(M.checker, 4.55, 0.12, tz - 0.75, 1.2, 0.012, 0.6, 26, { rx: 0.35, cast: true });
    B(M.cardboard2, 4.55, 0.1, tz - 0.98, 1.0, 0.2, 0.12, 26);
  }

  // ---- stanchions + yellow/black chain barrier around the open trench ----
  const chainLinks = [];
  {
    const posts = [[3.6, -7.55], [5.7, -7.55], [5.7, -9.2], [3.6, -9.2]];
    const ph = 0.9;
    for (const [px, pz] of posts) {
      add(G.cylLo, M.black, px, 0.025, pz, 0.3, 0.05, 0.3, 26, { cast: true });
      add(G.cylLo, M.yellow, px, ph / 2, pz, 0.05, ph, 0.05, 26, { cast: true });
      add(G.cylLo, M.black, px, ph + 0.02, pz, 0.065, 0.04, 0.065, 26);
    }
    const yc = new THREE.Color(0xe8b90e), kc = new THREE.Color(0x151515);
    for (let i = 0; i < posts.length; i++) {
      const [ax, az] = posts[i], [bx, bz] = posts[(i + 1) % posts.length];
      const len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / 0.055);
      for (let j = 0; j <= n; j++) {
        const f = j / n;
        chainLinks.push({
          x: ax + (bx - ax) * f, z: az + (bz - az) * f,
          y: ph - 0.05 - Math.sin(Math.PI * f) * 0.12,
          ry: -Math.atan2(bz - az, bx - ax), rz: Math.cos(Math.PI * f) * 0.35 * (j % 2 ? 1 : 1),
          c: Math.floor(j / 3) % 2 ? kc : yc,
        });
      }
    }
    const im = new THREE.InstancedMesh(G.box, std(0xffffff, 0.5, 0.2), chainLinks.length);
    const d = new THREE.Object3D();
    chainLinks.forEach((l, i) => {
      d.position.set(l.x, l.y, l.z); d.rotation.set(0, l.ry, l.rz); d.scale.set(0.05, 0.016, 0.02); d.updateMatrix();
      im.setMatrixAt(i, d.matrix); im.setColorAt(i, l.c);
    });
    im.userData.temp = 26; root.add(im); meshCount++;
    // hanging DANGER sign on the chain
    const t = canvasTex(128, 64, (c, w, h) => {
      c.fillStyle = "#fff"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#c62a20"; c.fillRect(0, 0, w, 26);
      c.fillStyle = "#fff"; c.font = "bold 20px Arial"; c.textAlign = "center"; c.fillText("DANGER", w / 2, 20);
      c.fillStyle = "#111"; c.font = "bold 13px Arial"; c.fillText("OPEN TRENCH", w / 2, 44); c.fillText("KEEP OUT", w / 2, 59);
    });
    const sm = labelMat(t.tex); sm.side = THREE.DoubleSide;
    planeZ(sm, 4.65, 0.63, -7.55 + 0.012, 0.36, 0.18, 26);
  }

  // ---- traffic cones ----
  function cone(x, z, ry = 0) {
    B(M.black, x, 0.015, z, 0.36, 0.03, 0.36, 26, { ry, cast: true });
    add(G.cone, M.orange, x, 0.37, z, 0.28, 0.68, 0.28, 26, { cast: true });
    add(G.cylLo, M.white, x, 0.46, z, 0.14, 0.09, 0.14, 26);
  }
  cone(3.2, -7.2, 0.3);
  cone(6.15, -7.3, -0.4);

  // ---- cable reel ----
  {
    const cx = 7.4, cz = -8.6;
    for (const o of [-0.22, 0.22]) add(G.cyl, std(0x9a7043, 0.9, 0), cx, 0.45, cz + o, 0.9, 0.05, 0.9, 26, { rx: HALF_PI, cast: true });
    add(G.cyl, M.cable, cx, 0.45, cz, 0.62, 0.4, 0.62, 27, { rx: HALF_PI, cast: true });
    add(G.cylLo, M.galvDark, cx, 0.45, cz, 0.06, 0.6, 0.06, 26, { rx: HALF_PI });
    // tail of cable running toward trench
    add(G.cylLo, M.cable, cx - 0.9, 0.02, cz + 0.1, 0.035, 1.5, 0.035, 27, { rz: HALF_PI, ry: 0.15 });
  }

  // ---- fiberglass step ladder (A-frame) near left wall ----
  {
    const g = new THREE.Group(); g.position.set(-9.7, 0, -1.2); g.rotation.y = 0.5; root.add(g);
    const h = 1.8, spread = 0.32, w = 0.48;
    for (const side of [-1, 1]) for (const face of [-1, 1]) {
      const r = B(M.fiberglass, side * w / 2, h / 2, face * spread / 2, 0.035, h, 0.07, 26, { parent: g, cast: true });
      r.rotation.x = face * 0.17;
    }
    for (let i = 0; i < 4; i++) {
      const y = 0.35 + i * 0.36, zf = spread / 2 - (y / h) * spread / 2 + 0.02;
      B(M.alu, 0, y, zf, w, 0.025, 0.09, 26, { parent: g });
    }
    B(M.black, 0, h + 0.02, 0, w + 0.06, 0.05, 0.22, 26, { parent: g, cast: true });
    const lab = B(M.orange, w / 2 + 0.02, 1.2, spread / 2 - 0.12, 0.003, 0.2, 0.06, 26, { parent: g });
    lab.rotation.x = 0.17;
  }

  // ---- floor drains ----
  {
    const t = canvasTex(64, 64, (c, w, h) => {
      c.fillStyle = "#5d6064"; c.fillRect(0, 0, w, h);
      c.fillStyle = "#15171a";
      for (let i = 0; i < 6; i++) c.fillRect(8 + i * 9, 8, 5, h - 16);
    });
    const dm = std(0xffffff, 0.6, 0.6, { map: t.tex });
    B(dm, 10.2, 0.003, BACK_Z + 0.75, 0.25, 0.006, 0.25, 25);
    B(dm, -1.6, 0.003, -9.4, 0.25, 0.006, 0.25, 25);
  }

  // =====================================================================
  // INSTANCED: couplers + LEDs
  // =====================================================================
  {
    const im = new THREE.InstancedMesh(G.cylLo, M.galv, couplers.length);
    const d = new THREE.Object3D();
    couplers.forEach((c, i) => {
      d.position.set(c.x, c.y, c.z);
      d.rotation.set(c.axis === "z" ? HALF_PI : 0, 0, c.axis === "x" ? HALF_PI : 0);
      d.scale.set(0.034, 0.05, 0.034); d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    });
    im.userData.temp = 26; root.add(im); meshCount++;
  }
  const ledMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const ledMesh = new THREE.InstancedMesh(G.box, ledMat, leds.length);
  {
    const d = new THREE.Object3D();
    leds.forEach((l, i) => {
      d.position.set(l.x, l.y, l.z);
      // left-wall LEDs are oriented flat anyway (cube), scale uniform-ish
      d.scale.set(l.size, l.size * 0.7, 0.004); d.updateMatrix();
      ledMesh.setMatrixAt(i, d.matrix);
      ledMesh.setColorAt(i, l.color);
    });
    ledMesh.userData.temp = 30;
    ledMesh.receiveShadow = false;
    root.add(ledMesh); meshCount++;
  }
  const dimColor = new THREE.Color(0x0c0c0c);
  const tmpColor = new THREE.Color();

  // =====================================================================
  // DUST MOTES
  // =====================================================================
  const DUST = 120;
  const dustPos = new Float32Array(DUST * 3);
  const dustVel = new Float32Array(DUST * 3);
  for (let i = 0; i < DUST; i++) {
    dustPos[i * 3] = -10.5 + Math.random() * 21;
    dustPos[i * 3 + 1] = 0.3 + Math.random() * 3.5;
    dustPos[i * 3 + 2] = -11.5 + Math.random() * 15.5;
    dustVel[i * 3] = (Math.random() - 0.5) * 0.04;
    dustVel[i * 3 + 1] = (Math.random() - 0.5) * 0.02;
    dustVel[i * 3 + 2] = (Math.random() - 0.5) * 0.04;
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(
    dustGeo,
    new THREE.PointsMaterial({ color: 0xfff1d8, size: 0.022, sizeAttenuation: true, transparent: true, opacity: 0.32, depthWrite: false })
  );
  dust.frustumCulled = false;
  root.add(dust);

  // =====================================================================
  // UPDATE
  // =====================================================================
  function drawKeypad(k) {
    const c = k.kp.ctx, w = 160, h = 80;
    c.fillStyle = "#0a1a0e"; c.fillRect(0, 0, w, h);
    c.fillStyle = "#7dff9a";
    c.font = "bold 30px monospace";
    c.fillText(k.run ? `${k.hz.toFixed(1)} Hz` : "READY", 8, 34);
    c.font = "bold 22px monospace";
    c.fillText(k.run ? `${k.a.toFixed(1)} A` : "0.0 Hz STOP", 8, 66);
    k.kp.tex.needsUpdate = true;
  }
  keypads.forEach(drawKeypad);

  let kpTimer = 0;
  let lastSec = -1;
  root.userData.meshCount = meshCount;

  return {
    group: root,
    meshCount,
    update(dt, t) {
      dt = Math.min(dt || 0, 0.1);

      // keypads ~1 Hz
      kpTimer += dt;
      if (kpTimer > 1.0) {
        kpTimer = 0;
        for (const k of keypads) {
          if (!k.run) continue;
          k.hz = Math.min(60, Math.max(0, k.base.hz + (Math.random() - 0.5) * 0.4));
          k.a = Math.max(0, k.base.a + (Math.random() - 0.5) * 1.2);
          drawKeypad(k);
        }
      }

      // LEDs
      for (let i = 0; i < leds.length; i++) {
        const l = leds[i];
        let on = true;
        if (l.mode === "off") on = false;
        else if (l.mode === "blink") on = ((t * l.rate + l.phase) % 1) < 0.5;
        else if (l.mode === "rand") {
          if (t > l.next) { l.on = Math.random() > 0.35; l.next = t + (0.03 + Math.random() * 0.25) * (6 / l.rate); }
          on = l.on;
        }
        ledMesh.setColorAt(i, on ? l.color : tmpColor.copy(l.color).multiplyScalar(0.06).add(dimColor));
      }
      if (ledMesh.instanceColor) ledMesh.instanceColor.needsUpdate = true;

      // exhaust fan + HVAC louver flutter
      fan.blades.rotation.z -= dt * 14;
      hvac.louver.rotation.z = -0.45 + Math.sin(t * 7.3) * 0.04 + Math.sin(t * 13.1) * 0.02;

      // horn/strobe: short white flash every 4 s
      const ph = t % 4;
      const flash = ph < 0.07 ? 1 : 0;
      M.lens.emissiveIntensity = flash * 6;
      strobe.light.intensity = flash * 25;

      // clock (real time, second hand ticks)
      const now = new Date();
      const s = now.getSeconds();
      if (s !== lastSec) {
        lastSec = s;
        const m = now.getMinutes() + s / 60, hr = (now.getHours() % 12) + m / 60;
        clock.s.rotation.z = -(s / 60) * Math.PI * 2;
        clock.m.rotation.z = -(m / 60) * Math.PI * 2;
        clock.h.rotation.z = -(hr / 12) * Math.PI * 2;
      }

      // dust drift
      for (let i = 0; i < DUST; i++) {
        const j = i * 3;
        dustPos[j] += (dustVel[j] + Math.sin(t * 0.3 + i) * 0.01) * dt;
        dustPos[j + 1] += (dustVel[j + 1] + Math.sin(t * 0.21 + i * 1.7) * 0.006) * dt;
        dustPos[j + 2] += (dustVel[j + 2] + Math.cos(t * 0.27 + i) * 0.01) * dt;
        if (dustPos[j] < -10.6) dustPos[j] = 10.4; else if (dustPos[j] > 10.6) dustPos[j] = -10.4;
        if (dustPos[j + 1] < 0.2) dustPos[j + 1] = 3.8; else if (dustPos[j + 1] > 3.9) dustPos[j + 1] = 0.3;
        if (dustPos[j + 2] < -11.6) dustPos[j + 2] = 3.9; else if (dustPos[j + 2] > 4.0) dustPos[j + 2] = -11.5;
      }
      dustGeo.attributes.position.needsUpdate = true;
    },
  };
}
