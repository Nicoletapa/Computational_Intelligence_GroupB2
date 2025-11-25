/* filepath: /Users/nicoletapavelescu/Documents/ACIT4620/Computational_Intelligence_GroupB2/static/js/script.js */
// ========== PERFORMANCE OPTIMIZATIONS ==========

// 1. Cache DOM elements
const elements = {
  loading: document.getElementById('loading'),
  metrics: document.getElementById('metrics'),
  airportList: document.getElementById('airport-list'),
  autoN: document.getElementById('auto_n'),
  centrality: document.getElementById('centrality'),
  communityLegend: document.getElementById('community-legend'),
  legendContent: document.getElementById('legend-content'),
  // NEW: Detailed metrics elements
  detailedMetricsContainer: document.getElementById('detailed-metrics-container'),
  detailedMetrics: document.getElementById('detailed-metrics'),
  expandMetricsBtn: document.getElementById('expand-metrics-btn')
};

// 2. Constants
const COLORS = {
  active: '#48bb78',
  disrupted: '#e53e3e',      // Red for disrupted
  stranded: '#f6ad55',       // Light Orange for stranded routes
  strandedAirport: '#ed8936' // Darker Orange for stranded airports
};

const MARKER_OPTIONS = {
  active: { fillOpacity: 0.8, weight: 1 },     // Removed fixed 'radius'
  disrupted: { fillOpacity: 0.8, weight: 0.1 }   // Removed fixed 'radius'
};

// NEW: Community Color Palette (12 distinct colors)
const PALETTE = [
  '#3cb44b', // Green
  '#ffd700', // Yellow
  '#4363d8', // Blue
  '#f58231', // Orange
  '#911eb4', // Purple
  '#42d4f4', // Cyan
  '#f032e6', // Magenta
  '#bfef45', // Lime
  '#fabed4', // Pink
  '#469990', // Teal
  '#dcbeff', // Lavender
  '#9A6324'  // Brown
];

const INTER_CONTINENTAL_COLOR = '#a0aec0'; // Grey for bridges between clusters

// Helper to get color by group ID
function getGroupColor(groupId) {
  if (groupId === -1) return INTER_CONTINENTAL_COLOR;
  return PALETTE[groupId % PALETTE.length];
}

// Parse initial data once from global window object
const airportsGeo = window.INITIAL_DATA.airports;
const routesGeo = window.INITIAL_DATA.routes;

// NEW: Country State Management
let countryLayer = null;
let countryData = null;
const countryToAirports = {};
let communityCount = 0;

// Initialize map
const map = L.map('map', { zoomControl: false }).setView([20, 0], 2);
L.control.zoom({ position: 'topright' }).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 10,
  minZoom: 2
}).addTo(map);

// Layer visibility state
const layerVisibility = {
  activeAirports: true,
  disruptedAirports: true,
  activeRoutes: true,
  disruptedRoutes: true
};

// Layers
let activeAirportsLayer = L.layerGroup().addTo(map);
let disruptedAirportsLayer = L.layerGroup().addTo(map);
let activeRoutesLayer = L.layerGroup().addTo(map);
let disruptedRoutesLayer = L.layerGroup().addTo(map);

// State
const disruptedSet = new Set();
const strandedSet = new Set();
let currentAirportsGeo = airportsGeo;
let currentRoutesGeo = routesGeo;

// NEW: Pre-process Airport Data to map Countries
airportsGeo.features.forEach(f => {
  const country = f.properties.country;
  const code = f.properties.code;
  
  if (!countryToAirports[country]) {
    countryToAirports[country] = [];
  }
  countryToAirports[country].push(code);
});

console.log('Countries with airports:', Object.keys(countryToAirports).length);

// Memoize marker creation
const markerCache = new Map();

