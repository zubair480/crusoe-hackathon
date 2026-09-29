// Thermal camera post-process. In thermal mode every mesh renders its temperature as a grey level
// (0 = 20 °C, 1 = 80 °C) into a low-res target, like a 320x240 microbolometer. The composite pass
// blurs it, adds heat bloom around hot spots, sensor noise and fixed-pattern stripes, then maps
// the result through the ironbow palette.
import * as THREE from "three";

export const T_LO = 20, T_HI = 80;
export const tnorm = (t) => Math.min(1, Math.max(0, (t - T_LO) / (T_HI - T_LO)));

// temperature material: flat value plus a slight warm-at-top gradient, no lighting
export function tempMaterial(t) {
  const m = new THREE.ShaderMaterial({
    uniforms: { uT: { value: tnorm(t) } },
    vertexShader: `varying vec3 vW; varying vec3 vN; void main(){ vec4 w = modelMatrix * vec4(position,1.); vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uT; varying vec3 vW; varying vec3 vN;
      float h(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719))) * 43758.5453); }
      void main(){ float t = uT + vW.y * .006 + (h(floor(vW * 9.)) - .5) * .012 - max(0., -vN.y) * .01 + vN.y * .004; gl_FragColor = vec4(vec3(t), 1.); }`,
  });
  m.userData.setT = (tc) => { m.uniforms.uT.value = tnorm(tc); };
  return m;
}

export class ThermalCam {
  constructor(renderer) {
    this.r = renderer;
    const o = { type: THREE.HalfFloatType, depthBuffer: true };
    this.rtLo = new THREE.WebGLRenderTarget(320, 240, o);
    this.rtGlow = new THREE.WebGLRenderTarget(64, 48, { type: THREE.HalfFloatType, depthBuffer: false });
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const quad = (mat) => { const s = new THREE.Scene(); s.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat)); return s; };
    this.down = new THREE.ShaderMaterial({
      uniforms: { src: { value: this.rtLo.texture }, px: { value: new THREE.Vector2(1 / 320, 1 / 240) } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`,
      fragmentShader: `uniform sampler2D src; uniform vec2 px; varying vec2 vUv;
        void main(){ float s = 0., w = 0.; for (int i=-3;i<=3;i++) for (int j=-3;j<=3;j++){ float k = exp(-float(i*i+j*j)/8.); float v = texture2D(src, vUv + vec2(i,j)*px*2.5).r; s += max(0., v - .45) * k; w += k; } gl_FragColor = vec4(vec3(s / w), 1.); }`,
    });
    this.comp = new THREE.ShaderMaterial({
      uniforms: { lo: { value: this.rtLo.texture }, glow: { value: this.rtGlow.texture }, px: { value: new THREE.Vector2(1 / 320, 1 / 240) }, time: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.,1.); }`,
      fragmentShader: `uniform sampler2D lo, glow; uniform vec2 px; uniform float time; varying vec2 vUv;
        float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
        vec3 ironbow(float x){
          x = clamp(x, 0., 1.);
          vec3 c0 = vec3(.03,.015,.11), c1 = vec3(.18,.02,.43), c2 = vec3(.5,.04,.55), c3 = vec3(.78,.12,.43), c4 = vec3(.93,.31,.12), c5 = vec3(.99,.63,.04), c6 = vec3(1.,.89,.35), c7 = vec3(1.,1.,.94);
          if (x < .18) return mix(c0,c1,x/.18); if (x < .36) return mix(c1,c2,(x-.18)/.18); if (x < .52) return mix(c2,c3,(x-.36)/.16);
          if (x < .66) return mix(c3,c4,(x-.52)/.14); if (x < .8) return mix(c4,c5,(x-.66)/.14); if (x < .92) return mix(c5,c6,(x-.8)/.12); return mix(c6,c7,(x-.92)/.08);
        }
        void main(){
          // 3x3 tent blur of the 320x240 sensor image: optics + detector crosstalk
          float t = 0.; for (int i=-1;i<=1;i++) for (int j=-1;j<=1;j++) t += texture2D(lo, vUv + vec2(i,j)*px).r * (i==0&&j==0 ? .25 : (i==0||j==0 ? .125 : .0625));
          t += texture2D(glow, vUv).r * .9;                    // heat bleeding into surroundings
          vec2 sp = floor(vUv * vec2(320.,240.));
          t += (h(sp + fract(time) * 91.) - .5) * .018;        // temporal sensor noise (NETD)
          t += (h(vec2(sp.x, 7.)) - .5) * .008;                // fixed-pattern column noise
          vec2 d = vUv - .5; t -= dot(d,d) * .06;              // lens vignetting reads cooler at the edge
          t = pow(clamp((t - .02) / .9, 0., 1.), .78);         // camera AGC: stretch the span, lift the midtones
          gl_FragColor = vec4(ironbow(t), 1.);
        }`,
    });
    this.downScene = quad(this.down); this.compScene = quad(this.comp);
  }
  resize(w, h) {
    const a = w / h, H = 240, W = Math.round(H * a);
    this.rtLo.setSize(W, H); this.rtGlow.setSize(Math.round(W / 5), Math.round(H / 5));
    this.down.uniforms.px.value.set(1 / W, 1 / H); this.comp.uniforms.px.value.set(1 / W, 1 / H);
  }
  render(scene, camera, time) {
    const r = this.r, tm = r.toneMapping, cs = r.outputColorSpace;
    r.toneMapping = THREE.NoToneMapping;
    r.setRenderTarget(this.rtLo); r.render(scene, camera);
    r.setRenderTarget(this.rtGlow); r.render(this.downScene, this.cam);
    r.setRenderTarget(null); this.comp.uniforms.time.value = time; r.render(this.compScene, this.cam);
    r.toneMapping = tm; r.outputColorSpace = cs;
  }
}
