# 两台服务器 IP 直连切换教程

这份教程按你当前实际情况写：

- 国内服务器（主节点）：`182.92.64.216`
- 国外服务器（备节点）：`163.192.198.190`
- 当前项目目录：`/root/dlhost/data/overtime-calculator`
- 当前数据目录：`/root/dlhost/data/overtime-calculator-data`
- 目标：彻底不用 Docker，直接宿主机运行 Node.js

这套方案的特点：

- 改 `index.html` / `app.js` 后，浏览器直接刷新就能看到
- 改 `server.js` 后，只需要 `systemctl restart overtime-app`
- 两台服务器继续保留双机同步
- 先不折腾 Caddy，直接使用 `http://IP:3000`

如果你后面确认稳定，再决定要不要加宿主机版 Caddy。

## 先说结论

你最终访问地址会变成：

- 主节点：`http://182.92.64.216:3000`
- 备节点：`http://163.192.198.190:3000`

双机同步会变成：

- 主节点同步到：`http://163.192.198.190:3000`
- 备节点同步到：`http://182.92.64.216:3000`

## 执行顺序

必须按这个顺序：

1. 先切国外服务器 `163.192.198.190`
2. 再切国内服务器 `182.92.64.216`

这样可以减少同时中断的时间。

## 准备信息

你需要保留当前 Docker 里的这 3 个值，后面会原样写入配置文件：

- `ADMIN_PASSWORD`
- `ADMIN_SECRET`
- `SYNC_SHARED_SECRET`

从你现在的记录看，这几个值你已经有了，直接照旧填回去就行。

## 第一部分：切换国外服务器 163.192.198.190

### 1. 登录服务器

```bash
ssh root@163.192.198.190
```

### 2. 安装 Node.js 20 和编译依赖

```bash
apt update
apt install -y ca-certificates curl gnupg git build-essential python3 make g++
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt update
apt install -y nodejs
node -v
npm -v
```

正常情况下，`node -v` 应该显示 `v20.x`。

### 3. 进入项目目录并安装依赖

```bash
cd /root/dlhost/data/overtime-calculator
npm install
```

### 4. 备份当前数据库

```bash
mkdir -p /root/dlhost/backup
cp /root/dlhost/data/overtime-calculator-data/overtime.db /root/dlhost/backup/overtime-backup-$(date +%F-%H%M%S).db
```

### 5. 创建宿主机环境变量文件

```bash
cat > /etc/overtime-app.env << 'EOF'
PORT=3000
DB_PATH=/root/dlhost/data/overtime-calculator-data/overtime.db
ADMIN_PASSWORD=这里填你当前线上管理员密码
ADMIN_SECRET=这里填你当前线上ADMIN_SECRET
NODE_ID=oracle-backup
SYNC_PEER_URL=http://182.92.64.216:3000
SYNC_SHARED_SECRET=这里填你当前线上SYNC_SHARED_SECRET
EOF
```

注意：

- `ADMIN_PASSWORD` 改成你当前正在用的值
- `ADMIN_SECRET` 改成你当前正在用的值
- `SYNC_SHARED_SECRET` 改成你当前正在用的值
- 不要自己重新随机生成，不然双机登录态和同步会断

### 6. 创建 systemd 服务

```bash
cat > /etc/systemd/system/overtime-app.service << 'EOF'
[Unit]
Description=Overtime Calculator App
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/dlhost/data/overtime-calculator
EnvironmentFile=/etc/overtime-app.env
ExecStart=/usr/bin/node /root/dlhost/data/overtime-calculator/server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
```

### 7. 先停掉 Docker 里的旧应用容器

```bash
docker stop overtime-app || true
docker rm overtime-app || true
```

如果这台机器上还有 Caddy 容器，并且它占着 `80/443`，可以暂时不动，因为我们现在直接走 `3000`，不会冲突。

### 8. 启动新的宿主机服务

```bash
systemctl daemon-reload
systemctl enable overtime-app
systemctl start overtime-app
systemctl status overtime-app --no-pager
```

### 9. 查看日志确认启动成功

```bash
journalctl -u overtime-app -n 50 --no-pager
```

你应该能看到类似：

```text
共享加班系统服务已启动: http://localhost:3000
数据库文件: /root/dlhost/data/overtime-calculator-data/overtime.db
节点标识: oracle-backup
双机同步: 已启用 -> http://182.92.64.216:3000
```

### 10. 开放 3000 端口

如果你有防火墙，执行：

```bash
ufw allow 3000/tcp || true
```

如果你是云服务器，还要去云平台安全组里放行 `3000/tcp`。

### 11. 在服务器本机测试

```bash
curl http://127.0.0.1:3000
```

### 12. 在你电脑浏览器测试

打开：

```text
http://163.192.198.190:3000
```

只要页面能打开，这台就切换成功。

## 第二部分：切换国内服务器 182.92.64.216

### 1. 登录服务器

```bash
ssh root@182.92.64.216
```

### 2. 安装 Node.js 20 和编译依赖

```bash
apt update
apt install -y ca-certificates curl gnupg git build-essential python3 make g++
mkdir -p /etc/apt/keyrings
curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
apt update
apt install -y nodejs
node -v
npm -v
```

