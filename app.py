# app.py
import csv
import math
import json
from pathlib import Path
from flask import Flask, render_template, request, jsonify
import networkx as nx
import pandas as pd
from networkx.algorithms import community

APP = Flask(__name__, static_folder="static", template_folder="Data")

# ---------- CONFIG ----------
AIRPORTS_CSV = "Data/airports_cleaned.csv"
ROUTES_CSV = "Data/routes_cleaned.csv"
MAX_ROUTES = None  # or an int to limit
MAX_STOPS = 1

# ---------- GEO HELPERS ----------
def gc_intermediate_points(lon1, lat1, lon2, lat2, steps=0):
    """Generate intermediate points along a great circle path."""
    if steps <= 0:
        return [(lat1, lon1), (lat2, lon2)]
    
    φ1, λ1, φ2, λ2 = map(math.radians, [lat1, lon1, lat2, lon2])
    d = 2 * math.asin(math.sqrt(
        math.sin((φ2 - φ1)/2)**2 + math.cos(φ1) * math.cos(φ2) * math.sin((λ2 - λ1)/2)**2
    ))
    
    if d == 0:
        return [(lat1, lon1)]
    
    pts = []
    for i in range(steps + 1):
        f = i / steps
        A = math.sin((1 - f) * d) / math.sin(d)
        B = math.sin(f * d) / math.sin(d)
        x = A * math.cos(φ1) * math.cos(λ1) + B * math.cos(φ2) * math.cos(λ2)
        y = A * math.cos(φ1) * math.sin(λ1) + B * math.cos(φ2) * math.sin(λ2)
        z = A * math.sin(φ1) + B * math.sin(φ2)
        φ = math.atan2(z, math.sqrt(x*x + y*y))
        λ = math.atan2(y, x)
        pts.append((math.degrees(φ), math.degrees(λ)))
    return pts

# ---------- LOAD DATA ----------
def load_airports(path):
    """Load airports from CSV, indexed by IATA and ICAO codes."""
    airports = {}
    
    if not Path(path).exists():
        raise FileNotFoundError(f"Airports file not found: {path}")
    
    try:
        df = pd.read_csv(path, dtype=str).fillna("")
    except Exception as e:
        raise Exception(f"Error reading airports CSV: {e}")
    
    loaded_count = 0
    for _, row in df.iterrows():
        iata = row.get("iata", "").strip()
        icao = row.get("icao", "").strip()
        name = row.get("name", "").strip()
        city = row.get("city", "").strip()
        country = row.get("country", "").strip()
        lat = row.get("latitude", "").strip()
        lon = row.get("longitude", "").strip()
        
        # Skip if no coordinates
        if not lat or not lon:
            continue
            
        try:
            latf, lonf = float(lat), float(lon)
        except ValueError:
            continue
            
        info = {
            "name": name, 
            "city": city, 
            "country": country, 
            "lat": latf, 
            "lon": lonf
        }
        
        # Index by both IATA and ICAO
        if iata:
            airports[iata] = info
            loaded_count += 1
        if icao and icao != iata:
            airports[icao] = info
    
    print(f"Loaded {loaded_count} airports (indexed by {len(airports)} codes)")
    return airports

def load_routes(path, max_routes=None, max_stops=1):
    """Load routes from CSV, filtering by stops."""
    routes = []
    seen = set()
    
    if not Path(path).exists():
        raise FileNotFoundError(f"Routes file not found: {path}")
    
    try:
        with open(path, newline="", encoding="utf-8") as f:
            r = csv.DictReader(f)
            for row in r:
                src = (row.get("src_airport") or "").strip()
                dst = (row.get("dst_airport") or "").strip()
                
                if not src or not dst:
                    continue
                
                # Check stops filter
                stops = row.get("stops")
                try:
                    stops_val = int(stops) if stops not in (None, "") else 0
                except ValueError:
                    stops_val = 0
                
                if stops_val > max_stops:
                    continue
                
                # Deduplicate
                key = (src, dst)
                if key in seen:
                    continue
                seen.add(key)
                routes.append(key)
                
                if max_routes and len(routes) >= max_routes:
                    break
    except Exception as e:
        raise Exception(f"Error reading routes CSV: {e}")
    
    print(f"Loaded {len(routes)} routes")
    return routes

