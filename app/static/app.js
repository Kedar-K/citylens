/* CityLens operator workspace */
const $ = s => document.querySelector(s);
const BASE = location.pathname.replace(/\/?$/, '/');
const api = (p, o) => fetch(BASE + 'api/' + p, o).then(r => { if (!r.ok) throw new Error(r.status + ' ' + p); return r.json(); });
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const clipUrl = s => BASE + 'api/clip?source=' + encodeURIComponent(s);
const thumbUrl = s => BASE + 'api/thumb?source=' + encodeURIComponent(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const RULECOL = { lane_blocked: '#ff4150', pedestrian_conflict: '#f2a93b', cyclist_squeeze: '#3ecf8e', congestion: '#9aa6ff', work_zone: '#c084fc', lane_closure: '#c084fc', garbage_dumping: '#8a8a95', person_down: '#ff4150' };
const NAMES = { 'sf_streets_cam-1': 'SF Street 1', 'sf_streets_cam-2': 'SF Street 2', 'sf_streets_cam-3': 'SF Street 3', 'sf_streets_cam-4': 'SF Street 4', 'sf_streets_cam-5': 'SF Street 5', 'nyc_streets_cam-1': 'NYC Street 1', 'nyc_streets_cam-2': 'NYC Street 2', 'neighborhood_cam-1': 'Residential 1', 'pie_cam-3': 'Toronto dashcam', 'nyc_bike_gopro-1': 'NYC bike cam', 'i24_cam-1': 'I-24 corridor', 'smartspace_cam-1': 'Indoor facility', 'sdg_warehouse_cam-2': 'Warehouse' };
const CITY = { san_francisco: 'San Francisco', new_york: 'New York', toronto: 'Toronto', nashville: 'Nashville', neighborhood: 'Residential site', indoor: 'Indoor', warehouse3: 'Warehouse' };
const nice = c => NAMES[c] || c || '';
const city = l => CITY[l] || l || '';
const mmss = s => s == null ? '' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
const ago = iso => { if (!iso) return ''; const d = (Date.now() - Date.parse(iso)) / 1000; return d < 90 ? 'just now' : d < 3600 ? Math.round(d / 60) + ' min ago' : d < 86400 ? Math.round(d / 3600) + ' h ago' : Math.round(d / 86400) + ' d ago'; };
const toast = t => { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 3500); };
Chart.defaults.color = '#8b97a8'; Chart.defaults.font.family = '"Nunito Sans", system-ui, sans-serif'; Chart.defaults.borderColor = 'rgba(255,255,255,.07)';

/* kpi builder */
const ICON = { camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 10l5-3v10l-5-3"/></svg>', clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>', clip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M8 5v14M16 5v14"/></svg>', box: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16M9 4v16"/></svg>', alert: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l9 16H3z"/><path d="M12 10v4M12 17h.01"/></svg>', check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12l5 5 9-10"/></svg>', people: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3"/><path d="M3 20c0-3 3-5 6-5s6 2 6 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15 15c3 0 6 1.5 6 4"/></svg>', doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>', pin: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/></svg>', car: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 14l2-6h12l2 6v5H4z"/><circle cx="8" cy="16" r="1.5"/><circle cx="16" cy="16" r="1.5"/></svg>', up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 18l6-7 4 4 6-8"/></svg>', ratio: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12h16M12 4v16"/></svg>', city: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 21h18M5 21V8l5-3v16M14 21V11l5-2v12"/></svg>' };
const kpi = (v, l, c = '', ic = 'box') => `<div class="kpi ${c}"><div class="ic">${ICON[ic] || ICON.box}</div><div><div class="v">${v}</div><div class="l">${l}</div></div></div>`;

/* navigation */
const views = ['overview', 'incidents', 'measure', 'system', 'city'];
const loaded = {};
function show(v) {
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  views.forEach(x => $('#v-' + x).hidden = x !== v);
  if (!loaded[v]) { loaded[v] = true; ({ overview: loadOverview, incidents: loadIncidents, measure: loadMeasure, system: loadSystem, city: () => {} })[v](); }
  if (v === 'overview' && map) setTimeout(() => map.invalidateSize(), 50);
  if (v !== 'city') history.replaceState(null, '', '#' + v);
}
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => show(b.dataset.view));
const appEl = document.querySelector('.app');
try { if (localStorage.getItem('cl-collapsed') === '1') appEl.classList.add('collapsed'); } catch (e) {}
$('#collapse').onclick = () => { appEl.classList.toggle('collapsed'); try { localStorage.setItem('cl-collapsed', appEl.classList.contains('collapsed') ? '1' : '0'); } catch (e) {} setTimeout(() => { map && map.invalidateSize(); cmap && cmap.invalidateSize(); [cFlow, cMix, cCmp].forEach(c => c && c.resize()); }, 250); };

