/**
 * 生成时间基础的数学验证题
 * 使用 Intl.DateTimeFormat 获取指定时区的时间
 * 随机选取时间中的两位数字，各加上一个随机值，超过10取个位数
 */
function generateMathProblem() {
  // 使用 Intl.DateTimeFormat 获取指定时区的时间
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  
  // 解析格式化后的时间部分
  const parts = formatter.formatToParts(new Date());
  const timeObj = {};
  parts.forEach(part => {
    if (part.type !== 'literal') {
      timeObj[part.type] = part.value;
    }
  });
  
  // 合成 HHmmss（6位数字）
  const timeDigits = timeObj.hour + timeObj.minute + timeObj.second;
  
  // 随机选取两个不同的位置
  let pos1 = Math.floor(Math.random() * timeDigits.length);
  let pos2 = Math.floor(Math.random() * timeDigits.length);
  while (pos2 === pos1) {
    pos2 = Math.floor(Math.random() * timeDigits.length);
  }
  
  // 随机生成加上的固定值 (1-9)
  const addValue = Math.floor(Math.random() * (VERIFY_ADD_VALUE_MAX - VERIFY_ADD_VALUE_MIN + 1)) + VERIFY_ADD_VALUE_MIN;
  
  // 获取两个数字
  const digit1 = parseInt(timeDigits[pos1]);
  const digit2 = parseInt(timeDigits[pos2]);
  
  // 计算答案（超过10则取个位数）
  const result1 = (digit1 + addValue) % 10;
  const result2 = (digit2 + addValue) % 10;
  
  const answer = result1.toString() + result2.toString();
  
  // 问题显示
  const question = `🔐 时间: ${timeObj.hour}:${timeObj.minute}:${timeObj.second}\n第${pos1 + 1}位数字(${digit1}) + ${addValue} = ${digit1 + addValue} → ${result1}\n第${pos2 + 1}位数字(${digit2}) + ${addValue} = ${digit2 + addValue} → ${result2}\n\n答案是多少?`;
  
  return { 
    question: question, 
    answer: answer
  };
}

/**
 * 常量配置和环境变量初始化
 */
let TOKEN, WEBHOOK, SECRET, ADMIN_UID, lan;

const NOTIFY_INTERVAL = 24 * 3600 * 1000;  // ⏱️ 24小时通知间隔
const fraudDb = 'https://raw.githubusercontent.com/Squarelan/telegram-verify-bot/main/data/fraud.db';
const notificationUrl = 'https://raw.githubusercontent.com/Squarelan/telegram-verify-bot/main/data/notification.txt';
const enable_notification = false;
const MAX_VERIFY_ATTEMPTS = 10;  // 🔢 最多尝试10次
const VERIFICATION_TTL = 300;  // ⏱️ 验证码过期时间：5分钟（300秒）
const VERIFIED_TTL = 259200;  // ⏱️ 验证成功有效期：3天（259200秒）

// ✨ 新增：时区和验证算法配置
const VERIFY_ADD_VALUE_MIN = 1;      // 随机加值最小范围
const VERIFY_ADD_VALUE_MAX = 9;      // 随机加值最大范围
let TIMEZONE;  // 动态配置，从环境变量读取

/**
 * 处理请求的主入口（用于 Service Worker）
 */
function initConfig(env) {
  TOKEN = env.BOT_TOKEN;
  SECRET = env.BOT_SECRET;
  ADMIN_UID = env.ADMIN_UID;
  WEBHOOK = '/endpoint';
  lan = env.lan;
  TIMEZONE = env.TIMEZONE || 'UTC';  // ✨ 新增：读取时区配置，默认 UTC
  
  if (!TOKEN || !SECRET || !ADMIN_UID) {
    throw new Error('❌ 环境变量未配置: BOT_TOKEN, BOT_SECRET, ADMIN_UID');
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
    
    const url = new URL(request.url);
    
    if (url.pathname === WEBHOOK) {
      return handleWebhook(request);
    } else if (url.pathname === '/registerWebhook') {
      return registerWebhook(request, url, WEBHOOK, SECRET);
    } else if (url.pathname === '/unRegisterWebhook') {
      return unRegisterWebhook(request);
    } else {
      return new Response('No handler for this request', { status: 404 });
    }
  }
};

