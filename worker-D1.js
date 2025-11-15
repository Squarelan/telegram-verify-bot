/**
 * 生成数学验证题（包含加减乘除，答案在100以内）
 */
function generateMathProblem() {
  const operators = ['+', '-', '*', '÷'];
  const operator = operators[Math.floor(Math.random() * operators.length)];
  
  let a, b, answer;
  
  if (operator === '+') {
    a = Math.floor(Math.random() * 50) + 1;
    b = Math.floor(Math.random() * 50) + 1;
    answer = a + b;
  } else if (operator === '-') {
    a = Math.floor(Math.random() * 100) + 1;
    b = Math.floor(Math.random() * a);
    answer = a - b;
  } else if (operator === '*') {
    a = Math.floor(Math.random() * 10) + 1;
    b = Math.floor(Math.random() * 10) + 1;
    answer = a * b;
  } else { // ÷
    b = Math.floor(Math.random() * 9) + 1;
    answer = Math.floor(Math.random() * 10) + 1;
    a = answer * b;
  }
  
  // 确保答案在100以内
  while (answer > 100) {
    return generateMathProblem();
  }
  
  return { 
    question: `${a} ${operator} ${b}`, 
    answer: answer.toString()
  };
}

/**
 * 常量配置和环境变量初始化
 */
let TOKEN, WEBHOOK, SECRET, ADMIN_UID, db;

const NOTIFY_INTERVAL = 24 * 3600 * 1000;
const fraudDb = 'https://raw.githubusercontent.com/Squarelan/telegram-verify-bot/main/data/fraud.db';
const notificationUrl = 'https://raw.githubusercontent.com/Squarelan/telegram-verify-bot/main/data/notification.txt';
const enable_notification = false;
const MAX_VERIFY_ATTEMPTS = 10;

/**
 * 处理请求的主入口
 */
function initConfig(env) {
  TOKEN = env.BOT_TOKEN;
  SECRET = env.BOT_SECRET;
  ADMIN_UID = env.ADMIN_UID;
  WEBHOOK = '/endpoint';
  
  if (!TOKEN || !SECRET || !ADMIN_UID) {
    throw new Error('❌ 环境变量未配置: BOT_TOKEN, BOT_SECRET, ADMIN_UID');
  }
}

/**
 * D1 数据库操作类
 */
class Database {
  constructor(d1) {
    this.d1 = d1;
  }

  // 白名单操作
  async isWhitelisted(userId) {
    const result = await this.d1.prepare(
      'SELECT user_id FROM whitelist WHERE user_id = ?'
    ).bind(userId.toString()).first();
    
    return !!result;
  }

  async addWhitelist(userId) {
    await this.d1.prepare(
      'INSERT OR IGNORE INTO whitelist (user_id, created_at) VALUES (?, ?)'
    ).bind(userId.toString(), Date.now()).run();
  }

  async removeWhitelist(userId) {
    await this.d1.prepare(
      'DELETE FROM whitelist WHERE user_id = ?'
    ).bind(userId.toString()).run();
  }

  async getWhitelist() {
    const result = await this.d1.prepare(
      'SELECT user_id FROM whitelist ORDER BY created_at DESC'
    ).all();
    
    return result.results || [];
  }

  // 验证状态操作
  async getVerificationState(userId) {
    const result = await this.d1.prepare(
      'SELECT answer, attempts, created_at FROM verification WHERE user_id = ?'
    ).bind(userId.toString()).first();
    
    if (!result) return null;
    
    // 检查是否过期（5分钟 = 300000毫秒）
    if (Date.now() - result.created_at > 300000) {
      await this.deleteVerification(userId);
      return null;
    }
    
    return result;
  }

  async setVerification(userId, answer, attempts = 0) {
    await this.d1.prepare(
      'INSERT OR REPLACE INTO verification (user_id, answer, attempts, created_at) VALUES (?, ?, ?, ?)'
    ).bind(userId.toString(), answer, attempts, Date.now()).run();
  }

