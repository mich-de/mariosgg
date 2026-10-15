#!/usr/bin/env python3
"""Flatten a Borland C++ (VROOMM / FBOV) overlaid DOS MZ executable into a plain, analysis-friendly MZ.

Overlay format (recovered from mario.exe; every assertion below was validated against it):

  MZ load module [hdr .. modend)
  at modend:  'FBOV' u32 ovrsize u32 segtab_file_off u32 segcount   (16 bytes, then overlay data)

  segment table (at segtab_file_off), segcount records of 8 bytes: u16 para, u16 size, u16 kind, u16 lowofs
      kind 0 data, 1 code, 3 overlay-stub, 4 stack/bss/special
      the segment occupies [para*16 + lowofs, para*16 + lowofs + size); far pointers use frame=para,
      offset = lowofs + local offset
  overlay stub segment (kind 3, at para*16 in the load module):
      +00 CD 3F  INT 3Fh signature | +02 u16 0 | +04 u32 file offset of overlay data | +08 u16 code size
      +0A u16 relocation table size in bytes | +0C u16 entry count | +0E..+1F zero
      +20 entry_count * 5 bytes: CD 3F <u16 entry offset inside overlay code> 00
  overlay data at (modend + 16 + fileofs): code[code size] then reloc table (u16 offsets)
  each relocated word in overlay code holds (segment table index * 8); the real paragraph is table[idx].para

Output layout: every frame (distinct segment-table paragraph, plus every overlay) is copied to its own
paragraph-aligned slot that never straddles a 64 KiB linear boundary (Ghidra's 16-bit real-mode near
branch resolution is wrong for code segments that straddle such a boundary).  All segment words listed in
the original MZ relocation table and in the overlay relocation tables are rewritten, thunks of the
overlay stubs are replaced by JMP FAR into the overlay copy.
"""
import json
import struct
import sys


def parse_mz(d):
    sig, cblp, cp, crlc, cparhdr, minalloc, maxalloc, ss, sp, csum, ip, cs, lfarlc, ovno = struct.unpack_from("<2s13H", d, 0)
    assert sig == b"MZ"
    hdr = cparhdr * 16
    modend = (cp - 1) * 512 + (cblp or 512)
    relocs = [struct.unpack_from("<HH", d, lfarlc + 4 * i) for i in range(crlc)]
    return dict(hdr=hdr, modend=modend, relocs=relocs, minalloc=minalloc, maxalloc=maxalloc, ss=ss, sp=sp, ip=ip, cs=cs)


class Frame:
    def __init__(self, a, length, kind, tag):
        self.a = a
        self.len = length
        self.kind = kind
        self.tag = tag
        self.base = None
        self.data = None


