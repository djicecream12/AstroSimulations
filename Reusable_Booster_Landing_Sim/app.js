/* =====================================================================
   Reusable Booster Landing Simulator — rendering, UI and controls
   Physics/guidance live in physics.js (window.BoosterSim).
   ===================================================================== */
(() => {
  "use strict";
  const { Simulation, VEHICLE, MISSION, PHASES, density, DEG } = window.BoosterSim;
  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  // -------------------------------------------------------------------
  // Educational copy for every phase
  // -------------------------------------------------------------------
  const STEPS = ["ascent", "meco", "separation", "flip", "boostback", "coast", "entry", "aero", "landing", "landed"];
  const EXPLAIN = {
    prelaunch: {
      title: "Countdown",
      text: "The first stage holds roughly 400 tonnes of super-chilled liquid oxygen and RP-1 kerosene. At T-3 s its nine engines ignite, and hold-down clamps keep the rocket on the pad until the flight computer confirms every engine is healthy.",
      fact: "Reusing the first stage (about 60% of the rocket's cost) is the key to cheaper launches.",
    },
    ascent: {
      title: "Liftoff & ascent",
      text: "The rocket climbs straight up to clear the tower, then pitches over gradually in a \"gravity turn\": gravity bends the path toward horizontal, so the vehicle never has to fly sideways through the air. Near Max-Q (maximum aerodynamic pressure) the engines throttle down to ease the load on the structure.",
      fact: "Thrust-to-weight at liftoff is only about 1.4, so the first seconds look slow. The rocket speeds up as it burns propellant and gets lighter.",
    },
    meco: {
      title: "Main engine cutoff (MECO)",
      text: (s) => `An expendable rocket would burn almost to empty. This one shuts down early and keeps ${Math.round(s.opts.reserve / 1000)} t of propellant (${Math.round(100 * s.opts.reserve / VEHICLE.stage1Prop)}% of the load) for the trip home. That reserve is the price of reusability: it costs payload capacity.`,
      fact: "Try the \"Landing reserve\" slider: keep too little and the booster can't finish the landing burn.",
    },
    separation: {
      title: "Stage separation",
      text: "Pneumatic pushers shove the stages apart. A few seconds later the second stage lights its single vacuum-optimized engine and carries on to orbit. The booster is now a mostly empty tank still coasting upward at more than 1.7 km/s.",
      fact: "The second stage engine has a much larger nozzle because exhaust can expand further in a vacuum.",
    },
    flip: {
      title: "Flip maneuver",
      text: "Up here there is almost no air, so fins can't steer. Nitrogen cold-gas thrusters near the top of the booster rotate it about 130° until the engines point back toward the launch site.",
      fact: "Cold-gas thrusters simply vent compressed nitrogen. They have no combustion, are very reliable, and give gentle control.",
    },
    boostback: {
      title: "Boostback burn",
      text: "Three engines fire to cancel the booster's huge downrange speed and send it back toward the coast. The flight computer predicts the impact point many times per second and shuts down the burn once that point sits on the landing zone.",
      fact: "Watch the red ✕ on the trajectory map: that's the predicted impact point sliding back toward the LZ.",
    },
    coast: {
      title: "Coast & grid fins",
      text: "The booster arcs up past 100 km and falls back. Four titanium grid fins unfold near the top; they'll steer once the air is thick enough. Meanwhile the cold-gas thrusters turn the booster engines-first.",
      fact: "Grid fins look like waffles. Their lattice keeps them effective at both supersonic and subsonic speeds.",
    },
    entry: {
      title: "Entry burn",
      text: "Falling at around 1.5 km/s, the booster would overheat and could break up. Relighting three engines slows it down and pushes the hot, high-pressure shock layer away from the vehicle with a cushion of exhaust.",
      fact: "Glowing orange means reentry heating. It scales roughly with air density × speed³.",
    },
    aero: {
      title: "Aerodynamic guidance",
      text: "With the engines off, the booster is now a guided falling tube. Grid fins tilt to produce lift and steer it over the landing zone, while drag bleeds its speed down toward terminal velocity.",
      fact: "Near the coast people hear a sonic boom as the booster comes back subsonic.",
    },
    landing: {
      title: "Landing burn: the \"hoverslam\"",
      text: "Even at its minimum throttle (~40%), one engine pushes harder than the near-empty booster weighs, so it can't hover. The computer therefore lights the engine at exactly the right moment, so speed reaches zero exactly at ground level. The legs deploy seconds before touchdown.",
      fact: "Each step, the flight computer simulates the rest of the burn (drag included) to pick the throttle that stops at 0 m.",
    },
    landed: {
      title: "Touchdown",
      text: "The booster is back on the ground just minutes after launch. After inspection and refurbishment it can fly again. Some Falcon 9 boosters have flown more than 25 times.",
      fact: "Press Restart, change the wind or reserve, and see how the flight computer adapts.",
    },
    crashed: {
      title: "Booster lost",
      text: "This landing failed. Landing a rocket leaves almost no margin: a few tonnes of propellant, or a few seconds of timing, decide the outcome.",
      fact: "Try increasing the landing reserve or reducing the wind, then fly again.",
    },
  };

  const PHASE_COLORS = {
    prelaunch: "#ffffff", ascent: "#ffb454", meco: "#ffb454", separation: "#c9d4e5", flip: "#c9d4e5",
    boostback: "#ff7a45", coast: "#7cc4ff", entry: "#ff5d5d", aero: "#7cc4ff", landing: "#ff5d5d",
    landed: "#3ddc97", crashed: "#ff5d5d",
  };

  // -------------------------------------------------------------------
  // Canvas setup: 3D main view + 2D map/chart
  // -------------------------------------------------------------------
  const cv = $("view");
  const mapCv = $("map"), mctx = mapCv.getContext("2d");
  const chCv = $("chart"), cctx = chCv.getContext("2d");
  const COAST_X = 2600;
  let view;
  try {
    if (!window.THREE) throw new Error("three.js not loaded");
    view = window.BoosterView3D.create(cv, { VEHICLE, MISSION, windAt: window.BoosterSim.windAt, PHASE_COLORS, COAST_X });
  } catch (err) {
    console.error(err);
    $("no3d").hidden = false;
    view = { exaggeration: () => 1, resize() {}, update() {}, render() {}, setMode() {}, resetView() {}, mode: "close" };
  }
  let W = 0, H = 0, DPR = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    view.resize(W, H, DPR);
    for (const c of [mapCv, chCv]) {
      const w = +(c.dataset.w || c.getAttribute("width")), h = +(c.dataset.h || c.getAttribute("height"));
      c.dataset.w = w; c.dataset.h = h;
      c.width = w * DPR; c.height = h * DPR; c.style.height = h + "px";
    }
  }
  resize();
  window.addEventListener("resize", resize);

  // -------------------------------------------------------------------
  // State
  // -------------------------------------------------------------------
  let sim, particles, history, s2history, phaseTimes, logCount, histTimer, soot, doneTimer, resultShown;
  let running = true, warpMode = "auto", warpNow = 1, showVectors = true;

  function newSim() {
    sim = new Simulation({ wind: +$("wind").value, reserve: +$("reserve").value * 1000 });
    particles = []; history = []; s2history = [];
    phaseTimes = {}; logCount = 0; histTimer = 0; soot = 0; doneTimer = 0; resultShown = false;
    $("log").innerHTML = "";
    $("reserveOut").textContent = `${$("reserve").value} t`;
    $("result").classList.add("hidden");
    buildTimeline();
    updateExplain(true);
  }

  // -------------------------------------------------------------------
  // Time warp
  // -------------------------------------------------------------------
  function autoWarp() {
    const s = sim;
    switch (s.phase) {
      case "prelaunch": return 1.5;
      case "ascent": return s.t < 15 ? 1 : s.t < 50 ? 3 : 5;
      case "meco": case "separation": return 1;
      case "flip": return 3;
      case "boostback": return 3;
      case "coast": return s.vy > 0 || s.y > MISSION.entryStartAlt + 20000 ? 16 : 4;
      case "entry": return 2;
      case "aero": return s.y > 12000 ? 6 : s.y > 4000 ? 3 : 1;
      default: return 1;
    }
  }

  // -------------------------------------------------------------------
  // Geometry helpers
  // -------------------------------------------------------------------
  /** Booster-local point (lx right, ly up, metres) → world coordinates (flight plane). */
  function localToWorld(lx, ly, x = sim.x, y = sim.y, att = sim.att, k = 1) {
    lx *= k; ly *= k;
    return [x + lx * Math.cos(att) + ly * Math.sin(att), y - lx * Math.sin(att) + ly * Math.cos(att)];
  }
  /** Visual enlargement when the camera is far away, so the rocket stays visible. */
  const exaggeration = () => view.exaggeration();

  // -------------------------------------------------------------------
  // Simulation stepping + particles
  // -------------------------------------------------------------------
  function advance(realDt) {
    const target = warpMode === "auto" ? autoWarp() : +warpMode;
    warpNow = lerp(warpNow, target, 1 - Math.exp(-realDt * 2.5));
    if (Math.abs(warpNow - target) < 0.05) warpNow = target;
    const simDt = sim.done ? realDt : realDt * warpNow;
    if (!sim.done) {
      const n = Math.max(1, Math.ceil(simDt / 0.02));
      for (let i = 0; i < n && !sim.done; i++) {
        const prev = sim.phase;
        sim.step(simDt / n);
        if (sim.phase !== prev) phaseTimes[sim.phase] = sim.t;
      }
      histTimer -= simDt;
      if (histTimer <= 0) {
        histTimer = 0.5;
        history.push({ t: sim.t, x: sim.x, y: sim.y, v: sim.speed, phase: sim.phase, thr: sim.thrust > 0 ? sim.throttle * sim.engines / 9 : 0 });
        if (sim.stage2) s2history.push({ x: sim.stage2.x, y: sim.stage2.y });
      }
      if ((sim.phase === "entry" || sim.phase === "landing") && sim.thrust > 0) soot = Math.min(0.85, soot + simDt * 0.035);
      soot = Math.min(0.85, soot + sim.heat * simDt * 0.05);
    } else {
      if (doneTimer === 0 && sim.phase === "crashed") explode();
      doneTimer += realDt;
    }
    emitParticles(simDt);
    updateParticles(simDt);
  }

  function emitParticles(dt) {
    if (dt <= 0) return;
    const s = sim;
    const k = exaggeration();
    const rho = density(s.y);
    // exhaust smoke trail (only where there is air to hold it)
    if (s.thrust > 0 && rho > 0.004) {
      const dir = s.att + (s.gimbal || 0);
      const n = Math.min(Math.round(s.engines * s.throttle * 18 * dt + Math.random()), 24);
      for (let i = 0; i < n; i++) {
        const [px, py] = localToWorld((Math.random() - 0.5) * 3, -(10 + Math.random() * 12), s.x, s.y, s.att, k);
        particles.push({
          x: px, y: py, z: (Math.random() - 0.5) * 3 * k,
          vx: -Math.sin(dir) * 25 + (Math.random() - 0.5) * 12, vy: -Math.cos(dir) * 25 + (Math.random() - 0.5) * 12, vz: (Math.random() - 0.5) * 12,
          life: 0, max: 3 + Math.random() * 5 * Math.min(rho * 2, 1), size: 2.5 * k, grow: (2 + Math.random() * 4) * k, type: "smoke",
        });
      }
    }
    // ground blast: launch smoke from the flame trench / dust at the landing zone
    if (s.thrust > 0 && s.y < 90) {
      const n = Math.min(Math.round(dt * (s.engines === 9 ? 90 : 35) * (1 - s.y / 90) + Math.random()), 20);
      for (let i = 0; i < n; i++) {
        // billow outward in every direction across the ground
        const a = Math.random() * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const r0 = 4 + Math.random() * 6, v = 25 + Math.random() * 45;
        particles.push({
          x: s.x + ca * r0, y: 1 + Math.random() * 3, z: sa * r0,
          vx: ca * v, vy: 2 + Math.random() * 8, vz: sa * v, life: 0, max: 4 + Math.random() * 5,
          size: 4, grow: 5 + Math.random() * 5, type: s.phase === "landing" ? "dust" : "steam",
        });
      }
    }
    // cold-gas puffs during the flip/coast
    if (s.coldGas && Math.random() < 0.7) {
      const side = s.coldGas > 0 ? -1 : 1;
      const [px, py] = localToWorld(side * 2.1, 40.5, s.x, s.y, s.att, k);
      const [ox, oy] = localToWorld(side * 1, 40.5, s.x, s.y, s.att, k);
      particles.push({ x: px, y: py, vx: (px - ox) * 18 + s.vx, vy: (py - oy) * 18 + s.vy, life: 0, max: 0.8, size: 0.6 * k, grow: 5 * k, type: "gas", rel: true });
    }
    if (particles.length > 1600) particles.splice(0, particles.length - 1600);
  }

  function explode() {
    const k = exaggeration();
    for (let i = 0; i < 260; i++) {
      const a = Math.random() * Math.PI, b = Math.random() * Math.PI * 2, v = 10 + Math.random() * 60;
      particles.push({
        x: sim.x + (Math.random() - 0.5) * 6 * k, y: Math.random() * 20 * k, z: (Math.random() - 0.5) * 6 * k,
        vx: Math.cos(a) * Math.cos(b) * v, vy: Math.sin(a) * v * 0.8, vz: Math.cos(a) * Math.sin(b) * v, life: 0, max: 2 + Math.random() * 6,
        size: (1.5 + Math.random() * 3) * k, grow: (3 + Math.random() * 6) * k, type: i < 120 ? "fire" : "steam",
      });
    }
  }

  function updateParticles(dt) {
    for (const p of particles) {
      p.life += dt;
      const drag = p.type === "gas" ? 0 : Math.exp(-dt * 0.8);
      if (p.type !== "gas") { p.vx *= drag; p.vy *= drag; if (p.vz) p.vz *= drag; }
      if (p.type === "steam" || p.type === "dust") p.vy += 0.6 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.vz) p.z += p.vz * dt;
      p.size += p.grow * dt;
    }
    particles = particles.filter((p) => p.life < p.max);
  }

  // -------------------------------------------------------------------
  // Rendering (the 3D scene lives in scene3d.js)
  // -------------------------------------------------------------------
  function niceStep(pxPerUnit, minPx) {
    const steps = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
    for (const s of steps) if (s * pxPerUnit >= minPx) return s;
    return 100000;
  }
  const viewState = () => ({ sim, particles, history, soot, showVectors, doneTimer });
  function render(realDt = 0) {
    view.update(realDt, viewState());
    view.render();
  }

  // -------------------------------------------------------------------
  // Mission map + chart
  // -------------------------------------------------------------------
  function drawMap() {
    const w = +mapCv.dataset.w, h = +mapCv.dataset.h, c = mctx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, w, h);
    let xmin = -15000, xmax = 30000, ymax = 20000;
    for (const p of history) { if (p.x > xmax - 8000) xmax = p.x + 8000; if (p.y > ymax / 1.12) ymax = p.y * 1.12; }
    const pl = 34, pr = 10, pt = 10, pb = 22;
    const X = (x) => pl + ((x - xmin) / (xmax - xmin)) * (w - pl - pr);
    const Y = (y) => h - pb - (y / ymax) * (h - pt - pb);
    // ground: land + ocean
    c.fillStyle = "rgba(91,122,69,0.6)"; c.fillRect(X(xmin), Y(0), X(COAST_X) - X(xmin), 3);
    c.fillStyle = "rgba(63,127,178,0.8)"; c.fillRect(X(COAST_X), Y(0), X(xmax) - X(COAST_X), 3);
    // axes labels
    c.font = "9px ui-monospace, Menlo, monospace"; c.fillStyle = "rgba(255,255,255,0.45)";
    const yStep = niceStep((h - pt - pb) / ymax, 34);
    for (let a = yStep; a < ymax; a += yStep) { c.fillText(`${a / 1000}`, 2, Y(a) + 3); c.fillStyle = "rgba(255,255,255,0.06)"; c.fillRect(pl, Y(a), w - pl - pr, 1); c.fillStyle = "rgba(255,255,255,0.45)"; }
    c.fillText("km", 2, pt + 2);
    const xStep = niceStep((w - pl - pr) / (xmax - xmin), 50);
    for (let a = Math.ceil(xmin / xStep) * xStep; a < xmax; a += xStep) c.fillText(`${a / 1000}`, X(a) - 6, h - 6);
    // sites
    c.fillStyle = "#c9d4e5"; c.beginPath(); c.moveTo(X(0), Y(0) - 7); c.lineTo(X(0) - 4, Y(0)); c.lineTo(X(0) + 4, Y(0)); c.fill();
    c.fillStyle = "#ffe08a"; c.fillRect(X(MISSION.lzX) - 4, Y(0) - 3, 8, 3);
    c.font = "700 9px ui-monospace, Menlo, monospace";
    c.fillText("LZ", X(MISSION.lzX) - 6, Y(0) - 7);
    c.fillStyle = "#c9d4e5"; c.fillText("PAD", X(0) + 5, Y(0) - 7);
    // stage 2 path (clipped to the booster's frame)
    c.save(); c.beginPath(); c.rect(pl, pt, w - pl - pr, h - pt - pb); c.clip();
    if (s2history.length > 1) {
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.setLineDash([2, 3]); c.lineWidth = 1;
      c.beginPath(); s2history.forEach((p, i) => (i ? c.lineTo(X(p.x), Y(p.y)) : c.moveTo(X(p.x), Y(p.y)))); c.stroke(); c.setLineDash([]);
      const last = s2history[s2history.length - 1];
      c.fillStyle = "rgba(255,255,255,0.5)"; c.font = "9px ui-monospace, Menlo, monospace";
      c.fillText("2nd stage → orbit", Math.min(X(last.x), w - 95), Math.max(Y(last.y), pt + 10));
    }
    c.restore();
    // booster path colored by phase
    c.lineWidth = 2;
    for (let i = 1; i < history.length; i++) {
      const a = history[i - 1], b = history[i];
      c.strokeStyle = PHASE_COLORS[b.phase] || "#fff";
      c.beginPath(); c.moveTo(X(a.x), Y(a.y)); c.lineTo(X(b.x), Y(b.y)); c.stroke();
    }
    // predicted impact
    if (sim.predictedImpact != null && !sim.done && !sim.attached) {
      const px = X(clamp(sim.predictedImpact, xmin, xmax)), py = Y(0);
      c.strokeStyle = "#ff5d5d"; c.lineWidth = 2;
      c.beginPath(); c.moveTo(px - 4, py - 4); c.lineTo(px + 4, py + 4); c.moveTo(px + 4, py - 4); c.lineTo(px - 4, py + 4); c.stroke();
    }
    // vehicle
    const pulse = 3 + Math.sin(performance.now() / 200) * 1.2;
    c.fillStyle = "#fff"; c.beginPath(); c.arc(X(sim.x), Y(sim.y), pulse, 0, Math.PI * 2); c.fill();
  }

  function drawChart() {
    const w = +chCv.dataset.w, h = +chCv.dataset.h, c = cctx;
    c.setTransform(DPR, 0, 0, DPR, 0, 0);
    c.clearRect(0, 0, w, h);
    if (history.length < 2) return;
    const t0 = history[0].t, t1 = Math.max(history[history.length - 1].t, t0 + 30);
    let ymax = 1, vmax = 1;
    for (const p of history) { ymax = Math.max(ymax, p.y); vmax = Math.max(vmax, p.v); }
    const X = (t) => 6 + ((t - t0) / (t1 - t0)) * (w - 12);
    const series = [
      { key: (p) => p.thr, max: 1, color: "rgba(255,107,107,0.9)", fill: true },
      { key: (p) => p.y, max: ymax, color: "#7cc4ff" },
      { key: (p) => p.v, max: vmax, color: "#ffb454" },
    ];
    for (const sr of series) {
      c.beginPath();
      history.forEach((p, i) => { const x = X(p.t), y = h - 6 - (sr.key(p) / sr.max) * (h - 14); i ? c.lineTo(x, y) : c.moveTo(x, y); });
      if (sr.fill) {
        c.lineTo(X(history[history.length - 1].t), h - 6); c.lineTo(X(t0), h - 6); c.closePath();
        c.fillStyle = "rgba(255,107,107,0.18)"; c.fill();
      } else { c.strokeStyle = sr.color; c.lineWidth = 1.6; c.stroke(); }
    }
    c.font = "9px ui-monospace, Menlo, monospace"; c.fillStyle = "rgba(255,255,255,0.5)";
    c.fillText(`max ${(ymax / 1000).toFixed(0)} km · ${Math.round(vmax)} m/s`, 8, 11);
  }

  // -------------------------------------------------------------------
  // DOM panels
  // -------------------------------------------------------------------
  function fmtClock(t) {
    const sign = t < 0 ? "T-" : "T+";
    const a = Math.abs(t), m = Math.floor(a / 60), s = Math.floor(a % 60);
    return `${sign}${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  const fmtDist = (m) => (Math.abs(m) >= 10000 ? `${(m / 1000).toFixed(1)} km` : Math.abs(m) >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${m.toFixed(0)} m`);

  function buildTimeline() {
    const ol = $("timeline"); ol.innerHTML = "";
    for (const p of STEPS) {
      const li = document.createElement("li");
      li.dataset.phase = p;
      li.innerHTML = `<time></time>${PHASES[p].name}`;
      ol.appendChild(li);
    }
  }

  function updateTimeline() {
    const cur = sim.phase === "crashed" ? null : sim.phase;
    const curIdx = STEPS.indexOf(cur);
    let crashedAt = -1;
    if (sim.phase === "crashed") {
      // the step that was in progress when things went wrong
      let last = 0; STEPS.forEach((p, i) => { if (phaseTimes[p] != null) last = i; });
      crashedAt = last + 1 < STEPS.length ? last + 1 : last;
    }
    for (const li of $("timeline").children) {
      const p = li.dataset.phase, i = STEPS.indexOf(p);
      li.className = "";
      if (crashedAt >= 0) li.className = i < crashedAt ? "done" : i === crashedAt ? "fail" : "";
      else if (i < curIdx || (p === "landed" && cur === "landed")) li.className = "done";
      else if (i === curIdx) li.className = "now";
      const t = phaseTimes[p];
      li.querySelector("time").textContent = t != null ? fmtClock(t) : "";
    }
  }

  let lastExplain = null;
  function updateExplain(force) {
    if (!force && lastExplain === sim.phase) return;
    lastExplain = sim.phase;
    const e = EXPLAIN[sim.phase];
    const idx = STEPS.indexOf(sim.phase);
    $("explainStep").textContent = sim.phase === "prelaunch" ? "GET READY" : sim.phase === "crashed" ? "MISSION RESULT" : `STEP ${idx + 1} OF ${STEPS.length}`;
    $("explainTitle").textContent = e.title;
    $("explainText").textContent = typeof e.text === "function" ? e.text(sim) : e.text;
    $("explainFact").textContent = e.fact ? "💡 " + e.fact : "";
  }

  function updateLog() {
    const ul = $("log");
    while (logCount < sim.events.length) {
      const ev = sim.events[logCount++];
      const li = document.createElement("li");
      li.className = ev.kind;
      li.innerHTML = `<time>${fmtClock(ev.t)}</time>`;
      li.appendChild(document.createTextNode(ev.text));
      ul.appendChild(li);
      ul.scrollTop = ul.scrollHeight;
    }
  }

  function updateHud() {
    const s = sim;
    $("clock").textContent = fmtClock(s.t);
    $("warpNow").textContent = !running ? "paused" : s.done ? "" : warpNow <= 1.02 ? "1× real time" : `${warpNow.toFixed(warpNow < 10 ? 1 : 0)}× time warp`;
    const badge = $("phaseBadge");
    badge.textContent = PHASES[s.phase].short;
    badge.className = "phase-badge" + (s.phase === "landed" ? " good" : s.phase === "crashed" ? " bad" : s.thrust > 0 ? " burn" : "");
    $("tAlt").textContent = fmtDist(s.y);
    $("tSpd").textContent = `${Math.round(s.speed).toLocaleString()} m/s`;
    $("tVy").textContent = `${s.vy >= 0 ? "↑" : "↓"} ${Math.abs(s.vy).toFixed(s.y < 1000 ? 1 : 0)} m/s`;
    $("tVx").textContent = `${s.vx >= 0 ? "→" : "←"} ${Math.abs(s.vx).toFixed(s.y < 1000 ? 1 : 0)} m/s`;
    $("tMach").textContent = s.mach.toFixed(2);
    $("tQ").textContent = `${(s.q / 1000).toFixed(1)} kPa`;
    $("tEng").textContent = `${s.thrust > 0 ? s.engines : 0} / 9`;
    $("tThr").textContent = s.thrust > 0 ? `${Math.round(s.throttle * 100)} %` : "—";
    const accel = Math.hypot(s.ax, s.ay + 9.81) / 9.81;
    $("tG").textContent = `${accel.toFixed(1)} g`;
    $("tLz").textContent = fmtDist(Math.abs(s.x - MISSION.lzX));
    $("tProp").textContent = `${(s.prop / 1000).toFixed(1)} t`;
    $("propBar").style.width = `${(100 * s.prop) / VEHICLE.stage1Prop}%`;
    $("reserveMark").style.left = `${(100 * s.opts.reserve) / VEHICLE.stage1Prop}%`;
    $("propBar").style.background = s.prop < 3000 && !s.attached ? "linear-gradient(90deg,#ff5d5d,#ff9b6b)" : "";
    $("playBtn").textContent = running ? "❚❚ Pause" : "▶ Play";
  }

  function showResult() {
    const r = sim.result;
    if (!r) return;
    resultShown = true;
    $("result").classList.remove("hidden");
    $("resultIcon").textContent = r.success ? "✓" : "✕";
    $("resultIcon").className = "result-icon" + (r.success ? "" : " bad");
    $("resultTitle").textContent = r.success ? "The booster has landed!" : "Booster lost";
    const lastEv = sim.events[sim.events.length - 1];
    $("resultText").textContent = r.success
      ? `It flew to ${(sim.apogee / 1000).toFixed(0)} km, turned around and touched down ${Math.abs(r.miss).toFixed(1)} m from the pad centre, ${fmtClock(r.time).slice(2)} after liftoff.`
      : lastEv.text + ".";
    const stats = [
      ["TOUCHDOWN", `${r.vDown.toFixed(1)} m/s`], ["MISS DISTANCE", fmtDist(Math.abs(r.miss))], ["FUEL LEFT", `${(r.prop / 1000).toFixed(1)} t`],
      ["APOGEE", `${(sim.apogee / 1000).toFixed(0)} km`], ["TOP SPEED", `${Math.round(sim.maxSpeed).toLocaleString()} m/s`], ["MAX-Q", `${(sim.maxQ / 1000).toFixed(0)} kPa`],
    ];
    $("resultStats").innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><strong>${v}</strong></div>`).join("");
  }

  // -------------------------------------------------------------------
  // Controls
  // -------------------------------------------------------------------
  $("playBtn").onclick = () => { running = !running; };
  $("restartBtn").onclick = () => newSim();
  $("againBtn").onclick = () => newSim();
  $("closeResult").onclick = () => $("result").classList.add("hidden");
  $("vecChk").onchange = (e) => { showVectors = e.target.checked; };
  for (const b of $("warpSeg").children) b.onclick = () => {
    warpMode = b.dataset.warp;
    for (const o of $("warpSeg").children) o.classList.toggle("on", o === b);
  };
  for (const b of $("camSeg").children) b.onclick = () => {
    view.setMode(b.dataset.cam);
    for (const o of $("camSeg").children) o.classList.toggle("on", o === b);
  };
  $("wind").oninput = (e) => {
    const v = +e.target.value;
    $("windOut").textContent = v === 0 ? "0 m/s" : `${Math.abs(v)} m/s ${v > 0 ? "→" : "←"}`;
    sim.opts.wind = v; // wind changes take effect live
  };
  $("reserve").oninput = (e) => {
    const v = +e.target.value;
    $("reserveOut").textContent = `${v} t`;
    if (sim.phase === "prelaunch" || sim.phase === "ascent") sim.opts.reserve = v * 1000;
    else $("reserveOut").textContent = `${v} t*`;
    $("reserveOut").title = "Applies to the next flight once MECO has happened";
  };
  window.addEventListener("keydown", (e) => {
    if (e.target.tagName === "INPUT") return;
    if (e.code === "Space") { e.preventDefault(); running = !running; }
    if (e.key === "r" || e.key === "R") newSim();
    if (e.key === "v" || e.key === "V") { showVectors = !showVectors; $("vecChk").checked = showVectors; }
  });

  // -------------------------------------------------------------------
  // Main loop
  // -------------------------------------------------------------------
  newSim();
  let last = performance.now(), hudTimer = 0, mapTimer = 0;
  function frame(now) {
    const realDt = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (running) advance(realDt);
    render(realDt);
    hudTimer -= realDt; mapTimer -= realDt;
    if (hudTimer <= 0) { hudTimer = 0.08; updateHud(); updateLog(); updateTimeline(); updateExplain(); }
    if (mapTimer <= 0) { mapTimer = 0.2; drawMap(); drawChart(); }
    if (sim.done && !resultShown && doneTimer > 2.5) showResult();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // exposed for debugging in the console
  window.__boosterApp = {
    get sim() { return sim; }, newSim,
    /** Fast-forward (sim seconds) and draw one frame — handy when testing. */
    skip(seconds) { for (let t = 0; t < seconds; t += 0.1) advance(0.1 / Math.max(warpNow, 1)); },
    view, renderNow() { for (let i = 0; i < 20; i++) view.update(0.1, viewState()); render(); updateHud(); updateLog(); updateTimeline(); updateExplain(); drawMap(); drawChart(); },
  };
})();
