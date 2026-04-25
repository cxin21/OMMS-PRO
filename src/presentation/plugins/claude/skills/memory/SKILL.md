---
name: omms-pro-memory
description: Use this skill when you need to recall or capture memories in OMMS-PRO. Invoke before responding if memories might be relevant.
---

# OMMS-PRO Memory System

This skill provides access to the OMMS-PRO cross-session memory system.

## When to Use

- **Before responding** to any query where past context might be relevant
- **After completing significant work** to save the outcome
- When the user asks about **previous sessions or decisions**
- When working on **ongoing projects** that span multiple sessions

## Available Tools

### memory_recall
Search for relevant memories before responding.

```
Use Case: Before responding to user queries
Query: What to search for (description of the current topic)
Limit: Number of memories to return (default: 5)
```

### memory_capture
Save important information after responding.

```
Use Case: After completing work that should be remembered
Content: Summary of what happened/decided/completed
SessionId: Optional session grouping
Type: fact | event | learning | decision (default: event)
Importance: 1-10 score (default: 5)
```

### memory_list
Browse all stored memories.

```
Use Case: Reviewing available context
Limit: Number of memories to show (default: 20)
Type: Optional filter by memory type
```

## Quick Reference

```javascript
// Recall before responding
const result = await callTool('memory_recall', {
  query: 'user project architecture decisions',
  limit: 3
});

// Capture after work
const result = await callTool('memory_capture', {
  content: 'Completed database migration for project X. Key decisions: used postgresql, implemented soft deletes.',
  type: 'event',
  importance: 8
});
```

## One Memory Per Session

The system maintains one memory per session. Subsequent captures to the same session update the existing record rather than creating duplicates. Use the sessionId to track related conversations.

## Architecture

OMMS-PRO uses a Memory Palace architecture with vector search for semantic recall. Memories are indexed by importance, type, scope, and semantic embedding for fast retrieval.