function createMarker(feature) {
  const code = feature.properties.code;
  const groupId = feature.properties.group;
  let state = 'a';
  if (feature.properties.disrupted) state = 'd';
  else if (strandedSet.has(code)) state = 's';

  // Use community color for active airports
  let color = getGroupColor(groupId);
  if (state === 'd') color = COLORS.disrupted;           // Red
  if (state === 's') color = COLORS.strandedAirport;     // Darker Orange (#ed8936)

  const options = (state === 'd') ? MARKER_OPTIONS.disrupted : MARKER_OPTIONS.active;
  
  const zoom = map.getZoom();
  const baseRadius = Math.max(1, zoom / 2);
  const initialRadius = state === 'd' ? baseRadius + 2 : baseRadius;
  
  const marker = L.circleMarker(
    [feature.geometry.coordinates[1], feature.geometry.coordinates[0]], 
    { 
      ...options, 
      color, 
      fillColor: color,
      radius: initialRadius
    }
  );
  
  let statusText = "";
  if(state === 's') statusText = '<br><strong style="color: #ed8936">⚠ ISOLATED FROM NETWORK</strong>';

  marker.bindPopup(`
    <strong style="color: ${getGroupColor(groupId)}; font-size: 15px;">${feature.properties.code}</strong><br>
    <strong>${feature.properties.name}</strong><br>
    ${feature.properties.city}, ${feature.properties.country}<br>
    <small style="color: #718096;">Community ${groupId >= 0 ? groupId : 'Bridge'}</small>
    ${statusText}
  `);
  
  marker.on('click', () => toggleAirport(feature.properties.code));
  
  return marker;
}

function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

function updateMapLayers() {
  requestAnimationFrame(() => {
    activeAirportsLayer.clearLayers();
    disruptedAirportsLayer.clearLayers();
    activeRoutesLayer.clearLayers();
    disruptedRoutesLayer.clearLayers();

    const zoom = map.getZoom();
    const baseWeight = Math.max(0.3, zoom / 5);

    // --- AIRPORTS ---
    const activeMarkers = [];
    const disruptedMarkers = [];

    currentAirportsGeo.features.forEach(feature => {
      const marker = createMarker(feature);
      
      if (feature.properties.disrupted) {
        disruptedMarkers.push(marker);
      } else {
        activeMarkers.push(marker);
      }
    });

    activeMarkers.forEach(m => activeAirportsLayer.addLayer(m));
    disruptedMarkers.forEach(m => disruptedAirportsLayer.addLayer(m));

    // --- ROUTES (Updated with Color-Based Styling) ---
    currentRoutesGeo.features.forEach(feature => {
      const disrupted = feature.properties.disrupted;
      const groupId = feature.properties.group;
      
      // Check if route connects to stranded airports
      const isStranded = strandedSet.has(feature.properties.src) || 
                         strandedSet.has(feature.properties.dst);
      
      // Determine Style
      let routeColor, routeWeight, routeOpacity;

      if (disrupted) {
        // DISRUPTED: Bright Red, Solid, Thick
        routeColor = COLORS.disrupted;
        routeWeight = baseWeight * 1.5;
        routeOpacity = 0.8; // High opacity, no dashes needed
      } else if (isStranded) {
        // STRANDED: Light Orange, Solid, Medium Thick
        routeColor = COLORS.stranded; // #f6ad55
        routeWeight = baseWeight * 1.3;
        routeOpacity = 0.7; // High opacity, distinct color
      } else {
        // ACTIVE: Use Community Colors
        routeColor = getGroupColor(groupId);
        
        if (groupId === -1) {
          routeWeight = baseWeight * 0.6;
          routeOpacity = 0.3;
        } else {
          routeWeight = baseWeight;
          routeOpacity = 0.15;
        }
      }

      const layer = L.geoJSON(feature, {
        style: {
          color: routeColor,
          weight: routeWeight, 
          opacity: routeOpacity,
          dashArray: null // NO DASHES - using colors only
        }
      });
      
      layer.bindTooltip(`${feature.properties.src} → ${feature.properties.dst}`, {
        permanent: false,
        direction: 'center'
      });

      if (disrupted) {
        disruptedRoutesLayer.addLayer(layer);
      } else {
        activeRoutesLayer.addLayer(layer);
      }
    });
  });
}

