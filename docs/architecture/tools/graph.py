import json
import os
import re
import sys
from collections import defaultdict

ROOT = sys.argv[1]
SRC = os.path.join(ROOT, "src")

STATEMENT = re.compile(r'^(import|export)\s+([^;"]*?)\bfrom\s+"([^"]+)"', re.M)
SIDE_EFFECT = re.compile(r'^import\s+"([^"]+)"', re.M)
DYNAMIC = re.compile(r'import\(\s*"([^"]+)"\s*\)')
URL = re.compile(r'new URL\(\s*"([^"]+)",\s*import\.meta\.url')


def is_type_only(body):
    body = body.strip()
    if body.startswith("type ") or body.startswith("type{"):
        return True
    match = re.search(r"\{([^}]*)\}", body)
    if match and not re.sub(r"\{[^}]*\}", "", body).strip(" ,"):
        names = [name.strip() for name in match.group(1).split(",") if name.strip()]
        return bool(names) and all(name.startswith("type ") for name in names)
    return False


def files():
    for directory, _, names in os.walk(SRC):
        for name in names:
            if name.endswith((".ts", ".tsx")) and not name.endswith(".d.ts"):
                yield os.path.join(directory, name)


def is_test(path):
    return ".test." in path or "/testing/" in path


def resolve(source, specifier):
    if not specifier.startswith("."):
        return None
    specifier = specifier.split("?")[0]
    target = os.path.normpath(os.path.join(os.path.dirname(source), specifier))
    return target


edges = []
for path in files():
    text = open(path, encoding="utf-8").read()
    for match in STATEMENT.finditer(text):
        line = text.count("\n", 0, match.start()) + 1
        target = resolve(path, match.group(3))
        if target:
            edges.append((path, target, is_type_only(match.group(2)), line, "static"))
    for match in SIDE_EFFECT.finditer(text):
        line = text.count("\n", 0, match.start()) + 1
        target = resolve(path, match.group(1))
        if target:
            edges.append((path, target, False, line, "side"))
    for match in DYNAMIC.finditer(text):
        line = text.count("\n", 0, match.start()) + 1
        target = resolve(path, match.group(1))
        if target:
            edges.append((path, target, False, line, "dynamic"))
    for match in URL.finditer(text):
        target = resolve(path, match.group(1))
        if target and target.endswith((".ts", ".tsx")):
            line = text.count("\n", 0, match.start()) + 1
            edges.append((path, target, False, line, "worker"))

out = []
for source, target, type_only, line, kind in edges:
    out.append(
        {
            "source": os.path.relpath(source, SRC),
            "target": os.path.relpath(target, SRC),
            "typeOnly": type_only,
            "line": line,
            "kind": kind,
            "test": is_test(source),
        }
    )
json.dump(out, open(sys.argv[2], "w"), indent=0)
print(len(out), "edges")
