'use strict';

// ────────────────────────────────────────────────────
// CONFIG
// ────────────────────────────────────────────────────
const CSV_URL      = './euromillions_202002.csv';
const API_URL      = 'https://euromillions.api.pedromealha.dev/draws';
const DATA_CACHE   = 'euromil-data-v1';
const CACHE_KEY    = 'api-draws';
const CACHE_MAX_MS = 12 * 60 * 60 * 1000;   // 12 h
const DATE_MIN     = '2020-02-01';           // à partir de février 2020

// ────────────────────────────────────────────────────
// STATE
// ────────────────────────────────────────────────────
let draws    = [];   // [{dateKey, date, day, balls, stars}]  trié récent→ancien
let ballFreq = new Array(51).fill(0);
let starFreq = new Array(13).fill(0);
let ballRank = {};
let starRank = {};

// ────────────────────────────────────────────────────
// INIT
// ────────────────────────────────────────────────────
async function init() {
  setInfo('Chargement…');
  try {
    await loadData();
    computeRanks();
    setupTabs();
    renderGrilles();
  } catch (err) {
    setInfo('Erreur');
    document.getElementById('grilles-container').innerHTML =
      `<div class="error-msg">⚠️ ${err.message}<br><small>Lance via Live Server ou GitHub Pages.</small></div>`;
  }
}

function setInfo(txt) {
  document.getElementById('dataInfo').textContent = txt;
}

// ────────────────────────────────────────────────────
// CHARGEMENT DES DONNÉES (CSV + API fusionnés)
// ────────────────────────────────────────────────────
async function loadData() {
  // 1. CSV local (base historique)
  const csvDraws = await loadCSV();

  // 2. API (live) — via cache ou réseau
  let apiDraws  = [];
  let fromCache = false;
  let cacheAge  = null;
  try {
    const result = await loadAPI();
    apiDraws  = result.draws;
    fromCache = result.fromCache;
    cacheAge  = result.ageMs;
  } catch (_) { /* silencieux : on continue avec CSV seul */ }

  // 3. Fusion + déduplication (dateKey = clé unique)
  const map = new Map();
  csvDraws.forEach(d => map.set(d.dateKey, d));
  apiDraws.forEach(d => map.set(d.dateKey, d));  // API écrase si même date

  draws = Array.from(map.values())
    .filter(d => d.dateKey >= DATE_MIN)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey));

  // 4. Indicateur de fraîcheur
  const lastDate  = draws[0]?.date ?? '—';
  const sourceTag = apiDraws.length
    ? (fromCache ? `cache ${fmtAge(cacheAge)}` : 'live ✓')
    : 'CSV uniquement';
  setInfo(`${draws.length} tirages • dernier ${lastDate} • ${sourceTag}`);
}

function fmtAge(ms) {
  if (ms == null) return '';
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h ? `(${h}h${m}m)` : `(${m}min)`;
}

// ────────────────────────────────────────────────────
// CSV
// ────────────────────────────────────────────────────
async function loadCSV() {
  const res  = await fetch(CSV_URL);
  const text = await res.text();
  return parseCSV(text);
}

function parseCSV(text) {
  const DAYS_FR = { LUNDI:1,MARDI:2,MERCREDI:3,JEUDI:4,VENDREDI:5,SAMEDI:6,DIMANCHE:0 };
  const result  = [];
  const lines   = text.replace(/\r/g, '').split('\n');

  for (let i = 1; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (!raw) continue;
    const c = raw.split(';');
    if (c.length < 12) continue;

    const date = c[2].trim();               // DD/MM/YYYY
    const day  = c[1].trim().toUpperCase().replace(/\s+/g,'');

    const balls = [c[5],c[6],c[7],c[8],c[9]]
      .map(Number).filter(n => n >= 1 && n <= 50);
    const stars = [c[10],c[11]]
      .map(Number).filter(n => n >= 1 && n <= 12);

    if (balls.length !== 5 || stars.length !== 2 || !date) continue;

    const [dd, mm, yyyy] = date.split('/');
    result.push({
      dateKey : `${yyyy}-${mm}-${dd}`,
      date,
      day,
      balls,
      stars
    });
  }
  return result;
}