const toggleLayer = (() => {
  const layerMap = {
    'active-airports': { layer: activeAirportsLayer, key: 'activeAirports' },
    'disrupted-airports': { layer: disruptedAirportsLayer, key: 'disruptedAirports' },
    'active-routes': { layer: activeRoutesLayer, key: 'activeRoutes' },
    'disrupted-routes': { layer: disruptedRoutesLayer, key: 'disruptedRoutes' }
  };

  return function(layerName) {
    const toggle = document.getElementById(`toggle-${layerName}`);
    toggle.classList.toggle('active');
    
    const { layer, key } = layerMap[layerName];
    layerVisibility[key] = !layerVisibility[key];
    
    if (layerVisibility[key]) {
      map.addLayer(layer);
    } else {
      map.removeLayer(layer);
    }
  };
})();

['active-airports', 'disrupted-airports', 'active-routes', 'disrupted-routes'].forEach(layerName => {
  document.getElementById(`toggle-${layerName}`).addEventListener('click', () => toggleLayer(layerName));
});

function updateCommunityLegend() {
  if (communityCount <= 1) {
    elements.communityLegend.style.display = 'none';
    return;
  }

  let html = '';
  for (let i = 0; i < Math.min(communityCount, 12); i++) {
    const color = PALETTE[i % PALETTE.length];
    html += `
      <div class="legend-item">
        <div class="legend-color-box" style="background: ${color};"></div>
        <span>Community ${i}</span>
      </div>
    `;
  }
  
  html += `
    <div class="legend-item">
      <div class="legend-color-box" style="background: ${INTER_CONTINENTAL_COLOR};"></div>
      <span>Inter-community</span>
    </div>
  `;

  elements.legendContent.innerHTML = html;
  elements.communityLegend.style.display = 'block';
}

function renderAirportList() {
  const airports = currentAirportsGeo.features
    .map(f => ({
      code: f.properties.code,
      name: f.properties.name,
      city: f.properties.city,
      country: f.properties.country,
      disrupted: disruptedSet.has(f.properties.code),
      group: f.properties.group
    }))
    .sort((a, b) => {
      if (a.disrupted !== b.disrupted) return a.disrupted ? -1 : 1;
      return a.code.localeCompare(b.code);
    });

  const fragment = document.createDocumentFragment();
  const tempDiv = document.createElement('div');
  
  tempDiv.innerHTML = airports.map(ap => {
    const groupColor = getGroupColor(ap.group);
    return `
      <div class="airport-item ${ap.disrupted ? 'disrupted' : ''}" data-code="${ap.code}">
        <div class="airport-code" style="color: ${ap.disrupted ? '#e53e3e' : groupColor};">${ap.code}</div>
        <div class="airport-details">
          <div class="airport-name">${ap.name}</div>
          <div class="airport-location">${ap.city}, ${ap.country}</div>
        </div>
        <div class="status-badge ${ap.disrupted ? 'disrupted' : 'active'}">
          ${ap.disrupted ? 'Disrupted' : 'Active'}
        </div>
      </div>
    `;
  }).join('');

  while (tempDiv.firstChild) {
    fragment.appendChild(tempDiv.firstChild);
  }

  elements.airportList.innerHTML = '';
  elements.airportList.appendChild(fragment);

  elements.airportList.addEventListener('click', (e) => {
    const item = e.target.closest('.airport-item');
    if (item) {
      toggleAirport(item.dataset.code);
    }
  });
}

function toggleAirport(code) {
  if (disruptedSet.has(code)) {
    disruptedSet.delete(code);
  } else {
    disruptedSet.add(code);
  }
  renderAirportList();
  updateCountryLayerStyle();
}

