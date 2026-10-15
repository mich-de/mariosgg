# Annotate the listing: far-call names, DGROUP string refs.
import re, struct, sys, json, os
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "analysis", "")
d = open(ROOT + 'mario_unified.exe', 'rb').read()
hdr = struct.unpack_from('<H', d, 8)[0] * 16
mod = d[hdr:]
DG = mod[0x40000:0x50000]
NAMES = {}
META = json.load(open(ROOT + 'mario_overlay_map.json'))
THUNK = {}
for t in META['thunks']:
    THUNK[(t['thunk_seg'] + 0x1000, t['thunk_off'])] = (t['target_seg'] + 0x1000, t['target_off'])
nf = os.path.join(os.path.dirname(__file__), 'names.txt')
if os.path.exists(nf):
    for line in open(nf):
        line = line.split('#')[0].strip()
        if not line: continue
        a, n = line.split(None, 1)
        NAMES[a.lower()] = n.strip()
def dstr(off):
    if off >= len(DG): return None
    e = DG.find(b'\0', off)
    if e < 0 or e - off < 2 or e - off > 200: return None
    s = DG[off:e]
    if all(32 <= c < 127 or c in (9, 10, 13) for c in s):
        if off > 0 and 32 <= DG[off-1] < 127: return None  # mid-string
        return s.decode('latin1')
    return None
# capstone prints small segments in decimal ("lcall 0, 0x1300": the C runtime at 1000)
pat_call = re.compile(r'lcall (0x[0-9a-f]+|\d+), (0x[0-9a-f]+|\d+)')
pat_push = re.compile(r'(push|mov \w+,) (0x[0-9a-f]+)$')
def annotate(line):
    m = pat_call.search(line)
    if m:
        seg = int(m.group(1), 0) + 0x1000
        off = int(m.group(2), 0)
        tgt = THUNK.get((seg, off))
        if tgt:
            seg, off = tgt
        key = f'{seg:04x}:{off:04x}'
        n = NAMES.get(key)
        line = line.rstrip() + f'   ; {"=>" if tgt else ""}{key}' + (f' {n}' if n else '')
        return line
    m = re.search(r'call (0x[0-9a-f]+)$', line)
    if m and 'lcall' not in line:
        seg = line.split(':')[0]
        key = f'{seg}:{int(m.group(1),16):04x}'
        n = NAMES.get(key)
        if n: line = line.rstrip() + f'   ; {n}'
        return line
    m = pat_push.search(line.rstrip())
    if m:
        v = int(m.group(2), 16)
        s = dstr(v) if v >= 0x100 else None
        if s: line = line.rstrip() + f'   ; "{s[:60]}"'
    return line
if __name__ == '__main__':
    src, dst = sys.argv[1], sys.argv[2]
    with open(dst, 'w') as o:
        for line in open(src):
            o.write(annotate(line.rstrip('\n')) + '\n')
