#!/usr/bin/env python3
"""경로 비교 시연 데이터 생성 (오프라인 1회 실행, 네트워크 필요)

각 시연 위치에서 걸어갈 만한 무더위쉼터까지
  1) 최단길  : OSRM 보행 네트워크 최단 경로
  2) 그늘길  : 그늘 자원(가로수·그늘막)을 지나도록 경유지를 넣은 보행 경로

- 거리: OSM 보행 네트워크(OSRM foot) 기준
- 그늘 비율: 대구 가로수 107,144그루 좌표(trees_clean.csv) + 수성구 그늘막 좌표 +
  달서·달성 가로수길 구간을 10m 간격으로 샘플링해 계산
"""
import json, math, time, urllib.request, os, sys, csv

HERE = os.path.dirname(os.path.abspath(__file__))
BUNDLE = os.path.join(HERE, '..', 'data', 'bundle.json')
TREES = 'documents/대구-탄소중립-공공데이터-AI-대회/data/trees_clean.csv'
OSRM = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/{coords}?overview=full&geometries=geojson'

LOCS = [
    {'key': 'beomeo', 'name': '수성구 범어동', 'short': '범어동', 'lat': 35.8585, 'lon': 128.6265},
    {'key': 'dongsung', 'name': '중구 동성로', 'short': '동성로', 'lat': 35.8693, 'lon': 128.5952},
    {'key': 'seongseo', 'name': '달서구 성서', 'short': '성서', 'lat': 35.8540, 'lon': 128.5300},
]

B = json.load(open(BUNDLE))
segments = [s for s in B['segments'] if 35 < s[0] < 36.1 and 35 < s[2] < 36.1]
canopies = [c for c in B['canopies'] if c.get('lat')]
shelters = [s for s in B['shelters'] if s.get('lat')]

trees = []
with open(TREES, encoding='utf-8-sig') as f:
    for row in csv.DictReader(f):
        try:
            trees.append((float(row['lat']), float(row['lon'])))
        except (TypeError, ValueError):
            continue
print('trees', len(trees))


def hav(a, b, c, d):
    R = 6371000.0
    t = math.pi / 180
    dl = (c - a) * t
    dn = (d - b) * t
    x = math.sin(dl / 2) ** 2 + math.cos(a * t) * math.cos(c * t) * math.sin(dn / 2) ** 2
    return 2 * R * math.asin(min(1.0, math.sqrt(x)))


def seg_dist(p, s):
    lat, lon = p
    ay, ax, by, bx = s[0], s[1], s[2], s[3]
    kx = math.cos(lat * math.pi / 180)
    px, py = (lon - ax) * kx * 111320.0, (lat - ay) * 111320.0
    vx, vy = (bx - ax) * kx * 111320.0, (by - ay) * 111320.0
    L2 = vx * vx + vy * vy
    t = 0.0 if L2 == 0 else max(0.0, min(1.0, (px * vx + py * vy) / L2))
    return math.hypot(px - vx * t, py - vy * t)


class Grid:
    def __init__(self, step=0.0012):
        self.step = step
        self.g = {}

    def key(self, lat, lon):
        return (int(math.floor(lat / self.step)), int(math.floor(lon / self.step)))

    def add(self, lat, lon, obj):
        self.g.setdefault(self.key(lat, lon), []).append(obj)

    def near(self, lat, lon, ring=1):
        k = self.key(lat, lon)
        out = []
        for i in range(-ring, ring + 1):
            for j in range(-ring, ring + 1):
                out.extend(self.g.get((k[0] + i, k[1] + j), ()))
        return out


tree_grid = Grid(0.0012)      # ~130m 격자
for t in trees:
    tree_grid.add(t[0], t[1], t)

can_grid = Grid(0.002)
for c in canopies:
    can_grid.add(c['lat'], c['lon'], c)

seg_grid = Grid(0.004)
for s in segments:
    n = max(1, int(hav(s[0], s[1], s[2], s[3]) / 200))
    for i in range(n + 1):
        f = i / n
        seg_grid.add(s[0] + (s[2] - s[0]) * f, s[1] + (s[3] - s[1]) * f, s)