### 3. 进入项目目录并安装依赖

```bash
cd /root/dlhost/data/overtime-calculator
npm install
```

### 4. 备份当前数据库

```bash
mkdir -p /root/dlhost/backup
cp /root/dlhost/data/overtime-calculator-data/overtime.db /root/dlhost/backup/overtime-main-$(date +%F-%H%M%S).db
```

### 5. 创建宿主机环境变量文件

```bash
cat > /etc/overtime-app.env << 'EOF'
PORT=3000
DB_PATH=/root/dlhost/data/overtime-calculator-data/overtime.db
ADMIN_PASSWORD=这里填你当前线上管理员密码
ADMIN_SECRET=这里填你当前线上ADMIN_SECRET
NODE_ID=cn-main
SYNC_PEER_URL=http://163.192.198.190:3000
SYNC_SHARED_SECRET=这里填你当前线上SYNC_SHARED_SECRET
EOF
```

### 6. 创建 systemd 服务

```bash
cat > /etc/systemd/system/overtime-app.service << 'EOF'
[Unit]
Description=Overtime Calculator App
After=network.target

[Service]
Type=simple
WorkingDirectory=/root/dlhost/data/overtime-calculator
EnvironmentFile=/etc/overtime-app.env
ExecStart=/usr/bin/node /root/dlhost/data/overtime-calculator/server.js
Restart=always
RestartSec=3
User=root

[Install]
WantedBy=multi-user.target
EOF
```

### 7. 停掉 Docker 旧应用容器

```bash
docker stop overtime-app || true
docker rm overtime-app || true
```

### 8. 启动新的宿主机服务

```bash
systemctl daemon-reload
systemctl enable overtime-app
systemctl start overtime-app
systemctl status overtime-app --no-pager
```

### 9. 查看日志

```bash
journalctl -u overtime-app -n 50 --no-pager
```

你应该能看到类似：

```text
共享加班系统服务已启动: http://localhost:3000
数据库文件: /root/dlhost/data/overtime-calculator-data/overtime.db
节点标识: cn-main
双机同步: 已启用 -> http://163.192.198.190:3000
```

### 10. 放行 3000 端口

```bash
ufw allow 3000/tcp || true
```

云平台安全组也要放行 `3000/tcp`。

### 11. 本机测试

```bash
curl http://127.0.0.1:3000
```

### 12. 浏览器测试

打开：

```text
http://182.92.64.216:3000
```

只要页面能打开，主节点切换完成。

## 第三部分：验证双机同步是否正常

先在主节点页面新增一条数据，然后去备节点刷新。

再在备节点页面新增一条数据，然后去主节点刷新。

如果两边都能看到对方新增的数据，说明双机同步正常。

如果你想直接看日志：

### 在国内服务器执行

```bash
journalctl -u overtime-app -f
```

### 在国外服务器执行

```bash
journalctl -u overtime-app -f
```

## 后续更新怎么做

以后就非常简单了。

### 1. 修改前端文件后上线

如果你改的是：

- `index.html`
- `app.js`
- `ai-directory-data.js`

在每台服务器执行：

```bash
cd /root/dlhost/data/overtime-calculator
git pull
```

然后浏览器直接刷新页面即可。

### 2. 修改后端文件后上线

如果你改的是 `server.js`，在每台服务器执行：

```bash
cd /root/dlhost/data/overtime-calculator
git pull
systemctl restart overtime-app
```

### 3. 如果依赖变了

如果 `package.json` 有变化，在每台服务器执行：

```bash
cd /root/dlhost/data/overtime-calculator
git pull
npm install
systemctl restart overtime-app
```

## 如果要彻底清掉 Docker

确认宿主机版服务已经稳定运行以后，再执行：

```bash
docker ps -a
docker rm -f overtime-app || true
docker rm -f overtime-caddy || true
docker image prune -f
```

先别删除旧的数据目录：

```bash
/root/dlhost/data/overtime-calculator-data
```

因为你现在宿主机版 Node 还在直接用这个目录里的数据库。

## 回滚方法

如果宿主机服务启动失败，你可以立刻回滚到原 Docker 方式：

```bash
systemctl stop overtime-app || true
docker run -d \
  --name overtime-app \
  --restart unless-stopped \
  -p 3000:3000 \
  -e ADMIN_PASSWORD='这里填你当前线上管理员密码' \
  -e ADMIN_SECRET='这里填你当前线上ADMIN_SECRET' \
  -e NODE_ID='当前节点ID' \
  -e SYNC_PEER_URL='对端地址' \
  -e SYNC_SHARED_SECRET='这里填你当前线上SYNC_SHARED_SECRET' \
  -v /root/dlhost/data/overtime-calculator-data:/app/data \
  overtime-calculator:1.0
```

## 最后提醒

这次切换里最重要的是这 3 点：

- 两边 `SYNC_SHARED_SECRET` 必须完全一致
- 两边 `NODE_ID` 不能相同
- 云平台安全组必须放行 `3000`

你如果按这份文档一步步跑，能直接完成切换。
