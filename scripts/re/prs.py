import os, struct
PRS = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "_source", "mariosgg", "mario.prs")
def parse(path=PRS):
    d = open(path, "rb").read()
    pos = 0x30
    out = []
    while pos < len(d):
        tag = d[pos:pos+3].decode()
        rid = struct.unpack_from("<H", d, pos+4)[0]
        name = d[pos+6:pos+0x18].split(b"\0")[0].decode("latin1")
        ln = struct.unpack_from("<I", d, pos+0x18)[0]
        out.append(dict(offset=pos, tag=tag, id=rid, name=name, payload=d[pos+0x1c:pos+ln]))
        pos += ln
    return out
def bytag(res):
    m = {}
    for r in res:
        m.setdefault(r["tag"], {})[r["id"]] = r
    return m
