"""Temporary CI diagnostics: emit shard N of gzip+base64(file) as annotations.

Usage: python3 tmp-emit-annotations.py <file> <shard> <part>
Annotation text is whitespace-trimmed, so the payload is gzip+base64 encoded.
"""
import base64
import gzip
import sys

CHUNK = 4000
path, shard, part = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
data = base64.b64encode(gzip.compress(open(path, "rb").read(), 9)).decode()
chunks = [data[i:i + CHUNK] for i in range(0, len(data), CHUNK)] or ["-"]
base = shard * 50
idxs = range(base, base + 30) if part == 1 else range(base + 30, base + 50)
levels = (["error"] * 10 + ["warning"] * 10 + ["notice"] * 10) if part == 1 else (["error"] * 10 + ["warning"] * 10)
for k, idx in enumerate(idxs):
    if idx >= len(chunks):
        break
    print(f"::{levels[k]} title=chunk {idx:03d} of {len(chunks)} len {len(chunks[idx])}::{chunks[idx]}")
