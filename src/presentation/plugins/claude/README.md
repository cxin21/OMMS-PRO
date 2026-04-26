# OMMS-PRO Claude Code Plugin

OMMS-PRO memory system integration for Claude Code - enables cross-session memory recall, capture, and user profile management.

## Features

- **Cross-session memory persistence** - Recall and capture memories across Claude Code sessions
- **User profile management** - Automatic L0 identity and L1 preference tracking
- **Conversation recording** - Mandatory recording of all assistant responses
- **Semantic search** - Vector-based memory recall using Memory Palace architecture

## Installation

### From local directory

```bash
# Add the marketplace
claude plugin marketplace add --source directory --path /path/to/OMMS-PRO/src/presentation/plugins/claude omms-pro-local

# Enable the plugin
# In ~/.claude/settings.json, add to enabledPlugins:
# "omms-pro@omms-pro-local": true
```

### Verify installation

```bash
/reload-plugins
```

Expected output should include: `3 hooks`

## Plugin Structure

```
omms-pro/
├── .claude-plugin/
│   ├── plugin.json          # Plugin manifest
│   └── marketplace.json     # Marketplace configuration
├── .mcp.json                # MCP server configuration
├── hooks/
│   ├── hooks.json           # Hook definitions
│   ├── session-start/
│   │   └── init-session     # SessionStart: Initialize session context
│   ├── pre-response/
│   │   └── recall-memory    # UserPromptSubmit: Auto-recall relevant memories
│   └── session-end/
│       └── capture-session  # SessionEnd: Capture session memory
├── skills/
│   ├── memory/
│   │   └── SKILL.md         # Memory recall/capture skill
│   └── conversation-recorder/
│       └── SKILL.md         # Mandatory conversation recording skill
├── server/
│   ├── index.ts             # MCP server entry point
│   ├── config.ts            # Server configuration
│   └── types.ts             # Type definitions
└── package.json
```

## Hooks

| Event              | Script               | Description                                      |
| :----------------- | :------------------- | :----------------------------------------------- |
| `SessionStart`     | `init-session`       | Initialize session, load user profile context    |
| `UserPromptSubmit` | `recall-memory`      | Auto-recall relevant memories before processing  |
| `SessionEnd`       | `capture-session`    | Capture full conversation as memory on exit      |

## Skills

### `/omms-pro:memory`

Use when you need to recall or capture memories. Invoke before responding if memories might be relevant.

**Available MCP tools:**

- `memory_recall` - Search for relevant memories using semantic similarity
- `memory_capture` - Store conversation summaries for future recall

### `/omms-pro:conversation-recorder`

**MANDATORY**: Must call `omms_record_context` after every assistant response to record conversation.

This is required because Claude Code hooks can only capture user input, not assistant replies. Without this, all assistant responses are lost from the memory system.

## MCP Server

The plugin includes an MCP server (`.mcp.json`) that connects to OMMS-PRO API.

**Configuration** (`.mcp.json`):

```json
{
  "mcpServers": {
    "omms-pro": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/dist/index.js"],
      "env": {
        "OMMS_API_URL": "http://localhost:3000/api/v1"
      }
    }
  }
}
```

**Available tools**: `memory_recall`, `memory_capture`

**Environment variable**:

```bash
export OMMS_API_URL=http://localhost:3000/api/v1  # Default
```

## Environment Variables

| Variable         | Description                          | Default                        |
| :--------------- | :----------------------------------- | :----------------------------- |
| `OMMS_API_URL`   | OMMS-PRO API base URL                | `http://localhost:3000/api/v1` |
| `OMMS_AGENT_ID`  | Agent identifier for memory capture  | `claude-<timestamp>`           |

## Configuration

### settings.json

```json
{
  "enabledPlugins": {
    "omms-pro@omms-pro-local": true
  }
}
```

**Important**: The plugin key must use the full `name@marketplace` format.

### marketplace.json

```json
{
  "name": "omms-pro-local",
  "metadata": {
    "description": "OMMS-PRO memory system plugin"
  },
  "owner": {
    "name": "OMMS-PRO"
  },
  "plugins": [
    {
      "name": "omms-pro",
      "version": "1.0.0",
      "source": "./"
    }
  ]
}
```

**Note**: The `description` field must be inside `metadata`, not at the root level.

## Troubleshooting

### Hooks not showing in /reload-plugins

1. Check `enabledPlugins` key format: must be `"omms-pro@omms-pro-local"`, not `"omms-pro"`
2. Validate plugin: `claude plugin validate /path/to/plugin`
3. Check `marketplace.json` has `description` inside `metadata`, not at root level

### Hook scripts not executing

```bash
# Ensure scripts are executable
chmod +x hooks/session-start/init-session
chmod +x hooks/pre-response/recall-memory
chmod +x hooks/session-end/capture-session
```

### MCP server not connecting

1. Verify OMMS-PRO API is running: `curl http://localhost:3000/api/v1/system/health`
2. Check `OMMS_API_URL` environment variable
3. Ensure `@modelcontextprotocol/sdk` is installed: `npm install`

## Development

```bash
# Build TypeScript
npm run build

# Start MCP server in dev mode
npm run dev

# Validate plugin structure
claude plugin validate .
```

## License

Part of the OMMS-PRO project.
