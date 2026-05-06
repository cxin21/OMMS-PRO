#!/usr/bin/env node
/**
 * SessionStart Hook: Initialize session and output L0/L1 user context
 * Session 开始钩子：初始化会话并输出 L0/L1 用户上下文
 */

const { log, getOmmsApiUrl, getAgentId, getSessionId, getProjectDir, fetchJson } = require('../utils.cjs');

const main = async () => {
  const apiUrl = getOmmsApiUrl();
  const agentId = getAgentId();
  const sessionId = getSessionId();
  const projectDir = getProjectDir();

  await log('info', '=== SESSION START (JS VERSION) ===', { agentId, sessionId, projectDir });

  // Fetch L0/L1 context
  let contextResult;
  try {
    contextResult = await fetchJson(`${apiUrl}/profile/${agentId}/context?sessionId=${sessionId}`);
  } catch (e) {
    contextResult = { success: false, data: {} };
  }

  await log('debug', 'L0/L1 context API response', { response: contextResult });

  const userName = contextResult.data?.userName || contextResult.data?.l0?.name || 'User';
  const l0Context = contextResult.data?.l0 || {};
  const l1Context = contextResult.data?.l1 || {};

  // Output OMMS context block
  console.log('');
  console.log('<OMMS_PRO_SESSION>');
  console.log('## Session Initialized');
  console.log(`Agent ID: ${agentId}`);
  console.log(`Session ID: ${sessionId}`);
  console.log('');
  console.log('## L0/L1 User Profile Context');

  console.log('### L0: Identity');
  if (l0Context.name) console.log(`- Name: ${l0Context.name}`);
  if (l0Context.language) console.log(`- Language: ${l0Context.language}`);
  if (l0Context.occupation) console.log(`- Occupation: ${l0Context.occupation}`);

  console.log('### L1: Preferences');
  if (l1Context.topics) {
    if (Array.isArray(l1Context.topics)) {
      console.log(`- Topics: ${l1Context.topics.map(t => t.topic || t).join(', ')}`);
    }
  }
  if (l1Context.engagementLevel) console.log(`- Engagement: ${l1Context.engagementLevel}`);
  if (l1Context.totalInteractions) console.log(`- Total Interactions: ${l1Context.totalInteractions}`);

  console.log('');
  console.log('## Relevant Memories');
  console.log('Use memory_recall tool to get more context when needed.');
  console.log('Use omms_record_context after responding to save important information.');
  console.log('</OMMS_PRO_SESSION>');
  console.log('');

  await log('info', '=== SESSION START END (JS) ===', { agentId, sessionId });
  process.exit(0);
};

main().catch(async (error) => {
  console.error('SessionStart hook fatal error:', error);
  await log('error', 'SessionStart hook fatal error', { error: error.message });
  process.exit(1);
});
