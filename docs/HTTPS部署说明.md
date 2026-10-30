# 公网 HTTPS 录音入口部署说明

本说明对应独立入口 `https://106.14.75.30/` 的部署方案。公网静态页面可在浏览器安全上下文中申请麦克风权限；私有评分继续使用 SSH 隧道，不通过此入口。这里的操作命令不代表已经完成正式签发或公网浏览器验收。

## 前置条件与边界

- 云安全组允许公网 TCP 80、443。80 只在 Certbot HTTP-01 验证期间监听，不能因日常没有监听而关闭安全组规则。主机时间与公网 DNS、HTTPS 出站应正常。
- 本机已有 `ssh aliyun`，远端以 root 执行。现有 `qingchang-preview` 在本机 9000 提供静态内容；私有 `qingchang-web` 的 8765 和评分服务 28787 不新增公网映射。
- 复用已安装 `qingchang-web:local` 镜像。已现场读取 `/opt/qingchang-web/Dockerfile.local`：aiohttp 3.12.15 的 Python 为 `/opt/qingchang-venv/bin/python`。入口命令显式覆盖镜像 ENTRYPOINT，不继承业务入口，不挂载业务环境或令牌。
- 远端 Python 3.14 需要 `python3.14-venv`。首次准备实测缺少 ensurepip，经主 Agent 决定安装此前置系统包；模拟安装仅新增它及 `python3-pip-whl`、`python3-setuptools-whl`，无升级或移除。脚本固定安装 `certbot==5.4.0`，不用系统 Certbot。
- 新容器 `qingchang-https` 使用 host 网络监听 443，限制 0.25 CPU、128 MiB，`restart unless-stopped`，禁用镜像健康检查。仅只读挂载 HTTPS 源码和独立证书目录。

## 分阶段执行

在仓库根目录执行，每步失败即停；测试环境证书与生产证书目录互不混用：

```sh
# 此服务器的 Python 虚拟环境前置软件包，先检查模拟输出：
ssh aliyun 'apt-get -s install --no-install-recommends python3.14-venv'
ssh aliyun 'DEBIAN_FRONTEND=noninteractive NEEDRESTART_MODE=l apt-get install -y --no-install-recommends python3.14-venv'
./scripts/部署HTTPS.sh 准备
# 确认公网 80 可达后：
./scripts/部署HTTPS.sh 测试签发
./scripts/部署HTTPS.sh 正式签发
./scripts/部署HTTPS.sh 启动
./scripts/部署HTTPS.sh 续签计划
./scripts/部署HTTPS.sh 检查
./scripts/部署HTTPS.sh 续签演练
```

`准备` 仅上传本入口文件并安装独立 Certbot 环境，不申请证书、不占用 443。`测试签发` 使用 Let's Encrypt staging 和 standalone HTTP-01，`正式签发` 先检查测试证书存在，再使用生产 CA。两次签发均明确指定 `--preferred-profile shortlived --ip-address 106.14.75.30`，不需要域名；脚本接受 ACME 服务条款，使用不含邮件地址的独立账户。

`启动` 只创建新容器；若同名容器已经存在会直接失败。更新 HTTPS 程序时先按 `准备` 上传，再显式执行 `ssh aliyun 'docker restart qingchang-https'`；替换容器配置需由操作者只删除并重建此容器。上述命令不停止或重启现有预览、私有 Web 和评分容器。

目录布局：

| 路径 | 用途 |
| --- | --- |
| `/opt/qingchang-https/https_app.py` | 独立 HTTPS 静态代理 |
| `/opt/qingchang-https/certbot-venv` | Certbot 5.4.0 虚拟环境 |
| `/opt/qingchang-https/staging/{config,work,logs}` | 测试 CA 独立状态 |
| `/opt/qingchang-https/{config,work,logs}` | 正式 CA 状态及证书 |
| `/opt/qingchang-https/config/live/qingchang-ip` | 本站证书入口，只读挂载到 `/certificates/live/qingchang-ip` |
| `/opt/qingchang-https/config/archive/qingchang-ip` | 本站证书实际文件，只读挂载到 `/certificates/archive/qingchang-ip`，保留 live 到 archive 的相对链接 |

