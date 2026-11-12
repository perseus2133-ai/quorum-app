// 종목 상세의 캔들 차트 — 일봉(기본)·주봉·월봉 전환.
//
// 데이터는 일일 워크플로(export_charts.py)가 mobile-data 브랜치 charts/{code}.json 에
// 미리 올려 둔 것을 Store.fetchChart 로 받는다. 폰은 네이버를 직접 부르지 않는다
// (다른 출처 요청은 CORS 로 막힌다). 외부 차트 라이브러리 없이 SVG 로 그린다.
(function (root) {
  'use strict';

  const W = 380, H = 252, L = 62, R = 370, TOP = 14, BOT = 171, VTOP = 191, VBOT = 226;
  const UP = '#EF4444', DOWN = '#3B82F6', FLAT = '#94A3B8';
  const MA = [[6, 5, '#F59E0B'], [7, 20, '#2DD4BF'], [8, 60, '#C084FC']];
  const KIND = {
    d: { label: '일봉', span: '최근 6개월', unit: '일' },
    w: { label: '주봉', span: '최근 2년', unit: '주' },
    m: { label: '월봉', span: '최근 10년', unit: '개월' },
  };
  const isNum = (v) => typeof v === 'number' && isFinite(v);
  const fmt = (v) => (isNum(v) ? Math.round(v).toLocaleString('ko-KR') : '—');
  // 세로축 눈금 — 7자리 이상은 칸을 넘으니 만 단위로 줄인다
  // (한 차트 안에서는 단위를 섞지 않는다 — 최고값 기준으로 정한다)
  const tick = (v, top) => (v <= 0 ? '0' : top >= 1e6 ? (v / 1e4).toLocaleString('ko-KR', { maximumFractionDigits: top >= 1e7 ? 0 : 1 }) + '만' : fmt(v));
  const f2 = (v) => v.toFixed(2);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function vol(v) {
    if (!isNum(v)) return '자료 없음';
    if (v >= 1e8) return (v / 1e8).toFixed(1) + '억주';
    if (v >= 1e4) return Math.round(v / 1e4).toLocaleString('ko-KR') + '만주';
    return v.toLocaleString('ko-KR') + '주';
  }
  // 축 눈금용 짧은 날짜, 상세용 긴 날짜
  function axisDate(d, kind) {
    if (kind === 'm') return d.slice(0, 4);
    if (kind === 'w') return d.slice(2, 7).replace('-', '.');
    return d.slice(5).replace('-', '/');
  }
  function longDate(d, kind) {
    if (kind === 'm') return d.slice(0, 7);
    if (kind === 'w') return d + ' 주';
    return d;
  }

  function valid(rows) {
    if (!Array.isArray(rows)) return [];
    return rows.filter((r) => Array.isArray(r) && r.length === 9 && typeof r[0] === 'string' &&
      r.slice(1, 5).every((n) => isNum(n) && n > 0) && r[3] <= Math.min(r[1], r[4]) && r[2] >= Math.max(r[1], r[4]));
  }

  function svg(rows, kind) {
    const prices = rows.flatMap((r) => [r[2], r[3]].concat(r.slice(6).filter(isNum)));
    let lo = Math.min(...prices), hi = Math.max(...prices);
    const pad = Math.max((hi - lo) * 0.06, hi * 0.01, 1);
    lo = Math.max(0, lo - pad); hi += pad;
    const y = (p) => BOT - (p - lo) / (hi - lo) * (BOT - TOP);
    const step = (R - L) / rows.length, body = Math.max(0.6, Math.min(6, step * 0.7));
    const x = (i) => L + step * (i + 0.5);
    const vmax = Math.max(0, ...rows.map((r) => r[5] || 0));
    let out = `<svg class="qc-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${KIND[kind].label}과 거래량, 5·20·60${KIND[kind].unit} 이동평균선">`;
    for (let i = 0; i < 4; i++) {
      const p = lo + (hi - lo) * i / 3, yy = y(p);
      out += `<line x1="${L}" x2="${R}" y1="${f2(yy)}" y2="${f2(yy)}" class="qc-grid"/>` +
        `<text x="${L - 5}" y="${f2(yy + 4)}" text-anchor="end">${tick(p, hi)}</text>`;
    }
    out += `<text x="5" y="${VTOP + 13}">거래량</text>`;
    rows.forEach((r, i) => {
      const c = r[4] > r[1] ? UP : r[4] < r[1] ? DOWN : FLAT;
      out += `<line x1="${f2(x(i))}" x2="${f2(x(i))}" y1="${f2(y(r[2]))}" y2="${f2(y(r[3]))}" stroke="${c}" stroke-width=".8"/>` +
        `<rect x="${f2(x(i) - body / 2)}" y="${f2(Math.min(y(r[1]), y(r[4])))}" width="${f2(body)}" height="${f2(Math.max(1, Math.abs(y(r[1]) - y(r[4]))))}" fill="${c}"/>`;
      if (vmax && isNum(r[5])) {
        const h = r[5] / vmax * (VBOT - VTOP);
        out += `<rect x="${f2(x(i) - body / 2)}" y="${f2(VBOT - h)}" width="${f2(body)}" height="${f2(h)}" fill="${c}" opacity=".55"/>`;
      }
    });
    MA.forEach(([col, , color]) => {
      let on = false;
      const cmd = [];
      rows.forEach((r, i) => {
        if (!isNum(r[col])) { on = false; return; }
        cmd.push(`${on ? 'L' : 'M'}${f2(x(i))},${f2(y(r[col]))}`); on = true;
      });
      if (cmd.length) out += `<path d="${cmd.join(' ')}" fill="none" stroke="${color}" stroke-width="1.3"/>`;
    });
    [...new Set([0, 1, 2, 3].map((n) => Math.round((rows.length - 1) * n / 3)))].forEach((i) => {
      const anchor = i === 0 ? 'start' : i === rows.length - 1 ? 'end' : 'middle';
      out += `<text x="${f2(x(i))}" y="246" text-anchor="${anchor}">${axisDate(rows[i][0], kind)}</text>`;
    });
    return out + `<line class="qc-cursor" y1="${TOP}" y2="${VBOT}"/></svg>`;
  }

  const head = (kind) => `<div class="qc-head"><span class="qc-title">📈 주가 차트</span>
    <div class="seg qc-seg" role="tablist" aria-label="차트 주기">${Object.keys(KIND).map((k) =>
      `<button type="button" role="tab" data-period="${k}" class="${k === kind ? 'on' : ''}" aria-selected="${k === kind}">${KIND[k].label}</button>`).join('')}</div></div>`;

  function draw(host, data, kind) {
    const rows = valid(data[kind]);
    const k = KIND[kind];
    if (!rows.length) {
      host.innerHTML = head(kind) + `<p class="qc-note">${k.label} 자료가 없다.</p>`;
      return;
    }
    const last = rows[rows.length - 1];
    const stale = data.status === 'stale';
    host.innerHTML = head(kind) +
      (stale ? '<p class="qc-warn">오늘 수집에 실패해 이전 자료를 보여준다. 기준일을 확인할 것.</p>' : '') +
      `<div class="qc-note">${k.span} · ${rows.length}개 ${k.label} · 마지막 ${esc(longDate(last[0], kind))} 종가 ${fmt(last[4])}원</div>
       <div class="qc-legend"><span style="color:${UP}">■ 양봉</span><span style="color:${DOWN}">■ 음봉</span>${MA.map(([, p, c]) => `<span style="color:${c}">━ ${p}${k.unit}</span>`).join('')}</div>
       ${svg(rows, kind)}
       <input class="qc-slider" type="range" min="0" max="${rows.length - 1}" step="1" value="${rows.length - 1}" aria-label="${k.label} 날짜 선택">
       <div class="qc-detail" aria-live="polite"></div>
       <div class="qc-note qc-src">네이버 차트 · ${esc(data.asof || '')} 수집 · 실시간 시세 아님${kind === 'd' ? '' : ' · 마지막 봉은 진행 중일 수 있음'}</div>`;

    const slider = host.querySelector('.qc-slider'), detail = host.querySelector('.qc-detail');
    const chart = host.querySelector('svg'), cursor = host.querySelector('.qc-cursor');
    function pick(i) {
      i = Math.max(0, Math.min(rows.length - 1, i));
      const r = rows[i], prev = rows[i - 1];
      slider.value = i;
      const chg = prev ? (r[4] / prev[4] - 1) * 100 : null;
      const chgTxt = isNum(chg) ? ` <span style="color:${chg > 0 ? UP : chg < 0 ? DOWN : FLAT}">${chg > 0 ? '+' : ''}${chg.toFixed(2)}%</span>` : '';
      detail.innerHTML = `<b>${esc(longDate(r[0], kind))}</b>${chgTxt}
        <div>시 ${fmt(r[1])} · 고 ${fmt(r[2])}</div>
        <div>저 ${fmt(r[3])} · 종 <b>${fmt(r[4])}원</b></div>
        <div>거래량 ${vol(r[5])}</div>
        <div class="qc-legend">${MA.map(([c, p, color]) => `<span style="color:${color}">${p}${k.unit} ${isNum(r[c]) ? fmt(r[c]) : '자료 부족'}</span>`).join('')}</div>`;
      const xx = L + (R - L) / rows.length * (i + 0.5);
      cursor.setAttribute('x1', xx); cursor.setAttribute('x2', xx);
    }
    slider.addEventListener('input', () => pick(Number(slider.value)));
    chart.addEventListener('click', (ev) => {
      const rect = chart.getBoundingClientRect();
      if (rect.width) pick(Math.floor(((ev.clientX - rect.left) / rect.width * W - L) / (R - L) * rows.length));
    });
    pick(rows.length - 1);
  }

  // 같은 종목을 다시 그릴 때(룰 보기 전환 등)는 고른 주기를 유지하고,
  // 다른 종목으로 들어가면 일봉으로 돌아간다.
  const state = { code: null, kind: 'd' };

  async function mount(host) {
    const code = host.dataset.chartCode;
    if (state.code !== code) { state.code = code; state.kind = 'd'; }
    host.innerHTML = head(state.kind) + '<p class="qc-note">차트 불러오는 중…</p>';
    let data;
    try {
      data = await root.Store.fetchChart(code, host.dataset.chartGen || '');
    } catch (e) {
      if (!host.isConnected) return;
      const msg = e && e.kind === 'notfound'
        ? '이 종목은 차트를 모으지 않았다 — 보드에 오른 종목만 매일 받는다.'
        : '차트를 받지 못했다. 다른 정보는 계속 볼 수 있다.';
      host.innerHTML = head(state.kind) + `<p class="qc-note">${msg}</p>` +
        (e && e.kind === 'notfound' ? '' : '<button type="button" class="btn sm qc-retry">다시 불러오기</button>');
      const retry = host.querySelector('.qc-retry');
      if (retry) retry.addEventListener('click', () => mount(host));
      return;
    }
    if (!host.isConnected) return;
    draw(host, data, state.kind);
    host.onclick = (ev) => {
      const b = ev.target.closest('[data-period]');
      if (!b || b.dataset.period === state.kind) return;
      state.kind = b.dataset.period;
      draw(host, data, state.kind);
    };
  }

  function hydrate(container) {
    container.querySelectorAll('[data-chart-code]').forEach(mount);
  }

  root.QChart = { hydrate, valid, svg };
})(self);
