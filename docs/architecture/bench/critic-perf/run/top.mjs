import fs from "node:fs";
const file = process.argv[2];
const profile = JSON.parse(fs.readFileSync(file, "utf8"));
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas; const samples = profile.samples;
const counts = new Map();
for (let i = 0; i < samples.length; i++) counts.set(samples[i], (counts.get(samples[i]) || 0) + (dt[i] || 0));
for (const [id, us] of counts) { const n = byId.get(id); const key = `${n.callFrame.functionName || "(anon)"} ${n.callFrame.url.split("/src/")[1] || n.callFrame.url}:${n.callFrame.lineNumber}`; self.set(key, (self.get(key) || 0) + us); }
const total = [...self.values()].reduce((a, b) => a + b, 0);
console.log(`total ${(total/1e6).toFixed(1)} s`);
for (const [k, v] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${(v/1e3).toFixed(0).padStart(7)} ms ${(100*v/total).toFixed(1).padStart(5)}%  ${k}`);
