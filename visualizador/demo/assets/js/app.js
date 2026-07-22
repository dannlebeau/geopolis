// ── TOKENS DE ACCESO ─────────────────────────────────────────────────────────
// Cada token mapea a un cliente. comunas:null = acceso total (modo demo).
// comunas: array de {region, provincia, comuna} para acceso restringido.
//
// NOTA: esto es seguridad de demo (client-side). Para producción usar backend.

const ACCESS_TOKENS = {
  'demo01': {
    nombre: 'Modo Demo',
    comunas: [{ region: 'Arica y Parinacota', provincia: 'Arica', comuna: 'Arica' }]
  },
};

// ── CONSTANTS ──────────────────────────────────────────────────────────────

// Tipo de vegetación → riesgo de combustibilidad
const VEG = {
  forest:    { label: 'Plantación forestal', color: '#cc1100', risk: 'muy-alto', riskLabel: 'Muy alto',
               note: 'Pino/eucalipto: alta carga combustible, propagación rápida' },
  wood:      { label: 'Bosque nativo',       color: '#ff4400', risk: 'alto',     riskLabel: 'Alto',
               note: 'Mayor humedad, pero difícil acceso para combate' },
  scrub:     { label: 'Matorral',            color: '#ff8800', risk: 'medio',    riskLabel: 'Medio',
               note: 'Combustión intensa en períodos secos' },
  heath:     { label: 'Brezal / pradera',    color: '#ffaa00', risk: 'medio',    riskLabel: 'Medio',
               note: 'Propagación rápida en viento' },
  grassland: { label: 'Pastizal',            color: '#ffcc00', risk: 'bajo',     riskLabel: 'Bajo',
               note: 'Riesgo estacional, seco en verano' },
  grass:     { label: 'Área verde urbana',   color: '#88cc00', risk: 'bajo',     riskLabel: 'Bajo',
               note: 'Mantenimiento reduce riesgo' },
  vineyard:  { label: 'Viñedo / huerto',     color: '#cc8800', risk: 'medio',    riskLabel: 'Medio',
               note: 'Riesgo varía según estado del cultivo' },
  orchard:   { label: 'Huerto frutal',       color: '#aa7700', risk: 'bajo',     riskLabel: 'Bajo',
               note: 'Irrigación frecuente reduce riesgo' },
};

// Clasificación de calles por accesibilidad vehicular de emergencia
const STREET = {
  low: {
    label: 'Acceso amplio',
    sub: 'Vía principal / arterial — libre paso',
    color: '#27ae60',
    highways: new Set(['motorway','trunk','primary','secondary','tertiary'])
  },
  medium: {
    label: 'Acceso medio',
    sub: 'Calle residencial — paso con precaución',
    color: '#f39c12',
    highways: new Set(['residential','unclassified','road'])
  },
  high: {
    label: 'Acceso estrecho',
    sub: 'Servicio / callejón — riesgo si hay autos estacionados',
    color: '#e74c3c',
    highways: new Set(['service','track','living_street'])
  },
  critical: {
    label: 'Sin acceso vehicular',
    sub: 'Pasaje peatonal / escalera — inaccesible para carros bomba',
    color: '#8b1a1a',
    highways: new Set(['path','footway','cycleway','pedestrian','steps','alley'])
  },
};

const OVERPASS  = 'https://overpass-api.de/api/interpreter';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';

// Radios de cobertura para visualización
const STATION_RADIUS_FOREST = [5000, 10000, 15000]; // metros (forestal)
const STATION_RADIUS_URBAN  = [1000, 3000, 5000];   // metros (urbano)
const HYDRANT_RADIUS        = 150;                  // metros

// ── STATE ───────────────────────────────────────────────────────────────────

let chileData    = null;
let currentMode  = 'forestal';
let currentBbox  = null; // {s, w, n, e}
let currentComuna = null;

// Forestal
let vegFeatures      = [];
let forestStations   = [];
let forestLoaded     = false;

// Urbano
let hydrants         = [];
let streets          = [];
let urbanStations    = [];
let urbanoLoaded     = false;

// Leaflet layers
let vegLayer         = null;
let forestStationLayer = null;
let hydrantLayer     = null;
let hydrantCovLayer  = null;
let streetLayer      = null;
let urbanStationLayer = null;

