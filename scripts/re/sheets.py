import prs, pak, struct, sys, os
from PIL import Image, ImageDraw
R = prs.bytag(prs.parse())
def palette(rid=1000):
    p = R['DIB'][rid]['payload']
    bi = struct.unpack_from('<I', p, 14)[0]
    s = 14 + bi
    return [(p[s+4*i+2], p[s+4*i+1], p[s+4*i]) for i in range(256)]
def frame_img(f, pal, bgcol=(255,0,255)):
    im = Image.new('RGBA', (max(f['w'],1), max(f['h'],1)), (0,0,0,0))
    px = im.load()
    for y in range(f['h']):
        for x in range(f['w']):
            v = f['px'][y*f['w']+x]
            if v != 0xff:
                c = pal[v]; px[x,y] = (c[0],c[1],c[2],255)
    return im
def tiled(frames, pal):
    # 64 tiles of 40x25 -> 320x200, column-major or row-major? try row-major 8 cols
    im = Image.new('RGBA', (320,200), (255,0,255,255))
    for i,f in enumerate(frames):
        t = frame_img(f, pal)
        im.paste(t, ((i % 8)*40, (i//8)*25), t)
    return im
if __name__ == '__main__':
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    pal = palette(1000)
    for rid, r in sorted(R['Pak'].items()):
        try: d = pak.decode(r['payload'])
        except Exception as e: print('ERR', rid, e); continue
        fr = d['frames']
        safe = ''.join(c if c.isalnum() else '_' for c in r['name'])
        if len(fr) == 64 and all(f['w']==40 and f['h']==25 for f in fr):
            tiled(fr, pal).save(f'{out}/{rid:05d}_{safe}.png'); continue
        # contact sheet
        ims = [frame_img(f, pal) for f in fr]
        W = 640; x = y = 0; rowh = 0; pos = []
        for im in ims:
            w, h = im.size
            if x + w + 4 > W: x = 0; y += rowh + 12; rowh = 0
            pos.append((x, y)); x += w + 6; rowh = max(rowh, h)
        H = y + rowh + 12
        sheet = Image.new('RGBA', (W, max(H, 20)), (40, 40, 60, 255))
        dr = ImageDraw.Draw(sheet)
        for i, (im, (px, py)) in enumerate(zip(ims, pos)):
            sheet.paste(im, (px, py + 10), im)
            dr.text((px, py), str(i), fill=(255,255,0,255))
        sheet.save(f'{out}/{rid:05d}_{safe}.png')