/* ---------- overview ---------- */
let map, OV;
function spark(vals, base) {
  const w = 90, h = 34, mx = Math.max(...vals, base || 1, 1);
  const X = i => (i / Math.max(vals.length - 1, 1)) * w, Y = v => h - 2 - (v / mx) * (h - 6);
  const line = vals.map((v, i) => (i ? 'L' : 'M') + X(i).toFixed(1) + ',' + Y(v).toFixed(1)).join('');
  const area = line + `L${w},${h}L0,${h}Z`;
  return `<svg viewBox="0 0 ${w} ${h}"><path d="${area}" fill="rgba(229,32,47,.16)"/><path d="${line}" fill="none" stroke="#ff4150" stroke-width="1.6"/>${base ? `<line x1="0" x2="${w}" y1="${Y(base)}" y2="${Y(base)}" stroke="#8a8a95" stroke-dasharray="3 3" stroke-width="1"/>` : ''}</svg>`;
}
async function loadOverview() {
  OV = await api('overview');
  const k = OV.kpis;
  $('#kpis').innerHTML = [
    [k.fixed_cameras, 'street cameras watched', 'teal', 'camera'], [k.minutes.toLocaleString() + ' min', 'video indexed across ' + k.cities + ' cities', 'blue', 'clock'],
    [k.clips.toLocaleString(), 'clips described by Cosmos', 'violet', 'clip'], [k.detections.toLocaleString(), 'objects detected by YOLO', 'amber', 'box'],
    [k.incidents_confirmed, 'incidents confirmed', 'red', 'alert'], [k.false_alarms_suppressed, 'false alarms suppressed', 'green', 'check']
  ].map(a => kpi(...a)).join('');
  $('#live-txt').textContent = `Watching ${k.fixed_cameras} street cameras`;
  $('#n-inc').textContent = k.incidents_confirmed || '';
  // map
  if (!map) {
    map = L.map('map', { zoomControl: false, attributionControl: false, scrollWheelZoom: false }).setView([39.5, -96], 4);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addAttribution('Basemap © Esri').addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
  }
  map.eachLayer(l => { if (l instanceof L.CircleMarker || l instanceof L.Marker || l instanceof L.LayerGroup) map.removeLayer(l); });
  const pts = [];
  for (const c of OV.cities) {
    const col = c.status === 'incident' ? '#ff4150' : '#2dd4bf';
    const m = L.circleMarker([c.lat, c.lon], { radius: 9 + Math.min(c.cameras, 6) * 1.5, color: col, weight: 1.5, fillColor: col, fillOpacity: .12 }).addTo(map);
    
    m.bindPopup(`<b>${c.name}</b><br>${c.cameras} camera${c.cameras > 1 ? 's' : ''} · ${c.minutes} min indexed<br>${c.incidents} confirmed incident${c.incidents === 1 ? '' : 's'}<br><a href="#" onclick="openCity('${c.location}');return false">Open city view →</a>`);
    L.marker([c.lat, c.lon], { icon: L.divIcon({ className: 'city-label', html: `${c.name} <span style="color:#8a8a95">· ${c.cameras}</span>`, iconAnchor: [-14, 8] }) }).on('click', () => openCity(c.location)).addTo(map);
    pts.push([c.lat, c.lon]);
  }
  // camera pins (illustrative placement, see store.CAMERA_POS)
  camLayer = L.layerGroup().addTo(map);
  for (const c of OV.cameras.filter(c => c.lat)) {
    const col = c.status === 'incident' ? '#ff4150' : c.status === 'busy' ? '#f2a93b' : '#2dd4bf';
    const m = L.circleMarker([c.lat, c.lon], { radius: 6, color: '#09090b', weight: 2, fillColor: col, fillOpacity: 1 }).addTo(camLayer);
    m.bindPopup(() => camPopup(c, nearby311(c)), { minWidth: 260 });
    pts.push([c.lat, c.lon]);
  }
  if (pts.length) map.fitBounds(pts, { padding: [50, 90], maxZoom: 6 });
  $('#map-sub').innerHTML = OV.cities.map(c => `<a href="#" onclick="openCity('${c.location}');return false" style="margin-left:10px;font-weight:600">${c.name} →</a>`).join('') + ` <span style="margin-left:10px">· camera placement illustrative</span>`;
  // feed
  $('#feed').innerHTML = OV.feed.length ? OV.feed.map(i => `<div class="fitem" data-src="${esc(i.source)}"><img src="${thumbUrl(i.source)}" loading="lazy" alt=""><div><div class="t"><i class="rule-dot" style="color:${RULECOL[i.rule_id] || '#8a8a95'}"></i>${esc(i.rule)} <span class="chip ${i.severity}">${i.severity}</span></div><div class="s">${nice(i.camera_id)} · ${city(i.location)} · at ${mmss(i.segment_start_sec)} · ${ago(i.detected_at)}</div><div class="r">${esc(i.reason)}</div></div></div>`).join('')
    : '<div class="empty">No confirmed incidents yet. Run a watch on the Incidents screen.</div>';
  document.querySelectorAll('.fitem').forEach(el => el.onclick = () => { show('incidents'); $('#i-filter').value = 'confirmed'; if (loaded.incidents) loadStored(); });
  // city services (311) for cities that publish open data
  loadCity();
  // wall
  $('#wall').innerHTML = OV.cameras.map(c => `<div class="cam" data-cam="${c.camera_id}"><div class="img"><img src="${thumbUrl(c.latest_source)}" loading="lazy" alt=""><span class="chip ${c.status}">${c.status === 'incident' ? c.incidents + ' incident' + (c.incidents > 1 ? 's' : '') : c.status}</span><span class="id">${c.fixed ? 'fixed' : c.capture_type}</span></div>
    <div class="b"><div><div class="n">${nice(c.camera_id)}</div><div class="m">${city(c.location)} · ${c.minutes} min · ${c.ratio != null ? c.ratio + '× normal' : ''}</div></div>${spark(c.spark, c.baseline)}</div></div>`).join('');
  document.querySelectorAll('.cam').forEach(el => el.onclick = () => { show('measure'); $('#m-cam').value = el.dataset.cam; $('#m-run').click(); });
}

let layer311 = null, camLayer = null, CITYDATA = {};
function pointPopup(kind, col, title, sub, meta) {
  return `<div class="pop pop2"><div class="pk2" style="color:${col}">${esc(kind)}</div><div class="pt"><b>${esc(title || '')}</b></div>${sub ? `<div class="ps">${esc(sub)}</div>` : ''}<div class="pk">${(meta || []).filter(Boolean).map(m => `<span>${esc(m)}</span>`).join('')}</div></div>`;
}
function camPopup(c, n311, nPermits) {
  const load = c.ratio == null ? '' : c.ratio > 1.3 ? `busier than usual, ${c.ratio}× its normal` : c.ratio < 0.6 ? `quieter than usual, ${c.ratio}× its normal` : `normal load, ${c.ratio}× its normal`;
  return `<div class="pop"><img src="${thumbUrl(c.latest_source)}" alt=""><div class="pt"><b>${nice(c.camera_id)}</b><span class="chip ${c.status}">${c.status}</span></div><div class="ps">${esc(c.intersection || '')} · ${city(c.location)}</div>
  <div class="pk"><span>${c.minutes} min</span><span>${c.incidents} confirmed incident${c.incidents === 1 ? '' : 's'}</span>${n311 != null ? `<span>${n311} 311 requests nearby</span>` : ''}${nPermits != null ? `<span>${nPermits} permits nearby</span>` : ''}</div><div class="ps">${load}</div>
  <a href="#" onclick="show('measure');document.querySelector('#m-cam').value='${c.camera_id}';document.querySelector('#m-run').click();return false">Open camera →</a></div>`;
}
function nearby311(c) {
  const d = CITYDATA[c.location]; if (!d || !d.cases) return null;
  const R = 6371000, toR = x => x * Math.PI / 180;
  return d.cases.filter(x => { const dLat = toR(x.lat - c.lat), dLon = toR(x.lon - c.lon); const a = Math.sin(dLat / 2) ** 2 + Math.cos(toR(c.lat)) * Math.cos(toR(x.lat)) * Math.sin(dLon / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(a)) < 500; }).length;
}
async function loadCity() {
  const locs = OV.cities.map(c => c.location).filter(l => ['san_francisco', 'new_york'].includes(l));
  const res = await Promise.all(locs.map(l => api('city?location=' + l).catch(() => null)));
  CITYDATA = {}; res.forEach((d, i) => { if (d) CITYDATA[locs[i]] = d; });
  $('#city').innerHTML = Object.values(CITYDATA).map(d => {
    if (d.error) return `<div class="panel"><div class="h"><b>${esc(d.name)}</b><span>unavailable</span></div><div class="c empty">${esc(d.error)}</div></div>`;
    const mx = d.categories[0]?.[1] || 1;
    const cams = OV.cameras.filter(c => c.location === d.location);
    const inc = cams.reduce((a, c) => a + c.incidents, 0);
    return `<div class="panel h-amber"><div class="h"><b>${esc(d.name)} · what residents report</b><span>${d.total} latest requests · ${esc(d.attribution)} · ${d.fetched_at}</span></div><div class="c">
      <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px">${kpi(d.street_related, 'street-related requests a camera could corroborate', 'amber', 'doc')}${kpi(inc, 'incidents CityLens confirmed on ' + cams.length + ' cameras here', 'red', 'alert')}${kpi(d.latest ? ago(d.latest) : '–', 'most recent request', 'blue', 'clock')}</div>
      <div class="c311">${d.categories.map(([c, n]) => `<span>${esc(c)}</span><b>${n}</b><div class="bar"><i style="width:${Math.round(100 * n / mx)}%"></i></div>`).join('')}</div></div></div>`;
  }).join('');
  if ($('#l311').checked) draw311();
  // nearby 311 on the camera wall
  for (const c of OV.cameras.filter(c => c.lat)) { const n = nearby311(c); const el = document.querySelector(`.cam[data-cam="${c.camera_id}"] .m`); if (el && n != null) el.insertAdjacentHTML('beforeend', ` · ${n} 311 nearby`); }
}
function draw311() {
  if (layer311) { map.removeLayer(layer311); layer311 = null; }
  if (!$('#l311').checked) return;
  layer311 = L.layerGroup();
  for (const d of Object.values(CITYDATA)) for (const c of (d.cases || [])) {
    L.circleMarker([c.lat, c.lon], { radius: 3, color: '#f2a93b', weight: 0, fillColor: '#f2a93b', fillOpacity: .75 })
      .bindPopup(() => pointPopup('311 request', '#f2a93b', c.category, c.detail, [c.where, ago(c.when), c.status]), { minWidth: 240 }).addTo(layer311);
  }
  layer311.addTo(map);
  const first = Object.values(CITYDATA).find(d => d.cases?.length);
  if (first && map.getZoom() < 9) { const c = OV.cities.find(x => x.location === first.location); if (c) map.flyTo([c.lat, c.lon], 13, { duration: .8 }); }
}
$('#l311').onchange = draw311;

