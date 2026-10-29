# 轻唱开发说明

沿用上级 AGENTS.md 的多 Agent 分工、反过度防御编程和粗粒度功能测试约束。

- Node.js 24 或更新版本，使用 npm；`npm ci` 安装锁定依赖。
- `npm run dev` 启动网页，`npm run build` 进行类型检查和生产构建。
- `npm test` 运行功能级测试，`npm run test:e2e` 运行浏览器验收。
- `npm run desktop:dev` 启动 Electron；`npm run desktop:pack` 生成当前系统可运行的应用目录；`npm run desktop:dist` 生成安装包。
- `npm run android:sync` 同步 Android 工程；`npm run android:build` 需要 JDK 21 和 Android SDK，产出 debug APK。
- `npm run ios:sync` 同步 iOS 工程；`npm run ios:open` 打开 Xcode 项目。真机自用需要 Xcode 26+、Apple ID 签名与设备开发者模式。
- `npm run ai:setup` 准备 Apple Silicon Mac 的私有 AI 环境，`npm run ai:start` 启动服务，`npm run test:ai` 运行功能测试。`QINGCHANG_AI_HOME` 可指定独立环境目录；已安装环境直接离线启动。
- 模型和 Python 环境不进 Git 或安装包。默认只监听本机；仅用户显式启用局域网监听并设置令牌后，手机才可连接该私有服务。
- 原生 IPC 只接受受信任本地窗口，网页外链仅允许 HTTP/HTTPS。不要关闭 Web 安全或给远程内容开放 Node.js。
- 项目说明与操作限制见 [项目说明](./项目说明.md)。构建产物、临时测试输出与本机工具链不纳入 Git；正式验收截图与精简报告可保存在 `artifacts/` 并跟踪。
