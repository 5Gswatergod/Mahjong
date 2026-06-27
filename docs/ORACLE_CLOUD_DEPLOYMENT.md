# Oracle Cloud + Cloudflare + GHCR deployment

這份文件把麻將專案部署到第二台 Oracle VM，並使用 Cloudflare 管理 `hydrava.cc` 底下的網域。

## 目標架構

```txt
Browser
  -> Cloudflare DNS / Proxy
  -> mahjong.hydrava.cc
  -> Oracle VM 2 public IP
  -> Caddy container :80/:443
  -> mahjong container :4000
  -> postgres container :5432, internal only
```

建議網域分配：

| Hostname | 用途 | Cloudflare proxy |
| --- | --- | --- |
| `bot.hydrava.cc` | 第一台 VM，Discord bot dashboard | Proxied 或 DNS only |
| `mahjong.hydrava.cc` | 第二台 VM，麻將網站 | DNS only 先拿憑證，再改 Proxied |
| `hydrava.cc` | 可選，主站或麻將 | Proxied 或 DNS only |
| `ssh-bot.hydrava.cc` | 第一台 VM SSH | DNS only |
| `ssh-mahjong.hydrava.cc` | 第二台 VM SSH | DNS only |

DNS 只能依 hostname 分流。若要 `hydrava.cc/bot` 到 VM1、`hydrava.cc/mahjong` 到 VM2，需要額外 reverse proxy 或 Cloudflare Worker；本專案建議直接使用 subdomain。

## GitHub image 流程

本 repo 內有三個 workflow：

| Workflow | 檔案 | 用途 |
| --- | --- | --- |
| `CI` | `.github/workflows/ci.yml` | `npm ci`、typecheck、test、build |
| `Publish Docker Image` | `.github/workflows/publish-image.yml` | build Docker image 並推到 GHCR |
| `Deploy Oracle VM` | `.github/workflows/deploy-oracle.yml` | SSH 到 Oracle VM，拉 image 並重啟 compose |

image 會推到：

```txt
ghcr.io/5gswatergod/mahjong
```

常用 tag：

```txt
latest
sha-<40-character-commit>
codex-oracle-ghcr-deploy
main
```

Production 建議使用 `sha-<commit>`，不要依賴浮動的 `latest`。

如果 GHCR package 是 Private，VM pull image 前需要 `docker login ghcr.io`。最簡單是到 GitHub package settings 把 container package 改成 Public。

## Cloudflare 設定

到 Cloudflare `hydrava.cc` zone 的 DNS records 新增：

```txt
Type  Name          Content
A     mahjong       第二台 Oracle VM public IPv4
A     ssh-mahjong   第二台 Oracle VM public IPv4
```

設定建議：

- `mahjong`: 第一次部署先設 **DNS only**，確認 Caddy 拿到 HTTPS certificate 後再改 **Proxied**。
- `ssh-mahjong`: 一律 **DNS only**。
- SSL/TLS mode: **Full (strict)**。

## Oracle VM ingress

Oracle Console 的 VCN Security List 或 Network Security Group 開：

| Port | Source | 用途 |
| --- | --- | --- |
| TCP 22 | 你的固定 IP | SSH |
| TCP 80 | `0.0.0.0/0` | Caddy HTTP challenge / redirect |
| TCP 443 | `0.0.0.0/0` | HTTPS |

不要公開：

```txt
4000
5432
```

`4000` 只會 bind 到 VM local loopback，Postgres 只在 Docker network 內。

## VM 初始化

登入 VM：

```bash
ssh ubuntu@ssh-mahjong.hydrava.cc
```

更新系統：

```bash
sudo apt update
sudo apt upgrade -y
```

安裝 Docker Engine：

```bash
sudo apt remove -y docker.io docker-compose docker-compose-v2 docker-doc podman-docker containerd runc
sudo apt update
sudo apt install -y ca-certificates curl git
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

登出再登入，確認：

```bash
docker version
docker compose version
```

## 首次手動部署

clone repo：

```bash
cd /home/ubuntu
git clone https://github.com/5Gswatergod/Mahjong.git
cd Mahjong
```

建立 production env：

```bash
cp deploy/oracle.env.example .env
nano .env
```

建議內容：

```env
MAHJONG_IMAGE=ghcr.io/5gswatergod/mahjong:latest

APP_DOMAIN=mahjong.hydrava.cc
WEB_ORIGIN=https://mahjong.hydrava.cc
HOST_PORT=4000

