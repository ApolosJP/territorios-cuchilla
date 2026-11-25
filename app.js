/* Territorio de visitas · Cuchilla de Padierna
 * App de una sola página: mapa, registro diario, programas de servicio, avance e historial.
 * Datos: Google Sheets vía Apps Script (config.js) o modo demo en el navegador.
 */
(() => {
'use strict';

/* ================= Constantes ================= */
const PALETA = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948']; // un color por ciclo, en orden fijo
const PEND = '#d9d9d9';
const TIPOS = {
  casa: { pre: 'NP', t: 'Casa marcada', e: '🚫' },
  nota: { pre: 'NT', t: 'Nota', e: '📝' }
};
const COL_LUGAR = { mercado: '#cfc858', religioso: '#a8a8a8', salud: '#f6a3ee', canchas: '#99ee00', lecheria: '#f79a9a', kinder: '#77ffd4' };
const PROG = {
  semanal: {
    titulo: 'Programa Semanal de Servicio',
    filas: [
      { k: 'mar', d: 'Martes', ab: 'Mar', off: 0, h: '09:00', c: '#2a78d6' },
      { k: 'mie', d: 'Miércoles', ab: 'Mié', off: 1, h: '09:00', c: '#eb6834' },
      { k: 'jum', d: 'Jueves Mañana', ab: 'JuM', off: 2, h: '09:00', c: '#119b6a' },
      { k: 'jut', d: 'Jueves Tarde', ab: 'JuT', off: 2, h: '16:00', c: '#6250d6' },
      { k: 'vie', d: 'Viernes', ab: 'Vie', off: 3, h: '09:00', c: '#e34948' },
      { k: 'sab', d: 'Sábado', ab: 'Sáb', off: 4, h: '09:00', c: '#b07800' }
    ]
  },
  domingo: {
    titulo: 'Programa de servicio por grupos',
    filas: [
      { k: 'g1', d: 'Grupo 1', ab: 'G1', h: '09:00', c: '#2a78d6' },
      { k: 'g2', d: 'Grupo 2', ab: 'G2', h: '09:00', c: '#eb6834' },
      { k: 'g3', d: 'Grupo 3', ab: 'G3', h: '09:00', c: '#119b6a' }
    ]
  }
};
const DEMO = !window.CONFIG || !window.CONFIG.API_URL;
const LS = window.localStorage;

/* ================= Geometría ================= */
const MZ = window.MAPA.manzanas.features.map(f => ({ id: f.properties.id, codigo: f.properties.codigo, area: f.properties.area_m2, f }));
const MZ_BY_ID = Object.fromEntries(MZ.map(m => [m.id, m]));
const POR_CODIGO = {};
MZ.forEach(m => (POR_CODIGO[m.codigo] = POR_CODIGO[m.codigo] || []).push(m.id));
const TOTAL = MZ.length;
const natural = (a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b, 'es', { numeric: true });
const IDS_ORDEN = MZ.map(m => m.id).sort(natural);

// proyección plana local (metros) para ubicar notas en su manzana
const LAT0 = 19.2768, KX = Math.cos(LAT0 * Math.PI / 180) * 111320, KY = 110540;
const xy = ([lng, lat]) => [lng * KX, lat * KY];
MZ.forEach(m => { m.ring = m.f.geometry.coordinates[0].map(xy); });
function dentro(p, ring) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, yi] = ring[i], [xj, yj] = ring[j]; if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) c = !c; } return c; }
function distSeg(p, a, b) { const dx = b[0] - a[0], dy = b[1] - a[1], l = dx * dx + dy * dy; let t = l ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l : 0; t = Math.max(0, Math.min(1, t)); return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy); }
function manzanaCercana(lat, lng) {
  const p = xy([lng, lat]); let best = null, bd = Infinity;
  for (const m of MZ) {
    if (dentro(p, m.ring)) return m.id;
    for (let i = 0; i < m.ring.length - 1; i++) { const d = distSeg(p, m.ring[i], m.ring[i + 1]); if (d < bd) { bd = d; best = m.id; } }
  }
  return best;
}

/* ================= Estado ================= */
const S = { token: null, visitas: [], ciclos: [], notas: [], sel: new Set(), modoSel: false, modoNota: false, asignar: null, verCiclo: 'actual', verProg: LS.getItem('territorio_verprog') || 'semanal', registro: [], progTab: 'semanal' };

/* ================= Utilidades ================= */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const hoy = () => iso(new Date());
const parseF = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const diasEntre = (a, b) => Math.round((parseF(b) - parseF(a)) / 86400000);
const fmtF = s => s ? parseF(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';
const fmtCorta = s => parseF(s).toLocaleDateString('es-MX', { day: 'numeric', month: 'short' });
const fmtLarga = s => parseF(s).toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const sumarDias = (s, n) => { const d = parseF(s); d.setDate(d.getDate() + n); return iso(d); };
const hora = h => (h || '').replace(/^0/, '') + ' hrs';
function toast(msg, ms = 2800) { const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden'); clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), ms); }
async function sha256(t) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
const colorCiclo = n => PALETA[(Number(n) - 1) % PALETA.length];
const diasCiclo = c => diasEntre(c.inicio, c.fin || hoy()) + 1; // inicio y cierre incluidos

/* ================= Backend ================= */
const Demo = {
  db() { try { return JSON.parse(LS.getItem('territorio_demo')) || { visitas: [], ciclos: [], notas: [] }; } catch { return { visitas: [], ciclos: [], notas: [] }; } },
  save(d) { LS.setItem('territorio_demo', JSON.stringify(d)); },
  id() { return Math.random().toString(16).slice(2, 10); },
  call(action, p) {
    const d = this.db(); let out;
    switch (action) {
      case 'login': out = true; break;
      case 'getAll': out = d; break;
      case 'addVisitas': {
        const t = new Date(); const ts = iso(t) + ' ' + t.toTimeString().slice(0, 8);
        out = p.rows.map(r => ({ ...r, id: this.id(), registrado: ts })); d.visitas.push(...out); break;
      }
      case 'deleteVisita': d.visitas = d.visitas.filter(v => v.id !== p.id); out = { borrado: true }; break;
      case 'addCiclo': d.ciclos.push(p.row); out = [p.row]; break;
      case 'updateCiclo': d.ciclos = d.ciclos.map(c => String(c.n) === String(p.row.n) ? { ...c, ...p.row } : c); out = p.row; break;
      case 'saveNota':
        if (p.row.id) { d.notas = d.notas.map(n => n.id === p.row.id ? { ...n, ...p.row } : n); out = p.row; }
        else { out = [{ ...p.row, id: this.id() }]; d.notas.push(out[0]); }
        break;
      case 'deleteNota': d.notas = d.notas.filter(n => n.id !== p.id); out = { borrado: true }; break;
    }
    this.save(d); return Promise.resolve(JSON.parse(JSON.stringify(out)));
  }
};

async function api(action, payload = {}) {
  if (DEMO) return Demo.call(action, payload);
  let r;
  try {
    r = await fetch(window.CONFIG.API_URL, { method: 'POST', body: JSON.stringify({ action, token: S.token, ...payload }) });
  } catch (e) { throw new Error('Sin conexión con Google Sheets'); }
  const j = await r.json();
  if (!j.ok) {
    if (j.error === 'auth') { salir(); throw new Error('Contraseña incorrecta'); }
    throw new Error(j.error || 'Error');
  }
  return j.data;
}

/* ================= Login ================= */
function salir() { LS.removeItem('territorio_token'); sessionStorage.removeItem('territorio_token'); S.token = null; $('#login').classList.remove('hidden'); }

$('#loginForm').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('#loginErr'); err.textContent = '';
  const btn = e.target.querySelector('button'); btn.disabled = true;
  try {
    S.token = DEMO ? 'demo' : await sha256($('#pass').value);
    await api('login');
    ($('#recordar').checked ? LS : sessionStorage).setItem('territorio_token', S.token);
    $('#login').classList.add('hidden');
    await cargar();
  } catch (ex) { err.textContent = ex.message === 'Contraseña incorrecta' ? 'Contraseña incorrecta.' : ex.message; S.token = null; }
  btn.disabled = false;
});

/* ================= Datos derivados ================= */
const num = c => Number(c.n);
function cicloActual() { const abiertos = S.ciclos.filter(c => !c.fin).sort((a, b) => num(b) - num(a)); return abiertos[0] || null; }
function ultimoCiclo() { return S.ciclos.slice().sort((a, b) => num(b) - num(a))[0] || null; }
function visitasCiclo(n) { return S.visitas.filter(v => String(v.ciclo) === String(n)); }
function visitadasCiclo(n) { const s = new Map(); visitasCiclo(n).forEach(v => { if (!s.has(v.manzana) || v.fecha < s.get(v.manzana)) s.set(v.manzana, v.fecha); }); return s; }
function ultimaVisita() { const m = new Map(); S.visitas.forEach(v => { if (!m.has(v.manzana) || v.fecha > m.get(v.manzana)) m.set(v.manzana, v.fecha); }); return m; }
function cicloMostrado() { if (S.verCiclo === 'actual') return cicloActual() || ultimoCiclo(); return S.ciclos.find(c => String(c.n) === String(S.verCiclo)) || null; }

/* ================= Carga ================= */
async function cargar() {
  document.body.classList.add('loading');
  try {
    const d = await api('getAll');
    S.visitas = d.visitas || []; S.ciclos = d.ciclos || []; S.notas = d.notas || [];
    await migrarNotas();
  } catch (e) { toast(e.message, 5000); }
  document.body.classList.remove('loading');
  renderTodo();
}

