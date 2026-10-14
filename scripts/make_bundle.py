import pathlib
import sys
import zipfile

ROOT = pathlib.Path(sys.argv[1]).resolve()
SRC = ROOT / "_source" / "mariosgg"
OUT = ROOT / "mariosgg.jsdos"

DOSBOX_CONF = """[dosbox]
memsize=16

[cpu]
cycles=max

[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
hdma=5

[autoexec]
mount c .
c:
cd mariosgg
mario.exe
"""

if not SRC.is_dir():
    sys.exit(f"source dir not found: {SRC}")

with zipfile.ZipFile(OUT, "w", zipfile.ZIP_DEFLATED) as zf:
    # The wasm backend extracts the bundle to /home/web_user/ and looks for the config
    # specifically at .jsdos/dosbox.conf; a top-level copy alone is not enough.
    zf.writestr(".jsdos/dosbox.conf", DOSBOX_CONF)
    zf.writestr("dosbox.conf", DOSBOX_CONF)
    for f in sorted(SRC.rglob("*")):
        if f.is_file():
            arcname = "mariosgg/" + str(f.relative_to(SRC)).replace("\\", "/")
            zf.write(f, arcname)

print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
with zipfile.ZipFile(OUT) as zf:
    for info in zf.infolist():
        print(f"  {info.file_size:>9}  {info.filename}")
