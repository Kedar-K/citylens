/* CityLens operator workspace */
const $ = s => document.querySelector(s);
const BASE = location.pathname.replace(/\/?$/, '/');
const api = (p, o) => fetch(BASE + 'api/' + p, o).then(r => { if (!r.ok) throw new Error(r.status + ' ' + p); return r.json(); });
const post = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const clipUrl = s => BASE + 'api/clip?source=' + encodeURIComponent(s);
const thumbUrl = s => BASE + 'api/thumb?source=' + encodeURIComponent(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NAMES = { 'sf_streets_cam-1': 'SF Street 1', 'sf_streets_cam-2': 'SF Street 2', 'sf_streets_cam-3': 'SF Street 3', 'sf_streets_cam-4': 'SF Street 4', 'sf_streets_cam-5': 'SF Street 5', 'nyc_streets_cam-1': 'NYC Street 1', 'nyc_streets_cam-2': 'NYC Street 2', 'neighborhood_cam-1': 'Residential 1', 'pie_cam-3': 'Toronto dashcam', 'nyc_bike_gopro-1': 'NYC bike cam', 'i24_cam-1': 'I-24 corridor', 'smartspace_cam-1': 'Indoor facility', 'sdg_warehouse_cam-2': 'Warehouse' };
const CITY = { san_francisco: 'San Francisco', new_york: 'New York', toronto: 'Toronto', nashville: 'Nashville', neighborhood: 'Residential site', indoor: 'Indoor', warehouse3: 'Warehouse' };
const nice = c => NAMES[c] || c || '';
const city = l => CITY[l] || l || '';
const mmss = s => s == null ? '' : Math.floor(s / 60) + ':' + String(Math.round(s % 60)).padStart(2, '0');
const ago = iso => { if (!iso) return ''; const d = (Date.now() - Date.parse(iso)) / 1000; return d < 90 ? 'just now' : d < 3600 ? Math.round(d / 60) + ' min ago' : d < 86400 ? Math.round(d / 3600) + ' h ago' : Math.round(d / 86400) + ' d ago'; };
const toast = t => { const el = $('#toast'); el.textContent = t; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), 3500); };
Chart.defaults.color = '#8a8a95'; Chart.defaults.font.family = '"Nunito Sans", system-ui, sans-serif'; Chart.defaults.borderColor = 'rgba(255,255,255,.07)';

