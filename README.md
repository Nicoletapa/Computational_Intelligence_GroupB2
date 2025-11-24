# Computational_Intelligence_GroupB2

This project was our final exam for the course Computational Intelligence fall 2025

## Overview

This repository contains two components:

1. Interactive Flask Web Application (`app.py`)  
   Provides a map-based interface for exploring the global air transportation network and simulating network disruptions.

2. Network Analysis Program (`network_analysis.ipynb`)  
   Performs offline quantitative analysis of the air transportation network using graph theory.

Both components rely on the cleaned datasets located in the `Data/` directory:

- Data/airports_cleaned.csv  
- Data/routes_cleaned.csv

---

## Repository Structure

.  
├── app.py  
├── network_analysis.ipynb  
├── Data/  
│   ├── airports_cleaned.csv  
│   ├── routes_cleaned.csv  
│   ├── index.html  

---

# 1. Flask Web Application (`app.py`)

## Purpose

The Flask web application provides:

- Visualization of airports and global routes  
- Community detection coloring (Louvain)  
- Removal of airports to simulate disruptions  
- Automatic selection of critical airports based on centrality  
- Metrics before and after disruption:
  - Global efficiency  
  - Size of the largest connected component  
  - List of stranded airports  

## How to Run

Install dependencies:

pip install flask pandas networkx

Start the server:

python app.py

Access the application in a browser:

http://127.0.0.1:5000

## Endpoints

/ (GET) — Load the interactive map  
/analyze (POST) — Run disruption simulation  
/health (GET) — Status check and dataset summary  

---

# 2. Network Analysis Program (`network_analysis.ipynb`)

## Purpose

The analysis script performs detailed examination of the global airline network, including:

- Degree centrality (in-degree, out-degree, total degree)  
- Betweenness centrality  
- Clustering coefficients  
- Connected components  
- Diameter of the largest component  
- Robustness tests by removing top hubs  
- Geographic plots using Cartopy  
- Spring-layout subgraph visualizations  

## How to Run

Install dependencies:

pip install pandas networkx matplotlib cartopy numpy

Execute the script:

python network_analysis.ipynb

## Outputs

- Summary statistics  
- Rankings of airports by degree and betweenness  
- Degree distribution histogram  
- Geographic map of important airports  
- Subgraph visualizations  
- Robustness results (hub removal effects)  

---

## Datasets

### airports_cleaned.csv

Contains airport metadata:

- ID, IATA, ICAO  
- Name, city, country  
- Latitude, longitude  

### routes_cleaned.csv

Contains:

- Source airport  
- Destination airport  
- Number of stops  
- Airline metadata (when available)  

---

## Technologies Used

- Python 3  
- Flask  
- NetworkX  
- Pandas  
- Matplotlib  
- Cartopy  
- HTML, CSS, JavaScript  

---

## Notes for Grading

- All code is self-contained.  
- Flask application runs via: `python app.py`  
- Analysis script runs via: `python network_analysis.py`  
- Required datasets are in the `Data/` directory.
