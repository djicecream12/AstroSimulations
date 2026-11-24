# 🚀 Reusable Booster Landing Simulator

An interactive, physics-based simulation of **how SpaceX lands its reusable Falcon 9 first stage**. It flies a full *Return-To-Launch-Site* (RTLS) mission from liftoff to touchdown on the landing zone, explaining each step as it happens.

Open `index.html` in any modern browser. There's nothing to install. The flight is shown in a **3D scene you can orbit with your mouse**: drag to rotate, scroll to zoom.

> The 3D view uses [three.js](https://threejs.org), loaded from a CDN, so the first load needs an internet connection. To run fully offline, save [`three.min.js` r149](https://cdn.jsdelivr.net/npm/three@0.149.0/build/three.min.js) as `vendor/three.min.js`; the page falls back to it automatically.

## What you'll see

| # | Phase | What happens |
|---|-------|--------------|
| 1 | **Liftoff & ascent** | 9 engines, gravity turn, throttle-down through Max-Q |
| 2 | **MECO** | Engines cut early, keeping ~50 t of propellant for the trip home |
| 3 | **Stage separation** | The second stage lights up and heads to orbit |
| 4 | **Flip maneuver** | Cold-gas nitrogen thrusters rotate the booster ~130° in near-vacuum |
| 5 | **Boostback burn** | 3 engines reverse the downrange velocity; cutoff when the *predicted impact point* reaches the landing zone |
| 6 | **Coast & grid fins** | Booster arcs past 100 km; titanium grid fins deploy |
| 7 | **Entry burn** | 3 engines slow the booster before it hits thick air (reentry heating & soot!) |
| 8 | **Aerodynamic guidance** | Grid fins generate lift to steer onto the pad |
| 9 | **Landing burn** | Single-engine *hoverslam*: the engine can't throttle low enough to hover, so it must reach 0 m/s exactly at 0 m |
| 10 | **Touchdown** | Legs deploy, booster lands and is ready to fly again |

The screen also shows:

- Live telemetry: altitude, speed, Mach, dynamic pressure, throttle, g-load and propellant.
- A trajectory map with the predicted impact point.
- Flight-data charts.
- Force vectors for thrust, drag, gravity and velocity.
- A flight-computer event log.

## Controls

| Control | Effect |
|---------|--------|
| **Space** / Pause | Pause / resume |
| **R** / Restart | Fly again |
| **Time warp** | `Auto` speeds through quiet coasting and slows to real time for key events; or pick 1×–30× |
| **Drag** (mouse / one finger) | Orbit the camera around the rocket |
| **Scroll** / pinch / `+` `−` | Zoom in and out |
| **Arrow keys** | Orbit with the keyboard (hold Shift for bigger steps) |
| **Double-click** / `C` | Reset the camera angle |
| **Camera** | `Close` (true scale chase cam), `Wide`, or `Ground` (a telephoto tracking camera near the pad / landing zone) |
| **V** / Force vectors | Toggle thrust / drag / gravity / velocity arrows |
| **Wind** | Live crosswind (−30…+30 m/s): watch the guidance compensate |
| **Landing reserve** | Propellant kept at MECO. Too little and the booster can't finish its landing burn |

## The physics

`physics.js` is a 2D (downrange × altitude) point-mass model with no DOM dependencies (`scene3d.js` draws it in 3D):

- **Rocket equation via mass flow:** ṁ = T / (Isp · g₀), with mass falling as propellant burns.
- **Altitude-dependent thrust:** Merlin 1D thrust rises from 845 kN at sea level to 914 kN in vacuum.
- **Exponential atmosphere:** ρ = 1.225 · e^(−h/8500). Drag is D = ½ρv²·C<sub>d</sub>A, and C<sub>d</sub>A depends on attitude, grid fins and legs.
- **Wind profile** that changes with altitude.
- **Attitude dynamics** with rate and acceleration limits, plus a ±5° engine gimbal.
- **Flight computer (guidance):**
  - *Ascent:* altitude-based pitch program.
  - *Boostback:* a ballistic impact predictor (drag included) decides when to shut down.
  - *Grid fins:* lift steering toward the pad, limited by available drag.
  - *Landing burn:* each step it searches for the throttle whose drag-aware stopping distance equals the current altitude. Sideways error is handled by terminal guidance (a = −6·e/t² − 4·v/t) using thrust tilt.

Vehicle numbers are approximate public figures: 25.6 t dry mass, 395.7 t propellant, 9 × Merlin 1D, Isp 311 s in vacuum.

### Simplifications
Flat, non-rotating Earth; the flight itself is 2D (it stays in one vertical plane; the 3D scene is for viewing); no structural loads or engine spool-up; the guidance is a teaching model, not SpaceX's flight software.

## Files

```
index.html          page layout
style.css           UI styling
physics.js          vehicle model, atmosphere, guidance (runs in browser or Node)
scene3d.js          three.js scene: terrain, pads, rocket model, plumes, sky, orbit camera
app.js              simulation loop, particles, HUD, map/chart, controls
test/flight-test.js headless regression test: node test/flight-test.js
```

## Disclaimer
Independent educational project. Not affiliated with or endorsed by SpaceX.

## License

MIT — see the [LICENSE](../LICENSE) file.