// ── MAP + PANES ──────────────────────────────────────────────────────────────

const cartoLight = L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
  { attribution: '© OpenStreetMap © CARTO', maxZoom: 19 }
);
const osmLayer = L.tileLayer(
  'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
  { attribution: '© OpenStreetMap contributors', maxZoom: 19 }
);
const satellite = L.tileLayer(
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  { attribution: '© Esri', maxZoom: 18 }
);
const cartoDark = L.tileLayer(
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
  { attribution: '© OpenStreetMap © CARTO', maxZoom: 19 }
);

const map = L.map('map', {
  center: [-35.5, -71.0],
  zoom: 6,
  layers: [cartoLight]
});

map.createPane('veg');      map.getPane('veg').style.zIndex      = 380;
map.createPane('coverage'); map.getPane('coverage').style.zIndex = 400;
map.createPane('streets');  map.getPane('streets').style.zIndex  = 430;
map.createPane('hydrants'); map.getPane('hydrants').style.zIndex = 460;
map.createPane('stations'); map.getPane('stations').style.zIndex = 490;

L.control.layers({
  '☀️ Mapa claro':    cartoLight,
  '🗺 OpenStreetMap': osmLayer,
  '🛰 Satélite':      satellite,
  '🌙 Mapa oscuro':   cartoDark
}, null, { position: 'topright', collapsed: true }).addTo(map);

// ── ADMIN DATA ───────────────────────────────────────────────────────────────

async function loadAdminData(access) {
  try {
    const res = await fetch('data/chile.json');
    chileData = await res.json();

    // Si el acceso es restringido, filtrar la jerarquía
    const data = access.comunas ? filterChileData(chileData, access.comunas) : chileData;

    const sel = document.getElementById('regSelect');
    data.regiones.forEach(r => {
      const opt = document.createElement('option');
      opt.value = r.nombre;
      opt.textContent = `${r.numero} — ${r.nombre}`;
      sel.appendChild(opt);
    });

    // Si solo hay una comuna permitida, auto-seleccionarla
    if (access.comunas?.length === 1) {
      autoSelectComuna(access.comunas[0], data);
    }
  } catch (e) {
    setStatus('Error al cargar datos administrativos', 'error');
  }
}

function filterChileData(data, allowed) {
  const set = new Set(allowed.map(a => `${a.region}|${a.provincia}|${a.comuna}`));
  return {
    regiones: data.regiones
      .map(r => ({
        ...r,
        provincias: r.provincias
          .map(p => ({
            ...p,
            comunas: p.comunas.filter(c => set.has(`${r.nombre}|${p.nombre}|${c}`))
          }))
          .filter(p => p.comunas.length > 0)
      }))
      .filter(r => r.provincias.length > 0)
  };
}

function autoSelectComuna(entry, data) {
  const regSel  = document.getElementById('regSelect');
  const provSel = document.getElementById('provSelect');
  const comSel  = document.getElementById('comunaSelect');

  // Poblar y seleccionar región
  regSel.value = entry.region;
  const region = data.regiones.find(r => r.nombre === entry.region);
  if (!region) return;

  provSel.innerHTML = '<option value="">— Selecciona provincia —</option>';
  region.provincias.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.nombre; opt.textContent = p.nombre;
    provSel.appendChild(opt);
  });

  // Seleccionar provincia
  provSel.value = entry.provincia;
  const prov = region.provincias.find(p => p.nombre === entry.provincia);
  if (!prov) return;

  comSel.innerHTML = '<option value="">— Selecciona comuna —</option>';
  prov.comunas.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    comSel.appendChild(opt);
  });

  // Seleccionar comuna y bloquear dropdowns
  comSel.value  = entry.comuna;
  currentComuna = entry.comuna;
  [regSel, provSel, comSel].forEach(s => {
    s.disabled = true;
    s.style.opacity = '0.6';
    s.title = 'Acceso configurado por token';
  });

  provSel.disabled = false; // habilitar para el change listener que ya no se usa
  provSel.disabled = true;

  geocodeAndLoad(entry.comuna, entry.region);
}

// ── DROPDOWN CASCADA ─────────────────────────────────────────────────────────

