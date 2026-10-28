# 我的记账（个人 PWA）

仅个人使用的记账应用。数据在本机（IndexedDB）缓存，并与 Cloudflare D1 云端双向同步；站点需登录才能访问。

文档：

- [需求分析与架构设计](docs/需求分析与架构设计.md)
- [详细设计](docs/详细设计.md)
- [开发计划与验收标准](docs/开发计划与验收标准.md)
- [详细设计：云同步与登录（v1.1）](docs/详细设计-云同步与登录.md)
- [部署说明（Cloudflare Pages）](docs/部署说明.md)

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm install` | 安装依赖 |
| `npm run dev` | 本地开发（含登录与同步，账号见 `dev/dev-config.ts`），http://localhost:5173 |
| `npm test` | 单元测试 |
| `npm run build` | 类型检查 + 生产构建，输出到 `dist/` |
| `npm run preview` | 预览生产构建（含离线能力），http://localhost:4173 |
| `python scripts/make-icons.py` | 重新生成 PNG 图标 |
| `npm run cf:login` | 授权 wrangler 访问 Cloudflare（首次） |
| `npm run cf:create` | 创建 Pages 项目 my-ledger（首次） |
| `npm run db:migrate:remote` | 云端 D1 建表 / 升级表结构 |
| `npm run user:create` | 创建或重置登录账号（自己输入密码） |
| `npm run deploy` | 测试 + 构建 + 发布到 Cloudflare Pages |

## 在 Windows 上体验

1. `npm run dev`
2. 用 Edge / Chrome 打开 http://localhost:5173 ，用 `dev/dev-config.ts` 中的开发账号登录
3. `F12` → `Ctrl+Shift+M` 切换到 iPhone 尺寸

> `npm run preview` 只有静态文件、没有登录与同步接口，v1.1 起仅用于检查构建产物。

## 部署到 iPhone

首次：`npm run cf:login` → `npm run cf:create` → `npm run db:migrate:remote` → `npm run user:create` → `npm run deploy`；之后每次更新只需 `npm run deploy`。
iPhone Safari 打开 `https://my-ledger-evs.pages.dev` → 分享 → 添加到主屏幕。详见 [部署说明](docs/部署说明.md)。

> 云端为主数据；「设置 → 备份与恢复」的 JSON 导出可作为额外保险。