// NEW: Country Functions
function toggleCountry(countryName) {
  let airportsInCountry = countryToAirports[countryName];
  
  if (!airportsInCountry || airportsInCountry.length === 0) {
    const fuzzyMatch = Object.keys(countryToAirports).find(k => 
      k.toLowerCase().includes(countryName.toLowerCase()) || 
      countryName.toLowerCase().includes(k.toLowerCase())
    );
    
    if (fuzzyMatch) {
      airportsInCountry = countryToAirports[fuzzyMatch];
    } else {
      console.log(`No airports found for country: ${countryName}`);
      return;
    }
  }

  const allDisrupted = airportsInCountry.every(code => disruptedSet.has(code));

  if (allDisrupted) {
    airportsInCountry.forEach(code => disruptedSet.delete(code));
  } else {
    airportsInCountry.forEach(code => disruptedSet.add(code));
  }

  updateMapLayers();
  renderAirportList();
  updateCountryLayerStyle();
}

async function loadCountryBorders() {
  try {
    console.log('Loading country borders...');
    const response = await fetch('https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json');
    countryData = await response.json();
    console.log('Country data loaded:', countryData.features.length, 'countries');

    countryLayer = L.geoJSON(countryData, {
      style: styleCountry,
      onEachFeature: onEachCountry
    });

    document.getElementById('toggle-countries').addEventListener('click', (e) => {
      const toggle = e.currentTarget;
      toggle.classList.toggle('active');
      
      if (map.hasLayer(countryLayer)) {
        map.removeLayer(countryLayer);
      } else {
        countryLayer.addTo(map);
        countryLayer.bringToBack();
      }
    });

    console.log('Country borders ready!');
  } catch (error) {
    console.error("Failed to load country borders:", error);
  }
}

function styleCountry(feature) {
  const cName = feature.properties.name;
  let airports = countryToAirports[cName] || [];
  
  if (airports.length === 0) {
    const fuzzyKey = Object.keys(countryToAirports).find(k => 
      k.toLowerCase().includes(cName.toLowerCase()) || 
      cName.toLowerCase().includes(k.toLowerCase())
    );
    if (fuzzyKey) {
      airports = countryToAirports[fuzzyKey];
    }
  }

  const hasAirports = airports.length > 0;
  const disruptedCount = airports.filter(code => disruptedSet.has(code)).length;
  const isFullyDisrupted = hasAirports && disruptedCount === airports.length;
  const isPartiallyDisrupted = hasAirports && disruptedCount > 0 && !isFullyDisrupted;

  let fillColor = '#a0aec0';
  let fillOpacity = 0.1;

  if (isFullyDisrupted) {
    fillColor = '#e53e3e';
    fillOpacity = 0.4;
  } else if (isPartiallyDisrupted) {
    fillColor = '#ed8936';
    fillOpacity = 0.3;
  }

  return {
    fillColor: fillColor,
    weight: 1,
    opacity: 1,
    color: 'white',
    dashArray: '3',
    fillOpacity: fillOpacity
  };
}

function updateCountryLayerStyle() {
  if (countryLayer) {
    countryLayer.setStyle(styleCountry);
  }
}

function onEachCountry(feature, layer) {
  layer.on({
    mouseover: (e) => {
      const layer = e.target;
      layer.setStyle({
        weight: 2,
        color: '#667eea',
        dashArray: '',
        fillOpacity: 0.5
      });
      if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
        layer.bringToFront();
      }
      
      layer.bindTooltip(feature.properties.name, {
        permanent: false, 
        direction: "center",
        className: "country-label"
      }).openTooltip();
    },
    mouseout: (e) => {
      countryLayer.resetStyle(e.target);
      e.target.closeTooltip();
    },
    click: (e) => {
      L.DomEvent.stopPropagation(e);
      toggleCountry(feature.properties.name);
    }
  });
}