  async updateVerificationAttempts(userId, attempts) {
    await this.d1.prepare(
      'UPDATE verification SET attempts = ? WHERE user_id = ?'
    ).bind(attempts, userId.toString()).run();
  }

  async deleteVerification(userId) {
    await this.d1.prepare(
      'DELETE FROM verification WHERE user_id = ?'
    ).bind(userId.toString()).run();
  }

  // 验证成功状态
  async isVerified(userId) {
    const result = await this.d1.prepare(
      'SELECT user_id FROM verified_users WHERE user_id = ? AND expiry_time > ?'
    ).bind(userId.toString(), Date.now()).first();
    
    return !!result;
  }

  async setVerified(userId, expirationTtl = 259200) {
    const expiryTime = Date.now() + (expirationTtl * 1000);
    await this.d1.prepare(
      'INSERT OR REPLACE INTO verified_users (user_id, expiry_time) VALUES (?, ?)'
    ).bind(userId.toString(), expiryTime).run();
  }

  // 屏蔽用户操作
  async isBlocked(userId) {
    const result = await this.d1.prepare(
      'SELECT user_id FROM blocked_users WHERE user_id = ?'
    ).bind(userId.toString()).first();
    
    return !!result;
  }

  async blockUser(userId) {
    await this.d1.prepare(
      'INSERT OR IGNORE INTO blocked_users (user_id, blocked_at) VALUES (?, ?)'
    ).bind(userId.toString(), Date.now()).run();
  }

  async unblockUser(userId) {
    await this.d1.prepare(
      'DELETE FROM blocked_users WHERE user_id = ?'
    ).bind(userId.toString()).run();
  }

  // 消息映射操作
  async getMessageMap(key) {
    const result = await this.d1.prepare(
      'SELECT mapped_value FROM message_mappings WHERE mapping_key = ?'
    ).bind(key).first();
    
    return result?.mapped_value || null;
  }

  async setMessageMap(key, value) {
    await this.d1.prepare(
      'INSERT OR REPLACE INTO message_mappings (mapping_key, mapped_value, created_at) VALUES (?, ?, ?)'
    ).bind(key, value, Date.now()).run();
  }

  // 消息时间戳操作
  async getLastMessageTime(userId) {
    const result = await this.d1.prepare(
      'SELECT last_message_time FROM message_rates WHERE user_id = ?'
    ).bind(userId.toString()).first();
    
    return result?.last_message_time || 0;
  }

  async setLastMessageTime(userId, timestamp) {
    await this.d1.prepare(
      'INSERT OR REPLACE INTO message_rates (user_id, last_message_time) VALUES (?, ?)'
    ).bind(userId.toString(), timestamp).run();
  }

  // 清理过期验证记录
  async cleanupExpiredVerifications() {
    const fiveMinutesAgo = Date.now() - 300000;
    await this.d1.prepare(
      'DELETE FROM verification WHERE created_at < ?'
    ).bind(fiveMinutesAgo).run();
  }
}

/**
 * 构建 Telegram API URL
 */
function apiUrl(methodName, params = null) {
  let query = '';
  if (params) {
    query = '?' + new URLSearchParams(params).toString();
  }
  return `https://api.telegram.org/bot${TOKEN}/${methodName}${query}`;
}

/**
 * 发送 Telegram 请求
 */
function requestTelegram(methodName, body, params = null) {
  return fetch(apiUrl(methodName, params), body).then(r => r.json());
}

/**
 * 构建请求体
 */
function makeReqBody(body) {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  };
}

/**
 * 发送消息
 */
function sendMessage(msg = {}) {
  return requestTelegram('sendMessage', makeReqBody(msg));
}

/**
 * 复制消息
 */
function copyMessage(msg = {}) {
  return requestTelegram('copyMessage', makeReqBody(msg));
}

/**
 * 转发消息
 */
