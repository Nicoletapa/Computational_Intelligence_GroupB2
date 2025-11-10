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

# Detect OS and use appropriate command to open the HTML file
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    open airport_routes_map.html
elif [[ "$OSTYPE" == "msys" || "$OSTYPE" == "cygwin" || "$OSTYPE" == "win32" ]]; then
    # Windows (Git Bash, Cygwin, or native)
    start airport_routes_map.html
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    xdg-open airport_routes_map.html
else
    echo "⚠️  Could not detect OS. Please open airport_routes_map.html manually."
fi