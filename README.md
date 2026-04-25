# 加班时长计算系统（个人学习）

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

## 环境要求（Docker 部署）

### 必需环境

- Linux 服务器（推荐 Ubuntu 22.04 LTS / Debian 12）
- Docker Engine 24+
- Docker Compose v2
- Git

### 推荐组件

- Caddy（容器方式运行，负责反向代理和 HTTPS）
- 2 GB 内存及以上
- 10 GB 磁盘及以上

### 关于 Node.js

这个项目的部署不需要在宿主机直接安装 Node.js。构建镜像时会使用 `node:20-alpine`，因此只要服务器能正常运行 Docker 即可。仓库根目录需要有 `Dockerfile`，才能执行镜像构建。

## 配置项说明

项目使用环境变量（可通过 `.env` 管理）：

- `PORT`：服务监听端口，默认 `3000`
- `DB_PATH`：SQLite 数据库路径，默认 `./data/overtime.db`
- `ADMIN_PASSWORD`：管理员密码
- `ADMIN_SECRET`：管理员 Token 签名密钥

部署环境至少修改：

- `ADMIN_PASSWORD`
- `ADMIN_SECRET`

## 本地开发快速启动

如果你只是本地调试代码，可以继续使用：

```bash
npm install
npm start
```

访问：`http://localhost:3000`

## 非 Docker 部署

如果你想改完网页文件后直接刷新生效，而不是每次重建镜像，可以直接改成宿主机部署：

- Node.js 直接运行 `server.js`
- Caddy 直接安装在宿主机
- 两台服务器继续保留 `NODE_ID`、`SYNC_PEER_URL`、`SYNC_SHARED_SECRET`

仓库里已经补了可直接使用的模板和说明：

- `deploy/native/README.md`
- `deploy/native/ip-cutover-guide.md`
- `deploy/native/overtime-app.service`
- `deploy/native/Caddyfile`
- `deploy/native/env.main.example`
- `deploy/native/env.backup.example`

## Docker 部署流程（推荐）

下面以 Ubuntu 22.04 为例，域名假设为 `overtime.example.com`。示例里使用：

- 应用容器：`overtime-app`
- Caddy 容器：`overtime-caddy`
- Docker 网络：`web`

### 1. 安装 Docker 和 Compose

```bash
sudo apt update
sudo apt install -y ca-certificates curl gnupg git
curl -fsSL https://get.docker.com | sudo sh
sudo systemctl enable docker
sudo systemctl start docker
docker version
docker compose version
```

### 2. 拉取代码

```bash
sudo mkdir -p /opt/overtime-app
sudo chown -R $USER:$USER /opt/overtime-app
cd /opt/overtime-app
git clone <你的仓库地址> .
```

### 3. 配置环境变量

项目根目录放一个 `.env`，用于容器启动时注入参数：

```bash
cat > .env << 'EOF'
PORT=3000
DB_PATH=/app/data/overtime.db
ADMIN_PASSWORD=请替换为强密码
ADMIN_SECRET=请替换为足够随机的长字符串
EOF
```

说明：

- `DB_PATH` 指向容器内数据目录
- 部署环境必须替换 `ADMIN_PASSWORD` 和 `ADMIN_SECRET`

### 4. 构建应用镜像


```bash
docker build -t overtime-calculator:1.0 .
```

如果你的 Docker 版本提示 legacy builder 已弃用，可以改用 BuildKit：

```bash
docker buildx build -t overtime-calculator:1.0 --load .
```

### 5. 创建 Docker 网络

```bash
docker network create web
```

如果网络已存在，可以忽略报错。

### 6. 启动应用容器

```bash
docker rm -f overtime-app 2>/dev/null || true
docker run -d \
  --name overtime-app \
  --restart unless-stopped \
  --network web \
  --env-file .env \
  -v /opt/overtime-app/data:/app/data \
  overtime-calculator:1.0
```

说明：