def main(src, dst, mapout):
    d = open(src, "rb").read()
    mz = parse_mz(d)
    hdr, modend = mz["hdr"], mz["modend"]
    mod = d[hdr:modend]
    assert d[modend:modend + 4] == b"FBOV", "no FBOV overlay header"
    ovrsize, segtab_off, segcount = struct.unpack_from("<III", d, modend + 4)
    ovbase = modend + 0x10
    assert ovbase + ovrsize == len(d)
    tab = [struct.unpack_from("<4H", d, segtab_off + 8 * i) for i in range(segcount)]
    for para, size, kind, low in tab:
        assert kind in (0, 1, 3, 4)

    # overlay descriptors
    stubs = {}
    for i, (para, size, kind, low) in enumerate(tab):
        if kind != 3:
            continue
        p = para * 16
        w = struct.unpack_from("<8H", mod, p)
        assert w[0] == 0x3FCD and w[1] == 0 and w[7] == 0, (i, w)
        assert not any(mod[p + 0x10:p + 0x20])
        fofs, codesz, relsz, nent = w[2] | (w[3] << 16), w[4], w[5], w[6]
        assert size == 0x20 + 5 * nent, (i, size, nent)
        stubs[i] = dict(para=para, fofs=fofs, code=codesz, rel=relsz, ent=nent)
    order = sorted(stubs, key=lambda i: stubs[i]["fofs"])
    pos = 0
    for i in order:
        s = stubs[i]
        assert s["fofs"] >= pos
        pos = s["fofs"] + s["code"] + s["rel"]
    assert pos <= ovrsize

    # frames of the main module
    dgroup = None
    for para, size, kind, low in tab:
        if kind == 0 and size > 0x8000:
            dgroup = (para, size)
    assert dgroup is not None
    dg_a, dg_len = dgroup
    modparas = (len(mod) + 15) // 16
    starts = sorted(set(para for para, size, kind, low in tab if not (kind == 4 and dg_a <= para < modparas)))
    frames = {}
    for para, size, kind, low in tab:
        if kind == 4 and dg_a <= para < modparas:
            continue
        if kind == 3:
            length = size
        elif size == 0xFFFF:
            nxt = [s for s in starts if s > para]
            length = (nxt[0] if nxt else modparas) * 16 - para * 16
        else:
            length = low + size
        f = frames.get(para)
        if f is None or length > f.len:
            frames[para] = Frame(para, length, kind, "tab")
    for f in frames.values():
        f.data = bytearray(mod[f.a * 16:f.a * 16 + f.len])
        f.data.extend(b"\0" * (f.len - len(f.data)))

    # overlay frames
    ovl_frames = {}
    for i in order:
        s = stubs[i]
        code = bytearray(d[ovbase + s["fofs"]: ovbase + s["fofs"] + s["code"]])
        fr = Frame(None, len(code), 1, "ovl%d" % i)
        fr.data = code
        ovl_frames[i] = fr

    # slot allocation: never straddle a 64 KiB linear boundary
    all_frames = sorted(frames.values(), key=lambda f: f.a) + [ovl_frames[i] for i in order]
    cur = 0
    for f in all_frames:
        paras = (f.len + 15) // 16
        assert f.len <= 0xFFFF
        if ((cur * 16) & 0xFFFF) + f.len > 0x10000:
            cur = (cur + 0xFFF) // 0x1000 * 0x1000
        f.base = cur
        cur += paras
    total_paras = cur

    cover = sorted(frames.values(), key=lambda f: f.a)

    def map_seg(v):
        exact = frames.get(v)
        if exact:
            return exact.base
        best = None
        for f in cover:
            if f.a <= v and v * 16 < f.a * 16 + max(f.len, 1):
                best = f
        if best is None:
            return None
        return best.base + (v - best.a)

    out = bytearray(total_paras * 16)
    for f in all_frames:
        out[f.base * 16:f.base * 16 + f.len] = f.data

    newrel = []
    unmapped = []

    def put_word(lin, val):
        struct.pack_into("<H", out, lin, val)

    # main-module relocations
    covering_cache = {}
    skipped_loc = 0
    for (off, seg) in mz["relocs"]:
        L = seg * 16 + off
        v = struct.unpack_from("<H", mod, L)[0]
        nv = map_seg(v)
        hit = False
        for f in cover:
            if f.a * 16 <= L < f.a * 16 + f.len:
                hit = True
                loc = f.base * 16 + (L - f.a * 16)
                if nv is None:
                    unmapped.append((hex(L), hex(v)))
                    continue
                put_word(loc, nv)
                newrel.append(loc)
        if not hit:
            skipped_loc += 1

    # overlay relocations
    nfix = 0
    for i in order:
        s = stubs[i]
        fr = ovl_frames[i]
        relb = d[ovbase + s["fofs"] + s["code"]: ovbase + s["fofs"] + s["code"] + s["rel"]]
        offs = struct.unpack("<%dH" % (s["rel"] // 2), relb)
        assert len(set(offs)) == len(offs)
        for o in offs:
            assert o + 2 <= fr.len
            v = struct.unpack_from("<H", fr.data, o)[0]
            assert v % 8 == 0 and v // 8 < segcount, (i, hex(o), hex(v))
            nv = map_seg(tab[v // 8][0])
            assert nv is not None
            loc = fr.base * 16 + o
            put_word(loc, nv)
            newrel.append(loc)
            nfix += 1
        s["base"] = fr.base

    # thunks: JMP FAR into overlay copy
    thunks = []
    for i in order:
        s = stubs[i]
        sf = frames[s["para"]]
        for t in range(s["ent"]):
            a = sf.base * 16 + 0x20 + 5 * t
            assert out[a:a + 2] == b"\xcd\x3f" and out[a + 4] == 0, (i, t)
            off = struct.unpack_from("<H", out, a + 2)[0]
            assert off < s["code"], (i, t, off)
            out[a:a + 5] = b"\xea" + struct.pack("<HH", off, s["base"])
            newrel.append(a + 3)
            thunks.append(dict(stub=i, thunk=t, thunk_seg=sf.base, thunk_off=0x20 + 5 * t, target_seg=s["base"], target_off=off))

    allrel = sorted(set(newrel))
    pairs = [(lin & 0xF, lin >> 4) for lin in allrel]
    lfarlc = 0x40
    hdr_bytes = lfarlc + 4 * len(pairs)
    hdr_paras = (hdr_bytes + 511) // 512 * 32
    total = hdr_paras * 16 + len(out)
    head = bytearray(hdr_paras * 16)
    cp = (total + 511) // 512
    cblp = total % 512
    new_ss = map_seg(mz["ss"])
    new_cs = map_seg(mz["cs"])
    assert new_ss is not None and new_cs is not None
    struct.pack_into("<2s13H", head, 0, b"MZ", cblp, cp, len(pairs), hdr_paras, 0, 0xFFFF, new_ss, mz["sp"], 0, mz["ip"], new_cs, lfarlc, 0)
    for k, (o, sg) in enumerate(pairs):
        struct.pack_into("<HH", head, lfarlc + 4 * k, o, sg)
    open(dst, "wb").write(bytes(head) + bytes(out))

    meta = dict(
        source=src,
        load_module_paragraphs=total_paras,
        entry=dict(cs=new_cs, ip=mz["ip"], ss=new_ss, sp=mz["sp"]),
        frames=[dict(orig_para=f.a, new_base=f.base, length=f.len, kind=f.kind) for f in sorted(frames.values(), key=lambda f: f.a)],
        segment_table=[dict(index=i, para=p, size=sz, kind=k, lowofs=lo) for i, (p, sz, k, lo) in enumerate(tab)],
        overlays=[dict(table_index=i, stub_para=stubs[i]["para"], stub_new_base=frames[stubs[i]["para"]].base, fofs=stubs[i]["fofs"],
                       code=stubs[i]["code"], relocs=stubs[i]["rel"] // 2, entries=stubs[i]["ent"], new_segment=stubs[i]["base"]) for i in order],
        thunks=thunks,
    )
    json.dump(meta, open(mapout, "w"), indent=1)
    print("frames: %d  overlays: %d  overlay fixups: %d  thunks: %d  main relocs: %d (%d unmapped, %d outside frames)  total relocs: %d" % (
        len(frames), len(order), nfix, len(thunks), len(mz["relocs"]), len(unmapped), skipped_loc, len(pairs)))
    print("unified module: %d paragraphs -> %s (%d bytes)" % (total_paras, dst, len(head) + len(out)))
    if unmapped:
        print("UNMAPPED:", unmapped[:20])


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3])
