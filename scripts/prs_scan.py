import struct
import sys

PRS = sys.argv[1] if len(sys.argv) > 1 else "_source/mariosgg/mario.prs"
TAGS = [b"Ply\x00", b"Pak\x00", b"MuV\x00", b"Img\x00"]

data = open(PRS, "rb").read()
print(f"file size: {len(data)}")

entries = []
i = 0x20  # skip the "PRS Format Resource File" header line
while i < len(data) - 8:
    tag = data[i:i+4]
    if tag in TAGS:
        rid = struct.unpack_from("<H", data, i + 4)[0]
        name_start = i + 6
        name_end = data.index(b"\x00", name_start)
        name = data[name_start:name_end].decode("latin1", errors="replace")
        if name.isprintable() and len(name) < 200:
            entries.append((i, tag.rstrip(b"\x00").decode(), rid, name, name_end + 1))
            i = name_end + 1
            continue
    i += 1

print(f"found {len(entries)} entries")
for off, tag, rid, name, dataoff in entries[:40]:
    print(f"  0x{off:08x}  {tag:4s}  id={rid:6d}  name={name!r:40s}  data@0x{dataoff:08x}")

with open("scripts/prs_catalog.tsv", "w") as f:
    f.write("offset\ttag\tid\tname\tdataoff\n")
    for off, tag, rid, name, dataoff in entries:
        f.write(f"{off}\t{tag}\t{rid}\t{name}\t{dataoff}\n")
print("wrote scripts/prs_catalog.tsv")