function renderTodo() { renderHeader(); renderMapa(); renderRegistro(); renderProg(); renderDash(); renderHist(); }

/* ================= Header ================= */
function renderHeader() {
  const c = cicloActual();
  if (!c) { $('#hdrCiclo').innerHTML = '<span>Sin visitas aún</span>'; return; }
  const n = visitadasCiclo(c.n).size, p = Math.round(n / TOTAL * 100);
  $('#hdrCiclo').innerHTML = `<span class="sw" style="background:${colorCiclo(c.n)}"></span><span>Ciclo ${esc(c.n)} · <b>${p}%</b></span><span class="bar"><i style="width:${p}%;background:${colorCiclo(c.n)}"></i></span>`;
}

/* ================= Programas (estado local del dispositivo) ================= */
function martesDe(f) { const d = parseF(f), w = d.getDay(); return sumarDias(f, w === 0 ? 2 : w === 1 ? 1 : 2 - w); } // martes de esa semana (lunes y domingo → martes siguiente)
function domingoDe(f) { const w = parseF(f).getDay(); return sumarDias(f, (7 - w) % 7); }
function progVacio(tipo, fecha) {
  if (tipo === 'semanal') return { martes: martesDe(fecha || hoy()), filas: PROG.semanal.filas.map(r => ({ k: r.k, hora: r.h, encuentro: '', capitan: '', mz: [], publica: false, estado: '' })) };
  return { fecha: domingoDe(fecha || hoy()), capitan: '', filas: PROG.domingo.filas.map(r => ({ k: r.k, hora: r.h, encuentro: '', mz: [], publica: false, estado: '' })) };
}
let P;
try { P = JSON.parse(LS.getItem('territorio_prog')); } catch { P = null; }
if (!P || !P.semanal || !P.domingo) P = { semanal: progVacio('semanal'), domingo: progVacio('domingo') };
const guardarProg = () => LS.setItem('territorio_prog', JSON.stringify(P));
const filaDef = (tipo, k) => PROG[tipo].filas.find(r => r.k === k);
const filaDe = (tipo, k) => P[tipo].filas.find(r => r.k === k);
const fechaFila = (tipo, k) => tipo === 'semanal' ? sumarDias(P.semanal.martes, filaDef(tipo, k).off) : P.domingo.fecha;
function asignadas(tipo) { const m = new Map(); P[tipo].filas.forEach(r => r.mz.forEach(id => m.set(id, r.k))); return m; }

/* ================= Mapa ================= */
let map, capaMz, capaNotas, capaProg;
const capaPorId = {};

function initMapa() {
  map = L.map('map', { zoomSnap: .25, zoomDelta: .5, zoomControl: false, attributionControl: false, maxBoundsViscosity: 1 });
  L.control.zoom({ position: 'topright' }).addTo(map);

  capaMz = L.geoJSON(window.MAPA.manzanas, {
    style: () => ({ color: '#777', weight: 1, fillColor: PEND, fillOpacity: .9 }),
    onEachFeature: (f, l) => {
      capaPorId[f.properties.id] = l;
      l.bindTooltip(f.properties.codigo, { permanent: true, direction: 'center', className: 'lbl', interactive: false });
      l.on('click', ev => clicManzana(f.properties.id, ev));
    }
  }).addTo(map);

  L.geoJSON(window.MAPA.lugares, {
    style: f => ({ color: '#555', weight: 1, fillColor: COL_LUGAR[f.properties.tipo] || '#ccc', fillOpacity: .85 }),
    onEachFeature: (f, l) => { l.bindTooltip(f.properties.nombre, { permanent: true, direction: 'center', className: 'lug' }); l.bindPopup(`<b>${esc(f.properties.nombre)}</b><br><span class="hint">No se visita</span>`); }
  }).addTo(map);

  L.layerGroup(window.MAPA.calles.features.map(f => L.marker([f.geometry.coordinates[1], f.geometry.coordinates[0]], {
    interactive: false, keyboard: false,
    icon: L.divIcon({ className: 'calle', iconSize: [0, 0], html: `<span style="--a:${f.properties.angulo}deg;--h:${f.properties.alto_m * 0.95}">${esc(f.properties.nombre)}</span>` })
  }))).addTo(map);

  capaProg = L.layerGroup().addTo(map);
  capaNotas = L.layerGroup().addTo(map);

  // Límites: alejar hasta ver toda la colonia; acercar hasta ver una manzana
  const B = capaMz.getBounds();
  const mediana = MZ.slice().sort((a, b) => a.area - b.area)[Math.floor(MZ.length / 2)].id;
  const limites = () => {
    map.setMinZoom(0); map.setMaxZoom(22);
    const zmin = map.getBoundsZoom(B, false, L.point(16, 16));
    const zmax = map.getBoundsZoom(capaPorId[mediana].getBounds(), false, L.point(30, 30));
    map.setMinZoom(zmin); map.setMaxZoom(Math.max(zmin + 1, zmax));
    map.setMaxBounds(B.pad(0.08));
  };
  map.fitBounds(B, { padding: [8, 8] }); limites();
  map.on('resize', () => { limites(); if (map.getZoom() < map.getMinZoom()) map.setZoom(map.getMinZoom()); });

  // etiquetas con tamaño fijo sobre el terreno (escalan con el zoom)
  const el = map.getContainer();
  const escala = () => {
    const ppm = Math.pow(2, map.getZoom()) / (156543.034 * Math.cos(LAT0 * Math.PI / 180));
    el.style.setProperty('--ppm', ppm + 'px');
    el.classList.toggle('mini', ppm * 2.5 < 4);
    el.classList.toggle('mini2', ppm * 9 < 5);
  };
  map.on('zoom zoomend', escala); escala();

  map.on('click', ev => { if (S.modoNota) { setModoNota(false); abrirNota({ lat: ev.latlng.lat, lng: ev.latlng.lng }); } });

  $('#bSel').onclick = () => setModoSel(!S.modoSel);
  $('#bNota').onclick = () => setModoNota(!S.modoNota);
  $('#bAsig').onclick = () => S.asignar ? setAsignar(null) : setAsignar({ tipo: S.verProg === 'domingo' ? 'domingo' : 'semanal', k: (S.verProg === 'domingo' ? 'g1' : 'mar') });
  $('#selLimpiar').onclick = () => { S.sel.clear(); pintarBordes(); };
  $('#selIr').onclick = () => { agregarRegistro([...S.sel]); S.sel.clear(); setModoSel(false); ir('registro'); };
  $('#verCiclo').onchange = e => { S.verCiclo = e.target.value; renderMapa(); };
  $('#verProg').onchange = e => { S.verProg = e.target.value; LS.setItem('territorio_verprog', S.verProg); if (S.asignar) setAsignar(S.verProg === 'ninguno' ? null : { tipo: S.verProg, k: PROG[S.verProg].filas[0].k }); else renderMapa(); };
  $('#asigFila').onchange = e => { S.asignar.k = e.target.value; renderAsigBar(); };
  $('#asigListo').onclick = () => setAsignar(null);
  $('#asigProg').onclick = () => { const t = S.asignar.tipo; setAsignar(null); S.progTab = t; ir('prog'); };
  $('#buscar').addEventListener('change', e => {
    const q = e.target.value.trim().toUpperCase(); const ids = POR_CODIGO[q] || (MZ_BY_ID[q] ? [q] : []);
    if (!ids.length) { toast('No existe el código ' + q); return; }
    const b = L.latLngBounds([]); ids.forEach(id => b.extend(capaPorId[id].getBounds()));
    map.fitBounds(b, { padding: [60, 60] }); ids.forEach(id => parpadear(id)); e.target.value = '';
  });
}

function parpadear(id) { const l = capaPorId[id]; let k = 0; const t = setInterval(() => { l.setStyle({ weight: k % 2 ? 1 : 5, color: k % 2 ? '#777' : '#111' }); if (++k > 5) { clearInterval(t); pintarBordes(); } }, 250); }

function salirModos(excepto) {
  if (excepto !== 'sel' && S.modoSel) { S.modoSel = false; S.sel.clear(); $('#bSel').classList.remove('act'); }
  if (excepto !== 'nota' && S.modoNota) { S.modoNota = false; $('#bNota').classList.remove('act'); map.getContainer().style.cursor = ''; }
  if (excepto !== 'asig' && S.asignar) { S.asignar = null; $('#bAsig').classList.remove('act'); $('#asigbar').classList.add('hidden'); }
}
function setModoSel(on) { salirModos('sel'); S.modoSel = on; $('#bSel').classList.toggle('act', on); if (!on) S.sel.clear(); pintarBordes(); if (on) toast('Toca las manzanas visitadas'); }
function setModoNota(on) { salirModos('nota'); S.modoNota = on; $('#bNota').classList.toggle('act', on); map.getContainer().style.cursor = on ? 'crosshair' : ''; pintarBordes(); if (on) toast('Toca la manzana donde va la casa marcada o la nota'); }
function setAsignar(a) {
  salirModos('asig'); S.asignar = a; $('#bAsig').classList.toggle('act', !!a);
  if (a) { S.verProg = a.tipo; LS.setItem('territorio_verprog', a.tipo); toast('Toca las manzanas para asignarlas o quitarlas'); }
  $('#asigbar').classList.toggle('hidden', !a);
  renderMapa();
}
function renderAsigBar() {
  if (!S.asignar) return;
  const { tipo, k } = S.asignar;
  $('#asigFila').innerHTML = PROG[tipo].filas.map(r => `<option value="${r.k}">${r.d}${tipo === 'semanal' ? ' ' + fmtCorta(fechaFila(tipo, r.k)) : ''}</option>`).join('');
  $('#asigFila').value = k;
  const n = filaDe(tipo, k).mz.length;
  $('#asigTxt').innerHTML = `<span class="sw" style="background:${filaDef(tipo, k).c}"></span> ${n} manzana${n === 1 ? '' : 's'}`;
}