POSTGRES_DB=mahjong
POSTGRES_USER=mahjong
POSTGRES_PASSWORD=replace-with-a-long-random-password
POSTGRES_HOST=postgres
POSTGRES_PORT=5432
```

`DATABASE_URL` is optional. Leave it unset when using the bundled Postgres service; the app builds the database connection from `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_DB`, `POSTGRES_USER`, and `POSTGRES_PASSWORD`. Set `DATABASE_URL` only when pointing the app at an external database.

產生密碼：

```bash
openssl rand -hex 32
```

啟動：

```bash
docker compose --env-file .env -f docker-compose.oracle.yml pull
docker compose --env-file .env -f docker-compose.oracle.yml up -d
```

檢查：

```bash
docker compose --env-file .env -f docker-compose.oracle.yml ps
curl http://127.0.0.1:4000/health
curl -I https://mahjong.hydrava.cc
```

查看 logs：

```bash
docker compose --env-file .env -f docker-compose.oracle.yml logs -f mahjong caddy postgres
```

## GitHub Actions 自動部署

在 VM 建立 deploy key：

```bash
ssh-keygen -t ed25519 -C mahjong-github-actions -f mahjong-actions
ssh-copy-id -i mahjong-actions.pub ubuntu@ssh-mahjong.hydrava.cc
```

取得 VM host key：

```bash
ssh-keyscan -T 10 -t ed25519 -H ssh-mahjong.hydrava.cc > deploy_known_hosts
ssh-keygen -lf deploy_known_hosts -E sha256
```

到 GitHub repo `Settings > Secrets and variables > Actions` 新增：

| Secret | Value |
| --- | --- |
| `ORACLE_DEPLOY_HOST` | `ssh-mahjong.hydrava.cc` 或 VM public IP |
| `ORACLE_DEPLOY_USER` | `ubuntu` |
| `ORACLE_DEPLOY_SSH_KEY` | `mahjong-actions` private key 全文 |
| `ORACLE_DEPLOY_KNOWN_HOSTS` | `deploy_known_hosts` 全文 |

部署步驟：

1. Push 或 merge 到 GitHub。
2. 等 `Publish Docker Image` 完成。
3. 到 `Actions > Deploy Oracle VM > Run workflow`。
4. `image_tag` 填 `sha-<commit>` 或 `latest`。
5. 第一次 workflow 若建立了 `.env` 後停止，SSH 到 VM 編輯 `/home/ubuntu/Mahjong/.env`，再重跑 workflow。

## 更新

手動更新：

```bash
cd /home/ubuntu/Mahjong
git pull --ff-only
docker compose --env-file .env -f docker-compose.oracle.yml pull
docker compose --env-file .env -f docker-compose.oracle.yml up -d
docker image prune -f
```

部署指定 immutable image：

```bash
printf 'MAHJONG_IMAGE=ghcr.io/5gswatergod/mahjong:sha-0123456789abcdef0123456789abcdef01234567\n' > .deploy.env
docker compose --env-file .env --env-file .deploy.env -f docker-compose.oracle.yml pull
docker compose --env-file .env --env-file .deploy.env -f docker-compose.oracle.yml up -d
```

## 備份與還原

備份 Postgres：

```bash
mkdir -p backups
docker compose --env-file .env -f docker-compose.oracle.yml exec -T postgres \
  pg_dump -U mahjong -d mahjong > backups/mahjong-$(date +%F).sql
```

還原：

```bash
docker compose --env-file .env -f docker-compose.oracle.yml stop mahjong
cat backups/mahjong-YYYY-MM-DD.sql | \
  docker compose --env-file .env -f docker-compose.oracle.yml exec -T postgres \
  psql -U mahjong -d mahjong
docker compose --env-file .env -f docker-compose.oracle.yml start mahjong
```

## Troubleshooting

### Caddy 無法取得憑證

確認：

- Cloudflare `mahjong` record 暫時是 DNS only。
- Oracle ingress 有開 TCP 80/443。
- VM 上沒有其他服務佔用 80/443。
- `APP_DOMAIN=mahjong.hydrava.cc`。

看 log：

```bash
docker compose --env-file .env -f docker-compose.oracle.yml logs caddy
```

### 網站開得起來但 socket 連不上

確認 `.env`：

```env
WEB_ORIGIN=https://mahjong.hydrava.cc
```

然後重啟：

```bash
docker compose --env-file .env -f docker-compose.oracle.yml up -d
```

### `/health` 不是 `ok`

```bash
docker compose --env-file .env -f docker-compose.oracle.yml logs mahjong postgres
docker compose --env-file .env -f docker-compose.oracle.yml ps
```

### GHCR pull 失敗

如果 image 是 private，在 VM：

```bash
echo YOUR_GITHUB_TOKEN | docker login ghcr.io -u 5Gswatergod --password-stdin
```

或把 GHCR package visibility 改成 Public。