# ---------- GRAPH BUILD ----------
def build_graph(routes, airports):
    """Build undirected graph from routes and airports."""
    G = nx.Graph()
    
    edges_added = 0
    for src, dst in routes:
        if src in airports and dst in airports:
            G.add_edge(src, dst)
            edges_added += 1
    
    print(f"Graph built: {G.number_of_nodes()} nodes, {G.number_of_edges()} edges")
    return G

# ---------- ANALYSIS ----------
def compute_centrality(G, metric="betweenness", top_n=10):
    """Compute centrality and return top N nodes."""
    if len(G) == 0:
        return []
    
    try:
        if metric == "degree":
            c = nx.degree_centrality(G)
        elif metric == "closeness":
            c = nx.closeness_centrality(G)
        else:  # betweenness
            c = nx.betweenness_centrality(G)
        
        sorted_items = sorted(c.items(), key=lambda x: x[1], reverse=True)
        return [k for k, _ in sorted_items[:top_n]]
    except Exception as e:
        print(f"Error computing centrality: {e}")
        return []

def analyze_disruption(G, disrupted):
    """Analyze network before and after disruption."""
    if len(G) == 0:
        return {}, {}, []
    
    # Before disruption
    largest_cc_before = max(nx.connected_components(G), key=len)

    before = {
        "nodes": G.number_of_nodes(),
        "edges": G.number_of_edges(),
        "largest_component": len(largest_cc_before),
        "efficiency": nx.global_efficiency(G)
    }
    
    # After disruption
    Gd = G.copy()
    Gd.remove_nodes_from(disrupted)
    stranded_nodes = []

    if len(Gd) > 0:
        # Find the new largest component
        components = list(nx.connected_components(Gd))
        largest_cc_after = max(components, key=len)
        
        # Find stranded nodes (active but isolated from main network)
        all_active_nodes = set(Gd.nodes())
        main_cluster_nodes = set(largest_cc_after)
        stranded_nodes = list(all_active_nodes - main_cluster_nodes)
        
        after = {
            "nodes": Gd.number_of_nodes(),
            "edges": Gd.number_of_edges(),
            "largest_component": len(largest_cc_after),
            "efficiency": nx.global_efficiency(Gd)
        }
    else:
        after = {"nodes": 0, "edges": 0, "largest_component": 0, "efficiency": 0}
        
    return before, after, stranded_nodes

# ---------- GEOJSON BUILDER ----------
def build_geojson(airports, routes, disrupted_set):
    """Build GeoJSON for airports and routes with community detection."""
    
    # --- Calculate Communities for Coloring ---
    # Calculate on FULL graph so colors remain stable during simulation
    G_temp = nx.Graph()
    for src, dst in routes:
        if src in airports and dst in airports:
            G_temp.add_edge(src, dst)
    
    # Use Greedy Modularity (fast and effective for flight networks)
    # Returns a list of sets: [{JFK, LAX...}, {LHR, CDG...}, ...]
    try:
        communities = community.louvain_communities(G_temp, seed=42)
        print(f"Detected {len(communities)} communities")
        
        # Create lookup map: node -> group_id
        group_map = {}
        for idx, comm in enumerate(communities):
            for node in comm:
                group_map[node] = idx
        
        # Log largest communities
        sorted_communities = sorted(communities, key=len, reverse=True)
        for i, comm in enumerate(sorted_communities[:5]):
            print(f"  Community {i}: {len(comm)} airports")
            
    except Exception as e:
        print(f"Warning: Community detection failed: {e}")
        print("Falling back to single group")
        group_map = {code: 0 for code in airports.keys()}
    
    # --- Build Airport Features ---
    airport_features = []
    for code, info in airports.items():
        group_id = group_map.get(code, 0)
        
        f = {
            "type": "Feature",
            "properties": {
                "code": code,
                "name": info["name"],
                "city": info["city"],
                "country": info["country"],
                "disrupted": code in disrupted_set,
                "group": group_id  # Community ID for coloring
            },
            "geometry": {
                "type": "Point",
                "coordinates": [info["lon"], info["lat"]]
            }
        }
        airport_features.append(f)
    
    # --- Build Route Features ---
    route_features = []
    for src, dst in routes:
        if src not in airports or dst not in airports:
            continue
        
        info_s = airports[src]
        info_d = airports[dst]
        disrupted = (src in disrupted_set) or (dst in disrupted_set)
        
        # Determine route group
        # If src and dst are in same community, use that color
        # If different, mark as inter-community connection (-1)
        src_group = group_map.get(src, 0)
        dst_group = group_map.get(dst, 0)
        route_group = src_group if src_group == dst_group else -1  # -1 = bridge
        
        route_features.append({
            "type": "Feature",
            "properties": {
                "src": src,
                "dst": dst,
                "disrupted": disrupted,
                "group": route_group  # Community ID or -1 for bridges
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[info_s["lon"], info_s["lat"]], [info_d["lon"], info_d["lat"]]]
            }
        })
    
    return {
        "airports": {
            "type": "FeatureCollection",
            "features": airport_features
        },
        "routes": {
            "type": "FeatureCollection",
            "features": route_features
        },
        "community_count": len(communities) if 'communities' in locals() else 1
    }

