/* =====================================================================
   Reusable Booster Landing Simulator — physics + flight computer
   ---------------------------------------------------------------------
   A 2D (downrange x / altitude y) point-mass model of a Falcon 9-class
   first stage flying a Return-To-Launch-Site (RTLS) mission.

   Modelled:
     - variable mass (rocket equation via mass flow = thrust / (Isp * g0))
     - altitude-dependent thrust (sea level vs vacuum nozzle performance)
     - exponential atmosphere, aerodynamic drag, wind
     - grid-fin lift during the unpowered descent
     - an autonomous flight computer that sequences every phase
     - a "hoverslam" landing burn (one engine can't throttle low enough
       to hover, so it must reach zero speed exactly at ground level)

   Not modelled: Earth curvature/rotation, 3D, structural loads, real
   SpaceX guidance software. Numbers are public, approximate values.

   This file has no DOM dependencies so it can run headless for tests.
   ===================================================================== */
(function (root) {
  "use strict";

  const G0 = 9.80665;
  const R_EARTH = 6371000;
  const DEG = Math.PI / 180;

  const VEHICLE = {
    stage1Dry: 25600,        // kg, incl. legs + grid fins
    stage1Prop: 395700,      // kg, LOX + RP-1
    upperStack: 126500,      // kg, second stage + payload + fairing
    engineThrustSL: 845e3,   // N per Merlin 1D at sea level
    engineThrustVac: 914e3,  // N per Merlin 1D in vacuum
    ispVac: 311,             // s
    minThrottle: 0.4,
    diameter: 3.66,          // m
    length: 41.2,            // m (first stage incl. interstage)
    upperLength: 29,         // m (second stage + fairing, drawn on top)
    mvacThrust: 981e3,       // N, second stage vacuum engine
    mvacIsp: 348,
  };

  const MISSION = {
    padX: 0,
    lzX: -9000,              // landing zone sits ~9 km from the launch pad
    mecoReserve: 52000,      // kg propellant kept for recovery (RTLS)
    boostbackOvershoot: 1500,// aim boostback this far "past" the LZ (m)
    entryStartAlt: 52000,    // m, entry burn ignition (descending)
    entryEndSpeed: 620,      // m/s, entry burn cutoff
    legsDeployAlt: 700,      // m
    touchdownSpeed: 1.5,     // m/s, target vertical speed at contact
    padRadius: 45,           // m, landing-pad radius counted as on target
  };

  const PHASES = {
    prelaunch: { name: "Countdown", short: "T-MINUS" },
    ascent:    { name: "Liftoff & ascent", short: "ASCENT" },
    meco:      { name: "MECO", short: "MECO" },
    separation:{ name: "Stage separation", short: "STAGE SEP" },
    flip:      { name: "Flip maneuver", short: "FLIP" },
    boostback: { name: "Boostback burn", short: "BOOSTBACK" },
    coast:     { name: "Coast & grid fins", short: "COAST" },
    entry:     { name: "Entry burn", short: "ENTRY BURN" },
    aero:      { name: "Aerodynamic guidance", short: "GRID FINS" },
    landing:   { name: "Landing burn", short: "LANDING BURN" },
    landed:    { name: "Touchdown", short: "LANDED" },
    crashed:   { name: "Rapid unscheduled disassembly", short: "LOST" },
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  function density(h) { return h > 140000 ? 0 : 1.225 * Math.exp(-Math.max(h, 0) / 8500); }
  function pressureRatio(h) { return Math.exp(-Math.max(h, 0) / 7600); }
  function gravity(h) { const r = R_EARTH / (R_EARTH + h); return G0 * r * r; }
  function speedOfSound(h) { return h < 11000 ? 340 - 0.0041 * h : 295; }

  /** Horizontal wind speed (m/s) at altitude h for a surface-wind setting. */
  function windAt(h, surface) {
    if (!surface) return 0;
    if (h < 12000) return surface * (0.6 + 0.4 * Math.min(h / 1500, 1)) * (1 + h / 12000);
    return surface * 2 * Math.exp(-(h - 12000) / 8000);
  }

  /** Effective attitude (rad from vertical, + = toward downrange) that
   *  points the nose opposite the velocity vector (engines first). */
  function retrograde(vx, vy) { return Math.atan2(-vx, -vy); }

  class Simulation {
    constructor(opts = {}) {
      this.opts = Object.assign({ wind: 0, reserve: MISSION.mecoReserve }, opts);
      this.reset();
    }

    reset() {
      this.t = -10;                 // countdown starts at T-10 s
      this.x = MISSION.padX;        // m (bottom of the booster)
      this.y = 0;
      this.vx = 0; this.vy = 0;
      this.ax = 0; this.ay = 0;
      this.att = 0;                 // rad from vertical, + toward downrange
      this.attRate = 0;
      this.attCmd = 0;
      this.gimbal = 0;
      this.prop = VEHICLE.stage1Prop;
      this.attached = true;         // upper stage still on top
      this.engines = 0;             // number of Merlins firing
      this.throttle = 1;
      this.throttleCmd = 1;
      this.thrust = 0;
      this.coldGas = 0;             // -1/0/+1 RCS thruster puffs (visual)
      this.gridFins = 0;            // 0..1 deployment
      this.gridFinsCmd = 0;
      this.finDeflect = 0;          // rad, visual
      this.legs = 0;                // 0..1 deployment
      this.legsCmd = 0;
      this.q = 0; this.maxQ = 0; this.maxQReported = false;
      this.mach = 0;
      this.heat = 0;                // 0..1 reentry heating (visual)
      this.phase = "prelaunch";
      this.phaseStart = this.t;
      this.events = [];
      this.predictedImpact = null;
      this.predTimer = 0;
      this.result = null;
      this.done = false;
      this.stage2 = null;
      this.apogee = 0;
      this.maxSpeed = 0;
      this.landingIgnitionAlt = null;
      this.engineOff = false;
      this.log("Countdown — propellant loaded, vehicle on internal power");
    }

    get mass() { return VEHICLE.stage1Dry + Math.max(this.prop, 0) + (this.attached ? VEHICLE.upperStack : 0); }
    get speed() { return Math.hypot(this.vx, this.vy); }
    get propFraction() { return this.prop / VEHICLE.stage1Prop; }
    get phaseInfo() { return PHASES[this.phase]; }

    log(text, kind = "info") { this.events.push({ t: this.t, text, kind, phase: this.phase }); }

    setPhase(p, msg, kind) {
      this.phase = p;
      this.phaseStart = this.t;
      if (msg) this.log(msg, kind || "phase");
    }

    /** Drag reference: C_d * A (m^2) for the current configuration. */
    cdA() {
      const A = Math.PI * (VEHICLE.diameter / 2) ** 2;
      if (this.attached) return 0.32 * A;
      // angle between body axis and the oncoming flow
      const flowAtt = retrograde(this.vx, this.vy);
      const aoa = Math.abs(wrap(this.att - flowAtt));
      const side = Math.sin(Math.min(aoa, Math.PI / 2)) ** 2;
      const axial = 0.95 + 0.35 * this.gridFins + 0.25 * this.legs;
      return A * axial + VEHICLE.diameter * VEHICLE.length * 0.5 * side;
    }

    engineThrust(h) {
      const pr = pressureRatio(h);
      return VEHICLE.engineThrustVac - (VEHICLE.engineThrustVac - VEHICLE.engineThrustSL) * pr;
    }

    /** Ballistic impact prediction with drag (no further burns). */
    predictImpact(x = this.x, y = this.y, vx = this.vx, vy = this.vy) {
      const m = VEHICLE.stage1Dry + Math.max(this.prop, 0);
      const A = Math.PI * (VEHICLE.diameter / 2) ** 2;
      const cdA = A * 1.3;
      let t = 0, dt = 1;
      while (t < 900) {
        const wind = windAt(y, this.opts.wind);
        const rvx = vx - wind, rvy = vy;
        const rv = Math.hypot(rvx, rvy);
        const k = 0.5 * density(y) * cdA * rv / m;
        vx += -k * rvx * dt;
        vy += (-gravity(y) - k * rvy) * dt;
        x += vx * dt; y += vy * dt;
        t += dt;
        if (y < 3000) dt = 0.25;
        if (y <= 0) return x;
      }
      return x;
    }

    // -----------------------------------------------------------------
    // Flight computer: decides engines, throttle and attitude per phase
    // -----------------------------------------------------------------
    guidance(dt) {
      const h = this.y;
      const lz = MISSION.lzX;
      const m = this.mass;
      this.coldGas = 0;

      switch (this.phase) {
        case "prelaunch": {
          this.engines = 0;
          if (this.t >= -3 && !this._ign) { this._ign = true; this.log("Engine ignition sequence — 9 Merlin engines start"); }
          if (this._ign) { this.engines = 9; this.throttleCmd = 1; }
          if (this.t >= 0) this.setPhase("ascent", "Liftoff! Thrust exceeds weight (TWR ≈ 1.4)");
          break;
        }
        case "ascent": {
          this.engines = 9;
          // Throttle bucket through maximum aerodynamic pressure
          this.throttleCmd = this.q > 26000 ? 0.75 : 1;
          if (this.q > 26000 && !this._bucket) { this._bucket = true; this.log("Throttling down for Max-Q"); }
          // Pitch program: vertical rise, then gradual pitch-over (gravity turn)
          const pitch = h < 800 ? 0 : 52 * DEG * Math.pow(clamp((h - 800) / 60000, 0, 1), 0.55);
          this.attCmd = pitch;
          if (this.prop <= this.opts.reserve) {
            this.engines = 0;
            this.setPhase("meco", `MECO — main engine cutoff. ${Math.round(this.prop / 1000)} t of propellant held in reserve for landing`);
          }
          break;
        }
        case "meco": {
          this.engines = 0;
          if (this.t - this.phaseStart > 2.5) {
            this.attached = false;
            this.stage2 = {
              x: this.x + Math.sin(this.att) * VEHICLE.length,
              y: this.y + Math.cos(this.att) * VEHICLE.length,
              vx: this.vx + Math.sin(this.att) * 1.5, vy: this.vy + Math.cos(this.att) * 1.5,
              att: this.att, mass: VEHICLE.upperStack, firing: false, t0: this.t,
            };
            this.setPhase("separation", "Stage separation — pneumatic pushers release the second stage");
          }
          break;
        }
        case "separation": {
          this.engines = 0;
          this.attCmd = this.att;
          if (this.t - this.phaseStart > 3) {
            this.setPhase("flip", "Flip maneuver — cold-gas nitrogen thrusters rotate the booster");
          }
          break;
        }
        case "flip": {
          this.engines = 0;
          const dir = Math.sign(this.predictImpact() - lz) || 1;
          this.attCmd = -dir * 80 * DEG;
          this.coldGas = Math.sign(wrap(this.attCmd - this.att));
          if (Math.abs(wrap(this.attCmd - this.att)) < 4 * DEG && Math.abs(this.attRate) < 3 * DEG) {
            this.setPhase("boostback", "Boostback burn — 3 engines reverse the booster's horizontal velocity");
          }
          break;
        }
        case "boostback": {
          const target = lz + MISSION.boostbackOvershoot;
          const err = (this.predictedImpact ?? this.predictImpact()) - target;
          this.engines = Math.abs(err) < 3000 ? 1 : 3;
          this.throttleCmd = 1;
          this.attCmd = -Math.sign(err) * 80 * DEG;
          if (err <= 0 || this.prop <= 0) {
            this.engines = 0;
            this.gridFinsCmd = 1;
            this.setPhase("coast", "Boostback shutdown — on course for the landing zone. Grid fins deploy");
          }
          break;
        }
        case "coast": {
          this.engines = 0;
          this.attCmd = this.vy < -50 ? retrograde(this.vx, this.vy) : retrograde(this.vx, Math.min(this.vy, -this.speed));
          this.coldGas = Math.abs(wrap(this.attCmd - this.att)) > 3 * DEG ? Math.sign(wrap(this.attCmd - this.att)) : 0;
          if (this.vy < 0 && h < MISSION.entryStartAlt) {
            this.setPhase("entry", "Entry burn — 3 engines slow the booster before it hits thick air");
          }
          break;
        }
        case "entry": {
          this.engines = 3;
          this.throttleCmd = 1;
          this.attCmd = retrograde(this.vx, this.vy) + this.lateralTilt(6);
          if (this.speed < MISSION.entryEndSpeed || this.vy > -50 || this.prop <= 0) {
            this.engines = 0;
            this.setPhase("aero", "Entry burn shutdown — grid fins steer through the atmosphere");
          }
          break;
        }
        case "aero": {
          this.engines = 0;
          this.attCmd = retrograde(this.vx, this.vy);
          // Landing burn ignition: start when the needed braking reaches
          // ~80% of what a single engine can deliver (hoverslam timing)
          const vDown = -this.vy;
          if (vDown > 0 && h < 8000 && h <= this.stoppingDistance(0.8) + 10) {
            this.landingIgnitionAlt = h;
            this.engineOff = false;
            this.setPhase("landing", `Landing burn ignition at ${Math.round(h)} m — single engine "hoverslam"`);
          }
          break;
        }
        case "landing": {
          const vDown = -this.vy;
          const hh = Math.max(h, 0.5);
          const vt = MISSION.touchdownSpeed;
          if (h < MISSION.legsDeployAlt && !this.legsCmd) { this.legsCmd = 1; this.log("Landing legs deploy (helium pneumatics)"); }
          // Throttle: find the setting whose predicted stop (drag included)
          // lands exactly at ground level at touchdown speed. Re-solved every
          // step, so it acts as closed-loop feedback.
          let lo = 0.2, hi = 1.0;
          if (this.stoppingDistance(hi, vt) > hh) lo = hi;
          else for (let i = 0; i < 12; i++) {
            const mid = (lo + hi) / 2;
            if (this.stoppingDistance(mid, vt) > hh) lo = mid; else hi = mid;
          }
          let u = (lo + hi) / 2;
          if (vDown < vt) u = 0.35; // already slow: ease off
          // Horizontal steering by tilting the engine thrust
          const ex = this.x - lz;
          const tgo = clamp(2 * hh / Math.max(vDown + vt, 1), 1.5, 40);
          // Terminal guidance: acceleration that zeroes both position error
          // and sideways velocity exactly when time-to-go reaches zero
          // (targeted ~2.5 s early so the final moments are a vertical drop),
          // then a damped velocity-hold for the last few seconds.
          let axDes;
          if (tgo > 4) { const tH = tgo - 2.5; axDes = -6 * ex / (tH * tH) - 4 * this.vx / tH; }
          else axDes = -1.2 * this.vx - 0.15 * ex;
          const aUpThrust = u * this.engineThrust(h) / m;
          const maxTilt = Math.min(15, 4 + Math.max(h, 0) * 0.5) * DEG;
          const ang = clamp(Math.atan2(axDes, Math.max(aUpThrust, 1)), -maxTilt, maxTilt);
          u /= Math.cos(this.att);
          // A Merlin can't throttle below ~40% → it can't hover. If we would
          // need less than that while nearly stopped, cut the engine briefly.
          if (u < VEHICLE.minThrottle * 0.9 && vDown < vt && h > 3) {
            this.engines = 0; this.engineOff = true;
          } else {
            this.engines = 1;
            this.throttleCmd = clamp(u, VEHICLE.minThrottle, 1);
          }
          this.attCmd = ang;
          break;
        }
        default:
          this.engines = 0;
      }
    }

    /** Height (m) needed to stop from the current descent rate if one engine
     *  fires at `throttle` from now on — drag included, integrated numerically. */
    stoppingDistance(throttle, vEnd = 0) {
      let v = -this.vy, h = this.y, m = this.mass, d = 0;
      const dt = this.y < 300 ? 0.02 : 0.1;
      const cdA = this.cdA();
      for (let i = 0; i < 1500 && v > vEnd; i++) {
        const T = throttle * this.engineThrust(h);
        const drag = 0.5 * density(h) * cdA * v * v;
        v -= ((T + drag) / m - gravity(h)) * dt;
        m -= T / (VEHICLE.ispVac * G0) * dt;
        d += Math.max(v, 0) * dt; h -= v * dt;
      }
      return d;
    }

    /** Small attitude offset (rad) used to steer toward the landing zone. */
    lateralTilt(maxDeg) {
      const h = Math.max(this.y, 1);
      const tgo = h / Math.max(-this.vy, 50);
      const vxDes = -(this.x - MISSION.lzX) / tgo;
      return clamp((vxDes - this.vx) * 0.01, -maxDeg * DEG, maxDeg * DEG);
    }

    step(dt) {
      if (this.done) return;
      // Predict landing point a few times per second (for guidance + HUD)
      this.predTimer -= dt;
      if (this.predTimer <= 0 && !this.attached) {
        this.predictedImpact = this.predictImpact();
        this.predTimer = this.phase === "boostback" ? 0.1 : 0.5;
      }

      this.guidance(dt);

      // ---- attitude dynamics (rate & acceleration limited) ----
      const rcsPhase = this.phase === "flip" || this.phase === "coast" || this.phase === "separation";
      const maxRate = (rcsPhase ? 9 : this.phase === "landing" ? 10 : 4) * DEG;
      const angAcc = (rcsPhase ? 4 : this.phase === "landing" ? 20 : 8) * DEG;
      const err = wrap(this.attCmd - this.att);
      const desiredRate = clamp(err * 1.2, -maxRate, maxRate);
      this.attRate += clamp(desiredRate - this.attRate, -angAcc * dt, angAcc * dt);
      this.att = wrap(this.att + this.attRate * dt);

      // ---- actuators ----
      this.throttle += clamp(this.throttleCmd - this.throttle, -1.5 * dt, 1.5 * dt);
      this.gridFins += clamp(this.gridFinsCmd - this.gridFins, -dt / 2, dt / 2);
      this.legs += clamp(this.legsCmd - this.legs, -dt / 2.5, dt / 2.5);

      const h = this.y;
      const m = this.mass;
      let T = 0;
      if (this.engines > 0 && this.prop > 0) {
        T = this.engines * this.throttle * this.engineThrust(h);
        const mdot = this.engines * this.throttle * VEHICLE.engineThrustVac / (VEHICLE.ispVac * G0);
        this.prop -= mdot * dt;
        if (this.prop <= 0) { this.prop = 0; this.log("Propellant depleted!", "bad"); }
      }
      if (this.phase === "prelaunch") T = this.engines ? T * clamp((this.t + 3) / 2, 0, 1) : 0;
      this.thrust = T;

      // ---- aerodynamics ----
      const wind = windAt(h, this.opts.wind);
      const rvx = this.vx - wind, rvy = this.vy;
      const rv = Math.hypot(rvx, rvy);
      const rho = density(h);
      this.q = 0.5 * rho * rv * rv;
      this.mach = rv / speedOfSound(h);
      const D = this.q * this.cdA();
      let ax = rv > 0 ? -D * rvx / rv / m : 0;
      let ay = rv > 0 ? -D * rvy / rv / m : 0;

      // Grid-fin lift: steer toward the landing zone during unpowered descent
      this.finDeflect = 0;
      if (this.gridFins > 0.9 && (this.phase === "aero" || this.phase === "entry") && rv > 1) {
        const dragAcc = D / m;
        // time to go ≈ fall time to the ground
        const tgo = Math.max(h, 1) / Math.max(-this.vy, 40);
        const vxDes = -(this.x - MISSION.lzX) / tgo;
        const aLat = clamp((vxDes - this.vx) * 0.35, -0.35 * dragAcc, 0.35 * dragAcc);
        ax += aLat;
        this.finDeflect = clamp(aLat / (0.35 * dragAcc + 1e-6), -1, 1);
      }

      // Reentry heating indicator (visual) — scales with rho * v^3
      this.heat = clamp(rho * rv * rv * rv / 2.5e7, 0, 1);

      // Engine gimbal: the nozzle can swivel ±5° almost instantly, so the
      // thrust line leads the (slower) body attitude toward the command.
      this.gimbal = this.engines > 0 && this.phase !== "ascent" && this.phase !== "prelaunch"
        ? clamp(wrap(this.attCmd - this.att), -5 * DEG, 5 * DEG) : 0;
      const thrustDir = this.att + this.gimbal;
      ax += T * Math.sin(thrustDir) / m;
      ay += T * Math.cos(thrustDir) / m - gravity(h);

      if (this.phase === "prelaunch" && ay < 0) { ax = 0; ay = 0; }
      this.ax = ax; this.ay = ay;

      // semi-implicit Euler
      this.vx += ax * dt; this.vy += ay * dt;
      this.x += this.vx * dt; this.y += this.vy * dt;
      this.t += dt;

      if (this.y > this.apogee) this.apogee = this.y;
      if (this.q > this.maxQ) this.maxQ = this.q;
      else if (this.phase === "ascent" && !this.maxQReported && this.maxQ > 15000 && this.q < this.maxQ * 0.97) {
        this.maxQReported = true;
        this.log(`Max-Q passed: ${(this.maxQ / 1000).toFixed(1)} kPa of dynamic pressure`);
      }
      this.maxSpeed = Math.max(this.maxSpeed, this.speed);

      if (this.phase === "ascent" && this._bucket && !this._bucketEnd && this.q < 22000 && this.maxQReported) {
        this._bucketEnd = true; this.log("Throttle back up to 100%");
      }

      this.stepStage2(dt);

      // ---- ground contact ----
      if (this.y <= 0 && this.phase !== "prelaunch" && this.t > 1) {
        this.y = 0;
        this.touchdown();
      } else if (this.y < 0) { this.y = 0; this.vy = Math.max(this.vy, 0); }
    }

    stepStage2(dt) {
      const s = this.stage2;
      if (!s) return;
      const age = this.t - s.t0;
      if (age > 120) { this.stage2 = null; return; }
      if (age > 7 && !s.firing) { s.firing = true; this.log("Second stage engine ignition (SES-1) — payload continues to orbit"); }
      let T = 0;
      if (s.firing) {
        T = VEHICLE.mvacThrust;
        s.mass -= T / (VEHICLE.mvacIsp * G0) * dt;
        s.att += clamp(80 * DEG - s.att, -0.5 * DEG * dt, 0.5 * DEG * dt);
      }
      s.vx += T * Math.sin(s.att) / s.mass * dt;
      s.vy += (T * Math.cos(s.att) / s.mass - gravity(s.y)) * dt;
      s.x += s.vx * dt; s.y += s.vy * dt;
    }

    touchdown() {
      const vDown = -this.vy;
      const miss = this.x - MISSION.lzX;
      const tilt = Math.abs(this.att) / DEG;
      const ok = vDown < 6 && Math.abs(this.vx) < 3 && tilt < 10 && this.legs > 0.95 && Math.abs(miss) < MISSION.padRadius;
      this.result = { success: ok, vDown, vx: this.vx, miss, tilt, prop: this.prop, time: this.t, legs: this.legs };
      this.engines = 0; this.thrust = 0;
      this.vx = 0; this.vy = 0; this.ax = 0; this.ay = 0; this.attRate = 0; this.q = 0; this.mach = 0; this.heat = 0;
      if (ok) {
        this.setPhase("landed", `Touchdown! ${vDown.toFixed(1)} m/s, ${Math.abs(miss).toFixed(1)} m from pad center. The booster can fly again.`, "good");
      } else {
        const why = Math.abs(miss) > 2000 ? `came down ${(Math.abs(miss) / 1000).toFixed(1)} km from the landing zone`
          : this.prop <= 0 && vDown >= 6 ? `ran out of propellant and hit the ground at ${vDown.toFixed(0)} m/s`
          : this.legs < 0.95 ? "landing legs were not deployed"
          : Math.abs(miss) >= MISSION.padRadius ? `missed the pad by ${Math.abs(miss).toFixed(0)} m`
          : tilt >= 10 ? `tipped over (${tilt.toFixed(0)}° tilt)`
          : vDown >= 6 ? `hit the pad at ${vDown.toFixed(0)} m/s` : `slid sideways at ${Math.abs(this.result.vx).toFixed(1)} m/s`;
        this.setPhase("crashed", `Landing failed — ${why}`, "bad");
      }
      this.done = true;
    }
  }

  const api = { Simulation, VEHICLE, MISSION, PHASES, density, windAt, DEG };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.BoosterSim = api;
})(typeof window !== "undefined" ? window : this);
