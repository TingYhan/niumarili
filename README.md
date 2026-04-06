# 加班时长计算系统

一个基于 Node.js + Express + SQLite 的共享加班管理系统，支持多用户记录、公告投票、已读回执、公告图片上传、每日内容展示与 AI 工具导航。

## 功能概览

- 多用户共享加班记录管理（录入、查看、删除）
- 月度/年度统计、加班时长与金额汇总
- 公告系统
  - 普通公告、投票公告
  - 具名投票（可查看谁同意、谁反对）
  - 已读回执（可查看已读人员）
  - 多图上传、拖拽上传、点击放大查看
- 每日内容
  - 每日壁纸、每日视频、每日一言
  - 每日图片/视频默认隐藏，按需展开加载

## 技术栈

- 前端：原生 HTML / CSS / JavaScript
- 后端：Node.js + Express
- 数据库：SQLite（better-sqlite3）

## 环境要求（推荐生产标准）

### 必需环境

- Linux 服务器（推荐 Ubuntu 22.04 LTS / Debian 12）
- Node.js 20 LTS（建议 20.x，避免过新版本导致 `better-sqlite3` 编译兼容问题）
- npm 10+
- Git

### 反向代理与进程守护（推荐）

- Nginx（80/443 入口）
- PM2（Node 进程守护、开机自启）

### 服务器最小配置建议

- CPU：1 核
- 内存：1 GB（建议 2 GB）
- 磁盘：10 GB+

## 配置项说明

项目使用环境变量（可通过 `.env` 管理）：

- `PORT`：服务监听端口，默认 `3000`
- `DB_PATH`：SQLite 数据库路径，默认 `./data/overtime.db`
- `ADMIN_PASSWORD`：管理员密码
- `ADMIN_SECRET`：管理员 Token 签名密钥（生产务必更换）
- `OLLAMA_BASE_URL`：Ollama 服务地址（可选）
- `OLLAMA_MODEL`：默认 Ollama 模型（可选）

生产环境必须至少修改：

- `ADMIN_PASSWORD`
- `ADMIN_SECRET`

## 本地开发快速启动

```bash
npm install
npm start
```

访问：`http://localhost:3000`

## 生产部署流程（可直接照做）

以下示例以 Ubuntu 22.04 为例，域名假设为 `overtime.example.com`。

### 1. 安装系统依赖

```bash
sudo apt update
sudo apt install -y git curl nginx build-essential
```

说明：`build-essential` 用于 `better-sqlite3` 可能触发的本地编译。

### 2. 安装 Node.js 20 LTS

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

### 3. 拉取代码并安装依赖

```bash
sudo mkdir -p /opt/overtime-app
sudo chown -R $USER:$USER /opt/overtime-app
cd /opt/overtime-app
git clone <你的仓库地址> .
npm install --omit=dev
```

### 4. 配置环境变量

创建 `.env`：

```bash
cat > .env << 'EOF'
PORT=3000
DB_PATH=./data/overtime.db
ADMIN_PASSWORD=请替换为强密码
ADMIN_SECRET=请替换为足够随机的长字符串
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen3.5-uncensored:4b
EOF
```

### 5. 安装并使用 PM2 守护进程

```bash
sudo npm install -g pm2
cd /opt/overtime-app
pm2 start server.js --name overtime-app
pm2 save
pm2 startup
```

按 `pm2 startup` 输出提示执行一次 sudo 命令，完成开机自启。

### 6. 配置 Nginx 反向代理

创建配置：

```bash
sudo tee /etc/nginx/sites-available/overtime-app > /dev/null << 'EOF'
server {
    listen 80;
    server_name overtime.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF
```

启用并重载：

```bash
sudo ln -sf /etc/nginx/sites-available/overtime-app /etc/nginx/sites-enabled/overtime-app
sudo nginx -t
sudo systemctl reload nginx
```

### 7. （推荐）启用 HTTPS

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d overtime.example.com
```

### 8. 验证部署成功

```bash
pm2 status
curl -I http://127.0.0.1:3000
curl -I https://overtime.example.com
```

浏览器打开域名，确认页面可访问、公告和数据读写正常。

## 后续更新流程（生产）

```bash
cd /opt/overtime-app
git pull origin main
npm install --omit=dev
pm2 restart overtime-app
pm2 status
```

## 数据备份与恢复

默认数据库位置：`./data/overtime.db`

### 备份

```bash
cd /opt/overtime-app
mkdir -p backups
cp data/overtime.db backups/overtime-$(date +%F-%H%M%S).db
```

### 恢复

```bash
cd /opt/overtime-app
pm2 stop overtime-app
cp backups/你的备份文件.db data/overtime.db
pm2 start overtime-app
```

## 常见问题

### 1) `better-sqlite3` 安装失败

- 确保 Node 版本为 20 LTS
- Linux 安装 `build-essential`
- Windows 需安装 C++ 构建工具

### 2) 端口已占用

- 修改 `.env` 的 `PORT`
- 或释放占用进程后重启 PM2

### 3) 推送 GitHub 超时

- 常见为网络波动/代理配置问题
- 可先用 `git ls-remote <repo-url>` 测试连通性

## 项目结构

- `server.js`：后端 API、数据库初始化与业务逻辑
- `app.js`：前端交互、渲染与事件处理
- `index.html`：页面结构与样式
- `ai-directory-data.js`：AI 工具导航数据
- `.env`：运行参数与密钥配置（不要提交）
