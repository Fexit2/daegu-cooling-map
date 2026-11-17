/* 밤낮쉼표 — 시연 웹 앱 로직
   데이터: data/bundle.js (window.__BAMNAT__) */
(function () {
  'use strict';
  var B = window.__BAMNAT__;
  if (!B) { document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">데이터를 불러오지 못했습니다. data/bundle.js 확인</p>'; return; }

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var S = B.stats;

  var LOCS = [
    { key: 'beomeo',   name: '수성구 범어동', short: '범어동', lat: 35.8585, lon: 128.6265 },
    { key: 'dongsung', name: '중구 동성로',   short: '동성로', lat: 35.8693, lon: 128.5952 },
    { key: 'seongseo', name: '달서구 성서',   short: '성서',   lat: 35.8540, lon: 128.5300 }
  ];

  var state = { mode: 'day', tab: 'now', loc: 0, mapReady: false, routeSel: null,
                layers: { shade: true, canopy: true, shelter: true, route: true,
                          night: true, gap: true, cand: true } };

  /* ---------- 거리 ---------- */
  function dist(a, b, c, d) {
    var R = 6371000, toR = Math.PI / 180;
    var dLat = (c - a) * toR, dLon = (d - b) * toR;
    var x = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(a * toR) * Math.cos(c * toR) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(x)));
  }
  function walkMin(m) { return Math.max(1, Math.round(m / 67)); }
  function fmtDist(m) { return m < 1000 ? Math.round(m / 10) * 10 + 'm' : (m / 1000).toFixed(1) + 'km'; }
  function hhmm(v) { if (!v) return null; var s = String(v); return s.length === 3 ? '0' + s : s; }
  function timeLabel(s) {
    var t = hhmm(s); if (!t) return '—';
    if (t === '2400' || t === '0000') return '24:00';
    return t.slice(0, 2) + ':' + t.slice(2);
  }
  function hoursLabel(s) {
    var os = parseInt(s.os, 10), oe = parseInt(s.oe, 10);
    if (isNaN(os) || isNaN(oe)) return '운영시간 미입력';
    if ((os === 0 || os === 600) && (oe === 2400 || oe === 0)) return '24시간 개방';
    return timeLabel(s.os) + '–' + timeLabel(s.oe);
  }
  function isNight(s) { return s.night === true; }
  function openAt23(s) {
    var be = parseInt(s.oe, 10);
    if (isNaN(be)) return false;
    return be >= 2300 || be === 0 || be === 2400;
  }

  /* ---------- 그늘 점수 (주간) ---------- */
  var canopies = B.canopies.filter(function (c) { return c.lat; });
  function canopyNear(lat, lon) {
    var best = 1e9;
    for (var i = 0; i < canopies.length; i++) {
      var c = canopies[i];
      if (Math.abs(c.lat - lat) > 0.02 || Math.abs(c.lon - lon) > 0.02) continue;
      var d = dist(lat, lon, c.lat, c.lon);
      if (d < best) best = d;
    }
    return best;
  }
  function dayScore(s) {
    if (s.t100 === null || s.t100 === undefined) return null;
    var tree = Math.min(s.t100, 60) / 60 * 70;
    var cd = canopyNear(s.lat, s.lon);
    var can = cd > 400 ? 0 : (1 - cd / 400) * 30;
    return Math.round(tree + can);
  }

  /* ---------- 요소 ---------- */
  var heroCond = $('#heroCond'), heroTime = $('#heroTime'), heroTemp = $('#heroTemp'),
      heroLine = $('#heroLine'), heroFacts = $('#heroFacts'),
      nowTitle = $('#nowTitle'), nowSub = $('#nowSub'), nowList = $('#nowList'), nowNote = $('#nowNote'),
      metrics = $('#metrics'), locChips = $('#locChips');

  var HERO = {
    day: {
      cond: '폭염주의보', time: '11월 17일 · 14:00', temp: '36.2',
      line: '아스팔트는 52°C. 걸어서 닿는 그늘이 필요합니다.',
      facts: ['체감 38.4°', '습도 61%', '폭염일수 54일']
    },
    night: {
      cond: '열대야', time: '11월 17일 · 23:00', temp: '28.4',
      line: '해가 진 뒤 그늘은 소용없습니다. 23시에 문을 여는 곳은 6곳.',
      facts: ['최저 27.9°', '습도 71%', '열대야 평년 18.5일']
    }
  };

  function renderHero() {
    var h = HERO[state.mode];
    heroCond.textContent = h.cond;
    heroTime.textContent = h.time;
    heroTemp.textContent = h.temp;
    heroLine.textContent = h.line;
    heroFacts.innerHTML = h.facts.map(function (f) { return '<span>' + f + '</span>'; }).join('');
  }

  /* ---------- 위치 칩 ---------- */
  function renderLocs() {
    locChips.innerHTML = LOCS.map(function (l, i) {
      return '<button type="button" data-i="' + i + '" class="' + (i === state.loc ? 'on' : '') + '">' + l.name + '</button>';
    }).join('');
  }
  locChips.addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    state.loc = +b.dataset.i;
    state.routeSel = null;
    renderLocs(); renderNow(); renderMetrics();
    $('#mapLocName').textContent = LOCS[state.loc].short;
    if (state.mapReady) { syncMapToLoc(); if (state.mode === 'day') { renderMapLayers(); renderRoutePanel(); } }
  });

  /* ---------- 지금 목록 ---------- */
  function placeCard(item) {
    var pct = item.score === null ? 0 : Math.max(3, Math.min(100, item.score));
    var C = 2 * Math.PI * 19;
    return '<button type="button" class="place' + (item.score === null ? ' nodata' : '') + '" data-k="' + item.key + '">' +
      '<span class="ring"><svg viewBox="0 0 46 46"><circle class="bgc" cx="23" cy="23" r="19"/>' +
      '<circle class="fgc" cx="23" cy="23" r="19" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - pct / 100)).toFixed(1) + '"/></svg>' +
      '<i>' + item.ringText + '</i></span>' +
      '<span class="pbody"><span class="pname">' + item.name + '</span>' +
      '<span class="pbadges">' + item.badges.map(function (b) { return '<span class="badge ' + (b[1] || '') + '">' + b[0] + '</span>'; }).join('') + '</span>' +
      '<span class="pmeta">' + item.meta + '</span></span>' +
      '<span class="pdist"><b>' + item.dist + '</b><small>' + item.walk + '</small></span>' +
      '</button>';
  }

  function renderNow() {
    var loc = LOCS[state.loc];
    var items = [];
    if (state.mode === 'day') {
      nowTitle.textContent = '지금 걸어갈 만한 그늘';
      nowSub.textContent = '반경 1.2km · 그늘 점수순';
      var near = B.shelters.filter(function (s) {
        return s.lat && dist(loc.lat, loc.lon, s.lat, s.lon) <= 1200;
      });
      if (near.length < 4) {
        near = B.shelters.filter(function (s) { return s.lat; })
          .sort(function (a, b) { return dist(loc.lat, loc.lon, a.lat, a.lon) - dist(loc.lat, loc.lon, b.lat, b.lon); })
          .slice(0, 12);
      }
      near.forEach(function (s) { s._d = dist(loc.lat, loc.lon, s.lat, s.lon); s._sc = dayScore(s); });
      near.sort(function (a, b) {
        var as = a._sc === null ? -1 : a._sc, bs = b._sc === null ? -1 : b._sc;
        if (bs !== as) return bs - as;
        return a._d - b._d;
      });
      near.slice(0, 3).forEach(function (s) {
        var cd = canopyNear(s.lat, s.lon);
        var badges = [];
        if (s.t100 === null) badges.push(['가로수 데이터 없음', 'warm']);
        else badges.push(['가로수 ' + s.t100 + '그루', '']);
        if (cd < 150) badges.push(['그늘막 ' + Math.round(cd / 10) * 10 + 'm', '']);
        if (+s.ac > 0) badges.push(['에어컨 ' + s.ac + '대', '']);
        items.push({
          key: 's:' + B.shelters.indexOf(s), name: s.n,
          score: s.t100 === null ? null : s._sc,
          ringText: s.t100 === null ? '—' : String(s._sc),
          badges: badges,
          meta: (s.t || '쉼터') + ' · ' + hoursLabel(s),
          dist: fmtDist(s._d), walk: '도보 ' + walkMin(s._d) + '분'
        });
      });
      nowNote.textContent = near.some(function (s) { return s.t100 === null; })
        ? '달서구·달성군·군위군은 개별 가로수 데이터가 없어(구간 자료만) 그늘 점수를 낼 수 없습니다. 점수 없이 거리순으로 보여줍니다.'
        : '그늘 점수 = 100m 내 가로수 밀도(최대 70) + 400m 내 그늘막 근접도(최대 30).';
    } else {
      nowTitle.textContent = '밤 23시에 문 열어둔 곳';
      nowSub.textContent = '운영시간 원본 기준';
      var open = B.shelters.filter(function (s) { return s.lat && openAt23(s); });
      open.forEach(function (s) { s._d = dist(loc.lat, loc.lon, s.lat, s.lon); });
      open.sort(function (a, b) { return a._d - b._d; });
      open.slice(0, 3).forEach(function (s) {
        items.push({
          key: 's:' + B.shelters.indexOf(s), name: s.n, score: 100, ringText: '밤',
          badges: [['23시 운영', 'night']].concat(+s.ac > 0 ? [['에어컨 ' + s.ac + '대', '']] : []),
          meta: (s.t || '쉼터') + ' · ' + hoursLabel(s),
          dist: fmtDist(s._d), walk: '도보 ' + walkMin(s._d) + '분'
        });
      });
      var cands = B.cands.map(function (c) {
        return { c: c, d: dist(loc.lat, loc.lon, c.lat, c.lon) };
      }).filter(function (o) { return o.d <= 1500; }).sort(function (a, b) { return b.c.sc - a.c.sc; }).slice(0, 2);
      cands.forEach(function (o) {
        items.push({
          key: 'c:' + B.cands.indexOf(o.c), name: o.c.n, score: Math.min(100, Math.round(o.c.sc)),
          ringText: String(Math.min(100, Math.round(o.c.sc))),
          badges: [['AI 개방 후보', 'warm'], ['800m 야간 0곳', '']],
          meta: o.c.t + ' · ' + hoursLabel(o.c) + ' (개방 시 연장)',
          dist: fmtDist(o.d), walk: '도보 ' + walkMin(o.d) + '분'
        });
      });
      nowNote.textContent = '22시에 닫는 쉼터 4곳은 뺐습니다. AI 개방 후보는 점수 상위 후보일 뿐 실제 개방은 확정되지 않았습니다.';
      if (!items.length) items.push({ key: '', name: '가까운 곳에 없습니다', score: 0, ringText: '0',
        badges: [], meta: '이 위치에서 1.5km 안에 야간 개방 쉼터가 없습니다', dist: '—', walk: '' });
    }
    nowList.innerHTML = items.map(placeCard).join('');
  }

  /* ---------- 지표 ---------- */
  function renderMetrics() {
    var m = state.mode === 'day' ? [
      { v: '154', u: '곳', t: '100m 안에 가로수가 0그루인 쉼터 (가로수 6개 구 582곳 중)', c: 'warm' },
      { v: '107,144', u: '그루', t: '대구 6개 구 가로수. 2022-12 기준', c: '' },
      { v: '128', u: '곳', t: '수성구 그늘막. 그늘 면적 2,674㎡', c: 'accent' },
      { v: '54', u: '일', t: '2025년 폭염일수. 1973년 이후 2위', c: '' }
    ] : [
      { v: '6', u: '곳', t: '밤 23시에 실제로 열려 있는 무더위쉼터', c: 'warm' },
      { v: '11', u: '곳', t: '22시 넘겨 운영하는 쉼터. 전체의 0.9%', c: '' },
      { v: '1,063', u: '곳', t: '야간 개방 시설까지 도보 10분(800m) 밖 쉼터', c: 'warm' },
      { v: '18.5', u: '일', t: '대구 열대야 평년값. 최근 10년 19.1일', c: 'accent' }
    ];
    metrics.innerHTML = m.map(function (x) {
      return '<div class="metric ' + x.c + '"><b>' + x.v + '<small>' + x.u + '</small></b><span>' + x.t + '</span></div>';
    }).join('');
  }

  /* ---------- 탭 ---------- */
  function setTab(tab) {
    state.tab = tab;
    document.body.setAttribute('data-tab', tab);
    $$('.tab').forEach(function (b) { b.classList.toggle('on', b.dataset.tab === tab); });
    $$('.view').forEach(function (v) { v.classList.toggle('is-active', v.id === 'view-' + tab); });
    if (tab === 'map') {
      initMap();
      setTimeout(function () {
        if (!map) return;
        map.invalidateSize();
        if (state.mode === 'day') fitRoute(); else fitNight();
      }, 80);
    }
  }
  $$('.tab').forEach(function (b) { b.addEventListener('click', function () { setTab(b.dataset.tab); }); });

  /* ---------- 시연 모드 ---------- */
  function setMode(mode) {
    state.mode = mode;
    document.body.setAttribute('data-mode', mode);
    $$('.demo-switch button').forEach(function (b) { b.classList.toggle('on', b.dataset.scene === mode); });
    var tc = document.querySelector('meta[name="theme-color"]');
    if (tc) tc.setAttribute('content', mode === 'day' ? '#F7F4EC' : '#070B16');
    $('#brandSub').textContent = mode === 'day' ? '대구 폭염 그늘 지도' : '대구 열대야 야간 쉼터 지도';
    renderHero(); renderNow(); renderMetrics();
    state.routeSel = null;
    if (state.mapReady) {
      renderMapLayers();
      setTimeout(function () {
        if (state.mode === 'day') fitRoute(); else fitNight();
      }, 30);
    }
  }
  $$('.demo-switch button').forEach(function (b) {
    b.addEventListener('click', function () { setMode(b.dataset.scene); });
  });

  /* ---------- 바텀시트 ---------- */
  var sheet = $('#sheet'), scrim = $('#scrim'), sheetBody = $('#sheetBody');
  function openSheet(html) {
    sheetBody.innerHTML = html;
    sheet.hidden = false; scrim.hidden = false;
    requestAnimationFrame(function () { sheet.classList.add('open'); scrim.classList.add('open'); });
    sheet.setAttribute('aria-hidden', 'false');
  }
  function closeSheet() {
    sheet.classList.remove('open'); scrim.classList.remove('open');
    sheet.setAttribute('aria-hidden', 'true');
    setTimeout(function () { sheet.hidden = true; scrim.hidden = true; }, 320);
  }
  scrim.addEventListener('click', closeSheet);
  sheet.addEventListener('click', function (e) {
    if (e.target.closest('.close')) closeSheet();
  });
  sheetBody.addEventListener('click', function (e) {
    if (e.target.closest('.close')) closeSheet();
  });

  nowList.addEventListener('click', function (e) {
    var b = e.target.closest('.place'); if (!b || !b.dataset.k) return;
    var parts = b.dataset.k.split(':');
    if (parts[0] === 's') openShelter(B.shelters[+parts[1]]);
    else openCand(B.cands[+parts[1]]);
  });

  function openShelter(s) {
    var full = B.shelters.filter(function (x) { return x.n === s.n && x.g === s.g; })[0];
    if (full) s = full;
    var loc = LOCS[state.loc];
    var d = s.lat ? dist(loc.lat, loc.lon, s.lat, s.lon) : null;
    var cd = s.lat ? canopyNear(s.lat, s.lon) : null;
    var sc = dayScore(s);
    var rows = [
      ['운영시간', hoursLabel(s)],
      ['에어컨', (+s.ac > 0 ? s.ac + '대' : '없음')],
      ['선풍기', (+s.fan > 0 ? s.fan + '대' : '없음')],
      ['수용인원', (+s.cap > 0 ? s.cap + '명' : '미기재')],
      ['100m 내 가로수', (s.t100 === null ? '데이터 없음' : s.t100 + '그루')],
      ['야간 개방까지', (s.nd === null ? '—' : s.nd === 0 ? '이곳' : fmtDist(s.nd))]
    ];
    var note;
    if (state.mode === 'night') {
      note = openAt23(s)
        ? '밤 23시 기준으로 문이 열려 있는 곳입니다. 여름철 실제 운영은 구청 공지로 다시 확인해야 합니다.'
        : '밤 23시에는 닫혀 있는 곳입니다. 22시 이후 운영 여부는 원본 운영시간 그대로입니다.';
    } else if (s.t100 === null) {
      note = '이 구는 개별 가로수 데이터가 없습니다(달서·달성은 구간 자료, 군위는 자료 없음). 그늘 점수를 계산하지 않았습니다.';
    } else {
      note = '그늘 점수 ' + sc + '점 = 100m 내 가로수 ' + s.t100 + '그루(최대 70) + 그늘막 근접도(최대 30).';
    }
    openSheet(
      '<h3>' + s.n + '</h3>' +
      '<div class="s-sub">' + s.g + ' ' + (s.d || '') + ' · ' + (s.t || '쉼터') + '</div>' +
      (sc !== null && state.mode === 'day' ? '<div class="s-hero"><b>' + sc + '</b><span>그늘 점수 / 100</span></div>' : '') +
      (d !== null ? '<div class="s-sub">현재 위치에서 ' + fmtDist(d) + ' · 도보 약 ' + walkMin(d) + '분' + (cd < 400 ? ' · 그늘막 ' + fmtDist(cd) : '') + '</div>' : '') +
      '<div class="kv">' + rows.map(function (r) { return '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') + '</div>' +
      '<div class="addr">' + (s.a || '주소 미기재') + '</div>' +
      '<div class="s-note">' + note + '</div>' +
      '<button class="close" type="button">닫기</button>'
    );
  }

  function openCand(c) {
    var loc = LOCS[state.loc];
    var d = dist(loc.lat, loc.lon, c.lat, c.lon);
    var rows = [
      ['야간 개방 후보 점수', Math.round(c.sc) + '점'],
      ['유형', c.t],
      ['현재 운영시간', (c.st ? timeLabel(c.st) + '–' + timeLabel(c.en) : '미입력')],
      ['에어컨', (+c.ac > 0 ? c.ac + '대' : '없음')],
      ['수용인원', (+c.cap > 0 ? c.cap + '명' : '미기재')],
      ['800m 내 야간 개방', '없음']
    ];
    openSheet(
      '<h3>' + c.n + '</h3>' +
      '<div class="s-sub">' + c.g + ' ' + (c.d || '') + ' · 개방 후보</div>' +
      '<div class="s-hero"><b>' + Math.round(c.sc) + '</b><span>후보 점수</span></div>' +
      '<div class="s-sub">현재 위치에서 ' + fmtDist(d) + ' · 도보 약 ' + walkMin(d) + '분</div>' +
      '<div class="kv">' + rows.map(function (r) { return '<div><span>' + r[0] + '</span><b>' + r[1] + '</b></div>'; }).join('') + '</div>' +
      '<div class="addr">' + (c.a || '') + '</div>' +
      '<div class="s-note">점수 = 유형 가중(공공 38·특정계층 20) + 냉방기 + 수용인원 + 야간 공백 거리 + 주변 쉼터 밀도. 사람이 정한 규칙의 합산이며 학습 모델이 아닙니다. 개방 여부는 시·구 협의로 정해집니다.</div>' +
      '<button class="close" type="button">닫기</button>'
    );
  }

  function openCanopy(c) {
    var loc = LOCS[state.loc];
    var d = c.lat ? dist(loc.lat, loc.lon, c.lat, c.lon) : null;
    var precTxt = c.prec === 'exact' ? '주소 지오코딩 성공(건물·시설 단위)'
                  : c.prec === 'approx' ? '도로 중심선 기준 근사 위치(주소 번지 미확인)'
                  : '지오코딩 실패 — 지도에 표시하지 않음';
    openSheet(
      '<h3>그늘막 ' + (c.d || '') + '</h3>' +
      '<div class="s-sub">수성구 · ' + (c.dia || '—') + 'm 그늘막</div>' +
      (d !== null ? '<div class="s-hero"><b>' + fmtDist(d) + '</b><span>거리 · 도보 ' + walkMin(d) + '분</span></div>' : '') +
      '<div class="kv"><div><span>설치 지름</span><b>' + (c.dia || '—') + 'm</b></div>' +
      '<div><span>그늘 면적</span><b>' + (c.dia ? (Math.PI * Math.pow(c.dia / 2, 2)).toFixed(1) + '㎡' : '—') + '</b></div>' +
      '<div><span>행정동</span><b>' + (c.d || '—') + '</b></div>' +
      '<div><span>관리번호</span><b>' + (c.id || '—') + '</b></div></div>' +
      '<div class="addr">' + c.a + (c.p ? '<br>' + c.p : '') + '</div>' +
      '<div class="s-note">' + precTxt + '. 원본에 좌표가 없어 주소로 지오코딩했습니다.</div>' +
      '<button class="close" type="button">닫기</button>'
    );
  }

  /* ---------- 차트 ---------- */
  function chartGu() {
    var rows = S.gu.filter(function (g) { return g.zero100 !== null && g.shelters > 0; })
      .map(function (g) { return { gu: g.gu, pct: g.shelters ? g.zero100 / g.shelters * 100 : 0, n: g.zero100, t: g.shelters }; })
      .sort(function (a, b) { return b.pct - a.pct; });
    var max = Math.max.apply(null, rows.map(function (r) { return r.pct; }));
    $('#chartGu').innerHTML = rows.map(function (r) {
      return '<div class="bar-row' + (r.pct === max ? ' hot' : '') + '">' +
        '<span class="bl">' + r.gu + '</span>' +
        '<span class="bt"><span class="bf" style="width:' + (r.pct / max * 100).toFixed(1) + '%"></span></span>' +
        '<span class="bv">' + r.pct.toFixed(1) + '% (' + r.n + '/' + r.t + ')</span></div>';
    }).join('');
  }

  function chartHours() {
    var data = S.open_by_hour.slice(6, 24);
    var W = 320, H = 108, padL = 4, padR = 4, padT = 10, padB = 18;
    var max = Math.max.apply(null, data);
    var step = (W - padL - padR) / (data.length - 1);
    var pts = data.map(function (v, i) {
      var x = padL + i * step;
      var y = padT + (1 - v / max) * (H - padT - padB);
      return [x, y];
    });
    var line = pts.map(function (p, i) { return (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join(' ');
    var area = line + ' L' + pts[pts.length - 1][0].toFixed(1) + ' ' + (H - padB) + ' L' + pts[0][0].toFixed(1) + ' ' + (H - padB) + ' Z';
    var labels = [6, 9, 12, 15, 18, 21, 23].map(function (h) {
      var i = h - 6, x = padL + i * step;
      return '<text x="' + x.toFixed(1) + '" y="' + (H - 4) + '" font-size="9" fill="#8C8C8C" text-anchor="middle">' + h + '시</text>';
    }).join('');
    var lastH = pts[pts.length - 1];
    $('#chartHours').innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="시간대별 문 열린 쉼터 수">' +
      '<defs><linearGradient id="hg" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#2F9E6B" stop-opacity=".35"/><stop offset="1" stop-color="#2F9E6B" stop-opacity="0"/></linearGradient></defs>' +
      '<path d="' + area + '" fill="url(#hg)"/>' +
      '<path d="' + line + '" fill="none" stroke="#2F9E6B" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>' +
      labels +
      '<circle cx="' + lastH[0].toFixed(1) + '" cy="' + lastH[1].toFixed(1) + '" r="3.6" fill="#D9521C"/>' +
      '<text x="' + (lastH[0] - 4).toFixed(1) + '" y="' + (lastH[1] - 8).toFixed(1) + '" font-size="10" font-weight="700" fill="#D9521C" text-anchor="end">23시 6곳</text>' +
      '<text x="' + padL + '" y="' + (padT + 2) + '" font-size="9" fill="#8C8C8C">14시 1,199곳</text>' +
      '</svg>';
  }

  function chartSu() {
    var a = B.gu_extra.su_city_n, b = S.su.n;
    var max = Math.max(a, b);
    $('#chartSu').innerHTML =
      '<div class="bar-row"><span class="bl">시</span><span class="bt"><span class="bf" style="width:' + (a / max * 100) + '%"></span></span><span class="bv">' + a + '곳</span></div>' +
      '<div class="bar-row hot"><span class="bl">수성구</span><span class="bt"><span class="bf" style="width:' + (b / max * 100) + '%"></span></span><span class="bv">' + b + '곳</span></div>' +
      '<div style="margin-top:8px;font-size:10.5px;color:var(--sub);line-height:1.55">' +
      '냉방 보유: 시 목록 ' + B.gu_extra.su_city_ac + '/' + a + ' · 구 대장 ' + S.su.ac_y + '/' + b +
      ' &nbsp;|&nbsp; 야간 운영: 시 목록 ' + B.gu_extra.su_city_night + '곳 · 구 대장 ' + S.su.night_y + '곳</div>';
  }

  function renderRank() {
    var rows = B.cands.slice(0, 5).map(function (c, i) {
      return '<button class="rank-item" type="button" data-c="' + B.cands.indexOf(c) + '">' +
        '<span class="ri-n">' + (i + 1) + '</span>' +
        '<span class="ri-b"><span class="ri-t">' + c.n + '</span>' +
        '<span class="ri-s">' + c.g + ' ' + (c.d || '') + ' · ' + c.t + ' · 주변 쉼터 ' + c.nb + '곳</span></span>' +
        '<span class="ri-sc">' + Math.round(c.sc) + '</span></button>';
    }).join('');
    $('#candRank').innerHTML = rows;
  }
  $('#candRank').addEventListener('click', function (e) {
    var b = e.target.closest('.rank-item'); if (!b) return;
    openCand(B.cands[+b.dataset.c]);
  });

  function renderSources() {
    $('#srcList').innerHTML = B.meta.sources.map(function (s) {
      return '<li><b>' + s.name + '</b><span>' + s.org + ' · ' + s.date + ' · ' + s.rows + '</span>' +
        '<br><a href="' + s.url + '" target="_blank" rel="noopener">' + s.url + '</a></li>';
    }).join('');
  }

  /* ---------- 지도 ---------- */
var map = null, tileLayer = null, groupDay = null, groupNight = null,
    shadeOv = null, gapOv = null,
    nightPins = null, nightCircles = null, candPins = null,
    canopyPins = null, shelterPins = null, routeLayer = null,
    routeLineShort = null, routeLineShady = null,
    tileErrors = 0, offline = false, moveTimer = null;

var RB = (window.__BAMNAT_RASTER__ || {}).bounds || { south: 35.78, west: 128.48, north: 36.01, east: 128.78 };
var RBOUNDS = [[RB.south, RB.west], [RB.north, RB.east]];

function routeFor() { return B.routes ? B.routes[LOCS[state.loc].key] : null; }

/* ---- 아이콘 ---- */
function svgPin(kind) {
  if (kind === 'canopy') {
    return '<div class="pin pin-canopy"><svg viewBox="0 0 22 22">' +
      '<circle cx="11" cy="11" r="9.6" fill="#2E7BE0" stroke="#fff" stroke-width="1.7"/>' +
      '<path d="M5.6 11.1c0-3 2.4-4.9 5.4-4.9s5.4 1.9 5.4 4.9z" fill="#fff"/>' +
      '<path d="M11 11.1v3.9M9.2 15h3.6" stroke="#fff" stroke-width="1.4" stroke-linecap="round"/></svg></div>';
  }
  if (kind === 'warn') {
    return '<div class="pin pin-warn"><svg viewBox="0 0 28 32">' +
      '<path d="M14 1c7.2 0 13 5.6 13 12.6C27 22 14 31 14 31S1 22 1 13.6C1 6.6 6.8 1 14 1z" fill="#E2612E" stroke="#fff" stroke-width="1.9"/>' +
      '<path d="M14 8.4v8.2" stroke="#fff" stroke-width="2.6" stroke-linecap="round"/>' +
      '<circle cx="14" cy="21.6" r="1.6" fill="#fff"/></svg></div>';
  }
  if (kind === 'night' || kind === 'night22') {
    var late = kind === 'night';
    return '<div class="pin pin-night' + (late ? '' : ' pin-night-22') + '">' + (late ? '<span class="pulse"></span>' : '') +
      '<svg viewBox="0 0 28 32">' +
      '<path d="M14 1c7.2 0 13 5.6 13 12.6C27 22 14 31 14 31S1 22 1 13.6C1 6.6 6.8 1 14 1z" fill="' +
      (late ? '#8F7CFF' : '#5C5296') + '" stroke="#fff" stroke-width="1.9"/>' +
      '<path d="M17.6 9.2a6.4 6.4 0 1 0 3.1 8.9 7.4 7.4 0 0 1-3.1-8.9z" fill="#fff" opacity="' + (late ? 1 : .82) + '"/></svg></div>';
  }
  if (kind === 'cand') {
    return '<div class="pin pin-cand"><svg viewBox="0 0 24 24">' +
      '<circle cx="12" cy="12" r="8" fill="none" stroke="#FF8A3D" stroke-width="2.4" stroke-dasharray="3 3"/>' +
      '<circle cx="12" cy="12" r="2.6" fill="#FF8A3D"/></svg></div>';
  }
  // 기본: 무더위쉼터
  return '<div class="pin pin-shelter"><svg viewBox="0 0 28 32">' +
    '<path d="M14 1c7.2 0 13 5.6 13 12.6C27 22 14 31 14 31S1 22 1 13.6C1 6.6 6.8 1 14 1z" fill="#0E7A55" stroke="#fff" stroke-width="1.9"/>' +
    '<path d="M6.6 12.4h14.8M6.6 12.4l2.6-3.9h9.6l2.6 3.9" fill="none" stroke="#fff" stroke-width="1.7" stroke-linejoin="round"/>' +
    '<path d="M8.8 15.2h10.4v4.6H8.8z" fill="#fff" opacity=".92"/></svg></div>';
}

function pinIcon(kind, size) {
  var w = size[0], h = size[1];
  return L.divIcon({
    className: 'mk', html: svgPin(kind),
    iconSize: [w, h], iconAnchor: [w / 2, h - 1]
  });
}

/* ---- 지도 초기화 ---- */
function initMap() {
  if (state.mapReady || !window.L) return;
  state.mapReady = true;
  var loc = LOCS[state.loc];
  map = L.map('map', {
    center: [loc.lat, loc.lon], zoom: 15, zoomSnap: 0.5, zoomDelta: 0.5,
    zoomControl: false, attributionControl: true, preferCanvas: true
  });
  tileLayer = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors'
  });
  tileLayer.on('tileerror', function () {
    tileErrors++;
    if (tileErrors > 5 && !offline) {
      offline = true;
      map.removeLayer(tileLayer);
      $('#offlineNote').hidden = false;
      $('.map').style.background = getComputedStyle(document.body).getPropertyValue('--bg-2');
    }
  });
  tileLayer.addTo(map);

  groupDay = L.layerGroup().addTo(map);
  groupNight = L.layerGroup();

  shadeOv = L.imageOverlay((window.__BAMNAT_RASTER__ || {}).shade, RBOUNDS,
    { opacity: 1, interactive: false, className: 'ov-shade' });
  gapOv = L.imageOverlay((window.__BAMNAT_RASTER__ || {}).gap, RBOUNDS,
    { opacity: 1, interactive: false, className: 'ov-gap' });

  shelterPins = L.layerGroup();
  canopyPins = L.layerGroup();
  routeLayer = L.layerGroup();
  nightPins = L.layerGroup();
  nightCircles = L.layerGroup();
  candPins = L.layerGroup();

  map.on('zoomend', function () { syncZoom(); renderLegend(); });
  map.on('moveend', function () {
    clearTimeout(moveTimer);
    moveTimer = setTimeout(function () {
      refreshShelterPins();
      if (state.mode === 'day' && state.layers.canopy && map.getZoom() >= 13) renderCanopies();
    }, 140);
  });
  map.on('click', function () { closeSheet(); });

  renderMapLayers();
}

/* ---- 레이어 구성 ---- */
function renderMapLayers() {
  if (!state.mapReady) return;
  groupDay.clearLayers(); groupNight.clearLayers();
  shelterPins.clearLayers(); canopyPins.clearLayers();
  routeLayer.clearLayers(); nightPins.clearLayers(); nightCircles.clearLayers(); candPins.clearLayers();

  if (state.mode === 'day') {
    if (state.layers.shade) {
      groupDay.addLayer(shadeOv);
      /* 달서·달성 가로수길 구간은 개별 나무 좌표가 없어 지도에 선으로 그리지 않고,
         그늘 비율 계산에만 쓴다(직선 구간이라 지도에서 인위적으로 보임). */
    }
    if (state.layers.canopy) { groupDay.addLayer(canopyPins); renderCanopies(); }
    if (state.layers.shelter) { groupDay.addLayer(shelterPins); }
    if (state.layers.route) { groupDay.addLayer(routeLayer); renderRoutes(); }

    if (map.hasLayer(groupNight)) map.removeLayer(groupNight);
    if (!map.hasLayer(groupDay)) groupDay.addTo(map);
    syncZoom();
  } else {
    if (state.layers.gap) groupNight.addLayer(gapOv);
    if (state.layers.night) {
      groupNight.addLayer(nightCircles); groupNight.addLayer(nightPins);
      renderNight();
    }
    if (state.layers.cand) { groupNight.addLayer(candPins); renderCands(); }

    if (map.hasLayer(groupDay)) map.removeLayer(groupDay);
    if (!map.hasLayer(groupNight)) groupNight.addTo(map);
  }
  renderLayerChips(); renderLegend(); renderRoutePanel();
}

function renderCanopies() {
  canopyPins.clearLayers();
  if (!map) return;
  var b = map.getBounds().pad(0.2);
  B.canopies.forEach(function (c) {
    if (!c.lat || !b.contains([c.lat, c.lon])) return;
    var ic = L.divIcon({
      className: 'mk', html: svgPin('canopy'),
      iconSize: [20, 20], iconAnchor: [10, 10]
    });
    L.marker([c.lat, c.lon], { icon: ic, title: '그늘막 ' + (c.d || '') })
      .on('click', function () { openCanopy(c); }).addTo(canopyPins);
  });
}

function renderNight() {
  nightPins.clearLayers(); nightCircles.clearLayers();
  B.night.forEach(function (s) {
    var late = openAt23(s);
    L.marker([s.lat, s.lon], { icon: pinIcon(late ? 'night' : 'night22', late ? [26, 30] : [22, 26]), title: s.n })
      .on('click', function () { openShelter(s); }).addTo(nightPins);
    L.circle([s.lat, s.lon], {
      radius: 800, color: late ? '#C6BBFF' : '#8E85C4', weight: late ? 1.5 : 1.1,
      opacity: late ? 0.9 : 0.55, dashArray: '3 6',
      fillColor: late ? '#8F7CFF' : '#5C5296', fillOpacity: late ? 0.2 : 0.1, interactive: false
    }).addTo(nightCircles);
  });
}

function renderCands() {
  candPins.clearLayers();
  B.cands.slice(0, 14).forEach(function (c) {
    L.marker([c.lat, c.lon], { icon: pinIcon('cand', [22, 22]), title: 'AI 개방 후보 ' + c.n })
      .on('click', function () { openCand(c); }).addTo(candPins);
  });
}

function syncZoom() {
  if (!map) return;
  var z = map.getZoom();
  var showCanopy = state.mode === 'day' && state.layers.canopy && z >= 13;
  if (showCanopy && !map.hasLayer(canopyPins)) canopyPins.addTo(groupDay);
  if (!showCanopy && map.hasLayer(canopyPins)) groupDay.removeLayer(canopyPins);
  refreshShelterPins();
}

function refreshShelterPins() {
  if (!shelterPins || !map) return;
  shelterPins.clearLayers();
  if (state.mode !== 'day' || !state.layers.shelter || map.getZoom() < 14) return;
  var b = map.getBounds().pad(0.15), n = 0;
  var r = routeFor();
  var dz = r ? [r.dest.lat, r.dest.lon] : null;
  for (var i = 0; i < B.shelters.length && n < 120; i++) {
    var s = B.shelters[i];
    if (!s.lat || !b.contains([s.lat, s.lon])) continue;
    if (dz && state.layers.route && dist(s.lat, s.lon, dz[0], dz[1]) < 60) continue;
    var warn = s.t100 === 0;
    L.marker([s.lat, s.lon], {
      icon: pinIcon(warn ? 'warn' : 'shelter', warn ? [24, 28] : [21, 25]),
      title: s.n, zIndexOffset: warn ? 500 : 0
    }).on('click', function (ss) { return function () { openShelter(ss); }; }(s)).addTo(shelterPins);
    n++;
  }
}

/* ---- 경로 ---- */
function renderRoutes() {
  routeLayer.clearLayers(); routeLineShort = routeLineShady = null;
  var r = routeFor();
  if (!r) return;
  var A = [r.from.lat, r.from.lon], Z = [r.dest.lat, r.dest.lon];

  if (r.shady) {
    L.polyline(r.shady.pts, { color: '#FFFFFF', weight: 10, opacity: 0.6, lineCap: 'round', interactive: false }).addTo(routeLayer);
    routeLineShady = L.polyline(r.shady.pts, { color: '#0B8A6D', weight: 5.5, opacity: 1, lineCap: 'round', interactive: false }).addTo(routeLayer);
  }
  routeLineShort = L.polyline(r.shortest.pts, {
    color: '#E2612E', weight: 4.4, opacity: 0.95, dashArray: '0.6 9', lineCap: 'round', interactive: false
  }).addTo(routeLayer);

  L.marker(A, {
    icon: L.divIcon({
      className: 'mk', html: '<div class="pin-origin"><span></span></div>',
      iconSize: [30, 30], iconAnchor: [15, 15]
    }), zIndexOffset: 800, interactive: false
  }).addTo(routeLayer);

  L.marker(Z, {
    icon: L.divIcon({
      className: 'mk',
      html: '<div class="pin-dest"><div class="pd-label">' + r.dest.name + '</div>' +
        '<svg viewBox="0 0 28 32"><path d="M14 1c7.2 0 13 5.6 13 12.6C27 22 14 31 14 31S1 22 1 13.6C1 6.6 6.8 1 14 1z" fill="#123D31" stroke="#fff" stroke-width="2"/>' +
        '<path d="M9 13.4h10M9 13.4l1.9-2.8h6.2l1.9 2.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/>' +
        '<path d="M11 16.4h6v2.8h-6z" fill="#fff"/></svg></div>',
      iconSize: [28, 32], iconAnchor: [14, 31]
    }), zIndexOffset: 900
  }).on('click', function () { openShelter(r.dest); }).addTo(routeLayer);

  emphasizeRoute();
}

function emphasizeRoute() {
  if (!routeLineShort) return;
  var sel = state.routeSel;
  routeLineShort.setStyle({
    opacity: sel === 'shady' ? 0.3 : 0.98,
    weight: sel === 'shady' ? 3.6 : 4.8
  });
  if (routeLineShady) {
    routeLineShady.setStyle({ opacity: sel === 'shortest' ? 0.32 : 1, weight: sel === 'shortest' ? 4.4 : 6 });
  }
}

function fitRoute() {
  var r = routeFor();
  if (!r || !map) return;
  var pts = r.shortest.pts.concat(r.shady ? r.shady.pts : []);
  map.fitBounds(L.latLngBounds(pts), { paddingTopLeft: [46, 92], paddingBottomRight: [46, 176], maxZoom: 15.5, animate: true });
}

function fitNight() {
  if (!map) return;
  map.setView([35.868, 128.606], 12.8, { animate: true });
}

function syncMapToLoc() {
  var loc = LOCS[state.loc];
  $('#mapLocName').textContent = loc.short;
  if (!map) return;
  if (state.mode === 'day') { map.setView([loc.lat, loc.lon], 15, { animate: true }); fitRoute(); }
  else { fitNight(); }
}
var recenterBtn = $('#mapRecenter');
if (recenterBtn) recenterBtn.addEventListener('click', syncMapToLoc);

/* ---- 칩 · 범례 · 카드 ---- */
var LAYERS_DAY = [
  { k: 'shade', label: '그늘 띠', color: '#1FA37B' },
  { k: 'canopy', label: '그늘막', color: '#2E7BE0' },
  { k: 'shelter', label: '쉼터', color: '#0E7A55' },
  { k: 'route', label: '그늘길', color: '#E2612E' }
];
var LAYERS_NIGHT = [
  { k: 'night', label: '야간 개방', color: '#8F7CFF' },
  { k: 'gap', label: '사각지대', color: '#FF8A3D' },
  { k: 'cand', label: 'AI 후보', color: '#FFB27A' }
];

function renderLayerChips() {
  var list = state.mode === 'day' ? LAYERS_DAY : LAYERS_NIGHT;
  $('#layerChips').innerHTML = list.map(function (l) {
    return '<button type="button" data-l="' + l.k + '" class="' + (state.layers[l.k] ? '' : 'off') + '">' +
      '<span class="ld" style="background:' + l.color + '"></span>' + l.label + '</button>';
  }).join('');
}

function bindChips() {
  $('#layerChips').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    var k = b.dataset.l;
    state.layers[k] = !state.layers[k];
    renderMapLayers();
  });
}