/* ---------- bounding boxes ---------- */
const BOXCOL = { person: '#f2a93b', car: '#7cc4ff', truck: '#c084fc', bus: '#5eead4', motorcycle: '#ff8fa3', bicycle: '#3ecf8e', 'traffic light': '#8a8a95' };
const boxCache = {};
async function toggleBoxes(card, on) {
  const v = card.querySelector('video'); let cv = card.querySelector('canvas.boxes');
  if (!on) { if (cv) cv.remove(); if (v._boxLoop) cancelAnimationFrame(v._boxLoop); v._boxLoop = null; return; }
  const src = card.dataset.cur || card.dataset.src;
  if (!boxCache[src]) { card.querySelector('.boxbtn').textContent = 'Loading boxes…'; try { boxCache[src] = await api('boxes?source=' + encodeURIComponent(src)); } catch (e) { toast('No boxes: ' + e.message); card.querySelector('.boxbtn').textContent = 'Boxes'; return; } card.querySelector('.boxbtn').textContent = 'Boxes'; }
  const B = boxCache[src];
  if (!cv) { cv = document.createElement('canvas'); cv.className = 'boxes'; card.querySelector('.v').appendChild(cv); }
  cv.width = B.shape[1]; cv.height = B.shape[0];
  const ctx = cv.getContext('2d'), byIdx = new Map(B.frames.map(f => [f.i, f.d]));
  const draw = () => {
    const i = Math.round(v.currentTime * B.fps); const k = i - (i % B.step); const dets = byIdx.get(k) || [];
    ctx.clearRect(0, 0, cv.width, cv.height); ctx.lineWidth = 3; ctx.font = '600 26px Montserrat, sans-serif';
    for (const [x1, y1, x2, y2, label, conf] of dets) {
      const col = BOXCOL[label] || '#e4e4ea'; ctx.strokeStyle = col; ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
      const t = `${label} ${Math.round(conf * 100)}`; const w = ctx.measureText(t).width + 14;
      ctx.fillStyle = col; ctx.fillRect(x1, Math.max(0, y1 - 32), w, 32); ctx.fillStyle = '#09090b'; ctx.fillText(t, x1 + 7, Math.max(24, y1 - 8));
    }
    v._boxLoop = requestAnimationFrame(draw);
  };
  if (v._boxLoop) cancelAnimationFrame(v._boxLoop); draw(); if (v.paused) v.play().catch(() => {});
}

