# Telegram-verify-bot

一个基于 Cloudflare Workers 的 Telegram 消息转发机器人，集成了数学验证、反欺诈和用户管理功能。

> 💡 本项目参考 [NFD](https://github.com/LloydAsp/nfd)，在其基础上增加了多重验证和管理功能。

---

## ✨ 功能特性

- 🔐 **数学验证** - 用户必须通过验证才能使用机器人（支持加减乘除）
- 🚫 **反欺诈** - 内置欺诈用户数据库，自动检测和阻止
- 👤 **用户管理** - 支持屏蔽/解除屏蔽用户、查询用户状态
- 📱 **消息转发** - 支持文本、图片、视频等多种媒体转发
- ⏰ **通知提醒** - 可配置的定时提醒功能（默认一天一次）
- 🔒 **Webhook 加密** - 使用密钥验证确保消息来源

---

## 🚀 快速开始

### 前置条件

- Cloudflare 账户
- Telegram 账户

### 部署步骤

#### 1️⃣ 获取 Telegram 配置

- 从 [@BotFather](https://t.me/BotFather) 获取 Bot Token，并执行 `/setjoingroups` 禁止 Bot 被添加到群组
- 从 [@username_to_id_bot](https://t.me/username_to_id_bot) 获取你的用户 ID

#### 2️⃣ 生成 Webhook 密钥

- 访问 [UUID 生成器](https://www.uuidgenerator.net/) 生成一个随机 UUID 作为 `SECRET`

#### 3️⃣ 在 Cloudflare 创建 Worker

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → **Create application** → **Start with Hello World!**
3. 给 Worker 命名（如 `telegram-verify-bot`）
4. 点击 **Deploy**

#### 4️⃣ 配置环境变量

在 Worker 设置中，进入 **Settings** → **Variables**，添加以下环境变量：

| 变量名 | 说明 | 示例 |
|------|------|------|
| `ENV_BOT_TOKEN` | Telegram Bot Token | `123456:ABCDEFxyz...` |
| `ENV_BOT_SECRET` | Webhook 密钥 | `550e8400-e29b-41d4-a716-446655440000` |
| `ENV_ADMIN_UID` | 你的 Telegram 用户 ID | `123456789` |

#### 5️⃣ 绑定 KV 数据库

1. 进入 **Workers KV**
2. 创建新的 KV 命名空间：`nfd`
3. 在 Worker 设置中，进入 **Bindings** → **Variables** → **Add binding**，命名Variable name：`nfd`， 设置KV namespace绑定：`nfd`

#### 6️⃣ 部署代码

1. 进入 **Worker Edit code**
2. 复制本项目worker.js代码到编辑器
3. 点击 **Deploy**

#### 7️⃣ 注册 Webhook

访问以下 URL 注册 webhook（替换 `xxx.workers.dev` 为你的 Worker 域名）：

https://xxx.workers.dev/registerWebhook

成功后将看到 `Ok` 响应。

---

## 📖 使用指南

### 普通用户

**初次使用流程：**

1. 给机器人发送 `/start` 查看欢迎消息
2. 回答数学验证题（点击选项）
3. ✅ 验证成功后可正常使用
4. 发送的消息会被转发给机器人创建者

**验证有效期：** 3 天（过期后需重新验证）

### 机器人创建者（管理员）

**回复用户消息：**

用户消息 → 机器人转发 → 你回复转发的消息 → 消息回复给原用户

**管理命令 - 回复用户消息后发送以下命令：**

| 命令 | 功能 | 效果 |
|-----|------|------|
| `/block` | 屏蔽用户 | 该用户无法再使用机器人 |
| `/unblock` | 解除屏蔽 | 该用户可以重新使用 |
| `/checkblock` | 检查状态 | 显示该用户是否被屏蔽 |

**使用示例：**

1. 长按用户转发的消息
2. 选择"回复"
3. 输入 `/block`
4. UID:123456789屏蔽成功

---

## ⚙️ 配置说明

### 时间参数

代码中的所有时间参数都可以自定义修改：

- **通知间隔：** `NOTIFY_INTERVAL = 24 * 3600 * 1000` = 1 天
- **验证码过期：** `expirationTtl = 86400` = 24 小时
- **验证状态过期：** `expirationTtl = 259200` = 3 天
- **消息映射过期：** `expirationTtl = 2592000` = 30 天

**时间换算对照表：**

- 1 小时 = 3600 秒
- 1 天 = 86400 秒
- 3 天 = 259200 秒
- 7 天 = 604800 秒
- 30 天 = 2592000 秒

### 启用通知功能

默认关闭，要启用请改为：

```javascript
const enable_notification = true;
```

启用后，每次用户发送消息超过 1 天后会触发一次通知。

## 🔍 反欺诈数据库

**数据源：**

- 文件路径：`fraud.db`
- 格式：每行一个 UID
- 更新方式：通过 PR 或 Issue 补充

**工作原理：**

- 当已验证用户在欺诈数据库中时，消息不会被转发
- 管理员会收到警告消息：⚠️ 检测到诈骗人员 UID: xxxxx
- 有助于防止骗子使用机器人

---

## 🛠️ 常见问题

**Q: 验证码过期了怎么办？**

A: 需要重新回答新的验证题。每个新验证码有效期为 24 小时。

**Q: 屏蔽用户后他能做什么？**

A: 被屏蔽用户给机器人发消息时会收到 You are blocked 提示，无法继续使用。

**Q: 消息转发支持哪些类型？**

A: 支持文本、图片、视频、文件等 Telegram 支持的所有媒体类型。

**Q: 如何自定义欢迎消息？**

A: 修改 onMessage 函数中 /start 命令的 text 字段即可。

**Q: KV 数据库有存储限制吗？**

A: Cloudflare 免费账户支持 100GB 存储，足够大多数场景使用。

**Q: 如何修改验证有效期？**

A: 在 handleGuestMessage 函数中修改 expirationTtl 参数：

```javascript
// 改为 7 天有效期
await nfd.put('verified-' + chatId, true, { expirationTtl: 604800 });
```

## 📝 项目结构

telegram-verify-bot/
├── README.md # 项目说明文档
├── worker.js # Worker 主代码
└── fraud.db # 欺诈数据库（行分隔的 UID 列表）

---

## 🤝 贡献

欢迎通过以下方式贡献：

- **补充欺诈数据：** 提交 PR 更新 fraud.db
- **功能改进：** 提交 Issue 讨论功能建议
- **Bug 反馈：** 报告发现的问题

提交欺诈信息时请提供可靠的消息出处

---

## 📜 许可证

本项目参考 [NFD](https://github.com/LloydAsp/nfd)，致谢原项目作者。

---

## 🔗 相关资源

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [NFD 原项目](https://github.com/LloydAsp/nfd)

有问题？欢迎提交 Issue 或讨论！💬
