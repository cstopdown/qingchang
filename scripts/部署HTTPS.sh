#!/bin/bash
set -euo pipefail

# 本机入口通过现有 SSH 别名部署；远端仅操作独立 HTTPS 目录/容器。
if [[ "${1:-}" != --server ]]; then
  action=${1:?用法：部署HTTPS.sh 准备|测试签发|正式签发|启动|续签计划|检查|续签演练}
  case "$action" in
    准备)
      cd "$(dirname "$0")/.."
      ssh aliyun 'install -d -m 700 /opt/qingchang-https'
      scp gateway/https_app.py aliyun:/opt/qingchang-https/https_app.py
      scp scripts/部署HTTPS.sh aliyun:/opt/qingchang-https/部署HTTPS.sh
      ;;
    测试签发|正式签发|启动|续签计划|检查|续签演练) ;;
    *) printf '未知操作：%s\n' "$action" >&2; exit 2 ;;
  esac
  exec ssh aliyun "bash /opt/qingchang-https/部署HTTPS.sh --server '$action'"
fi

base=/opt/qingchang-https
certbot=$base/certbot-venv/bin/certbot
ip=106.14.75.30
name=qingchang-ip
action=${2:?缺少操作}

case "$action" in
  准备)
    # 此路径来自现场核验的 /opt/qingchang-web/Dockerfile.local。
    docker run --rm --network none --entrypoint /opt/qingchang-venv/bin/python \
      qingchang-web:local -c 'import aiohttp; print(aiohttp.__version__)'
    python3 -m venv "$base/certbot-venv"
    "$base/certbot-venv/bin/pip" install 'certbot==5.4.0'
    "$certbot" --version
    install -d -m 700 "$base"/{config,work,logs,staging/config,staging/work,staging/logs}
    ;;
  测试签发)
    "$certbot" certonly --staging --non-interactive --agree-tos --register-unsafely-without-email \
      --standalone --preferred-challenges http --preferred-profile shortlived \
      --ip-address "$ip" --cert-name "$name" \
      --config-dir "$base/staging/config" --work-dir "$base/staging/work" --logs-dir "$base/staging/logs"
    ;;
  正式签发)
    # staging 成功后才能执行生产签发；生产证书独立存放。
    test -f "$base/staging/config/live/$name/fullchain.pem"
    "$certbot" certonly --non-interactive --agree-tos --register-unsafely-without-email \
      --standalone --preferred-challenges http --preferred-profile shortlived \
      --ip-address "$ip" --cert-name "$name" \
      --config-dir "$base/config" --work-dir "$base/work" --logs-dir "$base/logs"
    ;;
  启动)
    openssl x509 -in "$base/config/live/$name/fullchain.pem" -noout -dates -ext subjectAltName
    docker run -d --name qingchang-https --network host --cpus 0.25 --memory 128m \
      --restart unless-stopped --no-healthcheck --entrypoint /opt/qingchang-venv/bin/python \
      --mount "type=bind,src=$base/https_app.py,dst=/opt/https_app.py,readonly" \
      --mount "type=bind,src=$base/config/live/$name,dst=/certificates/live/$name,readonly" \
      --mount "type=bind,src=$base/config/archive/$name,dst=/certificates/archive/$name,readonly" \
      -e QINGCHANG_TLS_CERT=/certificates/live/$name/fullchain.pem \
      -e QINGCHANG_TLS_KEY=/certificates/live/$name/privkey.pem \
      qingchang-web:local /opt/https_app.py
    ;;
  续签计划)
    cat > /etc/systemd/system/qingchang-https-renew.service <<EOF
[Unit]
Description=轻唱独立 HTTPS 证书续签
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=$certbot renew --non-interactive --config-dir $base/config --work-dir $base/work --logs-dir $base/logs --deploy-hook "/usr/bin/docker restart qingchang-https"
EOF
    cat > /etc/systemd/system/qingchang-https-renew.timer <<'EOF'
[Unit]
Description=轻唱 HTTPS 每日两次证书续签检查

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=3600
Persistent=true

[Install]
WantedBy=timers.target
EOF
    systemctl daemon-reload
    systemctl enable --now qingchang-https-renew.timer
    systemctl list-timers qingchang-https-renew.timer --no-pager
    ;;
  续签演练)
    # 不强制真实续签、不运行 deploy hook；验证 HTTP-01 和续签配置。
    "$certbot" renew --dry-run --non-interactive \
      --config-dir "$base/config" --work-dir "$base/work" --logs-dir "$base/logs"
    ;;
  检查)
    openssl x509 -in "$base/config/live/$name/fullchain.pem" -noout -dates -issuer -ext subjectAltName
    docker inspect --format '{{.State.Status}} {{.Config.Image}} {{.HostConfig.NetworkMode}} {{.HostConfig.NanoCpus}} {{.HostConfig.Memory}}' qingchang-https
    curl --fail --silent --show-error -I "https://$ip/"
    systemctl list-timers qingchang-https-renew.timer --no-pager
    ;;
  *) printf '未知远端操作：%s\n' "$action" >&2; exit 2 ;;
esac