document.getElementById('regSelect').addEventListener('change', function () {
  const provSel   = document.getElementById('provSelect');
  const comunaSel = document.getElementById('comunaSelect');
  provSel.innerHTML   = '<option value="">— Selecciona provincia —</option>';
  comunaSel.innerHTML = '<option value="">— Selecciona comuna —</option>';
  provSel.disabled    = !this.value;
  comunaSel.disabled  = true;
  clearAll();
  if (!this.value) return;
  const region = chileData.regiones.find(r => r.nombre === this.value);
  region.provincias.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.nombre; opt.textContent = p.nombre;
    provSel.appendChild(opt);
  });
});

document.getElementById('provSelect').addEventListener('change', function () {
  const regNombre = document.getElementById('regSelect').value;
  const comunaSel = document.getElementById('comunaSelect');
  comunaSel.innerHTML = '<option value="">— Selecciona comuna —</option>';
  comunaSel.disabled  = !this.value;
  clearAll();
  if (!this.value) return;
  const region = chileData.regiones.find(r => r.nombre === regNombre);
  const prov   = region.provincias.find(p => p.nombre === this.value);
  prov.comunas.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c; opt.textContent = c;
    comunaSel.appendChild(opt);
  });
});

document.getElementById('comunaSelect').addEventListener('change', function () {
  clearAll();
  if (!this.value) return;
  const region = document.getElementById('regSelect').value;
  currentComuna = this.value;
  geocodeAndLoad(this.value, region);
});

// ── GEOCODE + LOAD ────────────────────────────────────────────────────────────

async function geocodeAndLoad(comuna, region) {
  setStatus(`Buscando ${comuna}...`, 'loading');
  try {
    const res  = await fetch(`${NOMINATIM}?q=${encodeURIComponent(comuna + ', ' + region + ', Chile')}&format=json&limit=1&addressdetails=0`);
    const data = await res.json();
    if (!data.length) { setStatus('No se encontró la comuna.', 'error'); return; }

    const [bS, bN, bW, bE] = data[0].boundingbox.map(Number);
    currentBbox = { s: bS, w: bW, n: bN, e: bE };
    map.fitBounds([[bS, bW], [bN, bE]], { padding: [30, 30], maxZoom: 14 });

    await loadMode(currentMode, true);
  } catch (e) {
    setStatus('Error de conexión.', 'error');
  }
}

// ── MODE SWITCHING ────────────────────────────────────────────────────────────

async function loadMode(mode, forceReload = false) {
  if (!currentComuna || !currentBbox) return;

  if (mode === 'forestal') {
    hideUrbanoLayers();
    if (!forestLoaded || forceReload) {
      await fetchForestData();
      forestLoaded = true;
    } else {
      showForestLayers();
    }
    updateLegend('forestal');
  } else {
    hideForestLayers();
    if (!urbanoLoaded || forceReload) {
      await fetchUrbanoData();
      urbanoLoaded = true;
    } else {
      showUrbanoLayers();
    }
    updateLegend('urbano');
  }
}

// ── ═══════════════════════════════════════════════════════════════════════════
//    MÓDULO FORESTAL
// ── ═══════════════════════════════════════════════════════════════════════════

