#!/usr/bin/env bash
# ============================================================
# Project Deerghayu — Start NutriTrace Server
# ============================================================
# Runs the NutriTrace backend (API + serves built frontend)
# at http://localhost:3001
#
# First-time run: open http://localhost:3001 to create admin account
# Subsequent runs: login with your account
# ============================================================

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
NUTRITRACE_DIR="$SCRIPT_DIR/../temp-nutritrace"
SERVER_DIR="$NUTRITRACE_DIR/server"

echo "🥗 Project Deerghayu — Starting NutriTrace"
echo "─────────────────────────────────────────────"

# Check if server already running
if lsof -i :3001 -sTCP:LISTEN &>/dev/null; then
  echo "✅ NutriTrace already running at http://localhost:3001"
  open http://localhost:3001
  exit 0
fi

# Check that server dependencies are installed
if [ ! -d "$SERVER_DIR/node_modules" ]; then
  echo "📦 Installing server dependencies..."
  cd "$SERVER_DIR" && npm install --silent
fi

# Check that frontend is built
if [ ! -d "$SERVER_DIR/dist" ]; then
  echo "🔨 Building frontend..."
  cd "$NUTRITRACE_DIR" && node_modules/.bin/vite build
  cp -r "$NUTRITRACE_DIR/dist" "$SERVER_DIR/dist"
fi

echo "🚀 Starting server on http://localhost:3001"
cd "$SERVER_DIR" && node index.js &
SERVER_PID=$!

# Wait for server to be ready
echo -n "⏳ Waiting for server..."
for i in {1..20}; do
  sleep 1
  if curl -s http://localhost:3001/api/auth/status &>/dev/null; then
    echo " ready!"
    break
  fi
  echo -n "."
done

echo ""
echo "─────────────────────────────────────────────"
echo "✅ NutriTrace is running!"
echo "   URL:  http://localhost:3001"
echo "   PID:  $SERVER_PID"
echo ""
echo "📊 Next: Import your food database"
echo "   Settings → Import Data → Spreadsheet (CSV)"
echo "   File: importer/output/deerghayu-food-database.csv"
echo "─────────────────────────────────────────────"

# Open in browser
sleep 1
open http://localhost:3001

wait $SERVER_PID