function forwardMessage(msg) {
  return requestTelegram('forwardMessage', makeReqBody(msg));
}

/**
 * Webhook 监听 (Cloudflare Workers)
 */
export default {
  async fetch(request, env, ctx) {
    // 初始化配置
    initConfig(env);
    
    // 初始化数据库
    if (!db && env.lan) {
      db = new Database(env.lan);
    }
    
    const url = new URL(request.url);
    
    if (url.pathname === WEBHOOK) {
      return handleWebhook(request, ctx);
    } else if (url.pathname === '/registerWebhook') {
      return registerWebhook(url);
    } else if (url.pathname === '/unRegisterWebhook') {
      return unRegisterWebhook();
    } else if (url.pathname === '/initDatabase') {
      return initDatabase(env.lan);
    } else {
      return new Response('No handler for this request', { status: 404 });
    }
  }
};

/**
 * 处理 Webhook
 */
async function handleWebhook(request, ctx) {
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 });
  }
  
  try {
    const update = await request.json();
    ctx.waitUntil(onUpdate(update));
    return new Response('Ok');
  } catch (err) {
    console.error('❌ 处理 Webhook 错误:', err);
    return new Response('Error: ' + err.message, { status: 500 });
  }
}

/**
 * 处理消息
 */
async function onMessage(message) {
  // /start 命令
  if (message.text === '/start') {
    return sendMessage({
      chat_id: message.chat.id,
      text: '你好，这是我的聊天机器人，请通过验证后和我聊天，聊天消息会转发给我。\n\nBot Created Via @Squarelan'
    });
  }

  // 管理员命令
  if (message.chat.id.toString() === ADMIN_UID) {
    // ✅ 添加到白名单
    if (/^\/addwhite(?:\s+(\d+))?$/.test(message.text)) {
      return handleAddWhitelist(message);
    }
    
    // ✅ 从白名单移除
    if (/^\/removewhite(?:\s+(\d+))?$/.test(message.text)) {
      return handleRemoveWhitelist(message);
    }
    
    // ✅ 检查白名单状态
    if (/^\/checkwhite(?:\s+(\d+))?$/.test(message.text)) {
      return handleCheckWhitelist(message);
    }
    
    // ✅ 列出所有白名单
    if (/^\/listwhite$/.test(message.text)) {
      return handleListWhitelist(message);
    }

    if (!message?.reply_to_message?.chat) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '使用方法，回复转发的消息，并发送回复消息，或指令:\n' +
              '/block - 屏蔽用户\n' +
              '/unblock - 解除屏蔽\n' +
              '/checkblock - 检查屏蔽状态\n' +
              '/addwhite [UID] - 添加到白名单\n' +
              '/removewhite [UID] - 从白名单移除\n' +
              '/checkwhite [UID] - 检查白名单状态\n' +
              '/listwhite - 列出所有白名单用户'
      });
    }

    if (/^\/block$/.test(message.text)) {
      return handleBlock(message);
    }
    if (/^\/unblock$/.test(message.text)) {
      return handleUnBlock(message);
    }
    if (/^\/checkblock$/.test(message.text)) {
      return checkBlock(message);
    }

    const guestChatId = await db.getMessageMap('msg-map-' + message?.reply_to_message.message_id);
    return copyMessage({
      chat_id: guestChatId,
      from_chat_id: message.chat.id,
      message_id: message.message_id
    });
  }

  return handleGuestMessage(message);
}

/**
 * 从消息或命令参数中提取目标 UID
 */
async function getTargetUserId(message) {
  // 优先从命令参数中获取
  const match = message.text.match(/\/\w+\s+(\d+)/);
  if (match) {
    return match[1];
  }
  
  // 其次从回复消息中获取
  if (message.reply_to_message) {
    return await db.getMessageMap('msg-map-' + message.reply_to_message.message_id);
  }
  
  return null;
}

/**
 * 添加用户到白名单
 */
