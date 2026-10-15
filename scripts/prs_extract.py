#!/usr/bin/env python3
"""Split mario.prs into raw per-resource payload files and write an index.

PRS container (validated 1806/1806 against mario.prd, file consumed exactly):
  0x00  "PRS Format Resource File\\r\\n" + zero pad + 0x1A     (0x30 bytes)
  0x30  repeated record:
          +0x00 char[4]  type tag, NUL terminated  (Ply MuV SND Pak Img XMI DIB)
          +0x04 u16      resource id
          +0x06 char[18] name, NUL padded
          +0x18 u32      record length including this 28 byte header
          +0x1C payload  (length - 0x1C bytes)
"""
import os
import struct
import sys

HEADER = 0x1C


def parse(path):
    d = open(path, "rb").read()
    assert d.startswith(b"PRS Format Resource File\r\n"), "bad PRS magic"
    pos = 0x30
    out = []
    while pos < len(d):
        tag = d[pos:pos + 4]
        assert tag[3] == 0 and tag[:3].isalpha(), (hex(pos), tag)
        rid = struct.unpack_from("<H", d, pos + 4)[0]
        name = d[pos + 6:pos + 0x18].split(b"\0")[0].decode("latin1")
        ln = struct.unpack_from("<I", d, pos + 0x18)[0]
        assert ln >= HEADER and pos + ln <= len(d), (hex(pos), ln)
        out.append(dict(offset=pos, tag=tag[:3].decode(), id=rid, name=name, length=ln, payload=d[pos + HEADER:pos + ln]))
        pos += ln
    assert pos == len(d)
    return out


def main(prs, outdir):
    res = parse(prs)
    os.makedirs(outdir, exist_ok=True)
    with open(os.path.join(outdir, "index.tsv"), "w") as idx:
        idx.write("offset\ttag\tid\tname\tpayload_len\tfile\n")
        for r in res:
            safe = "".join(c if c.isalnum() or c in "-_" else "_" for c in r["name"]) or "noname"
            sub = os.path.join(outdir, r["tag"])
            os.makedirs(sub, exist_ok=True)
            fn = os.path.join(r["tag"], "%05d_%s.bin" % (r["id"], safe))
            n = 0
            while os.path.exists(os.path.join(outdir, fn)):
                n += 1
                fn = os.path.join(r["tag"], "%05d_%s_%d.bin" % (r["id"], safe, n))
            open(os.path.join(outdir, fn), "wb").write(r["payload"])
            tsvname = "".join(c if 32 <= ord(c) < 127 else "?" for c in r["name"])
            idx.write("%#x\t%s\t%d\t%s\t%d\t%s\n" % (r["offset"], r["tag"], r["id"], tsvname, len(r["payload"]), fn))
    print("resources:", len(res))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