// ────────────────────────────────────────────────────
// API
// ────────────────────────────────────────────────────
async function loadAPI() {
  // Vérifie le cache CacheStorage
  const cached = await readAPICache();
  if (cached && cached.ts && (Date.now() - cached.ts) < CACHE_MAX_MS) {
    return { draws: cached.draws, fromCache: true, ageMs: Date.now() - cached.ts };
  }

  // Appel réseau
  const res = await fetch(API_URL, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`API HTTP ${res.status}`);
  const raw = await res.json();

  const apiDraws = raw
    .filter(d => Array.isArray(d.numbers) && d.numbers.length === 5
              && Array.isArray(d.stars)   && d.stars.length === 2
              && d.date)
    .map(parseAPIRow)
    .filter(d => d.dateKey >= DATE_MIN);

  // Mise en cache
  await writeAPICache({ ts: Date.now(), draws: apiDraws });
  return { draws: apiDraws, fromCache: false, ageMs: 0 };
}

function parseAPIRow(d) {
  // d.date ex: "Tue, 20 May 2026 00:00:00 GMT"
  const dt      = new Date(d.date);
  const yyyy    = dt.getUTCFullYear();
  const mm      = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd      = String(dt.getUTCDate()).padStart(2, '0');
  const dateKey = `${yyyy}-${mm}-${dd}`;
  const dateStr = `${dd}/${mm}/${yyyy}`;
  const DAYS    = ['DIMANCHE','LUNDI','MARDI','MERCREDI','JEUDI','VENDREDI','SAMEDI'];
  const day     = DAYS[dt.getUTCDay()];

  const balls = d.numbers.map(Number).filter(n => n >= 1 && n <= 50);
  const stars = d.stars.map(Number).filter(n => n >= 1 && n <= 12);

  return { dateKey, date: dateStr, day, balls, stars };
}

// ────────────────────────────────────────────────────
// CACHE (CacheStorage — pas de localStorage)
// ────────────────────────────────────────────────────
async function readAPICache() {
  try {
    const cache = await caches.open(DATA_CACHE);
    const res   = await cache.match(CACHE_KEY);
    if (!res) return null;
    return await res.json();
  } catch { return null; }
}

async function writeAPICache(payload) {
  try {
    const cache = await caches.open(DATA_CACHE);
    await cache.put(CACHE_KEY, new Response(JSON.stringify(payload), {
      headers: { 'Content-Type': 'application/json' }
    }));
  } catch { /* silencieux */ }
}

// ────────────────────────────────────────────────────
// FRÉQUENCES & RANGS
// ────────────────────────────────────────────────────
function computeRanks() {
  ballFreq = new Array(51).fill(0);
  starFreq = new Array(13).fill(0);

  draws.forEach(d => {
    d.balls.forEach(b => ballFreq[b]++);
    d.stars.forEach(s => starFreq[s]++);
  });

  const sortedB = Array.from({length:50},(_,i)=>i+1).sort((a,b)=>ballFreq[b]-ballFreq[a]);
  sortedB.forEach((n,i) => { ballRank[n] = i+1; });

  const sortedS = Array.from({length:12},(_,i)=>i+1).sort((a,b)=>starFreq[b]-starFreq[a]);
  sortedS.forEach((n,i) => { starRank[n] = i+1; });
}

// ────────────────────────────────────────────────────
// COULEURS ARC-EN-CIEL
// rang 1 (+ fréquent) = rouge   rang max = violet
// ────────────────────────────────────────────────────
function bColor(num) {
  const h = ((ballRank[num] - 1) / 49) * 270;
  return `hsl(${h.toFixed(1)},100%,55%)`;
}
function sColor(num) {
  const h = ((starRank[num] - 1) / 11) * 270;
  return `hsl(${h.toFixed(1)},100%,55%)`;
}

