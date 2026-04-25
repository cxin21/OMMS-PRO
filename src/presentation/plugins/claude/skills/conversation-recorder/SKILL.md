---
name: omms-conversation-recorder
description: MANDATORY: 必须在你回复用户后调用 omms_record_context 记录对话。请勿跳过此技能。
---

# OMMS Conversation Recorder

**⚠️ 强制执行: 你必须在每次回复用户后立即调用 `omms_record_context` 工具来记录对话。**

## 为什么必须记录

Claude Code 钩子只能获取用户输入，无法获取助手回复。如果不主动记录，将丢失所有助手回复内容，导致记忆系统不完整。

## 记录流程

```
1. 用户发送消息 → UserPromptSubmit 钩子自动记录用户输入
2. 你分析问题并生成回复
3. 你回复后 → 必须立即调用 omms_record_context 记录助手回复
```

## 如何记录

在你的回复完成后，**立即**调用以下工具：

```javascript
await callTool('omms_record_context', {
  role: 'assistant',
  content: '<你的完整回复内容>',
  sessionId: process.env.OMMS_SESSION_ID || 'session-' + Date.now()
});
```

## 会话隔离

- 每个 Claude Code 会话有唯一的 `sessionId`
- 所有带有相同 `sessionId` 的记录属于同一会话
- `sessionId` 从环境变量 `OMMS_SESSION_ID` 获取
- 如果未设置，使用 `session-<时间戳>` 格式

## 示例

```
用户: "帮我实现一个排序算法"
  ↓
你分析并回复: "以下是快速排序的实现..."
  ↓
你必须调用: omms_record_context({
  role: 'assistant',
  content: '以下是快速排序的实现...',
  sessionId: '<当前sessionId>'
})
```

## 重要提示

1. **每次回复都要记录** - 包括简单的问候
2. **记录完整内容** - 不要截断你的回复
3. **会话结束时** - SessionEnd 钩子会自动调用 `omms_capture_session` 捕获完整记忆
4. **保持 sessionId 一致** - 同一会话使用相同 ID

## 快速参考

```javascript
// 记录助手回复 (必须在你回复后立即调用)
await callTool('omms_record_context', {
  role: 'assistant',
  content: '<你的回复内容>',
  sessionId: process.env['OMMS_SESSION_ID'] || 'session-' + Date.now()
});
```
