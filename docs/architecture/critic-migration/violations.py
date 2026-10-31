import json, sys, collections
edges = json.load(open(sys.argv[1]))
pkg = {"shared":"kernel","content":"catalog","world":"world","generation":"generation","simulation":"simulation",
"workers":"app","models":"models","rendering":"engine","game":"engine","audio":"audio","design":"interface",
"features":"interface","app":"interface","main.tsx":"app","privacy.tsx":"app"}
allowed = {"kernel":set(),"catalog":{"kernel"},"world":{"kernel","catalog"},"generation":{"world","catalog","kernel"},
"simulation":{"world","catalog","kernel"},"models":{"catalog","kernel"},
"engine":{"world","models","catalog","kernel"},"audio":{"engine","models","catalog","kernel"},
"interface":{"engine","audio","catalog","kernel"},"app":None}
def top(p):
    return p.split("/")[0]
v = collections.Counter(); ex = collections.defaultdict(list)
for e in edges:
    s, t = pkg.get(top(e["source"])), pkg.get(top(e["target"]))
    if s is None or t is None or s == t: continue
    if allowed[s] is None or t in allowed[s]: continue
    key = (s, t, "test" if e["test"] else "prod", "type" if e["typeOnly"] else "value")
    v[key] += 1
    if len(ex[key]) < 3: ex[key].append(f'{e["source"]} -> {e["target"]}')
for k, n in sorted(v.items(), key=lambda x: -x[1]):
    print(n, k, ex[k])
print("total", sum(v.values()))