async function fetchForestData() {
  setStatus('Cargando vegetación y cuarteles...', 'loading');
  const { s, w, n, e } = currentBbox;

  const areaQuery = `
[out:json][timeout:35];
area["name"="${currentComuna}"]["admin_level"="8"]["boundary"="administrative"]->.a;
(
  way["landuse"~"^(forest|orchard|vineyard|grass)$"](area.a);
  way["natural"~"^(wood|scrub|heath|grassland)$"](area.a);
  relation["landuse"~"^(forest)$"](area.a);
  relation["natural"~"^(wood|scrub)$"](area.a);
);
out geom;`;

  const bboxQuery = `
[out:json][timeout:35];
(
  way["landuse"~"^(forest|orchard|vineyard|grass)$"](${s},${w},${n},${e});
  way["natural"~"^(wood|scrub|heath|grassland)$"](${s},${w},${n},${e});
);
out geom;`;

  // Cuarteles: bbox con margen para capturar los cercanos al límite comunal
  const stationQuery = `
[out:json][timeout:20];
(
  node["amenity"="fire_station"](${s - 0.05},${w - 0.05},${n + 0.05},${e + 0.05});
  way["amenity"="fire_station"](${s - 0.05},${w - 0.05},${n + 0.05},${e + 0.05});
);
out center;`;

  try {
    const [vegRes, stRes] = await Promise.all([
      fetch(OVERPASS, { method: 'POST', body: areaQuery }),
      fetch(OVERPASS, { method: 'POST', body: stationQuery })
    ]);

    let vegData = await vegRes.json();
    let vegElements = vegData.elements?.filter(el =>
      el.type === 'way' && el.geometry?.length >= 3
    ) || [];

    // Fallback a bbox si el área no devuelve datos
    if (!vegElements.length) {
      const fb = await fetch(OVERPASS, { method: 'POST', body: bboxQuery });
      const fbData = await fb.json();
      vegElements = fbData.elements?.filter(el =>
        el.type === 'way' && el.geometry?.length >= 3
      ) || [];
    }

    vegFeatures = vegElements.map(el => elementToGeoJSON(el)).filter(Boolean);

    const stData = await stRes.json();
    forestStations = stData.elements.map(el => ({
      id:   el.id,
      lat:  el.lat ?? el.center?.lat,
      lng:  el.lon ?? el.center?.lon,
      name: el.tags?.name || 'Cuartel de Bomberos'
    })).filter(f => f.lat && f.lng);

    renderForestLayers();
    buildForestStats();

    const total = vegFeatures.length;
    const sts   = forestStations.length;
    setStatus(`${total} polígonos de vegetación · ${sts} cuartel${sts !== 1 ? 'es' : ''}`, 'ok');

  } catch (e) {
    console.error(e);
    setStatus('Error al cargar datos forestales.', 'error');
  }
}

function elementToGeoJSON(el) {
  if (!el.geometry || el.geometry.length < 3) return null;
  const coords = el.geometry.map(p => [p.lon, p.lat]);
  // Cerrar polígono si es necesario
  if (coords[0][0] !== coords[coords.length - 1][0] ||
      coords[0][1] !== coords[coords.length - 1][1]) {
    coords.push(coords[0]);
  }
  return {
    type: 'Feature',
    properties: { ...el.tags },
    geometry: { type: 'Polygon', coordinates: [coords] }
  };
}

function getVegKey(tags) {
  if (tags.landuse === 'forest')    return 'forest';
  if (tags.natural === 'wood')      return 'wood';
  if (tags.natural === 'scrub')     return 'scrub';
  if (tags.natural === 'heath')     return 'heath';
  if (tags.natural === 'grassland') return 'grassland';
  if (tags.landuse === 'grass')     return 'grass';
  if (tags.landuse === 'vineyard')  return 'vineyard';
  if (tags.landuse === 'orchard')   return 'orchard';
  return 'scrub'; // default
}

function renderForestLayers() {
  if (vegLayer)         { map.removeLayer(vegLayer); vegLayer = null; }
  if (forestStationLayer) { map.removeLayer(forestStationLayer); forestStationLayer = null; }

  // Vegetación
  vegLayer = L.geoJSON({ type: 'FeatureCollection', features: vegFeatures }, {
    pane: 'veg',
    style: f => {
      const cfg = VEG[getVegKey(f.properties)] || VEG.scrub;
      return { color: cfg.color, fillColor: cfg.color, fillOpacity: 0.45, weight: 1, opacity: 0.6 };
    },
    onEachFeature: (f, layer) => {
      const cfg = VEG[getVegKey(f.properties)] || VEG.scrub;
      const name = f.properties.name ? `<strong>${f.properties.name}</strong><br>` : '';
      layer.bindTooltip(
        `${name}${cfg.label}<br><span style="color:${cfg.color}">⚠ Riesgo ${cfg.riskLabel}</span><br><em style="color:#9a8a7a">${cfg.note}</em>`,
        { sticky: true }
      );
    }
  }).addTo(map);

  // Cuarteles con radios de cobertura
  const stLayers = [];
  forestStations.forEach(st => {
    STATION_RADIUS_FOREST.forEach((r, i) => {
      const opacity = [0.15, 0.1, 0.07][i];
      const color   = ['#ff6b2b', '#ff9955', '#ffcc88'][i];
      stLayers.push(L.circle([st.lat, st.lng], {
        pane: 'coverage',
        radius: r, color, fillColor: color, fillOpacity: opacity, weight: 1, opacity: 0.5
      }));
    });

    const marker = L.marker([st.lat, st.lng], {
      pane: 'stations',
      icon: L.divIcon({
        className: '',
        html: '<div class="fire-marker station">🚒</div>',
        iconSize: [28, 28], iconAnchor: [14, 14]
      })
    });
    marker.bindTooltip(`<strong>${st.name}</strong><br>Cobertura: 5 / 10 / 15 km`, { direction: 'top', offset: [0, -6] });
    stLayers.push(marker);
  });

  forestStationLayer = L.layerGroup(stLayers).addTo(map);
}

