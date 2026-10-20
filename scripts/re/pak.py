import struct
def decode_rle(p, src, w, h):
    out = bytearray(b"\xff" * (w * h))
    row = 0; cur = 0; stack = []
    n = len(out)
    while True:
        c = p[src]; src += 1
        if c & 0x80:
            row += w; cur = row
        cnt = c & 0x1f
        if cnt == 0:
            cnt = (p[src] << 8) | p[src+1]; src += 2
        if c & 0x40:
            if c & 0x20:
                for i in range(cnt):
                    if 0 <= cur < n: out[cur] = p[src]
                    cur += 1; src += 1
            else:
                if cnt == 1: break
                v = p[src]; src += 1
                for i in range(cnt):
                    if 0 <= cur < n: out[cur] = v
                    cur += 1
        elif c & 0x20:
            cur += cnt
        elif cnt > 1:
            stack.append([src, cnt - 1])
        else:
            if not stack: break
            if stack[-1][1] > 0:
                stack[-1][1] -= 1; src = stack[-1][0]
            else:
                stack.pop()
    return out, src
def decode(p):
    ver, n, unk = struct.unpack_from("<3H", p, 0)
    offs = [struct.unpack_from("<I", p, 6 + 4*i)[0] for i in range(n)]
    frames = []
    for i, o in enumerate(offs):
        if ver & 0x8000:
            x, y, w, h = struct.unpack_from(">4H", p, o)
            # some fonts store signed offsets
            x = x - 0x10000 if x & 0x8000 else x
            y = y - 0x10000 if y & 0x8000 else y
            bg = None; ds = o + 8
        else:
            w, h = struct.unpack_from(">2H", p, o); bg = None; x = y = 0; ds = o + 4
        if w == 0 or h == 0:
            frames.append(dict(x=x, y=y, w=w, h=h, bg=bg, px=b"", end=ds, off=o)); continue
        px, end = decode_rle(p, ds, w, h)
        frames.append(dict(x=x, y=y, w=w, h=h, bg=bg, px=bytes(px), end=end, off=o))
    return dict(ver=ver, n=n, unk=unk, frames=frames)