async function handleAddWhitelist(message) {
  const guestChatId = await getTargetUserId(message);
  
  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '❌ 用法: /addwhite <UID> 或回复一条转发的消息'
    });
  }

  await db.addWhitelist(guestChatId);
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `✅ UID: ${guestChatId} 已添加到白名单`
  });
}

/**
 * 从白名单移除用户
 */
async function handleRemoveWhitelist(message) {
  const guestChatId = await getTargetUserId(message);
  
  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '❌ 用法: /removewhite <UID> 或回复一条转发的消息'
    });
  }

  await db.removeWhitelist(guestChatId);
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `✅ UID: ${guestChatId} 已从白名单移除`
  });
}

/**
 * 检查白名单状态
 */
async function handleCheckWhitelist(message) {
  const guestChatId = await getTargetUserId(message);
  
  if (!guestChatId) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '❌ 用法: /checkwhite <UID> 或回复一条转发的消息'
    });
  }

  const isWhite = await db.isWhitelisted(guestChatId);
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID: ${guestChatId} ${isWhite ? '✅ 在白名单中' : '❌ 不在白名单中'}`
  });
}

/**
 * 列出所有白名单用户
 */
async function handleListWhitelist(message) {
  const whitelistArray = await db.getWhitelist();
  
  if (whitelistArray.length === 0) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '📋 白名单为空'
    });
  }
  
  const list = whitelistArray.map(u => u.user_id).join('\n');
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `📋 白名单用户列表 (共 ${whitelistArray.length} 个):\n${list}`
  });
}

/**
 * 处理回调查询（按钮点击）
 */
async function onCallbackQuery(callbackQuery) {
  try {
    const userId = callbackQuery.from.id.toString();
    const data = callbackQuery.data;
    const messageId = callbackQuery.message.message_id;

    // 格式: verify_{answer}_{correctAnswer}
    if (!data.startsWith('verify_')) {
      return;
    }

    const [, userAnswer, correctAnswer] = data.split('_');

    if (userAnswer === correctAnswer) {
      await db.setVerified(userId);
      await db.deleteVerification(userId);
      
      await requestTelegram('editMessageText', makeReqBody({
        chat_id: userId,
        message_id: messageId,
        text: '✅ 验证成功，你现在可以使用机器人了！',
        reply_markup: undefined
      }));
    } else {
      // 记录尝试次数
      const verState = await db.getVerificationState(userId);
      const attempts = (verState?.attempts || 0) + 1;
      
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await db.blockUser(userId);
        await db.deleteVerification(userId);
        
        await requestTelegram('editMessageText', makeReqBody({
          chat_id: userId,
          message_id: messageId,
          text: '❌ 验证失败次数过多，已屏蔽',
          reply_markup: undefined
        }));
      } else {
        await db.updateVerificationAttempts(userId, attempts);
        
        await requestTelegram('answerCallbackQuery', makeReqBody({
          callback_query_id: callbackQuery.id,
          text: `❌ 回答错误 (${attempts}/${MAX_VERIFY_ATTEMPTS})，请重新尝试`,
          show_alert: true
        }));
      }
    }
  } catch (err) {
    console.error('处理回调查询错误:', err);
  }
}

/**
 * 处理更新
 */
async function onUpdate(update) {
  try {
    if ('message' in update) {
      await onMessage(update.message);
    }
    if ('callback_query' in update) {
      await onCallbackQuery(update.callback_query);
    }
  } catch (err) {
    console.error('处理更新错误:', err);
  }
}

/**
 * 处理客户消息
 */
async function handleGuestMessage(message) {
  try {
    const chatId = message.chat.id.toString();

    // ✅ 白名单用户直接跳过验证和屏蔽检查
    const whitelisted = await db.isWhitelisted(chatId);
    
    if (whitelisted) {
      // 白名单用户直接转发消息
      const forwardReq = await forwardMessage({
        chat_id: ADMIN_UID,
        from_chat_id: message.chat.id,
        message_id: message.message_id
      });
      
      if (forwardReq.ok) {
        await db.setMessageMap('msg-map-' + forwardReq.result.message_id, chatId);
        return handleNotify(message, chatId);
      }
      return;
    }

    // 检查是否被屏蔽
    const isblocked = await db.isBlocked(chatId);
    if (isblocked) {
      return sendMessage({
        chat_id: chatId,
        text: 'You are blocked'
      });
    }

    // 检查是否已验证
    const verified = await db.isVerified(chatId);
    if (!verified) {
      const verState = await db.getVerificationState(chatId);

      if (!verState) {
        const { question, answer } = generateMathProblem();
        await db.setVerification(chatId, answer, 0);

        const options = generateOptions(parseInt(answer));

        const keyboard = {
          inline_keyboard: [
            [
              { text: options[0], callback_data: `verify_${options[0]}_${answer}` },
              { text: options[1], callback_data: `verify_${options[1]}_${answer}` },
              { text: options[2], callback_data: `verify_${options[2]}_${answer}` }
            ],
            [
              { text: options[3], callback_data: `verify_${options[3]}_${answer}` },
              { text: options[4], callback_data: `verify_${options[4]}_${answer}` },
              { text: options[5], callback_data: `verify_${options[5]}_${answer}` }
            ]
          ]
        };

        return sendMessage({
          chat_id: chatId,
          text: `🔐 请回答以下问题以验证你不是机器人：\n\n${question} = ?`,
          reply_markup: keyboard
        });
      } else {
        return sendMessage({
          chat_id: chatId,
          text: '请点击上面的按钮选择答案'
        });
      }
    }

    // 诈骗检查
    if (await isFraud(chatId)) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: `⚠️ 检测到诈骗人员\nUID: ${chatId}`
      });
    }

    // 已验证用户 → 转发消息
    const forwardReq = await forwardMessage({
      chat_id: ADMIN_UID,
      from_chat_id: message.chat.id,
      message_id: message.message_id
    });

    if (forwardReq.ok) {
      await db.setMessageMap('msg-map-' + forwardReq.result.message_id, chatId);
      return handleNotify(message, chatId);
    }
  } catch (err) {
    console.error('处理客户消息错误:', err);
  }
}

/**
 * 生成六个选项（包含正确答案）
 */
function generateOptions(correctAnswer) {
  const options = [correctAnswer];
  
  while (options.length < 6) {
    let wrongAnswer = correctAnswer + Math.floor(Math.random() * 20) - 10;
    
    if (wrongAnswer !== correctAnswer && !options.includes(wrongAnswer) && wrongAnswer > 0) {
      options.push(wrongAnswer);
    }
  }
  
  return options.sort(() => Math.random() - 0.5);
}

/**
 * 处理通知
 */
async function handleNotify(message, chatId) {
  try {
    if (await isFraud(chatId)) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: `检测到骗子，UID: ${chatId}`
      });
    }

    if (enable_notification) {
      const lastMsgTime = await db.getLastMessageTime(chatId);
      if (!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL) {
        await db.setLastMessageTime(chatId, Date.now());
        const notification = await fetch(notificationUrl).then(r => r.text());
        return sendMessage({
          chat_id: ADMIN_UID,
          text: notification
        });
      }
    }
  } catch (err) {
    console.error('处理通知错误:', err);
  }
}

/**
 * 处理屏蔽
 */
async function handleBlock(message) {
  try {
    const guestChatId = await db.getMessageMap('msg-map-' + message.reply_to_message.message_id);

    if (!guestChatId) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '❌ 无法获取用户ID'
      });
    }

    if (guestChatId === ADMIN_UID) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '不能屏蔽自己'
      });
    }

    await db.blockUser(guestChatId);
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `UID: ${guestChatId} 屏蔽成功`
    });
  } catch (err) {
    console.error('处理屏蔽错误:', err);
  }
}

/**
 * 处理解除屏蔽
 */
async function handleUnBlock(message) {
  try {
    const guestChatId = await db.getMessageMap('msg-map-' + message.reply_to_message.message_id);

    if (!guestChatId) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '❌ 无法获取用户ID'
      });
    }

    await db.unblockUser(guestChatId);
    return sendMessage({
      chat_id: ADMIN_UID,
      text: `UID: ${guestChatId} 解除屏蔽成功`
    });
  } catch (err) {
    console.error('处理解除屏蔽错误:', err);
  }
}

/**
 * 检查屏蔽状态
 */
async function checkBlock(message) {
  try {
    const guestChatId = await db.getMessageMap('msg-map-' + message.reply_to_message.message_id);

    if (!guestChatId) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '❌ 无法获取用户ID'
      });
    }

    const blocked = await db.isBlocked(guestChatId);

    return sendMessage({
      chat_id: ADMIN_UID,
      text: `UID: ${guestChatId} ${blocked ? '被屏蔽' : '没有被屏蔽'}`
    });
  } catch (err) {
    console.error('检查屏蔽状态错误:', err);
  }
}

/**
 * 检查是否是诈骗人员
 */
async function isFraud(id) {
  try {
    id = id.toString();
    const db_list = await fetch(fraudDb).then(r => r.text());
    const arr = db_list.split('\n').filter(v => v.trim());
    return arr.some(v => v.trim() === id);
  } catch (err) {
    console.error('检查诈骗列表错误:', err);
    return false;
  }
}

/**
 * 注册 Webhook
 */
async function registerWebhook(requestUrl) {
  try {
    const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${WEBHOOK}`;
    const r = await fetch(apiUrl('setWebhook'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        url: webhookUrl,
        secret_token: SECRET,
        allowed_updates: ['message', 'callback_query']
      })
    }).then(r => r.json());
    
    return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
  } catch (err) {
    console.error('注册 Webhook 错误:', err);
    return new Response(JSON.stringify({ error: err.message }, null, 2), { status: 500 });
  }
}

