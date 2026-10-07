#!/usr/bin/env bash
# Compiles LOGOS_SEO_Ontology_Standalone_Final with the official LOGOS compiler (all passes + release closure).
# LOGOS_REPO points at a LOGOS checkout with node_modules installed.
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
repo="${LOGOS_REPO:-$HOME/yaml/LOGOS-main-20260928/LOGOS-main}"
if [ ! -x "$repo/node_modules/.bin/tsx" ]; then
  echo "LOGOS repository not found at $repo (set LOGOS_REPO)." >&2
  exit 2
fi
cd "$repo"
exec ./node_modules/.bin/tsx packages/build/src/cli.ts "$here/LOGOS_SEO_Ontology_Standalone_Final/ontology" --out "$here/.ontology-build"