const simulate = debounce(async function() {
  const autoN = parseInt(elements.autoN.value) || 0;
  const metric = elements.centrality.value;

  elements.loading.classList.add('active');
  elements.metrics.style.display = 'none';

  try {
    const response = await fetch('/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        disrupted: Array.from(disruptedSet),
        auto_top_n: autoN,
        centrality_metric: metric
      })
    });

    const data = await response.json();
    
    disruptedSet.clear();
    strandedSet.clear();
    data.disrupted_list.forEach(code => disruptedSet.add(code));
    if (data.stranded_list) {
      data.stranded_list.forEach(code => strandedSet.add(code));
    }

    currentAirportsGeo = data.airports_geo;
    currentRoutesGeo = data.routes_geo;
    communityCount = data.community_count || 0;

    updateMapLayers();
    updateCountryLayerStyle();
    updateCommunityLegend();

    const before = data.before;
    const after = data.after;
    const nodeChange = ((after.nodes - before.nodes) / before.nodes * 100).toFixed(1);
    const edgeChange = ((after.edges - before.edges) / before.edges * 100).toFixed(1);
    const lccChange = ((after.largest_component - before.largest_component) / before.largest_component * 100).toFixed(1);
    const effChange = before.efficiency > 0 ? ((after.efficiency - before.efficiency) / before.efficiency * 100).toFixed(1) : 'N/A';

    elements.metrics.innerHTML = `
      <div class="metrics-grid">
        <div class="metric-card">
          <div class="metric-label">Nodes</div>
          <div class="metric-value">${after.nodes}</div>
          <div class="metric-change negative">${nodeChange}%</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Edges</div>
          <div class="metric-value">${after.edges}</div>
          <div class="metric-change negative">${edgeChange}%</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Largest Component</div>
          <div class="metric-value">${after.largest_component}</div>
          <div class="metric-change negative">${lccChange}%</div>
        </div>
        <div class="metric-card">
          <div class="metric-label">Efficiency</div>
          <div class="metric-value">${after.efficiency > 0 ? after.efficiency.toFixed(3) : 'N/A'}</div>
          <div class="metric-change negative">${effChange}%</div>
        </div>
      </div>
    `;

    // NEW: Update detailed metrics panel
    updateDetailedMetrics(data);

    renderAirportList();
  } catch (error) {
    console.error('Error:', error);
    alert('Error analyzing network. Check console for details.');
  } finally {
    elements.loading.classList.remove('active');
    elements.metrics.style.display = 'block';
  }
}, 300);

document.getElementById('simulate').addEventListener('click', simulate);

document.getElementById('reset').addEventListener('click', () => {
  disruptedSet.clear();
  strandedSet.clear();
  elements.autoN.value = '0';
  location.reload();
});

// Add NEW function to update sizes on zoom (add after updateMapLayers function):
function updateVisualSizes() {
  const zoom = map.getZoom();
  
  const baseWeight = Math.max(0.3, zoom / 5);
  const baseRadius = Math.max(1, zoom / 2);

  // 1. Update Routes (Lines)
  activeRoutesLayer.eachLayer(layer => {
    layer.eachLayer(subLayer => {
      const props = subLayer.feature.properties;
      const groupId = props.group;
      
      const isStranded = strandedSet.has(props.src) || strandedSet.has(props.dst);
      
      let newWeight, newOpacity;
      if (props.disrupted) {
        newWeight = baseWeight * 0.8;
        newOpacity = 0.8;
      } else if (isStranded) {
        newWeight = baseWeight * 1.3;
        newOpacity = 0.7;
      } else if (groupId === -1) {
        newWeight = baseWeight * 0.6;
        newOpacity = 0.3;
      } else {
        newWeight = baseWeight;
        newOpacity = 0.15;
      }
      
      subLayer.setStyle({ 
        weight: newWeight,
        opacity: newOpacity
        // NO dashArray change - colors remain stable
      });
    });
  });
  
  disruptedRoutesLayer.eachLayer(layer => {
    layer.eachLayer(subLayer => {
      subLayer.setStyle({ 
        weight: baseWeight * 1.5,
        opacity: 0.8
      });
    });
  });

  // 2. Update Airports (Dots)
  activeAirportsLayer.eachLayer(marker => {
    marker.setRadius(baseRadius);
  });
  
  disruptedAirportsLayer.eachLayer(marker => {
    marker.setRadius(baseRadius + 2);
  });
}