/**
 * 注销 Webhook
 */
async function unRegisterWebhook() {
  try {
    const r = await fetch(apiUrl('setWebhook'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: '' })
    }).then(r => r.json());
    
    return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
  } catch (err) {
    console.error('注销 Webhook 错误:', err);
    return new Response(JSON.stringify({ error: err.message }, null, 2), { status: 500 });
  }
}

/**
 * 初始化数据库表
 */
async function initDatabase(d1) {
  const statements = [
    // 创建表
    `CREATE TABLE IF NOT EXISTS whitelist (
      user_id TEXT PRIMARY KEY,
      created_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS verification (
      user_id TEXT PRIMARY KEY,
      answer TEXT,
      attempts INTEGER DEFAULT 0,
      created_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS verified_users (
      user_id TEXT PRIMARY KEY,
      expiry_time INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS blocked_users (
      user_id TEXT PRIMARY KEY,
      blocked_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS message_mappings (
      mapping_key TEXT PRIMARY KEY,
      mapped_value TEXT,
      created_at INTEGER
    )`,
    `CREATE TABLE IF NOT EXISTS message_rates (
      user_id TEXT PRIMARY KEY,
      last_message_time INTEGER
    )`,
    // 创建索引
    'CREATE INDEX IF NOT EXISTS idx_verification_created ON verification(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_verified_expiry ON verified_users(expiry_time)',
    'CREATE INDEX IF NOT EXISTS idx_mappings_key ON message_mappings(mapping_key)'
  ];

  try {
    const preparedStatements = statements.map(sql => d1.prepare(sql));
    await d1.batch(preparedStatements);
    console.log('✅ 数据库表初始化成功');
    
    return new Response('✅ 数据库初始化成功', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  } catch (error) {
    console.error('❌ 数据库初始化错误:', error);
    return new Response(`❌ 数据库初始化失败: ${error.message}`, {
      status: 500,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}
