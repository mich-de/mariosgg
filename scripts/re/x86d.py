import json, os, struct, sys
from capstone import Cs, CS_ARCH_X86, CS_MODE_16
EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "analysis", "mario_unified.exe")
d = open(EXE, 'rb').read()
hdr = struct.unpack_from('<H', d, 8)[0] * 16
mod = d[hdr:]
BASE = 0x1000
md = Cs(CS_ARCH_X86, CS_MODE_16)
md.detail = False
def lin(seg, off): return (seg - BASE) * 16 + off
def dis(seg, off, n=200, stop_ret=True):
    a = lin(seg, off)
    code = mod[a:a + 0x4000]
    out = []
    for ins in md.disasm(code, off):
        out.append(f"{seg:04x}:{ins.address:04x}  {ins.bytes.hex():<14} {ins.mnemonic} {ins.op_str}")
        n -= 1
        if n <= 0: break
        if stop_ret and ins.mnemonic in ('retf', 'ret', 'iret') : 
            pass
    return '\n'.join(out)
if __name__ == '__main__':
    seg, off = sys.argv[1].split(':')
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 120
    print(dis(int(seg, 16), int(off, 16), n))
