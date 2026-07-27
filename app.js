/* 南竿起霧預報 PWA — 前端邏輯。
   資料來源見 config.js。網路優先、離線回退（由 service worker 快取）。 */
(() => {
  'use strict';

  const CFG = window.FOG_CONFIG || {};
  const BANDS = CFG.riskBands || { low: 0.15, high: 0.40 };
  const STALE_H = CFG.staleHours || 30;

  const $ = (id) => document.getElementById(id);

  // ── 風險分級 ──────────────────────────────────────────
  function risk(prob) {
    if (prob >= BANDS.high) return { level: '高風險', tag: '高', color: 'var(--risk-high)' };
    if (prob >= BANDS.low) return { level: '中風險', tag: '中', color: 'var(--risk-mid)' };
    return { level: '低風險', tag: '低', color: 'var(--risk-low)' };
  }
  const pct = (p) => Math.round(p * 100);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  function advice(prob, inSeason) {
    const r = risk(prob);
    if (r.tag === '高') return '起霧／低能見度機率高，班機延誤或取消風險大，請預留備案。';
    if (r.tag === '中') return '有一定起霧機率，出發前留意最新航班動態。';
    return inSeason
      ? '起霧機率低，航班多半正常，仍建議出發前確認。'
      : '目前非霧季，起霧機率低，航班多半正常。';
  }

  // ── 時間格式 ──────────────────────────────────────────
  function relTime(iso) {
    if (!iso) return '';
    const t = new Date(iso).getTime();
    if (Number.isNaN(t)) return '';
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return '剛剛';
    if (mins < 60) return `${mins} 分鐘前`;
    const h = Math.round(mins / 60);
    if (h < 24) return `${h} 小時前`;
    return `${Math.round(h / 24)} 天前`;
  }
  function isStale(iso) {
    const t = new Date(iso).getTime();
    return !Number.isNaN(t) && (Date.now() - t) > STALE_H * 3600 * 1000;
  }

  // ── Banner ────────────────────────────────────────────
  function banner(msg, kind) {
    const el = $('banner');
    if (!msg) { el.hidden = true; return; }
    el.className = `banner ${kind || 'info'}`;
    el.textContent = msg;
    el.hidden = false;
  }

  // ── 抓資料 ────────────────────────────────────────────
  async function fetchJSON(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), 10000);
    try {
      const res = await fetch(url, { signal: ctl.signal, cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(to);
    }
  }

  // ── 渲染 ──────────────────────────────────────────────
  function renderToday(doc) {
    $('airport').textContent = doc.airport || '—';
    $('date').textContent = doc.date || '—';

    const season = $('season');
    if (doc.in_season) { season.textContent = '霧季'; season.className = 'season-badge in'; }
    else { season.textContent = '非霧季'; season.className = 'season-badge'; }

    const slots = Array.isArray(doc.slots) ? doc.slots : [];
    const maxProb = slots.length ? Math.max(...slots.map((s) => s.prob || 0)) : 0;
    const r = risk(maxProb);

    // Hero 儀表
    const gauge = $('gauge');
    gauge.style.setProperty('--c', r.color);
    // 觸發 conic 動畫：下一幀再設 --p
    requestAnimationFrame(() => gauge.style.setProperty('--p', pct(maxProb)));
    $('heroProb').textContent = pct(maxProb);
    const hl = $('heroLabel'); hl.textContent = r.level; hl.style.color = r.color;
    $('heroProb').style.color = r.color;
    $('heroAdvice').textContent = advice(maxProb, doc.in_season);
    $('hero').hidden = false;

    // 時段
    const wrap = $('slots');
    wrap.innerHTML = '';
    const thr = doc.threshold_km;
    for (const s of slots) {
      const sr = risk(s.prob || 0);
      const el = document.createElement('div');
      el.className = 'slot';
      el.style.setProperty('--c', sr.color);
      const vis = (s.forecast_vis_km != null)
        ? `預報能見度 ${Number(s.forecast_vis_km).toFixed(1)} km` : '';
      el.innerHTML = `
        <div class="slot-time">${s.time || '—'}</div>
        <div class="slot-mid">
          <div class="slot-bar"><span style="width:${Math.max(2, pct(s.prob || 0))}%"></span></div>
          <div class="slot-vis">${vis}</div>
        </div>
        <div class="slot-right">
          <div class="slot-prob">${pct(s.prob || 0)}%</div>
          <div class="slot-tag">${sr.tag}</div>
        </div>`;
      wrap.appendChild(el);
    }
    $('slotsWrap').hidden = slots.length === 0;

    // 氣象條件
    const c = doc.conditions || {};
    const conds = [
      { label: '海溫 SST', val: c.sst, unit: '°C', hint: c.sst_source ? `${c.sst_source}｜${c.sst_date || ''}` : '' },
      { label: '相對濕度', val: c.rh, unit: '%', hint: '越高越易起霧' },
      { label: '風速', val: c.wind, unit: 'm/s', hint: '' },
      { label: '露點−海溫', val: c.td_minus_sst, unit: '°C', hint: '接近 0 易凝霧' },
    ];
    const cg = $('conditions');
    cg.innerHTML = '';
    let anyCond = false;
    for (const it of conds) {
      if (it.val == null || Number.isNaN(Number(it.val))) continue;
      anyCond = true;
      const el = document.createElement('div');
      el.className = 'cond';
      el.innerHTML = `
        <div class="cond-label">${it.label}</div>
        <div class="cond-val">${Number(it.val).toFixed(it.unit === '%' ? 0 : 2)}<small>${it.unit}</small></div>
        ${it.hint ? `<div class="cond-hint">${it.hint}</div>` : ''}`;
      cg.appendChild(el);
    }
    $('condWrap').hidden = !anyCond;

    // Footer
    const gen = doc.generated_at;
    $('footInfo').textContent = gen ? `資料更新於 ${relTime(gen)}（${new Date(gen).toLocaleString('zh-TW')}）` : '';
    $('footNote').textContent = thr
      ? `風險＝該時段能見度低於 ${thr} km（起霧標準）之機率。`
      : '';

    return { gen };
  }

  function renderTrend(history) {
    const wrap = $('trend');
    if (!Array.isArray(history) || history.length < 2) { $('trendWrap').hidden = true; return; }
    const days = history.slice(-7);
    const maxes = days.map((d) => {
      const vals = Object.values(d.slots || {});
      return vals.length ? Math.max(...vals) : 0;
    });
    const scaleMax = Math.max(0.1, ...maxes);
    wrap.innerHTML = '';
    days.forEach((d, i) => {
      const p = maxes[i];
      const r = risk(p);
      const col = document.createElement('div');
      col.className = 'trend-col';
      col.style.setProperty('--c', r.color);
      const md = (d.date || '').slice(5); // MM-DD
      col.innerHTML = `
        <div class="trend-val">${pct(p)}%</div>
        <div class="trend-bar-wrap"><div class="trend-bar" style="height:${Math.max(4, (p / scaleMax) * 100)}%"></div></div>
        <div class="trend-day">${md}</div>`;
      wrap.appendChild(col);
    });
    $('trendWrap').hidden = false;
  }

  function compass(degrees) {
    if (degrees == null || Number.isNaN(Number(degrees))) return '—';
    const names = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
    return names[Math.round(((Number(degrees) % 360) + 360) % 360 / 45) % 8];
  }

  function renderObservations(doc) {
    const stations = Array.isArray(doc.stations) ? doc.stations : [];
    const wrap = $('observations');
    wrap.innerHTML = '';
    for (const station of stations) {
      const observed = station.observed_at ? new Date(station.observed_at) : null;
      const observedText = observed && !Number.isNaN(observed.getTime())
        ? `${relTime(station.observed_at)}｜${observed.toLocaleString('zh-TW')}`
        : '暫無觀測資料';
      const values = [
        ['溫度', station.temperature_c, '°C', 1],
        ['相對濕度', station.relative_humidity_pct, '%', 0],
        ['風速', station.wind_speed_ms, 'm/s', 1],
        ['風向', station.wind_direction_deg, '°', 0],
        ['能見度', station.visibility_km, 'km', 1],
      ];
      const card = document.createElement('article');
      card.className = 'observation';
      const cells = values.map(([label, value, unit, digits]) => {
        let display = '未提供';
        if (value != null && !Number.isNaN(Number(value))) {
          display = `${Number(value).toFixed(digits)}<small>${unit}</small>`;
          if (label === '風向') display += `<span class="wind-name">${compass(value)}</span>`;
        }
        return `<div class="obs-value"><span>${label}</span><strong>${display}</strong></div>`;
      }).join('');
      card.innerHTML = `
        <div class="obs-head">
          <div><strong>${esc(station.area || '—')}</strong><span>${esc(station.station_name)}｜${esc(station.station_id)}</span></div>
          <time>${observedText}</time>
        </div>
        <div class="obs-values">${cells}</div>`;
      wrap.appendChild(card);
    }
    $('observationsUpdated').textContent = doc.generated_at
      ? `抓取於 ${relTime(doc.generated_at)}` : '';
    $('observationsSource').textContent = doc.source ? `資料來源：${doc.source}` : '';
    $('observationsWrap').hidden = stations.length === 0;
  }

  // ── 主載入流程 ────────────────────────────────────────
  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    $('refresh').classList.add('spin');
    try {
      const today = await fetchJSON(CFG.todayUrl || 'today.json');
      $('loading').hidden = true;
      const { gen } = renderToday(today);

      // 過期／離線提醒
      if (!navigator.onLine) banner('目前離線，顯示的是最後一次快取的預報。', 'info');
      else if (gen && isStale(gen)) banner('這份預報可能已過期（超過 30 小時未更新）。', 'warn');
      else banner('');

      // history 為選配，失敗不影響主畫面
      try {
        const hist = await fetchJSON(CFG.historyUrl || 'history.json');
        renderTrend(hist);
      } catch (_) { $('trendWrap').hidden = true; }

      try {
        const observations = await fetchJSON(CFG.observationsUrl || 'observations.json');
        renderObservations(observations);
      } catch (_) { $('observationsWrap').hidden = true; }

    } catch (err) {
      $('loading').hidden = true;
      if (!navigator.onLine) {
        banner('目前離線，且沒有可用的快取資料。請連線後重試。', 'error');
      } else {
        banner(`無法載入預報資料（${err.message}）。稍後重試。`, 'error');
      }
    } finally {
      loading = false;
      $('refresh').classList.remove('spin');
    }
  }

  // ── 事件 ──────────────────────────────────────────────
  $('refresh').addEventListener('click', load);
  window.addEventListener('online', load);
  window.addEventListener('offline', () => banner('已離線。', 'info'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });

  // ── Service worker ────────────────────────────────────
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  load();
})();
