// 前端設定。改這裡即可切換資料來源，程式碼與 UI 都不必動。
//
// 預設「零後端」模式：抓同目錄的 today.json / history.json（可放 GitHub Pages）。
// 要改接自寫 API（練後端／未來付費牆）時，把下面兩個 URL 換成：
//   todayUrl:   'http://127.0.0.1:8000/api/today'
//   historyUrl: 'http://127.0.0.1:8000/api/history'
// API 端 CORS 需允許本前端來源（api/config.py 的 CORS_ORIGINS）。
window.FOG_CONFIG = {
  todayUrl: 'today.json',
  historyUrl: 'history.json',
  observationsUrl: 'observations.json',

  // 起霧／低能見度風險分級門檻（機率）。低於 low 為低風險，high 以上為高風險。
  riskBands: { low: 0.15, high: 0.40 },

  // 資料視為「過期」的時數：generated_at 超過這麼久就顯示提醒（排程一天一跑）。
  staleHours: 30,
};
