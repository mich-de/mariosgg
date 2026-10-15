# Print one function from a pseudo-code file: fn.py p_XXXX.txt <hexaddr> [--calls]
import re, sys
path, addr = sys.argv[1], int(sys.argv[2], 16)
calls_only = "--calls" in sys.argv
lines = open(path).read().split("\n")
def off(l):
    m = re.match(r"\s+([0-9a-f]{4})\s", l)
    return int(m.group(1), 16) if m else None
# start: first line whose offset >= addr (include a preceding push(bp) line)
start = None
for i, l in enumerate(lines):
    o = off(l)
    if o is not None and o >= addr:
        start = i
        break
s = start
while s > 0 and not lines[s - 1].strip().endswith("retf") and off(lines[s - 1]) is None:
    s -= 1
out = []
for l in lines[s:]:
    out.append(l)
    if l.strip().endswith("retf") or re.search(r"\sretf\s*$", l):
        break
for l in out:
    if calls_only and not re.search(r"CALL|push\(0x|= 0x", l):
        continue
    print(l)
