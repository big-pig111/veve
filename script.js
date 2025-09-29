/* 极简 AI 对话 - 前端逻辑（可离线本地回退，可选 OpenAI） */

const elements = {
  messages: document.getElementById('messages'),
  composer: document.getElementById('composer'),
  input: document.getElementById('input'),
  send: document.getElementById('send'),
  settingsBtn: document.getElementById('settings-btn'),
  settingsDialog: document.getElementById('settings'),
  settingsForm: document.getElementById('settings-form'),
  apiKey: document.getElementById('apiKey'),
  model: document.getElementById('model'),
  saveSettings: document.getElementById('saveSettings'),
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
  } catch {}
}

const STORAGE_KEYS = {
  history: 'chat.history',
  apiKey: 'openai.apiKey',
  model: 'openai.model',
};

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

function loadSettings() {
  return {
    apiKey: localStorage.getItem(STORAGE_KEYS.apiKey) || '',
    model: localStorage.getItem(STORAGE_KEYS.model) || 'gpt-4o-mini',
  };
}

function saveSettingsToStorage({ apiKey, model }) {
  try {
    if (apiKey !== undefined) localStorage.setItem(STORAGE_KEYS.apiKey, apiKey);
    if (model !== undefined) localStorage.setItem(STORAGE_KEYS.model, model);
  } catch {}
}

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

// 绑定 Telegram 主按钮发送
if (tg && tg.MainButton) {
  tg.MainButton.setParams({ text: '发送', is_visible: true });
  tg.onEvent('mainButtonClicked', () => {
    elements.composer.requestSubmit();
  });
}

// 初始欢迎
if (chatHistory.length === 0) {
  const hello = '准备就绪。';
  chatHistory.push({ role: 'ai', content: hello });
  saveHistory(chatHistory);
}

renderAll(chatHistory);
autosizeTextarea();

// 设置逻辑
const currentSettings = loadSettings();
elements.apiKey.value = currentSettings.apiKey;
elements.model.value = currentSettings.model;

elements.settingsBtn.addEventListener('click', () => {
  if (typeof elements.settingsDialog.showModal === 'function') {
    elements.settingsDialog.showModal();
  }
});

elements.saveSettings.addEventListener('click', (e) => {
  e.preventDefault();
  const apiKey = elements.apiKey.value.trim();
  const model = elements.model.value.trim() || 'gpt-4o-mini';
  saveSettingsToStorage({ apiKey, model });
  elements.settingsDialog.close();
});

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
    thinkingEl.textContent = '抱歉，出错了。已切换为本地回答。';
    const fallback = localFallback(text);
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
  const { apiKey, model } = loadSettings();
  if (!apiKey) {
    // 没有 Key，直接本地回退
    return localFallback(userText);
  }

  // 组装消息：只取最近若干条，控制上下文
  const recent = history.slice(-12);
  const messages = [
    { role: 'system', content: '请以简洁、礼貌、准确的中文回答，避免多余营销或拟人话术。' },
    ...recent.map(m => ({ role: m.role === 'ai' ? 'assistant' : m.role, content: m.content })),
    { role: 'user', content: userText },
  ];

  const body = {
    model: model || 'gpt-4o-mini',
    messages,
    temperature: 0.6,
  };

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error('OpenAI API error: ' + res.status);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content?.trim();
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