function pintarBordes() {
  const asig = S.verProg !== 'ninguno' ? asignadas(S.verProg) : new Map();
  Object.entries(capaPorId).forEach(([id, l]) => {
    if (S.sel.has(id)) l.setStyle({ weight: 4, color: '#111', dashArray: '6 4' });
    else if (asig.has(id)) l.setStyle({ weight: 4, color: filaDef(S.verProg, asig.get(id)).c, dashArray: null });
    else l.setStyle({ weight: 1, color: '#777', dashArray: null });
  });
  $('#selbar').classList.toggle('hidden', !(S.modoSel && S.sel.size));
  $('#selTxt').textContent = `${S.sel.size} manzana${S.sel.size === 1 ? '' : 's'}`;
  // etiquetas del programa
  capaProg.clearLayers();
  asig.forEach((k, id) => {
    const d = filaDef(S.verProg, k), c = capaPorId[id].getBounds().getCenter();
    capaProg.addLayer(L.marker(c, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<span class="ptag" style="background:${d.c}">${d.ab}</span>` }) }));
  });
}

function clicManzana(id, ev) {
  if (S.modoNota) return; // el clic del mapa crea la nota
  L.DomEvent.stopPropagation(ev);
  if (S.modoSel) { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); pintarBordes(); return; }
  if (S.asignar) {
    const { tipo, k } = S.asignar, fila = filaDe(tipo, k);
    if (fila.mz.includes(id)) fila.mz = fila.mz.filter(x => x !== id);
    else { P[tipo].filas.forEach(r => { r.mz = r.mz.filter(x => x !== id); }); fila.mz.push(id); fila.mz.sort(natural); fila.estado = ''; }
    guardarProg(); pintarBordes(); renderAsigBar(); renderProg();
    return;
  }
  const m = MZ_BY_ID[id], c = cicloActual();
  const vs = S.visitas.filter(v => v.manzana === id).sort((a, b) => b.fecha.localeCompare(a.fecha));
  const enCiclo = c ? vs.filter(v => String(v.ciclo) === String(c.n)) : [];
  const st = !c ? '<span class="hint">Aún no inicia el primer ciclo</span>'
    : enCiclo.length ? `<span class="sw" style="background:${colorCiclo(c.n)}"></span> Visitada en el ciclo ${esc(c.n)} (${fmtF(enCiclo[enCiclo.length - 1].fecha)})`
    : `<span class="sw" style="background:${PEND}"></span> Pendiente en el ciclo ${esc(c.n)}`;
  const lista = vs.slice(0, 6).map(v => `<li>${fmtF(v.fecha)} · ciclo ${esc(v.ciclo)}${v.quien ? ' · ' + esc(v.quien) : ''}</li>`).join('');
  const prog = ['semanal', 'domingo'].map(t => { const k = asignadas(t).get(id); return k ? `${filaDef(t, k).d}${t === 'semanal' ? ' (semanal)' : ' (domingo)'}` : null; }).filter(Boolean);
  const ns = S.notas.filter(n => n.manzana === id).sort((a, b) => a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  const html = `<div class="pop"><h3>${esc(m.codigo)}${m.id !== m.codigo ? ` <small class="hint">(${esc(m.id)})</small>` : ''}</h3>
    <div class="hint">${vs.length} visita${vs.length === 1 ? '' : 's'} en total</div>
    <div class="st">${st}</div>${prog.length ? `<div class="hint">📅 Asignada: ${esc(prog.join(' · '))}</div>` : ''}
    ${ns.length ? `<div class="hint" style="margin-top:4px">${ns.map(n => `${TIPOS[n.tipo].e} ${esc(n.codigo)}`).join(' · ')}</div>` : ''}
    ${lista ? `<ul>${lista}</ul>` : ''}
    <div class="acts"><button class="btn sm pri" data-hoy="${esc(id)}">Visitada hoy</button><button class="btn sm" data-add="${esc(id)}">Agregar al registro</button></div></div>`;
  L.popup().setLatLng(ev.latlng).setContent(html).openOn(map);
}

document.addEventListener('click', async e => {
  const h = e.target.closest('[data-hoy]'), a = e.target.closest('[data-add]');
  if (h) { map.closePopup(); await registrar(hoy(), [h.dataset.hoy], LS.getItem('territorio_quien') || '', ''); }
  if (a) { agregarRegistro([a.dataset.add]); map.closePopup(); toast(`${a.dataset.add} agregada al registro del día`); }
});

function textoCiclo(c) { return `${fmtF(c.inicio)} – ${c.fin ? fmtF(c.fin) : 'en curso'} · ${diasCiclo(c)} día${diasCiclo(c) === 1 ? '' : 's'}`; }

function renderMapa() {
  if (!map) return;
  const sel = $('#verCiclo'), cs = S.ciclos.slice().sort((a, b) => num(b) - num(a)), act = cicloActual() || ultimoCiclo();
  sel.innerHTML = (act ? `<option value="actual">Ciclo actual (${esc(act.n)}) · ${textoCiclo(act)}</option>` : '<option value="actual">Ciclo actual</option>')
    + cs.map(c => `<option value="${esc(c.n)}">Ciclo ${esc(c.n)} · ${textoCiclo(c)}</option>`).join('');
  sel.value = S.verCiclo; if (sel.value !== S.verCiclo) { S.verCiclo = 'actual'; sel.value = 'actual'; }
  $('#verProg').value = S.verProg;

  const c = cicloMostrado(), vis = c ? visitadasCiclo(c.n) : new Map(), col = c ? colorCiclo(c.n) : PEND;
  Object.entries(capaPorId).forEach(([id, l]) => l.setStyle({ fillColor: vis.has(id) ? col : PEND, fillOpacity: vis.has(id) ? .85 : .9 }));
  pintarBordes(); renderAsigBar();
  $('#mapInfo').innerHTML = c
    ? `<div class="legend"><span><span class="sw" style="background:${col}"></span> Visitada (${vis.size})</span><span><span class="sw" style="background:${PEND}"></span> Pendiente (${TOTAL - vis.size})</span></div><div class="hint" style="margin-top:4px">Ciclo ${esc(c.n)} · ${textoCiclo(c)}</div>`
    : `<span class="hint">Registra la primera visita para iniciar el ciclo 1</span>`;
  renderNotasMapa();
}

/* ================= Notas: Casas marcadas (NP) y Notas (NT) ================= */
function siguienteCodigo(tipo, excepto) {
  const usados = new Set(S.notas.filter(n => n.tipo === tipo && n.id !== excepto).map(n => parseInt(String(n.codigo).replace(/\D/g, ''), 10)).filter(Boolean));
  let i = 1; while (usados.has(i)) i++;
  return TIPOS[tipo].pre + i; // reutiliza el número libre más bajo
}

async function migrarNotas() {
  // notas de la versión anterior (no_visitar / referencia / volver) → casa / nota, con código y manzana
  const viejas = S.notas.filter(n => !TIPOS[n.tipo] || !n.codigo || !n.manzana);
  for (const n of viejas) {
    if (!TIPOS[n.tipo]) n.tipo = n.tipo === 'no_visitar' ? 'casa' : 'nota';
    if (!n.manzana) n.manzana = manzanaCercana(+n.lat, +n.lng);
    if (!n.codigo) n.codigo = siguienteCodigo(n.tipo, n.id);
    if (n.tipo === 'casa' && !n.casa && n.texto) { n.dijo = n.texto; n.texto = ''; }
    await api('saveNota', { row: { id: n.id, tipo: n.tipo, codigo: n.codigo, manzana: n.manzana, dijo: n.dijo || '', texto: n.texto || '' } });
  }
}

function iconoNota(n) { return L.divIcon({ className: '', html: `<div class="nota t-${n.tipo}"><i>${TIPOS[n.tipo].e}</i><b>${esc(n.codigo)}</b></div>`, iconSize: [0, 0], iconAnchor: [14, 14] }); }

function popupNota(n) {
  const t = TIPOS[n.tipo];
  const fila = (lab, v) => v ? `<div><span class="hint">${lab}:</span> ${esc(v)}</div>` : '';
  const cuerpo = n.tipo === 'casa'
    ? fila('Dirección', n.direccion) + fila('Casa', n.casa) + fila('Referencias', n.referencias) + fila('Habitante', n.habitante) + fila('Lo que dijo', n.dijo) + fila('Nota', n.texto)
    : fila('Dirección / referencia', n.direccion) + fila('Nota', n.texto);
  return `<div class="pop"><h3>${t.e} ${esc(n.codigo)} <small class="hint">· ${t.t}</small></h3><div class="hint">Manzana <b>${esc(n.manzana)}</b> · ${fmtF(n.fecha)}${n.autor ? ' · ' + esc(n.autor) : ''}</div>
    <div style="margin-top:6px;display:grid;gap:3px">${cuerpo}</div>
    <div class="acts"><button class="btn sm" data-editnota="${esc(n.id)}">Editar</button><button class="btn sm" data-movernota="${esc(n.id)}">Mover</button></div></div>`;
}

const marcadorNota = {};
function renderNotasMapa() {
  capaNotas.clearLayers();
  S.notas.forEach(n => {
    const mk = L.marker([+n.lat, +n.lng], { icon: iconoNota(n), draggable: false });
    mk.bindPopup(popupNota(n));
    mk.on('dragend', async () => {
      mk.dragging.disable();
      const p = mk.getLatLng(), mz = manzanaCercana(p.lat, p.lng);
      const row = { id: n.id, lat: p.lat.toFixed(6), lng: p.lng.toFixed(6), manzana: mz };
      try { await api('saveNota', { row }); Object.assign(n, row); toast(`${n.codigo} movida · manzana ${mz}`); } catch (e) { toast(e.message); }
      renderMapa(); renderHist();
    });
    marcadorNota[n.id] = mk;
    capaNotas.addLayer(mk);
  });
}

document.addEventListener('click', e => {
  const b = e.target.closest('[data-editnota]');
  if (b) { map.closePopup(); abrirNota(S.notas.find(n => n.id === b.dataset.editnota)); }
  const m = e.target.closest('[data-movernota]');
  if (m) { map.closePopup(); const mk = marcadorNota[m.dataset.movernota]; mk.dragging.enable(); toast('Arrastra el pin a su lugar y suéltalo', 4000); }
});

function abrirNota(n) {
  const nueva = !n.id;
  const mzIni = n.manzana || manzanaCercana(+n.lat, +n.lng);
  const md = document.createElement('div'); md.className = 'modal';
  md.innerHTML = `<div class="card"><h2 id="nTitulo"></h2>
    <div class="seg" id="nTipo"><button data-t="casa">🚫 Casa marcada</button><button data-t="nota">📝 Nota</button></div>
    <div class="row"><div><label class="f">Manzana</label><select id="nMz">${IDS_ORDEN.map(i => `<option>${i}</option>`).join('')}</select></div>
    <div><label class="f">Autor</label><input type="text" id="nAut"></div></div>
    <label class="f" id="lDir">Dirección</label><input type="text" id="nDir" placeholder="Ej. Tekit 23">
    <div class="soloCasa">
      <label class="f">Descripción de la casa</label><input type="text" id="nCasa" placeholder="Ej. Casa azul de dos pisos, portón negro">
      <label class="f">Referencias</label><input type="text" id="nRef" placeholder="Ej. Frente a la tienda, junto al poste">
      <label class="f">Descripción del habitante</label><input type="text" id="nHab" placeholder="Ej. Señor de unos 60 años">
      <label class="f">¿Qué dijo? <small>(breve)</small></label><textarea id="nDijo" placeholder="Ej. Pidió que no se le visite"></textarea>
    </div>
    <label class="f" id="lTxt">Nota <small>(opcional)</small></label><textarea id="nTxt"></textarea>
    <div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap"><button class="btn pri" id="nOk">Guardar</button><button class="btn" id="nNo">Cancelar</button>${nueva ? '' : '<button class="btn dan" id="nDel" style="margin-left:auto">Eliminar</button>'}</div></div>`;
  document.body.appendChild(md);
  const q = s => md.querySelector(s);
  let tipo = n.tipo || 'casa';
  const pintarTipo = () => {
    md.querySelectorAll('#nTipo button').forEach(b => b.classList.toggle('on', b.dataset.t === tipo));
    q('.soloCasa').classList.toggle('hidden', tipo !== 'casa');
    q('#lDir').textContent = tipo === 'casa' ? 'Dirección' : 'Dirección o referencia';
    q('#lTxt').innerHTML = tipo === 'casa' ? 'Nota <small>(opcional)</small>' : 'Nota';
    const cod = !nueva && n.tipo === tipo ? n.codigo : siguienteCodigo(tipo, n.id);
    q('#nTitulo').textContent = `${nueva ? 'Nueva' : 'Editar'} ${TIPOS[tipo].t.toLowerCase()} · ${cod}`;
  };
  md.querySelectorAll('#nTipo button').forEach(b => b.onclick = () => { tipo = b.dataset.t; pintarTipo(); });
  q('#nMz').value = mzIni;
  q('#nAut').value = n.autor || LS.getItem('territorio_quien') || '';
  q('#nDir').value = n.direccion || ''; q('#nCasa').value = n.casa || ''; q('#nRef').value = n.referencias || '';
  q('#nHab').value = n.habitante || ''; q('#nDijo').value = n.dijo || ''; q('#nTxt').value = n.texto || '';
  pintarTipo();
  const cerrar = () => md.remove();
  q('#nNo').onclick = cerrar;
  md.addEventListener('click', e => { if (e.target === md) cerrar(); });
  q('#nOk').onclick = async () => {
    const mz = q('#nMz').value;
    let lat = +n.lat, lng = +n.lng;
    if (manzanaCercana(lat, lng) !== mz) { const c = capaPorId[mz].getBounds().getCenter(); lat = c.lat; lng = c.lng; } // si cambió la manzana, el pin se lleva a ella
    const row = {
      tipo, manzana: mz, lat: lat.toFixed(6), lng: lng.toFixed(6), autor: q('#nAut').value.trim(), direccion: q('#nDir').value.trim(),
      casa: tipo === 'casa' ? q('#nCasa').value.trim() : '', referencias: tipo === 'casa' ? q('#nRef').value.trim() : '',
      habitante: tipo === 'casa' ? q('#nHab').value.trim() : '', dijo: tipo === 'casa' ? q('#nDijo').value.trim() : '',
      texto: q('#nTxt').value.trim(), fecha: n.fecha || hoy(),
      codigo: !nueva && n.tipo === tipo ? n.codigo : siguienteCodigo(tipo, n.id)
    };
    if (tipo === 'nota' && !row.texto) { toast('Escribe la nota'); return; }
    if (tipo === 'casa' && !row.direccion && !row.casa) { toast('Escribe al menos la dirección o la descripción de la casa'); return; }
    if (!nueva) row.id = n.id;
    if (row.autor) LS.setItem('territorio_quien', row.autor);
    try {
      const r = await api('saveNota', { row });
      if (nueva) S.notas.push(Array.isArray(r) ? r[0] : r); else Object.assign(S.notas.find(x => x.id === n.id), row);
      cerrar(); renderMapa(); renderHist(); renderDash(); toast(`${row.codigo} guardada`);
    } catch (e) { toast(e.message); }
  };
  if (!nueva) q('#nDel').onclick = async () => {
    if (!confirm(`¿Eliminar ${n.codigo} definitivamente? Su código quedará libre para la siguiente.`)) return;
    try { await api('deleteNota', { id: n.id }); S.notas = S.notas.filter(x => x.id !== n.id); cerrar(); renderMapa(); renderHist(); renderDash(); toast(`${n.codigo} eliminada`); } catch (e) { toast(e.message); }
  };
}

/* ================= Registro ================= */
function agregarRegistro(ids) { ids.forEach(id => { if (MZ_BY_ID[id] && !S.registro.includes(id)) S.registro.push(id); }); renderChips(); }

function parsearCodigos(txt) {
  const ids = [], malos = [];
  txt.toUpperCase().split(/[\s,;]+/).filter(Boolean).forEach(t => {
    if (POR_CODIGO[t]) ids.push(...POR_CODIGO[t]); else if (MZ_BY_ID[t]) ids.push(t); else malos.push(t);
  });
  return { ids, malos };
}

function renderChips() {
  const c = cicloActual(), ya = c ? visitadasCiclo(c.n) : new Map();
  $('#rChips').innerHTML = S.registro.length ? S.registro.map(id => `<span class="chip ${ya.has(id) ? 'ya' : ''}" title="${ya.has(id) ? 'Ya visitada en este ciclo' : ''}">${esc(id)}<button data-quitar="${esc(id)}" aria-label="Quitar">×</button></span>`).join('')
    : '<span class="hint">Aún no agregas manzanas.</span>';
  const nuevas = S.registro.filter(id => !ya.has(id)).length;
  $('#rResumen').textContent = S.registro.length ? `${S.registro.length} manzana(s) · ${nuevas} nueva(s) para el ciclo` : '';
}

function renderRegistro() {
  $('#dlCodigos').innerHTML = Object.keys(POR_CODIGO).sort(natural).map(c => `<option value="${c}">`).join('');
  renderChips();
  const f = $('#rFecha').value || hoy();
  // orden en que se guardaron: lo más reciente arriba
  const del = S.visitas.map((v, i) => ({ v, i })).filter(x => x.v.fecha === f)
    .sort((a, b) => String(b.v.registrado || '').localeCompare(String(a.v.registrado || '')) || b.i - a.i).map(x => x.v);
  $('#rHoy').innerHTML = del.length ? tablaVisitas(del, true, true) : `<span class="hint">Sin registros el ${fmtF(f)}.</span>`;
}

function initRegistro() {
  $('#rFecha').value = hoy();
  $('#rQuien').value = LS.getItem('territorio_quien') || '';
  const add = () => {
    const { ids, malos } = parsearCodigos($('#rCodigo').value);
    agregarRegistro(ids); $('#rCodigo').value = '';
    if (malos.length) toast('No reconocido: ' + malos.join(', '));
  };
  $('#rAgregar').onclick = add;
  $('#rCodigo').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  $('#rCodigo').addEventListener('input', e => { if (POR_CODIGO[e.target.value.toUpperCase()] && e.inputType === 'insertReplacementText') add(); });
  $('#rFecha').onchange = renderRegistro;
  document.addEventListener('click', e => { const q = e.target.closest('[data-quitar]'); if (q) { S.registro = S.registro.filter(x => x !== q.dataset.quitar); renderChips(); } });
  $('#rGuardar').onclick = async () => {
    if ($('#rCodigo').value.trim()) add();
    if (!S.registro.length) { toast('Agrega al menos una manzana'); return; }
    const ok = await registrar($('#rFecha').value || hoy(), S.registro.slice(), $('#rQuien').value.trim(), $('#rComent').value.trim());
    if (ok) { S.registro = []; $('#rComent').value = ''; renderRegistro(); }
  };
}

/** Guarda visitas y maneja el ciclo: lo crea si no existe y lo cierra solo al llegar al 100 %. */
async function registrar(fecha, ids, quien, comentario) {
  const btn = $('#rGuardar'); btn.disabled = true;
  try {
    if (quien) LS.setItem('territorio_quien', quien);
    let c = cicloActual();
    if (!c) {
      const n = (ultimoCiclo() ? num(ultimoCiclo()) : 0) + 1;
      c = { n: String(n), color: colorCiclo(n), inicio: fecha, fin: '', motivo: '' };
      await api('addCiclo', { row: c }); S.ciclos.push(c);
    }
    const rows = ids.map(id => ({ fecha, manzana: id, codigo: MZ_BY_ID[id].codigo, ciclo: String(c.n), quien, comentario }));
    const added = await api('addVisitas', { rows });
    S.visitas.push(...added);
    if (fecha < c.inicio) { await api('updateCiclo', { row: { n: String(c.n), inicio: fecha } }); c.inicio = fecha; }
    let msg = `${ids.length} visita(s) guardada(s)`;
    if (visitadasCiclo(c.n).size >= TOTAL) {
      await cerrarCiclo(c, fecha, 'completo');
      msg = `🎉 ¡Territorio completado! Ciclo ${c.n} cerrado; inicia el ciclo ${num(c) + 1} con color nuevo.`;
    }
    renderTodo(); toast(msg, 5000);
    return true;
  } catch (e) { toast(e.message, 5000); return false; }
  finally { btn.disabled = false; }
}

async function cerrarCiclo(c, fecha, motivo) {
  visitasCiclo(c.n).forEach(v => { if (v.fecha > fecha) fecha = v.fecha; });
  const upd = { n: String(c.n), fin: fecha, motivo };
  await api('updateCiclo', { row: upd }); Object.assign(c, upd);
  const n = num(c) + 1, nuevo = { n: String(n), color: colorCiclo(n), inicio: fecha, fin: '', motivo: '' };
  await api('addCiclo', { row: nuevo }); S.ciclos.push(nuevo);
}

/* ================= Programas: pantalla ================= */
function nombresUsados(campo) { try { return JSON.parse(LS.getItem('territorio_' + campo)) || []; } catch { return []; } }
function recordarNombre(campo, v) { if (!v) return; const l = nombresUsados(campo).filter(x => x !== v); l.unshift(v); LS.setItem('territorio_' + campo, JSON.stringify(l.slice(0, 30))); }

function subtituloProg(tipo) {
  if (tipo === 'semanal') {
    const a = parseF(P.semanal.martes), b = parseF(sumarDias(P.semanal.martes, 4));
    const mes = d => d.toLocaleDateString('es-MX', { month: 'long' });
    return a.getMonth() === b.getMonth()
      ? `Semana del martes ${a.getDate()} al sábado ${b.getDate()} de ${mes(b)} de ${b.getFullYear()}`
      : `Semana del martes ${a.getDate()} de ${mes(a)} al sábado ${b.getDate()} de ${mes(b)} de ${b.getFullYear()}`;
  }
  const s = fmtLarga(P.domingo.fecha); return s.charAt(0).toUpperCase() + s.slice(1);
}

function renderProg() {
  const t = S.progTab, cfg = PROG[t], pr = P[t];
  document.querySelectorAll('#progTabs button').forEach(b => b.classList.toggle('on', b.dataset.p === t));
  $('#dlEncuentro').innerHTML = nombresUsados('encuentros').map(v => `<option value="${esc(v)}">`).join('');
  $('#dlCapitan').innerHTML = nombresUsados('capitanes').map(v => `<option value="${esc(v)}">`).join('');
  const filas = cfg.filas.map((d, i) => {
    const r = filaDe(t, d.k), f = fechaFila(t, d.k), hecho = r.estado === 'visitadas';
    const dia = t === 'semanal'
      ? `<b>${d.d}</b><span class="hint">${fmtCorta(f)}</span>`
      : `<b>${d.d}</b>`;
    const cap = t === 'semanal'
      ? `<td data-l="Capitán"><input type="text" list="dlCapitan" data-campo="capitan" data-k="${d.k}" value="${esc(r.capitan)}" placeholder="Nombre"></td>`
      : (i === 0 ? `<td data-l="Capitán (los 3 grupos)" rowspan="3" class="capdom"><input type="text" list="dlCapitan" data-campo="capitanDom" value="${esc(pr.capitan)}" placeholder="Nombre"></td>` : '');
    return `<tr style="--c:${d.c}">
      <td data-l="Día" class="dia"><span class="ptag" style="background:${d.c}">${d.ab}</span>${dia}<label class="hora"><input type="time" data-campo="hora" data-k="${d.k}" value="${esc(r.hora)}"></label></td>
      <td data-l="Punto de encuentro"><input type="text" list="dlEncuentro" data-campo="encuentro" data-k="${d.k}" value="${esc(r.encuentro)}" placeholder="Lugar"></td>
      ${cap}
      <td data-l="Territorio" class="terr">
        <div class="chips">${r.publica ? `<span class="chip pub">📢 Predicación pública<button data-pubprog="${t}|${d.k}" aria-label="Quitar">×</button></span>` : ''}${r.mz.map(id => `<span class="chip ${hecho ? 'ya' : ''}">${esc(id)}${hecho ? '' : `<button data-quitarprog="${t}|${d.k}|${esc(id)}" aria-label="Quitar">×</button>`}</span>`).join('')}${!r.mz.length && !r.publica ? '<span class="hint">Sin territorio asignado</span>' : ''}</div>
        <div class="acts">
          ${r.publica ? '' : `<button class="btn sm" data-pubprog="${t}|${d.k}" title="Agregar Predicación pública a este día">📢 Predicación pública</button>`}
          ${hecho ? `<span class="ok">✓ Manzanas registradas como visitadas</span>` : `<button class="btn sm" data-asigprog="${t}|${d.k}">📍 Asignar en mapa</button>
          <button class="btn sm" data-visprog="${t}|${d.k}" ${r.mz.length ? '' : 'disabled'}>✓ Visitadas</button>
          <button class="btn sm dan" data-novisprog="${t}|${d.k}" ${r.mz.length ? '' : 'disabled'}>✗ No visitadas</button>`}
        </div>
      </td></tr>`;
  }).join('');
  $('#progHoja').innerHTML = `
    <div class="ph">
      <div><h2>${cfg.titulo}</h2><div class="sub">${subtituloProg(t)}</div></div>
      <label class="f" style="margin:0">${t === 'semanal' ? 'Martes de la semana' : 'Domingo'}<input type="date" id="progFecha" value="${t === 'semanal' ? pr.martes : pr.fecha}"></label>
    </div>
    <table class="prog ${t}"><thead><tr><th style="width:21%">Día</th><th style="width:24%">Punto de encuentro</th><th style="width:20%">Capitán</th><th>Territorio</th></tr></thead><tbody>${filas}</tbody></table>
    <div class="pacts">
      <button class="btn pri" data-pdf="share">📤 Enviar por WhatsApp (PDF)</button>
      <button class="btn" data-pdf="descargar">⬇️ Descargar PDF</button>
      <button class="btn dan" id="progLimpiar" style="margin-left:auto">🧹 ${t === 'semanal' ? 'Nueva semana' : 'Nuevo domingo'}</button>
    </div>
    <p class="hint">${t === 'semanal' ? 'El programa se guarda en este dispositivo. Los lunes usa “Nueva semana” para limpiarlo y empezar el siguiente.' : 'El programa se guarda en este dispositivo. Usa “Nuevo domingo” para limpiarlo y preparar el siguiente.'}</p>`;
  if (new Date().getDay() === 1 && t === 'semanal') $('#progLimpiar').classList.add('pulse');
}

function initProg() {
  document.querySelectorAll('#progTabs button').forEach(b => b.onclick = () => { S.progTab = b.dataset.p; renderProg(); });
  const hoja = $('#progHoja');
  hoja.addEventListener('change', e => {
    const el = e.target, t = S.progTab;
    if (el.id === 'progFecha') {
      if (!el.value) return;
      if (t === 'semanal') { P.semanal.martes = martesDe(el.value); if (P.semanal.martes !== el.value) toast('Se ajustó al martes de esa semana'); }
      else { P.domingo.fecha = domingoDe(el.value); if (P.domingo.fecha !== el.value) toast('Se ajustó al domingo siguiente'); }
      guardarProg(); renderProg(); return;
    }
    const campo = el.dataset.campo; if (!campo) return;
    if (campo === 'capitanDom') { P.domingo.capitan = el.value.trim(); recordarNombre('capitanes', P.domingo.capitan); }
    else {
      const r = filaDe(t, el.dataset.k); r[campo] = el.value.trim();
      if (campo === 'encuentro') recordarNombre('encuentros', r.encuentro);
      if (campo === 'capitan') recordarNombre('capitanes', r.capitan);
    }
    guardarProg();
  });
  hoja.addEventListener('click', async e => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.quitarprog) { const [t, k, id] = b.dataset.quitarprog.split('|'); const r = filaDe(t, k); r.mz = r.mz.filter(x => x !== id); guardarProg(); renderProg(); pintarBordes(); return; }
    if (b.dataset.pubprog) { const [t, k] = b.dataset.pubprog.split('|'); const r = filaDe(t, k); r.publica = !r.publica; guardarProg(); renderProg(); return; }
    if (b.dataset.asigprog) { const [t, k] = b.dataset.asigprog.split('|'); ir('mapa'); setAsignar({ tipo: t, k }); return; }
    if (b.dataset.visprog) {
      const [t, k] = b.dataset.visprog.split('|'), r = filaDe(t, k), d = filaDef(t, k), f = fechaFila(t, k);
      if (f > hoy() && !confirm(`${d.d} (${fmtF(f)}) todavía no llega. ¿Registrar las manzanas como visitadas de todos modos?`)) return;
      if (!confirm(`¿Registrar ${r.mz.length} manzana(s) como visitadas el ${fmtF(f)}?\n${r.mz.join(', ')}`)) return;
      const quien = t === 'semanal' ? r.capitan : P.domingo.capitan;
      if (await registrar(f, r.mz.slice(), quien, `${PROG[t].titulo} · ${d.d}`)) { r.estado = 'visitadas'; guardarProg(); renderProg(); }
      return;
    }
    if (b.dataset.novisprog) {
      const [t, k] = b.dataset.novisprog.split('|'), r = filaDe(t, k);
      if (!confirm(`¿Marcar como NO visitadas? Se quitarán ${r.mz.join(', ')} de ${filaDef(t, k).d} para que puedas asignarlas otro día.`)) return;
      r.mz = []; r.estado = ''; guardarProg(); renderProg(); pintarBordes(); toast('Manzanas liberadas para asignarse otro día');
      return;
    }
    if (b.id === 'progLimpiar') {
      const t = S.progTab;
      if (!confirm(t === 'semanal' ? '¿Limpiar el programa y preparar la nueva semana? Se borrarán puntos de encuentro, capitanes y territorios.' : '¿Limpiar el programa y preparar el siguiente domingo?')) return;
      const d = parseF(hoy()), w = d.getDay();
      P[t] = t === 'semanal' ? progVacio('semanal', sumarDias(hoy(), w === 1 ? 1 : (2 - w + 7) % 7)) : progVacio('domingo', sumarDias(hoy(), w === 0 ? 7 : 0));
      guardarProg(); renderProg(); pintarBordes(); toast('Programa listo para llenarse');
      return;
    }
    if (b.dataset.pdf) { await enviarPDF(S.progTab, b.dataset.pdf); }
  });
}

/* ================= PDF ================= */
function notasDe(tipo) { const asig = asignadas(tipo); return S.notas.filter(n => asig.has(n.manzana)).sort((a, b) => natural(a.manzana, b.manzana) || a.codigo.localeCompare(b.codigo, 'es', { numeric: true })); }

function mapaCanvas(tipo) {
  const asig = asignadas(tipo), ns = notasDe(tipo);
  // encuadre: manzanas asignadas con margen; si no hay, toda la colonia
  let pts = [];
  (asig.size ? [...asig.keys()] : MZ.map(m => m.id)).forEach(id => pts.push(...MZ_BY_ID[id].ring));
  let x0 = Math.min(...pts.map(p => p[0])), x1 = Math.max(...pts.map(p => p[0])), y0 = Math.min(...pts.map(p => p[1])), y1 = Math.max(...pts.map(p => p[1]));
  const pad = Math.max(40, 0.12 * Math.max(x1 - x0, y1 - y0)); x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
  const W = 1800, Hmax = 1150; let s = W / (x1 - x0); let H = (y1 - y0) * s;
  if (H > Hmax) { s = Hmax / (y1 - y0); H = Hmax; }
  const ox = (W - (x1 - x0) * s) / 2;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = Math.round(H);
  const g = cv.getContext('2d');
  const P2 = p => [ox + (p[0] - x0) * s, (y1 - p[1]) * s];
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  const poly = (ring, fill, stroke, lw) => { g.beginPath(); ring.forEach((p, i) => { const [x, y] = P2(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.closePath(); g.fillStyle = fill; g.fill(); g.strokeStyle = stroke; g.lineWidth = lw; g.stroke(); };
  MZ.forEach(m => poly(m.ring, '#e4e4e4', '#9a9a9a', 1.5));
  window.MAPA.lugares.features.forEach(f => poly(f.geometry.coordinates[0].map(xy), COL_LUGAR[f.properties.tipo] || '#ccc', '#777', 1.5));
  asig.forEach((k, id) => { const d = filaDef(tipo, k); poly(MZ_BY_ID[id].ring, d.c + '40', d.c, 6); });
  // calles
  g.fillStyle = '#555'; g.textAlign = 'center'; g.textBaseline = 'middle';
  window.MAPA.calles.features.forEach(f => {
    const fs = f.properties.alto_m * s * 1.25; if (fs < 13) return;
    const [x, y] = P2(xy(f.geometry.coordinates)); if (x < 0 || y < 0 || x > W || y > H) return;
    g.save(); g.translate(x, y); g.rotate(-f.properties.angulo * Math.PI / 180); g.font = `italic 600 ${fs}px system-ui, sans-serif`; g.fillText(f.properties.nombre, 0, 0); g.restore();
  });
  // códigos de manzana
  MZ.forEach(m => {
    const c = m.ring.reduce((a, p) => [a[0] + p[0], a[1] + p[1]], [0, 0]).map(v => v / m.ring.length);
    const [x, y] = P2(c); if (x < 0 || y < 0 || x > W || y > H) return;
    const fs = Math.max(20, Math.min(52, 13 * s)); const a = asig.has(m.id);
    g.font = `${a ? 800 : 600} ${fs}px system-ui, sans-serif`;
    g.lineWidth = 5; g.strokeStyle = '#fff'; g.strokeText(m.codigo, x, y);
    g.fillStyle = a ? '#000' : '#666'; g.fillText(m.codigo, x, y);
    if (a) { const d = filaDef(tipo, asig.get(m.id)); const tw = g.measureText(d.ab).width + 16; g.fillStyle = d.c; g.fillRect(x - tw / 2, y + fs * .7, tw, fs * 1.05); g.fillStyle = '#fff'; g.font = `700 ${fs * .75}px system-ui, sans-serif`; g.fillText(d.ab, x, y + fs * 1.22); }
  });
  // notas
  ns.forEach(n => {
    const [x, y] = P2(xy([+n.lng, +n.lat])); const col = n.tipo === 'casa' ? '#c62f2f' : '#2a78d6';
    g.font = '700 22px system-ui, sans-serif'; const tw = g.measureText(n.codigo).width + 18;
    g.fillStyle = '#fff'; g.strokeStyle = col; g.lineWidth = 4;
    g.beginPath(); g.roundRect ? g.roundRect(x - tw / 2, y - 16, tw, 32, 16) : g.rect(x - tw / 2, y - 16, tw, 32); g.fill(); g.stroke();
    g.fillStyle = col; g.fillText(n.codigo, x, y + 1);
  });
  return { url: cv.toDataURL('image/png'), w: W, h: H };
}

async function construirPDF(tipo) {
  if (!window.jspdf) throw new Error('No se pudo cargar el generador de PDF (revisa tu conexión).');
  const { jsPDF } = window.jspdf, cfg = PROG[tipo], pr = P[tipo];
  const doc = new jsPDF({ unit: 'mm', format: 'letter' }), W = doc.internal.pageSize.getWidth(), M = 14;
  // ---- Hoja 1: formato
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.text(cfg.titulo, W / 2, 22, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.text(subtituloProg(tipo), W / 2, 30, { align: 'center' });
  const body = cfg.filas.map((d, i) => {
    const r = filaDe(tipo, d.k), f = fechaFila(tipo, d.k);
    const dia = tipo === 'semanal' ? `${d.d}\n${fmtCorta(f)}\n${hora(r.hora)}` : `${d.d}\n${hora(r.hora)}`;
    const row = [{ content: dia, styles: { fontStyle: 'bold' } }, r.encuentro || ''];
    if (tipo === 'semanal') row.push(r.capitan || '');
    else if (i === 0) row.push({ content: pr.capitan || '', rowSpan: 3, styles: { valign: 'middle', halign: 'center' } });
    row.push([r.publica ? 'Predicación pública' : '', r.mz.join(', ')].filter(Boolean).join('\n'));
    return row;
  });
  doc.autoTable({
    startY: 38, margin: { left: M, right: M }, head: [['Día', 'Punto de encuentro', 'Capitán', 'Territorio']], body,
    theme: 'grid', styles: { fontSize: 11, cellPadding: 3.2, valign: 'middle', lineColor: [120, 120, 120], lineWidth: .25, minCellHeight: tipo === 'semanal' ? 26 : 40, textColor: [20, 20, 20] },
    headStyles: { fillColor: [40, 40, 40], textColor: 255, fontStyle: 'bold', halign: 'center', minCellHeight: 10 },
    columnStyles: { 0: { cellWidth: 38 }, 1: { cellWidth: 50 }, 2: { cellWidth: 40 } },
    didDrawCell: dc => { if (dc.section === 'body' && dc.column.index === 0) { const c = cfg.filas[dc.row.index].c; doc.setFillColor(c); doc.rect(dc.cell.x, dc.cell.y, 2.2, dc.cell.height, 'F'); } }
  });
  doc.setFontSize(8.5); doc.setTextColor(120); doc.text(`Generado el ${fmtF(hoy())} · Las notas y el mapa de los territorios asignados están en la hoja 2.`, M, doc.internal.pageSize.getHeight() - 10); doc.setTextColor(0);

  // ---- Hoja 2: mapa pequeño + notas
  doc.addPage();
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.text('Territorios asignados: mapa y notas', M, 18);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.text(`${cfg.titulo} · ${subtituloProg(tipo)}`, M, 24);
  const img = mapaCanvas(tipo), iw = W - 2 * M, ih = Math.min(115, iw * img.h / img.w), iw2 = ih * img.w / img.h;
  doc.addImage(img.url, 'PNG', M + (iw - iw2) / 2, 28, iw2, ih); doc.setDrawColor(180); doc.rect(M + (iw - iw2) / 2, 28, iw2, ih);
  let y = 28 + ih + 6, x = M; doc.setFontSize(9);
  cfg.filas.forEach(d => { const r = filaDe(tipo, d.k); if (!r.mz.length) return; const t = `${d.d}: ${r.mz.join(', ')}`; const w = doc.getTextWidth(t) + 9; if (x + w > W - M) { x = M; y += 5.5; } doc.setFillColor(d.c); doc.rect(x, y - 3, 3.5, 3.5, 'F'); doc.text(t, x + 5, y); x += w; });
  y += 7;
  const casas = notasDe(tipo).filter(n => n.tipo === 'casa'), notas = notasDe(tipo).filter(n => n.tipo === 'nota');
  const tabla = (titulo, head, rows, widths) => {
    if (y > 250) { doc.addPage(); y = 18; }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.text(titulo, M, y); doc.setFont('helvetica', 'normal');
    doc.autoTable({ startY: y + 2.5, margin: { left: M, right: M, top: 16 }, head: [head], body: rows, theme: 'grid', styles: { fontSize: 8.5, cellPadding: 1.8, valign: 'top', lineColor: [170, 170, 170], lineWidth: .2 }, headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' }, columnStyles: widths });
    y = doc.lastAutoTable.finalY + 8;
  };
  if (!casas.length && !notas.length) { doc.setFontSize(11); doc.text('No hay casas marcadas ni notas en las manzanas asignadas.', M, y); }
  if (casas.length) tabla(`Casas marcadas (${casas.length})`, ['Código', 'Manzana', 'Dirección', 'Casa y referencias', 'Habitante y lo que dijo', 'Nota', 'Autor'],
    casas.map(n => [n.codigo, n.manzana, n.direccion, [n.casa, n.referencias && 'Ref.: ' + n.referencias].filter(Boolean).join('\n'), [n.habitante, n.dijo && 'Dijo: ' + n.dijo].filter(Boolean).join('\n'), n.texto, n.autor]),
    { 0: { cellWidth: 14, fontStyle: 'bold' }, 1: { cellWidth: 16 }, 2: { cellWidth: 30 }, 3: { cellWidth: 38 }, 4: { cellWidth: 40 }, 5: { cellWidth: 29 }, 6: { cellWidth: 20.9 } });
  if (notas.length) tabla(`Notas (${notas.length})`, ['Código', 'Manzana', 'Dirección o referencia', 'Nota', 'Autor'],
    notas.map(n => [n.codigo, n.manzana, n.direccion, n.texto, n.autor]),
    { 0: { cellWidth: 14, fontStyle: 'bold' }, 1: { cellWidth: 16 }, 2: { cellWidth: 45 }, 3: { cellWidth: 92.9 }, 4: { cellWidth: 20 } });
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) { doc.setPage(i); doc.setFontSize(8.5); doc.setTextColor(120); doc.text(`Hoja ${i} de ${total}`, W - M, doc.internal.pageSize.getHeight() - 10, { align: 'right' }); doc.setTextColor(0); }
  return doc;
}

async function enviarPDF(tipo, modo) {
  const sinMz = PROG[tipo].filas.every(d => !filaDe(tipo, d.k).mz.length && !filaDe(tipo, d.k).publica);
  if (sinMz && !confirm('No hay territorios asignados. ¿Generar el PDF de todos modos?')) return;
  let doc;
  try { doc = await construirPDF(tipo); } catch (e) { toast(e.message, 5000); return; }
  const nombre = `${tipo === 'semanal' ? 'Programa_Semanal_' + P.semanal.martes : 'Programa_Grupos_' + P.domingo.fecha}.pdf`;
  const blob = doc.output('blob'), file = new File([blob], nombre, { type: 'application/pdf' });
  if (modo === 'share' && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: PROG[tipo].titulo, text: `${PROG[tipo].titulo} · ${subtituloProg(tipo)}` }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nombre; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  if (modo === 'share') { window.open('https://web.whatsapp.com/', '_blank'); toast('PDF descargado. En WhatsApp Web adjúntalo con el clip 📎', 6000); }
  else toast('PDF descargado');
}

/* ================= Gráficas (SVG ligero) ================= */
const tip = document.createElement('div'); tip.className = 'tip hidden'; document.body.appendChild(tip);
document.addEventListener('mousemove', e => { const t = e.target.closest && e.target.closest('[data-tip]'); if (t) { tip.textContent = t.dataset.tip; tip.classList.remove('hidden'); tip.style.left = e.clientX + 12 + 'px'; tip.style.top = e.clientY - 30 + 'px'; } else tip.classList.add('hidden'); });

function barras(labels, values, color, unidad) {
  const W = 520, H = 190, pl = 30, pb = 24, pt = 10, max = Math.max(1, ...values);
  const paso = niceStep(max), top = Math.ceil(max / paso) * paso;
  const bw = (W - pl) / labels.length, gap = Math.min(12, bw * .3);
  let g = '';
  for (let v = 0; v <= top; v += paso) { const y = pt + (H - pt - pb) * (1 - v / top); g += `<g class="g"><line x1="${pl}" x2="${W}" y1="${y}" y2="${y}"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end">${v}</text></g>`; }
  const bars = values.map((v, i) => {
    const h = (H - pt - pb) * v / top, x = pl + i * bw + gap / 2, y = H - pb - h, w = bw - gap;
    const r = Math.min(4, w / 2, h);
    const path = h > 0 ? `M${x},${H - pb}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${H - pb}Z` : '';
    return `<path class="m" d="${path}" fill="${color}"/><rect x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}" fill="transparent" data-tip="${esc(labels[i])}: ${v} ${unidad}"/>${labels.length > 8 && i % 2 ? '' : `<text x="${pl + i * bw + bw / 2}" y="${H - 6}" text-anchor="middle">${esc(labels[i])}</text>`}`;
  }).join('');
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img">${g}${bars}</svg>`;
}
function niceStep(max) { const r = max / 4, p = Math.pow(10, Math.floor(Math.log10(r))); return [1, 2, 5, 10].map(m => m * p).find(s => s >= r) || p * 10; }

/* ================= Dashboard ================= */
function renderDash() {
  const c = cicloActual() || ultimoCiclo(), d = $('#dash');
  if (!c) { d.innerHTML = `<div class="card"><h2>Aún no hay visitas</h2><p class="hint">Registra la primera visita para iniciar el ciclo 1 y ver el avance.</p></div>`; return; }
  const col = colorCiclo(c.n), vis = visitadasCiclo(c.n), n = vis.size, falt = TOTAL - n, pct = n / TOTAL * 100;
  const dias = diasCiclo(c);
  const ritmo = dias >= 7 ? n / (dias / 7) : null;
  const eta = !c.fin && ritmo > 0 && falt > 0 ? sumarDias(hoy(), Math.ceil(falt / ritmo * 7)) : null;
  const vc = visitasCiclo(c.n);
  const porDia = [2, 3, 4, 5, 6, 0, 1].map(k => vc.filter(v => parseF(v.fecha).getDay() === k).length);
  const sem = []; const lunes = parseF(hoy()); lunes.setDate(lunes.getDate() - ((lunes.getDay() + 6) % 7));
  for (let i = 11; i >= 0; i--) { const a = new Date(lunes); a.setDate(a.getDate() - 7 * i); const b = new Date(a); b.setDate(b.getDate() + 7); sem.push({ l: a.toLocaleDateString('es-MX', { day: 'numeric', month: 'short' }), v: S.visitas.filter(v => { const f = parseF(v.fecha); return f >= a && f < b; }).length }); }
  const ult = ultimaVisita();
  const viejas = MZ.filter(m => !vis.has(m.id)).map(m => ({ id: m.id, f: ult.get(m.id) })).sort((a, b) => (a.f || '').localeCompare(b.f || '') || natural(a.id, b.id)).slice(0, 10);
  const faltan = IDS_ORDEN.filter(id => !vis.has(id));
  const ciclos = S.ciclos.slice().sort((a, b) => num(b) - num(a));
  const nCasas = S.notas.filter(x => x.tipo === 'casa').length, nNotas = S.notas.filter(x => x.tipo === 'nota').length;

  d.innerHTML = `
  <div class="kpis">
    <div class="kpi"><span>Ciclo ${c.fin ? '(cerrado)' : 'actual'}</span><b style="display:flex;align-items:center;gap:8px"><span class="sw" style="background:${col};width:18px;height:18px"></span>${esc(c.n)}</b><small>${fmtF(c.inicio)} – ${c.fin ? fmtF(c.fin) : 'en curso'}</small></div>
    <div class="kpi"><span>Avance</span><b>${pct.toFixed(1)}%</b><div class="bar" style="width:100%;margin-top:6px"><i style="width:${pct}%;background:${col}"></i></div></div>
    <div class="kpi"><span>Manzanas visitadas</span><b>${n}<small> / ${TOTAL}</small></b><small>${falt} faltantes</small></div>
    <div class="kpi"><span>Días del ciclo</span><b>${dias}</b><small>${vc.length} visitas registradas</small></div>
    <div class="kpi"><span>Ritmo</span><b>${ritmo === null ? '—' : ritmo.toFixed(1)}</b><small>${ritmo === null ? 'se calcula después de 7 días' : 'manzanas nuevas / semana'}</small></div>
    <div class="kpi"><span>Término estimado</span><b style="font-size:20px">${c.fin ? fmtF(c.fin) : eta ? fmtF(eta) : '—'}</b><small>${c.fin ? esc(c.motivo) : 'al ritmo actual'}</small></div>
  </div>
  <div class="grid2">
    <div class="card"><h2>Visitas por día de la semana <small>· ciclo ${esc(c.n)}</small></h2>${barras(['Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom', 'Lun'], porDia, col, 'visitas')}</div>
    <div class="card"><h2>Visitas por semana <small>· últimas 12</small></h2>${barras(sem.map(s => s.l), sem.map(s => s.v), col, 'visitas')}</div>
    <div class="card"><h2>Más tiempo sin visitar <small>· pendientes del ciclo</small></h2>
      ${viejas.length ? `<table><tr><th>Manzana</th><th>Última visita</th><th class="num">Días</th></tr>${viejas.map(x => `<tr><td><b>${esc(x.id)}</b></td><td>${x.f ? fmtF(x.f) : 'Nunca'}</td><td class="num">${x.f ? diasEntre(x.f, hoy()) : '—'}</td></tr>`).join('')}</table>` : '<span class="hint">¡Todas visitadas!</span>'}
    </div>
  </div>
  <div class="card"><h2>Manzanas faltantes <small>· ${falt}</small></h2>
    <div class="codes">${faltan.map(i => `<span>${esc(i)}</span>`).join('') || '<span class="hint" style="background:none">¡Todas visitadas! ✓</span>'}</div>
  </div>
  <div class="card"><h2>Ciclos</h2>
    <div class="tablewrap"><table><tr><th>Ciclo</th><th>Inicio</th><th>Cierre</th><th class="num">Días</th><th class="num">Manzanas</th><th>Motivo</th></tr>
    ${ciclos.map(x => `<tr><td><span class="sw" style="background:${colorCiclo(x.n)}"></span> ${esc(x.n)}</td><td>${fmtF(x.inicio)}</td><td>${x.fin ? fmtF(x.fin) : 'En curso'}</td><td class="num">${diasCiclo(x)}</td><td class="num">${visitadasCiclo(x.n).size}/${TOTAL}</td><td>${esc(x.motivo || '')}</td></tr>`).join('')}</table></div>
    <p class="hint">Los días cuentan el día de inicio y el de cierre.</p>
    ${!c.fin ? `<div style="margin-top:10px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><button class="btn dan" id="bCerrar">Cerrar ciclo ${esc(c.n)} ahora</button><span class="hint">Úsalo si das por terminado el territorio aunque falten manzanas. Al 100% se cierra solo.</span></div>` : ''}
  </div>
  <div class="card"><h2>Casas marcadas y notas</h2><span class="hint">🚫 ${nCasas} casa(s) marcada(s) · 📝 ${nNotas} nota(s)</span></div>
  <div style="text-align:center;margin:20px 0"><button class="btn sm" id="bSalir">Cerrar sesión</button></div>`;

  const bc = $('#bCerrar');
  if (bc) bc.onclick = async () => {
    if (!confirm(`¿Cerrar el ciclo ${c.n}? Faltan ${falt} manzanas. Empezará el ciclo ${num(c) + 1} con un color nuevo y todas las manzanas volverán a gris.`)) return;
    try { await cerrarCiclo(c, hoy(), `manual (faltaron ${falt})`); renderTodo(); toast(`Ciclo ${c.n} cerrado. Inicia el ciclo ${num(c) + 1}.`); } catch (e) { toast(e.message); }
  };
  $('#bSalir').onclick = () => { salir(); };
}

/* ================= Historial ================= */
function tablaVisitas(rows, borrar = true, conHora = false) {
  return `<table><tr><th>Fecha</th>${conHora ? '<th>Guardado</th>' : ''}<th>Manzana</th><th>Ciclo</th><th>Quién</th><th>Comentario</th>${borrar ? '<th></th>' : ''}</tr>` +
    rows.map(v => `<tr><td>${fmtF(v.fecha)}</td>${conHora ? `<td>${esc(String(v.registrado || '').slice(11, 16))}</td>` : ''}<td><b>${esc(v.manzana)}</b></td><td><span class="sw" style="background:${colorCiclo(v.ciclo)}"></span> ${esc(v.ciclo)}</td><td>${esc(v.quien)}</td><td>${esc(v.comentario)}</td>${borrar ? `<td><button class="btn sm dan" data-delv="${esc(v.id)}" title="Eliminar registro">✕</button></td>` : ''}</tr>`).join('') + '</table>';
}

function filtrarHist() {
  const q = $('#hTxt').value.trim().toUpperCase(), c = $('#hCiclo').value, a = $('#hDesde').value, b = $('#hHasta').value;
  return S.visitas.filter(v => (!q || v.manzana.toUpperCase().includes(q) || v.codigo.toUpperCase() === q || (v.quien || '').toUpperCase().includes(q))
    && (!c || String(v.ciclo) === c) && (!a || v.fecha >= a) && (!b || v.fecha <= b))
    .sort((x, y) => y.fecha.localeCompare(x.fecha) || natural(x.manzana, y.manzana));
}

function renderHist() {
  const sel = $('#hCiclo'), val = sel.value;
  sel.innerHTML = '<option value="">Todos</option>' + S.ciclos.slice().sort((a, b) => num(b) - num(a)).map(c => `<option value="${esc(c.n)}">Ciclo ${esc(c.n)}</option>`).join('');
  sel.value = val;
  const rows = filtrarHist();
  $('#hCount').textContent = `${rows.length} registro(s)`;
  $('#hTabla').innerHTML = rows.length ? tablaVisitas(rows.slice(0, 500)) + (rows.length > 500 ? '<p class="hint">Mostrando 500; usa los filtros o exporta a CSV.</p>' : '') : '<span class="hint">Sin registros.</span>';
  const ft = $('#nFiltro').value;
  const ns = S.notas.filter(n => !ft || n.tipo === ft).sort((a, b) => a.tipo.localeCompare(b.tipo) || a.codigo.localeCompare(b.codigo, 'es', { numeric: true }));
  const det = n => n.tipo === 'casa' ? [n.casa, n.habitante && 'Habitante: ' + n.habitante, n.dijo && 'Dijo: ' + n.dijo, n.texto].filter(Boolean).join(' · ') : n.texto;
  $('#nTabla').innerHTML = ns.length ? `<table><tr><th>Código</th><th>Manzana</th><th>Dirección</th><th>Detalle</th><th>Fecha</th><th></th></tr>${ns.map(n => `<tr><td><b>${TIPOS[n.tipo].e} ${esc(n.codigo)}</b></td><td>${esc(n.manzana)}</td><td>${esc(n.direccion)}</td><td>${esc(det(n))}</td><td>${fmtF(n.fecha)}</td><td style="white-space:nowrap"><button class="btn sm" data-vernota="${esc(n.id)}">Ver</button> <button class="btn sm" data-editnota="${esc(n.id)}">Editar</button></td></tr>`).join('')}</table>` : '<span class="hint">Sin casas marcadas ni notas. Usa “＋ Nota” en el mapa.</span>';
}

function initHist() {
  ['#hTxt', '#hCiclo', '#hDesde', '#hHasta', '#nFiltro'].forEach(s => $(s).addEventListener('input', renderHist));
  $('#hCSV').onclick = () => {
    const rows = filtrarHist(), cols = ['fecha', 'manzana', 'codigo', 'ciclo', 'quien', 'comentario', 'registrado'];
    const csv = '﻿' + [cols.join(','), ...rows.map(r => cols.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(','))].join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `visitas_${hoy()}.csv`; a.click();
  };
  document.addEventListener('click', async e => {
    const d = e.target.closest('[data-delv]');
    if (d) {
      const v = S.visitas.find(x => x.id === d.dataset.delv); if (!v) return;
      if (!confirm(`¿Eliminar la visita de ${v.manzana} del ${fmtF(v.fecha)}?`)) return;
      try { await api('deleteVisita', { id: v.id }); S.visitas = S.visitas.filter(x => x.id !== v.id); renderTodo(); toast('Registro eliminado'); } catch (ex) { toast(ex.message); }
    }
    const vn = e.target.closest('[data-vernota]');
    if (vn) { const n = S.notas.find(x => x.id === vn.dataset.vernota); ir('mapa'); setTimeout(() => { map.setView([+n.lat, +n.lng], map.getMaxZoom()); marcadorNota[n.id] && marcadorNota[n.id].openPopup(); }, 120); }
  });
}

/* ================= Navegación ================= */
function ir(v) {
  document.querySelectorAll('.view').forEach(x => x.classList.toggle('on', x.id === 'v-' + v));
  document.querySelectorAll('nav button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  if (v === 'mapa') setTimeout(() => map.invalidateSize(), 50);
  if (v === 'registro') renderRegistro();
  if (v === 'prog') renderProg();
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => ir(b.dataset.v));

/* ================= Inicio ================= */
if (DEMO) { document.body.classList.add('demo'); $('#demo').classList.remove('hidden'); $('#loginForm p').innerHTML += '<br><b>Modo demo:</b> cualquier contraseña entra.'; }
initMapa(); initRegistro(); initProg(); initHist();
S.token = LS.getItem('territorio_token') || sessionStorage.getItem('territorio_token');
if (S.token) { $('#login').classList.add('hidden'); cargar(); } else { renderTodo(); }
})();
