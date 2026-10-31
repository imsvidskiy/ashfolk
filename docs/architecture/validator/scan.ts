const t = new Bun.Transpiler({ loader: "ts" });
const code = `import a from "./a.ts"; import type { B } from "./b.ts"; const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" }); const s = new URL("./sound.webm", import.meta.url).href; const d = import("./d.ts"); import md from "./p.md?raw";`;
console.log(t.scanImports(code));
console.log(t.scan(code).imports);