// ────────────────────────────────────────────────────
// TABS
// ────────────────────────────────────────────────────
function setupTabs() {
  document.querySelectorAll('.tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      const id = btn.dataset.tab;
      document.getElementById(id).classList.add('active');
      if (id === 'stats')   renderStats();
      if (id === 'tirages') renderTirages();
    });
  });
}

// ────────────────────────────────────────────────────
// TAB 1 — GRILLES
// ────────────────────────────────────────────────────
function renderGrilles() {
  const wrap = document.getElementById('grilles-container');
  wrap.innerHTML = '';
  for (let i = 0; i < 5; i++) {
    const g   = makeGrid();
    const div = document.createElement('div');
    div.className = 'grid-card';
    div.innerHTML =
      `<div class="grid-label">Grille ${i+1}</div>
       <div class="balls-row">
         ${g.balls.map(b=>`<span class="ball" style="--c:${bColor(b)}">${b}</span>`).join('')}
         ${g.stars.map(s=>`<span class="star" style="--c:${sColor(s)}">${s}</span>`).join('')}
       </div>`;
    wrap.appendChild(div);
  }
  const btn = document.createElement('button');
  btn.className = 'refresh-btn';
  btn.textContent = '↻  Nouvelles grilles';
  btn.onclick = renderGrilles;
  wrap.appendChild(btn);
}

function makeGrid() {
  return {
    balls: weightedSample(50, 5, ballFreq).sort((a,b)=>a-b),
    stars: weightedSample(12, 2, starFreq).sort((a,b)=>a-b)
  };
}

function weightedSample(max, count, freq) {
  const pool    = Array.from({length:max},(_,i)=>i+1);
  const weights = pool.map(i => freq[i]+1);
  const result  = [];
  while (result.length < count && pool.length > 0) {
    const total = weights.reduce((a,b)=>a+b,0);
    let r = Math.random() * total, j = 0;
    while (j < pool.length-1 && r > weights[j]) { r -= weights[j]; j++; }
    result.push(pool[j]); pool.splice(j,1); weights.splice(j,1);
  }
  return result;
}

// ────────────────────────────────────────────────────
// TAB 2 — STATISTIQUES
// ────────────────────────────────────────────────────
let statsRendered = false;
function renderStats() {
  if (statsRendered) return;
  statsRendered = true;
  const wrap = document.getElementById('stats-container');

  const top5 = Array.from({length:50},(_,i)=>i+1).sort((a,b)=>ballFreq[b]-ballFreq[a]).slice(0,5);
  const top2 = Array.from({length:12},(_,i)=>i+1).sort((a,b)=>starFreq[b]-starFreq[a]).slice(0,2);
  const maxBF = Math.max(...Array.from({length:50},(_,i)=>ballFreq[i+1]));
  const maxSF = Math.max(...Array.from({length:12},(_,i)=>starFreq[i+1]));

  wrap.innerHTML =
    `<div class="stats-section">
       <div class="section-title">Podium</div>
       ${buildPodium(top5, top2)}
     </div>
     <div class="stats-section">
       <div class="section-title">Fréquences — 50 numéros</div>
       ${buildFreqBars(50, ballFreq, maxBF, 'b')}
     </div>
     <div class="stats-section">
       <div class="section-title">Fréquences — 12 étoiles</div>
       ${buildFreqBars(12, starFreq, maxSF, 's')}
     </div>`;
}

