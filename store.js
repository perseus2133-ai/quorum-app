// 데이터 계층 — 결과 파일을 받아 기기에 보관한다.
//
// 결과는 비공개 저장소의 mobile-data 브랜치에 있다. 폰은 사용자가 한 번 넣어 둔
// 읽기 전용 토큰으로 GitHub API 에서 직접 받는다 (중간 서버 없음). 받은 파일은
// IndexedDB 에 두어 통신이 안 될 때도 마지막 결과를 볼 수 있다.
(function (root) {
  'use strict';

  const REPO = 'perseus2133-ai/quorum';
  const BRANCH = 'mobile-data';
  const API = `https://api.github.com/repos/${REPO}/contents/`;
  const FILES = ['board.json', 'details.json', 'prices.json', 'backtest.json'];
  const KEY = { token: 'quorum.token', positions: 'quorum.positions', cash: 'quorum.cash' };
  const DB_NAME = 'quorum', DB_STORE = 'files';

  // 개발 PC 에서 `python -m http.server` 로 띄우면 토큰 없이 mobile_out/ 을 읽는다.
  const DEV = location.protocol === 'http:' && /^(localhost|127\.0\.0\.1)$/.test(location.hostname);

  // ── localStorage (작은 설정값) ──────────────────────────────
  const ls = {
    get(k, fallback) {
      try {
        const v = localStorage.getItem(k);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 저장 불가 */ } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* 무시 */ } },
  };

  const token = {
    get: () => ls.get(KEY.token, ''),
    set: (t) => ls.set(KEY.token, String(t || '').trim()),
    clear: () => ls.del(KEY.token),
  };

  // ── IndexedDB (결과 파일) ───────────────────────────────────
  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function dbGet(name) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const r = db.transaction(DB_STORE).objectStore(DB_STORE).get(name);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  async function dbPutAll(entries) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      for (const [name, value] of Object.entries(entries)) tx.objectStore(DB_STORE).put(value, name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async function dbClear() {
    const db = await openDb();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, 'readwrite');
      tx.objectStore(DB_STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ── 네트워크 ────────────────────────────────────────────────
  function fail(kind, status) {
    const e = new Error(kind);
    e.kind = kind;            // auth | notfound | limited | http | network
    e.status = status || 0;
    return e;
  }

  async function fetchFile(name) {
    let res;
    try {
      if (DEV && !token.get()) {
        res = await fetch(`../../mobile_out/${name}`, { cache: 'no-store' });
      } else {
        res = await fetch(`${API}${name}?ref=${BRANCH}`, {
          cache: 'no-store',
          headers: {
            Accept: 'application/vnd.github.raw+json',
            Authorization: `Bearer ${token.get()}`,
            'X-GitHub-Api-Version': '2022-11-28',
          },
        });
      }
    } catch (e) {
      throw fail('network');
    }
    if (res.status === 401) throw fail('auth', 401);
    // 비공개 저장소는 권한이 없어도 404 를 준다 — 토큰 범위가 틀린 경우가 대부분이다
    if (res.status === 404) throw fail('notfound', 404);
    if (res.status === 403 || res.status === 429) throw fail('limited', res.status);
    if (!res.ok) throw fail('http', res.status);
    return res.json();
  }

  function pack(manifest, parts) {
    return {
      manifest, board: parts[0].rows || [], details: parts[1] || {},
      prices: parts[2] || {}, backtest: parts[3] || {},
    };
  }

  // 기기에 보관된 마지막 결과. 없으면 null.
  async function loadCached() {
    try {
      const manifest = await dbGet('manifest.json');
      if (!manifest) return null;
      const parts = await Promise.all(FILES.map(dbGet));
      if (parts.some((p) => p == null)) return null;
      return pack(manifest, parts);
    } catch (e) {
      return null;
    }
  }

  // 서버에서 받는다. manifest 가 그대로면 나머지는 받지 않는다.
  // 반환: {changed, data} — data 는 바뀌었을 때만 채워진다.
  async function refresh(currentGenerated, force) {
    const manifest = await fetchFile('manifest.json');
    if (!force && currentGenerated && manifest.generated === currentGenerated) {
      return { changed: false, data: null };
    }
    const parts = await Promise.all(FILES.map(fetchFile));
    const entries = { 'manifest.json': manifest };
    FILES.forEach((n, i) => { entries[n] = parts[i]; });
    try { await dbPutAll(entries); } catch (e) { /* 보관 실패는 화면 표시를 막지 않는다 */ }
    return { changed: true, data: pack(manifest, parts) };
  }

  // 종목 차트(charts/{code}.json) — 종목을 열 때 그 파일만 받는다.
  // generated(결과 생성 시각)가 같으면 기기에 보관한 것을 쓰고, 받기에 실패하면
  // 예전 것이라도 보여 준다(status 를 stale 로 바꿔 화면이 경고한다).
  const chartMem = new Map();
  function fetchChart(code, generated) {
    const key = `${code}@${generated}`;
    if (chartMem.has(key)) return chartMem.get(key);
    const job = (async () => {
      let kept = null;
      try { kept = await dbGet(`chart:${code}`); } catch (e) { /* 보관소 없음 */ }
      if (kept && kept.gen === generated && kept.data) return kept.data;
      try {
        const data = await fetchFile(`charts/${code}.json`);
        try { await dbPutAll({ [`chart:${code}`]: { gen: generated, data } }); } catch (e) { /* 무시 */ }
        return data;
      } catch (e) {
        if (kept && kept.data && e.kind !== 'notfound') return Object.assign({}, kept.data, { status: 'stale' });
        throw e;
      }
    })();
    chartMem.set(key, job);
    job.catch(() => chartMem.delete(key));
    if (chartMem.size > 60) chartMem.delete(chartMem.keys().next().value);
    return job;
  }

  root.Store = {
    REPO, BRANCH, DEV, KEY, ls, token,
    needsToken: () => !token.get() && !DEV,
    loadCached, refresh, fetchChart, clearCache: dbClear,
  };
})(self);
