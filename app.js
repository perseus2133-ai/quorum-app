// quorum 모바일 — 화면.
//
// 계산은 하지 않는다. 일일 워크플로가 만든 결과(Store)를 읽어 보여주고,
// 폰에만 있는 보유 종목에 매매룰(TR)을 건다. 화면 구성은 Streamlit 판의
// 다섯 탭(ui/pages/*.py)을 따른다.
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const view = $('#view');

  const FAMS = ['VALUE', 'GROWTH', 'MOMENTUM', 'QUALITY'];
  const FAM_LABEL = { VALUE: '가치', GROWTH: '성장', MOMENTUM: '모멘텀', QUALITY: '퀄리티' };
  const FAM_COLOR = { VALUE: '#38BDF8', GROWTH: '#A78BFA', MOMENTUM: '#FB923C', QUALITY: '#34D399' };
  const GRADES = ['QUORUM', 'STRONG', 'WATCH', 'NEUTRAL', 'AVOID'];
  const GRADE_LABEL = {
    QUORUM: '🏆 QUORUM', STRONG: '🔥 STRONG', WATCH: '👀 WATCH', NEUTRAL: '○ NEUTRAL', AVOID: '⚠️ AVOID',
  };
  const GRADE_COLOR = {
    QUORUM: '#FBBF24', STRONG: '#F87171', WATCH: '#38BDF8', NEUTRAL: '#94A3B8', AVOID: '#64748B',
  };
  const K = { pos: '#34D399', neg: '#F87171', warn: '#FBBF24', accent: '#60A5FA', text: '#E8EDF5', dim: '#8B98AC', mute: '#5A6678' };
  const YEARS = [2023, 2024, 2025, 2026, 2027, 2028];
  const FIRST_ESTIMATE_YEAR = 2026;
  const PAGE = 24;
  const STALE_HOURS = 30;      // 하루 한 번 갱신 — 이보다 오래되면 워크플로가 멈춘 것이다

  const S = {
    data: null, byCode: {}, rank: {}, priceMap: {}, sectorMap: {},
    loading: false, error: null, lastRoute: '',
    ui: {
      grades: new Set(['QUORUM', 'STRONG', 'WATCH']), market: 'ALL', fams: new Set(),
      topn: PAGE, q: '', horizon: null, ruleView: 'picked',
      editing: null, pick: null, confirm: null,
    },
  };

  // ── 표기 ───────────────────────────────────────────────────
  const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ESC[c]);
  const isNum = (v) => typeof v === 'number' && isFinite(v);

  function fnum(v, unit, digits, plus) {
    if (!isNum(v)) return '—';
    const d = digits || 0;
    const s = v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
    return (plus && v >= 0 ? '+' : '') + s + (unit || '');
  }
  // 억 단위 시총 → 조/억
  const fmcap = (v) => (!isNum(v) ? '—' : Math.abs(v) >= 10000 ? fnum(v / 10000, '조', 1) : fnum(v, '억'));
  // 원 단위 금액 → 조/억/만
  function fwon(v) {
    if (!isNum(v)) return '—';
    const a = Math.abs(v);
    if (a >= 1e12) return fnum(v / 1e12, '조', 1);
    if (a >= 1e8) return fnum(v / 1e8, '억', a >= 1e10 ? 0 : 1);
    return fnum(v / 1e4, '만');
  }
  const retColor = (v) => (!isNum(v) || v === 0 ? K.dim : v > 0 ? K.pos : K.neg);
  const stamp = (ts) => (ts ? String(ts).slice(5, 16).replace('T', ' ') : '—');
  const ageHours = (ts) => (ts ? (Date.now() - new Date(ts).getTime()) / 36e5 : NaN);

  // ── 조각 ───────────────────────────────────────────────────
  function tile(label, value, sub, color, small) {
    return `<div class="card"><div class="tile-label">${esc(label)}</div>` +
      `<div class="tile-value${small ? ' sm' : ''}" style="color:${color || K.text}">${value}</div>` +
      (sub ? `<div class="sub">${esc(sub)}</div>` : '') + '</div>';
  }
  const grid2 = (tiles) => `<div class="grid2">${tiles.join('')}</div>`;
  const caveat = (text, cls) => `<div class="caveat ${cls || ''}">${esc(text)}</div>`;
  function badge(text, color) {
    return `<span class="badge" style="background:${color}1F;color:${color};border:1px solid ${color}44">${esc(text)}</span>`;
  }
  const gradeBadge = (g) => badge(GRADE_LABEL[g] || g, GRADE_COLOR[g] || K.dim);
  const chips = (items) => (items && items.length
    ? `<div class="chips">${items.map((t) => `<span class="chip">${esc(t)}</span>`).join('')}</div>` : '');
  function famDots(st) {
    return '<div class="fam-dots">' + FAMS.map((f, i) =>
      `<span class="dot ${f}${st[i] > 0 ? ' on' : ''}" title="${FAM_LABEL[f]}"></span>`).join('') + '</div>';
  }
  function barRow(label, pct, num, color, wide) {
    const w = Math.max(0, Math.min(100, pct || 0));
    return `<div class="bar-row"><span class="bar-label${wide ? ' wide' : ''}"${wide ? '' : ` style="color:${color}"`}>${esc(label)}</span>` +
      `<span class="bar-track"><span class="bar-fill" style="width:${w.toFixed(0)}%;background:${color}"></span></span>` +
      `<span class="bar-num">${num}</span></div>`;
  }
  const famBars = (st) => '<div class="bars">' +
    FAMS.map((f, i) => barRow(FAM_LABEL[f], st[i], fnum(st[i]), FAM_COLOR[f])).join('') + '</div>';
  const kv = (k, v, text) => `<div class="kv${text ? ' text' : ''}"><span>${esc(k)}</span><span>${v}</span></div>`;
  const comboLabel = (st) => FAMS.filter((f, i) => st[i] > 0).map((f) => FAM_LABEL[f]).join('+');
  const famCountColor = (n) => (n >= 3 ? GRADE_COLOR.QUORUM : n === 2 ? K.accent : K.mute);

  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => el.classList.remove('show'), 2600);
  }

  // ── 데이터 ─────────────────────────────────────────────────
  function setData(data) {
    S.data = data;
    S.byCode = {}; S.rank = {}; S.priceMap = {}; S.sectorMap = {};
    data.board.forEach((r, i) => { S.byCode[r.c] = r; S.rank[r.c] = i + 1; });
    for (const [code, v] of Object.entries(data.prices)) {
      if (isNum(v[1])) S.priceMap[code] = v[1];
      S.sectorMap[code] = v[2] || '';
    }
    TR.configure(data.manifest.trading);
  }

  const ERR_TEXT = {
    auth: '토큰이 거부됐다 — 만료됐거나 잘못 입력됐다.',
    notfound: '결과 파일을 읽을 수 없다 — 토큰에 quorum 저장소의 Contents 읽기 권한이 있는지 확인할 것.',
    limited: 'GitHub 요청 한도에 걸렸다 — 잠시 후 다시 시도할 것.',
    network: '통신이 안 된다 — 연결을 확인할 것.',
  };
  const errText = (e) => ERR_TEXT[e && e.kind] || `서버 오류 (${(e && e.status) || '알 수 없음'})`;

  async function refresh(force, manual) {
    if (S.loading) return;
    S.loading = true;
    $('#refresh').classList.add('spin');
    try {
      const res = await Store.refresh(S.data && S.data.manifest.generated, force);
      S.error = null;
      if (res.changed) {
        setData(res.data);
        if (manual) toast('새 결과를 받았다');
      } else if (manual) {
        toast('이미 최신이다');
      }
    } catch (e) {
      S.error = e;
      if (S.data) toast(e.kind === 'network' ? '오프라인 — 마지막으로 받은 결과를 보여준다' : errText(e));
    } finally {
      S.loading = false;
      $('#refresh').classList.remove('spin');
      render();
    }
  }

  // ── 연결 설정 ──────────────────────────────────────────────
  function setupView() {
    return `
      <h2>연결 설정</h2>
      <div class="note">합의 결과는 비공개 저장소에 있다. 이 폰이 읽을 수 있도록 <b>읽기 전용 토큰</b>을 한 번만 넣는다.
        토큰은 이 기기 안에만 저장되고 GitHub 외의 곳으로 보내지 않는다.</div>
      <div class="card">
        <ol class="steps">
          <li>GitHub → Settings → Developer settings → Personal access tokens → <b>Fine-grained tokens</b> → Generate new token</li>
          <li>Repository access: <b>Only select repositories</b> → <span class="num">${esc(Store.REPO)}</span></li>
          <li>Permissions → Repository permissions → <b>Contents: Read-only</b></li>
          <li>만들어진 토큰(<span class="num">github_pat_…</span>)을 아래에 붙여넣는다</li>
        </ol>
        <form data-form="token">
          <label class="field"><span>토큰</span>
            <input type="password" name="token" placeholder="github_pat_…" autocomplete="off" autocapitalize="off" spellcheck="false" required></label>
          <button class="btn primary block" type="submit">${S.loading ? '확인 중…' : '연결'}</button>
        </form>
      </div>
      ${S.error ? caveat(errText(S.error), 'err') : ''}
      <div class="note">만료 기한은 길게 잡아도 된다 — 이 토큰으로는 quorum 저장소를 읽는 것만 가능하다.</div>`;
  }

  async function connect(value) {
    const t = String(value || '').trim();
    if (!t || S.loading) return;
    Store.token.set(t);
    S.loading = true; S.error = null;
    render();
    try {
      const res = await Store.refresh(null, true);
      setData(res.data);
      location.hash = '#/board';
    } catch (e) {
      S.error = e;
      // 틀린 토큰을 저장해 두면 다음 실행 때 빈 화면에 갇힌다
      if (e.kind === 'auth' || e.kind === 'notfound') Store.token.clear();
    } finally {
      S.loading = false;
      render();
    }
  }

  // ── 🎯 합의 보드 ───────────────────────────────────────────
  function stockCard(r, rank) {
    const gc = GRADE_COLOR[r.g] || K.dim;
    const conf = isNum(r.cf)
      ? `<span class="chip" style="color:${r.cf >= 60 ? K.pos : r.cf >= 40 ? K.warn : K.neg}">신뢰도 ${fnum(r.cf)}</span>` : '';
    return `<a class="card" href="#/stock/${esc(r.c)}" style="border-left:3px solid ${gc}">
      <div class="stock-head">
        <span class="rank" style="color:${gc}">#${rank}</span>
        <span class="stock-name">${esc(r.n)}</span>
        <span class="stock-code">${esc(r.c)} · ${esc(r.m)}</span>
        <span class="stock-score" style="color:${gc}">${fnum(r.sc)}</span>
      </div>
      <div class="sub">${esc(r.s)} · ${fnum(r.p, '원')} · ${fmcap(r.mc)}</div>
      ${famDots(r.st)}${famBars(r.st)}
      <div class="badges">${gradeBadge(r.g)}${conf}</div>
      ${r.bn ? `<div class="sub" style="color:${K.warn}">✦ ${esc(r.bn)}</div>` : ''}
      ${r.pn ? `<div class="sub" style="color:${K.neg}">▾ ${esc(r.pn)}</div>` : ''}
      ${r.gd ? `<div class="sub mute">🛡 ${esc(r.gd)}</div>` : ''}
      ${chips(r.rs)}
    </a>`;
  }

  function diagFold(m) {
    return `<details class="fold"><summary>유니버스 필터 진단</summary>
      <div class="note">필터 단계별 탈락 수. 결과가 적을 때 어느 조건이 걸렀는지 여기서 보인다.</div>
      <div class="card">${m.diag.map(([k, v]) => kv(k, fnum(v))).join('')}
        ${kv('통과', `${fnum(m.counts.passed)} / ${fnum(m.counts.total)}`)}</div></details>`;
  }

  function boardView() {
    const m = S.data.manifest, ui = S.ui, g = m.counts.grades;
    const reg = m.regime || {};
    const regColor = { Bull: K.pos, Bear: K.neg, 'High Volatility': K.warn }[reg.regime] || K.dim;
    const confColor = !isNum(m.avg_conf) ? K.dim : m.avg_conf >= 55 ? K.pos : m.avg_conf >= 40 ? K.warn : K.neg;

    let rows = S.data.board.filter((r) =>
      (!ui.grades.size || ui.grades.has(r.g)) &&
      (ui.market === 'ALL' || r.m === ui.market) &&
      [...ui.fams].every((f) => r.st[FAMS.indexOf(f)] > 0));

    const pills = (items, isOn, act) => items.map(([v, label]) =>
      `<button class="pill${isOn(v) ? ' on' : ''}" data-act="${act}" data-v="${v}">${esc(label)}</button>`).join('');

    let body;
    if (!rows.length) {
      body = '<div class="empty">조건에 맞는 종목이 없다.<br>등급이나 계열 조건을 완화해볼 것.</div>';
    } else {
      const dist = {};
      rows.forEach((r) => { const k = comboLabel(r.st); dist[k] = (dist[k] || 0) + 1; });
      const combos = Object.entries(dist).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => {
        const n = k ? k.split('+').length : 0;
        return `<span class="chip" style="color:${famCountColor(n)}">${esc(k || '없음')} <b class="num">${v}</b></span>`;
      }).join('');
      const shown = rows.slice(0, ui.topn);
      const rest = rows.length - shown.length;
      body = `
        <h3>계열 조합 분포</h3>
        <div class="note">같은 계열끼리만 겹친 종목은 흔하다. 여러 계열이 겹친 칸이 희소 신호다.</div>
        <div class="chips" style="margin-top:0">${combos}</div>
        <h3>랭킹 · ${fnum(rows.length)}종목 중 상위 ${shown.length}</h3>
        ${shown.map((r, i) => stockCard(r, i + 1)).join('')}
        ${rest > 0 ? `<button class="btn block" data-act="more">더 보기 (${fnum(rest)}종목 남음)</button>` : ''}`;
    }

    return `
      <h2>🎯 합의 보드</h2>
      <div class="note">가치·성장·모멘텀·퀄리티 네 각도에서 11개 룰이 같은 데이터를 본다. 한 계열 안에서 여러 룰이 동의하면
        <b>확증</b>, 서로 다른 계열이 동시에 지목하면 <b>희소 신호</b>다. 카드의 4색 점이 어떤 각도가 켜졌는지 보여준다.</div>
      ${grid2([
        tile('QUORUM', fnum(g.QUORUM), `STRONG ${g.STRONG}종목 · WATCH ${g.WATCH}종목`, GRADE_COLOR.QUORUM),
        tile('유니버스', fnum(m.counts.passed), `전체 ${fnum(m.counts.total)}종목 중 통과`, K.accent),
        tile('시장 국면', esc(reg.regime || 'Unknown'),
          `5일 누적 ${isNum(reg.cum) ? reg.cum : '—'}% · 변동성 ${isNum(reg.vol) ? reg.vol : '—'}%p`, regColor, true),
        tile('평균 신뢰도', fnum(m.avg_conf), `데이터 ${stamp(m.data_ts)} KST`, confColor),
      ])}
      ${!isNum(m.avg_conf) || m.avg_conf < 35 ? caveat('신뢰도가 전반적으로 낮다. 합의 점수가 높아도 이 점수대·계열 조합의 역사적 근거는 약하다는 뜻이다. 룰 랩에서 표본을 먼저 확인할 것.') : ''}
      <div class="filters">
        <div class="frow"><span class="flabel">등급</span>${pills(GRADES.map((x) => [x, GRADE_LABEL[x]]), (v) => ui.grades.has(v), 'grade')}</div>
        <div class="frow"><span class="flabel">시장</span>${pills([['ALL', '전체'], ['KOSPI', 'KOSPI'], ['KOSDAQ', 'KOSDAQ']], (v) => ui.market === v, 'market')}</div>
        <div class="frow"><span class="flabel">계열</span>${pills(FAMS.map((f) => [f, FAM_LABEL[f] + ' 필수']), (v) => ui.fams.has(v), 'fam')}</div>
      </div>
      ${body}
      ${diagFold(m)}`;
  }

  // ── 🔬 종목 ────────────────────────────────────────────────
  function searchResults(q) {
    const s = q.trim().toLowerCase();
    const hit = (code, name) => !s || code.includes(s) || String(name).toLowerCase().includes(s);
    const inBoard = S.data.board.filter((r) => hit(r.c, r.n)).slice(0, 60);
    let html = inBoard.map((r) => `<a class="result-row" href="#/stock/${esc(r.c)}">
        <span class="stock-name">${esc(r.n)}</span><span class="stock-code">${esc(r.c)} · ${esc(r.m)}</span>
        <span class="stock-score" style="color:${GRADE_COLOR[r.g]}">${fnum(r.sc)}</span></a>`).join('');
    if (s) {
      const out = Object.entries(S.data.prices)
        .filter(([code, v]) => !S.byCode[code] && hit(code, v[0])).slice(0, 10);
      html += out.map(([code, v]) => `<div class="result-row">
          <span class="stock-name" style="color:${K.mute}">${esc(v[0])}</span><span class="stock-code">${esc(code)}</span>
          <span class="sub mute" style="margin-left:auto">유니버스 밖</span></div>`).join('');
    }
    return html || '<div class="empty">일치하는 종목이 없다.</div>';
  }

  function stockListView() {
    return `
      <h2>🔬 종목 상세</h2>
      <div class="note">합의 점수는 결론이고, 여기는 그 결론이 어떻게 나왔는지다. 이름이나 코드로 찾는다.</div>
      <input type="search" id="q" placeholder="종목명 또는 코드" value="${esc(S.ui.q)}" autocomplete="off">
      <div id="results" style="margin-top:6px">${searchResults(S.ui.q)}</div>`;
  }

  function consChart(label, values, color) {
    const nums = values.filter(isNum);
    if (!nums.length) return '';
    const max = Math.max(...nums.map(Math.abs)) || 1;
    const cols = values.map((v, i) => {
      if (!isNum(v)) return '<div class="cons-col"><span class="cons-val">—</span></div>';
      const h = Math.max(2, Math.abs(v) / max * 68);
      return `<div class="cons-col"><span class="cons-val">${fmcap(v)}</span>` +
        `<span class="cons-bar${YEARS[i] >= FIRST_ESTIMATE_YEAR ? ' est' : ''}" style="height:${h.toFixed(0)}px;background:${v < 0 ? K.neg : color}"></span></div>`;
    }).join('');
    return `<div class="tile-label" style="margin-top:8px">${esc(label)}</div><div class="cons">${cols}</div>`;
  }

  function ruleCard(meta, d) {
    const [score, picked, cov, reasons, comps] = d;
    const c = FAM_COLOR[meta.family];
    const bars = comps.map(([label, earned, max, avail]) => {
      if (!avail) {
        return `<div class="bar-row"><span class="bar-label wide">${esc(label)}</span><span class="bar-track"></span>` +
          `<span class="bar-num" style="color:${K.mute}">N/A</span></div>`;
      }
      const pct = max ? earned / max * 100 : 0;
      return barRow(label, pct, `${fnum(earned)}/${fnum(max)}`, pct >= 60 ? K.pos : pct >= 30 ? K.warn : K.mute, true);
    }).join('');
    return `<div class="card" style="border-left:3px solid ${picked ? c : 'rgba(255,255,255,.07)'}">
      <div class="stock-head"><span class="stock-name" style="font-size:.94rem">${esc(meta.name)}</span>
        <span class="stock-score" style="color:${picked ? c : K.mute};font-size:1.2rem">${fnum(score)}</span></div>
      <div class="sub">${picked ? '● 지목' : '○ 미지목'} · 커버리지 ${fnum(cov)}% · 출처 ${esc(meta.origin)}</div>
      <div class="bars">${bars}</div>${chips(reasons)}
      <div class="sub mute" style="margin-top:8px">${esc(meta.description)}</div></div>`;
  }

  // 네이버 증권 종목 화면. 앱(WebView)은 앱 밖 주소를 기기 브라우저로 넘긴다.
  const naverUrl = (code) => `https://m.stock.naver.com/domestic/stock/${encodeURIComponent(code)}/total`;
  const naverBtn = (code) => `<a class="naver-btn" href="${naverUrl(code)}" target="_blank" rel="noopener noreferrer">` +
    '<span class="naver-n">N</span>네이버 증권<span aria-hidden="true">↗</span></a>';
  // 캔들 차트 자리 — 그린 뒤 QChart.hydrate 가 채운다
  const chartBox = (code) => `<section class="card qc" data-chart-code="${esc(code)}" data-chart-gen="${esc(S.data.manifest.generated || '')}" aria-label="주가 차트"></section>`;

  function stockDetailView(code) {
    const r = S.byCode[code], d = S.data.details[code], m = S.data.manifest;
    const back = '<a class="back" href="#/stock">‹ 종목 검색</a>';
    if (!r || !d) {
      const p = S.data.prices[code];
      return `${back}<div class="detail-top"><h2 style="margin:0">${esc(p ? p[0] : code)}</h2>${naverBtn(code)}</div>
        <div class="empty">유니버스 하드필터를 통과하지 못한 종목이다.<br>어떤 룰도 평가하지 않았다.
        ${p ? `<br><br><span class="num">${esc(code)}</span> · 현재가 ${fnum(p[1], '원')}` : ''}</div>`;
    }
    const gc = GRADE_COLOR[r.g] || K.dim, b = d.b;
    const metas = m.rules;

    const ruleGrid = metas.map((meta) => {
      const x = d.r[meta.id];
      if (!x) return `<div class="rule-cell">${esc(meta.name)}<span class="sc">평가불가</span></div>`;
      const c = FAM_COLOR[meta.family], hit = x[1];
      return `<div class="rule-cell${hit ? ' hit' : ''}" style="${hit ? `border-color:${c}55;background:${c}12` : ''}">
        <span style="color:${hit ? c : K.mute}">${hit ? '●' : '○'}</span>${esc(meta.name)}
        <span class="sc" style="color:${hit ? c : K.mute}">${fnum(x[0])}</span>
        ${x[2] >= 90 ? '' : `<span class="cov">커버리지 ${fnum(x[2])}%</span>`}</div>`;
    }).join('');

    const all = S.ui.ruleView === 'all';
    const targets = metas.filter((meta) => d.r[meta.id] && (all || d.r[meta.id][1]));
    const breakdown = targets.length ? FAMS.map((f) => {
      const list = targets.filter((meta) => meta.family === f);
      return list.length ? `<div class="fam-title" style="color:${FAM_COLOR[f]}">${FAM_LABEL[f]}</div>` +
        list.map((meta) => ruleCard(meta, d.r[meta.id])).join('') : '';
    }).join('') : '<div class="empty">이 종목을 지목한 룰이 없다.<br>전체 11룰로 바꾸면 각 룰이 몇 점을 줬는지 보인다.</div>';

    let peer = '';
    if (d.peer && d.peer.status === 'ok') {
      const [lo, mid, hi] = d.peer.fair;
      peer = `<h3>업종 피어 밸류 밴드</h3>${grid2([
        tile('현재 시총', fmcap(r.mc), '', K.text, true),
        tile('적정 시총 (중앙)', fmcap(mid), `${fmcap(lo)} ~ ${fmcap(hi)}`, FAM_COLOR.VALUE, true),
        tile('상승여력', fnum(d.peer.up, '%', 0, true), `피어 ${fnum(d.peer.n)}개 · ${d.peer.yr} 기준`, retColor(d.peer.up), true),
        tile('피어 EV/OP', fnum(d.peer.mult, '배', 1), '중앙값 · 순차입금·지배비율 보정', K.dim, true),
      ])}<div class="note">EV = 시가총액 + 순차입금, OP는 지배비율을 곱해 보정한다. 부채 많은 종목의 과대평가와 상장 자회사 연결로 인한 이익 부풀림을 걷어낸 값이다.</div>`;
    } else if (d.peer) {
      peer = `<div class="note">피어 계산 불가: ${esc(d.peer.status)} (업종 미분류이거나 같은 업종 흑자 피어가 3개 미만)</div>`;
    }

    const er = isNum(r.er) ? fnum(r.er, '%', 1, true) : '—';
    return `${back}
      <div class="detail-top"><div class="stock-head" style="margin-bottom:2px"><h2 style="margin:0">${esc(r.n)}</h2>
        <span class="stock-code">${esc(r.c)} · ${esc(r.m)} · ${S.rank[code]}위</span></div>${naverBtn(r.c)}</div>
      <div class="sub" style="margin-top:0">${esc(r.s)}</div>
      ${chartBox(r.c)}
      ${grid2([
        tile('합의 점수', fnum(r.sc), `${r.af}개 계열 · ${r.v}표`, gc),
        tile('등급', esc(GRADE_LABEL[r.g] || r.g), r.gd || '가드레일 없음', gc, true),
        tile('신뢰도', fnum(r.cf), d.cn, isNum(r.cf) && r.cf >= 55 ? K.pos : K.warn),
        tile('기대수익 / R·R', er + (isNum(r.rr) ? ` / ${fnum(r.rr, '', 2)}` : ''), '20거래일 기준 · 백테스트 표본', retColor(r.er), true),
      ])}
      <h3>계열 강도</h3>
      <div class="card">${famBars(r.st)}
        <div class="sub">base ${fnum(d.base, '', 1)} × ${m.config.base_budget} + 보너스 ${fnum(d.bonus, '', 1)}/${fnum(m.config.max_bonus)} × ${m.config.bonus_budget * 100} − 페널티 ${fnum(d.pen, '', 1)}
          = <b style="color:${gc}">${fnum(r.sc, '', 1)}</b></div>
        ${r.bn ? `<div class="sub" style="color:${K.warn}">✦ ${esc(r.bn)}</div>` : ''}
        ${r.pn ? `<div class="sub" style="color:${K.neg}">▾ ${esc(r.pn)}</div>` : ''}</div>
      <h3>기본 지표</h3>
      <div class="card">
        ${kv('현재가', fnum(r.p, '원'))}
        ${kv('시가총액', fmcap(r.mc))}
        ${kv('PER / PBR', `${fnum(b.per, '', 1)} / ${fnum(b.pbr, '', 2)}`)}
        ${kv('Forward PER / PEG', `${fnum(b.fper, '', 1)} / ${fnum(b.peg, '', 2)}`)}
        ${kv('ROE / 영업이익률', `${fnum(b.roe, '%', 1)} / ${fnum(b.opm, '%', 1)}`)}
        ${kv('부채비율', fnum(b.debt, '%'))}
        ${kv('20일 거래대금', fwon(b.to20))}
        ${kv('RSI / 거래량배수', `${fnum(b.rsi)} / ${fnum(b.volx, '배', 1)}`)}
        ${kv('컨센 리비전', fnum(b.rev, '%', 1, true))}
        ${kv('미래가시성', `P${isNum(b.vis) ? b.vis : 5} (연환산 매출 ${fnum(b.visg, '%', 0, true)})`)}
      </div>
      <h3>11룰 지목 현황</h3>
      <div class="note">● 지목 · ○ 미지목. 커버리지가 낮은 룰은 데이터가 없어 제대로 못 본 것이다.</div>
      <div class="rule-grid">${ruleGrid}</div>
      <h3>룰별 컴포넌트 분해</h3>
      <div class="seg"><button class="${all ? '' : 'on'}" data-act="ruleview" data-v="picked">지목한 룰만</button>
        <button class="${all ? 'on' : ''}" data-act="ruleview" data-v="all">전체 11룰</button></div>
      ${breakdown}
      <h3>컨센서스 추이</h3>
      <div class="card">
        ${consChart('매출액', d.cons.rev, FAM_COLOR.VALUE)}
        ${consChart('영업이익', d.cons.op, FAM_COLOR.GROWTH)}
        <div class="cons-years">${YEARS.map((y) => `<span>${y >= FIRST_ESTIMATE_YEAR ? `'${String(y).slice(2)}E` : `'${String(y).slice(2)}`}</span>`).join('')}</div>
        <div class="sub mute">흐린 막대(${FIRST_ESTIMATE_YEAR}년 이후)는 애널리스트 컨센서스 추정치다. 두 그래프의 눈금은 서로 다르다.</div>
      </div>
      ${peer}`;
  }

  // ── 📊 룰 랩 ───────────────────────────────────────────────
  function statRows(section, h, labelFn) {
    const out = [];
    for (const [k, perH] of Object.entries(section || {})) {
      const s = (perH && perH[h]) || {};
      if (!s.n) continue;
      out.push({ key: k, label: labelFn ? labelFn(k) : k, n: s.n, win: s.win_rate, mean: s.mean, mdd: s.mdd, gone: s.delisted || 0 });
    }
    return out;
  }
  function statHtml(rows, base) {
    if (!rows.length) return '<div class="empty">표본이 없다.</div>';
    return '<div class="card">' + rows.map((r) => {
      const diff = isNum(base) && isNum(r.mean) ? r.mean - base : null;
      return `<div class="stat"><div class="stat-top"><span class="stat-name">${esc(r.label)}</span>
          <span class="stat-mean" style="color:${retColor(r.mean)}">${fnum(r.mean, '%', 2, true)}</span></div>
        <div class="stat-meta"><span>승률 ${fnum(r.win, '%', 1)}</span>
          <span class="bar-track"><span class="bar-fill" style="width:${Math.max(0, Math.min(100, r.win || 0))}%;background:${K.accent}"></span></span>
          <span class="num">${fnum(r.n)}건</span>
          ${diff == null ? '' : `<span style="color:${retColor(diff)}">기준선 ${fnum(diff, '%p', 2, true)}</span>`}
          ${isNum(r.mdd) ? `<span>MDD ${fnum(r.mdd, '%', 1)}</span>` : ''}
          ${r.gone ? `<span>상폐·정지 ${r.gone}</span>` : ''}</div></div>`;
    }).join('') + '</div>';
  }

  function labView() {
    const bt = S.data.backtest;
    const head = `<h2>📊 룰 랩</h2>
      <div class="note">11개 룰과 합의 점수를 과거 패널에 되돌려 실행하고, 실제로 뒤따른 수익률을 잰다. 여기서 답해야 할 질문은 하나다 —
        <b>서로 다른 계열이 겹칠 때가 정말 더 좋았나?</b></div>`;
    if (!bt || !bt.horizons) return head + '<div class="empty">아직 백테스트 결과가 없다.</div>';

    const horizons = bt.horizons.map(String);
    const h = horizons.includes(S.ui.horizon) ? S.ui.horizon : horizons[horizons.length - 1];
    const baseStat = (bt.baseline || {})[h] || {};
    const base = baseStat.mean;
    const p = bt.panel || {};
    const meta = bt.rule_meta || {};
    const INITIAL = { V: 'VALUE', G: 'GROWTH', M: 'MOMENTUM', Q: 'QUALITY' };
    const comboName = (k) => k.split('+').map((c) => FAM_LABEL[INITIAL[c]] || c).join('+');
    const byMean = (a, b) => b.mean - a.mean;

    const rules = statRows(bt.rules, h, (k) => `${FAM_LABEL[(meta[k] || {}).family] || ''} · ${(meta[k] || {}).name || k}`).sort(byMean);

    const bandOrder = ['80-101', '70-80', '60-70', '50-60', '0-50'];
    const bands = statRows(bt.bands, h, (k) => (k === '80-101' ? '80점 이상' : k + '점'))
      .sort((a, b) => bandOrder.indexOf(a.key) - bandOrder.indexOf(b.key));
    const monoBands = bands.every((r, i) => i === 0 || bands[i - 1].mean >= r.mean);

    const grades = statRows(bt.grades, h, (k) => GRADE_LABEL[k] || k)
      .sort((a, b) => GRADES.indexOf(a.key) - GRADES.indexOf(b.key));

    // 신호 20건 미만 조합은 표본이 부족해 숨긴다
    const combos = statRows(bt.combos, h, comboName).filter((r) => r.n >= 20).sort(byMean);
    const byN = {};
    combos.forEach((r) => {
      const n = r.key.split('+').length;
      const a = byN[n] || (byN[n] = { n, sig: 0, mean: 0, win: 0 });
      a.sig += r.n; a.mean += r.mean * r.n; a.win += (r.win || 0) * r.n;
    });
    const ns = Object.values(byN).sort((a, b) => a.n - b.n)
      .map((a) => ({ n: a.n, sig: a.sig, mean: a.mean / a.sig, win: a.win / a.sig }));
    // 판정은 단조성으로 한다. 최고·최저 칸만 비교하면 중간이 무너진 결과에도 가설이 지지된다고 말하게 된다.
    const breaks = ns.filter((a, i) => i > 0 && a.mean < ns[i - 1].mean)
      .map((a) => { const prev = ns[ns.indexOf(a) - 1]; return `${prev.n}개(${fnum(prev.mean, '%', 2, true)}) → ${a.n}개(${fnum(a.mean, '%', 2, true)})`; });
    const best = ns.slice().sort((a, b) => b.mean - a.mean)[0];
    let verdict = '';
    if (ns.length >= 2) {
      verdict = breaks.length
        ? caveat(`계열 수가 많을수록 좋다는 가설은 이 표본에서 성립하지 않는다. 역전 구간: ${breaks.join(' · ')}. 가장 좋은 칸은 ${best.n}개 계열(${fnum(best.mean, '%', 2, true)})이다.`) +
          '<div class="note">작동하는 것은 계열 수 자체가 아니라 높은 점수와 다계열의 결합일 수 있다 — ③ 등급별에서 QUORUM 이 기준선을 이겼는지 확인할 것. 이 결과에 맞춰 산식을 다시 손대는 건 짧은 단일 국면 표본에 대한 과적합이다.</div>'
        : caveat(`계열 수가 늘수록 성과가 단조 증가했다. 교차 보너스 가설이 이 표본에서 지지된다 (최고 ${best.n}개 계열 ${fnum(best.mean, '%', 2, true)}).`, 'ok');
    }

    return `${head}
      ${grid2([
        tile('패널 거래일', fnum(p.trading_days), `${p.start || '—'} ~ ${p.end || '—'}`, K.accent),
        tile('백테스트', stamp(bt.generated), `${p.step || 1}거래일 간격 재현`, K.pos, true),
        tile(`기준선 (+${h}일)`, fnum(base, '%', 2, true), '유니버스 전체 평균 — 이걸 못 이기면 의미 없다', K.dim, true),
        tile('기준선 승률', fnum(baseStat.win_rate, '%', 1), `${fnum(baseStat.n)}개 기준일`, K.dim, true),
      ])}
      ${caveat(`표본은 ${fnum(p.trading_days)}거래일의 단일 시장국면이다. 여기 승률은 미래 수익률의 추정치가 아니라 '이 구간에서 이랬다'는 기록이다. +20거래일 수익률은 뒤쪽 20일 신호에서 측정되지 않는다.`)}
      <div class="seg">${horizons.map((x) => `<button class="${x === h ? 'on' : ''}" data-act="horizon" data-v="${x}">+${x}거래일</button>`).join('')}</div>
      <h3>① 룰별 성과</h3>
      <div class="note">기준선을 못 이기는 룰은 종목을 고르는 게 아니라 시장을 따라간 것이다. 상폐·정지는 통계에서 제외했지만 숨기지 않고 표시한다(생존편향).</div>
      ${statHtml(rules, base)}
      <h3>② 합의 점수 구간별</h3>
      <div class="note">점수가 높을수록 수익이 높아야 한다. 단조롭지 않으면 산식이 이 구간에 안 맞는 것이다.</div>
      ${statHtml(bands, base)}
      ${bands.length >= 2 ? (monoBands ? caveat('점수 구간이 단조롭다 — 합의 점수가 실제로 순서를 만들었다.', 'ok') : caveat('점수 구간이 단조롭지 않다. 표본이 짧거나 산식이 이 구간에 안 맞는다.')) : ''}
      <h3>③ 등급별</h3>
      ${statHtml(grades, base)}
      <h3>④ 계열 조합별 — 교차 계열 가설 검증</h3>
      <div class="note">이 앱 전체가 <b>"서로 다른 계열이 겹칠 때가 더 좋다"</b>는 가설 위에 서 있다. 여기가 그 가설이 참인지 거짓인지 나오는 자리다. 신호 20건 미만 조합은 숨겼다.</div>
      ${statHtml(combos, base)}
      ${ns.length ? '<div class="tile-label" style="margin-top:14px">활성 계열 수별 요약</div>' + grid2(ns.map((a) =>
        tile(`${a.n}개 계열`, fnum(a.mean, '%', 2, true), `승률 ${fnum(a.win, '%')} · ${fnum(a.sig)}건`, famCountColor(a.n), true))) : ''}
      ${verdict}`;
  }

  // ── 💼 포트폴리오 ──────────────────────────────────────────
  const loadPositions = () => {
    const v = Store.ls.get(Store.KEY.positions, []);
    return Array.isArray(v) ? v : [];
  };
  const savePositions = (list) => Store.ls.set(Store.KEY.positions, list);
  const loadCash = () => Number(Store.ls.get(Store.KEY.cash, 0)) || 0;
  const todayLocal = () => { const d = new Date(); return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); };
  const isoToday = () => todayLocal().toISOString().slice(0, 10);

  function sigHtml(s) {
    return `<div class="sig">${badge(s.level, TR.LEVEL_COLOR[s.level] || K.dim)}<span>${esc(s.rule)} — ${esc(s.message)}</span></div>`;
  }

  function positionForm(p) {
    const e = p || {};
    const picked = S.ui.pick || (e.code ? { code: e.code, name: e.name } : null);
    return `<div class="card" style="border-color:${K.accent}66">
      <form data-form="position">
        <label class="field"><span>종목 (이름 또는 6자리 코드)</span>
          <input type="text" name="query" id="pq" value="${esc(picked ? `${picked.name} ${picked.code}` : '')}" placeholder="예: 삼성전자 또는 005930" autocomplete="off"></label>
        <div id="suggest" class="chips" style="margin:-4px 0 10px"></div>
        <div class="form-grid">
          <label class="field"><span>수량</span><input type="number" name="qty" inputmode="numeric" min="0" step="1" value="${esc(e.qty ?? '')}" required></label>
          <label class="field"><span>매수가 (원)</span><input type="number" name="buy" inputmode="decimal" min="0" step="any" value="${esc(e.buy ?? '')}" required></label>
          <label class="field"><span>매수일</span><input type="date" name="date" value="${esc(e.date || isoToday())}"></label>
          <label class="field"><span>보유 중 고점 (비우면 매수가)</span><input type="number" name="high" inputmode="decimal" min="0" step="any" value="${esc(e.high ?? '')}"></label>
        </div>
        <div class="checks">
          <label><input type="checkbox" name="vshape" ${e.vshape ? 'checked' : ''}>V자형 (손절 ${fnum(TR.C.stop_v)}%)</label>
          <label><input type="checkbox" name="tp1" ${e.tp1 ? 'checked' : ''}>익절1 완료</label>
          <label><input type="checkbox" name="tp2" ${e.tp2 ? 'checked' : ''}>익절2 완료</label>
        </div>
        <div class="btn-row"><button class="btn primary" type="submit">저장</button>
          <button class="btn" type="button" data-act="pos-cancel">취소</button></div>
      </form></div>`;
  }

  function suggest(q) {
    const s = q.trim().toLowerCase();
    if (s.length < 2) return '';
    const out = [];
    for (const [code, v] of Object.entries(S.data.prices)) {
      if (code.includes(s) || String(v[0]).toLowerCase().includes(s)) {
        out.push(`<button type="button" class="pill" data-act="pick" data-code="${esc(code)}">${esc(v[0])} <span class="num">${esc(code)}</span></button>`);
        if (out.length >= 6) break;
      }
    }
    return out.join('') || '<span class="sub mute">일치하는 종목이 없다 — 6자리 코드를 직접 넣어도 된다.</span>';
  }

  function portfolioView() {
    const ui = S.ui, m = S.data.manifest, board = S.data.board;
    const positions = loadPositions();
    const cash = loadCash();
    const today = todayLocal();
    const bestAlt = board.length ? board[0].sc : 0;

    // 고점은 앱을 열었을 때의 종가로만 올라간다 — 올라간 값은 기기에 남긴다
    let raised = false;
    const rows = positions.map((p) => {
      const info = S.data.prices[p.code];
      const price = S.priceMap[p.code] ?? null;
      const r = TR.evaluatePosition(p, price, today);
      if (price > 0 && r.high > (Number(p.high) || 0)) { p.high = r.high; raised = true; }
      const row = S.byCode[p.code];
      const rankSig = row ? TR.rankDropout(row.sc, S.rank[p.code], bestAlt) : null;
      const qty = Number(p.qty) || 0;
      return { p, price, r, row, rankSig, qty, name: p.name || (info && info[0]) || p.code, value: (price || 0) * qty };
    });
    if (raised) savePositions(positions);

    const head = `<h2>💼 포트폴리오</h2>
      <div class="note">매매룰 v1.0 을 보유 종목에 적용한다. 보유 종목은 <b>이 폰에만</b> 저장된다 — 서버로 보내지 않는다.</div>
      <details class="fold"><summary>매매룰 v1.0 명세</summary>
        <div class="card">${m.trading.table.map(([a, b, c]) => kv(a, `${esc(b)} <span style="color:${K.mute}">· ${esc(c)}</span>`, true)).join('')}</div></details>`;

    const form = ui.editing != null
      ? positionForm(ui.editing === 'new' ? null : positions.find((x) => x.id === ui.editing))
      : '<div class="btn-row"><button class="btn primary" data-act="pos-new">＋ 보유 종목 추가</button></div>';

    const backup = `<details class="fold"><summary>백업 · 복원</summary>
      <div class="note">아래 내용을 복사해 메모장 등에 보관한다. 복원할 때는 이 칸에 붙여넣고 복원을 누른다.</div>
      <textarea id="backup" spellcheck="false">${esc(JSON.stringify({ positions, cash }, null, 1))}</textarea>
      <div class="btn-row"><button class="btn sm" data-act="backup-copy">복사</button>
        <button class="btn sm" data-act="backup-restore">붙여넣은 내용으로 복원</button></div></details>`;

    if (!rows.length) {
      return `${head}${form}<div class="empty">보유 종목을 입력하면 매매룰 시그널과 합의 점수 재평가가 나온다.</div>${backup}`;
    }

    const total = rows.reduce((a, x) => a + x.value, 0);
    const cost = rows.reduce((a, x) => a + (Number(x.p.buy) || 0) * x.qty, 0);
    const pnl = total - cost;
    const nSell = rows.filter((x) => x.r.signals[0].level === 'SELL').length;
    const nTrim = rows.filter((x) => x.r.signals[0].level === 'TRIM').length;
    const warns = TR.evaluatePortfolio(rows.map((x) => ({ code: x.p.code, name: x.name, qty: x.qty })), S.priceMap, S.sectorMap, cash);

    const cards = rows.map((x) => {
      const top = x.r.signals[0], g = x.row && x.row.g;
      const delAsk = ui.confirm === 'del:' + x.p.id;
      return `<div class="card" style="border-left:3px solid ${TR.LEVEL_COLOR[top.level]}">
        <div class="stock-head"><span class="stock-name">${esc(x.name)}</span><span class="stock-code">${esc(x.p.code)}</span>
          <span class="stock-score" style="color:${retColor(x.r.ret)}">${x.price ? fnum(x.r.ret, '%', 1, true) : '—'}</span></div>
        <div class="sub">${fnum(Number(x.p.buy), '원')} → ${fnum(x.price, '원')} · ${fnum(x.qty)}주 · 평가 ${fwon(x.value)}</div>
        <div class="sub">고점 ${fnum(x.r.high, '원')} · 합의 ${x.row ? fnum(x.row.sc, '점') : '—'}
          ${g ? `<span style="color:${GRADE_COLOR[g]}">${esc(GRADE_LABEL[g])}</span> · ${S.rank[x.p.code]}위` : '· 유니버스 밖'}</div>
        <div style="margin-top:8px">${x.r.signals.map(sigHtml).join('')}${x.rankSig ? sigHtml(x.rankSig) : ''}</div>
        <div class="btn-row" style="margin-bottom:0">
          ${x.row ? `<a class="btn sm" href="#/stock/${esc(x.p.code)}">룰 분해</a>` : ''}
          <button class="btn sm" data-act="pos-edit" data-id="${esc(x.p.id)}">수정</button>
          <button class="btn sm danger" data-act="pos-del" data-id="${esc(x.p.id)}">${delAsk ? '정말 삭제' : '삭제'}</button></div>
      </div>`;
    }).join('');

    return `${head}
      ${grid2([
        tile('평가액', fwon(total), `원금 ${fwon(cost)}`, K.text, true),
        tile('평가손익', fwon(pnl), cost > 0 ? fnum(pnl / cost * 100, '%', 1, true) : '', retColor(pnl), true),
        tile('매도 시그널', fnum(nSell), `익절 ${nTrim}건`, nSell ? K.neg : K.pos),
        tile('현금 비중', total + cash > 0 ? fnum(cash / (total + cash) * 100, '%', 1) : '—', `목표 ${fnum(TR.C.cash_min)}~${fnum(TR.C.cash_max)}%`, K.accent, true),
      ])}
      <label class="field"><span>현금 (원)</span><input type="number" id="cash" inputmode="numeric" min="0" step="any" value="${cash || ''}" placeholder="0"></label>
      ${warns.length ? '<h3>비중 점검</h3>' + warns.map((w) => {
        const c = TR.LEVEL_COLOR[w.level];
        return `<div class="caveat" style="color:${K.dim};border-color:${c}33;border-left-color:${c};background:${c}0F"><b style="color:${c}">${esc(w.rule)}</b> — ${esc(w.message)}</div>`;
      }).join('') : ''}
      <h3>종목별 시그널</h3>
      <div class="note">현재가는 ${stamp(m.data_ts)} 수집분의 종가다. 장중 가격이 아니다.</div>
      ${cards}${form}${backup}`;
  }

  function savePosition(form) {
    const f = new FormData(form);
    const query = String(f.get('query') || '').trim();
    let pick = S.ui.pick;
    const typed = /(\d{6})\s*$/.exec(query);
    if (typed && (!pick || pick.code !== typed[1])) {
      const info = S.data.prices[typed[1]];
      pick = { code: typed[1], name: info ? info[0] : typed[1] };
    }
    if (!pick && S.ui.editing !== 'new') {
      const cur = loadPositions().find((x) => x.id === S.ui.editing);
      if (cur) pick = { code: cur.code, name: cur.name };
    }
    if (!pick) { toast('종목을 목록에서 고르거나 6자리 코드를 넣을 것'); return; }
    const buy = Number(f.get('buy')), qty = Number(f.get('qty'));
    if (!(buy > 0) || !(qty > 0)) { toast('수량과 매수가를 넣을 것'); return; }
    const high = Number(f.get('high'));
    const rec = {
      code: pick.code, name: pick.name, qty, buy,
      date: String(f.get('date') || isoToday()),
      high: high > 0 ? high : null,
      vshape: f.get('vshape') === 'on', tp1: f.get('tp1') === 'on', tp2: f.get('tp2') === 'on',
    };
    const list = loadPositions();
    if (S.ui.editing === 'new') {
      list.push({ id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), ...rec });
    } else {
      const i = list.findIndex((x) => x.id === S.ui.editing);
      if (i >= 0) list[i] = { ...list[i], ...rec };
    }
    savePositions(list);
    S.ui.editing = null; S.ui.pick = null;
    render();
  }

  function restoreBackup(text) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { toast('복원 실패 — JSON 형식이 아니다'); return; }
    const src = Array.isArray(obj) ? obj : obj && obj.positions;
    if (!Array.isArray(src)) { toast('복원 실패 — 보유 종목 목록이 없다'); return; }
    const list = [];
    src.forEach((x, i) => {
      // Streamlit 판 백업(한글 키)도 받는다
      const code = String(x.code ?? x['종목코드'] ?? '').trim().padStart(6, '0');
      const buy = Number(x.buy ?? x['매수가']);
      if (!/^\d{6}$/.test(code) || !(buy > 0)) return;
      const info = S.data.prices[code];
      list.push({
        id: x.id || `r${Date.now().toString(36)}${i}`, code,
        name: x.name || x['종목명'] || (info ? info[0] : code),
        qty: Number(x.qty ?? x['수량']) || 0, buy,
        date: String(x.date ?? x['매수일'] ?? isoToday()).slice(0, 10),
        high: Number(x.high ?? x['최고가']) || null,
        vshape: !!(x.vshape ?? x['V자형']), tp1: !!(x.tp1 ?? x['익절1']), tp2: !!(x.tp2 ?? x['익절2']),
      });
    });
    savePositions(list);
    if (obj && isNum(Number(obj.cash))) Store.ls.set(Store.KEY.cash, Number(obj.cash));
    toast(`${list.length}종목을 복원했다`);
    render();
  }

  // ── ⚙️ 설정 ────────────────────────────────────────────────
  function settingsView() {
    const m = S.data.manifest, q = m.config.quorum, u = m.config.universe, p = m.panel;
    const wsum = FAMS.reduce((a, f) => a + (q.family_weights[f] || 0), 0) || 1;
    const errs = Object.entries(m.rule_errors || {});
    const connected = !!Store.token.get();
    const clearAsk = S.ui.confirm === 'token-clear';

    return `
      <h2>⚙️ 설정 · 룰 카탈로그</h2>
      <h3>데이터 상태</h3>
      ${grid2([
        tile('ai2 컨센서스', `${fnum(m.counts.total)}종목`, `${stamp(m.data_ts)} KST 수집`, K.accent, true),
        tile('컨센 스냅샷', esc(m.snap_date || '없음'), `${m.rev_days}일 전 기준 리비전`, FAM_COLOR.GROWTH, true),
        tile('백테스트 패널', p ? `${fnum(p.days)}일` : '없음', p ? `${p.start} ~ ${p.end}` : '', K.dim, true),
        tile('유니버스 통과', fnum(m.counts.passed), `전체 ${fnum(m.counts.total)}종목`, K.pos, true),
      ])}
      <div class="card">
        ${kv('결과 계산 시각', `${stamp(m.generated)} KST`)}
        ${kv('갱신 주기', '매일 07:30 KST (GitHub Actions)', true)}
        ${kv('저장소 · 브랜치', `${esc(Store.REPO)} · ${esc(Store.BRANCH)}`, true)}
        ${kv('연결', Store.DEV && !connected ? '개발 모드 (로컬 파일)' : connected ? '토큰 저장됨' : '없음', true)}
        ${kv('앱 버전', esc(self.APP_VERSION || 'dev'))}
      </div>
      ${errs.length ? caveat('일부 룰이 평가에 실패했다. 해당 룰은 합의에서 빠졌다: ' + errs.map(([k, v]) => `${k} (${v})`).join(', '), 'err') : ''}
      <div class="btn-row">
        <button class="btn sm" data-act="refresh-force">지금 다시 받기</button>
        ${connected ? `<button class="btn sm danger" data-act="token-clear">${clearAsk ? '정말 해제 — 토큰과 받은 결과 삭제' : '연결 해제'}</button>` : ''}
      </div>

      <h3>현재 적용 중인 산식</h3>
      <div class="note">폰에서는 계산하지 않는다. 서버가 <b>기본 설정</b>(계열 가중 동일 · 교차 보너스 적용 · ${m.rev_days}일 전 스냅샷)으로 하루 한 번 계산한 결과다. 가중치를 바꿔 보려면 Streamlit 판을 쓴다.</div>
      ${grid2(m.families.map((f) => tile(f.label, fnum((q.family_weights[f.id] || 0) / wsum * 100, '%'), `룰 ${f.rules}개 · 가중 ${fnum(q.family_weights[f.id])}`, FAM_COLOR[f.id], true)))}
<pre class="formula">계열강도[f] = sqrt( Σ score·picked / (100 × 룰개수) ) × 100
base       = Σ 가중[f]·계열강도[f] / Σ 가중[f]
보너스      = 활성계열 2개 +8 · 3개 +15 · 4개 +20   (${q.use_cross_bonus ? '적용' : '꺼짐'})
             + VALUE∩MOMENTUM +7 · VALUE∩GROWTH +5  최대 ${fnum(m.config.max_bonus)}
페널티      함정 −${fnum(q.penalty_trap)} · RSI≥${fnum(q.overheat_rsi)} −${fnum(q.penalty_overheat)} · 유동성 −${fnum(q.penalty_illiquid)}
점수        clip( base×${m.config.base_budget} + (보너스/${fnum(m.config.max_bonus)})×100×${m.config.bonus_budget} − 페널티, 0, 100 )</pre>
      <div class="note"><b>제곱근 감쇠</b>: 룰들이 같은 팩터를 재사용한다(성장률이 4개 룰에 등장). 감쇠가 없으면 "같은 얘기 반복"이 확증으로 위장된다.<br>
        <b>예산 분할</b>: 보너스를 base 위에 그냥 더하면 상단이 100에 눌어붙어 가장 변별이 필요한 구간의 순위가 뭉개진다.</div>
      <div class="tile-label" style="margin-top:12px">등급 사다리 — 가드레일은 하향만 가능하다</div>
      <div class="card">
        ${kv('🏆 QUORUM', `활성계열 ≥ ${q.min_families_for_quorum} 및 점수 ≥ ${fnum(q.grade_quorum)}`, true)}
        ${kv('🔥 STRONG', `점수 ≥ ${fnum(q.grade_strong)}`, true)}
        ${kv('👀 WATCH', `점수 ≥ ${fnum(q.grade_watch)}`, true)}
        ${kv('○ NEUTRAL', `점수 ≥ ${fnum(q.grade_neutral)}`, true)}
        ${kv('⚠️ AVOID', '그 외', true)}
        ${kv('가드레일', '신뢰도 &lt; 50 → 한 단계 강등 · 거래대금 &lt; 10억 → 최대 WATCH', true)}
      </div>

      <h3>룰 카탈로그 (${m.rules.length}개)</h3>
      <div class="note">각 룰이 어느 저장소에서 왔고 무엇을 보는지. 전부 같은 계약을 구현하므로 점수를 나란히 비교할 수 있다.</div>
      ${m.families.map((f) => `<div class="fam-title" style="color:${FAM_COLOR[f.id]}">${esc(f.label)} · ${f.rules}개 룰</div>` +
        m.rules.filter((r) => r.family === f.id).map((r) => `<div class="card" style="border-left:3px solid ${FAM_COLOR[f.id]}">
          <div class="stock-head"><span class="stock-name" style="font-size:.94rem">${esc(r.name)}</span><span class="stock-code">${esc(r.id)}</span></div>
          <div class="sub" style="color:${FAM_COLOR[f.id]}">출처 ${esc(r.origin)}</div>
          <div class="note" style="margin:6px 0 0">${esc(r.description)}</div></div>`).join('')).join('')}

      <h3>유니버스 하드필터</h3>
      <div class="note">여기서 걸러낸 종목은 어떤 룰도 지목할 수 없다. 룰마다 다른 필터를 두면 합의 점수가 "몇 개 룰이 이 종목을 볼 수 있었나"에 오염된다.</div>
      <div class="card">
        ${kv('최소 시총', `${fnum(u.min_mcap)}억`)}
        ${kv('최소 20일 거래대금', `${fnum(u.min_turnover_20d / 1e8)}억`)}
        ${kv('부채비율 상한', `${fnum(u.max_debt)}% (결측은 통과)`)}
        ${kv('적자 제외', u.require_profit ? '2024~2028E 존재값 전부 흑자' : '미적용', true)}
        ${kv('먼 미래 컨센', u.require_forward_consensus ? '27E 또는 28E 필수' : '미적용', true)}
        ${kv('우선주 / 스팩', '제외', true)}
      </div>
      ${diagFold(m)}

      <h3>매매룰 v1.0</h3>
      <div class="card">${m.trading.table.map(([a, b, c]) => kv(a, `${esc(b)} <span style="color:${K.mute}">· ${esc(c)}</span>`, true)).join('')}</div>

      <h3>이 도구가 못 하는 것</h3>
      <ul class="plain">
        <li><b>공시 텍스트를 못 본다.</b> CB 발행 조건, 소송, 최대주주 담보, 거버넌스 이슈는 재무제표에 안 드러난다. 상위 종목은 DART 분기보고서로 별도 확인할 것.</li>
        <li><b>컨센서스는 애널리스트 추정치다.</b> 커버리지가 적은 중소형주는 1~2명의 추정이 전부일 수 있고, 그 추정이 자주 틀린다.</li>
        <li><b>백테스트 표본이 짧다.</b> 단일 시장국면이다. 여기 승률을 미래 수익률로 읽으면 안 된다.</li>
        <li><b>장중 가격이 아니다.</b> 가격은 하루 한 번 수집한 종가다. 손절·트레일링 판정도 그 종가 기준이다.</li>
        <li><b>거래비용·슬리피지를 반영하지 않는다.</b> 유동성이 얕은 종목에서 실제 성과는 백테스트보다 나쁘다.</li>
        <li><b>매수 신호가 아니다.</b> 합의 점수는 "여러 각도에서 동시에 걸렸다"까지만 의미한다. 사업 내용과 업황 판단은 별도다.</li>
      </ul>
      <div class="note" style="margin-top:16px;border-top:1px solid rgba(255,255,255,.07);padding-top:12px">개인 투자 판단 보조 도구다. 모든 매매 결정과 그 책임은 사용자 본인에게 있다. 백테스트 성과는 미래 수익을 보장하지 않으며 표본 구간이 짧다.<br>
        데이터 출처: ai2 (FnGuide·네이버 컨센서스, 매일 05시 KST 갱신)</div>`;
  }

  // ── 라우팅 · 렌더 ──────────────────────────────────────────
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    return { name: parts[0] || 'board', arg: parts[1] || '' };
  }

  function statusBanner() {
    const m = S.data.manifest;
    const age = ageHours(m.generated);
    let html = '';
    if (age > STALE_HOURS) {
      html += caveat(`결과가 ${Math.floor(age / 24) || 1}일째 갱신되지 않았다 (마지막 ${stamp(m.generated)}). 일일 워크플로(Daily Panel Update)가 멈췄을 수 있다 — GitHub Actions 를 확인할 것.`);
    }
    if (S.error && S.error.kind !== 'network') html += caveat(errText(S.error), 'err');
    return html;
  }

  function render() {
    const setup = Store.needsToken();
    document.body.classList.toggle('setup', setup);
    const sub = $('#bar-sub');
    if (setup) {
      sub.textContent = '4계열 11룰 합의 엔진'; sub.classList.remove('stale');
      view.innerHTML = setupView();
      return;
    }
    const r = route();
    document.querySelectorAll('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === r.name));

    if (!S.data) {
      sub.textContent = '4계열 11룰 합의 엔진';
      view.innerHTML = S.error && !S.loading
        ? `<div class="empty">${esc(errText(S.error))}<br><br><button class="btn" data-act="refresh">다시 시도</button>
            ${Store.token.get() ? '<br><br><button class="btn sm danger" data-act="token-clear">토큰 다시 입력</button>' : ''}</div>`
        : '<div class="empty">결과를 받는 중…</div>';
      return;
    }

    const m = S.data.manifest;
    const stale = ageHours(m.generated) > STALE_HOURS;
    sub.textContent = `데이터 ${stamp(m.data_ts)} · 계산 ${stamp(m.generated)}${S.error && S.error.kind === 'network' ? ' · 오프라인' : ''}`;
    sub.classList.toggle('stale', stale);

    const views = { board: boardView, lab: labView, portfolio: portfolioView, settings: settingsView };
    const body = r.name === 'stock' ? (r.arg ? stockDetailView(r.arg) : stockListView())
      : (views[r.name] || boardView)();
    view.innerHTML = statusBanner() + body;
    if (r.name === 'stock' && r.arg && self.QChart) QChart.hydrate(view);

    const key = r.name + '/' + r.arg;
    if (key !== S.lastRoute) { S.lastRoute = key; window.scrollTo(0, 0); }
  }

  // ── 입력 처리 ──────────────────────────────────────────────
  const toggle = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));

  const ACTIONS = {
    refresh: () => refresh(false, true),
    'refresh-force': () => refresh(true, true),
    grade: (el) => { toggle(S.ui.grades, el.dataset.v); S.ui.topn = PAGE; render(); },
    market: (el) => { S.ui.market = el.dataset.v; S.ui.topn = PAGE; render(); },
    fam: (el) => { toggle(S.ui.fams, el.dataset.v); S.ui.topn = PAGE; render(); },
    more: () => { S.ui.topn += PAGE; render(); },
    horizon: (el) => { S.ui.horizon = el.dataset.v; render(); },
    ruleview: (el) => { S.ui.ruleView = el.dataset.v; render(); },
    'pos-new': () => { S.ui.editing = 'new'; S.ui.pick = null; render(); const q = $('#pq'); if (q) q.focus(); },
    'pos-edit': (el) => { S.ui.editing = el.dataset.id; S.ui.pick = null; render(); const f = $('[data-form=position]'); if (f) f.scrollIntoView({ block: 'center' }); },
    'pos-cancel': () => { S.ui.editing = null; S.ui.pick = null; render(); },
    'pos-del': (el) => {
      const key = 'del:' + el.dataset.id;
      if (S.ui.confirm !== key) { S.ui.confirm = key; render(); return; }
      savePositions(loadPositions().filter((x) => x.id !== el.dataset.id));
      S.ui.confirm = null; render();
    },
    pick: (el) => {
      const info = S.data.prices[el.dataset.code];
      S.ui.pick = { code: el.dataset.code, name: info ? info[0] : el.dataset.code };
      $('#pq').value = `${S.ui.pick.name} ${S.ui.pick.code}`;
      $('#suggest').innerHTML = '';
      const qty = $('[name=qty]'); if (qty) qty.focus();
    },
    'backup-copy': async () => {
      const ta = $('#backup');
      try { await navigator.clipboard.writeText(ta.value); toast('복사했다'); }
      catch (e) { ta.focus(); ta.select(); toast('전체 선택했다 — 길게 눌러 복사할 것'); }
    },
    'backup-restore': () => restoreBackup($('#backup').value),
    'token-clear': async () => {
      if (S.data && S.ui.confirm !== 'token-clear') { S.ui.confirm = 'token-clear'; render(); return; }
      Store.token.clear();
      try { await Store.clearCache(); } catch (e) { /* 무시 */ }
      S.data = null; S.error = null; S.ui.confirm = null;
      location.hash = '#/board';
      render();
    },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el) return;
    const fn = ACTIONS[el.dataset.act];
    if (!fn) return;
    ev.preventDefault();
    // 두 번 눌러야 하는 동작은 다른 곳을 누르면 취소된다
    if (S.ui.confirm && !['pos-del', 'token-clear'].includes(el.dataset.act)) S.ui.confirm = null;
    fn(el);
  });

  document.addEventListener('submit', (ev) => {
    const form = ev.target.closest('[data-form]');
    if (!form) return;
    ev.preventDefault();
    if (form.dataset.form === 'token') connect(new FormData(form).get('token'));
    else if (form.dataset.form === 'position') savePosition(form);
  });

  document.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'q') {
      S.ui.q = t.value;
      $('#results').innerHTML = searchResults(t.value);      // 입력칸은 다시 그리지 않는다
    } else if (t.id === 'pq') {
      S.ui.pick = null;
      $('#suggest').innerHTML = suggest(t.value);
    }
  });

  document.addEventListener('change', (ev) => {
    if (ev.target.id === 'cash') {
      Store.ls.set(Store.KEY.cash, Math.max(0, Number(ev.target.value) || 0));
      render();
    }
  });

  // 탭 전환은 방문 기록을 쌓지 않는다 — 뒤로 가기는 종목 상세에서 나올 때만 쓰이고,
  // 탭을 몇 번 오갔든 한두 번이면 앱이 닫힌다.
  $('#tabs').addEventListener('click', (ev) => {
    const a = ev.target.closest('a');
    if (!a) return;
    ev.preventDefault();
    location.replace(a.getAttribute('href'));
  });

  window.addEventListener('hashchange', () => {
    S.ui.confirm = null;
    if (route().name !== 'portfolio') { S.ui.editing = null; S.ui.pick = null; }
    render();
  });

  // 앱으로 돌아왔을 때 하루 지난 결과면 다시 받는다
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && S.data && !Store.needsToken() && ageHours(S.data.manifest.generated) > 6) refresh(false, false);
  });

  // ── 시작 ───────────────────────────────────────────────────
  (async function boot() {
    render();
    if (Store.needsToken()) return;
    const cached = await Store.loadCached();
    if (cached) { setData(cached); render(); }
    refresh(false, false);
  })();
})();