/**
 * 处理 Webhook
 */
async function handleWebhook(request) {
  if (request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== SECRET) {
    return new Response('Unauthorized', { status: 403 });
  }
  
  try {
    const update = await request.json();
    // 异步处理，不阻塞响应
    await onUpdate(update);
    return new Response('Ok');
  } catch (err) {
    console.error('❌ 处理 Webhook 错误:', err);
    return new Response('Error: ' + err.message, { status: 500 });
  }
}

/**
 * 检查用户是否在白名单中
 */
async function isWhitelisted(userId) {
  userId = userId.toString();
  const whitelisted = await lan.get('whitelist-' + userId);
  return whitelisted === 'true';
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
    // ✅ 修复：添加到白名单
    if (/^\/addwhite(?:\s+(\d+))?$/.test(message.text)) {
      return handleAddWhitelist(message);
    }
    
    // ✅ 修复：从白名单移除
    if (/^\/removewhite(?:\s+(\d+))?$/.test(message.text)) {
      return handleRemoveWhitelist(message);
    }
    
    // ✅ 修复：检查白名单状态
    if (/^\/checkwhite(?:\s+(\d+))?$/.test(message.text)) {
      return handleCheckWhitelist(message);
    }
    
    // ✅ 修复：列出所有白名单
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

    const guestChatId = await lan.get('msg-map-' + message?.reply_to_message.message_id);
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
    return await lan.get('msg-map-' + message.reply_to_message.message_id);
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

  await lan.put('whitelist-' + guestChatId, 'true');
  
  // 同步更新白名单列表
  let whitelistData = (await lan.get('whitelist-data')) || '';
  const whitelistArray = whitelistData ? whitelistData.split(',').filter(v => v) : [];
  if (!whitelistArray.includes(guestChatId)) {
    whitelistArray.push(guestChatId);
    await lan.put('whitelist-data', whitelistArray.join(','));
  }
  
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

  await lan.delete('whitelist-' + guestChatId);
  
  // 同步更新白名单列表
  let whitelistData = (await lan.get('whitelist-data')) || '';
  const whitelistArray = whitelistData.split(',').filter(v => v && v !== guestChatId);
  await lan.put('whitelist-data', whitelistArray.join(','));
  
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

  const isWhite = await lan.get('whitelist-' + guestChatId);
  
  return sendMessage({
    chat_id: ADMIN_UID,
    text: `UID: ${guestChatId} ${isWhite === 'true' ? '✅ 在白名单中' : '❌ 不在白名单中'}`
  });
}

/**
 * 列出所有白名单用户
 */
