// 매매룰 v1.0 — engine/trading_rules.py 의 이식본.
//
// 보유 종목은 폰에만 저장되므로 이 판정만 기기에서 돈다. 문턱값은 서버가
// manifest.trading 으로 내려 주는 값을 쓰고(configure), 아래 상수는 그 값이
// 아직 없을 때의 기본값이다. 룰을 고칠 때는 파이썬 쪽을 고치고 여기를 맞춘다.
(function (root) {
  'use strict';

  const C = {
    stop: -15, stop_v: -20, trailing: -20, tp1: 50, tp2: 100,
    time_days: 180, time_band: 10,
    max_stock: 25, max_sector: 50, cash_min: 10, cash_max: 20,
    rank_cut: 20, hysteresis: 10,
  };

  const LEVEL_ORDER = { SELL: 0, TRIM: 1, REVIEW: 2, OK: 3 };
  const LEVEL_COLOR = { SELL: '#F87171', TRIM: '#FBBF24', REVIEW: '#38BDF8', OK: '#34D399' };

  function configure(t) {
    if (!t) return;
    for (const k of Object.keys(C)) {
      if (typeof t[k] === 'number' && isFinite(t[k])) C[k] = t[k];
    }
  }

  const sig = (level, rule, message) => ({ level, rule, message });
  // 8000/10000 - 1 은 -0.19999999999999996 이라 -20.0 문턱을 넘지 못한다.
  // 손절선은 실제 돈이 걸리는 경계라 6자리로 반올림한 뒤 비교한다.
  const r6 = (x) => Math.round(x * 1e6) / 1e6;
  const signed = (x, d) => (x >= 0 ? '+' : '') + x.toFixed(d);
  const won = (x) => Math.round(x).toLocaleString('en-US');

  function parseDay(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
    if (!m) return null;
    const t = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    return isNaN(t) ? null : t;
  }

  // pos: {buy, date(ISO), high, vshape, tp1, tp2}
  // 반환: {ret(%), high(갱신된 고점), signals[]}
  function evaluatePosition(pos, price, today) {
    const entry = Number(pos.buy);
    if (!(entry > 0) || price == null || !(price > 0)) {
      return { ret: 0, high: entry, signals: [sig('REVIEW', '데이터', '가격 정보 없음 — 확인 필요')] };
    }
    const ret = r6((price / entry - 1) * 100);
    const high = Math.max(Number(pos.high) || entry, price);
    const out = [];

    const stop = pos.vshape ? C.stop_v : C.stop;
    if (ret <= stop) out.push(sig('SELL', '손절', `수익률 ${signed(ret, 1)}% ≤ ${stop.toFixed(0)}%`));

    const dd = r6((price / high - 1) * 100);
    if (high > entry && dd <= C.trailing) {
      out.push(sig('SELL', '트레일링', `고점 ${won(high)}원 대비 ${signed(dd, 1)}%`));
    }

    if (ret >= C.tp2 && !pos.tp2) {
      out.push(sig('TRIM', '익절 2차', `+${ret.toFixed(0)}% 도달 — 1/3 매도`));
    } else if (ret >= C.tp1 && !pos.tp1) {
      out.push(sig('TRIM', '익절 1차', `+${ret.toFixed(0)}% 도달 — 1/3 매도`));
    }

    const buy = parseDay(pos.date);
    if (buy != null) {
      const t = today || new Date();
      const now = Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate());
      const held = Math.floor((now - buy) / 86400000);
      if (held >= C.time_days && ret > -C.time_band && ret < C.time_band) {
        out.push(sig('REVIEW', '시간손절', `${held}일 보유, 수익률 ${signed(ret, 1)}% — 교체 검토`));
      }
    }

    if (!out.length) out.push(sig('OK', '정상', `수익률 ${signed(ret, 1)}% — 매매룰 위반 없음`));
    out.sort((a, b) => (LEVEL_ORDER[a.level] ?? 9) - (LEVEL_ORDER[b.level] ?? 9));
    return { ret, high, signals: out };
  }

  // positions: [{code, name, qty}] · prices: {code: 현재가} · sectors: {code: 업종}
  function evaluatePortfolio(positions, prices, sectors, cash) {
    const warns = [];
    const values = {};
    for (const p of positions) {
      const px = prices[p.code];
      if (px == null) continue;
      values[p.code] = Number(px) * (Number(p.qty) || 0);
    }
    const cashN = Number(cash) || 0;
    const total = Object.values(values).reduce((a, b) => a + b, 0) + cashN;
    if (total <= 0) return warns;

    for (const p of positions) {
      if (!(p.code in values)) continue;
      const w = values[p.code] / total * 100;
      if (w > C.max_stock) {
        warns.push(sig('REVIEW', '종목 비중',
          `${p.name || p.code} ${w.toFixed(1)}% — 상한 ${C.max_stock.toFixed(0)}% 초과`));
      }
    }

    const bySector = {};
    for (const p of positions) {
      if (!(p.code in values)) continue;
      const sec = sectors[p.code] || '기타';
      bySector[sec] = (bySector[sec] || 0) + values[p.code];
    }
    for (const [sec, v] of Object.entries(bySector)) {
      const w = v / total * 100;
      if (w > C.max_sector) {
        warns.push(sig('REVIEW', '업종 비중',
          `${sec} ${w.toFixed(1)}% — 상한 ${C.max_sector.toFixed(0)}% 초과`));
      }
    }

    const cw = cashN / total * 100;
    if (cw < C.cash_min) {
      warns.push(sig('REVIEW', '현금 비중', `${cw.toFixed(1)}% — 최소 ${C.cash_min.toFixed(0)}% 미달`));
    } else if (cw > C.cash_max) {
      warns.push(sig('OK', '현금 비중', `${cw.toFixed(1)}% — 목표 상단 초과 (기회 대기 중이면 무방)`));
    }
    return warns;
  }

  // 점수가 한 칸 밀렸다고 매번 갈아타면 거래비용만 남는다.
  // 대체 후보가 확실히 우위일 때만 교체를 권한다.
  function rankDropout(heldScore, heldRank, bestAltScore) {
    if (heldRank <= C.rank_cut) return null;
    const gap = bestAltScore - heldScore;
    if (gap < C.hysteresis) {
      return sig('OK', '순위 유지',
        `${heldRank}위지만 대체 후보 우위 ${signed(gap, 1)}점 < ${C.hysteresis.toFixed(0)}점 — 유지`);
    }
    return sig('REVIEW', '순위 탈락',
      `합의 ${heldRank}위 (상위 ${C.rank_cut} 밖) & 대체 후보가 ${signed(gap, 1)}점 우위 — 교체 검토`);
  }

  const api = { C, LEVEL_ORDER, LEVEL_COLOR, configure, evaluatePosition, evaluatePortfolio, rankDropout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TR = api;
})(typeof self !== 'undefined' ? self : this);
