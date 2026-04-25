#!/bin/bash
# OMMS-PRO MCP Wrapper Script
# This script starts the OMMS-PRO MCP server for Claude Code integration

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 设置插件根目录环境变量（供 hooks 使用）
export OMMS_PLUGIN_ROOT="$SCRIPT_DIR"

# 设置 API URL
export OMMS_API_URL="${OMMS_API_URL:-http://localhost:3000/api/v1}"
export OMMS_AGENT_ID="${OMMS_AGENT_ID:-claude-code}"

# Check if node_modules exists
if [ ! -d "node_modules" ]; then
    echo "Installing dependencies..."
    npm install
fi

# Start the MCP server
exec npx tsx server/index.ts
