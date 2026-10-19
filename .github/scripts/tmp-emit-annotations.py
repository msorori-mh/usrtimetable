"""Temporary CI diagnostics: re-emit a command log as GitHub annotations.

Usage: python3 tmp-emit-annotations.py <log> <part>   (part 1 or 2)
Job logs are not readable from the remediation session, annotations are.
Part 1 emits chunks 0-29 (10 error, 10 warning, 10 notice); part 2 emits 30-49.
"""
import re
import sys

CHUNK = 3800
path, part = sys.argv[1], int(sys.argv[2])
text = open(path, encoding="utf-8", errors="replace").read()
text = re.sub(r"\x1b\[[0-9;]*m", "", text)
if "--tsc" in sys.argv:
    text = "\n".join(l for l in text.splitlines() if "error TS" in l or l.startswith(" "))
if len(text) > CHUNK * 50:
    text = text[-CHUNK * 50:]
chunks = [text[i:i + CHUNK] for i in range(0, len(text), CHUNK)] or ["(empty log)"]
levels = ["error"] * 10 + ["warning"] * 10 + ["notice"] * 10
start, stop = (0, 30) if part == 1 else (30, 50)
for idx in range(start, min(stop, len(chunks))):
    level = levels[(idx - start) % 30] if part == 1 else (["error"] * 10 + ["warning"] * 10)[idx - start]
    body = chunks[idx].replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    print(f"::{level} title=chunk {idx:02d} of {len(chunks)}::{body}")
