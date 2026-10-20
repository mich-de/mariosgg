# Linear-sweep listing of every code frame of the unified (overlay-free) mario.exe.
import json, os, struct, sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_16
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "analysis", "")
d = open(ROOT + 'mario_unified.exe', 'rb').read()
hdr = struct.unpack_from('<H', d, 8)[0] * 16
mod = d[hdr:]
meta = json.load(open(ROOT + 'mario_overlay_map.json'))
md = Cs(CS_ARCH_X86, CS_MODE_16)
frames = []
for f in meta['frames']:
    if f['kind'] == 1: frames.append((f['new_base'], f['length'], 'main@%x' % f['orig_para']))
for o in meta['overlays']:
    frames.append((o['new_segment'], o['code'], 'ovl%d' % o['table_index']))
frames.sort()
out = open(sys.argv[1], 'w')
for base, ln, tag in frames:
    seg = 0x1000 + base
    out.write(f';;;; frame {seg:04x} len {ln:#x} {tag}\n')
    code = mod[base*16: base*16 + ln]
    off = 0
    while off < ln:
        got = False
        for ins in md.disasm(code[off:], off):
            out.write(f"{seg:04x}:{ins.address:04x} {ins.bytes.hex():<16} {ins.mnemonic} {ins.op_str}\n")
            off = ins.address + ins.size
            got = True
        if off < ln:
            out.write(f"{seg:04x}:{off:04x} {code[off]:02x}               db\n")
            off += 1
out.close()
