"""把生成的图标拼成对比图（深色底、放大 4x），便于肉眼检查质量。"""
import os, struct, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.join(HERE, "..", "images")

def read_png(path):
    with open(path, 'rb') as f:
        data = f.read()
    pos = 8
    w = h = 0
    idat = b''
    while pos < len(data):
        ln = struct.unpack('>I', data[pos:pos+4])[0]
        tag = data[pos+4:pos+8]
        body = data[pos+8:pos+8+ln]
        if tag == b'IHDR':
            w, h = struct.unpack('>II', body[:8])
        elif tag == b'IDAT':
            idat += body
        pos += 12 + ln
    raw = zlib.decompress(idat)
    px = []
    stride = w * 4
    prev = bytearray(stride)
    for y in range(h):
        row = bytearray(stride)
        off = y * (stride + 1)
        ft = raw[off]
        cur = bytearray(raw[off+1:off+1+stride])
        if ft == 1:
            for i in range(stride):
                cur[i] = (cur[i] + (cur[i-4] if i >= 4 else 0)) & 255
        elif ft == 2:
            for i in range(stride):
                cur[i] = (cur[i] + prev[i]) & 255
        elif ft == 3:
            for i in range(stride):
                a = cur[i-4] if i >= 4 else 0
                cur[i] = (cur[i] + ((a + prev[i]) >> 1)) & 255
        elif ft == 4:
            for i in range(stride):
                a = cur[i-4] if i >= 4 else 0
                b = prev[i]
                c = prev[i-4] if i >= 4 else 0
                p = a + b - c
                pa, pb, pc = abs(p-a), abs(p-b), abs(p-c)
                pr = a if (pa <= pb and pa <= pc) else (b if pb <= pc else c)
                cur[i] = (cur[i] + pr) & 255
        prev = cur
        px.append([tuple(cur[x*4:x*4+4]) for x in range(w)])
    return w, h, px

def write_png(path, w, h, px):
    raw = b''
    for y in range(h):
        raw += b'\x00'
        for x in range(w):
            raw += bytes(px[y][x])
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    with open(path, 'wb') as f:
        f.write(b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
                + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

BG = (15, 23, 42)          # app 背景 #0f172a
SCALE = 3
PAD = 24
SIZE = 81

names = ['tab-market', 'tab-watch', 'tab-hold', 'tab-settings']
# 两行：上排未选中（灰），下排选中（金）
cell = SIZE * SCALE + PAD * 2
W = cell * len(names)
H = cell * 2

out = [[BG + (255,) for _ in range(W)] for _ in range(H)]
for row_i, suffix in enumerate(['', '-active']):
    for col, name in enumerate(names):
        w, h, px = read_png(os.path.join(IMG, name + suffix + '.png'))
        ox = col * cell + PAD
        oy = row_i * cell + PAD
        for y in range(h):
            for x in range(w):
                r, g, b, a = px[y][x]
                if a == 0:
                    continue
                for sy in range(SCALE):
                    for sx in range(SCALE):
                        py, px_ = oy + y * SCALE + sy, ox + x * SCALE + sx
                        br, bg_, bb, _ = out[py][px_]
                        af = a / 255.0
                        out[py][px_] = (
                            int(br * (1 - af) + r * af),
                            int(bg_ * (1 - af) + g * af),
                            int(bb * (1 - af) + b * af),
                            255,
                        )
write_png(os.path.join(IMG, '_preview.png'), W, H, out)
print('preview ->', os.path.abspath(os.path.join(IMG, '_preview.png')))
