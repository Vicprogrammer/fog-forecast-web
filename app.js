(() => {
  'use strict';

  const CFG = window.FOG_CONFIG || {};
  const BANDS = CFG.riskBands || { low: 0.15, high: 0.40 };
  const STALE_H = CFG.staleHours || 30;
  const $ = (id) => document.getElementById(id);
  const state = {
    airport: localStorage.getItem('fog-airport') === 'nangan' ? 'nangan' : 'beigan',
    today: null,
    history: [],
    observations: null,
  };

  function risk(value) {
    if (value >= BANDS.high) return { level: '高風險', tag: '高', color: 'var(--risk-high)' };
    if (value >= BANDS.low) return { level: '中風險', tag: '中', color: 'var(--risk-mid)' };
    return { level: '低風險', tag: '低', color: 'var(--risk-low)' };
  }

  const pct = (value) => Math.round((value || 0) * 100);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[char]));

  function relTime(iso) {
    if (!iso) return '';
    const timestamp = new Date(iso).getTime();
    if (Number.isNaN(timestamp)) return '';
    const minutes = Math.round((Date.now() - timestamp) / 60000);
    if (minutes < 1) return '剛剛';
    if (minutes < 60) return `${minutes} 分鐘前`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} 小時前`;
    return `${Math.round(hours / 24)} 天前`;
  }

  function isStale(iso) {
    const timestamp = new Date(iso).getTime();
    return !Number.isNaN(timestamp) && Date.now() - timestamp > STALE_H * 3600000;
  }

  function banner(message, kind) {
    const element = $('banner');
    if (!message) {
      element.hidden = true;
      return;
    }
    element.className = `banner ${kind || 'info'}`;
    element.textContent = message;
    element.hidden = false;
  }

  async function fetchJSON(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    try {
      const response = await fetch(url, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  function airportView() {
    const source = state.today || {};
    if (state.airport === 'beigan') {
      const beigan = source.beigan || {};
      const calibrated = Boolean(beigan.calibrated_probability);
      const slots = Array.isArray(beigan.slots) ? beigan.slots.map((slot) => ({
        ...slot,
        value: calibrated ? slot.probability : slot.risk_score,
        details: [
          slot.visibility_km != null ? `能見度 ${Number(slot.visibility_km).toFixed(1)} km` : '',
          slot.cloud_cover_low_pct != null ? `低雲 ${Math.round(slot.cloud_cover_low_pct)}%` : '',
          slot.dewpoint_spread_c != null ? `溫露差 ${Number(slot.dewpoint_spread_c).toFixed(1)}°C` : '',
        ].filter(Boolean).join('｜'),
      })) : [];
      const representative = slots.reduce(
        (best, slot) => !best || (slot.value || 0) > (best.value || 0) ? slot : best,
        null,
      );
      return {
        key: 'beigan',
        airport: beigan.airport || '北竿 (MFK/RCMT)',
        date: beigan.date || source.date,
        inSeason: source.in_season,
        calibrated,
        metric: '關場預測機率（僅供參考）',
        slotsTitle: '北竿逐時段關場預測機率',
        slots,
        conditionsMeta: representative ? `${representative.time} 最高風險時段` : '',
        conditions: representative ? [
          { label: '預報能見度', val: representative.visibility_km, unit: 'km', digits: 1, hint: '越低越不利起降' },
          { label: '相對濕度', val: representative.relative_humidity_pct, unit: '%', digits: 0, hint: '越高越易凝霧' },
          { label: '風速', val: representative.wind_speed_ms, unit: 'm/s', digits: 1, hint: '' },
          { label: '低雲量', val: representative.cloud_cover_low_pct, unit: '%', digits: 0, hint: '低雲可能限制進場' },
          { label: '氣溫', val: representative.temperature_c, unit: '°C', digits: 1, hint: '' },
          { label: '溫度−露點', val: representative.dewpoint_spread_c, unit: '°C', digits: 1, hint: '接近 0 易凝霧' },
        ] : [],
        historyKey: 'beigan_slots',
        note: beigan.disclaimer || '模型依氣象條件推估關場風險，僅供參考；不是機場官方關場決策或公告。',
      };
    }

    const slots = Array.isArray(source.slots) ? source.slots.map((slot) => ({
      ...slot,
      value: slot.prob,
      details: slot.forecast_vis_km != null
        ? `預報能見度 ${Number(slot.forecast_vis_km).toFixed(1)} km`
        : '',
    })) : [];
    const conditions = source.conditions || {};
    return {
      key: 'nangan',
      airport: source.airport || '南竿 (LZN/RCFG)',
      date: source.date,
      inSeason: source.in_season,
      calibrated: true,
      metric: '關場預測機率（僅供參考）',
      slotsTitle: '南竿逐時段關場預測機率',
      slots,
      conditionsMeta: '',
      conditions: [
        { label: '海溫 SST', val: conditions.sst, unit: '°C', digits: 2, hint: conditions.sst_source ? `${conditions.sst_source}｜${conditions.sst_date || ''}` : '' },
        { label: '相對濕度', val: conditions.rh, unit: '%', digits: 0, hint: '越高越易凝霧' },
        { label: '風速', val: conditions.wind, unit: 'm/s', digits: 1, hint: '' },
        { label: '露點−海溫', val: conditions.td_minus_sst, unit: '°C', digits: 2, hint: '接近 0 易凝霧' },
      ],
      historyKey: 'slots',
      note: '模型以低能見度等氣象條件推估關場風險，尚未以官方關場紀錄充分校準，僅供參考；不是機場官方關場決策或公告。',
    };
  }

  function advice(view, value) {
    const level = risk(value).tag;
    if (view.key === 'beigan' && !view.calibrated) {
      if (level === '高') return '關場風險偏高，請確認航班狀態並預留替代方案。';
      if (level === '中') return '有一定關場風險，請密切確認最新航班動態。';
      return '目前關場風險較低，仍請在出發前確認航班狀態。';
    }
    if (level === '高') return '關場風險偏高，請確認航班狀態並預留替代方案。';
    if (level === '中') return '有一定關場風險，出發前請確認最新航班動態。';
    return view.inSeason
      ? '目前關場風險較低，仍建議出發前確認航班。'
      : '目前非主要霧季，關場風險較低。';
  }

  function renderTabs() {
    document.querySelectorAll('.airport-tab').forEach((tab) => {
      const active = tab.dataset.airport === state.airport;
      tab.classList.toggle('active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
  }

  function renderForecast(view) {
    $('airport').textContent = view.airport;
    $('date').textContent = view.date || '—';
    const season = $('season');
    season.textContent = view.inSeason ? '霧季' : '非霧季';
    season.className = view.inSeason ? 'season-badge in' : 'season-badge';

    const maxValue = view.slots.length
      ? Math.max(...view.slots.map((slot) => slot.value || 0))
      : 0;
    const level = risk(maxValue);
    const gauge = $('gauge');
    gauge.style.setProperty('--c', level.color);
    requestAnimationFrame(() => gauge.style.setProperty('--p', pct(maxValue)));
    $('heroProb').textContent = pct(maxValue);
    $('heroProb').style.color = level.color;
    $('heroLabel').textContent = level.level;
    $('heroLabel').style.color = level.color;
    $('heroMetric').textContent = view.metric;
    $('heroAdvice').textContent = advice(view, maxValue);
    $('hero').hidden = view.slots.length === 0;

    $('slotsTitle').textContent = view.slotsTitle;
    const list = $('slots');
    list.innerHTML = '';
    view.slots.forEach((slot) => {
      const value = slot.value || 0;
      const slotRisk = risk(value);
      const element = document.createElement('div');
      element.className = 'slot';
      element.style.setProperty('--c', slotRisk.color);
      element.innerHTML = `
        <div class="slot-time">${esc(slot.time || '—')}</div>
        <div class="slot-mid">
          <div class="slot-bar"><span style="width:${Math.max(2, pct(value))}%"></span></div>
          <div class="slot-vis">${esc(slot.details)}</div>
        </div>
        <div class="slot-right">
          <div class="slot-prob">${pct(value)}%</div>
          <div class="slot-tag">${slotRisk.tag}</div>
        </div>`;
      list.appendChild(element);
    });
    $('slotsWrap').hidden = view.slots.length === 0;
  }

  function renderConditions(view) {
    $('conditionsMeta').textContent = view.conditionsMeta;
    const grid = $('conditions');
    grid.innerHTML = '';
    let count = 0;
    view.conditions.forEach((condition) => {
      if (condition.val == null || Number.isNaN(Number(condition.val))) return;
      count += 1;
      const element = document.createElement('div');
      element.className = 'cond';
      element.innerHTML = `
        <div class="cond-label">${esc(condition.label)}</div>
        <div class="cond-val">${Number(condition.val).toFixed(condition.digits)}<small>${esc(condition.unit)}</small></div>
        ${condition.hint ? `<div class="cond-hint">${esc(condition.hint)}</div>` : ''}`;
      grid.appendChild(element);
    });
    $('condWrap').hidden = count === 0;
  }

  function renderTrend(view) {
    const history = Array.isArray(state.history) ? state.history : [];
    const days = history
      .map((day) => {
        const values = Object.values(day[view.historyKey] || {});
        return values.length ? { date: day.date, value: Math.max(...values) } : null;
      })
      .filter(Boolean)
      .slice(-7);
    if (days.length < 2) {
      $('trendWrap').hidden = true;
      return;
    }
    $('trendTitle').textContent = `近日趨勢（${view.metric}最高值）`;
    const scaleMax = Math.max(0.1, ...days.map((day) => day.value));
    const chart = $('trend');
    chart.innerHTML = '';
    days.forEach((day) => {
      const level = risk(day.value);
      const column = document.createElement('div');
      column.className = 'trend-col';
      column.style.setProperty('--c', level.color);
      column.innerHTML = `
        <div class="trend-val">${pct(day.value)}%</div>
        <div class="trend-bar-wrap"><div class="trend-bar" style="height:${Math.max(4, day.value / scaleMax * 100)}%"></div></div>
        <div class="trend-day">${esc((day.date || '').slice(5))}</div>`;
      chart.appendChild(column);
    });
    $('trendWrap').hidden = false;
  }

  function compass(degrees) {
    if (degrees == null || Number.isNaN(Number(degrees))) return '—';
    const names = ['北', '東北', '東', '東南', '南', '西南', '西', '西北'];
    return names[Math.round(((Number(degrees) % 360) + 360) % 360 / 45) % 8];
  }

  function renderObservation(view) {
    const stations = Array.isArray(state.observations?.stations)
      ? state.observations.stations
      : [];
    const station = stations.find((item) => item.area === (view.key === 'beigan' ? '北竿' : '南竿'));
    if (!station) {
      $('observationsWrap').hidden = true;
      return;
    }
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
      ['雲幕高度', station.ceiling_ft, 'ft', 0],
    ];
    const cells = values.map(([label, value, unit, digits]) => {
      let display = '未提供';
      if (value != null && !Number.isNaN(Number(value))) {
        display = `${Number(value).toFixed(digits)}<small>${unit}</small>`;
        if (label === '風向') display += `<span class="wind-name">${compass(value)}</span>`;
      }
      return `<div class="obs-value"><span>${label}</span><strong>${display}</strong></div>`;
    }).join('');
    $('observations').innerHTML = `
      <article class="observation">
        <div class="obs-head">
          <div><strong>${esc(station.area)}</strong><span>${esc(station.station_name)}｜${esc(station.station_id)}</span></div>
          <time>${esc(observedText)}</time>
        </div>
        <div class="obs-values">${cells}</div>
        ${station.weather ? `<p class="observation-source">現象：${esc(station.weather)}</p>` : ''}
        ${station.flight_weather_allowed === false
          ? '<p class="observation-source">航空氣象網判定低於適航天氣條件；不等同機場已關場。</p>'
          : ''}
      </article>`;
    $('observationsUpdated').textContent = state.observations.generated_at
      ? `抓取於 ${relTime(state.observations.generated_at)}`
      : '';
    $('observationsSource').textContent = state.observations.source
      ? `資料來源：${state.observations.source}`
      : '';
    $('observationsWrap').hidden = false;
  }

  function render() {
    if (!state.today) return;
    const view = airportView();
    renderTabs();
    renderForecast(view);
    renderObservation(view);
    renderConditions(view);
    renderTrend(view);
    const generated = state.today.generated_at;
    $('footInfo').textContent = generated
      ? `資料更新於 ${relTime(generated)}（${new Date(generated).toLocaleString('zh-TW')}）`
      : '';
    $('footNote').textContent = view.note;
  }

  let loading = false;
  async function load() {
    if (loading) return;
    loading = true;
    $('refresh').classList.add('spin');
    try {
      state.today = await fetchJSON(CFG.todayUrl || 'today.json');
      $('loading').hidden = true;
      const optional = await Promise.allSettled([
        fetchJSON(CFG.historyUrl || 'history.json'),
        fetchJSON(CFG.observationsUrl || 'observations.json'),
      ]);
      state.history = optional[0].status === 'fulfilled' ? optional[0].value : [];
      state.observations = optional[1].status === 'fulfilled' ? optional[1].value : null;
      render();
      if (!navigator.onLine) banner('目前離線，顯示的是最後一次快取資料。', 'info');
      else if (isStale(state.today.generated_at)) banner('這份預報可能已過期（超過30小時未更新）。', 'warn');
      else banner('');
    } catch (error) {
      $('loading').hidden = true;
      banner(
        navigator.onLine
          ? `無法載入預報資料（${error.message}）。稍後重試。`
          : '目前離線，且沒有可用的快取資料。',
        'error',
      );
    } finally {
      loading = false;
      $('refresh').classList.remove('spin');
    }
  }

  document.querySelectorAll('.airport-tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      state.airport = tab.dataset.airport;
      localStorage.setItem('fog-airport', state.airport);
      render();
    });
  });
  $('refresh').addEventListener('click', load);
  window.addEventListener('online', load);
  window.addEventListener('offline', () => banner('已離線。', 'info'));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') load();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  renderTabs();
  load();
})();
