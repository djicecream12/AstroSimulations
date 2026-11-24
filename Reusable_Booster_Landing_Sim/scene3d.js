/* =====================================================================
   Reusable Booster Landing Simulator — 3D view (three.js)
   ---------------------------------------------------------------------
   The physics stays 2D: downrange x and altitude y, with z = 0 as the
   flight plane. This file draws that flight in a 3D world and adds an
   orbit camera the user steers with the mouse, touch or arrow keys.

   Exposes window.BoosterView3D.create(canvas, deps) → view
   ===================================================================== */
(function () {
  "use strict";
  const T = window.THREE;
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
  function hash(n) { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }

  const SKY = [[0, [150, 196, 236]], [3000, [104, 166, 228]], [12000, [48, 106, 188]], [25000, [18, 42, 105]], [45000, [6, 13, 38]], [80000, [1, 3, 10]]];
  function skyAt(alt, out) {
    let c = SKY[SKY.length - 1][1];
    for (let i = 1; i < SKY.length; i++) {
      if (alt <= SKY[i][0]) {
        const t = clamp((alt - SKY[i - 1][0]) / (SKY[i][0] - SKY[i - 1][0]), 0, 1);
        const a = SKY[i - 1][1], b = SKY[i][1];
        c = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
        break;
      }
    }
    return out.setRGB(c[0] / 255, c[1] / 255, c[2] / 255);
  }

  const MIN_ROCKET_PX = 46;           // smallest on-screen booster height before it gets enlarged
  const SUN_DIR = new T.Vector3(-0.45, 0.72, 0.53).normalize();
  const VIEWS = {
    close: { dist: 230, pitch: 0.08 },
    wide: { dist: 3200, pitch: 0.12 },
    ground: { dist: 0, pitch: 0 },
  };

  // ---------------------------------------------------------------------
  // Procedural textures
  // ---------------------------------------------------------------------
  function canvasTex(size, draw, repeat = true) {
    const c = document.createElement("canvas");
    c.width = c.height = size;
    draw(c.getContext("2d"), size);
    const t = new T.CanvasTexture(c);
    if (repeat) { t.wrapS = t.wrapT = T.RepeatWrapping; }
    t.anisotropy = 8;
    return t;
  }
  /** Seamless blotchy noise: random soft ellipses drawn with wrap-around. */
  function blotches(g, size, base, colors, n, rmin, rmax, alpha, seed) {
    g.fillStyle = base; g.fillRect(0, 0, size, size);
    for (let i = 0; i < n; i++) {
      const x = hash(seed + i * 3) * size, y = hash(seed + i * 3 + 1) * size;
      const r = rmin + hash(seed + i * 3 + 2) * (rmax - rmin);
      g.globalAlpha = alpha * (0.4 + hash(seed + i * 7) * 0.6);
      g.fillStyle = colors[i % colors.length];
      for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
        g.beginPath(); g.ellipse(x + ox, y + oy, r, r * (0.5 + hash(i + seed) * 0.8), hash(i) * 3, 0, Math.PI * 2); g.fill();
      }
    }
    g.globalAlpha = 1;
  }
  const radialTex = (inner, outer) => canvasTex(128, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, inner); gr.addColorStop(1, outer);
    g.fillStyle = gr; g.fillRect(0, 0, s, s);
  }, false);

  // ---------------------------------------------------------------------
  // Shaders (log-depth aware so they sort correctly with the scene)
  // ---------------------------------------------------------------------
  const SKY_VS = `
    varying vec3 vWorld;
    void main() {
      vec4 w = modelMatrix * vec4(position, 1.0);
      vWorld = w.xyz;
      gl_Position = projectionMatrix * viewMatrix * w;
    }`;
  const SKY_FS = `
    uniform vec3 uHorizon, uZenith, uGround, uSunDir;
    uniform float uLimb;
    varying vec3 vWorld;
    void main() {
      vec3 d = normalize(vWorld - cameraPosition);
      float e = d.y;
      vec3 col = mix(uHorizon, uZenith, pow(clamp(e, 0.0, 1.0), 0.45));
      col += uLimb * vec3(0.22, 0.48, 1.0) * exp(-abs(e) * 16.0);
      if (e < 0.0) col = mix(col, uGround, clamp(-e * 5.0, 0.0, 1.0));
      float s = max(dot(d, uSunDir), 0.0);
      col += vec3(1.0, 0.95, 0.85) * (pow(s, 900.0) * 3.0 + pow(s, 14.0) * 0.22);
      gl_FragColor = vec4(col, 1.0);
    }`;

  const PART_VS = `
    attribute float aSize;
    attribute vec4 aColor;
    uniform float uScale;
    varying vec4 vColor;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vColor = aColor;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = clamp(aSize * uScale / max(-mv.z, 0.1), 1.0, 700.0);
      #include <logdepthbuf_vertex>
    }`;
  const PART_FS = `
    varying vec4 vColor;
    #include <common>
    #include <logdepthbuf_pars_fragment>
    void main() {
      vec2 c = gl_PointCoord - 0.5;
      float r = length(c) * 2.0;
      if (r > 1.0) discard;
      gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - r * r));
      #include <logdepthbuf_fragment>
    }`;

  // Exhaust plume: an open cylinder whose radius is reshaped in the vertex shader.
  const PLUME_VS = `
    uniform float uL, uW0, uW1;
    varying float vT;
    varying vec3 vN, vView;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      float t = -position.y;
      float r = mix(uW0 * 0.5, uW1 * 0.5, smoothstep(0.0, 0.45, t)) * pow(1.0 - t, 0.55);
      vec3 p = vec3(position.x * r, -t * uL, position.z * r);
      vT = t;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vN = normalize(normalMatrix * vec3(position.x, 0.0, position.z));
      vView = normalize(-mv.xyz);
      gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`;
  const PLUME_FS = `
    uniform vec3 uC0, uC1, uC2;
    uniform float uAlpha;
    varying float vT;
    varying vec3 vN, vView;
    #include <common>
    #include <logdepthbuf_pars_fragment>
    void main() {
      float edge = abs(dot(normalize(vN), normalize(vView)));
      vec3 col = vT < 0.25 ? mix(uC0, uC1, vT / 0.25) : mix(uC1, uC2, (vT - 0.25) / 0.75);
      float a = uAlpha * pow(edge, 1.4) * pow(1.0 - vT, 1.3);
      gl_FragColor = vec4(col, a);
      #include <logdepthbuf_fragment>
    }`;

  // ---------------------------------------------------------------------
  function create(canvas, deps) {
    const { VEHICLE, MISSION, windAt, PHASE_COLORS, COAST_X } = deps;
    const R = VEHICLE.diameter / 2;

    const renderer = new T.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: "high-performance" });
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    const scene = new T.Scene();
    scene.fog = new T.FogExp2(0xbcd6ee, 1 / 30000);
    const camera = new T.PerspectiveCamera(50, 1, 0.5, 4e6);
    let W = 1, H = 1, DPR = 1;

    // ---------------- lights ----------------
    const hemi = new T.HemisphereLight(0xcfe3ff, 0x4d5c3c, 0.65);
    scene.add(hemi);
    const sun = new T.DirectionalLight(0xfff2de, 1.05);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    // ---------------- sky, stars ----------------
    const skyU = {
      uHorizon: { value: new T.Color() }, uZenith: { value: new T.Color() }, uGround: { value: new T.Color(0x24361c) },
      uSunDir: { value: SUN_DIR }, uLimb: { value: 0 },
    };
    const sky = new T.Mesh(new T.SphereGeometry(1e6, 48, 24),
      new T.ShaderMaterial({ uniforms: skyU, vertexShader: SKY_VS, fragmentShader: SKY_FS, side: T.BackSide, depthWrite: false, depthTest: false, fog: false }));
    sky.renderOrder = -10; sky.frustumCulled = false;
    scene.add(sky);

    const starPos = [];
    for (let i = 0; i < 2200; i++) {
      const u = hash(i + 11), v = hash(i + 4011);
      const y = 0.03 + u * 0.97, a = v * Math.PI * 2, rr = Math.sqrt(1 - y * y);
      starPos.push(Math.cos(a) * rr * 9e5, y * 9e5, Math.sin(a) * rr * 9e5);
    }
    const starGeo = new T.BufferGeometry();
    starGeo.setAttribute("position", new T.Float32BufferAttribute(starPos, 3));
    const starMat = new T.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
    const stars = new T.Points(starGeo, starMat);
    stars.renderOrder = -9; stars.frustumCulled = false;
    scene.add(stars);

    // ---------------- ground ----------------
    const GROUND_Y = -0.4;
    /** Flat grid with denser cells near the action (keeps shadows and fog accurate). */
    function gridGeo(xs, zs, tile) {
      const pos = [], uv = [], nor = [], idx = [];
      for (const z of zs) for (const x of xs) { pos.push(x, 0, z); uv.push(x / tile, -z / tile); nor.push(0, 1, 0); }
      const nx = xs.length;
      for (let j = 0; j < zs.length - 1; j++) for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
        idx.push(a, c, b, b, c, d);
      }
      const g = new T.BufferGeometry();
      g.setAttribute("position", new T.Float32BufferAttribute(pos, 3));
      g.setAttribute("normal", new T.Float32BufferAttribute(nor, 3));
      g.setAttribute("uv", new T.Float32BufferAttribute(uv, 2));
      g.setIndex(idx);
      return g;
    }
    const FAR = 1.5e6;
    const fine = (a, b, step) => { const o = []; for (let v = a; v <= b + 1e-6; v += step) o.push(v); return o; };
    const zs = [-FAR, -2e5, -6e4, ...fine(-20000, 20000, 1000), 6e4, 2e5, FAR];
    const landXs = [-FAR, -2e5, -6e4, ...fine(-26000, 2000, 1000), COAST_X];
    const seaXs = [COAST_X, ...fine(3000, 20000, 1000), 6e4, 2e5, FAR];

    const landTex = canvasTex(512, (g, s) => blotches(g, s, "#4c6b3a", ["#3d5a2e", "#5d7d44", "#6b8a4c", "#34502a", "#7a8a52"], 900, 6, 46, 0.55, 1));
    const land = new T.Mesh(gridGeo(landXs, zs, 900), new T.MeshLambertMaterial({ map: landTex }));
    land.position.y = GROUND_Y; land.receiveShadow = true;
    const seaTex = canvasTex(256, (g, s) => blotches(g, s, "#2f6c9b", ["#2a628e", "#3a7aab", "#28597f"], 500, 3, 20, 0.5, 77));
    const sea = new T.Mesh(gridGeo(seaXs, zs, 260), new T.MeshPhongMaterial({ map: seaTex, specular: 0x6f7f8f, shininess: 70 }));
    sea.position.y = GROUND_Y - 0.3;
    const beach = new T.Mesh(gridGeo([COAST_X - 45, COAST_X + 15], zs, 200), new T.MeshLambertMaterial({ color: 0xd8c79a }));
    beach.position.y = GROUND_Y + 0.05;
    scene.add(land, sea, beach);

    const mats = {
      concrete: new T.MeshLambertMaterial({ color: 0x9a9ea3 }),
      darkConcrete: new T.MeshLambertMaterial({ color: 0x3c3f44 }),
      steel: new T.MeshLambertMaterial({ color: 0x9aa1aa }),
      darkSteel: new T.MeshLambertMaterial({ color: 0x5d636b }),
      road: new T.MeshLambertMaterial({ color: 0x55585c }),
      building: new T.MeshLambertMaterial({ color: 0xdfe3e8 }),
      lamp: new T.MeshBasicMaterial({ color: 0xfff6c8 }),
    };
    function box(w, h, d, mat, x, y, z, parent = scene) {
      const m = new T.Mesh(new T.BoxGeometry(w, h, d), mat);
      m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
      parent.add(m); return m;
    }

    // road between the pad and the landing zone, for a sense of scale
    box(MISSION.padX - MISSION.lzX + 400, 0.1, 9, mats.road, (MISSION.padX + MISSION.lzX) / 2, GROUND_Y + 0.02, 160).castShadow = false;

    // --- launch pad ---
    const padX = MISSION.padX;
    box(150, 0.4, 150, mats.concrete, padX, -0.2, 0);
    box(12, 0.42, 70, mats.darkConcrete, padX, -0.19, -35);
    // lattice tower
    const towerX = padX - 17, towerH = 82, tw = 7;
    const unit = new T.BoxGeometry(1, 1, 1);
    const beams = [];
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => new T.Vector3(towerX + (a * tw) / 2, 0, (b * tw) / 2));
    for (const c of corners) beams.push([c.clone(), c.clone().setY(towerH), 0.6]);
    for (let y = 0; y < towerH; y += 6) for (let f = 0; f < 4; f++) {
      const a = corners[f], b = corners[(f + 1) % 4];
      beams.push([a.clone().setY(y), b.clone().setY(Math.min(y + 6, towerH)), 0.22]);
      beams.push([b.clone().setY(y), a.clone().setY(Math.min(y + 6, towerH)), 0.22]);
      beams.push([a.clone().setY(y), b.clone().setY(y), 0.25]);
    }
    // crew-access style arm and lightning masts
    beams.push([new T.Vector3(towerX + tw / 2, 62, 0), new T.Vector3(padX - 2.4, 62, 0), 1.2]);
    for (const [mx, mz] of [[-110, -60], [95, 60]]) beams.push([new T.Vector3(padX + mx, 0, mz), new T.Vector3(padX + mx, 115, mz), 0.9]);
    const towerMesh = new T.InstancedMesh(unit, mats.steel, beams.length);
    const _m = new T.Matrix4(), _q = new T.Quaternion(), _s = new T.Vector3(), _up = new T.Vector3(0, 1, 0), _d = new T.Vector3();
    beams.forEach(([a, b, th], i) => {
      _d.subVectors(b, a); const len = _d.length();
      _q.setFromUnitVectors(_up, _d.normalize());
      _m.compose(a.clone().add(b).multiplyScalar(0.5), _q, _s.set(th, len, th));
      towerMesh.setMatrixAt(i, _m);
    });
    towerMesh.castShadow = true;
    scene.add(towerMesh);
    box(tw + 1, 1, tw + 1, mats.darkSteel, towerX, towerH + 0.5, 0);
    // a hangar and a few service buildings
    box(80, 28, 46, mats.building, padX + 140, 14 + GROUND_Y, -230);
    box(30, 10, 22, mats.building, padX - 160, 5 + GROUND_Y, 190);
    const tank = new T.Mesh(new T.SphereGeometry(9, 24, 16), mats.building);
    tank.position.set(padX + 120, 9, 120); tank.castShadow = true; scene.add(tank);

    // --- landing zone ---
    const lzX = MISSION.lzX, lzR = MISSION.padRadius;
    const lzTex = canvasTex(512, (g, s) => {
      blotches(g, s, "#a2a5a9", ["#979a9e", "#adb0b3"], 300, 2, 10, 0.35, 5);
      g.strokeStyle = "#f1ede0"; g.lineWidth = 16;
      g.beginPath(); g.arc(s / 2, s / 2, s * 0.39, 0, Math.PI * 2); g.stroke();
      g.lineWidth = 26; g.strokeStyle = "#f1ede0";
      g.beginPath(); g.moveTo(s / 2, s * 0.25); g.lineTo(s / 2, s * 0.75); g.moveTo(s * 0.25, s / 2); g.lineTo(s * 0.75, s / 2); g.stroke();
      g.fillStyle = "#e8c74a"; g.beginPath(); g.arc(s / 2, s / 2, 16, 0, Math.PI * 2); g.fill();
    }, false);
    const lzSlab = new T.Mesh(new T.CylinderGeometry(lzR + 6, lzR + 8, 0.4, 64), mats.concrete);
    lzSlab.position.set(lzX, -0.2, 0); lzSlab.receiveShadow = true; scene.add(lzSlab);
    const lzTop = new T.Mesh(new T.CircleGeometry(lzR, 64), new T.MeshLambertMaterial({ map: lzTex }));
    lzTop.rotation.x = -Math.PI / 2; lzTop.position.set(lzX, 0.005, 0); lzTop.receiveShadow = true; scene.add(lzTop);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4, px = lzX + Math.cos(a) * (lzR + 28), pz = Math.sin(a) * (lzR + 28);
      box(0.5, 26, 0.5, mats.darkSteel, px, 13, pz);
      box(3, 1.4, 1, mats.lamp, px, 26.5, pz).castShadow = false;
    }

    // --- trees ---
    const treeGeo = new T.ConeGeometry(1, 1, 7); treeGeo.translate(0, 0.5, 0);
    const treeMat = new T.MeshLambertMaterial({ color: 0xffffff });
    const trees = new T.InstancedMesh(treeGeo, treeMat, 7000);
    let nTrees = 0; const tc = new T.Color();
    for (let i = 0; nTrees < 7000 && i < 30000; i++) {
      const x = -18000 + hash(i + 1) * (COAST_X - 120 + 18000), z = (hash(i + 2) - 0.5) * 16000;
      if (Math.abs(x - padX) < 260 && Math.abs(z) < 300) continue;
      if (Math.hypot(x - lzX, z) < 230) continue;
      if (Math.abs(z - 160) < 14) continue;
      const h = 5 + hash(i + 3) * 12, w = 2 + hash(i + 4) * 3;
      _m.compose(_s.set(x, GROUND_Y, z), _q.identity(), new T.Vector3(w, h, w));
      trees.setMatrixAt(nTrees, _m);
      trees.setColorAt(nTrees, tc.setHSL(0.27 + hash(i + 5) * 0.06, 0.45, 0.13 + hash(i + 6) * 0.08));
      nTrees++;
    }
    trees.count = nTrees;
    scene.add(trees);

    // --- clouds ---
    const puffTex = radialTex("rgba(255,255,255,1)", "rgba(255,255,255,0)");
    const cloudMat = new T.SpriteMaterial({ map: puffTex, color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, fog: true });
    const cloudShade = new T.SpriteMaterial({ map: puffTex, color: 0xc9d3de, transparent: true, opacity: 0.7, depthWrite: false, fog: true });
    const clouds = new T.Group();
    for (let i = 0; i < 300; i++) {
      const cx = -50000 + hash(i + 1) * 100000, cz = (hash(i + 2) - 0.5) * 80000, cy = 1400 + hash(i + 3) * 2300;
      if (Math.abs(cz) < 1500 && Math.abs(cx - lzX / 2) < 9000) continue; // keep the flight corridor fairly clear
      const w = 200 + hash(i + 4) * 500;
      const n = 4 + Math.floor(hash(i + 5) * 4);
      for (let j = 0; j < n; j++) {
        const sp = new T.Sprite(j < 2 ? cloudShade : cloudMat);
        const s = w * (0.45 + hash(i * 13 + j) * 0.4);
        sp.scale.set(s, s * 0.7, 1);
        sp.position.set(cx + (hash(i * 7 + j) - 0.5) * w, cy + (j < 2 ? -s * 0.08 : hash(i * 5 + j) * s * 0.25), cz + (hash(i * 3 + j) - 0.5) * w * 0.7);
        clouds.add(sp);
      }
    }
    const cirrusMat = new T.MeshBasicMaterial({ map: puffTex, color: 0xffffff, transparent: true, opacity: 0.32, depthWrite: false, side: T.DoubleSide });
    for (let i = 0; i < 70; i++) {
      const m = new T.Mesh(new T.PlaneGeometry(1, 1), cirrusMat);
      m.rotation.x = -Math.PI / 2; m.rotation.z = hash(i + 50) * Math.PI;
      const w = 1500 + hash(i + 51) * 3000;
      m.scale.set(w, w * 0.25, 1);
      m.position.set(-60000 + hash(i + 52) * 120000, 7500 + hash(i + 53) * 3000, (hash(i + 54) - 0.5) * 90000);
      clouds.add(m);
    }
    scene.add(clouds);

    // ---------------------------------------------------------------------
    // Vehicles
    // ---------------------------------------------------------------------
    const vm = {
      white: new T.MeshStandardMaterial({ color: 0xf1f3f6, roughness: 0.5, metalness: 0.12 }),
      black: new T.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.2 }),
      engine: new T.MeshStandardMaterial({ color: 0x3a3632, roughness: 0.45, metalness: 0.7, side: T.DoubleSide }),
      octa: new T.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.7 }),
      band: new T.MeshStandardMaterial({ color: 0xcfd5dc, roughness: 0.5 }),
      leg: new T.MeshStandardMaterial({ color: 0x1d2024, roughness: 0.55, metalness: 0.3 }),
      strut: new T.MeshStandardMaterial({ color: 0x5a6068, roughness: 0.4, metalness: 0.6 }),
    };
    const sootTex = canvasTex(8, () => {}, false);
    {
      const c = sootTex.image; c.width = 4; c.height = 256;
      const g = c.getContext("2d"), gr = g.createLinearGradient(0, 0, 0, 256);
      gr.addColorStop(0, "#000"); gr.addColorStop(0.35, "#333"); gr.addColorStop(0.75, "#999"); gr.addColorStop(1, "#fff");
      g.fillStyle = gr; g.fillRect(0, 0, 4, 256); sootTex.needsUpdate = true;
    }
    vm.soot = new T.MeshStandardMaterial({ color: 0x2b2520, roughness: 0.9, transparent: true, alphaMap: sootTex, opacity: 0, depthWrite: false });
    const finTex = canvasTex(64, (g, s) => {
      g.fillStyle = "#000"; g.fillRect(0, 0, s, s);
      g.strokeStyle = "#fff"; g.lineWidth = 3;
      for (let i = 0; i <= 8; i++) { const p = 1.5 + (i * (s - 3)) / 8; g.beginPath(); g.moveTo(p, 0); g.lineTo(p, s); g.moveTo(0, p); g.lineTo(s, p); g.stroke(); }
    }, false);
    vm.fin = new T.MeshStandardMaterial({ color: 0x6a7079, roughness: 0.4, metalness: 0.8, alphaMap: finTex, alphaTest: 0.5, side: T.DoubleSide });

    function cyl(rt, rb, h, mat, y, parent, seg = 32, open = false) {
      const m = new T.Mesh(new T.CylinderGeometry(rt, rb, h, seg, 1, open), mat);
      m.position.y = y; m.castShadow = true; m.receiveShadow = true;
      parent.add(m); return m;
    }
    function fairing(parent, base) {
      const pts = [new T.Vector2(R, 0), new T.Vector2(2.6, 1.5), new T.Vector2(2.6, 8)];
      for (let i = 1; i <= 12; i++) {
        const t = i / 12, a = 1 - t;
        pts.push(new T.Vector2(a * a * 2.6 + 2 * a * t * 2.6 + t * t * 0.001, a * a * 8 + 2 * a * t * 14.5 + t * t * 16));
      }
      const m = new T.Mesh(new T.LatheGeometry(pts, 40), vm.white);
      m.position.y = base; m.castShadow = true; parent.add(m);
    }
    function upperStack(parent, base) {
      cyl(R, R, 13, vm.white, base + 6.5, parent);
      cyl(R + 0.01, R + 0.01, 0.5, vm.black, base + 0.25, parent);
      fairing(parent, base + 13);
    }

    function makePlume() {
      const geo = new T.CylinderGeometry(1, 1, 1, 28, 20, true); geo.translate(0, -0.5, 0);
      const mk = () => new T.ShaderMaterial({
        uniforms: { uL: { value: 30 }, uW0: { value: 3 }, uW1: { value: 4 }, uAlpha: { value: 0.9 }, uC0: { value: new T.Color() }, uC1: { value: new T.Color() }, uC2: { value: new T.Color() } },
        vertexShader: PLUME_VS, fragmentShader: PLUME_FS, transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      });
      const g = new T.Group();
      const outer = new T.Mesh(geo, mk()), core = new T.Mesh(geo, mk());
      outer.frustumCulled = core.frustumCulled = false;
      g.add(outer, core);
      const diamonds = [];
      const dMat = new T.MeshBasicMaterial({ color: 0xfffbe6, transparent: true, opacity: 0.5, blending: T.AdditiveBlending, depthWrite: false });
      for (let i = 1; i <= 3; i++) { const d = new T.Mesh(new T.SphereGeometry(1, 12, 8), dMat); g.add(d); diamonds.push(d); }
      const SL = [new T.Color(1, 0.98, 0.88), new T.Color(1, 0.72, 0.32), new T.Color(1, 0.42, 0.1)];
      const VAC = [new T.Color(1, 0.96, 0.9), new T.Color(1, 0.68, 0.48), new T.Color(0.45, 0.52, 1)];
      g.userData.set = (on, n, thr, alt, len, w0override) => {
        g.visible = on;
        if (!on) return;
        const vac = clamp(alt / 35000, 0, 1);
        const L = len * (0.55 + 0.45 * thr) * (1 + 1.6 * vac) * (0.92 + Math.random() * 0.16);
        const w0 = w0override || (n >= 9 ? 3.4 : n >= 3 ? 2.6 : 0.95);
        const w1 = w0 * (1.25 + 5 * vac);
        const u = outer.material.uniforms, c = core.material.uniforms;
        u.uL.value = L; u.uW0.value = w0; u.uW1.value = w1; u.uAlpha.value = 0.95;
        for (let i = 0; i < 3; i++) u[["uC0", "uC1", "uC2"][i]].value.copy(SL[i]).lerp(VAC[i], vac);
        c.uL.value = L * 0.42; c.uW0.value = w0 * 0.7; c.uW1.value = w0 * 0.75; c.uAlpha.value = 1;
        c.uC0.value.setRGB(1, 1, 1); c.uC1.value.setRGB(1, 0.95, 0.8); c.uC2.value.setRGB(1, 0.8, 0.5);
        diamonds.forEach((d, i) => {
          d.visible = vac < 0.25;
          d.position.y = -L * 0.11 * (i + 1);
          d.scale.set(w0 * 0.22, L * 0.025, w0 * 0.22);
          d.material.opacity = 0.5 * (1 - vac * 4);
        });
      };
      return g;
    }

    // --- first stage ---
    const booster = new T.Group();
    scene.add(booster);
    const bells = new T.Group(); booster.add(bells);
    const bellGeo = new T.CylinderGeometry(0.28, 0.5, 1.3, 18, 1, true);
    const bellPos = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2) * 1.25, Math.sin((i / 8) * Math.PI * 2) * 1.25])];
    for (const [bx, bz] of bellPos) { const b = new T.Mesh(bellGeo, vm.engine); b.position.set(bx, 0.65, bz); b.castShadow = true; bells.add(b); }
    cyl(R, R, 1.3, vm.octa, 1.95, booster);
    cyl(R, R, 32.1, vm.white, 2.6 + 16.05, booster);
    const sootMesh = cyl(R + 0.012, R + 0.012, 32.1, vm.soot, 2.6 + 16.05, booster);
    sootMesh.castShadow = false;
    cyl(R + 0.015, R + 0.015, 0.25, vm.band, 20.5, booster);
    cyl(R, R, VEHICLE.length - 34.7, vm.black, (34.7 + VEHICLE.length) / 2, booster);

    // grid fins at 0/90/180/270°, hinged at the interstage
    const fins = [];
    const finGeo = new T.BoxGeometry(1.3, 0.3, 1.6); finGeo.translate(0.65, 0, 0);
    for (let i = 0; i < 4; i++) {
      const az = new T.Group(); az.rotation.y = (i * Math.PI) / 2; az.position.y = 39.3; booster.add(az);
      const fold = new T.Group(); fold.position.x = R; az.add(fold);
      const fin = new T.Mesh(finGeo, vm.fin); fin.castShadow = true; fold.add(fin);
      fins.push({ fold, fin, side: i === 0 ? 1 : i === 2 ? -1 : 0 });
    }
    // landing legs at 45° offsets, hinged near the base
    const legs = [];
    const legGeo = new T.BoxGeometry(0.75, 9.8, 0.32); legGeo.translate(0.2, 4.9, 0);
    const footGeo = new T.CylinderGeometry(0.55, 0.65, 0.25, 16);
    const strutGeo = new T.CylinderGeometry(0.11, 0.11, 1, 8);
    const A_DEP = Math.atan2(6.2, -7.6);
    for (let i = 0; i < 4; i++) {
      const az = new T.Group(); az.rotation.y = Math.PI / 4 + (i * Math.PI) / 2; booster.add(az);
      const hinge = new T.Group(); hinge.position.set(R, 7, 0); az.add(hinge);
      const leg = new T.Mesh(legGeo, vm.leg); leg.castShadow = true; hinge.add(leg);
      const foot = new T.Mesh(footGeo, vm.leg); foot.position.set(0.2, 9.8, 0); hinge.add(foot);
      const strut = new T.Mesh(strutGeo, vm.strut); strut.castShadow = true; az.add(strut);
      legs.push({ hinge, strut, foot });
    }
    const upperAttached = new T.Group(); booster.add(upperAttached);
    upperStack(upperAttached, VEHICLE.length);

    const plume = makePlume(); booster.add(plume);
    const engineLight = new T.PointLight(0xffa860, 0, 400, 1.2); engineLight.position.y = -6; booster.add(engineLight);
    const heatGlow = new T.Sprite(new T.SpriteMaterial({ map: radialTex("rgba(255,190,120,1)", "rgba(255,90,30,0)"), blending: T.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0 }));
    heatGlow.position.y = 1; heatGlow.scale.set(20, 20, 1); booster.add(heatGlow);

    // --- second stage (after separation) ---
    const stage2 = new T.Group(); stage2.visible = false; scene.add(stage2);
    cyl(0.5, 1.6, 3, vm.engine, 1.5, stage2, 24, true);
    upperStack(stage2, 3);
    const plume2 = makePlume(); stage2.add(plume2);

    // ---------------------------------------------------------------------
    // Particles, trail, markers, vectors
    // ---------------------------------------------------------------------
    const MAXP = 2400;
    const pGeo = new T.BufferGeometry();
    const pPos = new Float32Array(MAXP * 3), pCol = new Float32Array(MAXP * 4), pSize = new Float32Array(MAXP);
    pGeo.setAttribute("position", new T.BufferAttribute(pPos, 3).setUsage(T.DynamicDrawUsage));
    pGeo.setAttribute("aColor", new T.BufferAttribute(pCol, 4).setUsage(T.DynamicDrawUsage));
    pGeo.setAttribute("aSize", new T.BufferAttribute(pSize, 1).setUsage(T.DynamicDrawUsage));
    const pMat = new T.ShaderMaterial({ uniforms: { uScale: { value: 1 } }, vertexShader: PART_VS, fragmentShader: PART_FS, transparent: true, depthWrite: false });
    const points = new T.Points(pGeo, pMat); points.frustumCulled = false; scene.add(points);

    const MAXT = 8000;
    const tGeo = new T.BufferGeometry();
    const tPos = new Float32Array(MAXT * 3), tCol = new Float32Array(MAXT * 3);
    tGeo.setAttribute("position", new T.BufferAttribute(tPos, 3).setUsage(T.DynamicDrawUsage));
    tGeo.setAttribute("color", new T.BufferAttribute(tCol, 3).setUsage(T.DynamicDrawUsage));
    const trail = new T.Line(tGeo, new T.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.75 }));
    trail.frustumCulled = false; scene.add(trail);
    let trailLen = -1;
    const phaseCol = {};
    for (const k in PHASE_COLORS) phaseCol[k] = new T.Color(PHASE_COLORS[k]);

    const dropGeo = new T.BufferGeometry().setFromPoints([new T.Vector3(), new T.Vector3()]);
    const drop = new T.Line(dropGeo, new T.LineDashedMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, dashSize: 10, gapSize: 10 }));
    drop.frustumCulled = false; scene.add(drop);
    const dropRing = new T.Mesh(new T.RingGeometry(0.75, 1, 40), new T.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false }));
    dropRing.rotation.x = -Math.PI / 2; scene.add(dropRing);

    const impact = new T.Group();
    const redMat = new T.MeshBasicMaterial({ color: 0xff5d5d, transparent: true, opacity: 0.9, depthWrite: false, side: T.DoubleSide });
    const ring = new T.Mesh(new T.RingGeometry(0.8, 1, 48), redMat); ring.rotation.x = -Math.PI / 2; impact.add(ring);
    for (const a of [Math.PI / 4, -Math.PI / 4]) {
      const bar = new T.Mesh(new T.PlaneGeometry(1.3, 0.12), redMat); bar.rotation.x = -Math.PI / 2; bar.rotation.z = a; impact.add(bar);
    }
    impact.position.y = 0.3; scene.add(impact);

    const shaftGeo = new T.CylinderGeometry(1, 1, 1, 8); shaftGeo.translate(0, 0.5, 0);
    const headGeo = new T.ConeGeometry(1, 1, 12); headGeo.translate(0, 0.5, 0);
    function makeArrow(color) {
      const mat = new T.MeshBasicMaterial({ color, depthTest: false, transparent: true });
      const g = new T.Group(), shaft = new T.Mesh(shaftGeo, mat), head = new T.Mesh(headGeo, mat);
      shaft.renderOrder = head.renderOrder = 20;
      g.add(shaft, head); scene.add(g);
      return { g, shaft, head };
    }
    const arrows = { thrust: makeArrow(0xffb454), drag: makeArrow(0x5fe0ff), gravity: makeArrow(0xc58bff), v: makeArrow(0x7dffa8) };

    const flash = new T.PointLight(0xff8a3c, 0, 900, 1.3); scene.add(flash);

    // ---------------------------------------------------------------------
    // HTML labels projected from 3D
    // ---------------------------------------------------------------------
    const labelRoot = document.getElementById("labels");
    const labels = new Map();
    const _v = new T.Vector3();
    function tag(key, pos, text, cls = "", color = "") {
      let el = labels.get(key);
      if (!el) {
        el = document.createElement("div"); el.className = "tag " + cls;
        el.appendChild(document.createElement("span"));
        labelRoot.appendChild(el); labels.set(key, el);
      }
      el._used = true;
      _v.copy(pos).applyMatrix4(camera.matrixWorldInverse);
      if (_v.z > -0.5) { el.style.display = "none"; return; }
      _v.applyMatrix4(camera.projectionMatrix);
      const x = (_v.x * 0.5 + 0.5) * W, y = (-_v.y * 0.5 + 0.5) * H;
      if (x < -300 || x > W + 300 || y < -60 || y > H + 60) { el.style.display = "none"; return; }
      if (el._text !== text) { el.firstChild.textContent = text; el._text = text; }
      el.style.display = "";
      el.style.color = color;
      el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
    }

    // ---------------------------------------------------------------------
    // Camera control: drag to orbit, wheel/pinch to zoom, double-click reset
    // ---------------------------------------------------------------------
    const ctl = { mode: "close", yaw: 0.45, pitch: 0.08, dist: VIEWS.close.dist, tYaw: 0.45, tPitch: 0.08, tDist: VIEWS.close.dist, zoom: 1, tZoom: 1 };
    const target = new T.Vector3(0, 35, 0);
    let halfStack = 35, k = 1, interacted = false;
    const pointers = new Map();
    let pinchStart = 0, pinchDist = 0;
    function markInteracted() {
      if (!interacted) { interacted = true; document.body.classList.add("cam-used"); }
    }
    function zoomBy(f) {
      if (ctl.mode === "ground") ctl.tZoom = clamp(ctl.tZoom * f, 0.15, 6);
      else ctl.tDist = clamp(ctl.tDist * f, 14, 4e5);
    }
    canvas.addEventListener("pointerdown", (e) => {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture(e.pointerId);
      canvas.classList.add("dragging");
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = Math.hypot(a.x - b.x, a.y - b.y); pinchDist = ctl.mode === "ground" ? ctl.tZoom : ctl.tDist;
      }
      markInteracted();
    });
    canvas.addEventListener("pointermove", (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size === 1) {
        ctl.tYaw -= dx * 0.006;
        ctl.tPitch = clamp(ctl.tPitch + dy * 0.005, -0.45, 1.5);
      } else if (pointers.size === 2 && pinchStart > 0) {
        const [a, b] = [...pointers.values()];
        const f = pinchStart / Math.max(Math.hypot(a.x - b.x, a.y - b.y), 1);
        if (ctl.mode === "ground") ctl.tZoom = clamp(pinchDist * f, 0.15, 6);
        else ctl.tDist = clamp(pinchDist * f, 14, 4e5);
      }
    });
    const endPointer = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = 0;
      if (!pointers.size) canvas.classList.remove("dragging");
    };
    canvas.addEventListener("pointerup", endPointer);
    canvas.addEventListener("pointercancel", endPointer);
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      zoomBy(Math.exp(e.deltaY * (e.ctrlKey ? 0.01 : 0.0012)));
      markInteracted();
    }, { passive: false });
    canvas.addEventListener("dblclick", () => resetView());
    window.addEventListener("keydown", (e) => {
      if (e.target.tagName === "INPUT" || e.metaKey || e.ctrlKey) return;
      const step = e.shiftKey ? 0.3 : 0.12;
      if (e.key === "ArrowLeft") ctl.tYaw += step;
      else if (e.key === "ArrowRight") ctl.tYaw -= step;
      else if (e.key === "ArrowUp") ctl.tPitch = clamp(ctl.tPitch + step * 0.7, -0.45, 1.5);
      else if (e.key === "ArrowDown") ctl.tPitch = clamp(ctl.tPitch - step * 0.7, -0.45, 1.5);
      else if (e.key === "+" || e.key === "=") zoomBy(0.8);
      else if (e.key === "-" || e.key === "_") zoomBy(1.25);
      else if (e.key === "c" || e.key === "C") resetView();
      else return;
      e.preventDefault(); markInteracted();
    });

    function resetView() {
      const v = VIEWS[ctl.mode];
      ctl.tYaw = ctl.mode === "ground" ? 0.35 : 0.45;
      ctl.tPitch = v.pitch; ctl.tDist = v.dist || ctl.tDist; ctl.tZoom = 1;
    }
    function setMode(mode) {
      ctl.mode = mode;
      resetView();
      if (mode === "ground") { ctl.yaw = ctl.tYaw; ctl.zoom = 1; }
    }

    const PAD_PHASES = new Set(["prelaunch", "ascent", "meco", "separation", "flip"]);
    const _site = new T.Vector3(), _cam = new T.Vector3();
    function updateCamera(dt, sim) {
      const f = 1 - Math.exp(-dt * 9), fz = 1 - Math.exp(-dt * 5);
      ctl.yaw = lerp(ctl.yaw, ctl.tYaw, f);
      ctl.pitch = lerp(ctl.pitch, ctl.tPitch, f);
      ctl.dist = Math.exp(lerp(Math.log(ctl.dist), Math.log(ctl.tDist), fz));
      ctl.zoom = lerp(ctl.zoom, ctl.tZoom, fz);

      const stack = VEHICLE.length + (sim.attached ? VEHICLE.upperLength : 0);
      halfStack = lerp(halfStack, stack / 2, f);
      // centre of the vehicle (scaled by the visual enlargement)
      const hs = halfStack * k;
      target.set(sim.x + Math.sin(sim.att) * hs, sim.y + Math.cos(sim.att) * hs, 0);

      if (ctl.mode === "ground") {
        // tracking camera at a site near the pad (ascent) or landing zone (descent)
        const atPad = PAD_PHASES.has(sim.phase);
        const r = atPad ? 950 : 650;
        _site.set(atPad ? MISSION.padX : MISSION.lzX, 0, 0);
        camera.position.set(_site.x + Math.sin(ctl.yaw) * r, 1.8 + Math.max(0, ctl.pitch) * 60, Math.cos(ctl.yaw) * r);
        camera.lookAt(target);
        const d = camera.position.distanceTo(target);
        const fov = (2 * Math.atan((stack / 0.32) / 2 / d) * 180) / Math.PI / ctl.zoom;
        camera.fov = clamp(fov, 0.25, 60);
      } else {
        camera.fov = 50;
        const cp = Math.cos(ctl.pitch);
        _cam.set(Math.sin(ctl.yaw) * cp, Math.sin(ctl.pitch), Math.cos(ctl.yaw) * cp).multiplyScalar(ctl.dist).add(target);
        if (_cam.y < 2) _cam.y = 2;
        camera.position.copy(_cam);
        camera.lookAt(target);
      }
      camera.updateProjectionMatrix();
      camera.updateMatrixWorld();

      // enlarge the booster when it would be too small to see
      const d = Math.max(camera.position.distanceTo(target), 1);
      const px = (VEHICLE.length * H) / (2 * d * Math.tan((camera.fov * Math.PI) / 360));
      k = Math.max(1, MIN_ROCKET_PX / px);
    }

    // ---------------------------------------------------------------------
    // Per-frame update
    // ---------------------------------------------------------------------
    const _a = new T.Vector3(), _b = new T.Vector3(), _c = new T.Color(), _c2 = new T.Color();
    function localToWorld(lx, ly, lz, out) { return out.set(lx, ly, lz).applyMatrix4(booster.matrixWorld); }

    function updateBooster(st) {
      const s = st.sim;
      booster.visible = s.phase !== "crashed";
      const legE = easeInOut(s.legs);
      booster.position.set(s.x, s.y + 0.6 * legE * k, 0);
      booster.rotation.set(0, 0, -s.att);
      booster.scale.setScalar(k);
      upperAttached.visible = s.attached;
      vm.soot.opacity = st.soot;

      const fe = easeInOut(s.gridFins);
      for (const f of fins) {
        f.fold.rotation.z = (Math.PI / 2) * (1 - fe);
        f.fin.rotation.x = 0.35 * s.finDeflect * s.gridFins * (f.side || 1);
      }
      const a = A_DEP * legE;
      for (const L of legs) {
        L.hinge.rotation.z = -a;
        L.strut.visible = s.legs > 0.02;
        if (L.strut.visible) {
          _a.set(R, 2.5, 0);
          _b.set(R + 0.2 + 0.55 * 9.8 * Math.sin(a), 7 + 0.55 * 9.8 * Math.cos(a), 0);
          L.strut.position.copy(_a).add(_b).multiplyScalar(0.5);
          const len = _a.distanceTo(_b);
          L.strut.scale.set(1, len, 1);
          L.strut.rotation.set(0, 0, Math.atan2(-(_b.x - _a.x), _b.y - _a.y));
        }
      }

      const on = s.thrust > 0 && booster.visible;
      plume.rotation.z = -(s.gimbal || 0);
      plume.userData.set(on, s.engines, s.throttle, s.y, s.engines >= 9 ? 34 : s.engines >= 3 ? 26 : 18);
      engineLight.intensity = on ? 2.2 * s.throttle * Math.sqrt(s.engines / 9) * (0.9 + Math.random() * 0.2) : 0;
      engineLight.distance = 450 * k;
      heatGlow.material.opacity = 0.85 * s.heat;
      heatGlow.visible = s.heat > 0.02;
      booster.updateMatrixWorld(true);

      const s2 = s.stage2;
      stage2.visible = !!s2;
      if (s2) {
        stage2.position.set(s2.x, s2.y, 0);
        stage2.rotation.set(0, 0, -s2.att);
        stage2.scale.setScalar(k);
        plume2.userData.set(s2.firing, 1, 1, 80000, 30, 2.6);
      }
    }

    function updateParticles(st) {
      const ps = st.particles, n = Math.min(ps.length, MAXP), off = ps.length - n;
      for (let i = 0; i < n; i++) {
        const p = ps[off + i], f = p.life / p.max;
        pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z || 0;
        pSize[i] = Math.max(p.size, 0.2) * 2;
        let r, g, b, a;
        if (p.type === "fire") {
          if (f < 0.35) { r = 1; g = 0.86 * (1 - f); b = 0.31 * (1 - f); a = 0.85 * (1 - f); }
          else { r = 0.24; g = 0.22; b = 0.2; a = 0.6 * (1 - f); }
        } else if (p.type === "gas") { r = 0.92; g = 0.96; b = 1; a = 0.6 * (1 - f); }
        else if (p.type === "dust") { r = 0.75; g = 0.67; b = 0.55; a = 0.45 * (1 - f); }
        else if (p.type === "steam") { r = g = b = 0.96; a = 0.55 * (1 - f); }
        else {
          const fresh = clamp(1 - p.life * 2.5, 0, 1);
          if (fresh > 0) { r = 1; g = (190 + 50 * (1 - fresh)) / 255; b = (120 + 110 * (1 - fresh)) / 255; a = 0.4 * (1 - f); }
          else { r = g = b = 0.88; a = 0.35 * (1 - f); }
        }
        pCol[i * 4] = r; pCol[i * 4 + 1] = g; pCol[i * 4 + 2] = b; pCol[i * 4 + 3] = a;
      }
      pGeo.setDrawRange(0, n);
      for (const k2 of ["position", "aColor", "aSize"]) pGeo.attributes[k2].needsUpdate = true;
      pMat.uniforms.uScale.value = (H * DPR) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    }

    function updateTrail(st) {
      const h = st.history, s = st.sim;
      const n = Math.min(h.length, MAXT - 1);
      if (n !== trailLen) {
        for (let i = 0; i < n; i++) {
          const p = h[h.length - n + i], c = phaseCol[p.phase] || phaseCol.coast;
          tPos[i * 3] = p.x; tPos[i * 3 + 1] = p.y; tPos[i * 3 + 2] = 0;
          tCol[i * 3] = c.r; tCol[i * 3 + 1] = c.g; tCol[i * 3 + 2] = c.b;
        }
        trailLen = n;
        tGeo.attributes.color.needsUpdate = true;
      }
      const c = phaseCol[s.phase] || phaseCol.coast;
      tPos[n * 3] = s.x; tPos[n * 3 + 1] = s.y; tPos[n * 3 + 2] = 0;
      tCol[n * 3] = c.r; tCol[n * 3 + 1] = c.g; tCol[n * 3 + 2] = c.b;
      tGeo.attributes.position.needsUpdate = true; tGeo.attributes.color.needsUpdate = true;
      tGeo.setDrawRange(0, n + 1);
      trail.visible = n > 0;
    }

    const mpp = (p) => { // metres per screen pixel at a world point
      _v.copy(p).applyMatrix4(camera.matrixWorldInverse);
      return (2 * Math.max(-_v.z, 1) * Math.tan((camera.fov * Math.PI) / 360)) / H;
    };

    function setArrow(ar, origin, dx, dy, lenPx, m) {
      if (lenPx < 4) { ar.g.visible = false; return; }
      ar.g.visible = true;
      ar.g.position.copy(origin);
      _d.set(dx, dy, 0).normalize();
      ar.g.quaternion.setFromUnitVectors(_up, _d);
      const len = lenPx * m, head = Math.min(11 * m, len * 0.5), w = 1.3 * m;
      ar.shaft.scale.set(w, len - head, w);
      ar.head.position.y = len - head;
      ar.head.scale.set(4.5 * m, head, 4.5 * m);
    }

    function updateOverlays(st) {
      const s = st.sim, since = s.t - s.phaseStart;
      for (const el of labels.values()) el._used = false;

      // altitude drop line + ground ring under the booster
      const showDrop = s.y > 60 && !s.done;
      drop.visible = dropRing.visible = showDrop;
      if (showDrop) {
        const pos = dropGeo.attributes.position;
        pos.setXYZ(0, s.x, s.y, 0); pos.setXYZ(1, s.x, 0.2, 0); pos.needsUpdate = true;
        drop.computeLineDistances();
        const m = mpp(_a.set(s.x, 0, 0));
        drop.material.dashSize = drop.material.gapSize = 5 * mpp(_b.set(s.x, s.y / 2, 0));
        dropRing.position.set(s.x, 0.25, 0); dropRing.scale.setScalar(Math.max(6 * m, 3));
      }
      // predicted impact point
      impact.visible = s.predictedImpact != null && !s.attached && !s.done;
      if (impact.visible) {
        impact.position.x = s.predictedImpact;
        impact.scale.setScalar(Math.max(9 * mpp(impact.position), 6));
        tag("impact", _a.set(s.predictedImpact, 0, 0), "predicted impact", "small", "#ff8b8b");
      }

      // force vectors
      const showV = st.showVectors && s.phase !== "prelaunch" && !s.done;
      for (const ar of Object.values(arrows)) ar.g.visible = false;
      if (showV) {
        const o = localToWorld(0, VEHICLE.length * 0.45, 0, new T.Vector3());
        const m = mpp(o), mass = s.mass;
        const list = [];
        if (s.thrust > 0) { const a = s.thrust / mass, d = s.att + (s.gimbal || 0); list.push(["thrust", Math.sin(d) * a, Math.cos(d) * a]); }
        const wind = windAt(s.y, s.opts.wind), rvx = s.vx - wind, rvy = s.vy, rv = Math.hypot(rvx, rvy);
        if (rv > 1 && s.q > 50) { const a = (s.q * s.cdA()) / mass; list.push(["drag", (-rvx / rv) * a, (-rvy / rv) * a]); }
        list.push(["gravity", 0, -9.81]);
        for (const [key, dx, dy] of list) {
          const px = Math.min(Math.hypot(dx, dy) * 7, 170);
          setArrow(arrows[key], o, dx, dy, px, m);
          if (px >= 4) tag("v-" + key, _b.set(dx, dy, 0).normalize().multiplyScalar((px + 14) * m).add(o), key, "small vec", "#" + arrows[key].shaft.material.color.getHexString());
        }
        if (s.speed > 1) {
          setArrow(arrows.v, o, s.vx, s.vy, 90, m);
          tag("v-vel", _b.set(s.vx, s.vy, 0).normalize().multiplyScalar(104 * m).add(o), `v ${Math.round(s.speed)} m/s`, "small vec", "#7dffa8");
        }
      }

      // callouts on the vehicle
      if (s.phase === "flip" && s.coldGas) tag("c-gas", localToWorld(s.coldGas > 0 ? -2 : 2, 40.5, 0, _a), "Cold-gas thrusters", "callout");
      if (s.phase === "coast" && since < 25) tag("c-fins", localToWorld(R + 1, 39.3, 0, _a), "Grid fins deploy", "callout");
      if (s.phase === "landing" && s.legsCmd && s.legs < 1) tag("c-legs", localToWorld(5, 3, 0, _a), "Landing legs", "callout");
      if (s.phase === "separation" && s.stage2) tag("c-s2", _a.set(s.stage2.x, s.stage2.y + 30 * k, 0), "SECOND STAGE →", "callout");
      // sites
      tag("pad", _a.set(MISSION.padX - 17, 98, 0), "LAUNCH PAD", "site", "#c9d4e5");
      tag("lz", _a.set(MISSION.lzX, 40, 0), "LANDING ZONE", "site", "#ffe08a");

      for (const el of labels.values()) if (!el._used) el.style.display = "none";
      document.body.classList.toggle("enlarged", k > 1.05);
    }

    function updateEnvironment(st) {
      const alt = Math.max(camera.position.y, 0);
      skyAt(alt * 0.5, skyU.uHorizon.value);
      skyAt(alt + 15000, skyU.uZenith.value);
      skyU.uLimb.value = clamp((alt - 20000) / 50000, 0, 1) * 0.8;
      skyAt(alt * 0.5, _c);
      scene.fog.color.copy(_c);
      scene.fog.density = 1 / (28000 + alt * 6);
      sky.position.copy(camera.position);
      stars.position.copy(camera.position);
      starMat.opacity = clamp((alt - 18000) / 30000, 0, 1);
      hemi.intensity = lerp(0.65, 0.35, clamp(alt / 60000, 0, 1));

      // sun + shadow volume centred on the booster
      const s = st.sim;
      sun.target.position.set(s.x, s.y, 0);
      sun.position.copy(SUN_DIR).multiplyScalar(1500).add(sun.target.position);
      const S = 75 * k, sc = sun.shadow.camera;
      sun.castShadow = s.y < 2500;
      if (sc.right !== S) { sc.left = -S; sc.right = S; sc.top = S; sc.bottom = -S; }
      sc.near = 10; sc.far = 1600 + s.y / SUN_DIR.y + 300;
      sc.updateProjectionMatrix();

      // explosion flash
      if (s.phase === "crashed") {
        flash.position.set(s.x, 15, 0);
        flash.intensity = 7 * Math.exp(-st.doneTimer * 1.6);
      } else flash.intensity = 0;
      void _c2;
    }

    // ---------------------------------------------------------------------
    return {
      setMode, resetView,
      get mode() { return ctl.mode; },
      exaggeration: () => k,
      resize(w, h, dpr) {
        W = w; H = h; DPR = dpr;
        renderer.setPixelRatio(dpr);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
      },
      update(dt, st) {
        updateCamera(dt, st.sim);
        updateBooster(st);
        updateParticles(st);
        updateTrail(st);
        updateEnvironment(st);
        updateOverlays(st);
      },
      render() { renderer.render(scene, camera); },
    };
  }

  window.BoosterView3D = { create };
})();