/* ---------- incidents ---------- */
let RULES = [], CAMS = [];
function incCard(i) {
  const st = i.status || 'candidate', v = i.verdict;
  const verdict = v == null ? `<div class="verdict none"><span class="who">Cosmos</span><div>Not verified yet. <span class="conf">Similarity ${(+i.similarity || 0).toFixed(2)}</span></div></div>`
    : `<div class="verdict ${v}"><span class="who">Cosmos ${v}</span><div>${esc(i.reason)} <span class="conf">· ${Math.round((i.confidence || 0) * 100)}% sure · match ${(+i.similarity || 0).toFixed(2)}</span></div></div>`;
  const ctx = (i.original_video ? `<div class="ctx"><button class="on" data-mode="clip">5 s moment</button><button data-mode="chunk">30 s context</button></div>` : '') + `<button class="btn sm ghost boxbtn">Boxes</button>`;
  const act = (st === 'confirmed' ? `<button class="btn sm act311" data-id="${i.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>Create 311 case</button>` : '')
    + (v != null ? `<button class="btn sm ghost recheck" data-id="${i.id}" title="Ask Cosmos Reason again">Re-check</button>` : '');
  return `<div class="inc ${st}" data-src="${esc(i.source)}" data-chunk="${esc(i.original_video || '')}" data-start="${i.segment_start_sec ?? 0}"><div class="v"><video src="${clipUrl(i.source)}" poster="${thumbUrl(i.source)}" controls muted preload="none" loop playsinline></video><span class="chip ${st}">${st}</span><span class="when">at ${mmss(i.segment_start_sec)}</span></div>
  <div class="b"><div class="t"><b><i class="rule-dot" style="color:${RULECOL[i.rule_id] || '#8a8a95'}"></i>${esc(i.rule)}</b><span class="chip ${i.severity}">${i.severity}</span></div><div class="m">${nice(i.camera_id)} · ${city(i.location)}${i.detected_at ? ' · ' + ago(i.detected_at) : ''}</div>${verdict}<div class="cap">${esc(i.caption)}</div><div class="acts">${ctx}${act}</div></div></div>`;
}
function renderIncidents(list) {
  const f = $('#i-filter').value;
  const L2 = f ? list.filter(i => i.status === f) : list;
  $('#i-grid').innerHTML = L2.length ? L2.map(incCard).join('') : '<div class="empty">Nothing here.</div>';
  wireCards($('#i-grid'));
}
function wireCards(root) {
  root.querySelectorAll('.ctx button').forEach(b => b.onclick = () => {
    const card = b.closest('.inc'), v = card.querySelector('video'), start = +card.dataset.start || 0;
    card.querySelectorAll('.ctx button').forEach(x => x.classList.toggle('on', x === b));
    toggleBoxes(card, false); const bb = card.querySelector('.boxbtn'); if (bb) { bb.classList.remove('on'); bb.disabled = b.dataset.mode === 'chunk'; bb.title = b.dataset.mode === 'chunk' ? 'Boxes are available on the 5 s moment' : ''; }
    if (b.dataset.mode === 'chunk') { v.loop = false; card.dataset.cur = card.dataset.chunk; v.src = clipUrl(card.dataset.chunk) + '#t=' + Math.max(0, start - 5); v.play(); }
    else { v.loop = true; card.dataset.cur = card.dataset.src; v.src = clipUrl(card.dataset.src); v.play(); }
  });
  root.querySelectorAll('.boxbtn').forEach(b => b.onclick = () => { const card = b.closest('.inc'); const on = !b.classList.contains('on'); b.classList.toggle('on', on); toggleBoxes(card, on); });
  root.querySelectorAll('.recheck').forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Cosmos is watching…';
    try { const r = await post('verify/' + b.dataset.id, {}); const card = b.closest('.inc'); card.outerHTML = incCard(r); wireCards(root); toast(`Re-checked: Cosmos says ${r.verdict} · ${r.reason}`); }
    catch (e) { b.disabled = false; b.textContent = 'Re-check'; toast('Re-check failed: ' + e.message); }
  });
  root.querySelectorAll('.act311').forEach(b => b.onclick = async () => {
    b.disabled = true; b.textContent = 'Creating…';
    try { const a = await post('actions', { incident_id: b.dataset.id }); b.outerHTML = `<span class="done">✓ Case ${esc(a.reference)} recorded · ${esc(a.summary.split(':')[0])}</span>`; toast(`311 case ${a.reference} recorded in VastDB (demo mode, not transmitted)`); }
    catch (e) { b.disabled = false; b.textContent = 'Create 311 case'; toast('Could not create case: ' + e.message); }
  });
}
let lastList = [];
async function loadIncidents() {
  RULES = await api('rules');
  CAMS = (OV ? OV.cameras : await api('cameras')).filter(c => /streets_cam|neighborhood|pie_cam/.test(c.camera_id));
  const camOpts = CAMS.map(c => `<option value="${c.camera_id}">${nice(c.camera_id)} · ${city(c.location)}</option>`).join('');
  const ruleOpts = RULES.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
  $('#i-cam').innerHTML = '<option value="">All street cameras</option>' + camOpts; $('#s-cam').innerHTML = '<option value="">All cameras</option>' + camOpts;
  $('#i-rule').innerHTML = '<option value="">All rules</option>' + ruleOpts; $('#s-rule').innerHTML = '<option value="">All rules</option>' + ruleOpts;
  await loadStored();
}
async function loadStored() {
  const q = []; if ($('#s-cam').value) q.push('camera_id=' + encodeURIComponent($('#s-cam').value)); if ($('#s-rule').value) q.push('rule_id=' + encodeURIComponent($('#s-rule').value));
  lastList = await api('incidents' + (q.length ? '?' + q.join('&') : '')); renderIncidents(lastList);
  const c = lastList.filter(i => i.status === 'confirmed').length, d = lastList.filter(i => i.status === 'dismissed').length;
  $('#s-count').textContent = `${c} confirmed · ${d} dismissed`;
}
$('#i-filter').onchange = () => renderIncidents(lastList);
$('#s-cam').onchange = loadStored; $('#s-rule').onchange = loadStored;
$('#i-stored').onclick = loadStored;
$('#i-run').onclick = async () => {
  const b = $('#i-run'); b.disabled = true;
  const body = { verify: $('#i-verify').checked, max_verify: 12, top_k: 6 };
  if ($('#i-cam').value) body.cameras = [$('#i-cam').value]; if ($('#i-rule').value) body.rules = [$('#i-rule').value];
  const p = $('#prog'); p.classList.add('on'); $('#p-bar').style.width = '5%'; $('#p-txt').textContent = 'Searching captions across cameras…'; $('#p-pct').textContent = '';
  ['#p-c', '#p-v', '#p-y', '#p-n'].forEach(s => $(s).textContent = '0');
  try {
    const { id } = await post('detect', body);
    while (true) {
      await new Promise(r => setTimeout(r, 1200));
      const j = await api('detect/' + id);
      $('#p-c').textContent = j.candidates; $('#p-v').textContent = j.verify_done + '/' + j.verify_total; $('#p-y').textContent = j.confirmed; $('#p-n').textContent = j.dismissed;
      if (j.phase === 'searching') { $('#p-txt').textContent = 'Searching captions · ' + (j.detail || ''); $('#p-bar').style.width = '15%'; }
      else if (j.phase === 'verifying') { const pct = j.verify_total ? 15 + 80 * j.verify_done / j.verify_total : 90; $('#p-txt').textContent = `Cosmos Reason is watching candidate clips (${j.verify_done} of ${j.verify_total})`; $('#p-bar').style.width = pct + '%'; $('#p-pct').textContent = Math.round(pct) + '%'; if (j.incidents?.length) { $('#i-filter').value = ''; lastList = j.incidents; renderIncidents(lastList); } }
      else if (j.phase === 'done') { $('#p-bar').style.width = '100%'; $('#p-pct').textContent = '100%'; $('#p-txt').textContent = `Done in ${j.seconds}s · ${j.confirmed} confirmed, ${j.dismissed} dismissed, ${j.saved} new rows written to VastDB`; $('#i-filter').value = ''; lastList = j.incidents; renderIncidents(lastList); $('#s-count').textContent = 'showing this run'; loaded.overview = false; break; }
      else if (j.phase === 'error') { $('#p-txt').textContent = 'Error: ' + j.error; break; }
    }
  } catch (e) { $('#p-txt').textContent = 'Error: ' + e.message; }
  b.disabled = false;
};

