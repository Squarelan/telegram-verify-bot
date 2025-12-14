# Telegram-verify-bot

一个基于 Cloudflare Workers 的 Telegram 消息转发机器人，集成了数学验证、反欺诈和用户管理功能。支持 KV 版本和 D1 版本。

> 💡 本项目参考 [NFD](https://github.com/LloydAsp/nfd)，在其基础上增加了多重验证和管理功能。

---

## ✨ 功能特性

- 🔐 **数学验证** - 用户必须通过验证才能使用机器人
  - ⏰ **基于时间的数学题** - 根据用户所在时区（UTC+8）的实时时间生成
  - 🔢 **题目格式** - 选取 HHMM 时间中的两位数字，各加上随机值（1-9），超过10取个位数
  - ❌ **防重复答题** - 同一用户在5分钟内若已生成验证题，重复消息只提示继续答题，不重新生成
  - 6个选项按钮，2x3 布局，所有选项统一为两位数字格式（如 "05"、"23"）
  - 5分钟内必须回答，超期自动失效并重新生成新题
  - 最多尝试 10 次，超过则永久屏蔽
- ✅ **验证有效期** - 验证成功后 3 天内 无需重复验证
- 🚫 **反欺诈** - 内置欺诈用户数据库，自动检测和阻止
- 👤 **用户管理** - 支持屏蔽/解除屏蔽用户、白名单管理
- 📱 **消息转发** - 支持文本、图片、视频等多种媒体转发
- 📋 **白名单功能** - 白名单用户直接跳过验证和屏蔽检查
- ⏰ **通知提醒** - 可配置的定时提醒功能（默认一天一次）
- 🔒 **Webhook 加密** - 使用密钥验证确保消息来源
- 💾 **数据持久化** - 支持 KV 和 D1 两种存储方案

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
2. 进入 Workers & Pages → Create application → Start with Hello World!
3. 给 Worker 命名（如 telegram-verify-bot）
4. 点击 Deploy

#### 4️⃣ 配置环境变量

在 Worker 设置中，进入 Settings → Variables，添加以下环境变量：

| 变量名 | 说明 | 示例 | 必需 |
|------|------|------|------|
| BOT_TOKEN | Telegram Bot Token | 123456:ABCDEFxyz... | ✅ 是 |
| BOT_SECRET | Webhook 密钥（UUID 格式） | 550e8400-e29b-41d4-a716-446655440000 | ✅ 是 |
| ADMIN_UID | 你的 Telegram 用户 ID | 123456789 | ✅ 是 |
| TIMEZONE | 验证题所用时区（可选） | Asia/Shanghai | ❌ 否 |

**TIMEZONE 说明：**
- 默认值：`UTC`
- 常见值：`Asia/Shanghai`（北京时间）、`Asia/Hong_Kong`、`America/New_York` 等
- 用途：控制验证题生成时所用的时间基准

#### 5️⃣ 选择数据库方案

本项目提供两个版本，请根据需要选择：

##### 📦 方案 A：KV 版本（worker-KV.js）

**适合：** 小型应用，数据量不大（<10MB）

**配置步骤：**

1. 进入 Workers KV
2. 创建新的 KV 命名空间：`lan`
3. 在 Worker 设置中，进入 Settings → Bindings → Add binding
   - Variable name： `lan`
   - KV namespace： 选择刚创建的 `lan`
4. 部署 [worker-KV.js](./worker-KV.js) 代码

**KV 绑定配置：**

在代码中访问
```javascript
let lan = env.lan;
```

**存储结构：**

| 存储键 | 说明 |
|------|------|
| whitelist-{userId} | 白名单标记 |
| verify-{userId} | 当前验证码答案 |
| verify-attempts-{userId} | 验证尝试次数 |
| verified-{userId} | 验证成功标记（3天过期） |
| isblocked-{userId} | 屏蔽标记 |
| msg-map-{messageId} | 消息映射关系 |
| lastmsg-{userId} | 上次消息时间戳 |
| whitelist-data | 白名单数据集合 |


##### 💾 方案 B：D1 版本（worker-D1.js）

**适合：** 中大型应用，需要结构化查询，数据持久化

**配置步骤：**

1. 进入 D1 SQL database：
2. 创建名为`lan`的数据库
3. 在 Worker 设置中，进入 Settings → Bindings → Add binding
   - Variable name： `lan`
   - D1 database： 选择刚创建的 `lan`
4. 部署 [worker-D1.js](./worker-D1.js) 代码
5. 初始化数据库表：

https://你的worker.workers.dev/initDatabase


**D1 数据库表结构：**

| 表名 | 用途 |
|-----|------|
| whitelist | 白名单用户 |
| verification | 验证码状态 |
| verified_users | 验证成功用户 |
| blocked_users | 屏蔽用户 |
| message_mappings | 消息映射 |
| message_rates | 消息频率限制 |

**详细 SQL 语句：**
```javascript
-- 白名单用户
CREATE TABLE whitelist (user_id TEXT PRIMARY KEY,created_at INTEGER);

-- 验证码状态
CREATE TABLE verification (user_id TEXT PRIMARY KEY,answer TEXT,attempts INTEGER DEFAULT 0,created_at INTEGER);

-- 验证成功用户
CREATE TABLE verified_users (user_id TEXT PRIMARY KEY,expiry_time INTEGER);

-- 屏蔽用户
CREATE TABLE blocked_users (user_id TEXT PRIMARY KEY,blocked_at INTEGER);

-- 消息映射
CREATE TABLE message_mappings (mapping_key TEXT PRIMARY KEY,mapped_value TEXT,created_at INTEGER);

-- 消息频率限制
CREATE TABLE message_rates (user_id TEXT PRIMARY KEY,last_message_time INTEGER);
```

**D1 优势：**

- ✅ 支持 SQL 查询，灵活度高
- ✅ 自动过期时间管理
- ✅ 数据结构清晰，易于维护
- ✅ 支持批量操作和事务
- ✅ 免费额度更高（读/写操作更多）

#### 6️⃣ 部署代码

1. 进入 Worker Edit code
2. 选择对应版本的代码：
   - KV 版本： 复制 [worker-KV.js](./worker-KV.js)
   - D1 版本： 复制 [worker-D1.js](./worker-D1.js)
3. 点击 Deploy

#### 7️⃣ 注册 Webhook

访问以下 URL 注册 webhook（替换 `xxx.workers.dev` 为你的 Worker 域名）：

https://xxx.workers.dev/registerWebhook


成功后将看到 `Ok` 响应。

---

## 📖 使用指南

### 普通用户

**初次使用流程：**

1. 给机器人发送 `/start` 查看欢迎消息
2. 回答数学验证题：
   - 题目说明：以 UTC+8 时间为基准，从 HHMM（时分）四位数字中选取两位数字，各加上指定数值
   - 例如：现在是 14:23，题目可能是：
     ```
     🔐 以UTC+8时间为基准
     第1位数字 + 3 = ?
     第3位数字 + 7 = ?
     按顺序组成两位数即为答案
     ```
   - 点击 6 个选项中的正确答案（所有选项均为两位数字，如 "07"、"32"）
   - 若5分钟内未答题，验证码自动过期，重新发消息时会生成新题
3. ✅ 验证成功后可正常使用
4. 发送的消息会被转发给机器人创建者

**⏱️ 时间限制：**

- 验证码有效期：5 分钟（基于题目生成时间，不会因为用户重复发消息而重置）
- 验证成功有效期：3 天（3天内无需再次验证，3天后需要重新验证）
- 验证失败上限：10 次（超过则永久屏蔽，管理员可通过 `/unblock` 解除）
- 单题答题时间：无限制（在5分钟过期前任意时刻点击即可）

**⚠️ 重要说明：**

- ✅ 同一验证题有效期内，用户重复发消息不会覆盖已有的验证题，只会提示"请点击上面的按钮选择答案"
- ✅ 答题尝试次数在验证码有效期内累计，超过10次后自动屏蔽
- ✅ 验证成功后，3天内的任何新消息都无需再验证

### 机器人创建者（管理员）

#### 基础操作

**回复用户消息流程：**

1. 用户发送消息 → 机器人转发给你
2. 长按转发的消息
3. 选择"回复"
4. 输入消息内容
5. 消息自动回复给原用户

#### 管理命令

**屏蔽/解除屏蔽用户：**

| 命令 | 功能 | 使用方式 |
|-----|------|--------|
| `/block` | 屏蔽用户 | 回复用户消息后发送 |
| `/unblock` | 解除屏蔽 | 回复用户消息后发送，或 `/unblock [UID]` |
| `/checkblock` | 查看屏蔽列表 | 直接发送（私聊）或话题内发送 |

**白名单管理：**

| 命令 | 功能 | 使用方式 |
|-----|------|--------|
| `/addwhite [UID]` | 添加白名单 | 直接指定 UID 或回复消息 |
| `/removewhite [UID]` | 移除白名单 | 直接指定 UID 或回复消息 |
| `/checkwhite [UID]` | 检查白名单状态 | 直接指定 UID 或回复消息 |
| `/listwhite` | 列出所有白名单 | 直接发送 |

**白名单用户特殊权限：**

- ✅ 直接跳过数学验证
- ✅ 无需再次验证（永久有效）
- ✅ 屏蔽列表检查被跳过
- ✅ 消息直接转发

#### 使用示例

**场景 1：屏蔽用户**

1. 长按用户转发的消息
2. 选择"回复"
3. 输入 `/block`
4. 结果：UID: 123456789 屏蔽成功

**场景 2：添加白名单**

1. 使用命令：`/addwhite 123456789`
2. 结果：UID: 123456789 已添加到白名单

**场景 3：查看白名单**

1. 使用命令：`/listwhite`
2. 结果：显示所有白名单用户列表

---

## ⚙️ 配置说明

### 时间参数详解

代码中的所有时间参数都可以自定义修改：

| 参数名 | 默认值 | 单位 | 含义 | 位置 |
|------|-------|------|------|------|
| VERIFICATION_TTL | 300 | 秒 | 验证码过期时间 | 代码顶部 |
| VERIFIED_TTL | 259200 | 秒 | 验证成功有效期 | 代码顶部 |
| MAX_VERIFY_ATTEMPTS | 10 | 次数 | 最大验证尝试次数 | 代码顶部 |
| NOTIFY_INTERVAL | 86400000 | 毫秒 | 通知间隔（24小时） | handleNotify() |

### 时间换算对照表

- 1 分钟 = 60 秒 = 60000 毫秒
- 5 分钟 = 300 秒 = 300000 毫秒
- 1 小时 = 3600 秒 = 3600000 毫秒
- 1 天 = 86400 秒 = 86400000 毫秒
- 3 天 = 259200 秒 = 259200000 毫秒
- 7 天 = 604800 秒 = 604800000 毫秒
- 30 天 = 2592000 秒 = 2592000000 毫秒


### 修改验证码过期时间

编辑代码顶部的常量：
```javascript
//改为 10 分钟过期
const VERIFICATION_TTL = 600;

//改为 2 小时过期
const VERIFICATION_TTL = 7200;
```

### 修改验证成功有效期

编辑代码顶部的常量：
```javascript
//改为 7 天有效期
const VERIFIED_TTL = 604800;

//改为 1 天有效期
const VERIFIED_TTL = 86400;
```

### 修改最大验证尝试次数

编辑代码顶部的常量：
```javascript
//改为 5 次尝试
const MAX_VERIFY_ATTEMPTS = 5;

//改为 20 次尝试
const MAX_VERIFY_ATTEMPTS = 20;
```

### 启用通知功能

默认关闭，要启用请改为：
```javascript
const enable_notification = true;
```

启用后，每次用户发送消息超过 24 小时后会触发一次通知。

### 时区配置说明

#### 什么是时区配置？

验证题基于用户的实时时间生成，通过 TIMEZONE 环境变量控制。

#### 默认时区

默认为 `UTC`，可以修改为其他时区。

#### 常见时区代码

| 地区 | 时区代码 | 说明 |
|-----|---------|------|
| 中国 | Asia/Shanghai | UTC+8（北京时间） |
| 中国（香港） | Asia/Hong_Kong | UTC+8（香港时间） |
| 日本 | Asia/Tokyo | UTC+9 |
| 新加坡 | Asia/Singapore | UTC+8 |
| 印度 | Asia/Kolkata | UTC+5:30 |
| 阿联酋 | Asia/Dubai | UTC+4 |
| 英国 | Europe/London | UTC+0/+1 |
| 美国（东部） | America/New_York | UTC-5/-4 |
| 美国（西部） | America/Los_Angeles | UTC-8/-7 |

#### 修改时区配置

在 Cloudflare Workers 设置中：

1. 进入 Settings → Variables
2. 添加新变量：
   - Variable name： `TIMEZONE`
   - Value： 你需要的时区代码（如 `Asia/Shanghai`）
3. 重新部署 Worker

#### 验证题中的时区显示

验证题文案会自动根据 TIMEZONE 显示：

```javascript
// 题目文案示例
`以UTC+8时间为基准
第${pos1 + 1}位数字 + ${addValue1} = ?
第${pos2 + 1}位数字 + ${addValue2} = ?

按顺序组成两位数即为答案`
```

说明： 虽然代码计算基于指定的时区，但文案中的"UTC+8"是示意文本，实际应根据 TIMEZONE 修改。建议使用 Asia/Shanghai 时区并保持文案为"UTC+8时间"。
Intl.DateTimeFormat 工作原理

代码使用 Intl.DateTimeFormat 根据 TIMEZONE 获取实时时间：

```javascript
const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: TIMEZONE,  // 使用配置的时区
  hour: '2-digit',
  minute: '2-digit',
  hour12: false  // 24小时制
});
```

这样即使 Cloudflare 服务器在不同地区，也能获取用户指定时区的准确时间。

---

## 🔍 反欺诈数据库

### 数据源

- **文件路径：** `fraud.db`
- **格式：** 每行一个 UID，如：
```javascript
123456789
987654321
111111111
```

- **更新方式：** 通过 PR 或 Issue 补充

### 工作原理

- 当已验证用户在欺诈数据库中时，消息不会被转发
- 管理员会收到警告消息：⚠️ 检测到诈骗人员 UID: xxxxx
- 有助于防止骗子使用机器人

---

## 🛠️ 常见问题

**Q: 为什么每次发消息都会生成新的验证题？**

A: 不会重复生成。系统逻辑是：
- 第一条消息 → 生成新题目
- 第二至N条消息 → 如果题目还未过期，只提示"请点击上面的按钮选择答案"，不重新生成
- 只有当题目过期（5分钟后）才会生成新题目

这样可以防止恶意用户通过重复发消息来刷屏。

---

**Q: 验证题的时间是基于哪个时区的？**

A: 基于 TIMEZONE 环境变量配置的时区。默认为 UTC，建议改为 `Asia/Shanghai`（北京时间）。

验证题从 HHMM（时分）四位数字中随机选取两位，加上 1-9 的随机数，超过 10 取个位数。所有选项都是两位数字格式（带前导0）。

---

**Q: 验证题选项为什么都是两位数字（如 "05"、"23"）？**

A: 这是为了防止识别。因为验证答案都是两位数字（0-99），所以所有选项也格式化为两位数字，避免用户通过选项长度来判断答案。

例如：

✅ 正确格式：["05", "23", "67", "12", "89", "45"]
❌ 错误格式：["5", "23", "67", "101", "102"] ← 这样会暴露答案长度


---

**Q: 为什么答题失败后尝试次数不会重置？**

A: 尝试次数与验证码的过期时间绑定。在 5 分钟内的所有尝试都会累计，达到 10 次后永久屏蔽。

- ✅ 用户在 5 分钟内答错 10 次 → 屏蔽
- ✅ 用户答错 5 次，5 分钟后重新生成新题 → 新题的尝试次数重新计算
- ✅ 答题成功后，尝试次数自动清除

---

**Q: D1 版本和 KV 版本在验证题上有什么区别？**

A: 功能完全相同，都支持：

- ✅ 基于时间的数学验证
- ✅ 5 分钟过期机制
- ✅ 防重复生成逻辑
- ✅ 10 次尝试限制

区别仅在存储方式：

- **KV 版本**：直接存储答案和尝试次数
- **D1 版本**：使用数据库表存储，支持 SQL 查询和批量操作

推荐：

- 小型应用（用户少）→ KV 版本
- 中大型应用（需要统计数据）→ D1 版本

---

**Q: 屏蔽用户后他能做什么？**

A: 被屏蔽用户给机器人发消息时会收到 `You are blocked` 提示，无法继续使用。

---

**Q: 白名单用户有什么优势？**

A:
- ✅ 无需进行数学验证
- ✅ 消息永久有效（无需重新验证）
- ✅ 直接转发消息，无任何限制

---

**Q: 消息转发支持哪些类型？**

A: 支持文本、图片、视频、文件等 Telegram 支持的所有媒体类型。

---

**Q: 如何自定义欢迎消息？**

A: 编辑代码中 `/start` 命令的 text 字段即可：
```javascript
if (message.text === '/start') {return sendMessage({
    chat_id: message.chat.id,
    text: '你的自定义欢迎消息内容' // ← 改这里
});
}
```

---

**Q: KV 和 D1 哪个更好？**

A:

| 对比项 | KV | D1 |
|------|----|----|
| 学习难度 | 简单 | 中等 |
| 查询能力 | 简单键值 | SQL查询 |
| 数据量 | 1GB | 5GB |
| 性能 | 快速 | 快速 |
| 价格 | 免费额度1000次/天 | 免费额度100,000次/天 |
| 推荐用途 | 小型应用 | 中大型应用 |

---

**Q: 如何修改验证有效期？**

A: 编辑代码顶部的常量：
```javascript
// D1 版本或 KV 版本
const VERIFIED_TTL = 259200; // 改为你需要的秒数
```

然后重新部署。

---

**Q: 如何查看存储的数据？**

A:
- **KV 版本：** 进入 Cloudflare Dashboard → Workers KV → 查看值
- **D1 版本：** 进入 Cloudflare Dashboard → D1 Databases → 使用查询工具

---

## 📝 项目结构
```
telegram-verify-bot/
├── README.md # 项目说明文档
├── LICENSE # 开源许可证
├── worker-KV.js # KV 版本（使用 Cloudflare KV）
├── worker-D1.js # D1 版本（使用 Cloudflare D1 数据库）
└── data/
    ├── fraud.db # 欺诈数据库（行分隔的 UID 列表）
    └── notification.txt # 通知模板
```

### 版本对比

| 文件 | 适用场景 | 特点 |
|-----|--------|------|
| worker-KV.js | 小型应用、快速部署 | 无需初始化，开箱即用 |
| worker-D1.js | 中大型应用、需要查询 | 需要初始化表，功能完整 |

---

## 🔄 版本迭代记录

### v2.1（当前版本）

**✅ 新增功能：**

- 🔐 **基于时间的数学验证** - 根据 UTC+8 实时时间 HHMM 格式生成，自动隐藏具体时间防止暴露逻辑
- 🛡️ **防重复生成机制** - 同一用户 5 分钟内重复消息不会重新生成验证题，只提示继续答题，有效防止刷屏
- 🔢 **选项格式统一化** - 所有选项统一为两位数字格式（带前导0），防止通过选项长度识别答案
- ⏰ **验证码生成时间隐藏** - 验证码 5 分钟过期时间基于生成时刻，不被用户重复消息重置

**📊 改进：**

- 优化验证尝试次数计算 - 尝试次数与验证码过期时间绑定，5 分钟后重新计算
- 增强数学题目隐私保护 - 题目中不显示具体时间，只提示"以 UTC+8 时间为基准"
- 改进选项生成算法 - 确保所有选项都在 0-99 范围内，格式化后无三位数问题
- 完善错误处理逻辑 - 区分"新题目"和"继续答题"两种场景的用户提示

---

### v2.0

**✅ 新增功能：**

- 新增 6 选项数学验证（2x3 布局）
- 新增 D1 数据库版本，支持 SQL 查询
- 新增 白名单管理命令（`/addwhite`, `/removewhite`, `/checkwhite`, `/listwhite`）
- 新增 验证码 5 分钟自动过期
- 新增 验证成功 3 天有效期
- 新增 验证尝试次数限制（最多 10 次）

**📊 改进：**

- 优化数据存储结构（支持 KV 和 D1）
- 增强用户隐私保护
- 改进错误提示信息
- 完善文档说明

---

## 🤝 贡献

欢迎通过以下方式贡献：

- 补充欺诈数据： 提交 PR 更新 `fraud.db`
- 功能改进： 提交 Issue 讨论功能建议
- Bug 反馈： 报告发现的问题，带上错误日志

### 提交欺诈信息时的注意事项

- 请提供可靠的消息出处
- 多个 UID 请分行提交
- 确认 UID 无误后再提交

---

## 📜 许可证

本项目参考 [NFD](https://github.com/LloydAsp/nfd)，致谢原项目作者。

---

## 🔗 相关资源

- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare D1 数据库文档](https://developers.cloudflare.com/d1/)
- [Cloudflare KV 文档](https://developers.cloudflare.com/workers/runtime-apis/kv/)
- [Telegram Bot API](https://core.telegram.org/bots/api)
- [NFD 原项目](https://github.com/LloydAsp/nfd)

---

## 💬 支持

有问题或建议？

- ✈️ 联系我[@Squarelan](https://t.me/Squarelan)
- 📮 提交 Issue
- 💭 开启讨论区
- 🔗 提交 Pull Request

⭐ 如果对你有帮助，请给个 Star！
