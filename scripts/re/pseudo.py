# Compact pseudo-code view of the annotated listing: folds push sequences into call argument
# lists (cdecl: first pushed = last arg), turns simple movs into assignments, marks jump targets.
import re, sys

def load(path):
    frames = {}
    cur = None
    for line in open(path):
        line = line.rstrip('\n')
        if line.startswith(';;;; frame'):
            cur = line.split()[2]
            frames[cur] = []
            continue
        if cur is None:
            continue
        m = re.match(r'([0-9a-f]{4}):([0-9a-f]{4}) (\S+)\s+(.*)$', line)
        if not m:
            continue
        seg, off, hx, rest = m.groups()
        frames[cur].append((int(off, 16), hx, rest))
    return frames

def fmt_op(op):
    op = op.replace('word ptr ', '').replace('byte ptr ', 'b').replace('dword ptr ', 'd')
    return op

def pseudo(insns, lo=0, hi=1 << 20):
    targets = set()
    for off, hx, rest in insns:
        m = re.match(r'(j\w+|call|loop\w*) (0x[0-9a-f]+)$', rest.split(';')[0].strip())
        if m:
            targets.add(int(m.group(2), 16))
    out = []
    pend = []  # pending push operands (text)
    i = 0
    n = len(insns)
    while i < n:
        off, hx, rest = insns[i]
        if off < lo or off >= hi:
            i += 1
            continue
        code = rest.split(';')[0].strip()
        com = rest.split(';', 1)[1].strip() if ';' in rest else ''
        if off in targets:
            if pend:
                out.append('    ' + ' '.join('push(%s)' % p for p in pend))
                pend = []
            out.append('L_%04x:' % off)
        mnem = code.split(' ')[0]
        ops = code[len(mnem):].strip()
        if mnem == 'push':
            if ops == 'cs' and i + 1 < n and 'call' in insns[i + 1][2]:
                i += 1
                continue
            pend.append(fmt_op(ops))
            i += 1
            continue
        if mnem == 'nop':
            i += 1
            continue
        if mnem == 'lea' and i + 1 < n and insns[i + 1][2].startswith('push ax'):
            # lea ax,[bp-x]; push ax  -> &local
            m = re.match(r'ax, \[(.*)\]', ops)
            if m:
                if pend and pend[-1] == 'ss':
                    pend.pop()
                pend.append('&[' + m.group(1) + ']')
                i += 2
                continue
        if mnem in ('lcall', 'call'):
            # number of args from following 'add sp, N' or 'pop cx'
            nargs = 0
            j = i + 1
            if j < n:
                nc = insns[j][2].split(';')[0].strip()
                m = re.match(r'add sp, (0x[0-9a-f]+|\d+)$', nc)
                if m:
                    nargs = int(m.group(1), 0) // 2
                    j += 1
                elif nc == 'pop cx':
                    nargs = 1
                    j += 1
                    if j < n and insns[j][2].split(';')[0].strip() == 'pop cx':
                        nargs = 2
                        j += 1
            args = list(reversed(pend[-nargs:])) if nargs else []
            if nargs:
                pend = pend[:-nargs] if nargs <= len(pend) else []
            if pend:
                out.append('    ' + ' '.join('push(%s)' % p for p in pend))
                pend = []
            name = com if com else ops
            name = re.sub(r'^[=>]*', '', name)
            out.append('    %04x  CALL %s(%s)' % (off, name, ', '.join(args)))
            i = j
            continue
        if pend:
            out.append('    ' + ' '.join('push(%s)' % p for p in pend))
            pend = []
        if mnem == 'mov':
            a, b = [x.strip() for x in ops.split(',', 1)]
            out.append('    %04x  %s = %s%s' % (off, fmt_op(a), fmt_op(b), ('   ; ' + com) if com else ''))
        elif mnem in ('add', 'sub', 'and', 'or', 'xor', 'shl', 'sar', 'shr', 'imul') and ',' in ops:
            a, b = [x.strip() for x in ops.split(',', 1)]
            sym = {'add': '+=', 'sub': '-=', 'and': '&=', 'or': '|=', 'xor': '^=', 'shl': '<<=', 'sar': '>>=', 'shr': '>>>=', 'imul': '*='}[mnem]
            if mnem == 'xor' and a == b:
                out.append('    %04x  %s = 0' % (off, a))
            elif mnem == 'or' and a == b:
                out.append('    %04x  test %s' % (off, a))
            else:
                out.append('    %04x  %s %s %s' % (off, fmt_op(a), sym, fmt_op(b)))
        elif mnem in ('inc', 'dec'):
            out.append('    %04x  %s%s' % (off, fmt_op(ops), '++' if mnem == 'inc' else '--'))
        elif mnem in ('push', 'pop') or mnem in ('enter', 'leave') or code in ('mov bp, sp',):
            pass
        else:
            out.append('    %04x  %s %s%s' % (off, mnem, fmt_op(ops), ('   ; ' + com) if com else ''))
        i += 1
    return out

if __name__ == '__main__':
    fr = load(sys.argv[1])
    seg = sys.argv[2]
    lo = int(sys.argv[3], 16) if len(sys.argv) > 3 else 0
    hi = int(sys.argv[4], 16) if len(sys.argv) > 4 else 1 << 20
    print('\n'.join(pseudo(fr[seg], lo, hi)))
