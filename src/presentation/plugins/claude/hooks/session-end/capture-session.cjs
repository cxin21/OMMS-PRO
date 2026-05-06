#!/usr/bin/env node
/**
 * SessionEnd Hook: Final memory capture at session end
 * Session 结束钩子：最终的记忆捕获
 */

const path = require('path');
const https = require('https');
const http = require('http');

const { log, getOmmsApiUrl, getAgentId, getSessionId, getProjectDir, fetchJson, readHookInput, parseConversationFile } = require('../utils.cjs');

const triggerPersonaBuild = async (apiUrl, agentId, sessionId) => {
  try {
    const url = new URL(`${apiUrl}/profile/${agentId}/persona/build`);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const payload = JSON.stringify({ sessionId });
    const options = {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 3000),
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    };

    const req = client.request(options, () => {
      // Fire and forget
    });
    req.on('error', () => { /* Silent fail */ });
    req.write(payload);
    req.end();
  } catch (e) {
    // Silent fail
  }
};

const main = async () => {
  const apiUrl = getOmmsApiUrl();
  const agentId = getAgentId();
  const sessionId = getSessionId();
  const projectDir = getProjectDir();

  await log('info', '=== SESSION END HOOK START (JS VERSION) ===', { agentId, sessionId, projectDir });

  const hookInput = await readHookInput();
  const claudeSessionId = hookInput.session_id || '';
  const transcriptPath = hookInput.transcript_path || '';

  await log('debug', 'Hook input parsed', { sessionId: claudeSessionId, transcriptPath });

  let convFile = '';
  if (transcriptPath && require('fs').existsSync(transcriptPath)) {
    convFile = transcriptPath;
    await log('info', 'Using transcript_path from hook', { file: convFile });
  } else {
    await log('warn', 'No transcript_path provided or file not found', {});
    console.log('[OMMS] No transcript path provided');
    process.exit(0);
  }

  if (!require('fs').existsSync(convFile)) {
    await log('error', 'Conversation file not found', { file: convFile });
    console.log('[OMMS] Conversation file not found:', convFile);
    process.exit(0);
  }

  const fileStats = require('fs').statSync(convFile);
  const fileSize = fileStats.size;

  await log('info', 'Found conversation file', {
    file: convFile,
    size: fileSize
  });

  if (fileSize < 100) {
    await log('warn', 'Conversation file too small', { file: convFile });
    process.exit(0);
  }

  const parseResult = await parseConversationFile(convFile);

  if (parseResult.totalMessages === 0) {
    await log('warn', 'No messages found in conversation', { file: convFile });
    console.log('[OMMS] No messages found in conversation file');
    process.exit(0);
  }

  // Use base64 encoding
  const fullContentB64 = Buffer.from(parseResult.fullContent, 'utf8').toString('base64');

  await log('info', 'Capturing conversation', {
    messages: parseResult.totalMessages,
    interactions: parseResult.interactionPairs,
    file: convFile,
    contentSize: fullContentB64.length
  });

  const captureResult = await fetchJson(`${apiUrl}/memories/capture`, {
    method: 'POST',
    body: {
      contentBase64: fullContentB64,
      agentId: agentId,
      sessionId: sessionId,
      type: 'event',
      metadata: {
        source: 'session-end-hook-js',
        messageCount: parseResult.totalMessages,
        interactionPairs: parseResult.interactionPairs,
        conversationFile: convFile,
        projectDir: projectDir,
        conversationPairs: parseResult.pairs
      }
    },
    timeout: 120000
  });

  if (captureResult.success) {
    const memoryUid = captureResult.data?.uid || 'N/A';
    await log('info', 'Session memory captured successfully', { memoryUid });
    console.log(`[OMMS] Session captured: ${parseResult.interactionPairs} interactions, ${parseResult.totalMessages} messages. Memory: ${memoryUid}`);

    // Trigger persona build async
    triggerPersonaBuild(apiUrl, agentId, sessionId);
  } else {
    const error = captureResult.error || 'unknown';
    const details = captureResult.details || '';
    const statusCode = captureResult.statusCode || '';
    await log('error', 'Session memory capture failed', { error, details, statusCode });
    console.log(`[OMMS] Failed to capture: ${error} (${statusCode}) - ${details}`);
  }

  await log('info', '=== SESSION END HOOK END (JS) ===', { agentId });
  process.exit(captureResult.success ? 0 : 1);
};

main().catch(async (error) => {
  console.error('SessionEnd hook fatal error:', error);
  await log('error', 'SessionEnd hook fatal error', { error: error.message });
  process.exit(1);
});
