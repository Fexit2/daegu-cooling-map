#!/usr/bin/env python3
"""지도 배경용 그늘 띠 / 야간 사각지대 래스터 생성 (오프라인 1회 실행)

- data/shade_raster.png : 대구 가로수 107,144그루 + 달서·달성 가로수길 292구간을
  블러 처리해 '그늘이 이어지는 길'을 부드러운 띠로 그린 반투명 PNG
- data/night_gap.png  : 22시 이후 운영 쉼터 800m 밖에 있는 쉼터 밀집지(야간 공백)를
  은은한 주황 존으로 그린 반투명 PNG

두 파일 모두 지도 위에 imageOverlay 로 얹는다. bounds 는 data/raster.js 에 기록.
"""
import csv, json, math, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '..', 'data')
TREES = 'documents/대구-탄소중립-공공데이터-AI-대회/data/trees_clean.csv'

BOUNDS = {'south': 35.780, 'west': 128.480, 'north': 36.010, 'east': 128.780}
PPM = 1 / 8.0  # 8 m/px


def size():
    h_m = (BOUNDS['north'] - BOUNDS['south']) * 111320
    w_m = (BOUNDS['east'] - BOUNDS['west']) * 111320 * math.cos(35.9 * math.pi / 180)
    return int(w_m * PPM), int(h_m * PPM)


W, H = size()
print('raster', W, 'x', H)


def to_px(lat, lon):
    x = (lon - BOUNDS['west']) / (BOUNDS['east'] - BOUNDS['west']) * W
    y = (BOUNDS['north'] - lat) / (BOUNDS['north'] - BOUNDS['south']) * H
    return x, y


def dist_m(la1, lo1, la2, lo2):
    R = 6371000.0
    t = math.pi / 180
    dl = (la2 - la1) * t
    dn = (lo2 - lo1) * t
    x = math.sin(dl / 2) ** 2 + math.cos(la1 * t) * math.cos(la2 * t) * math.sin(dn / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(x)))


# ---------- 1. 그늘 띠 ----------
mask = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(mask)

n = 0
with open(TREES, encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        try:
            la = float(row['lat']); lo = float(row['lon'])
        except (TypeError, ValueError):
            continue
        if not (BOUNDS['south'] < la < BOUNDS['north'] and BOUNDS['west'] < lo < BOUNDS['east']):
            continue
        x, y = to_px(la, lo)
        r = 1.1
        d.ellipse([x - r, y - r, x + r, y + r], fill=255)
        n += 1
        if n % 20000 == 0:
            print('  trees', n, flush=True)
print('trees drawn', n)

# 달서·달성 가로수길 구간은 래스터에 넣지 않는다(직선 구간이라 지도에서 인위적으로 보임).
# 지도에서는 별도 레이어로 옅게 그린다.
nseg = 0
with open(os.path.join(OUT, 'bundle.json'), encoding='utf-8') as f:
    bundle = json.load(f)
print('segments skipped')

blur = mask.filter(ImageFilter.GaussianBlur(2.9))
arr = np.asarray(blur).astype(np.float32)

lo_v, hi_v = 12.0, 58.0
a = np.clip((arr - lo_v) / (hi_v - lo_v), 0, 1)
alpha = (a * 112 + np.clip(a * 3, 0, 1) * 6).astype(np.uint8)
rgba = np.zeros((H, W, 4), dtype=np.uint8)
# 옅은 곳은 밝은 청록, 짙은 곳은 깊은 에메랄드
rgba[..., 0] = (18 - a * 10).astype(np.uint8)
rgba[..., 1] = (128 - a * 44).astype(np.uint8)
rgba[..., 2] = (100 - a * 32).astype(np.uint8)
rgba[..., 3] = alpha
shade_img = Image.fromarray(rgba, 'RGBA')
shade_img.quantize(colors=96, method=Image.FASTOCTREE).save(os.path.join(OUT, 'shade_raster.png'), optimize=True)

# ---------- 2. 야간 사각지대 ----------
# 시가화 지역(무더위쉼터 밀집) 가운데, 22시 이후 운영 쉼터까지 도보 10분(800m)이 넘는 곳.
night_pts = [(n['lat'], n['lon']) for n in bundle['night']]
sh_pts = [(x['lat'], x['lon']) for x in bundle['shelters'] if x.get('lat')]

G = 0.0015  # ≈150m 격자
lats = np.arange(BOUNDS['south'], BOUNDS['north'], G)
lons = np.arange(BOUNDS['west'], BOUNDS['east'], G)
gh, gw = len(lats), len(lons)
LA = lats[:, None]
LO = lons[None, :]
kx = math.cos(35.9 * math.pi / 180)

def dgrid(lat, lon):
    dy = (LA - lat) * 111320.0
    dx = (LO - lon) * 111320.0 * kx
    return np.sqrt(dy * dy + dx * dx)

d_night = np.full((gh, gw), 9e9, dtype=np.float32)
for (la, lo) in night_pts:
    d_night = np.minimum(d_night, dgrid(la, lo))
dens = np.zeros((gh, gw), dtype=np.float32)
for (la, lo) in sh_pts:
    dens += (dgrid(la, lo) < 700).astype(np.float32)

urban = np.clip(dens / 6.0, 0, 1)
gap = np.clip((d_night - 800) / 500.0, 0, 1) * urban
mask = Image.fromarray((gap * 255).astype(np.uint8), 'L').resize((W, H), Image.BICUBIC)
gblur = mask.filter(ImageFilter.GaussianBlur(8))
garr = np.asarray(gblur).astype(np.float32) / 255.0
galpha = (np.clip(garr, 0, 1) ** 1.0 * 36).astype(np.uint8)
g_rgba = np.zeros((H, W, 4), dtype=np.uint8)
g_rgba[..., 0] = 255
g_rgba[..., 1] = 112
g_rgba[..., 2] = 48
g_rgba[..., 3] = galpha
gimg = Image.fromarray(g_rgba, 'RGBA').resize((W // 2, H // 2), Image.LANCZOS)
gimg.quantize(colors=64, method=Image.FASTOCTREE).save(os.path.join(OUT, 'night_gap.png'), optimize=True)

with open(os.path.join(OUT, 'raster.js'), 'w') as f:
    f.write('window.__BAMNAT_RASTER__=')
    json.dump({'bounds': BOUNDS, 'w': W, 'h': H,
               'shade': 'data/shade_raster.png', 'gap': 'data/night_gap.png'}, f)
    f.write(';\n')
for fn in ('shade_raster.png', 'night_gap.png'):
    p = os.path.join(OUT, fn)
    print(fn, round(os.path.getsize(p) / 1024), 'KB')