function renderLegend() {
  var html;
  if (state.mode === 'day') {
    html = '<span><i class="lg-shade"></i>그늘 띠</span>' +
      '<span><i class="lg-canopy"></i>그늘막</span>' +
      '<span><i class="lg-shelter"></i>쉼터</span>' +
      '<span><i class="lg-warn"></i>가로수 0그루</span>';
  } else {
    html = '<span><i class="lg-night"></i>23시 개방 6곳</span>' +
      '<span><i class="lg-night22"></i>22시 마감 4곳</span>' +
      '<span><i class="lg-ring"></i>도보 10분(800m)</span>' +
      '<span><i class="lg-gap"></i>야간 사각지대</span>';
  }
  $('#mapLegend').innerHTML = html;
}

function renderRoutePanel() {
  var el = $('#routePanel');
  if (!el) return;
  if (state.mode === 'night') {
    el.innerHTML =
      '<div class="rp-head"><b>밤에는 그늘이 사라집니다</b><span>낮 그늘지도는 여기서 끝</span></div>' +
      '<div class="rp-night">' +
        '<div class="rn-cell"><b>6<small>곳</small></b><span>23시 문 연 쉼터</span></div>' +
        '<div class="rn-cell"><b>1,063<small>곳</small></b><span>도보 10분 밖</span></div>' +
        '<button type="button" class="rn-go" data-go="gap">사각지대 보기</button>' +
      '</div>';
    return;
  }
  var r = routeFor();
  if (!r) { el.innerHTML = ''; return; }
  var sel = state.routeSel;
  var diffMin = (r.shady && r.shortest) ? (r.shady.min - r.shortest.min) : 0;
  function opt(kind, label, d) {
    if (!d) {
      return '<div class="rp-opt is-off"><span class="rp-k">' + label + '</span>' +
        '<span class="rp-v">—</span><span class="rp-s">가로수 데이터 없음</span></div>';
    }
    var tag = (kind === 'shady' && r.shady && diffMin !== 0)
      ? ' <em class="rp-d">' + (diffMin > 0 ? '+' : '−') + Math.abs(diffMin) + '분</em>' : '';
    var on = sel === kind ? ' on' : '';
    return '<button type="button" class="rp-opt ' + kind + on + '" data-r="' + kind + '">' +
      '<span class="rp-k">' + label + tag + '</span>' +
      '<span class="rp-v">' + d.min + '분<small>' + d.m + 'm</small></span>' +
      '<span class="rp-bar"><i style="width:' + Math.max(3, d.shade) + '%"></i></span>' +
      '<span class="rp-s">그늘 ' + d.shade + '%</span></button>';
  }
  el.innerHTML =
    '<div class="rp-head"><b>' + r.from.label + ' → ' + r.dest.name + '</b>' +
      '<span>' + (r.shady ? '경유 ' + r.shady.via : '도보 경로') + '</span></div>' +
    '<div class="rp-cmp">' + opt('shortest', '최단길', r.shortest) + opt('shady', '그늘길', r.shady) + '</div>' +
    '<p class="rp-note">' +
      '가까운 쉼터 5곳 중 그늘길이 있는 곳을 골랐습니다. ' +
      (r.dest.gu === '달서구' || r.dest.gu === '달성군'
        ? '달서구·달성군은 개별 가로수 좌표가 없어 가로수길 구간 자료로만 계산했습니다.'
        : '거리는 OSM 보행로, 그늘 비율은 가로수 107,144그루 좌표로 계산한 추정치입니다.') +
      '</p>';
}

function bindRoutePanel() {
  var el = $('#routePanel');
  el.addEventListener('click', function (e) {
    var go = e.target.closest('[data-go]');
    if (go) { setTab(go.dataset.go); return; }
    var b = e.target.closest('.rp-opt');
    if (!b || b.classList.contains('is-off')) return;
    state.routeSel = (state.routeSel === b.dataset.r) ? null : b.dataset.r;
    emphasizeRoute(); renderRoutePanel();
  });
}

/* ---------- 시작 ---------- */
  renderLocs();
  renderHero();
  renderNow();
  renderMetrics();
  renderSources();
  chartGu(); chartHours(); chartSu(); renderRank();
  bindChips(); bindRoutePanel(); renderRoutePanel();
  mapScopeGuard();

  function mapScopeGuard() {
    /* 지도 탭이 열리기 전에는 Leaflet을 초기화하지 않음(레이아웃 0 방지) */
    var obs = setInterval(function () {
      if (state.tab === 'map' && !state.mapReady) { initMap(); clearInterval(obs); }
    }, 400);
  }

  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeSheet(); });
})();