证书私钥、虚拟环境与 ACME 账户均留在服务器，不回传、不打印、不纳入 Git。独立部署目录仅 root 可访问。公网容器仅挂载本站 live/archive 两个证书目录，不挂载 ACME 账户私钥、其他证书或 renewal 配置。代理必须通过 `QINGCHANG_TLS_CERT`、`QINGCHANG_TLS_KEY` 指定证书；证书加载失败直接退出。最低 TLS 1.2，没有自签回退或浏览器安全设置修改。

## 自动续签与检查

Let's Encrypt IP 证书使用约 6 天的 shortlived profile，必须自动续签。独立 systemd timer 按服务器时区每天 00:00、12:00 检查，另加最多 1 小时随机延迟，`Persistent=true` 补执行错过的检查。它只运行独立目录的 `certbot renew`，成功部署新证书后仅执行 `/usr/bin/docker restart qingchang-https`。未到续签期的正常跳过不证明真实续签已完成。

```sh
ssh aliyun 'systemctl list-timers qingchang-https-renew.timer --no-pager'
ssh aliyun 'journalctl -u qingchang-https-renew.service --no-pager -n 40'
ssh aliyun 'openssl x509 -in /opt/qingchang-https/config/live/qingchang-ip/fullchain.pem -noout -dates -issuer -ext subjectAltName'
```

`续签演练` 使用生产证书的续签配置执行 `renew --dry-run`；它向 staging CA 验证 HTTP-01，不替换生产证书，也不运行 deploy hook。演练成功仅证明续签挑战链路。真实续签与新证书重新加载，应在下一次到期窗口查看 service 日志和对比线上证书序列号/有效期；不要为验收反复强制生产签发。

## 代理与验收

入口仅允许 GET/HEAD，固定代理 `http://127.0.0.1:9000`，保留 Range、条件请求和必要静态响应头，逐块传输媒体，不缓存整份音频。请求查询串、Authorization、Cookie 不转发；上游会话使用 `DummyCookieJar`，不保存或发送 Cookie；上游认证头和 Set-Cookie 不回传，重定向不跟随，Location 不对外透出。`/ai` 和其子路径一律 404，其他 POST 等方法为 405。连接超时为 5 秒、读取超时 30 秒、总超时 120 秒；上游连接失败返回 502，响应头前超时返回 504，已开始流式响应后的错误直接中断连接。

```sh
# 本地粗粒度闭环：先在独立虚拟环境安装 gateway/requirements.txt
python -m unittest discover -s gateway -p test_https.py -v
bash -n scripts/部署HTTPS.sh

# 在本机进行公网验证，不使用 -k：
curl --fail --show-error -I https://106.14.75.30/
curl --show-error -o /dev/null -w '%{http_code}\n' https://106.14.75.30/ai/health
curl --show-error -X POST -o /dev/null -w '%{http_code}\n' https://106.14.75.30/
```

最终还需浏览器无证书警告打开 IP 地址，核对 `window.isSecureContext`、`navigator.mediaDevices.getUserMedia`，允许麦克风后实际录音、回放、导出。容器运行、测试证书签发、curl 验证和浏览器真实录音是独立验收项。

当前实测边界：已读取镜像实际 Python 路径和 aiohttp 版本，已上传独立源文件；已安装三个 venv 前置软件包（无升级、移除及服务重启），独立环境输出 `certbot 5.4.0`。本地一个代理闭环测试通过，`bash -n scripts/部署HTTPS.sh` 通过。未调用 CA、未创建 HTTPS 容器、未启用 timer。公网 80/443 安全组开放、正式证书、真实续签与浏览器麦克风录制均待验收。

官方依据：[Let's Encrypt：Six-Day and IP Address Certificates Available in Certbot（2026-03-11）](https://letsencrypt.org/2026/03/11/shorter-certs-certbot/)。关联入口见[云端部署说明](./云端部署说明.md)，文档目录见[索引](./索引.md)。
