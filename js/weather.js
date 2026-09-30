// Clima atual pela Open-Meteo (grátis, sem conta e sem chave).
// O local escolhido fica salvo neste navegador pra atualizar sozinho depois.

import { CmdError } from './util.js';

const GEO_KEY = 'mb.geo.v1';

// Códigos WMO → símbolo monocromático + descrição.
// ︎ força o símbolo em modo texto (sem virar emoji colorido).
const T = '︎';
const WMO = [
  [[0], '☀' + T, 'céu limpo'],
  [[1], '☀' + T, 'quase limpo'],
  [[2], '◐', 'parcialmente nublado'],
  [[3], '☁' + T, 'nublado'],
  [[45, 48], '≋', 'neblina'],
  [[51, 53, 55, 56, 57], '⋮', 'garoa'],
  [[61, 63, 65, 66, 67], '☂' + T, 'chuva'],
  [[71, 73, 75, 77, 85, 86], '❄' + T, 'neve'],
  [[80, 81, 82], '☂' + T, 'pancadas de chuva'],
  [[95, 96, 99], 'ϟ', 'trovoada'],
];
export function describe(code) {
  const hit = WMO.find(([codes]) => codes.includes(code));
  return hit ? { icon: hit[1], text: hit[2] } : { icon: '◌', text: `código ${code}` };
}

export function savedPlace() {
  try { return JSON.parse(localStorage.getItem(GEO_KEY)); } catch { return null; }
}
function savePlace(p) {
  try { localStorage.setItem(GEO_KEY, JSON.stringify(p)); } catch {}
}

async function getJSON(url, signal) {
  let res;
  try { res = await fetch(url, { signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new CmdError('E_NET', 'wx', 'sem resposta do serviço de clima', 'confira a internet e tente de novo');
  }
  if (!res.ok) throw new CmdError('E_HTTP_' + res.status, 'wx', 'o serviço de clima respondeu com erro', 'tente de novo em alguns minutos');
  return res.json();
}

export async function geocode(name, signal) {
  const url = `https://geocoding-api.open-meteo.com/v1/search?count=1&language=pt&format=json&name=${encodeURIComponent(name)}`;
  const data = await getJSON(url, signal);
  const r = data.results?.[0];
  if (!r) throw new CmdError('E_GEO_404', 'wx', `cidade não encontrada: ${name}`, 'tente o nome sem abreviação, ex: <span class="c-hud">/clima joinville</span>');
  return { lat: r.latitude, lon: r.longitude, name: r.name, region: r.admin1 || r.country || '' };
}

export function locate(signal) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      return reject(new CmdError('E_GEO_NA', 'wx', 'este navegador não informa localização', 'use <span class="c-hud">/clima nome-da-cidade</span>'));
    }
    signal?.addEventListener('abort', () => reject(new DOMException('cancelado', 'AbortError')), { once: true });
    navigator.geolocation.getCurrentPosition(
      p => resolve({ lat: +p.coords.latitude.toFixed(3), lon: +p.coords.longitude.toFixed(3), name: 'local atual', region: '' }),
      () => reject(new CmdError('E_GEO_DENIED', 'wx', 'localização não autorizada', 'use <span class="c-hud">/clima nome-da-cidade</span>')),
      { timeout: 12000, maximumAge: 30 * 60 * 1000 });
  });
}

export async function fetchWeather(place, signal) {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${place.lat}&longitude=${place.lon}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m&timezone=auto';
  const data = await getJSON(url, signal);
  const c = data.current;
  if (!c) throw new CmdError('E_WX_EMPTY', 'wx', 'resposta de clima sem dados', 'tente de novo');
  savePlace(place);
  return {
    place,
    temp: c.temperature_2m,
    feels: c.apparent_temperature,
    hum: c.relative_humidity_2m,
    wind: c.wind_speed_10m,
    code: c.weather_code,
    at: Date.now(),
  };
}
