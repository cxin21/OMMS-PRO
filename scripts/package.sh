#!/usr/bin/env bash
# OMMS-PRO 打包脚本
# 使用: ./scripts/package.sh
#
# 打包策略:
# 1. 复制源代码和配置
# 2. 不复制 node_modules (节省带宽和时间)
# 3. 安装时通过 npm install 获取所有依赖
#
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
RELEASE_DIR="${PROJECT_ROOT}/release/omms-pro-${TIMESTAMP}"
RELEASE_NAME="omms-pro-${TIMESTAMP}"

echo "=== OMMS-PRO 打包开始 ==="
echo "版本: $(node -e "console.log(require('./package.json').version)")"
echo "输出目录: ${RELEASE_DIR}"

# 1. 创建发布目录
mkdir -p "${RELEASE_DIR}"

# 2. 复制源代码
echo "复制源代码..."
cp -r "${PROJECT_ROOT}/src" "${RELEASE_DIR}/"
cp -r "${PROJECT_ROOT}/agents" "${RELEASE_DIR}/"

# 3. 复制配置文件
echo "复制配置文件..."
cp "${PROJECT_ROOT}/config.json" "${RELEASE_DIR}/" 2>/dev/null || true
cp "${PROJECT_ROOT}/config.default.json" "${RELEASE_DIR}/"

# 4. 复制 package.json、tsconfig.json 和 README
echo "复制元数据..."
cp "${PROJECT_ROOT}/package.json" "${RELEASE_DIR}/"
cp "${PROJECT_ROOT}/tsconfig.json" "${RELEASE_DIR}/"
cp "${PROJECT_ROOT}/README.md" "${RELEASE_DIR}/" 2>/dev/null || true

# 5. 创建 data 目录 (避免首次运行时的权限问题)
mkdir -p "${RELEASE_DIR}/data"

# ========== Unix/Linux/Mac 启动脚本 (.sh) ==========
cat > "${RELEASE_DIR}/start.sh" << 'STARTSCRIPT'
#!/usr/bin/env bash
# OMMS-PRO 启动脚本

# 检测 Node 版本
NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "错误: OMMS-PRO 需要 Node.js >= 20，当前版本: $(node --version)"
    echo "请安装 Node.js 20+: https://nodejs.org/"
    exit 1
fi

# 默认配置
PORT="${OMMS_PORT:-3000}"
HOST="${OMMS_HOST:-0.0.0.0}"

echo "启动 OMMS-PRO..."
echo "API 地址: http://localhost:${PORT}/api/v1"
echo "Web UI: http://localhost:${PORT}"

# 启动服务 (使用 tsx 运行 TypeScript 源码)
node --import tsx src/index.ts &
PID=$!

echo "进程 PID: $PID"

# 等待服务就绪
sleep 3

# 检查服务是否正常启动
if curl -s "http://localhost:${PORT}/api/v1/memories/degradation-stats" > /dev/null 2>&1; then
    echo "✓ OMMS-PRO 启动成功!"
else
    echo "✗ OMMS-PRO 启动可能有问题，请检查日志"
fi

# trap 信号处理
trap "echo '正在停止 OMMS-PRO...'; kill $PID 2>/dev/null; exit 0" SIGINT SIGTERM

# 保持进程运行
wait $PID
STARTSCRIPT

chmod +x "${RELEASE_DIR}/start.sh"

# ========== Windows 批处理脚本 (.bat) ==========
cat > "${RELEASE_DIR}/start.bat" << 'WINBAT'
@echo off
REM OMMS-PRO 启动脚本 (Windows)

REM 检测 Node 版本
node --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到 Node.js，请先安装 https://nodejs.org/
    exit /b 1
)

REM 解析 Node 版本
for /f "tokens=*" %%v in ('node --version') do set NODE_VERSION=%%v
echo Node 版本: %NODE_VERSION%

REM 检查版本 (需要 >= 20)
for /f "tokens=1,2 delims=v." %%a in ("%NODE_VERSION%") do (
    if %%a LSS 20 (
        echo 错误: OMMS-PRO 需要 Node.js ^>= 20，当前版本: %NODE_VERSION%
        exit /b 1
    )
)

REM 默认配置
set PORT=%OMMS_PORT%
if "%PORT%"=="" set PORT=3000
set HOST=%OMMS_HOST%
if "%HOST%"=="" set HOST=0.0.0.0

echo 启动 OMMS-PRO...
echo API 地址: http://localhost:%PORT%/api/v1
echo Web UI: http://localhost:%PORT%

REM 启动服务 (使用 tsx 运行 TypeScript 源码)
start /B node --import tsx src/index.js > nul 2>&1

REM 等待服务就绪
timeout /t 3 /nobreak >nul

REM 检查服务是否正常启动
curl -s "http://localhost:%PORT%/api/v1/memories/degradation-stats" >nul 2>&1
if errorlevel 1 (
    echo 警告: OMMS-PRO 启动可能有问题，请检查日志
) else (
    echo 启动成功! OMMS-PRO 已在后台运行
)

echo 按任意键退出...
pause >nul
WINBAT

# ========== Windows 安装脚本 (.bat) ==========
cat > "${RELEASE_DIR}/install.bat" << 'WININSTALL'
@echo off
REM OMMS-PRO 安装脚本 (Windows)

echo === OMMS-PRO 安装程序 ===

REM 检测 Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo 错误: 未找到 Node.js，请先安装 https://nodejs.org/
    exit /b 1
)

REM 解析 Node 版本
for /f "tokens=*" %%v in ('node --version') do set NODE_VERSION=%%v
echo Node 版本: %NODE_VERSION%

