/* 极简 AI 对话 - 前端逻辑（可离线本地回退，可选 OpenAI） */

const elements = {
  messages: document.getElementById('messages'),
  composer: document.getElementById('composer'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  bgVideo: document.getElementById('bg-video'),
};

// Telegram Mini Apps 适配
const tg = window.Telegram && window.Telegram.WebApp ? window.Telegram.WebApp : null;
if (tg) {
  try {
    tg.expand();
    tg.ready();
    // 同步主题到 CSS 变量（深色为主）
    document.documentElement.style.setProperty('--tg-bg', tg.backgroundColor || '#0a0910');
    document.documentElement.style.setProperty('--tg-text', tg.textColor || 'rgba(255,255,255,0.92)');
    // 标记 Telegram 环境，供样式覆盖使用
    document.documentElement.classList.add('tg', 'fullchat');
    if (tg.MainButton) {
      try { tg.MainButton.hide(); } catch {}
    }
  } catch {}
}

const STORAGE_KEYS = { history: 'chat.history' };

function loadHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.history);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(history) {
  try {
    localStorage.setItem(STORAGE_KEYS.history, JSON.stringify(history.slice(-40)));
  } catch {}
}

function loadSettings() { return { model: 'gpt-4o-mini' }; }
function saveSettingsToStorage() {}

let chatHistory = loadHistory();

function createMessageElement(role, text) {
  const wrapper = document.createElement('div');
  wrapper.className = `message ${role}`;

  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;

  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = role === 'user' ? '你' : '回应';

  wrapper.appendChild(bubble);
  wrapper.appendChild(meta);
  return { wrapper, bubble, meta };
}

function renderAll(history) {
  elements.messages.innerHTML = '';
  for (const m of history) {
    const { wrapper } = createMessageElement(m.role, m.content);
    elements.messages.appendChild(wrapper);
  }
  scrollToBottom();
}

function appendMessage(role, text) {
  const { wrapper, bubble } = createMessageElement(role, text);
  elements.messages.appendChild(wrapper);
  scrollToBottom();
  return bubble;
}

function scrollToBottom() {
  elements.messages.scrollTo({ top: elements.messages.scrollHeight, behavior: 'smooth' });
}

function autosizeTextarea() {
  const el = elements.input;
  el.style.height = 'auto';
  const max = 160;
  el.style.height = Math.min(el.scrollHeight, max) + 'px';
}

elements.input.addEventListener('input', autosizeTextarea);

// 不使用 Telegram 大按钮，统一用内置发送键

// 初始欢迎
if (chatHistory.length === 0) {
  const hello = '准备就绪。';
  chatHistory.push({ role: 'ai', content: hello });
  saveHistory(chatHistory);
}

renderAll(chatHistory);
autosizeTextarea();

// 无设置逻辑，全部在后端配置

// 发送消息
elements.composer.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = elements.input.value.trim();
  if (!text) return;

  elements.input.value = '';
  autosizeTextarea();

  chatHistory.push({ role: 'user', content: text });
  saveHistory(chatHistory);
  appendMessage('user', text);

  const thinkingEl = appendMessage('ai', '处理中…');

  try {
    const reply = await getAIResponse(text, chatHistory);
    thinkingEl.textContent = '';
    await typeText(thinkingEl, reply);
    chatHistory.push({ role: 'ai', content: reply });
    saveHistory(chatHistory);
  } catch (err) {
    console.error('proxy error', err);
    thinkingEl.textContent = '后端不可用，已切换为本地回答。';
    const fallback = localFallback(text) + (err && err.message ? `\n(提示: ${err.message})` : '');
    const { bubble } = createMessageElement('ai', '');
    thinkingEl.parentElement.replaceChild(bubble, thinkingEl);
    await typeText(bubble, fallback);
    chatHistory.push({ role: 'ai', content: fallback });
    saveHistory(chatHistory);
  } finally {
    scrollToBottom();
  }
});

// 打字机效果（轻微延迟）
function typeText(el, text) {
  return new Promise((resolve) => {
    const chars = [...text];
    let i = 0;
    const tick = () => {
      const step = Math.min(3, chars.length - i);
      el.textContent += chars.slice(i, i + step).join('');
      i += step;
      if (i < chars.length) {
        setTimeout(tick, 8);
      } else {
        resolve();
      }
    };
    tick();
  });
}

// 本地离线回退：简要复述 + 建议
function localFallback(input) {
  const trimmed = input.replace(/\s+/g, ' ').slice(0, 140);
  const hints = [
    '可帮助总结、润色、翻译、整理要点。',
    '也可以在此基础上继续展开或收敛。',
    '随时输入新的方向或补充信息。',
  ];
  const tip = hints[Math.floor(Math.random() * hints.length)];
  return `你说："${trimmed}"。已收到。` + '\n' + tip;
}

async function getAIResponse(userText, history) {
  const { model } = loadSettings();
  // 组装消息：只取最近若干条，控制上下文
  const recent = history.slice(-12);
  const messages = [
    { role: 'system', content: '请以简洁、礼貌、准确的中文回答，避免多余营销或拟人话术。' },
    ...recent.map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content })),
    { role: 'user', content: userText },
  ];

  // 更智能的触发：命中实时关键词（天气/最新/今天/现在/实时/新闻/价格/汇率等）或以 web/搜索/查 开头
  function isWebQuery(text) {
    const t = text.trim().toLowerCase();
    if (/^(web|搜索|查)\b/.test(t)) return true;
    const realtime = /(天气|气温|现在|今日|今天|明天|本周|实时|最新|新闻|快讯|价格|股价|汇率|航班|路况|限号)/i;
    return realtime.test(text);
  }
  const shouldWeb = isWebQuery(userText);
  if (shouldWeb && window.functionsBase) {
    // 若包含天气关键词，优先调用实时天气接口
    if (/(天气|气温|温度)/i.test(userText)) {
      const resW = await fetch(`${window.functionsBase}/weatherNow`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: userText })
      });
      if (resW.ok) {
        const data = await resW.json();
        if (data && data.content) return data.content;
      }
    }
    const res = await fetch(`${window.functionsBase}/searchAnswer`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: userText.replace(/^(web|搜索|查)\s*/i,'').trim(), model: model || 'gpt-4o-mini' }),
    });
    if (!res.ok) throw new Error('search error: ' + res.status);
    const data = await res.json();
    const content = (data && data.content || '').trim();
    if (content) return content;
  }

  if (!window.functionsBase) {
    // 未配置云函数，走本地回退
    return localFallback(userText);
  }

  const res = await fetch(`${window.functionsBase}/chatProxy`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model || 'gpt-4o-mini', messages, temperature: 0.6 }),
  });
  if (!res.ok) throw new Error('proxy error: ' + res.status);
  const data = await res.json();
  const content = (data && data.content || '').trim();
  if (!content) throw new Error('No content');
  return content;
}

// 视频播放兼容
if (elements.bgVideo) {
  const tryPlay = () => elements.bgVideo.play().catch(() => {});
  document.addEventListener('visibilitychange', tryPlay, { passive: true });
  window.addEventListener('click', tryPlay, { passive: true });
  tryPlay();
}