/* ---------- floating assistant ---------- */
const SUGG = ['Anything blocking a lane in San Francisco?', 'Where did the Toronto dashcam see street work?', 'Pedestrians outside the crosswalk on SF Street 5?', 'How busy is NYC Street 1 vs its normal?', 'Cyclists close to buses', 'Summarize the confirmed incidents'];
const hist = [];
const cw = $('#chatw');
function openChat() { cw.hidden = false; $('#fab').hidden = true; if (!$('#sugg').children.length) $('#sugg').innerHTML = SUGG.map(s => `<button>${s}</button>`).join(''); document.querySelectorAll('#sugg button').forEach(b => b.onclick = () => { $('#q').value = b.textContent; ask(); }); setTimeout(() => $('#q').focus(), 50); }
function closeChat() { cw.hidden = true; $('#fab').hidden = false; }
$('#fab').onclick = openChat; $('#cw-close').onclick = closeChat;
$('#cw-expand').onclick = () => cw.classList.toggle('big');
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !cw.hidden) closeChat(); if ((e.metaKey || e.ctrlKey) && e.key === 'k') { e.preventDefault(); cw.hidden ? openChat() : closeChat(); } });
function clipCard(src, cap) { return `<div class="inc"><div class="v"><video src="${clipUrl(src)}" poster="${thumbUrl(src)}" controls muted preload="none" loop playsinline></video></div><div class="b"><div class="m">${esc(cap || '')}</div></div></div>`; }
const scrollChat = () => { const m = $('#msgs'); m.scrollTop = m.scrollHeight; };
async function ask() {
  const q = $('#q').value.trim(); if (!q) return; $('#q').value = ''; $('#sugg').innerHTML = '';
  $('#msgs').insertAdjacentHTML('beforeend', `<div class="msg u">${esc(q)}</div><div class="msg a think" id="pending"><i></i>Querying the data layer…</div>`); scrollChat();
  $('#ask').disabled = true;
  try {
    const r = await post('ask', { question: q, history: hist.slice(-6) });
    const refs = []; let html = esc(r.answer || '').replace(/\*\*/g, '');
    html = html.replace(/[\[【]clip:([^\]】]+)[\]】]/g, (m, s) => { refs.push(s); return `<span class="clipref" data-s="${esc(s)}">▶ clip ${refs.length}</span>`; });
    const steps = (r.trace || []);
    const stepsHtml = steps.length ? `<details class="steps"><summary>${steps.length} tool call${steps.length > 1 ? 's' : ''} · ${r.seconds}s${r.weave_url ? ' · <a href="' + r.weave_url + '" target="_blank" rel="noopener">Weave</a>' : ''}</summary>${steps.map(t => `<div class="tstep"><code>${t.tool}</code> <span class="a">${esc(JSON.stringify(t.args))}</span> · ${t.seconds}s<div class="r">${esc((t.result_preview || '').slice(0, 200))}…</div></div>`).join('')}</details>` : '';
    $('#pending').outerHTML = stepsHtml + `<div class="msg a">${html}<span class="meta">${r.model}</span></div>` + (refs.length ? `<div class="clips">${refs.map((s, i) => clipCard(s, 'Clip ' + (i + 1))).join('')}</div>` : '');
    hist.push({ role: 'user', content: q }, { role: 'assistant', content: r.answer || '' });
    document.querySelectorAll('.clipref').forEach(el => el.onclick = () => { const v = [...document.querySelectorAll('.clips video')].find(x => x.src.includes(encodeURIComponent(el.dataset.s))); if (v) { v.scrollIntoView({ behavior: 'smooth', block: 'center' }); v.play(); } });
  } catch (e) { $('#pending').textContent = 'Error: ' + e.message; }
  $('#ask').disabled = false; scrollChat();
}
$('#ask').onclick = ask; $('#q').addEventListener('keydown', e => { if (e.key === 'Enter') ask(); });

