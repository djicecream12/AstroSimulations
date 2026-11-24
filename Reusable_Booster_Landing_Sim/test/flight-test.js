// Headless regression test: flies full missions across wind / reserve settings.
// Run with:  node test/flight-test.js
const { Simulation } = require("../physics.js");

const cases = [
  { wind: 0, reserve: 52000, expect: true },
  { wind: 15, reserve: 52000, expect: true },
  { wind: 30, reserve: 52000, expect: true },
  { wind: -15, reserve: 52000, expect: true },
  { wind: -30, reserve: 52000, expect: true },
  { wind: 0, reserve: 60000, expect: true },
  { wind: 0, reserve: 36000, expect: false }, // too little propellant kept
];

let failures = 0;
for (const c of cases) {
  const sim = new Simulation({ wind: c.wind, reserve: c.reserve });
  while (!sim.done && sim.t < 1200) sim.step(0.02);
  const r = sim.result;
  const pass = r && r.success === c.expect;
  if (!pass) failures++;
  console.log(
    `${pass ? "PASS" : "FAIL"}  wind ${String(c.wind).padStart(3)} m/s  reserve ${c.reserve / 1000} t  →  ` +
    (r ? `${r.success ? "landed" : "lost"}  ${r.vDown.toFixed(1)} m/s, ${Math.abs(r.miss).toFixed(1)} m off, ${(r.prop / 1000).toFixed(1)} t left` : "no result")
  );
}
process.exit(failures ? 1 : 0);
