
import express from 'express';
import { OMMS } from './src/index';
import { createRESTAPIServer } from './src/api';

async function main() {
  console.log('🚀 启动 OMMS-PRO 系统...');

  try {
    // 1. 初始化 OMMS 系统
    console.log('📦 初始化 OMMS 核心系统...');
    const omms = new OMMS();
    await omms.initialize();
    console.log('✅ OMMS 核心系统初始化完成');

    // 2. 创建 API 服务器
    console.log('🌐 启动 REST API 服务器...');
    const server = createRESTAPIServer({
      deps: {
        memoryService: omms.memoryService,
        dreamingManager: omms.dreamingManager,
        profileManager: omms.profileManager,
        graphStore: omms.graphStore,
        captureService: omms.captureService,
        agentManager: omms.agentManager,
        roomManager: omms.roomManager,
      },
    });

    // 3. 创建 Express 应用并挂载 API 到 /api 路径
    const app = express();
    app.use('/api', server.getApp());

    // 4. 启动服务器
    const httpServer = app.listen(3000, '0.0.0.0', () => {
      console.log('\n🎉 OMMS-PRO 系统启动成功！');
      console.log('📍 API 服务器: http://localhost:3000');
      console.log('📍 API 端点: http://localhost:3000/api/v1');
      console.log('💡 按 Ctrl+C 停止服务器\n');
    });

    // 处理关闭信号
    const shutdown = async () => {
      console.log('\n🛑 正在关闭服务器...');
      await omms.shutdown();
      httpServer.close(() => {
        console.log('✅ 服务器已关闭');
        process.exit(0);
      });
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    console.error('❌ 启动失败:', error);
    process.exit(1);
  }
}

main();
