'use strict';
// ユーザーの場所の天気と気温(Open-Meteo: 無料・キー不要)。場所は約1kmに丸めたものだけを扱う。
const CACHE_MS = 20 * 60 * 1000;
const cache = new Map();

// WMO 天気コード → 日本語・アイコン
function describe(code) {
  if (code === 0) return ['快晴', '☀️']; if (code === 1) return ['晴れ', '🌤️']; if (code === 2) return ['くもりがち', '⛅']; if (code === 3) return ['くもり', '☁️'];
  if (code === 45 || code === 48) return ['霧', '🌫️']; if (code >= 51 && code <= 57) return ['霧雨', '🌦️']; if (code >= 61 && code <= 67) return ['雨', '🌧️'];
  if (code >= 71 && code <= 77) return ['雪', '❄️']; if (code >= 80 && code <= 82) return ['にわか雨', '🌦️']; if (code === 85 || code === 86) return ['雪', '❄️']; if (code >= 95) return ['雷雨', '⛈️'];
  return ['くもり', '☁️'];
}

async function fetchWeather(lat, lng) {
  const la = Math.round(lat * 100) / 100, ln = Math.round(lng * 100) / 100, key = `${la},${ln}`;
  const hit = cache.get(key); if (hit && Date.now() - hit.at < CACHE_MS) return hit.w;
  const r = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${ln}&current=temperature_2m,apparent_temperature,weather_code,precipitation,wind_speed_10m&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=1`,
    { signal: AbortSignal.timeout(5000) });
  if (!r.ok) throw new Error(`weather ${r.status}`);
  const j = await r.json(), c = j.current || {}, d = j.daily || {};
  const [desc, icon] = describe(c.weather_code);
  const w = { desc, icon, code: c.weather_code, temp: Math.round(c.temperature_2m), feels: Math.round(c.apparent_temperature), wind: Math.round(c.wind_speed_10m || 0),
    max: d.temperature_2m_max ? Math.round(d.temperature_2m_max[0]) : null, min: d.temperature_2m_min ? Math.round(d.temperature_2m_min[0]) : null,
    rainProb: d.precipitation_probability_max ? d.precipitation_probability_max[0] : null };
  cache.set(key, { at: Date.now(), w }); if (cache.size > 200) cache.delete(cache.keys().next().value);
  return { ...w, lat: la, lng: ln };
}

// 返事のプロンプトに足す一文(場所は番地までは分からない=地名は言わない)
function block(env) {
  if (!env || Date.now() - env.updated_at > 3 * 3600 * 1000) return '';
  const w = env.weather;
  const hint = w.temp >= 30 ? '暑い' : w.temp >= 25 ? '暑め' : w.temp <= 5 ? 'とても寒い' : w.temp <= 12 ? '寒め' : '過ごしやすい';
  return `\n\n【いまの相手のいる場所の天気】${w.desc}、気温${w.temp}℃(体感${w.feels}℃、${hint})` +
    `${w.max != null ? `、今日の最高${w.max}℃/最低${w.min}℃` : ''}${w.rainProb != null && w.rainProb >= 50 ? `、雨の確率${w.rainProb}%` : ''}。` +
    'この天気や気温に合う声かけ(「寒いからあったかくしてね」など)を、話の流れで自然なときだけ入れてよい。毎回は言わない。場所の地名は分からないので言わない。';
}
module.exports = { fetchWeather, block, describe };