function buildForestStats() {
  // Conteo por tipo de vegetación
  const counts = {};
  vegFeatures.forEach(f => {
    const key = getVegKey(f.properties);
    counts[key] = (counts[key] || 0) + 1;
  });

  const el = document.getElementById('vegStats');
  if (!Object.keys(counts).length) {
    el.innerHTML = '<div class="stat-empty">No se encontró vegetación mapeada en esta zona</div>';
  } else {
    const sorted = Object.entries(counts).sort((a, b) => {
      const order = ['forest','wood','scrub','heath','grassland','grass','vineyard','orchard'];
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    });
    el.innerHTML = sorted.map(([key, count]) => {
      const cfg = VEG[key];
      return `
        <div class="stat-row">
          <div class="stat-dot" style="background:${cfg.color}"></div>
          <div class="stat-info">
            <div class="stat-label">${cfg.label}</div>
            <div class="stat-sub">${count} polígono${count > 1 ? 's' : ''} mapeado${count > 1 ? 's' : ''}</div>
          </div>
          <span class="stat-badge badge-${cfg.risk}">${cfg.riskLabel}</span>
        </div>`;
    }).join('');
  }

  // Cuarteles
  const stEl = document.getElementById('stationStatsFor');
  if (!forestStations.length) {
    stEl.innerHTML = '<div class="stat-empty">Sin cuarteles registrados en el área</div>';
  } else {
    stEl.innerHTML = forestStations.map((st, i) => `
      <div class="station-row ${i === 0 ? 'highlight' : ''}">
        🚒 <span>${st.name}</span>
      </div>
      <div class="stat-sub" style="padding:0 9px 6px;font-size:0.68rem;color:var(--text-dim)">
        Radios: 5 km · 10 km · 15 km
      </div>`).join('');
  }
}

function showForestLayers() {
  if (vegLayer)           vegLayer.addTo(map);
  if (forestStationLayer) forestStationLayer.addTo(map);
}

function hideForestLayers() {
  if (vegLayer)           map.removeLayer(vegLayer);
  if (forestStationLayer) map.removeLayer(forestStationLayer);
}

// ── ═══════════════════════════════════════════════════════════════════════════
//    MÓDULO URBANO
// ── ═══════════════════════════════════════════════════════════════════════════

async function fetchUrbanoData() {
  setStatus('Cargando hidrantes, calles y cuarteles...', 'loading');
  const { s, w, n, e } = currentBbox;

  const areaQuery = `
[out:json][timeout:35];
area["name"="${currentComuna}"]["admin_level"="8"]["boundary"="administrative"]->.a;
(
  node["emergency"="fire_hydrant"](area.a);
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|track|path|footway|cycleway|pedestrian|steps|living_street|road)$"](area.a);
  node["amenity"="fire_station"](area.a);
  way["amenity"="fire_station"](area.a);
);
out geom;`;

  const bboxQuery = `
[out:json][timeout:35];
(
  node["emergency"="fire_hydrant"](${s},${w},${n},${e});
  way["highway"~"^(motorway|trunk|primary|secondary|tertiary|residential|unclassified|service|track|path|footway|cycleway|pedestrian|steps|living_street|road)$"](${s},${w},${n},${e});
  node["amenity"="fire_station"](${s - 0.05},${w - 0.05},${n + 0.05},${e + 0.05});
  way["amenity"="fire_station"](${s - 0.05},${w - 0.05},${n + 0.05},${e + 0.05});
);
out geom;`;

  try {
    let res  = await fetch(OVERPASS, { method: 'POST', body: areaQuery });
    let data = await res.json();

    const hasData = data.elements?.some(el => el.tags?.highway);
    if (!hasData) {
      res  = await fetch(OVERPASS, { method: 'POST', body: bboxQuery });
      data = await res.json();
    }

    const elements = data.elements || [];

    hydrants      = elements.filter(el => el.type === 'node' && el.tags?.emergency === 'fire_hydrant');
    urbanStations = elements
      .filter(el => el.tags?.amenity === 'fire_station')
      .map(el => ({
        id:   el.id,
        lat:  el.lat ?? el.center?.lat,
        lng:  el.lon ?? el.center?.lon,
        name: el.tags?.name || 'Cuartel de Bomberos'
      }))
      .filter(f => f.lat && f.lng);

    streets = elements
      .filter(el => el.type === 'way' && el.tags?.highway && el.geometry?.length >= 2 && !el.tags?.amenity)
      .map(el => ({
        id:       el.id,
        coords:   el.geometry.map(p => [p.lat, p.lon]),
        highway:  el.tags.highway,
        service:  el.tags.service || '',
        name:     el.tags.name || '',
        width:    el.tags.width ? parseFloat(el.tags.width) : null,
        vul:      classifyStreet(el.tags.highway, el.tags.service)
      }));

    renderUrbanoLayers();
    buildUrbanoStats();

    setStatus(`${hydrants.length} hidrantes · ${streets.length} tramos · ${urbanStations.length} cuartel${urbanStations.length !== 1 ? 'es' : ''}`, 'ok');

  } catch (e) {
    console.error(e);
    setStatus('Error al cargar datos urbanos.', 'error');
  }
}

