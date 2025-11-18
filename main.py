# airline_network_map.py
import csv
import math
import argparse
from pathlib import Path
import folium
from folium.plugins import FastMarkerCluster

# ------------- CONFIG VIA ARGS -------------
parser = argparse.ArgumentParser(description="Interactive network map from OpenFlights .dat files.")
parser.add_argument("--airports", default="airports_cleaned.csv", help="Path to airports_cleaned.csv")
parser.add_argument("--routes",   default="routes_cleaned.csv",   help="Path to routes_cleaned.csv")
parser.add_argument("--output",   default="airport_routes_map.html", help="Output HTML file")
parser.add_argument("--max_routes", type=int, default=100000, help="Limit number of routes drawn (for performance)")
parser.add_argument("--opacity", type=float, default=0.25, help="Route line opacity (0..1)")
parser.add_argument("--weight", type=float, default=1.0, help="Route line width (pixels)")
parser.add_argument("--gc_steps", type=int, default=0, help="Great-circle interpolation steps (0 = straight lines)")
parser.add_argument("--use_ids", action="store_true",
                    help="Use numeric airport IDs (src_id/dst_id). If not set, use codes (IATA/ICAO).")
parser.add_argument("--max_stops", type=int, default=1,
                    help="Keep routes with stops <= this value (e.g., 0 for direct only, 1 to allow one stop).")

args = parser.parse_args()

AIRPORTS_CSV = args.airports
ROUTES_CSV   = args.routes
OUTPUT_HTML  = args.output

# ------------- GEO HELPERS -------------
def gc_intermediate_points(lon1, lat1, lon2, lat2, steps):
    """Return list of lat/lon points along great circle (including endpoints)."""
    if steps <= 0:
        return [(lat1, lon1), (lat2, lon2)]

    # convert to radians
    φ1, λ1, φ2, λ2 = map(math.radians, [lat1, lon1, lat2, lon2])

    # angular distance
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

# ------------- LOAD DATA -------------


def load_airports(path, use_ids=False):
    """
    Read airports.csv with headers:
    id,name,city,country,iata,icao,latitude,longitude,...
    Returns a dict keyed by:
      - id (string) if use_ids=True
      - code (IATA prefer, else ICAO) if use_ids=False
    Value: (name, city, country, lat, lon)
    
    NOTE: Stores BOTH IATA and ICAO as keys to maximize route matching
    """
    airports = {}
    with open(path, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            aid   = (row.get("id") or "").strip()
            iata  = (row.get("iata") or "").strip()
            icao  = (row.get("icao") or "").strip()
            name  = (row.get("name") or "").strip()
            city  = (row.get("city") or "").strip()
            country = (row.get("country") or "").strip()
            lat   = row.get("latitude")
            lon   = row.get("longitude")

            # Skip if coords missing
            if not lat or not lon:
                continue
            try:
                latf, lonf = float(lat), float(lon)
            except ValueError:
                continue

            info = (name, city, country, latf, lonf)

            if use_ids:
                if aid:
                    airports[aid] = info
            else:
                # Store under BOTH IATA and ICAO codes to handle either in routes
                if iata:
                    airports[iata] = info
                if icao:
                    airports[icao] = info

    return airports


def load_routes(path, use_ids=False, max_routes=None, max_stops=1):
    """
    Read routes_to_use.csv with headers:
    airline,airline_id,src_airport,src_id,dst_airport,dst_id,codeshare,stops,equipment
    Returns list of (src_key, dst_key) where key is ID or code per use_ids.
    Filters to routes with stops <= max_stops.
    Deduplicates directed pairs.
    """
    routes = []
    seen = set()
    with open(path, newline="", encoding="utf-8") as f:
        r = csv.DictReader(f)
        for row in r:
            # pick keys
            if use_ids:
                src = (row.get("src_id") or "").strip()
                dst = (row.get("dst_id") or "").strip()
            else:
                # prefer IATA code in src_airport/dst_airport (OpenFlights uses codes here)
                src = (row.get("src_airport") or "").strip()
                dst = (row.get("dst_airport") or "").strip()

            if not src or not dst:
                continue

            # stops filter
            stops = row.get("stops")
            try:
                stops_val = int(stops) if stops not in (None, "") else 0
            except ValueError:
                stops_val = 0
            if stops_val > max_stops:
                continue

            key = (src, dst)
            if key in seen:
                continue
            seen.add(key)
            routes.append(key)

            if max_routes and len(routes) >= max_routes:
                break
    return routes


# ------------- MAIN -------------
def main():
    if not Path(AIRPORTS_CSV).exists():
        raise SystemExit(f"Missing {AIRPORTS_CSV}")
    if not Path(ROUTES_CSV).exists():
        raise SystemExit(f"Missing {ROUTES_CSV}")

    airports = load_airports(AIRPORTS_CSV, use_ids=args.use_ids)
    routes   = load_routes(ROUTES_CSV, use_ids=args.use_ids,
                       max_routes=args.max_routes, max_stops=args.max_stops)


    # Center map roughly (lat, lon); you can tweak to your region of interest
    m = folium.Map(location=[20, 0], tiles="cartodbpositron", zoom_start=2, control_scale=True)

    # Add airports as a clustered layer
    markers = []
    for apid, (name, city, country, lat, lon) in airports.items():
        label = f"{name} — {city}, {country} (ID: {apid})"
        markers.append([lat, lon, label])
    FastMarkerCluster(
        data=[[lat, lon] for lat, lon, _ in markers],
        name="Airports"
    ).add_to(m)

    # Add route polylines (thin and semi-transparent for density)
    routes_layer = folium.FeatureGroup(name="Routes", show=True)
    missing = 0
    missing_codes = set()
    for i, (src, dst) in enumerate(routes, 1):
        if src not in airports or dst not in airports:
            missing += 1
            if src not in airports:
                missing_codes.add(src)
            if dst not in airports:
                missing_codes.add(dst)
            continue
        _, _, _, lat1, lon1 = airports[src]
        _, _, _, lat2, lon2 = airports[dst]

        # Build path points: straight or great-circle interpolation
        pts = gc_intermediate_points(lon1, lat1, lon2, lat2, steps=args.gc_steps)
        # Folium expects [lat, lon]
        latlon = [(lat, lon) for (lat, lon) in pts]

        folium.PolyLine(
            latlon,
            weight=args.weight,
            opacity=args.opacity,
            tooltip=f"{src} → {dst}",
        ).add_to(routes_layer)

        if i % 5000 == 0:
            print(f"{i} routes processed...")

    routes_layer.add_to(m)

    folium.LayerControl(collapsed=False).add_to(m)
    m.save(OUTPUT_HTML)
    
    print(f"✅ Saved: {OUTPUT_HTML}")
    print(f"   Routes drawn: {len(routes) - missing}")
    print(f"   Routes skipped: {missing}")
    if missing_codes:
        print(f"   Missing airport codes: {len(missing_codes)}")
        print(f"   Sample missing codes: {list(missing_codes)[:10]}")

if __name__ == "__main__":
    main()
