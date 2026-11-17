#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""밤낮쉼표 지도 개편 검증 — 로컬 HTTP + Chromium 390×844 DPR2

  · 콘솔 에러·페이지 예외·실패 요청 0
  · 지도: 그늘 띠(래스터)·핀·경로 2개·비교 카드 렌더
  · 낮↔밤 전환, 칩 토글, 카드 탭(경로 강조), 쉼터 핀 → 바텀시트
  · 가로 넘침 0
  · 스크린샷: downloads/daegu_bamnat_v2_map_day.png / _night.png (+ 보조 2장)

실행:
  LD_LIBRARY_PATH=/workspace/tmp/sysroot/usr/lib/x86_64-linux-gnu python3 tools/verify.py
"""
import json, os, threading, http.server, socketserver, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = '/workspace/downloads'
TMP = '/workspace/tmp'
PORT = 8821


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=ROOT, **kw)

    def log_message(self, *a):
        pass


def serve():
    socketserver.TCPServer.allow_reuse_address = True
    s = socketserver.TCPServer(('127.0.0.1', PORT), Handler)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


def main():
    from playwright.sync_api import sync_playwright

    os.makedirs(OUT, exist_ok=True)
    httpd = serve()
    rep = {'console': [], 'pageerrors': [], 'failed': [], 'checks': {}}
    try:
        with sync_playwright() as pw:
            b = pw.chromium.launch()
            page = b.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=2,
                              is_mobile=True, has_touch=True, locale='ko-KR')
            page.on('console', lambda m: rep['console'].append(m.text) if m.type == 'error' else None)
            page.on('pageerror', lambda e: rep['pageerrors'].append(str(e)))
            def on_fail(r):
                # 확대·이동 중 Leaflet이 취소한 타일 요청(ERR_ABORTED)은 오류로 세지 않는다
                if 'ERR_ABORTED' in str(r.failure):
                    rep['aborted'] = rep.get('aborted', 0) + 1
                    return
                rep['failed'].append({'url': r.url, 'err': str(r.failure)})
            page.on('requestfailed', on_fail)
            page.goto('http://127.0.0.1:%d/index.html' % PORT, wait_until='load')
            page.wait_for_timeout(1600)

            c = rep['checks']
            c['title'] = page.title()

            # ── 지도 탭(낮)
            page.click('.tab[data-tab="map"]')
            page.wait_for_timeout(4200)
            c['day'] = page.evaluate('''() => {
              const im = document.querySelector('img.leaflet-image-layer');
              return {
                tiles: document.querySelectorAll('.leaflet-tile-loaded').length,
                raster: im ? [im.naturalWidth, im.naturalHeight] : null,
                pins: document.querySelectorAll('.mk').length,
                routes: document.querySelectorAll('.leaflet-overlay-pane path').length,
                panel: (document.querySelector('.route-panel')||{}).innerText,
                chips: Array.from(document.querySelectorAll('.layer-chips button')).map(b=>b.innerText),
                legend: (document.querySelector('.map-legend')||{}).innerText,
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
              }}''')
            page.screenshot(path=os.path.join(OUT, 'daegu_bamnat_v2_map_day.png'))
            page.screenshot(path=os.path.join(TMP, 'v_day_full.png'))

            # 경로 카드 탭 → 그늘길 강조
            page.click('.rp-opt.shady')
            page.wait_for_timeout(700)
            c['shady_on'] = page.evaluate("() => !!document.querySelector('.rp-opt.shady.on')")
            page.screenshot(path=os.path.join(TMP, 'v_day_shady.png'))

            # 쉼터 핀 → 바텀시트
            page.click('.layer-chips button[data-l="shelter"]')  # off
            page.wait_for_timeout(300)
            page.click('.layer-chips button[data-l="shelter"]')  # on
            page.wait_for_timeout(700)
            pin = page.query_selector('.mk .pin-shelter')
            if pin:
                pin.click()
                page.wait_for_timeout(600)
                c['sheet'] = page.evaluate("() => { const s=document.getElementById('sheet'); return s && !s.hidden; }")
                page.screenshot(path=os.path.join(TMP, 'v_sheet.png'))
                page.keyboard.press('Escape')
                page.wait_for_timeout(500)
            else:
                c['sheet'] = 'no-pin'

            # ── 밤 23시
            page.click('.demo-switch button[data-scene="night"]')
            page.wait_for_timeout(3200)
            c['night'] = page.evaluate('''() => ({
                pins: document.querySelectorAll('.mk').length,
                circles: document.querySelectorAll('.leaflet-overlay-pane path').length,
                panel: (document.querySelector('.route-panel')||{}).innerText,
                legend: (document.querySelector('.map-legend')||{}).innerText,
                overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1
            })''')
            page.screenshot(path=os.path.join(OUT, 'daegu_bamnat_v2_map_night.png'))
            page.screenshot(path=os.path.join(TMP, 'v_night_full.png'))

            # 사각지대 보기 → 탭 이동
            page.click('.rn-go')
            page.wait_for_timeout(700)
            c['gap_tab'] = page.evaluate("() => document.body.getAttribute('data-tab')")
            page.screenshot(path=os.path.join(TMP, 'v_gap.png'))

            # 지금 탭 회귀 확인
            page.click('.tab[data-tab="now"]')
            page.wait_for_timeout(500)
            c['now_cards'] = page.evaluate("() => document.querySelectorAll('#nowList .place').length")
            page.screenshot(path=os.path.join(TMP, 'v_now.png'))

            # 지도 복귀 + 성서/동성로 위치 확인
            page.click('.demo-switch button[data-scene="day"]')
            for i, nm in ((1, 'dongsung'), (2, 'seongseo')):
                page.click('.tab[data-tab="now"]')
                page.wait_for_timeout(400)
                page.click('.loc-chips button[data-i="%d"]' % i)
                page.wait_for_timeout(400)
                page.click('.tab[data-tab="map"]')
                page.wait_for_timeout(2800)
                c['loc_' + nm] = page.evaluate("() => (document.querySelector('.route-panel')||{}).innerText")
                page.screenshot(path=os.path.join(TMP, 'v_loc_%s.png' % nm))
            b.close()
    finally:
        httpd.shutdown()
    print(json.dumps(rep, ensure_ascii=False, indent=1))


if __name__ == '__main__':
    main()
