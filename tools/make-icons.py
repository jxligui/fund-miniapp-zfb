"""生成 tabBar 图标（81x81 PNG，4x 超采样抗锯齿）。

设计对齐深色金融主题（ui-ux-pro-max 设计系统）：
  未选中 slate-400 #94a3b8 描边风格 / 选中 amber-500 #f59e0b

图标与底部功能区一一对应：
  tab-market    行情   上升趋势折线 + 箭头（↗）
  tab-watch     自选   五角星（未选描边 / 选中实心）
  tab-hold      持仓   三根胶囊柱（组合收益）
  tab-settings  设置   滑块调节杆

纯标准库实现：手写 PNG 编码，无第三方依赖。
"""
import os, math, struct, zlib

OUT = os.path.join(os.path.dirname(__file__), "..", "images")
os.makedirs(OUT, exist_ok=True)

SIZE = 81
SS = 4                    # 超采样倍数
BIG = SIZE * SS

GRAY = (148, 163, 184)    # slate-400
GOLD = (245, 158, 11)     # amber-500


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


class Icon:
    """在 SS 倍大画布上画 alpha 遮罩，盒式降采样得到平滑抗锯齿边缘。"""

    def __init__(self):
        self.a = [[0.0] * BIG for _ in range(BIG)]

    def dot(self, x, y, r):
        """实心圆（最终坐标系单位）。"""
        R = r * SS
        cx, cy = x * SS, y * SS
        R2 = R * R
        x0 = max(0, int(cx - R)); x1 = min(BIG - 1, int(cx + R) + 1)
        y0 = max(0, int(cy - R)); y1 = min(BIG - 1, int(cy + R) + 1)
        for yy in range(y0, y1 + 1):
            dy = yy + 0.5 - cy
            dy2 = dy * dy
            row = self.a[yy]
            for xx in range(x0, x1 + 1):
                dx = xx + 0.5 - cx
                if dx * dx + dy2 <= R2:
                    row[xx] = 1.0

    def line(self, x0, y0, x1, y1, w):
        """圆头描边线段（沿路径盖圆，天然圆角连接）。"""
        r = w / 2.0
        steps = max(1, int(math.hypot(x1 - x0, y1 - y0) * SS))
        for s in range(steps + 1):
            t = s / steps
            self.dot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, r)

    def rect(self, x0, y0, x1, y1):
        for yy in range(max(0, int(y0 * SS)), min(BIG, int(y1 * SS) + 1)):
            row = self.a[yy]
            for xx in range(max(0, int(x0 * SS)), min(BIG, int(x1 * SS) + 1)):
                row[xx] = 1.0

    def bar(self, x, top, bottom, w):
        """胶囊柱：上下半圆端头的圆角柱。"""
        r = w / 2.0
        self.rect(x, top + r, x + w, bottom - r)
        self.dot(x + r, top + r, r)
        self.dot(x + r, bottom - r, r)

    def poly_fill(self, pts):
        """多边形扫描线填充（偶奇规则）。"""
        P = [(x * SS, y * SS) for x, y in pts]
        n = len(P)
        y0 = max(0, int(min(p[1] for p in P)))
        y1 = min(BIG - 1, int(max(p[1] for p in P)))
        for yy in range(y0, y1 + 1):
            py = yy + 0.5
            xs = []
            for i in range(n):
                ax, ay = P[i]
                bx, by = P[(i + 1) % n]
                if (ay > py) != (by > py):
                    xs.append((bx - ax) * (py - ay) / (by - ay) + ax)
            xs.sort()
            row = self.a[yy]
            for i in range(0, len(xs) - 1, 2):
                lo = max(0, int(math.ceil(xs[i] - 0.5)))
                hi = min(BIG - 1, int(math.floor(xs[i + 1] - 0.5)))
                for xx in range(lo, hi + 1):
                    row[xx] = 1.0

    def star_points(self, cx, cy, rout, rin):
        pts = []
        for i in range(10):
            ang = -math.pi / 2 + i * math.pi / 5
            r = rout if i % 2 == 0 else rin
            pts.append((cx + r * math.cos(ang), cy + r * math.sin(ang)))
        return pts

    def render(self, rgb):
        inv = 1.0 / (SS * SS)
        px = []
        for y in range(SIZE):
            row = []
            for x in range(SIZE):
                base = x * SS
                acc = 0
                for dy in range(SS):
                    src = self.a[y * SS + dy]
                    acc += src[base] + src[base + 1] + src[base + 2] + src[base + 3]
                alpha = int(round(max(0.0, min(1.0, acc * inv)) * 255))
                row.append([rgb[0], rgb[1], rgb[2], alpha])
            px.append(row)
        return px


# ---------- 图标定义（最终坐标系，81x81，图形覆盖率 ~80% 以求醒目） ----------

def draw_market(c):
    """行情：上升趋势折线 + ↗ 箭头 + 底部轴线。"""
    c.line(9, 56, 27, 38, 6.5)
    c.line(27, 38, 43, 47, 6.5)
    c.line(43, 47, 64, 22, 6.5)
    c.line(64, 22, 64, 37, 6)      # 箭头竖边
    c.line(64, 22, 49, 22, 6)      # 箭头横边
    c.line(9, 68, 72, 68, 4)       # 轴线


def draw_watch_outline(c):
    """自选（未选中）：描边五角星。"""
    pts = c.star_points(40.5, 41, 30, 13.2)
    for i in range(10):
        x0, y0 = pts[i]
        x1, y1 = pts[(i + 1) % 10]
        c.line(x0, y0, x1, y1, 5.5)


def draw_watch_filled(c):
    """自选（选中）：实心五角星。"""
    c.poly_fill(c.star_points(40.5, 41, 30, 13.2))


def draw_hold(c):
    """持仓：三根胶囊柱，中间最高（组合收益）。"""
    c.bar(11, 40, 66, 16)
    c.bar(32.5, 21, 66, 16)
    c.bar(54, 32, 66, 16)


def draw_settings(c):
    """设置：三条滑轨 + 错位滑块（现代调节杆样式）。"""
    for y in (25, 40.5, 56):
        c.line(9, y, 72, y, 5.5)
    c.dot(30, 25, 9.5)
    c.dot(50, 40.5, 9.5)
    c.dot(31, 56, 9.5)


ICONS = {
    'tab-market':   (draw_market, draw_market),
    'tab-watch':    (draw_watch_outline, draw_watch_filled),
    'tab-hold':     (draw_hold, draw_hold),
    'tab-settings': (draw_settings, draw_settings),
}


def write(name, pixels):
    with open(os.path.join(OUT, name), 'wb') as f:
        f.write(png(SIZE, SIZE, pixels))


for base, (inactive, active) in ICONS.items():
    c = Icon(); inactive(c)
    write(base + '.png', c.render(GRAY))
    c = Icon(); active(c)
    write(base + '-active.png', c.render(GOLD))
    print('written:', base, '+ active')
print('icons ->', os.path.abspath(OUT))