/* ---------- measure ---------- */
let cFlow, cMix, cCmp;
async function loadMeasure() {
  const cams = OV ? OV.cameras : await api('cameras');
  $('#m-cam').innerHTML = cams.map(c => `<option value="${c.camera_id}">${nice(c.camera_id)} · ${city(c.location)} · ${c.minutes} min</option>`).join('');
  $('#m-run').click();
}
$('#m-run').onclick = async () => {
  const cam = $('#m-cam').value; const m = await api('measure?camera_id=' + encodeURIComponent(cam));
  const ov = OV || await api('overview');
  const peakX = (m.peak.rolling / (m.baseline_vehicles || 1)).toFixed(1);
  $('#m-kpis').innerHTML = [[m.baseline_vehicles, "vehicles per clip, this camera's normal", 'blue', 'car'], [m.peak.rolling, 'busiest minute, vehicles per clip', 'red', 'up'], [peakX + '×', 'peak vs normal', 'amber', 'ratio'], [m.current_ratio + '×', 'last minute vs normal', m.current_ratio > 1.3 ? 'red' : 'green', 'ratio'], [m.people_median, 'people per clip, typical', 'violet', 'people'], [m.segments, '5-second clips measured', 'teal', 'clip']]
    .map(a => kpi(...a)).join('');
  $('#m-sub').textContent = `${nice(cam)} · ${(m.segments * 5 / 60).toFixed(0)} min of footage · vehicles and people per 5 s clip`;
  const oc = ov.cameras.find(c => c.camera_id === cam) || {};
  $('#m-title').textContent = nice(cam);
  $('#m-pos').innerHTML = `<i></i>${esc(oc.intersection ? oc.intersection + ' · ' : '')}${city(oc.location)}${oc.status ? ' · <span class="chip ' + oc.status + '">' + oc.status + '</span>' : ''}`;
  api('storyboard?camera_id=' + encodeURIComponent(cam) + '&n=24').then(sb => {
    $('#sb-sub').textContent = `${sb.minutes} min · ${sb.frames.length} frames · ${sb.incidents.length} confirmed incident${sb.incidents.length === 1 ? '' : 's'}`;
    const hitIdx = new Set(sb.incidents.map(x => Math.round(x.i / Math.max(1, sb.segments - 1) * (sb.frames.length - 1))));
    $('#sb').innerHTML = sb.frames.map((f, k) => `<div class="f ${hitIdx.has(k) ? 'hit' : ''}" data-src="${esc(f.source)}" data-chunk="${esc(f.original_video)}" data-start="${(f.seg - 1) * 5}" title="minute ${f.minute} · ${f.vehicles} vehicles, ${f.people} people"><img src="${thumbUrl(f.source)}" loading="lazy" alt=""><span class="m">${f.minute}′</span></div>`).join('');
    const ticks = [0, .25, .5, .75, 1].map(t => `<span class="tick" style="left:${t * 100}%">${(t * sb.minutes).toFixed(0)} min</span>`).join('');
    $('#sbaxis').innerHTML = `<div class="line"></div>${ticks}` + sb.incidents.map(x => `<span class="pin" style="left:${x.pos * 100}%" title="${esc(x.rule)}: ${esc(x.reason || '')}" data-src="${esc(x.source)}" data-id="${x.id}"></span>`).join('');
    const play = (src, chunk, start, label) => { $('#m-moments').innerHTML = momentCard(src, label, chunk, start); wireCards($('#m-moments')); $('#m-moments').scrollIntoView({ behavior: 'smooth', block: 'center' }); $('#m-moments video').play().catch(() => {}); };
    $('#sb').querySelectorAll('.f').forEach(el => el.onclick = () => play(el.dataset.src, el.dataset.chunk, +el.dataset.start, el.title));
    $('#sbaxis').querySelectorAll('.pin').forEach(el => el.onclick = () => { const f = sb.frames.find(x => x.source === el.dataset.src); play(el.dataset.src, f?.original_video, f ? (f.seg - 1) * 5 : 0, el.title); });
  });
  api('incidents?camera_id=' + encodeURIComponent(cam)).then(list => {
    const conf = list.filter(i => i.status === 'confirmed'), dis = list.filter(i => i.status === 'dismissed');
    $('#m-inc-sub').textContent = `${conf.length} confirmed · ${dis.length} dismissed by Cosmos`;
    $('#m-inc').innerHTML = conf.length ? conf.slice(0, 6).map(incCard).join('') : '<div class="empty">Nothing confirmed on this camera yet. Run a watch on the Incidents screen.</div>';
    wireCards($('#m-inc'));
  });
  const labels = m.series.map(s => (s.i * 5 / 60).toFixed(1));
  cFlow?.destroy(); cFlow = new Chart($('#c-flow'), { type: 'bar', data: { labels, datasets: [
    { type: 'line', label: 'rolling minute', data: m.series.map(s => s.rolling), borderColor: '#ff4150', backgroundColor: 'rgba(229,32,47,.16)', fill: true, pointRadius: 0, pointHitRadius: 8, tension: .3, borderWidth: 2 },
    { label: 'per clip', data: m.series.map(s => s.vehicles), backgroundColor: '#2a3442', borderWidth: 0, barPercentage: 1, categoryPercentage: .9 },
    { type: 'line', label: 'people (rolling)', data: m.series.map((x, i, a) => { const w = a.slice(Math.max(0, i - 11), i + 1); return +(w.reduce((p, y) => p + y.people, 0) / w.length).toFixed(1); }), borderColor: '#a78bfa', pointRadius: 0, pointHitRadius: 8, tension: .3, borderWidth: 1.5 },
    { type: 'line', label: 'normal', data: m.series.map(() => m.baseline_vehicles), borderColor: '#8a8a95', borderDash: [5, 5], pointRadius: 0, borderWidth: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => 'minute ' + it[0].label } } }, scales: { x: { ticks: { maxTicksLimit: 10, callback: (v, i) => labels[i] + ' min' }, grid: { display: false } }, y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.06)' } } }, onClick: (e, els) => { if (els.length) { const s = m.series[els[0].index]; $('#m-moments').innerHTML = momentCard(s.source, `Minute ${(s.i * 5 / 60).toFixed(1)} · ${s.vehicles} vehicles, ${s.people} people in this clip`, s.original_video, s.seg ? (s.seg - 1) * 5 : 0); wireCards($('#m-moments')); } } } });
  const mixCols = ['#ff4150', '#60a5fa', '#a78bfa', '#f2a93b', '#3ecf8e', '#2dd4bf', '#5d6878'];
  cMix?.destroy(); cMix = new Chart($('#c-mix'), { type: 'doughnut', data: { labels: m.object_mix.map(o => o[0]), datasets: [{ data: m.object_mix.map(o => o[1]), backgroundColor: mixCols, borderWidth: 0, hoverOffset: 6 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, usePointStyle: true, padding: 12 } } } } });
  const cmp = ov.cameras.filter(c => c.ratio != null);
  cCmp?.destroy(); cCmp = new Chart($('#c-cmp'), { type: 'bar', data: { labels: cmp.map(c => nice(c.camera_id)), datasets: [{ data: cmp.map(c => c.ratio), backgroundColor: cmp.map(c => c.camera_id === cam ? '#ff4150' : c.ratio > 1.3 ? '#f2a93b' : '#334155'), borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: it => it.raw + '× its normal' } } }, scales: { x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.06)' }, ticks: { callback: v => v + '×' } }, y: { grid: { display: false } } }, onClick: (e, els) => { if (els.length) { $('#m-cam').value = cmp[els[0].index].camera_id; $('#m-run').click(); } } } });
  $('#m-moments').innerHTML = momentCard(m.peak.source, `Busiest minute · ${m.peak.rolling} vehicles per clip (${peakX}× normal)`, m.peak.original_video, m.peak.seg ? (m.peak.seg - 1) * 5 : 0) + momentCard(m.quiet.source, `Quietest minute · ${m.quiet.rolling} vehicles per clip`, m.quiet.original_video, m.quiet.seg ? (m.quiet.seg - 1) * 5 : 0);
  wireCards($('#m-moments'));
};
const momentCard = (src, t, chunk, start) => `<div class="inc" data-src="${esc(src)}" data-chunk="${esc(chunk || '')}" data-start="${start ?? 0}"><div class="v"><video src="${clipUrl(src)}" poster="${thumbUrl(src)}" controls muted preload="none" loop playsinline></video></div><div class="b"><div class="m">${esc(t)}</div><div class="acts">${chunk ? '<div class="ctx"><button class="on" data-mode="clip">5 s moment</button><button data-mode="chunk">30 s context</button></div>' : ''}<button class="btn sm ghost boxbtn">Boxes</button></div></div></div>`;

/* ---------- system ---------- */
async function loadSystem() {
  const s = await api('system');
  const ok = b => `<span class="chip ${b ? 'ok' : 'incident'}">${b ? 'ready' : 'down'}</span>`;
  $('#arch').innerHTML = archSvg();
  const idx = s.index || {};
  $('#sys').innerHTML = `
  <div class="panel"><div class="h"><b>VAST AI OS · data layer</b>${ok(!idx.error)}</div><div class="c kv">
    <span>Index</span><b>${idx.segments?.toLocaleString() ?? '–'} clips in ${idx.videos ?? '–'} videos</b><span>Re-captioned with the CityLens operator prompt</span><b>${idx.reingested ?? 0} clips</b>
    <span>Captions ok</span><b>${idx.quality?.reasoning_ok_pct ?? '–'}%</b><span>Detections ok</span><b>${idx.quality?.perception_ok_pct ?? '–'}%</b>
    <span>Pipeline</span><b>${idx.pending === 0 ? 'in sync' : (idx.pending ?? '–') + ' pending'}</b>
    <span>S3 segments</span><b>${idx.s3?.segments_mp4?.toLocaleString() ?? '–'} in ${esc(idx.s3?.segments_bucket || '')}</b>
    <span>Incident table</span><b>${s.incidents_table?.rows ?? '–'} rows · ${esc(s.incidents_table?.schema || '')}</b></div></div>
  <div class="panel"><div class="h"><b>NVIDIA models · CoreWeave GPUs</b></div><div class="c kv">
    ${Object.entries(s.models || {}).map(([k, v]) => `<span>${k.replace('_', ' ')} <small style="color:var(--muted2)">${v.model}</small></span>${ok(v.ok)}`).join('')}</div></div>
  <div class="panel"><div class="h"><b>Agent · Weights &amp; Biases</b>${ok(true)}</div><div class="c kv">
    <span>Model</span><b>${esc(s.agent?.model)}</b><span>Provider</span><b>${esc(s.agent?.provider)}</b><span>Tracing</span><b><a href="${s.agent?.weave}" target="_blank" rel="noopener">Weave project</a></b><span>Tools</span><b>search_clips · list_incidents · camera_stats · summarize_video</b></div></div>
  <div class="panel"><div class="h"><b>Detected object classes</b><span>whole index</span></div><div class="c kv">${(idx.objects || []).slice(0, 8).map(o => `<span>${o.label}</span><b>${o.instance_count?.toLocaleString?.() ?? o.segment_count}</b>`).join('')}</div></div>`;
}
$('#s-refresh').onclick = loadSystem;

show(views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'overview');

/* ---------- city view ---------- */
let cmap, cLayers = {};
async function openCity(loc) {
  show('city'); history.replaceState(null, '', '#city/' + loc);
  $('#c-title').textContent = city(loc); $('#c-kpis').innerHTML = ''; $('#c-triage').innerHTML = '<div class="empty">Loading the permit register…</div>'; $('#c-inc').innerHTML = ''; $('#c-311').innerHTML = ''; $('#c-wall').innerHTML = '';
  const d = await api('city_view?location=' + loc);
  const p = d.permits || {}, r = d.c311 || {};
  const noPermit = d.triage.filter(t => t.triage.status === 'no_permit').length, permitted = d.triage.filter(t => t.triage.status === 'permitted').length, possible = d.triage.filter(t => t.triage.status === 'possible').length;
  $('#c-kpis').innerHTML = [[d.cameras.length, 'cameras', 'teal', 'camera'], [d.confirmed, 'incidents confirmed', 'red', 'alert'], [d.dismissed, 'false alarms suppressed', 'green', 'check'], [r.total ?? '–', r.name ? 'latest 311 requests' : 'no 311 feed', 'amber', 'doc'], [p.count ?? '–', p.name ? 'active permits & restrictions' : 'no permit register', 'violet', 'pin'], [d.triage.length ? `${permitted} · ${possible} · ${noPermit}` : '–', 'work zones: on file · possible · no permit', noPermit ? 'red' : 'blue', 'city']]
    .map(a => kpi(...a)).join('');
  $('#c-sub').textContent = `${p.name ? p.name + ' · ' : ''}${r.name ? r.name + ' · ' : ''}camera placement illustrative`;
  // map
  if (!cmap) { cmap = L.map('cmap', { zoomControl: true, attributionControl: false }); L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 16 }).addTo(cmap); }
  Object.values(cLayers).forEach(l => cmap.removeLayer(l)); cLayers = {};
  cLayers.p = L.layerGroup(); for (const x of (p.items || [])) L.circleMarker([x.lat, x.lon], { radius: 3, color: '#a78bfa', weight: 0, fillColor: '#a78bfa', fillOpacity: .7 }).bindPopup(() => pointPopup('Permit', '#a78bfa', x.permit_type || x.kind, x.where, [x.holder, x.id, x.start ? (x.start + (x.end ? ' to ' + x.end : '')) : null]), { minWidth: 240 }).addTo(cLayers.p);
  cLayers.r = L.layerGroup(); for (const x of (r.cases || [])) L.circleMarker([x.lat, x.lon], { radius: 3, color: '#f2a93b', weight: 0, fillColor: '#f2a93b', fillOpacity: .7 }).bindPopup(() => pointPopup('311 request', '#f2a93b', x.category, x.detail, [x.where, ago(x.when), x.status]), { minWidth: 240 }).addTo(cLayers.r);
  cLayers.c = L.layerGroup();
  const pts = [];
  for (const c of d.cameras.filter(c => c.lat)) {
    const col = c.status === 'incident' ? '#ff4150' : c.status === 'busy' ? '#f2a93b' : '#e4e4ea';
    const n = d.permits_near_cameras.find(x => x.camera_id === c.camera_id);
    L.circleMarker([c.lat, c.lon], { radius: 8, color: '#09090b', weight: 2, fillColor: col, fillOpacity: 1 }).bindPopup(() => camPopup(c, null, n ? n.permits_near : null), { minWidth: 260 }).addTo(cLayers.c);
    pts.push([c.lat, c.lon]);
  }
  if ($('#c-lperm').checked) cLayers.p.addTo(cmap); if ($('#c-l311').checked) cLayers.r.addTo(cmap); cLayers.c.addTo(cmap);
  setTimeout(() => { cmap.invalidateSize(); if (pts.length) cmap.fitBounds(pts, { padding: [60, 60], maxZoom: 14 }); else if (d.lat) cmap.setView([d.lat, d.lon], 12); }, 60);
  $('#c-l311').onchange = () => $('#c-l311').checked ? cLayers.r.addTo(cmap) : cmap.removeLayer(cLayers.r);
  $('#c-lperm').onchange = () => $('#c-lperm').checked ? cLayers.p.addTo(cmap) : cmap.removeLayer(cLayers.p);
  $('#c-map-sub').textContent = `${d.cameras.filter(c => c.lat).length} cameras · ${(r.cases || []).length} 311 · ${p.count || 0} permits`;
  // triage
  $('#c-triage').innerHTML = d.triage.length ? d.triage.map(t => { const tr = t.triage; return `<div class="tri"><img src="${thumbUrl(t.source)}" loading="lazy" alt="" onclick="show('incidents');setTimeout(()=>{$('#s-cam').value='${t.camera_id}';$('#i-filter').value='confirmed';loadStored()},50)"><div><div class="t">${esc(t.rule)} <span class="chip ${tr.status}">${tr.status === 'permitted' ? 'permit on file' : tr.status === 'possible' ? 'possible match' : tr.status === 'no_permit' ? 'no permit found' : 'no position'}</span></div><div class="s">${nice(t.camera_id)} · at ${mmss(t.segment_start_sec)} · Cosmos: ${esc(t.reason || '')}</div><div class="r">${esc(tr.note || '')}${tr.match ? ` · <b>${esc(tr.match.id || '')}</b> ${esc(tr.match.holder || '')}` : ''}${tr.status !== 'permitted' ? ` <button class="btn sm act311" data-id="${t.id}" style="margin-left:8px">Open case</button>` : ''}${tr.candidates ? ` <span style="color:var(--muted)">· ${tr.candidates} active nearby</span>` : ''}</div></div></div>`; }).join('')
    : `<div class="empty">${p.name ? 'No camera-confirmed work zones in this city yet. Run the work-zone rules on the Incidents screen.' : 'This city has no open permit register wired in.'}</div>`;
  wireCards($('#c-triage'));
  // incidents
  const conf = d.incidents.filter(i => i.status === 'confirmed');
  $('#c-inc-sub').textContent = `${conf.length} confirmed · ${d.dismissed} dismissed`;
  $('#c-inc').innerHTML = conf.length ? conf.map(i => `<div class="fitem" onclick="show('incidents');setTimeout(()=>{$('#s-cam').value='${i.camera_id}';$('#i-filter').value='confirmed';loadStored()},50)"><img src="${thumbUrl(i.source)}" loading="lazy" alt=""><div><div class="t">${esc(i.rule)} <span class="chip ${i.severity}">${i.severity}</span></div><div class="s">${nice(i.camera_id)} · at ${mmss(i.segment_start_sec)} · ${ago(i.detected_at)}</div><div class="r">${esc(i.reason)}</div></div></div>`).join('') : '<div class="empty">No confirmed incidents here yet.</div>';
  // 311
  $('#c-311-title').textContent = r.name || 'What residents report'; $('#c-311-sub').textContent = r.name ? `${r.total} latest · ${r.attribution} · ${r.fetched_at}` : 'no open-data feed for this city';
  const mx = r.categories?.[0]?.[1] || 1;
  $('#c-311').innerHTML = (r.categories || []).map(([c, n]) => `<span>${esc(c)}</span><b>${n}</b><div class="bar"><i style="width:${Math.round(100 * n / mx)}%"></i></div>`).join('') || '<div class="empty">No data.</div>';
  // wall
  $('#c-wall').innerHTML = d.cameras.map(c => `<div class="cam" data-cam="${c.camera_id}"><div class="img"><img src="${thumbUrl(c.latest_source)}" loading="lazy" alt=""><span class="chip ${c.status}">${c.status === 'incident' ? c.incidents + ' incident' + (c.incidents > 1 ? 's' : '') : c.status}</span><span class="id">${esc(c.intersection || c.capture_type)}</span></div><div class="b"><div><div class="n">${nice(c.camera_id)}</div><div class="m">${c.minutes} min · ${c.ratio != null ? c.ratio + '× normal' : ''}</div></div>${spark(c.spark, c.baseline)}</div></div>`).join('');
  document.querySelectorAll('#c-wall .cam').forEach(el => el.onclick = () => { show('measure'); $('#m-cam').value = el.dataset.cam; $('#m-run').click(); });
}
if (location.hash.startsWith('#city/')) openCity(location.hash.slice(6));

/* ---------- architecture diagram ---------- */
function archSvg() {
  const W = 1100, H = 560;
  const C = { vast: '#a78bfa', nv: '#3ecf8e', wb: '#f2a93b', cw: '#8b97a8', cl: '#ff4150', city: '#60a5fa' };
  // id, x, y, w, h, title, sub, color, built
  const N = [
    ['cams', 20, 40, 150, 58, 'Street cameras', 'SF · NYC · Toronto · Nashville', C.cw],
    ['s3', 200, 40, 140, 58, 'VAST S3', 'clips, chunks', C.vast],
    ['seg', 370, 40, 130, 58, 'Segmenter', '5 s clips', C.vast],
    ['yolo', 530, 40, 150, 58, 'YOLO11', 'objects · counts · boxes', C.nv],
    ['reason', 710, 40, 160, 58, 'Cosmos Reason', 'captions per clip', C.nv],
    ['embed', 900, 40, 180, 58, 'Cosmos Embed1', '256-d vectors', C.nv],
    ['vdb', 370, 165, 310, 66, 'VastDB · vss-collection', 'captions · vectors · counts · metadata', C.vast],
    ['prompt', 710, 165, 370, 66, 'Operator prompt re-caption', 'flow · lane standing · pedestrians · work zones', C.cl, 1],
    ['city', 20, 310, 150, 70, 'City open data', '311 · permit registers', C.city],
    ['rules', 200, 310, 190, 70, 'Rules engine', '8 standing questions', C.cl, 1],
    ['verify', 420, 310, 190, 70, 'Cosmos verdict', 'clip + question → yes / no / why', C.cl, 1],
    ['inc', 640, 310, 190, 70, 'citylens.incidents', 'rule · verdict · reason', C.cl, 1],
    ['act', 860, 310, 220, 70, 'citylens.actions', '311 case · permit triage', C.cl, 1],
    ['agent', 200, 450, 410, 70, 'Agent · GPT-OSS 120B on W&B Inference', 'tools over the data layer · traced in Weave', C.wb, 1],
    ['ui', 640, 450, 440, 70, 'Operator workspace', 'overview · incidents · cameras · city view · assistant', C.cl, 1],
  ];
  const byId = Object.fromEntries(N.map(n => [n[0], n]));
  const P = (pts, built, dash) => `<path d="M${pts.map(p => p.join(',')).join(' L')}" fill="none" stroke="${built ? C.cl : '#4a4a55'}" stroke-width="1.6" ${dash ? 'stroke-dasharray="5 4"' : ''} marker-end="url(#ah${built ? 'r' : 'g'})"/>`;
  const R = id => byId[id], cx = n => n[1] + n[3] / 2, cy = n => n[2] + n[4] / 2, right = n => [n[1] + n[3], cy(n)], left = n => [n[1], cy(n)], top = (n, dx = 0) => [cx(n) + dx, n[2]], bottom = (n, dx = 0) => [cx(n) + dx, n[2] + n[4]];
  const E = [
    P([right(R('cams')), left(R('s3'))]), P([right(R('s3')), left(R('seg'))]), P([right(R('seg')), left(R('yolo'))]), P([right(R('yolo')), left(R('reason'))]), P([right(R('reason')), left(R('embed'))]),
    P([bottom(R('yolo')), [cx(R('yolo')), R('vdb')[2]]]),                      // yolo → vdb
    P([bottom(R('reason'), -40), [cx(R('reason')) - 40, 140], [660, 140], [660, R('vdb')[2]]]),  // reason → vdb
    P([bottom(R('embed'), -60), [cx(R('embed')) - 60, 125], [675, 125], [675, R('vdb')[2]]]),    // embed → vdb
    P([top(R('prompt')), bottom(R('reason'), 40)], 1),                           // prompt → reason
    P([bottom(R('vdb'), -120), [cx(R('vdb')) - 120, 275], [cx(R('rules')), 275], top(R('rules'))], 1),  // vdb → rules
    P([right(R('rules')), left(R('verify'))], 1), P([right(R('verify')), left(R('inc'))], 1), P([right(R('inc')), left(R('act'))], 1),
    P([bottom(R('inc'), -60), [cx(R('inc')) - 60, 415], [cx(R('agent')) + 100, 415], [cx(R('agent')) + 100, R('agent')[2]]], 1),  // incidents → agent
    P([bottom(R('vdb'), 100), [cx(R('vdb')) + 100, 290], [405, 290], [405, 400], [cx(R('agent')) - 100, 400], [cx(R('agent')) - 100, R('agent')[2]]], 1), // vdb → agent (through the gap between rules and verify)
    P([bottom(R('city')), [cx(R('city')), 430], [cx(R('ui')) - 150, 430], [cx(R('ui')) - 150, R('ui')[2]]]),  // city data → workspace
    P([bottom(R('city'), 40), [cx(R('city')) + 40, 395], [cx(R('act')), 395], bottom(R('act'))], 0, 1),      // city data → triage (dashed, upward into actions)
    P([bottom(R('act'), 60), [cx(R('act')) + 60, R('ui')[2]]], 1), P([right(R('agent')), left(R('ui'))], 1),
  ];
  const node = n => `<g><rect x="${n[1]}" y="${n[2]}" width="${n[3]}" height="${n[4]}" rx="10" fill="${n[8] ? 'rgba(229,32,47,.10)' : '#1b222d'}" stroke="${n[8] ? C.cl : '#2f3a48'}" stroke-width="${n[8] ? 1.5 : 1}"/><circle cx="${n[1] + 14}" cy="${n[2] + 16}" r="4" fill="${n[7]}"/><text x="${n[1] + 24}" y="${n[2] + 21}" fill="#f5f5f7" font-size="13" font-weight="700" font-family="Montserrat, sans-serif">${n[5]}</text><text x="${n[1] + 14}" y="${n[2] + 41}" fill="#8a8a95" font-size="11.5" font-family="Nunito Sans, sans-serif">${n[6]}</text></g>`;
  const legend = [['VAST AI OS', C.vast], ['NVIDIA on CoreWeave', C.nv], ['Weights & Biases', C.wb], ['City open data', C.city], ['Built today', C.cl]].map(([t, c], i) => `<g transform="translate(${20 + i * 180},${H - 14})"><circle r="5" fill="${c}"/><text x="12" y="4" fill="#c7c7cf" font-size="12" font-family="Nunito Sans, sans-serif">${t}</text></g>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block"><defs><marker id="ahg" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8z" fill="#4a4a55"/></marker><marker id="ahr" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8z" fill="${C.cl}"/></marker></defs>
  <text x="20" y="22" fill="#8a8a95" font-size="11" letter-spacing="1.5" font-family="Montserrat, sans-serif" font-weight="700">INGEST · PRE-BUILT, RUNS ON EVERY CLIP</text>
  <text x="520" y="297" fill="${C.cl}" font-size="11" letter-spacing="1.5" font-family="Montserrat, sans-serif" font-weight="700" text-anchor="start">CITYLENS · BUILT TODAY, RUNS ON WHAT MATTERS</text>
  ${E.join('')}${N.map(node).join('')}${legend}</svg>`;
}