function classifyStreet(highway, service) {
  if (STREET.critical.highways.has(highway)) return 'critical';
  if (highway === 'service' && service === 'alley') return 'critical';
  if (STREET.high.highways.has(highway))     return 'high';
  if (STREET.medium.highways.has(highway))   return 'medium';
  if (STREET.low.highways.has(highway))      return 'low';
  return 'medium';
}

function renderUrbanoLayers() {
  [hydrantLayer, hydrantCovLayer, streetLayer, urbanStationLayer]
    .forEach(l => { if (l) map.removeLayer(l); });
  hydrantLayer = hydrantCovLayer = streetLayer = urbanStationLayer = null;

  // Calles coloreadas por vulnerabilidad
  const streetLayers = streets.map(st => {
    const cfg = STREET[st.vul];
    const line = L.polyline(st.coords, {
      pane: 'streets',
      color: cfg.color,
      weight: st.vul === 'critical' ? 3 : st.vul === 'high' ? 2.5 : 2,
      opacity: 0.85
    });
    const name = st.name ? `<strong>${st.name}</strong><br>` : '';
    const w    = st.width ? `Ancho registrado: ${st.width} m<br>` : '';
    line.bindTooltip(`${name}${cfg.label}<br>${w}<em style="color:#9a8a7a">${cfg.sub}</em>`, { sticky: true });
    return line;
  });
  streetLayer = L.layerGroup(streetLayers).addTo(map);

  // Cobertura de hidrantes (círculos 150m)
  const covCircles = hydrants.map(h =>
    L.circle([h.lat, h.lon], {
      pane: 'coverage',
      radius: HYDRANT_RADIUS,
      color: '#3399ff', fillColor: '#3399ff',
      fillOpacity: 0.12, weight: 1, opacity: 0.4
    })
  );
  hydrantCovLayer = L.layerGroup(covCircles).addTo(map);

  // Marcadores de hidrantes
  const hydMarkers = hydrants.map(h => {
    const m = L.marker([h.lat, h.lon], {
      pane: 'hydrants',
      icon: L.divIcon({
        className: '',
        html: '<div class="fire-marker hydrant">💧</div>',
        iconSize: [28, 28], iconAnchor: [14, 14]
      })
    });
    m.bindTooltip(`💧 Hidrante<br><em style="color:#9a8a7a">Cobertura estimada: ${HYDRANT_RADIUS} m</em>`, { direction: 'top', offset: [0, -6] });
    return m;
  });

  // Cuarteles con radios de respuesta urbana
  const stLayers = [];
  urbanStations.forEach(st => {
    STATION_RADIUS_URBAN.forEach((r, i) => {
      const color   = ['#ff6b2b', '#ff9955', '#ffcc88'][i];
      const opacity = [0.12, 0.08, 0.05][i];
      stLayers.push(L.circle([st.lat, st.lng], {
        pane: 'coverage',
        radius: r, color, fillColor: color, fillOpacity: opacity, weight: 1, opacity: 0.4
      }));
    });
    const m = L.marker([st.lat, st.lng], {
      pane: 'stations',
      icon: L.divIcon({
        className: '',
        html: '<div class="fire-marker station">🚒</div>',
        iconSize: [28, 28], iconAnchor: [14, 14]
      })
    });
    m.bindTooltip(`<strong>${st.name}</strong><br>Radios: 1 km · 3 km · 5 km`, { direction: 'top', offset: [0, -6] });
    stLayers.push(m);
  });

  hydrantLayer      = L.layerGroup(hydMarkers).addTo(map);
  urbanStationLayer = L.layerGroup(stLayers).addTo(map);
}