- 这里把数据库挂载到宿主机 `/opt/overtime-app/data`
- 容器内部端口仍然是 `3000`

### 7. 启动 Caddy 容器

如果 Caddy 也是容器，建议单独放在同一个 `web` 网络里，通过容器名反代到应用容器。

创建 `Caddyfile`：

```bash
cat > /opt/overtime-app/Caddyfile << 'EOF'
overtime.example.com {
    reverse_proxy overtime-app:3000
}
EOF
```

启动 Caddy：

```bash
docker rm -f overtime-caddy 2>/dev/null || true
docker run -d \
  --name overtime-caddy \
  --restart unless-stopped \
  --network web \
  -p 80:80 \
  -p 443:443 \
  -v /opt/overtime-app/Caddyfile:/etc/caddy/Caddyfile \
  -v /opt/overtime-app/caddy_data:/data \
  -v /opt/overtime-app/caddy_config:/config \
  caddy:2
```

Caddy 会自动申请和续期 HTTPS 证书，前提是：

- 域名已解析到服务器公网 IP
- 80 和 443 端口已放行

### 8. 验证部署成功

```bash
docker ps
docker logs -f overtime-app
docker logs -f overtime-caddy
curl -I http://127.0.0.1
curl -I https://overtime.example.com
```

浏览器打开域名，确认页面可访问、公告可以新增、图片可以上传、投票和已读功能正常。

## 后续更新流程（Docker）

应用更新时，通常按这个顺序：

```bash
cd /opt/overtime-app
git pull origin main
docker build -t overtime-calculator:1.0 .
docker rm -f overtime-app
docker run -d \
  --name overtime-app \
  --restart unless-stopped \
  --network web \
  --env-file .env \
  -v /opt/overtime-app/data:/app/data \
  overtime-calculator:1.0
```

如果只改前端静态内容或 README，不影响镜像逻辑，也可以只更新文件而不重新构建。

## 数据备份与恢复

SQLite 数据文件在挂载目录中：

```text
/opt/overtime-app/data/overtime.db
```

### 备份

```bash
cd /opt/overtime-app
mkdir -p backups
cp data/overtime.db backups/overtime-$(date +%F-%H%M%S).db
```

### 恢复

```bash
cd /opt/overtime-app
docker rm -f overtime-app
cp backups/你的备份文件.db data/overtime.db
docker run -d \
  --name overtime-app \
  --restart unless-stopped \
  --network web \
  --env-file .env \
  -v /opt/overtime-app/data:/app/data \
  overtime-calculator:1.0
```

## 运行参数说明

- `PORT`：应用容器监听端口，默认 `3000`
- `DB_PATH`：数据库文件路径，建议在容器中使用 `/app/data/overtime.db`
- `ADMIN_PASSWORD`：管理员密码
- `ADMIN_SECRET`：管理员 Token 密钥

## 常见问题

### 1) `docker build` 提示 legacy builder deprecated

这是提示 Docker 旧构建器将弃用，不影响当前镜像构建成功。建议后续改用：

```bash
docker buildx build -t overtime-calculator:1.0 --load .
```

### 2) `better-sqlite3` 安装失败

- 优先使用 Docker 构建，不要在宿主机上直接编译
- 镜像基于 `node:20-alpine`，容器里会自动安装依赖
- 如果你在宿主机单独开发，才需要额外装 C++ 构建工具

### 3) Caddy 没有自动签证书

- 确认域名已经解析到服务器
- 确认 80/443 已放行
- 查看 `docker logs overtime-caddy`

## 项目结构

- `server.js`：后端 API、数据库初始化与业务逻辑
- `app.js`：前端交互、渲染与事件处理
- `index.html`：页面结构与样式
- `ai-directory-data.js`：AI 工具导航数据

## 项目结构

- `server.js`：后端 API、数据库初始化与业务逻辑
- `app.js`：前端交互、渲染与事件处理
- `index.html`：页面结构与样式
- `ai-directory-data.js`：AI 工具导航数据
