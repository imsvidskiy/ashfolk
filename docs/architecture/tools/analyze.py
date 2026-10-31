import json
import sys
from collections import Counter, defaultdict

edges = json.load(open(sys.argv[1]))
mode = sys.argv[2]


def top(path):
    parts = path.split("/")
    if len(parts) == 1:
        return "(root)"
    return parts[0]


def feature(path):
    parts = path.split("/")
    if parts[0] == "features" and len(parts) > 2:
        return parts[1]
    return None


def second(path):
    parts = path.split("/")
    if len(parts) <= 2:
        return parts[0]
    return parts[0] + "/" + parts[1]


def scc(nodes, graph):
    index = {}
    low = {}
    stack = []
    on = set()
    result = []
    counter = [0]

    def visit(node):
        index[node] = low[node] = counter[0]
        counter[0] += 1
        stack.append(node)
        on.add(node)
        for target in graph[node]:
            if target not in index:
                visit(target)
                low[node] = min(low[node], low[target])
            elif target in on:
                low[node] = min(low[node], index[target])
        if low[node] == index[node]:
            component = []
            while True:
                item = stack.pop()
                on.discard(item)
                component.append(item)
                if item == node:
                    break
            result.append(component)

    sys.setrecursionlimit(100000)
    for node in nodes:
        if node not in index:
            visit(node)
    return [component for component in result if len(component) > 1]


production = [edge for edge in edges if not edge["test"]]

if mode == "top":
    for label, subset in (("production", production), ("production value-only", [e for e in production if not e["typeOnly"]]), ("tests", [e for e in edges if e["test"]])):
        counts = Counter()
        for edge in subset:
            a, b = top(edge["source"]), top(edge["target"])
            if a != b:
                counts[(a, b)] += 1
        names = sorted({a for a, _ in counts} | {b for _, b in counts})
        print("##", label)
        print("from\\to," + ",".join(names))
        for a in names:
            print(a + "," + ",".join(str(counts.get((a, b), "")) for b in names))
        graph = defaultdict(set)
        for (a, b) in counts:
            graph[a].add(b)
        print("SCC:", scc(names, graph))
        print()

if mode == "features":
    counts = Counter()
    for edge in production:
        a = feature(edge["source"])
        if not a:
            continue
        b = feature(edge["target"])
        t = top(edge["target"])
        target = "f:" + b if b else t
        if b == a:
            continue
        counts[(a, target)] += 1
    rows = sorted({a for a, _ in counts})
    cols = sorted({b for _, b in counts})
    print("from\\to," + ",".join(cols))
    for a in rows:
        print(a + "," + ",".join(str(counts.get((a, b), "")) for b in cols))
    graph = defaultdict(set)
    for (a, b) in counts:
        if b.startswith("f:"):
            graph[a].add(b[2:])
    print("SCC:", scc(rows, graph))

if mode == "second":
    counts = Counter()
    for edge in production:
        a, b = second(edge["source"]), second(edge["target"])
        if a != b:
            counts[(a, b)] += 1
    graph = defaultdict(set)
    for (a, b) in counts:
        graph[a].add(b)
    nodes = sorted({a for a, _ in counts} | {b for _, b in counts})
    for component in scc(nodes, graph):
        print("SCC", len(component), sorted(component))
        inside = set(component)
        for (a, b), n in sorted(counts.items()):
            if a in inside and b in inside and top(a) != top(b):
                print("   ", a, "->", b, n)

if mode == "files":
    graph = defaultdict(set)
    nodes = set()
    for edge in production:
        if edge["typeOnly"]:
            continue
        graph[edge["source"]].add(edge["target"])
        nodes.add(edge["source"])
        nodes.add(edge["target"])
    for component in scc(sorted(nodes), graph):
        print("FILE SCC", len(component), sorted(component))

if mode == "list":
    a_filter, b_filter = sys.argv[3], sys.argv[4]
    for edge in production:
        if edge["source"].startswith(a_filter) and edge["target"].startswith(b_filter):
            print(edge["source"] + ":" + str(edge["line"]), "->", edge["target"], "type" if edge["typeOnly"] else "")