/* navigation */
const views = ['overview', 'incidents', 'measure', 'system'];
const loaded = {};
function show(v) {
  document.querySelectorAll('.nav button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  views.forEach(x => $('#v-' + x).hidden = x !== v);
  if (!loaded[v]) { loaded[v] = true; ({ overview: loadOverview, incidents: loadIncidents, measure: loadMeasure, system: loadSystem })[v](); }
  if (v === 'overview' && map) setTimeout(() => map.invalidateSize(), 50);
  history.replaceState(null, '', '#' + v);
}
document.querySelectorAll('.nav button').forEach(b => b.onclick = () => show(b.dataset.view));

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
    [k.fixed_cameras, 'street cameras watched', 'teal'], [k.minutes.toLocaleString() + ' min', 'video indexed across ' + k.cities + ' cities', ''],
    [k.clips.toLocaleString(), 'clips described by Cosmos', ''], [k.detections.toLocaleString(), 'objects detected by YOLO', ''],
    [k.incidents_confirmed, 'incidents confirmed', 'red'], [k.false_alarms_suppressed, 'false alarms suppressed', 'green']
  ].map(([v, l, c]) => `<div class="kpi ${c}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  $('#live-txt').textContent = `Watching ${k.fixed_cameras} street cameras`;
  $('#n-inc').textContent = k.incidents_confirmed || '';
  // map
  if (!map) {
    map = L.map('map', { zoomControl: false, attributionControl: false, scrollWheelZoom: false }).setView([39.5, -96], 4);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}', { maxZoom: 12 }).addTo(map);
    L.control.attribution({ position: 'bottomleft', prefix: false }).addAttribution('Basemap © Esri').addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
  }
  map.eachLayer(l => { if (l instanceof L.CircleMarker || l instanceof L.Marker) map.removeLayer(l); });
  const pts = [];
  for (const c of OV.cities) {
    const col = c.status === 'incident' ? '#ff4150' : '#e4e4ea';
    const m = L.circleMarker([c.lat, c.lon], { radius: 7 + Math.min(c.cameras, 6) * 1.5, color: col, weight: 2, fillColor: col, fillOpacity: .25 }).addTo(map);
    L.circleMarker([c.lat, c.lon], { radius: 3, color: col, fillColor: col, fillOpacity: 1, weight: 0 }).addTo(map);
    m.bindPopup(`<b>${c.name}</b><br>${c.cameras} camera${c.cameras > 1 ? 's' : ''} · ${c.minutes} min indexed<br>${c.incidents} confirmed incident${c.incidents === 1 ? '' : 's'}`);
    L.marker([c.lat, c.lon], { icon: L.divIcon({ className: 'city-label', html: `${c.name} <span style="color:#8a8a95">· ${c.cameras}</span>`, iconAnchor: [-14, 8] }), interactive: false }).addTo(map);
    pts.push([c.lat, c.lon]);
  }
  if (pts.length) map.fitBounds(pts, { padding: [50, 90], maxZoom: 6 });
  $('#map-sub').textContent = `${OV.cities.length} cities · ${OV.cameras.length} cameras`;
  // feed
  $('#feed').innerHTML = OV.feed.length ? OV.feed.map(i => `<div class="fitem" data-src="${esc(i.source)}"><img src="${thumbUrl(i.source)}" loading="lazy" alt=""><div><div class="t">${esc(i.rule)} <span class="chip ${i.severity}">${i.severity}</span></div><div class="s">${nice(i.camera_id)} · ${city(i.location)} · at ${mmss(i.segment_start_sec)} · ${ago(i.detected_at)}</div><div class="r">${esc(i.reason)}</div></div></div>`).join('')
    : '<div class="empty">No confirmed incidents yet. Run a watch on the Incidents screen.</div>';
  document.querySelectorAll('.fitem').forEach(el => el.onclick = () => { show('incidents'); $('#i-filter').value = 'confirmed'; $('#i-stored').click(); });
  // city services (311) for cities that publish open data
  loadCity();
  // wall
  $('#wall').innerHTML = OV.cameras.map(c => `<div class="cam" data-cam="${c.camera_id}"><div class="img"><img src="${thumbUrl(c.latest_source)}" loading="lazy" alt=""><span class="chip ${c.status}">${c.status === 'incident' ? c.incidents + ' incident' + (c.incidents > 1 ? 's' : '') : c.status}</span><span class="id">${c.fixed ? 'fixed' : c.capture_type}</span></div>
    <div class="b"><div><div class="n">${nice(c.camera_id)}</div><div class="m">${city(c.location)} · ${c.minutes} min · ${c.ratio != null ? c.ratio + '× normal' : ''}</div></div>${spark(c.spark, c.baseline)}</div></div>`).join('');
  document.querySelectorAll('.cam').forEach(el => el.onclick = () => { show('measure'); $('#m-cam').value = el.dataset.cam; $('#m-run').click(); });
}

let layer311 = null, CITYDATA = {};
async function loadCity() {
  const locs = OV.cities.map(c => c.location).filter(l => ['san_francisco', 'new_york'].includes(l));
  const res = await Promise.all(locs.map(l => api('city?location=' + l).catch(() => null)));
  CITYDATA = {}; res.forEach((d, i) => { if (d) CITYDATA[locs[i]] = d; });
  $('#city').innerHTML = Object.values(CITYDATA).map(d => {
    if (d.error) return `<div class="panel"><div class="h"><b>${esc(d.name)}</b><span>unavailable</span></div><div class="c empty">${esc(d.error)}</div></div>`;
    const mx = d.categories[0]?.[1] || 1;
    const cams = OV.cameras.filter(c => c.location === d.location);
    const inc = cams.reduce((a, c) => a + c.incidents, 0);
    return `<div class="panel"><div class="h"><b>${esc(d.name)} · what residents report</b><span>${d.total} latest requests · ${esc(d.attribution)} · ${d.fetched_at}</span></div><div class="c">
      <div class="kpis" style="grid-template-columns:repeat(3,1fr);margin-bottom:14px"><div class="kpi"><div class="v">${d.street_related}</div><div class="l">street-related requests a camera could corroborate</div></div><div class="kpi red"><div class="v">${inc}</div><div class="l">incidents CityLens confirmed on ${cams.length} cameras here</div></div><div class="kpi"><div class="v">${d.latest ? ago(d.latest) : '–'}</div><div class="l">most recent request</div></div></div>
      <div class="c311">${d.categories.map(([c, n]) => `<span>${esc(c)}</span><b>${n}</b><div class="bar"><i style="width:${Math.round(100 * n / mx)}%"></i></div>`).join('')}</div></div></div>`;
  }).join('');
  if ($('#l311').checked) draw311();
}
function draw311() {
  if (layer311) { map.removeLayer(layer311); layer311 = null; }
  if (!$('#l311').checked) return;
  layer311 = L.layerGroup();
  for (const d of Object.values(CITYDATA)) for (const c of (d.cases || [])) {
    L.circleMarker([c.lat, c.lon], { radius: 3, color: '#f2a93b', weight: 0, fillColor: '#f2a93b', fillOpacity: .75 })
      .bindPopup(`<b>${esc(c.category)}</b>${c.detail ? '<br>' + esc(c.detail) : ''}<br><span style="color:#8a8a95">${esc(c.where || '')} · ${ago(c.when)} · ${esc(c.status || '')}</span>`).addTo(layer311);
  }
  layer311.addTo(map);
  const first = Object.values(CITYDATA).find(d => d.cases?.length);
  if (first && map.getZoom() < 9) { const c = OV.cities.find(x => x.location === first.location); if (c) map.flyTo([c.lat, c.lon], 12, { duration: .8 }); }
}
$('#l311').onchange = draw311;

/* ---------- incidents ---------- */
let RULES = [], CAMS = [];
function incCard(i) {
  const st = i.status || 'candidate', v = i.verdict;
  const verdict = v == null ? `<div class="verdict none"><span class="who">Cosmos</span><div>Not verified yet. <span class="conf">Similarity ${(+i.similarity || 0).toFixed(2)}</span></div></div>`
    : `<div class="verdict ${v}"><span class="who">Cosmos ${v}</span><div>${esc(i.reason)} <span class="conf">· ${Math.round((i.confidence || 0) * 100)}% sure · match ${(+i.similarity || 0).toFixed(2)}</span></div></div>`;
  const ctx = i.original_video ? `<div class="ctx"><button class="on" data-mode="clip">5 s moment</button><button data-mode="chunk">30 s context</button></div>` : '';
  const act = st === 'confirmed' ? `<button class="btn sm act311" data-id="${i.id}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M12 5v14M5 12h14"/></svg>Create 311 case</button>` : '';
  return `<div class="inc ${st}" data-src="${esc(i.source)}" data-chunk="${esc(i.original_video || '')}" data-start="${i.segment_start_sec ?? 0}"><div class="v"><video src="${clipUrl(i.source)}" poster="${thumbUrl(i.source)}" controls muted preload="none" loop playsinline></video><span class="chip ${st}">${st}</span><span class="when">at ${mmss(i.segment_start_sec)}</span></div>
  <div class="b"><div class="t"><b>${esc(i.rule)}</b><span class="chip ${i.severity}">${i.severity}</span></div><div class="m">${nice(i.camera_id)} · ${city(i.location)}${i.detected_at ? ' · ' + ago(i.detected_at) : ''}</div>${verdict}<div class="cap">${esc(i.caption)}</div><div class="acts">${ctx}${act}</div></div></div>`;
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
    if (b.dataset.mode === 'chunk') { v.loop = false; v.src = clipUrl(card.dataset.chunk) + '#t=' + Math.max(0, start - 5); v.play(); }
    else { v.loop = true; v.src = clipUrl(card.dataset.src); v.play(); }
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
  $('#i-cam').innerHTML = '<option value="">All street cameras</option>' + CAMS.map(c => `<option value="${c.camera_id}">${nice(c.camera_id)} · ${city(c.location)}</option>`).join('');
  $('#i-rule').innerHTML = '<option value="">All rules</option>' + RULES.map(r => `<option value="${r.id}">${r.name}</option>`).join('');
}
$('#i-filter').onchange = () => renderIncidents(lastList);
$('#i-stored').onclick = async () => { lastList = await api('incidents'); renderIncidents(lastList); };
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
      else if (j.phase === 'verifying') { const pct = j.verify_total ? 15 + 80 * j.verify_done / j.verify_total : 90; $('#p-txt').textContent = `Cosmos Reason is watching candidate clips (${j.verify_done} of ${j.verify_total})`; $('#p-bar').style.width = pct + '%'; $('#p-pct').textContent = Math.round(pct) + '%'; if (j.incidents?.length) { lastList = j.incidents; renderIncidents(lastList); } }
      else if (j.phase === 'done') { $('#p-bar').style.width = '100%'; $('#p-pct').textContent = '100%'; $('#p-txt').textContent = `Done in ${j.seconds}s · ${j.confirmed} confirmed, ${j.dismissed} dismissed, ${j.saved} new rows written to VastDB`; lastList = j.incidents; renderIncidents(lastList); loaded.overview = false; break; }
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
  $('#m-kpis').innerHTML = [[m.baseline_vehicles, "vehicles per clip, this camera's normal", ''], [m.peak.rolling, 'busiest minute, vehicles per clip', 'red'], [peakX + '×', 'peak vs normal', ''], [m.current_ratio + '×', 'last minute vs normal', m.current_ratio > 1.3 ? 'red' : 'green'], [m.people_median, 'people per clip, typical', ''], [m.segments, '5-second clips measured', 'teal']]
    .map(([v, l, c]) => `<div class="kpi ${c}"><div class="v">${v}</div><div class="l">${l}</div></div>`).join('');
  $('#m-sub').textContent = `${nice(cam)} · ${(m.segments * 5 / 60).toFixed(0)} min of footage · vehicles and people per 5 s clip`;
  const labels = m.series.map(s => (s.i * 5 / 60).toFixed(1));
  cFlow?.destroy(); cFlow = new Chart($('#c-flow'), { type: 'bar', data: { labels, datasets: [
    { type: 'line', label: 'rolling minute', data: m.series.map(s => s.rolling), borderColor: '#ff4150', backgroundColor: 'rgba(229,32,47,.16)', fill: true, pointRadius: 0, pointHitRadius: 8, tension: .3, borderWidth: 2 },
    { label: 'per clip', data: m.series.map(s => s.vehicles), backgroundColor: '#2a2a31', borderWidth: 0, barPercentage: 1, categoryPercentage: .9 },
    { type: 'line', label: 'people (rolling)', data: m.series.map((x, i, a) => { const w = a.slice(Math.max(0, i - 11), i + 1); return +(w.reduce((p, y) => p + y.people, 0) / w.length).toFixed(1); }), borderColor: '#9aa6ff', pointRadius: 0, pointHitRadius: 8, tension: .3, borderWidth: 1.5 },
    { type: 'line', label: 'normal', data: m.series.map(() => m.baseline_vehicles), borderColor: '#8a8a95', borderDash: [5, 5], pointRadius: 0, borderWidth: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, animation: { duration: 400 }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: it => 'minute ' + it[0].label } } }, scales: { x: { ticks: { maxTicksLimit: 10, callback: (v, i) => labels[i] + ' min' }, grid: { display: false } }, y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.06)' } } }, onClick: (e, els) => { if (els.length) { const s = m.series[els[0].index]; $('#m-moments').innerHTML = momentCard(s.source, `Minute ${(s.i * 5 / 60).toFixed(1)} · ${s.vehicles} vehicles, ${s.people} people in this clip`, s.original_video, s.seg ? (s.seg - 1) * 5 : 0); wireCards($('#m-moments')); } } } });
  const mixCols = ['#ff4150', '#f5f5f7', '#9aa6ff', '#f2a93b', '#3ecf8e', '#8a8a95', '#4a4a55'];
  cMix?.destroy(); cMix = new Chart($('#c-mix'), { type: 'doughnut', data: { labels: m.object_mix.map(o => o[0]), datasets: [{ data: m.object_mix.map(o => o[1]), backgroundColor: mixCols, borderWidth: 0, hoverOffset: 6 }] }, options: { responsive: true, maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'right', labels: { boxWidth: 10, usePointStyle: true, padding: 12 } } } } });
  const cmp = ov.cameras.filter(c => c.ratio != null);
  cCmp?.destroy(); cCmp = new Chart($('#c-cmp'), { type: 'bar', data: { labels: cmp.map(c => nice(c.camera_id)), datasets: [{ data: cmp.map(c => c.ratio), backgroundColor: cmp.map(c => c.camera_id === cam ? '#ff4150' : c.ratio > 1.3 ? '#f2a93b' : '#2a2a31'), borderRadius: 4 }] }, options: { responsive: true, maintainAspectRatio: false, indexAxis: 'y', plugins: { legend: { display: false }, tooltip: { callbacks: { label: it => it.raw + '× its normal' } } }, scales: { x: { beginAtZero: true, grid: { color: 'rgba(255,255,255,.06)' }, ticks: { callback: v => v + '×' } }, y: { grid: { display: false } } }, onClick: (e, els) => { if (els.length) { $('#m-cam').value = cmp[els[0].index].camera_id; $('#m-run').click(); } } } });
  $('#m-moments').innerHTML = momentCard(m.peak.source, `Busiest minute · ${m.peak.rolling} vehicles per clip (${peakX}× normal)`, m.peak.original_video, m.peak.seg ? (m.peak.seg - 1) * 5 : 0) + momentCard(m.quiet.source, `Quietest minute · ${m.quiet.rolling} vehicles per clip`, m.quiet.original_video, m.quiet.seg ? (m.quiet.seg - 1) * 5 : 0);
  wireCards($('#m-moments'));
};
const momentCard = (src, t, chunk, start) => `<div class="inc" data-src="${esc(src)}" data-chunk="${esc(chunk || '')}" data-start="${start ?? 0}"><div class="v"><video src="${clipUrl(src)}" poster="${thumbUrl(src)}" controls muted preload="none" loop playsinline></video></div><div class="b"><div class="m">${esc(t)}</div>${chunk ? '<div class="acts"><div class="ctx"><button class="on" data-mode="clip">5 s moment</button><button data-mode="chunk">30 s context</button></div></div>' : ''}</div></div>`;

/* ---------- system ---------- */
async function loadSystem() {
  const s = await api('system');
  const ok = b => `<span class="chip ${b ? 'ok' : 'incident'}">${b ? 'ready' : 'down'}</span>`;
  $('#flow').innerHTML = [['Street cameras', 'video chunks → VAST S3'], ['Segmenter', '5 s clips'], ['YOLO11', 'objects, counts, boxes'], ['Cosmos Reason', 'operator captions'], ['Cosmos Embed1', '256-d vectors'], ['VastDB', 'vss-collection'], ['CityLens rules', 'candidates'], ['Cosmos verdict', 'yes / no + reason'], ['VastDB', 'citylens.incidents'], ['Agent + Weave', 'answers with evidence']]
    .map(([n, d], i, a) => `<div class="n">${n}<small>${d}</small></div>${i < a.length - 1 ? '<span class="ar">→</span>' : ''}`).join('');
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