function buildPodium(top5, top2) {
  const order = [top5[1], top5[0], top5[2]];
  const heights = [68, 100, 48];
  const medals  = ['🥈','🥇','🥉'];

  let html = '<div class="podium-stage">';
  for (let i = 0; i < 3; i++) {
    const n=order[i], c=bColor(n);
    html +=
      `<div class="podium-col">
         <div class="podium-ball-wrap">
           <div class="ball-lg" style="box-shadow:0 0 14px ${c}88;color:${c};border:2px solid ${c}44">${n}</div>
           <div class="podium-freq">${ballFreq[n]}×</div>
         </div>
         <div class="podium-block" style="height:${heights[i]}px;background:linear-gradient(to bottom,${c}99,${c}22)">
           <span class="podium-medal">${medals[i]}</span>
         </div>
       </div>`;
  }
  html += '</div><div class="podium-rest">';
  for (let i=3;i<5;i++) {
    const n=top5[i], c=bColor(n);
    html +=
      `<div class="podium-rest-item">
         <span class="podium-rank">${i+1}e</span>
         <div class="ball-lg" style="box-shadow:0 0 8px ${c}77;color:${c};border:2px solid ${c}44">${n}</div>
         <span class="podium-freq-sm">${ballFreq[n]}×</span>
       </div>`;
  }
  html += `</div><hr class="podium-divider">
           <div class="podium-stars-label">★ Étoiles</div>
           <div class="podium-stars">`;
  top2.forEach((n,i) => {
    const c=sColor(n);
    html +=
      `<div class="podium-rest-item">
         <span class="podium-rank" style="color:#fbbf24">★${i+1}</span>
         <span class="star" style="width:40px;height:40px;font-size:1.1rem;background:${c};box-shadow:0 0 10px ${c}">${n}</span>
         <span class="podium-freq-sm">${starFreq[n]}×</span>
       </div>`;
  });
  html += '</div>';
  return html;
}

function buildFreqBars(max, freq, maxFreq, type) {
  let html = '<div class="freq-grid">';
  for (let n=1;n<=max;n++) {
    const pct = ((freq[n]/maxFreq)*100).toFixed(1);
    const c   = type==='b' ? bColor(n) : sColor(n);
    html +=
      `<div class="freq-item">
         <div class="freq-bar-track">
           <div class="freq-bar" style="height:${pct}%;background:${c};box-shadow:0 0 4px ${c}66"></div>
         </div>
         <div class="freq-lbl" style="color:${c}">${n}</div>
         <div class="freq-cnt">${freq[n]}</div>
       </div>`;
  }
  return html + '</div>';
}

// ────────────────────────────────────────────────────
// TAB 3 — TIRAGES 2026
// ────────────────────────────────────────────────────
let tiragesRendered = false;
function renderTirages() {
  if (tiragesRendered) return;
  tiragesRendered = true;
  const wrap = document.getElementById('tirages-container');
  const MONTHS = ['','jan.','fév.','mars','avr.','mai','juin','juil.','août','sept.','oct.','nov.','déc.'];

  const list = draws.filter(d => d.dateKey.startsWith('2026-'));

  function fmtDate(d) {
    const [yyyy,mm,dd] = d.dateKey.split('-');
    const dayFmt = d.day.charAt(0) + d.day.slice(1).toLowerCase();
    return `${dayFmt} ${parseInt(dd)} ${MONTHS[parseInt(mm)]} ${yyyy}`;
  }

  let html = `<div class="tirages-header">${list.length} tirages en 2026</div>`;
  list.forEach(d => {
    html +=
      `<div class="tirage-card">
         <div class="tirage-date">${fmtDate(d)}</div>
         <div class="tirage-balls">
           ${d.balls.map(b=>`<span class="ball-sm" style="--c:${bColor(b)}">${b}</span>`).join('')}
           ${d.stars.map(s=>`<span class="star-sm" style="--c:${sColor(s)}">${s}</span>`).join('')}
         </div>
       </div>`;
  });
  wrap.innerHTML = html;
}

// ────────────────────────────────────────────────────
// SERVICE WORKER
// ────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

// ────────────────────────────────────────────────────
// START
// ────────────────────────────────────────────────────
init();
