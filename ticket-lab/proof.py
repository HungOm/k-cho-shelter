#!/usr/bin/env python3
"""
A LOOK AT IT, rather than a promise that it is right.

Reads the placement JSON that `generate.mjs --format json` writes and draws it
onto the artwork with a real Times New Roman, at the artwork's own resolution.
Nothing in the lab depends on this: the printable output is the HTML sheet and
it is drawn by the browser. This is here so the geometry can be checked with
an eye, and checked zoomed in, without a browser in the way.

    node generate.mjs --number 00001 --format json --out out/one.json
    python3 proof.py out/one.json out/proof.png [--zoom]

Needs Pillow, and a Times New Roman on the machine. On macOS it is where the
default below points; pass --font to say otherwise.
"""
import json
import sys
from PIL import Image, ImageDraw, ImageFont

MAC_TIMES = {
    'bold': '/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf',
    'regular': '/System/Library/Fonts/Supplemental/Times New Roman.ttf',
}


def draw(spec, art_path, font_paths):
    im = Image.open(art_path).convert('RGB')
    d = ImageDraw.Draw(im)
    for half in ('main', 'stub'):
        p = spec[half]
        # The JSON gives a font size and a BASELINE. Pillow anchors 's' is the
        # baseline, which is the only anchor that makes this a fair check.
        f = ImageFont.truetype(font_paths[p['weight']], p['fontSize'])
        d.text((p['x'], p['baseline']), p['text'], font=f, fill=p['fill'], anchor='ls')
    return im


def main(argv):
    if len(argv) < 3:
        print(__doc__)
        return 2
    spec_file, out_file = argv[1], argv[2]
    zoom = '--zoom' in argv
    fonts = dict(MAC_TIMES)
    if '--font' in argv:
        fonts['bold'] = fonts['regular'] = argv[argv.index('--font') + 1]

    data = json.load(open(spec_file))
    art = sys.path and __file__.rsplit('/', 1)[0] + '/' + data['artwork']['file']
    t = data['tickets'][0]
    im = draw(t, art, fonts)
    im.save(out_file)
    print(out_file, im.size)

    if zoom:
        for half, box in (('main', (330, 30, 760, 95)), ('stub', (1250, 35, 1520, 80))):
            c = im.crop(box)
            k = 4 if half == 'main' else 6
            c = c.resize((c.width * k, c.height * k), Image.LANCZOS)
            name = out_file.replace('.png', f'-{half}.png')
            c.save(name)
            print(name, c.size)
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv))
