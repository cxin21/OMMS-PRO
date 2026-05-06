#!/usr/bin/env node
/**
 * PreResponse Hook: Recall relevant memories before generating response
 * 预响应钩子：在生成响应之前召回相关记忆
 */

const { log, getOmmsApiUrl, getAgentIdFromHookInput, getSessionIdFromHookInput, fetchJson, readHookInput } = require('../utils.cjs');

const main = async () => {
  const apiUrl = getOmmsApiUrl();

  await log('info', '=== PRE-RESPONSE RECALL (JS VERSION) ===', {});

  const hookInput = await readHookInput();
  const userPrompt = hookInput.prompt;
  const agentId = getAgentIdFromHookInput(hookInput);
  const sessionId = getSessionIdFromHookInput(hookInput);

  await log('info', 'Hook input parsed', { agentId, sessionId });

  if (!userPrompt || typeof userPrompt !== 'string' || !userPrompt.trim()) {
    await log('debug', 'No user prompt in hook input', { prompt: userPrompt });
    process.exit(0);
  }

  await log('debug', 'Got user prompt', { promptLength: userPrompt.length, agentId, sessionId });

  // Call memory recall API
  const recallResult = await fetchJson(`${apiUrl}/memories/recall`, {
    method: 'POST',
    body: {
      query: userPrompt.trim(),
      limit: 3,
      agentId: agentId,
      sessionId: sessionId
    }
  });

  const memories = recallResult.data?.memories || [];
  const consolidatedSummary = recallResult.data?.consolidatedSummary;

  if (memories.length > 0) {
    await log('info', 'Found relevant memories', { count: memories.length, hasConsolidatedSummary: !!consolidatedSummary });

    console.log('');
    console.log('<OMMS_RECALL>');

    // 如果有 LLM 整理的摘要，显示整理后的内容
    if (consolidatedSummary && consolidatedSummary.summary) {
      console.log('## Relevant Memories - AI Consolidated Summary');
      console.log('');
      console.log('### Summary');
      console.log(consolidatedSummary.summary);
      if (consolidatedSummary.keywords && consolidatedSummary.keywords.length > 0) {
        console.log('');
        console.log('### Keywords');
        console.log(consolidatedSummary.keywords.join(', '));
      }
      if (consolidatedSummary.insights && consolidatedSummary.insights.length > 0) {
        console.log('');
        console.log('### Key Insights');
        consolidatedSummary.insights.forEach((insight, i) => {
          console.log(`- ${insight}`);
        });
      }
    } else {
      // 否则显示原始记忆列表（保留最多200字符）
      console.log('## Relevant Memories from Previous Sessions');
      memories.forEach((m, i) => {
        const content = m.content?.substring(0, 200) || '';
        console.log(`${i + 1}. [${m.type || 'fact'}] ${content}`);
      });
    }
    console.log('</OMMS_RECALL>');
  }

  await log('info', '=== PRE-RESPONSE RECALL END (JS) ===', { sessionId, memoriesFound: memories.length });
  process.exit(0);
};

main().catch(async (error) => {
  console.error('PreResponse hook fatal error:', error);
  await log('error', 'PreResponse hook fatal error', { error: error.message });
  process.exit(1);
});