# ---------- STARTUP: Load data once ----------
print("=" * 50)
print("Starting Flask app...")
print("=" * 50)

if not Path(AIRPORTS_CSV).exists() or not Path(ROUTES_CSV).exists():
    raise SystemExit(f"Missing required CSV files:\n  - {AIRPORTS_CSV}\n  - {ROUTES_CSV}")

try:
    print("Loading data...")
    AIRPORTS = load_airports(AIRPORTS_CSV)
    ROUTES = load_routes(ROUTES_CSV, max_routes=MAX_ROUTES, max_stops=MAX_STOPS)
    GRAPH = build_graph(ROUTES, AIRPORTS)
    print("Data loaded successfully!")
    print("=" * 50)
except Exception as e:
    raise SystemExit(f"Error loading data: {e}")

# ---------- ROUTES ----------
@APP.route("/")
def index():
    """Render the main page with initial GeoJSON data."""
    try:
        init_geo = build_geojson(AIRPORTS, ROUTES, disrupted_set=set())
        return render_template(
            "index.html",
            airports_json=json.dumps(init_geo["airports"]),
            routes_json=json.dumps(init_geo["routes"])
        )
    except Exception as e:
        return f"Error loading page: {e}", 500

@APP.route("/analyze", methods=["POST"])
def analyze():
    """Analyze network disruption based on POST data."""
    try:
        data = request.get_json() or {}
        disrupted = data.get("disrupted", [])
        auto_top_n = int(data.get("auto_top_n", 0))
        centrality_metric = data.get("centrality_metric", "betweenness")
        
        disrupted_set = set(disrupted)
        
        # Auto-select top critical airports if requested
        if auto_top_n > 0:
            critical = compute_centrality(GRAPH, metric=centrality_metric, top_n=auto_top_n)
            disrupted_set.update(critical)
        
        # Analyze disruption
        before, after, stranded = analyze_disruption(GRAPH, disrupted_set)
        
        # Build updated GeoJSON with community info
        geo = build_geojson(AIRPORTS, ROUTES, disrupted_set)
        
        response = {
            "before": before,
            "after": after,
            "stranded_list": stranded,
            "disrupted_list": sorted(list(disrupted_set)),
            "airports_geo": geo["airports"],
            "routes_geo": geo["routes"],
            "community_count": geo.get("community_count", 1)
        }
        
        return jsonify(response)
    
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@APP.route("/health")
def health():
    """Health check endpoint."""
    return jsonify({
        "status": "ok",
        "airports": len(AIRPORTS),
        "routes": len(ROUTES),
        "graph_nodes": GRAPH.number_of_nodes(),
        "graph_edges": GRAPH.number_of_edges()
    })

if __name__ == "__main__":
    print("\n Starting Flask server on http://localhost:5000")
    print("Press CTRL+C to quit\n")
    APP.run(host="0.0.0.0", port=5000, debug=False)