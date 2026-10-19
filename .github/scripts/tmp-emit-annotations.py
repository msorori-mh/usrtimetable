"""Temporary CI diagnostics: emit shard N (50 chunks) of a file as annotations.

Usage: python3 tmp-emit-annotations.py <file> <shard> <part>  (part 1: chunks 0-29, part 2: 30-49)
"""
import sys

CHUNK = 3800
path, shard, part = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
text = open(path, encoding="utf-8", errors="replace").read()
chunks = [text[i:i + CHUNK] for i in range(0, len(text), CHUNK)] or ["(empty)"]
base = shard * 50
idxs = range(base, base + 30) if part == 1 else range(base + 30, base + 50)
levels = (["error"] * 10 + ["warning"] * 10 + ["notice"] * 10) if part == 1 else (["error"] * 10 + ["warning"] * 10)
for k, idx in enumerate(idxs):
    if idx >= len(chunks):
        break
    body = chunks[idx].replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::{levels[k]} title=chunk {idx:03d} of {len(chunks)}::{body}")