REM 检查版本
for /f "tokens=1,2 delims=v." %%a in ("%NODE_VERSION%") do (
    if %%a LSS 20 (
        echo 错误: OMMS-PRO 需要 Node.js ^>= 20，当前版本: %NODE_VERSION%
        exit /b 1
    )
)

echo 安装依赖 (这可能需要几分钟)...
call npm install
if errorlevel 1 (
    echo npm install 失败
    exit /b 1
)

echo.
echo === 安装完成 ===
echo 启动服务: start.bat 或双击 start.bat
WININSTALL

# ========== Unix 安装脚本 (.sh) ==========
cat > "${RELEASE_DIR}/install.sh" << 'INSTALLSCRIPT'
#!/usr/bin/env bash
# OMMS-PRO 安装脚本

set -e

echo "=== OMMS-PRO 安装程序 ==="

# 检测 Node.js
if ! command -v node &> /dev/null; then
    echo "错误: 未找到 Node.js，请先安装 https://nodejs.org/"
    exit 1
fi

NODE_VERSION=$(node --version 2>/dev/null | sed 's/v//' | cut -d. -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo "错误: OMMS-PRO 需要 Node.js >= 20，当前版本: $(node --version)"
    exit 1
fi

echo "Node.js 版本: $(node --version)"

echo "安装依赖 (这可能需要几分钟)..."
npm install

echo "✓ 安装完成!"
echo ""
echo "启动服务: ./start.sh"
INSTALLSCRIPT

chmod +x "${RELEASE_DIR}/install.sh"

# ========== 配置文件模板 ==========
cat > "${RELEASE_DIR}/config.example.json" << 'CONFIGEXAMPLE'
{
  "$schema": "./config.schema.json",
  "agentId": "your-agent-id",
  "sessionPrefix": "session",
  "projectDir": "/path/to/your/project",
  "agentsDir": "./agents",
  "llmExtraction": {
    "maxMemoriesPerCapture": 5,
    "similarityThreshold": 0.9,
    "confidenceThreshold": 0.5,
    "enableLLMSummarization": true,
    "llmProvider": "custom",
    "llmApiKey": "YOUR_API_KEY",
    "llmEndpoint": "https://your-llm-endpoint.com/api",
    "llmModel": "your-model"
  },
  "api": {
    "port": 3000,
    "host": "0.0.0.0"
  },
  "memoryService": {
    "agentId": "default-agent",
    "capture": {
      "extractionTimeout": 30000
    }
  }
}
CONFIGEXAMPLE

# ========== README ==========
cat > "${RELEASE_DIR}/README.md" << 'README'
# OMMS-PRO

OMMS-PRO (Omniscient Memory Management System Professional) 是一个融合记忆宫殿架构的记忆管理系统。

## 系统要求

- Node.js >= 20
- 内存 >= 4GB
- 磁盘 >= 1GB

## 安装

### Windows
1. 解压 ZIP 文件
2. 双击 `install.bat` 或在命令提示符中运行 `install.bat`
3. 双击 `start.bat` 启动服务

### Linux/Mac
```bash
./install.sh
./start.sh
```

## 配置

复制 `config.example.json` 为 `config.json` 并修改配置。

## API 文档

启动后访问: http://localhost:3000/api/v1

### 主要接口

- `POST /api/v1/memories/capture` - 捕获记忆
- `POST /api/v1/memories/recall` - 召回记忆 (含 LLM 整理)
- `GET /api/v1/memories/degradation-stats` - 获取遗忘统计

## 故障排除

### 启动失败 "Cannot find package 'tsx'"
如果遇到此错误，请重新运行安装脚本：
```bash
./install.sh
```

### 权限问题
如果遇到 data 目录权限问题，请创建目录并设置权限：
```bash
mkdir -p data logs
chmod 755 data logs
```

## 插件 (Claude Code)

如需在 Claude Code 中使用 OMMS 插件，请参考 Claude Code 插件开发文档。
README

# ========== 打包 ==========
echo "创建安装包..."

# 创建 tar.gz (Linux/Mac)
echo "创建 tar.gz..."
cd "${PROJECT_ROOT}/release"
tar -czf "omms-pro-${TIMESTAMP}.tar.gz" "${RELEASE_NAME}/"

# 创建 zip (Windows)
echo "创建 zip..."
cd "${RELEASE_DIR}/.."
zip -rq "omms-pro-${TIMESTAMP}.zip" "${RELEASE_NAME}/"

# 清理临时目录
rm -rf "${RELEASE_DIR}"

echo ""
echo "=== 打包完成 ==="
echo "Tarball (Linux/Mac): ${PROJECT_ROOT}/release/omms-pro-${TIMESTAMP}.tar.gz"
echo "Zip (Windows): ${PROJECT_ROOT}/release/omms-pro-${TIMESTAMP}.zip"
echo ""
echo "大小:"
echo "  tar.gz: $(du -h ${PROJECT_ROOT}/release/omms-pro-${TIMESTAMP}.tar.gz | cut -f1)"
echo "  zip: $(du -h ${PROJECT_ROOT}/release/omms-pro-${TIMESTAMP}.zip | cut -f1)"
echo ""
echo "使用方法:"
echo ""
echo "Linux/Mac:"
echo "  tar -xzf omms-pro-${TIMESTAMP}.tar.gz"
echo "  cd ${RELEASE_NAME}"
echo "  ./install.sh"
echo "  ./start.sh"
echo ""
echo "Windows:"
echo "  解压 omms-pro-${TIMESTAMP}.zip"
echo "  cd omms-pro-${TIMESTAMP}"
echo "  install.bat"
echo "  start.bat"