async function handleListWhitelist(message) {
  const whitelistData = (await lan.get('whitelist-data')) || '';
  const whitelistArray = whitelistData ? whitelistData.split(',').filter(v => v) : [];
  
  if (whitelistArray.length === 0) {
    return sendMessage({
      chat_id: ADMIN_UID,
      text: '📋 白名单为空'
    });
  }
  
  const list = whitelistArray.join('\n');
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
      await lan.put('verified-' + userId, 'true', { expirationTtl: VERIFIED_TTL });  // ✅ 3天有效期
      await lan.delete('verify-' + userId);
      await lan.delete('verify-attempts-' + userId);
      
      await requestTelegram('editMessageText', makeReqBody({
        chat_id: userId,
        message_id: messageId,
        text: '✅ 验证成功，你现在可以使用机器人了！',
        reply_markup: undefined
      }));
    } else {
      // ✅ 新增：记录尝试次数
      const attempts = parseInt(await lan.get('verify-attempts-' + userId) || '0') + 1;
      
      if (attempts >= MAX_VERIFY_ATTEMPTS) {
        await lan.delete('verify-' + userId);
        await lan.put('isblocked-' + userId, 'true');
        await requestTelegram('editMessageText', makeReqBody({
          chat_id: userId,
          message_id: messageId,
          text: '❌ 验证失败次数过多，已屏蔽',
          reply_markup: undefined
        }));
      } else {
        await lan.put('verify-attempts-' + userId, attempts.toString(), { expirationTtl: VERIFICATION_TTL });  // ✅ 5分钟过期
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
    const whitelisted = await isWhitelisted(chatId);
    
    if (whitelisted) {
      // 白名单用户直接转发消息
      const forwardReq = await forwardMessage({
        chat_id: ADMIN_UID,
        from_chat_id: message.chat.id,
        message_id: message.message_id
      });
      
      if (forwardReq.ok) {
        await lan.put('msg-map-' + forwardReq.result.message_id, chatId);
        return handleNotify(message, chatId);
      }
      return;
    }

    // 检查是否被屏蔽
    const isblocked = await lan.get('isblocked-' + chatId);
    if (isblocked === 'true') {
      return sendMessage({
        chat_id: chatId,
        text: 'You are blocked'
      });
    }

    // 检查是否已验证
    const verified = await lan.get('verified-' + chatId);
    if (!verified) {
      const expected = await lan.get('verify-' + chatId);

      if (!expected) {
        const { question, answer } = generateMathProblem();
        await lan.put('verify-' + chatId, answer, { expirationTtl: VERIFICATION_TTL });  // ✅ 5分钟过期
        await lan.put('verify-attempts-' + chatId, '0', { expirationTtl: VERIFICATION_TTL });  // ✅ 5分钟过期

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
      await lan.put('msg-map-' + forwardReq.result.message_id, chatId);
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
    // 生成干扰项
    let wrongAnswer = correctAnswer + Math.floor(Math.random() * 20) - 10;
    
    // 确保干扰项不重复且不等于正确答案
    if (wrongAnswer !== correctAnswer && !options.includes(wrongAnswer) && wrongAnswer > 0) {
      options.push(wrongAnswer);
    }
  }
  
  // 打乱顺序
  return options.sort(() => Math.random() - 0.5);
}

/**
 * 处理通知
 */
async function handleNotify(message, chatId) {
  try {
    // 检查是否在诈骗名单中
    if (await isFraud(chatId)) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: `检测到骗子，UID: ${chatId}`
      });
    }

    // 根据时间间隔提醒
    if (enable_notification) {
      const lastMsgTime = parseInt(await lan.get('lastmsg-' + chatId) || '0');
      if (!lastMsgTime || Date.now() - lastMsgTime > NOTIFY_INTERVAL) {  // ⏱️ 24小时检查
        await lan.put('lastmsg-' + chatId, Date.now().toString());
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
    const guestChatId = await lan.get('msg-map-' + message.reply_to_message.message_id);

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

    await lan.put('isblocked-' + guestChatId, 'true');
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
    const guestChatId = await lan.get('msg-map-' + message.reply_to_message.message_id);

    if (!guestChatId) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '❌ 无法获取用户ID'
      });
    }

    await lan.delete('isblocked-' + guestChatId);
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
    const guestChatId = await lan.get('msg-map-' + message.reply_to_message.message_id);

    if (!guestChatId) {
      return sendMessage({
        chat_id: ADMIN_UID,
        text: '❌ 无法获取用户ID'
      });
    }

    const blocked = await lan.get('isblocked-' + guestChatId);

    return sendMessage({
      chat_id: ADMIN_UID,
      text: `UID: ${guestChatId} ${blocked === 'true' ? '被屏蔽' : '没有被屏蔽'}`
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
    const db = await fetch(fraudDb).then(r => r.text());
    const arr = db.split('\n').filter(v => v.trim());
    return arr.some(v => v.trim() === id);
  } catch (err) {
    console.error('检查诈骗列表错误:', err);
    return false;
  }
}

/**
 * 注册 Webhook
 */
async function registerWebhook(event, requestUrl, suffix, secret) {
  try {
    const webhookUrl = `${requestUrl.protocol}//${requestUrl.hostname}${suffix}`;
    const r = await fetch(apiUrl('setWebhook', { url: webhookUrl, secret_token: secret })).then(r => r.json());
    return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
  } catch (err) {
    console.error('注册 Webhook 错误:', err);
    return new Response(JSON.stringify({ error: err.message }, null, 2), { status: 500 });
  }
}

/**
 * 注销 Webhook
 */
async function unRegisterWebhook(event) {
  try {
    const r = await fetch(apiUrl('setWebhook', { url: '' })).then(r => r.json());
    return new Response('ok' in r && r.ok ? 'Ok' : JSON.stringify(r, null, 2));
  } catch (err) {
    console.error('注销 Webhook 错误:', err);
    return new Response(JSON.stringify({ error: err.message }, null, 2), { status: 500 });
  }
}
