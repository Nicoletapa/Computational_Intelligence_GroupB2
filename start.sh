#!/bin/bash
# Start script for airport routes visualization
# This script runs the main.py visualization and opens the result

set -e  # Exit on error

echo "Starting airport routes visualization..."

python3 main.py \
 --airports airports.csv \
 --routes routes.csv \
 --output airport_routes_map.html

echo "✅ Visualization complete!"
echo "Opening airport_routes_map.html..."

open airport_routes_map.html