// Add zoom event listener at the end of the script (before INITIALIZATION):
map.on('zoomend', updateVisualSizes);

// INITIALIZATION
loadCountryBorders();
updateMapLayers();
renderAirportList();
updateVisualSizes(); // Initial sizing

// NEW: Detailed Metrics Update Function
function updateDetailedMetrics(data) {
  const { before, after, disrupted_list, stranded_list } = data;
  
  // Calculate additional statistics
  const nodeChange = before.nodes - after.nodes;
  const edgeChange = before.edges - after.edges;
  const lccChange = before.largest_component - after.largest_component;
  const effChange = before.efficiency - after.efficiency;
  
  const nodeChangePercent = ((nodeChange / before.nodes) * 100).toFixed(2);
  const edgeChangePercent = ((edgeChange / before.edges) * 100).toFixed(2);
  const lccChangePercent = ((lccChange / before.largest_component) * 100).toFixed(2);
  const effChangePercent = before.efficiency > 0 ? ((effChange / before.efficiency) * 100).toFixed(2) : 'N/A';
  
  // Calculate network density
  const maxPossibleEdges = (before.nodes * (before.nodes - 1)) / 2;
  const densityBefore = ((before.edges / maxPossibleEdges) * 100).toFixed(4);
  const densityAfter = after.nodes > 0 ? ((after.edges / ((after.nodes * (after.nodes - 1)) / 2)) * 100).toFixed(4) : 0;
  
  // Calculate components
  const disruptedCount = disrupted_list.length;
  const strandedCount = stranded_list ? stranded_list.length : 0;
  const activeCount = after.nodes;
  
  const html = `
    <!-- Network Overview -->
    <div class="metric-section">
      <div class="metric-section-title">
        <i class="fas fa-network-wired"></i> Network Overview
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Total Airports (Before)</span>
        <span class="metric-row-value neutral">${before.nodes}</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Active Airports (After)</span>
        <span class="metric-row-value">${after.nodes}</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Disrupted Airports</span>
        <span class="metric-row-value negative">${disruptedCount}</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Stranded Airports</span>
        <span class="metric-row-value" style="color: #ed8936;">${strandedCount}</span>
      </div>
    </div>

    <!-- Route Statistics -->
    <div class="metric-section">
      <div class="metric-section-title">
        <i class="fas fa-route"></i> Route Statistics
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Total Routes (Before)</span>
        <span class="metric-row-value neutral">${before.edges}</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Active Routes (After)</span>
        <span class="metric-row-value">${after.edges}</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Routes Lost</span>
        <span class="metric-row-value negative">-${edgeChange} (-${edgeChangePercent}%)</span>
      </div>
    </div>

    <!-- Network Properties -->
    <div class="metric-section">
      <div class="metric-section-title">
        <i class="fas fa-project-diagram"></i> Network Properties
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Network Density (Before)</span>
        <span class="metric-row-value neutral">${densityBefore}%</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Network Density (After)</span>
        <span class="metric-row-value">${densityAfter}%</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Global Efficiency (Before)</span>
        <span class="metric-row-value neutral">${before.efficiency.toFixed(4)}</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Global Efficiency (After)</span>
        <span class="metric-row-value">${after.efficiency > 0 ? after.efficiency.toFixed(4) : 'N/A'}</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Efficiency Loss</span>
        <span class="metric-row-value negative">${effChangePercent}%</span>
      </div>
    </div>

    <!-- Connectivity -->
    <div class="metric-section">
      <div class="metric-section-title">
        <i class="fas fa-share-alt"></i> Connectivity Analysis
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Largest Component (Before)</span>
        <span class="metric-row-value neutral">${before.largest_component}</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Largest Component (After)</span>
        <span class="metric-row-value">${after.largest_component}</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Component Size Loss</span>
        <span class="metric-row-value negative">-${lccChange} (-${lccChangePercent}%)</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Network Fragmentation</span>
        <span class="metric-row-value ${strandedCount > 0 ? 'negative' : 'positive'}">
          ${strandedCount > 0 ? 'Fragmented' : 'Connected'}
        </span>
      </div>
    </div>

    <!-- Impact Summary -->
    <div class="metric-section">
      <div class="metric-section-title">
        <i class="fas fa-exclamation-triangle"></i> Impact Summary
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Airports Affected</span>
        <span class="metric-row-value negative">${((disruptedCount / before.nodes) * 100).toFixed(1)}%</span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Network Resilience</span>
        <span class="metric-row-value ${lccChangePercent > -20 ? 'positive' : lccChangePercent > -50 ? 'neutral' : 'negative'}">
          ${lccChangePercent > -20 ? 'High' : lccChangePercent > -50 ? 'Medium' : 'Low'}
        </span>
      </div>
      <div class="metric-row">
        <span class="metric-row-label">Severity Level</span>
        <span class="metric-row-value ${disruptedCount < 10 ? 'neutral' : disruptedCount < 30 ? '' : 'negative'}">
          ${disruptedCount < 10 ? 'Minor' : disruptedCount < 30 ? 'Moderate' : 'Severe'}
        </span>
      </div>
    </div>

    ${disrupted_list.length > 0 ? `
    <!-- Disrupted Airports List -->
    <div class="metric-section">
      <div class="metric-section-title">
        <i class="fas fa-plane-slash"></i> Disrupted Airports (${disruptedCount})
      </div>
      <div class="top-airports-list">
        ${disrupted_list.map((code, idx) => {
          const airport = currentAirportsGeo.features.find(f => f.properties.code === code);
          return `
            <div class="top-airport-item">
              <span class="top-airport-rank">${idx + 1}</span>
              <span class="top-airport-code">${code}</span>
              <span class="top-airport-score">${airport ? airport.properties.name : 'Unknown'}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
    ` : ''}

    ${strandedCount > 0 ? `
    <!-- Stranded Airports List -->
    <div class="metric-section">
      <div class="metric-section-title">
        <i class="fas fa-unlink"></i> Stranded Airports (${strandedCount})
      </div>
      <div class="top-airports-list">
        ${stranded_list.map((code, idx) => {
          const airport = currentAirportsGeo.features.find(f => f.properties.code === code);
          return `
            <div class="top-airport-item">
              <span class="top-airport-rank" style="background: #ed8936;">${idx + 1}</span>
              <span class="top-airport-code">${code}</span>
              <span class="top-airport-score">${airport ? airport.properties.name : 'Unknown'}</span>
            </div>
          `;
        }).join('')}
      </div>
    </div>
    ` : ''}
  `;
  
  elements.detailedMetrics.innerHTML = html;
  elements.detailedMetricsContainer.style.display = 'block';
}

// Add toggle functionality (add before INITIALIZATION):
elements.expandMetricsBtn.addEventListener('click', () => {
  elements.detailedMetrics.classList.toggle('expanded');
  elements.expandMetricsBtn.classList.toggle('expanded');
  
  const isExpanded = elements.detailedMetrics.classList.contains('expanded');
  elements.expandMetricsBtn.querySelector('span').textContent = 
    isExpanded ? 'Hide Detailed Statistics' : 'Show Detailed Statistics';
});