function buildUrbanoStats() {
  // Hidrantes
  const hydEl = document.getElementById('hydrantStats');
  if (!hydrants.length) {
    hydEl.innerHTML = '<div class="stat-empty">No se encontraron hidrantes mapeados en OSM para esta zona</div>';
  } else {
    hydEl.innerHTML = `
      <div class="metric-row">
        <span class="metric-label">💧 Total hidrantes</span>
        <span class="metric-value">${hydrants.length}</span>
      </div>
      <div class="metric-row">
        <span class="metric-label">Radio de cobertura c/u</span>
        <span class="metric-value">${HYDRANT_RADIUS} m</span>
      </div>`;
  }

  // Calles
  const stEl = document.getElementById('streetStats');
  const counts = { low: 0, medium: 0, high: 0, critical: 0 };
  streets.forEach(s => counts[s.vul]++);
  const total = streets.length;

  if (!total) {
    stEl.innerHTML = '<div class="stat-empty">Sin datos de calles</div>';
  } else {
    stEl.innerHTML = Object.entries(counts)
      .filter(([, c]) => c > 0)
      .map(([vul, c]) => {
        const cfg = STREET[vul];
        const pct = Math.round((c / total) * 100);
        return `
          <div class="street-row">
            <div class="street-line" style="background:${cfg.color}"></div>
            <div class="street-info">
              <div class="street-label">${cfg.label}</div>
              <div class="street-sub">${cfg.sub}</div>
            </div>
            <span class="street-count">${c} (${pct}%)</span>
          </div>`;
      }).join('');

    const vulnerable = counts.high + counts.critical;
    if (vulnerable > 0) {
      stEl.innerHTML += `
        <div class="metric-row" style="margin-top:4px;border-color:#e74c3c40;background:rgba(231,76,60,0.07)">
          <span class="metric-label" style="color:#ff8877">⚠ Tramos de alta vulnerabilidad</span>
          <span class="metric-value" style="color:#ff5544">${vulnerable}</span>
        </div>`;
    }
  }

  // Cuarteles
  const csEl = document.getElementById('stationStatsUrb');
  if (!urbanStations.length) {
    csEl.innerHTML = '<div class="stat-empty">Sin cuarteles registrados en el área</div>';
  } else {
    csEl.innerHTML = urbanStations.map((st, i) => `
      <div class="station-row ${i === 0 ? 'highlight' : ''}">
        🚒 <span>${st.name}</span>
      </div>
      <div class="stat-sub" style="padding:0 9px 6px;font-size:0.68rem;color:var(--text-dim)">
        Radios: 1 km · 3 km · 5 km
      </div>`).join('');
  }
}

function showUrbanoLayers() {
  [hydrantCovLayer, streetLayer, hydrantLayer, urbanStationLayer]
    .forEach(l => { if (l) l.addTo(map); });
}

function hideUrbanoLayers() {
  [hydrantCovLayer, streetLayer, hydrantLayer, urbanStationLayer]
    .forEach(l => { if (l) map.removeLayer(l); });
}

// ── LEGEND ───────────────────────────────────────────────────────────────────

