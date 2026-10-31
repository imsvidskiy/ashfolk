const SIDE = 640, N = SIDE * SIDE;
function time(label, runs, body) { let s = 0; for (let i = 0; i < 3; i++) s += body(); const t = performance.now(); for (let i = 0; i < runs; i++) s += body(); console.log(label.padEnd(64), ((performance.now() - t) / runs * 1000).toFixed(1).padStart(9), "us", s % 3); }
const fire = new Float32Array(N); for (let i = 0; i < 5000; i++) fire[200 * SIDE + (i % 100) + ((i / 100) | 0) * SIDE] = 0.5;
const dist = new Float32Array(N);
function chamfer() { const INF = 1e9; for (let c = 0; c < N; c++) dist[c] = fire[c] > 0 ? 0 : INF; for (let r = 0; r < SIDE; r++) for (let q = 0; q < SIDE; q++) { const c = r * SIDE + q; let d = dist[c]; if (q > 0 && dist[c - 1] + 1 < d) d = dist[c - 1] + 1; if (r > 0) { if (dist[c - SIDE] + 1 < d) d = dist[c - SIDE] + 1; if (q > 0 && dist[c - SIDE - 1] + 1.4142 < d) d = dist[c - SIDE - 1] + 1.4142; if (q < SIDE - 1 && dist[c - SIDE + 1] + 1.4142 < d) d = dist[c - SIDE + 1] + 1.4142; } dist[c] = d; } for (let r = SIDE - 1; r >= 0; r--) for (let q = SIDE - 1; q >= 0; q--) { const c = r * SIDE + q; let d = dist[c]; if (q < SIDE - 1 && dist[c + 1] + 1 < d) d = dist[c + 1] + 1; if (r < SIDE - 1) { if (dist[c + SIDE] + 1 < d) d = dist[c + SIDE] + 1; if (q < SIDE - 1 && dist[c + SIDE + 1] + 1.4142 < d) d = dist[c + SIDE + 1] + 1.4142; if (q > 0 && dist[c + SIDE - 1] + 1.4142 < d) d = dist[c + SIDE - 1] + 1.4142; } dist[c] = d; } return dist[0] | 0; }
time("fireDistance full chamfer rebuild at 640^2", 50, chamfer);
const exposure = new Float32Array(768 * 768);
time("clear one dense exposure at 768^2 with fill(0)", 500, () => { exposure.fill(0); return 1; });
// CellSet memory per field
console.log("CellSet bytes per field at 768^2:", (768 * 768 * 5 / 1048576).toFixed(2), "MB; values:", (768 * 768 * 4 / 1048576).toFixed(2), "MB");
