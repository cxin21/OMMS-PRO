#!/usr/bin/env node
/**
 * Shared utility library for OMMS Claude Plugin hooks
 * 共享工具函数库
 */

const path = require('path');
const https = require('https');
const http = require('http');
const fs = require('fs');

// ============================================================
// Configuration & Environment
// ============================================================

const getEnv = (key, defaultValue) => {
  return process.env[key] || defaultValue;
};

const getOmmsApiUrl = () => {
  const port = getEnv('OMMS_API_PORT', '3000');
  return getEnv('OMMS_API_URL', `http://localhost:${port}/api/v1`);
};

const getAgentId = () => {
  // 优先从环境变量读取（hook 输入在调用前通过 stdin 传递，所以环境变量更可靠）
  return getEnv('OMMS_AGENT_ID', 'claude-code');
};

const getSessionId = () => {
  // 优先从环境变量读取
  return getEnv('OMMS_SESSION_ID', `session-${Math.floor(Date.now() / 1000)}`);
};

/**
 * 从 hook 输入获取 agentId（如果通过 stdin 传递）
 */
const getAgentIdFromHookInput = (hookInput) => {
  return hookInput?.agentId || hookInput?.agent_id || getAgentId();
};

/**
 * 从 hook 输入获取 sessionId（如果通过 stdin 传递）
 */
const getSessionIdFromHookInput = (hookInput) => {
  return hookInput?.sessionId || hookInput?.session_id || getSessionId();
};

const getProjectDir = () => getEnv('CLAUDE_PROJECT_DIR', '/tmp');

// ============================================================
// Logging
// ============================================================

let logQueue = [];

const log = async (level, message, data = null) => {
  const apiUrl = getOmmsApiUrl();
  const payload = JSON.stringify({
    level,
    message,
    module: 'omms-plugin',
    data,
    timestamp: Date.now()
  });

  try {
    const url = new URL(`${apiUrl}/system/logs/write`);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 3000),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      },
      timeout: 5000
    };

    return new Promise((resolve) => {
      const req = client.request(options, () => {
        resolve();
      });
      req.on('error', () => resolve());
      req.on('timeout', () => {
        req.destroy();
        resolve();
      });
      req.write(payload);
      req.end();
    });
  } catch (e) {
    // Silent fail
  }
};

// ============================================================
// HTTP Helpers
// ============================================================

const fetchJson = (url, options = {}) => {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const isHttps = urlObj.protocol === 'https:';
    const client = isHttps ? https : http;

    const opts = {
      hostname: urlObj.hostname,
      port: urlObj.port || (isHttps ? 443 : 3000),
      path: urlObj.pathname + urlObj.search,
      method: options.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      },
      timeout: options.timeout || 30000
    };

    const body = options.body ? JSON.stringify(options.body) : undefined;
    if (body) {
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = client.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          if (!data || !data.trim()) {
            resolve({ success: false, error: 'server_empty_response', statusCode: res.statusCode });
            return;
          }
          resolve(JSON.parse(data));
        } catch (e) {
          resolve({ success: false, error: 'invalid_response', details: data.substring(0, 200), statusCode: res.statusCode });
        }
      });
    });

    req.on('error', (e) => {
      resolve({ success: false, error: 'network_error', details: e.message, code: e.code });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ success: false, error: 'timeout', details: `Request timed out after ${opts.timeout / 1000}s` });
    });

    if (body) req.write(body);
    req.end();
  });
};

// ============================================================
// Hook Input Parsing
// ============================================================

const readHookInput = async () => {
  return new Promise((resolve) => {
    let input = '';
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', () => {
      try {
        resolve(JSON.parse(input || '{}'));
      } catch (e) {
        resolve({});
      }
    });
  });
};

// ============================================================
// Conversation Parsing
// ============================================================

const parseConversationFile = async (jsonlFile) => {
  const lines = fs.readFileSync(jsonlFile, 'utf8').split('\n').filter(l => l.trim());
  const messages = [];

  for (const line of lines) {
    try {
      const entry = JSON.parse(line);
      if (entry.type === 'user') {
        const msg = entry.message || {};
        let content = msg.content || '';
        if (typeof content !== 'string') content = '';
        if (content.trim()) {
          messages.push({ role: 'user', content: content, timestamp: entry.timestamp });
        }
      } else if (entry.type === 'assistant') {
        const msg = entry.message || {};
        if (msg.role === 'assistant') {
          const contentBlocks = msg.content || [];
          let text = '';
          for (const block of contentBlocks) {
            if (block.type === 'text') {
              text += block.text || '';
            }
          }
          if (text.trim()) {
            messages.push({ role: 'assistant', content: text, timestamp: entry.timestamp });
          }
        }
      }
    } catch (e) {}
  }

  const pairs = [];
  for (let i = 0; i < messages.length - 1; i++) {
    if (messages[i].role === 'user' && messages[i + 1].role === 'assistant') {
      pairs.push({ user: messages[i].content, assistant: messages[i + 1].content });
    }
  }

  const fullContent = messages.map(m => {
    const prefix = m.role === 'user' ? '【用户】' : '【助手】';
    return prefix + m.content;
  }).join('\n\n');

  return {
    conversationFile: jsonlFile,
    totalMessages: messages.length,
    interactionPairs: pairs.length,
    fullContent,
    pairs: pairs.slice(-50)
  };
};

const getLastUserMessage = async (transcriptPath) => {
  if (!fs.existsSync(transcriptPath)) return '';

  const lines = fs.readFileSync(transcriptPath, 'utf8').split('\n').filter(l => l.trim());

  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(lines[i]);
      if (entry.type === 'user') {
        const msg = entry.message || {};
        let content = msg.content || '';
        if (typeof content === 'string' && content.trim()) {
          return content.substring(0, 2000);
        }
      }
    } catch (e) {}
  }
  return '';
};

// ============================================================
// Exports
// ============================================================

module.exports = {
  getEnv,
  getOmmsApiUrl,
  getAgentId,
  getSessionId,
  getAgentIdFromHookInput,
  getSessionIdFromHookInput,
  getProjectDir,
  log,
  fetchJson,
  readHookInput,
  parseConversationFile,
  getLastUserMessage
};