function updateLegend(mode) {
  const el = document.getElementById('legend');
  el.style.display = '';

  if (mode === 'forestal') {
    el.innerHTML = `
      <div class="legend-title">Vegetación</div>
      ${Object.entries(VEG).map(([, v]) =>
        `<div class="legend-item"><div class="legend-dot" style="background:${v.color}"></div>${v.label}</div>`
      ).join('')}
      <hr/>
      <div class="legend-item">🚒 Cuartel (radios 5/10/15 km)</div>`;
  } else {
    el.innerHTML = `
      <div class="legend-title">Accesibilidad</div>
      ${Object.entries(STREET).map(([, s]) =>
        `<div class="legend-item"><div class="legend-line" style="background:${s.color}"></div>${s.label}</div>`
      ).join('')}
      <hr/>
      <div class="legend-item">💧 Hidrante (radio ${HYDRANT_RADIUS} m)</div>
      <div class="legend-item">🚒 Cuartel (radios 1/3/5 km)</div>`;
  }
}

// ── HELPERS ──────────────────────────────────────────────────────────────────

function clearAll() {
  [vegLayer, forestStationLayer, hydrantLayer, hydrantCovLayer, streetLayer, urbanStationLayer]
    .forEach(l => { if (l) map.removeLayer(l); });
  vegLayer = forestStationLayer = hydrantLayer = hydrantCovLayer = streetLayer = urbanStationLayer = null;

  vegFeatures = []; forestStations = []; hydrants = []; streets = []; urbanStations = [];
  forestLoaded = false;
  urbanoLoaded = false;
  currentBbox  = null;

  ['vegStats','stationStatsFor','hydrantStats','streetStats','stationStatsUrb']
    .forEach(id => {
      document.getElementById(id).innerHTML = '<div class="stat-empty">Selecciona una comuna para ver el análisis</div>';
    });

  document.getElementById('legend').style.display = 'none';
  setStatus('Selecciona región, provincia y comuna para comenzar', '');
}

function setStatus(msg, type) {
  const el = document.getElementById('poiStatus');
  el.textContent = msg;
  el.className   = 'poi-status ' + (type || '');
}

// ── UI EVENTS ─────────────────────────────────────────────────────────────────

document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', async () => {
    if (btn.dataset.mode === currentMode) return;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentMode = btn.dataset.mode;

    document.getElementById('forestalPanel').style.display = currentMode === 'forestal' ? '' : 'none';
    document.getElementById('urbanoPanel').style.display   = currentMode === 'urbano'   ? '' : 'none';

    await loadMode(currentMode);
  });
});

document.getElementById('toggleSidebar').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('active');
});

// ── TOKEN + INIT ──────────────────────────────────────────────────────────────

function validateAndStart(token) {
  const key = token?.trim().toLowerCase();
  const access = ACCESS_TOKENS[key];
  if (!access) return false;

  // Guardar en URL para que puedan hacer bookmark
  const params = new URLSearchParams(window.location.search);
  params.set('token', key);
  window.history.replaceState({}, '', '?' + params.toString());

  // Mostrar badge del cliente en el sidebar
  const badge = document.getElementById('clientBadge');
  badge.textContent = access.nombre;
  badge.style.display = 'inline-block';

  // Ocultar pantalla de bloqueo
  document.getElementById('lockScreen').classList.add('hidden');

  // Cargar datos con el filtro de acceso
  loadAdminData(access);

  // El acceso público de demo expira a los 5 minutos
  if (key === 'demo01') {
    setTimeout(() => {
      const lockScreen = document.getElementById('lockScreen');
      lockScreen.querySelector('h2').textContent = 'Demo finalizada';
      lockScreen.querySelector('p').innerHTML = 'Tu demo de 5 minutos ha terminado.<br>Solicita el acceso completo para tu municipalidad.';
      document.getElementById('lockError').textContent = '';
      lockScreen.classList.remove('hidden');
      lockScreen.style.display = 'flex';
    }, 5 * 60 * 1000);
  }

  return true;
}

// Botón de acceso
document.getElementById('tokenBtn').addEventListener('click', () => {
  const val = document.getElementById('tokenInput').value;
  const ok  = validateAndStart(val);
  if (!ok) {
    const input = document.getElementById('tokenInput');
    input.classList.add('error');
    document.getElementById('lockError').textContent = 'Código incorrecto. Verifica e intenta de nuevo.';
    setTimeout(() => input.classList.remove('error'), 400);
  }
});

document.getElementById('tokenInput').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('tokenBtn').click();
});

// Leer token desde URL al cargar
const urlToken = new URLSearchParams(window.location.search).get('token');
if (!validateAndStart(urlToken)) {
  document.getElementById('lockScreen').style.display = 'flex'; // mostrar pantalla
}