def shade_at(lat, lon):
    """그늘 강도 0~1. 가로수 수관 반경·그늘막 바로 아래·가로수길 선 주변."""
    best = 0.0
    for t in tree_grid.near(lat, lon):
        d = hav(lat, lon, t[0], t[1])
        if d < 11:
            best = max(best, 1.0 - d / 11 * 0.55)
    for c in can_grid.near(lat, lon):
        d = hav(lat, lon, c['lat'], c['lon'])
        if d < 18:
            best = max(best, 1.0 if d <= 8 else 1.0 - (d - 8) / 10 * 0.45)
    dseg = 1e9
    for s in seg_grid.near(lat, lon):
        d = seg_dist((lat, lon), s)
        if d < dseg:
            dseg = d
    if dseg < 18:
        best = max(best, 0.9 if dseg <= 9 else 0.9 - (dseg - 9) / 9 * 0.45)
    return best


def sample(route_pts, every=8.0):
    pts = []
    for i in range(len(route_pts) - 1):
        a, b = route_pts[i], route_pts[i + 1]
        d = hav(a[0], a[1], b[0], b[1])
        n = max(1, int(d / every))
        for k in range(n):
            f = k / n
            pts.append((a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f))
    pts.append(route_pts[-1])
    vals = [shade_at(p[0], p[1]) for p in pts]
    shade_pct = round(sum(1 for v in vals if v >= 0.5) / max(1, len(vals)) * 100)
    hits = set()
    for p in pts:
        for c in can_grid.near(p[0], p[1]):
            if hav(p[0], p[1], c['lat'], c['lon']) <= 14:
                hits.add(c.get('id') or (c['lat'], c['lon']))
    return shade_pct, len(hits)


def get_route(coords):
    cs = ';'.join('%.6f,%.6f' % (p[1], p[0]) for p in coords)
    url = OSRM.format(coords=cs)
    for attempt in range(3):
        try:
            r = json.loads(urllib.request.urlopen(url, timeout=30).read().decode())
            if r.get('code') != 'Ok' or not r.get('routes'):
                return None
            rt = r['routes'][0]
            pts = [(q[1], q[0]) for q in rt['geometry']['coordinates']]
            return {'pts': pts, 'dist': rt['distance'], 'dur': rt['duration']}
        except Exception as e:
            if attempt == 2:
                print('  ! route fail', e, file=sys.stderr)
                return None
            time.sleep(1.5)


def thin(pts, min_m=4.0):
    out = [pts[0]]
    for p in pts[1:-1]:
        if hav(out[-1][0], out[-1][1], p[0], p[1]) >= min_m:
            out.append(p)
    out.append(pts[-1])
    return out


def waypoints(a, b, radius):
    """직선 주변의 그늘 자원 후보. 그늘막 > 가로수 밀집 > 가로수길."""
    mid = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
    cands = []
    for c in canopies:
        d = hav(mid[0], mid[1], c['lat'], c['lon'])
        if d < radius * 0.8:
            cands.append({'lat': c['lat'], 'lon': c['lon'], 'label': '그늘막 ' + (c.get('d') or ''), 'w': 1.4, 'd': d})
    # 가로수 밀집 지점: 40m 원 안 나무 수를 세어 상위 지점만
    step = 0.0004
    lat0, lon0 = mid[0] - radius / 111320, mid[1] - radius / 111320
    n = int(radius * 2 / 44)
    seen = []
    for i in range(0, n + 1, 2):
        for j in range(0, n + 1, 2):
            la = lat0 + i * 44 / 111320.0
            lo = lon0 + j * 44 / 111320.0
            cnt = 0
            for t in tree_grid.near(la, lo):
                if hav(la, lo, t[0], t[1]) <= 22:
                    cnt += 1
            if cnt >= 3:
                seen.append({'lat': la, 'lon': lo, 'label': '가로수 %d그루 구간' % cnt, 'w': min(1.2, cnt / 6.0),
                             'd': hav(mid[0], mid[1], la, lo)})
    seen.sort(key=lambda x: -x['w'])
    cands.extend(seen[:6])
    for s in segments:
        if s[4] < 40:
            continue
        for f in (0.5, 0.2, 0.8):
            p = (s[0] + (s[2] - s[0]) * f, s[1] + (s[3] - s[1]) * f)
            d = hav(mid[0], mid[1], p[0], p[1])
            if d < radius * 0.8:
                cands.append({'lat': p[0], 'lon': p[1], 'label': s[6] + ' 가로수길', 'w': min(1.1, s[4] / 200.0), 'd': d})
    cands.sort(key=lambda x: x['d'] - x['w'] * 160)
    out = []
    for c in cands:
        if all(hav(c['lat'], c['lon'], o['lat'], o['lon']) > 90 for o in out):
            out.append(c)
        if len(out) >= 10:
            break
    return out


