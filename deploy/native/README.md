# 非 Docker 部署说明

这套项目本身就是一个 `Node.js + Express + SQLite` 单体应用，不依赖容器编排才能运行。

改成宿主机直跑以后：

- 修改 `index.html` / `app.js` / `ai-directory-data.js` 后，浏览器刷新即可看到最新前端代码
- 修改 `server.js` 后，只需要 `systemctl restart overtime-app`
- 两台服务器之间的双机同步继续使用原来的 `NODE_ID`、`SYNC_PEER_URL`、`SYNC_SHARED_SECRET`
- `Caddy` 直接安装在宿主机，不再放在 Docker 里

## 推荐目录

```bash
/opt/overtime-app/
├─ current/              # Git 仓库代码
├─ data/                 # SQLite 数据目录
└─ shared.env            # 运行环境变量
```

建议把仓库克隆到：

```bash
/opt/overtime-app/current
```

## 1. 安装运行环境

以 Ubuntu / Debian 为例：

```bash
sudo apt update
sudo apt install -y curl gnupg2 ca-certificates lsb-release git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs caddy build-essential python3 make g++
```

说明：

- `better-sqlite3` 可能需要本机编译工具，所以把 `build-essential`、`python3`、`make`、`g++` 一起装上更稳
- `Caddy` 由宿主机的 systemd 服务直接管理

## 2. 准备目录

```bash
sudo mkdir -p /opt/overtime-app/current
sudo mkdir -p /opt/overtime-app/data
sudo chown -R $USER:$USER /opt/overtime-app
```

## 3. 拉代码并安装依赖

```bash
cd /opt/overtime-app/current
git clone <你的仓库地址> .
npm install
```

如果后续只是更新前端页面文件，一般不需要重新执行 `npm install`。

## 4. 配置环境变量

在服务器上创建：

```bash
sudo cp deploy/native/env.main.example /opt/overtime-app/shared.env
```

主节点示例见 [env.main.example](/c:/Users/23119/Desktop/fsdownload/deploy/native/env.main.example)，备节点示例见 [env.backup.example](/c:/Users/23119/Desktop/fsdownload/deploy/native/env.backup.example)。

按你当前环境，建议这样分工：

- 国外服务器 `163.192.198.190` 作为主站，对外域名使用 `rili.khcy.dpdns.org`
- 国内服务器 `182.92.64.216` 作为备份同步节点，没有域名时直接用 IP

关键点：

- 两台服务器的 `NODE_ID` 必须不同
- A 机的 `SYNC_PEER_URL` 指向 B 机域名
- B 机的 `SYNC_PEER_URL` 指向 A 机域名
- 两台服务器的 `SYNC_SHARED_SECRET` 必须一致
- `DB_PATH` 建议统一放到 `/opt/overtime-app/data/overtime.db`

## 5. 配置 systemd

把仓库里的服务模板复制到系统目录：

```bash
sudo cp deploy/native/overtime-app.service /etc/systemd/system/overtime-app.service
sudo systemctl daemon-reload
sudo systemctl enable overtime-app
sudo systemctl start overtime-app
```

查看状态：

```bash
sudo systemctl status overtime-app
sudo journalctl -u overtime-app -f
```

## 6. 配置宿主机 Caddy

把模板复制过去后修改域名：

```bash
sudo cp deploy/native/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

如果按你当前环境部署：

- 国外服务器 Caddy 直接使用 `rili.khcy.dpdns.org`
- 国内服务器没有域名时，可以先不装 Caddy，直接由 Node 监听 `3000`

证书和反向代理都由宿主机 Caddy 处理。

## 7. 更新方式

### 前端文件更新

如果你改的是：

- `index.html`
- `app.js`
- `ai-directory-data.js`

执行：

```bash
cd /opt/overtime-app/current
git pull
```

然后浏览器直接刷新页面即可。

如果浏览器还显示旧页面，按一次强制刷新：`Ctrl+F5`。

### 后端代码更新

如果你改的是 `server.js`：

```bash
cd /opt/overtime-app/current
git pull
sudo systemctl restart overtime-app
```

### 依赖变化

如果 `package.json` 有变化：

```bash
cd /opt/overtime-app/current
git pull
npm install
sudo systemctl restart overtime-app
```

## 8. 两台服务器怎么配

### 主服务器

- `NODE_ID=cn-main`
- 建议部署在国外服务器 `163.192.198.190`
- 对外访问地址：`https://rili.khcy.dpdns.org`
- `SYNC_PEER_URL=http://182.92.64.216`

### 备份服务器

- `NODE_ID=oracle-backup`
- 建议部署在国内服务器 `182.92.64.216`
- `SYNC_PEER_URL=https://rili.khcy.dpdns.org`

注意：

- 这里双机同步走的是应用自己的 HTTP 同步接口，不是 Docker 功能
- 所以去掉 Docker 后，这套同步仍然能工作
- 国外主站可以通过域名 `https://rili.khcy.dpdns.org` 提供访问和接收同步
- 国内备机没有域名时，主站回连备机可以直接使用 `http://182.92.64.216`
- 如果以后国内服务器也有域名，再把它改成 `https://你的域名`

## 9. 建议的生产习惯

- 国外主站建议只开放 `80` 和 `443`，`3000` 不对公网开放
- 国内备机如果没有域名，又要让国外主站能同步访问，就需要开放 `3000`
- 公网只开放 `80` 和 `443` 给 Caddy
- 数据目录单独放在 `/opt/overtime-app/data`
- 定时备份 `overtime.db`，不要只依赖双机同步

## 一条最短迁移路径

如果你想从现有 Docker 平滑切到宿主机直跑，可以按这个顺序：

1. 在两台机器安装 `nodejs` 和 `caddy`
2. 把项目代码放到 `/opt/overtime-app/current`
3. 把现在容器里的环境变量原样写进 `/opt/overtime-app/shared.env`
4. 用 `systemd` 跑起 `node server.js`
5. 用宿主机 `Caddy` 反代到 `127.0.0.1:3000`
6. 确认新服务正常后，再停掉原 Docker 容器

这样风险最小，也最符合你“以后改网页文件直接刷新”的目标。
