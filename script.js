/* 极简 AI 对话 - 前端逻辑（由 veve 开发） */

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

function loadSettings() { return { model: 'gpt-4o' }; }
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
  meta.textContent = role === 'user' ? 'You' : 'Assistant';

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

// 回车发送，Shift+Enter 换行
elements.input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    elements.composer.requestSubmit();
  }
});

// 不使用 Telegram 大按钮，统一用内置发送键

// Initial welcome
if (chatHistory.length === 0) {
  const hello = 'Hello! I\'m an AI assistant developed by veve. How can I help you today?';
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

  const thinkingEl = appendMessage('ai', 'Thinking...');

  try {
    const reply = await getAIResponse(text, chatHistory);
    thinkingEl.textContent = '';
    await typeText(thinkingEl, reply);
    chatHistory.push({ role: 'ai', content: reply });
    saveHistory(chatHistory);
  } catch (err) {
    console.error('proxy error', err);
    thinkingEl.textContent = 'Backend unavailable, using local fallback.';
    const fallback = localFallback(text) + (err && err.message ? `\n(Note: ${err.message})` : '');
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

// Local offline fallback: brief echo + suggestion
function localFallback(input) {
  const trimmed = input.replace(/\s+/g, ' ').slice(0, 140);
  const hints = [
    'I can help with summarizing, refining, translating, or organizing key points.',
    'Feel free to expand or narrow down the topic.',
    'You can provide more context or ask follow-up questions anytime.',
  ];
  const tip = hints[Math.floor(Math.random() * hints.length)];
  return `You said: "${trimmed}". Got it.` + '\n' + tip;
}

async function getAIResponse(userText, history) {
  const { model } = loadSettings();
  // 组装消息：只取最近若干条，控制上下文
  const recent = history.slice(-12);
  const messages = [
    { role: 'system', content: 'You are an AI assistant developed by veve. Please provide concise, polite, and accurate responses. Avoid unnecessary marketing language or overly anthropomorphic tone.' },
    ...recent.map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content })),
    { role: 'user', content: userText },
  ];

  // Smarter trigger: match real-time keywords or web/search prefix
  function isWebQuery(text) {
    const t = text.trim().toLowerCase();
    if (/^(web|search|find)\b/.test(t)) return true;
    const realtime = /(weather|temperature|now|today|tomorrow|this week|real-time|latest|news|breaking|price|stock|exchange rate|flight|traffic)/i;
    return realtime.test(text);
  }
  const shouldWeb = isWebQuery(userText);
  if (shouldWeb && window.functionsBase) {
    // If contains weather keywords, prioritize weather API
    if (/(weather|temperature|forecast)/i.test(userText)) {
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
      body: JSON.stringify({ q: userText.replace(/^(web|search|find)\s*/i,'').trim(), model: model || 'gpt-4o' }),
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
    body: JSON.stringify({ model: model || 'gpt-4o', messages, temperature: 0.6 }),
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