def route_pair(a, sh):
    b = (sh['lat'], sh['lon'])
    st = hav(a[0], a[1], b[0], b[1])
    short = get_route([a, b])
    if not short or short['dist'] > st * 1.6:
        return None
    sp = thin(short['pts'])
    s_shade, s_can = sample(sp)
    best = None
    for wp in waypoints(a, b, max(320, st * 0.8)):
        r = get_route([a, (wp['lat'], wp['lon']), b])
        if not r:
            continue
        if r['dist'] > max(st * 1.55, st + 300):
            continue
        p = thin(r['pts'])
        sh_pct, can = sample(p)
        if sh_pct < s_shade + 10:
            continue
        score = sh_pct - (r['dist'] / st - 1) * 24
        if best is None or score > best['score']:
            best = {'score': score, 'pts': p, 'dist': r['dist'], 'shade': sh_pct, 'can': can, 'wp': wp}
    return {'st': st, 'short': {'pts': sp, 'dist': short['dist'], 'shade': s_shade, 'can': s_can}, 'shady': best}


routes = {}
for L in LOCS:
    a = (L['lat'], L['lon'])
    print('==', L['short'], flush=True)
    near = sorted([s for s in shelters if hav(a[0], a[1], s['lat'], s['lon']) <= 800],
                  key=lambda s: hav(a[0], a[1], s['lat'], s['lon']))[:5]
    picked = None
    for sh in near:
        pr = route_pair(a, sh)
        if not pr:
            print('   %-24s 경로 없음' % sh['n'], flush=True)
            continue
        print('   %-24s 직선%4d 최단%4d %3d%% 그늘 %s' % (
            sh['n'], round(pr['st']), round(pr['short']['dist']), pr['short']['shade'],
            ('%4d %3d%%' % (round(pr['shady']['dist']), pr['shady']['shade'])) if pr['shady'] else '없음'), flush=True)
        if pr['shady']:
            key = (pr['shady']['shade'] - (pr['shady']['dist'] / pr['st'] - 1) * 24, -pr['st'])
            if picked is None or key > picked[0]:
                picked = (key, sh, pr)
    if picked is None:
        sh = near[0]
        pr = route_pair(a, sh)
        if not pr:
            continue
        picked = ((0, 0), sh, pr)
    _, sh, pr = picked
    print('  → 선택', sh['n'], flush=True)
    routes[L['key']] = {
        'loc': L['name'], 'short': L['short'],
        'from': {'lat': L['lat'], 'lon': L['lon'], 'label': L['short']},
        'dest': {'lat': sh['lat'], 'lon': sh['lon'], 'name': sh['n'], 'gu': sh['g'], 'dong': sh.get('d'),
                 't': sh.get('t'), 'os': sh.get('os'), 'oe': sh.get('oe'), 'ac': sh.get('ac'),
                 't100': sh.get('t100'), 'a': sh.get('a')},
        'straight': round(pr['st']),
        'shortest': {'m': round(pr['short']['dist']), 'shade': pr['short']['shade'], 'canopy': pr['short']['can'],
                     'pts': [[round(p[0], 6), round(p[1], 6)] for p in pr['short']['pts']]},
        'shady': None if not pr['shady'] else {
            'm': round(pr['shady']['dist']), 'shade': pr['shady']['shade'], 'canopy': pr['shady']['can'],
            'via': pr['shady']['wp']['label'],
            'pts': [[round(p[0], 6), round(p[1], 6)] for p in pr['shady']['pts']]},
    }

for v in routes.values():
    for kind in ('shortest', 'shady'):
        if v[kind]:
            v[kind]['min'] = max(1, round(v[kind]['m'] / 67))

B['routes'] = routes
json.dump(B, open(BUNDLE, 'w'), ensure_ascii=False, separators=(',', ':'))
with open(os.path.join(HERE, '..', 'data', 'bundle.js'), 'w') as f:
    f.write('window.__BAMNAT__=')
    json.dump(B, f, ensure_ascii=False, separators=(',', ':'))
    f.write(';\n')
print('saved', len(routes), 'routes')
