/**
 * Profile Tools - 用户画像工具（1 个）
 *
 * - profile_get: 获取用户画像
 */

import { createLogger } from '../../../shared/logging';
import type { MCPTool, ToolMetadata } from '../types';
import type { ProfileManager } from '../../../services/profile/profile-manager';

const logger = createLogger('mcp-profile-tools');

export function createProfileTools(profileManager: ProfileManager): Array<{ tool: MCPTool; metadata: ToolMetadata }> {
  return [
    {
      tool: {
        name: 'profile_get',
        description: '获取用户画像信息（包括 Persona、偏好、标签和统计）',
        inputSchema: {
          type: 'object',
          properties: {
            userId: { type: 'string', description: '用户 ID' },
          },
          required: ['userId'],
        },
        handler: async (params) => {
          try {
            const profile = await profileManager.getProfile(params.userId);

            if (!profile) {
              return {
                content: [{ type: 'text', text: `用户画像未找到：${params.userId}` }],
                isError: true,
              };
            }

            return {
              content: [{
                type: 'text',
                text: `用户画像：\n` +
                  `- 用户 ID：${profile.userId}\n` +
                  `- Persona：${profile.persona ? JSON.stringify(profile.persona, null, 2) : '未设置'}\n` +
                  `- 偏好：${profile.preferences ? `已设置（置信度 ${(profile.preferences.confidence * 100).toFixed(1)}%）` : '未设置'}\n` +
                  `- 标签：${profile.tags?.map((t: any) => t.name).join(', ') || '无'}\n` +
                  `- 统计：${JSON.stringify(profile.stats ?? {}, null, 2)}`,
              }],
            };
          } catch (error: any) {
            logger.error('Failed to get profile', error);
            return {
              content: [{ type: 'text', text: `获取画像失败：${error.message}` }],
              isError: true,
            };
          }
        },
      },
      metadata: { category: 'profile', version: '2.0.0' },
    },
  ];
}
