"""生成 tabBar 图标（81x81 PNG）。用最小依赖手写 PNG 编码。"""
import os, struct, zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "images")
os.makedirs(OUT, exist_ok=True)

def png(width, height, pixels):
    raw = b''
    for y in range(height):
        raw += b'\x00'
        for x in range(width):
            raw += bytes(pixels[y][x])
    def chunk(tag, data):
        c = struct.pack('>I', len(data)) + tag + data
        return c + struct.pack('>I', zlib.crc32(tag + data) & 0xffffffff)
    ihdr = struct.pack('>IIBBBBB', width, height, 8, 6, 0, 0, 0)  # RGBA
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', ihdr)
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

SIZE = 81
GRAY = (140, 140, 140, 255)
BLUE = (22, 119, 255, 255)
CLEAR = (0, 0, 0, 0)

def draw(kind, color):
    """kind: 'market' 折线, 'watch' 星标, 'hold' 柱状"""
    px = [[CLEAR for _ in range(SIZE)] for _ in range(SIZE)]
    def put(x, y):
        if 0 <= x < SIZE and 0 <= y < SIZE:
            px[y][x] = color
    def rect(x0, y0, x1, y1):
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                put(x, y)
    if kind == 'market':
        # 折线图：上升折线 + 下方填充
        pts = [(12, 56), (26, 44), (40, 50), (54, 30), (68, 18)]
        for i in range(len(pts) - 1):
            x0, y0 = pts[i]; x1, y1 = pts[i + 1]
            steps = max(abs(x1 - x0), abs(y1 - y0)) * 2
            for s in range(steps + 1):
                x = round(x0 + (x1 - x0) * s / steps)
                y = round(y0 + (y1 - y0) * s / steps)
                for dx in range(-2, 3):
                    for dy in range(-2, 3):
                        put(x + dx, y + dy)
        for x in range(12, 69):
            for y in range(64, 68):
                put(x, y)
    elif kind == 'watch':
        # 五角星
        import math
        cx, cy, R = 40, 42, 28
        pts = []
        for i in range(10):
            ang = -math.pi / 2 + i * math.pi / 5
            r = R if i % 2 == 0 else R * 0.45
            pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
        def inside(px_, py):
            # 射线法
            c = False
            n = len(pts)
            for i in range(n):
                x1, y1 = pts[i]; x2, y2 = pts[(i + 1) % n]
                if (y1 > py) != (y2 > py):
                    xint = (x2 - x1) * (py - y1) / (y2 - y1) + x1
                    if px_ < xint:
                        c = not c
            return c
        for y in range(SIZE):
            for x in range(SIZE):
                if inside(x + 0.5, y + 0.5):
                    put(x, y)
    else:  # hold 柱状图
        for i, (x0, h) in enumerate([(14, 26), (30, 40), (46, 32), (62, 48)]):
            rect(x0, 64 - h, x0 + 15, 64)
    return px

for kind, base in [('market', 'tab-market'), ('watch', 'tab-watch'), ('hold', 'tab-hold')]:
    with open(os.path.join(OUT, base + '.png'), 'wb') as f:
        f.write(png(SIZE, SIZE, draw(kind, GRAY)))
    with open(os.path.join(OUT, base + '-active.png'), 'wb') as f:
        f.write(png(SIZE, SIZE, draw(kind, BLUE)))
print("icons written to", os.path.abspath(OUT))
