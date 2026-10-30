# 轻唱开发说明

沿用上级 AGENTS.md 的多 Agent 分工、反过度防御编程和粗粒度功能测试约束。

- Node.js 24 或更新版本，使用 npm；`npm ci` 安装锁定依赖。
- `npm run dev` 启动网页，`npm run build` 进行类型检查和生产构建。
- `npm test` 运行功能级测试，`npm run test:e2e` 运行浏览器验收。
- `npm run desktop:dev` 启动 Electron；`npm run desktop:pack` 生成当前系统可运行的应用目录；`npm run desktop:dist` 生成安装包。
- `npm run android:sync` 同步 Android 工程；`npm run android:build` 需要 JDK 21 和 Android SDK，产出 debug APK。
- `npm run ios:check` 检查完整 Xcode 26+ 及 iOS SDK；`ios:sync` 同步工程；`ios:build` 构建未签名模拟器应用；`ios:run` 选择设备/模拟器运行；`ios:open` 打开 Xcode，均通过 `npm run` 调用。轻唱最低 iOS 16.4，真机自用需个人 Apple Team 签名与设备开发者模式；SPM 依赖兼容下限不改变应用部署下限。
- 当前网页录制时使用 CREPE 和参考旋律对比，录制后使用私有 VocalVerse v2 服务评估干声；服务就绪以实际健康检测为准。公共 HTTP 9000 仅供预览，录音通过已配置 SSH 隧道的 http://127.0.0.1:8765；详见评分方案。旧 MiniCPM 启动脚本为历史实现，已停用。
- 云端评分权重和 Python 环境不进 Git 或安装包；浏览器所需的官方 CREPE tiny 与 WASM 随静态资源提供，保留许可与哈希。评分服务默认只监听本机，通过专用 SSH 隧道和持有令牌的网关访问。
- 原生 IPC 只接受受信任本地窗口，网页外链仅允许 HTTP/HTTPS。不要关闭 Web 安全或给远程内容开放 Node.js。
- 项目说明与操作限制见 [项目说明](./项目说明.md)。构建产物、临时测试输出与本机工具链不纳入 Git；正式验收截图与精简报告可保存在 `artifacts/` 并跟踪。
