const root = process.argv[2];
const text = await Bun.file(`${root}/bun.lock`).text();
const lock = Bun.JSONC ? Bun.JSONC.parse(text) : JSON.parse(text.replace(/,(\s*[}\]])/g, "$1"));
const pkg = await Bun.file(`${root}/package.json`).json();
const packages = lock.packages;
function depsOf(name) {
  const entry = packages[name];
  if (!entry) return [];
  const meta = entry.find((x) => typeof x === "object" && x !== null && !Array.isArray(x)) ?? {};
  return [...Object.keys(meta.dependencies ?? {}), ...Object.keys(meta.peerDependencies ?? {}).filter(() => false)];
}
function closure(starts) {
  const seen = new Set();
  const stack = [...starts];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    for (const d of depsOf(n)) stack.push(d);
  }
  return seen;
}
const runtime = Object.keys(pkg.dependencies);
const all = closure(runtime);
const md = closure(["react-markdown", "remark-gfm"]);
const rest = closure(runtime.filter((n) => n !== "react-markdown" && n !== "remark-gfm"));
const onlyMd = [...md].filter((n) => !rest.has(n));
console.log({ runtimeClosure: all.size, mdClosure: md.size, onlyMd: onlyMd.length, rest: rest.size });
