// ─── DOM Elements ───
const loginScreen      = document.getElementById('login-screen');
const chatScreen       = document.getElementById('chat-screen');
const usernameInput    = document.getElementById('username-input');
const joinBtn          = document.getElementById('join-btn');
const messagesArea     = document.getElementById('messages');
const messageInput     = document.getElementById('message-input');
const sendBtn          = document.getElementById('send-btn');
const fileUpload       = document.getElementById('file-upload');
const attachPreview    = document.getElementById('attachment-preview');
const previewImg       = document.getElementById('preview-img');
const filePreviewInfo  = document.getElementById('file-preview-info');
const filePreviewName  = document.getElementById('file-preview-name');
const removeAttachment = document.getElementById('remove-attachment');
const typingIndicator  = document.getElementById('typing-indicator');
const typingNameEl     = document.getElementById('typing-name');
const usersList        = document.getElementById('users-list');
const myAvatar         = document.getElementById('my-avatar');
const myNameDisplay    = document.getElementById('my-name-display');
const connectionBadge  = document.getElementById('connection-badge');
const badgeText        = connectionBadge.querySelector('.badge-text');
const onlineCount      = document.getElementById('online-count');
const roomStatus       = document.getElementById('room-status');
const imgModal         = document.getElementById('img-modal');
const modalImg         = document.getElementById('modal-img');
const modalClose       = document.getElementById('modal-close');
const modalBackdrop    = document.getElementById('modal-backdrop');
const themeToggle      = document.getElementById('theme-toggle');
const themeIcon        = document.getElementById('theme-icon');
const emojiBtnEl       = document.getElementById('emoji-btn');
const emojiPicker      = document.getElementById('emoji-picker');
const emojiGrid        = document.getElementById('emoji-grid');
const emojiSearch      = document.getElementById('emoji-search');
const replyPreview     = document.getElementById('reply-preview');
const replyTextPrev    = document.getElementById('reply-text-preview');
const cancelReply      = document.getElementById('cancel-reply');
const contextMenu      = document.getElementById('context-menu');
const ctxReply         = document.getElementById('ctx-reply');
const ctxReact         = document.getElementById('ctx-react');
const ctxDelete        = document.getElementById('ctx-delete');
const reactionPicker   = document.getElementById('reaction-picker');

// ─── State ───
let socket         = null;
let myUsername     = '';
let mySocketId     = '';
let pendingFile    = null;   // { url, name, type, size }
let typingTimeout  = null;
let isTyping       = false;
let isDark         = true;
let replyTo        = null;   // { msgId, text, username }
let contextMsgId   = null;
let reactMsgId     = null;

// ─── Emoji Data ───
const EMOJIS = {
  smileys:  ['😀','😁','😂','🤣','😊','😇','🥰','😍','😎','🤩','😋','😜','😝','🤪','🤓','🧐','😏','😒','🙄','😔','😢','😭','😤','😠','🤬','🤯','😱','😨','🥶','🥵','😴','🤤','🤢','🤮','🤧','🥴','😵','🥸','🤠','🎭'],
  gestures: ['👋','🤚','🖐','✋','🤙','👌','🤌','🤏','✌','🤞','🤟','🤘','👍','👎','👊','✊','🤛','🤜','👏','🙌','🤲','🙏','✍','💅','🤳','💪','🦾','🦵','🦶','👁','👀'],
  hearts:   ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☯️','🕉','🛐','💯','♾️','✔️','❌','❓','❗','💢','♨️','🔥'],
  objects:  ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🎯','🎮','🕹','🎲','🃏','🎴','🎭','🎨','🖼','🎬','🎤','🎧','🎼','🎹','🥁','🎸','🎷','🎺','📱','💻','🖥','⌨️','🖱','🖨','📷','📸','📹','🎥','📞','☎️','📺','📻'],
  nature:   ['🌿','🌱','🌲','🌳','🌴','🌵','🌾','🍀','🌺','🌸','🌼','🌻','🌹','🌷','🌙','⭐','🌟','💫','✨','☀️','🌤','⛅','🌥','☁️','🌦','🌧','⛈','🌩','🌨','❄️','🌈','🌊','🌀','🌪','🌫','🌬','🐶','🐱','🐻','🦊'],
  food:     ['🍕','🍔','🌮','🌯','🥗','🍜','🍣','🍱','🥟','🍛','🍲','🥘','🫕','🍝','🍗','🍖','🥩','🥚','🍳','🧇','🥞','🧈','🍞','🥖','🧀','🥑','🍅','🥦','🌽','🥕','🍎','🍊','🍋','🍇','🍓','🫐','🍒','🍑','🥭','🍌'],
};

// ─── Theme Toggle ───
themeToggle.addEventListener('click', () => {
  isDark = !isDark;
  document.body.classList.toggle('dark-mode', isDark);
  document.body.classList.toggle('light-mode', !isDark);
  themeIcon.textContent = isDark ? '☀️' : '🌙';
});

// ─── Join Chat ───
function joinChat() {
  const username = usernameInput.value.trim();
  if (!username) {
    usernameInput.focus();
    usernameInput.style.borderColor = '#ef4444';
    setTimeout(() => (usernameInput.style.borderColor = ''), 1000);
    return;
  }
  myUsername = username;
  myAvatar.textContent = username.charAt(0).toUpperCase();
  myNameDisplay.textContent = username;

  loginScreen.style.animation = 'fadeOut 0.3s ease forwards';
  setTimeout(() => {
    loginScreen.classList.add('hidden');
    chatScreen.classList.remove('hidden');
    connectSocket();
  }, 280);
}

joinBtn.addEventListener('click', joinChat);
usernameInput.addEventListener('keydown', e => { if (e.key === 'Enter') joinChat(); });

// ─── Socket Connection ───
function connectSocket() {
  socket = io();

  socket.on('connect', () => {
    mySocketId = socket.id;
    setConnectionStatus(true);
    socket.emit('join', myUsername);
  });

  socket.on('disconnect', () => setConnectionStatus(false));

  socket.on('history', msgs => {
    msgs.forEach(renderMessage);
    scrollToBottom();
  });

  socket.on('message', msg => {
    document.querySelector('.welcome-msg')?.remove();
    renderMessage(msg);
    scrollToBottom();
    if (msg.socketId !== mySocketId) playNotificationSound();
    // Send read receipt
    if (msg.socketId !== mySocketId) {
      socket.emit('read', { msgId: msg.id });
    }
  });

  socket.on('message_read', ({ msgId }) => {
    const el = document.querySelector(`[data-msg-id="${msgId}"] .read-receipt`);
    if (el) { el.textContent = '✓✓'; el.classList.add('read'); }
  });

  socket.on('message_deleted', ({ msgId }) => {
    const el = document.querySelector(`[data-msg-id="${msgId}"] .bubble`);
    if (el) { el.innerHTML = '🗑️ تم حذف الرسالة'; el.classList.add('deleted'); }
  });

  socket.on('reaction_update', ({ msgId, reactions }) => {
    updateReactionsBar(msgId, reactions);
  });

  socket.on('user_joined', data => {
    if (data.username !== myUsername) addSystemMessage(`${data.username} انضم إلى الدردشة 👋`);
    updateUsersList(data.users);
    updateOnlineCount(data.count);
    roomStatus.textContent = `${data.count} متصل`;
  });

  socket.on('user_left', data => {
    addSystemMessage(`${data.username} غادر الدردشة`);
    updateUsersList(data.users);
    updateOnlineCount(data.count);
    roomStatus.textContent = `${data.count} متصل`;
  });

  socket.on('typing', data => {
    if (data.isTyping) {
      typingNameEl.textContent = data.username;
      typingIndicator.classList.remove('hidden');
      scrollToBottom();
    } else {
      typingIndicator.classList.add('hidden');
    }
  });
}

// ─── Connection Badge ───
function setConnectionStatus(online) {
  connectionBadge.className = `connection-badge ${online ? 'online' : 'offline'}`;
  badgeText.textContent = online ? 'متصل' : 'غير متصل';
}

// ─── Users List ───
function updateUsersList(users) {
  usersList.innerHTML = '';
  users.forEach(username => {
    const item = document.createElement('div');
    item.className = 'user-item';
    item.innerHTML = `
      <div class="user-avatar">${username.charAt(0).toUpperCase()}</div>
      <div class="user-name">${escapeHtml(username)}</div>`;
    usersList.appendChild(item);
  });
}

function updateOnlineCount(count) {
  onlineCount.textContent = `${count} متصل الآن`;
}

// ─── Send Message ───
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && !pendingFile) return;
  if (!socket?.connected) return;

  const replyData = replyTo ? { msgId: replyTo.msgId, text: replyTo.text, username: replyTo.username } : null;

  if (pendingFile) {
    if (pendingFile.type === 'image') {
      socket.emit('image_message', { imageUrl: pendingFile.url, caption: text, replyTo: replyData });
    } else {
      socket.emit('file_message', { fileUrl: pendingFile.url, fileName: pendingFile.name, fileSize: pendingFile.size, caption: text, replyTo: replyData });
    }
    clearAttachment();
  } else {
    socket.emit('message', { text, replyTo: replyData });
  }

  messageInput.value = '';
  messageInput.style.height = 'auto';
  clearReply();
  stopTyping();
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
});

messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  handleTyping();
});

// ─── Typing ───
function handleTyping() {
  if (!socket?.connected) return;
  if (!isTyping) { isTyping = true; socket.emit('typing', true); }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 1500);
}

function stopTyping() {
  if (isTyping && socket) { isTyping = false; socket.emit('typing', false); }
  clearTimeout(typingTimeout);
}

// ─── File Upload ───
fileUpload.addEventListener('change', async e => {
  const file = e.target.files[0];
  if (!file) return;

  const isImage = file.type.startsWith('image/');
  const formData = new FormData();
  formData.append('file', file);

  try {
    const res = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.url) throw new Error('No URL');

    pendingFile = { url: data.url, name: file.name, type: isImage ? 'image' : 'file', size: formatFileSize(file.size) };

    attachPreview.classList.remove('hidden');
    if (isImage) {
      previewImg.src = data.url;
      previewImg.classList.remove('hidden');
      filePreviewInfo.classList.add('hidden');
      messageInput.placeholder = 'أضف تعليقاً للصورة (اختياري)...';
    } else {
      previewImg.classList.add('hidden');
      filePreviewInfo.classList.remove('hidden');
      filePreviewName.textContent = file.name;
      messageInput.placeholder = 'أضف تعليقاً للملف (اختياري)...';
    }
    messageInput.focus();
  } catch (err) {
    alert('فشل رفع الملف. تأكد من السيرفر.');
  }
  fileUpload.value = '';
});

removeAttachment.addEventListener('click', clearAttachment);

function clearAttachment() {
  pendingFile = null;
  previewImg.src = '';
  previewImg.classList.add('hidden');
  filePreviewInfo.classList.add('hidden');
  attachPreview.classList.add('hidden');
  messageInput.placeholder = 'اكتب رسالتك...';
}

// ─── Reply ───
function setReply(msgId, text, username) {
  replyTo = { msgId, text, username };
  replyTextPrev.textContent = `${username}: ${text.substring(0, 60)}${text.length > 60 ? '...' : ''}`;
  replyPreview.classList.remove('hidden');
  messageInput.focus();
}

function clearReply() {
  replyTo = null;
  replyPreview.classList.add('hidden');
}

cancelReply.addEventListener('click', clearReply);

// ─── Render Message ───
function renderMessage(msg) {
  const isMe = msg.socketId === mySocketId || msg.username === myUsername;
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isMe ? 'me' : 'them'}`;
  wrapper.dataset.msgId = msg.id;

  const time = formatTime(msg.timestamp);

  // Reply quote
  let replyHTML = '';
  if (msg.replyTo) {
    replyHTML = `<div class="reply-quote">↩ ${escapeHtml(msg.replyTo.username)}: ${escapeHtml(msg.replyTo.text?.substring(0, 60) || '[ملف]')}</div>`;
  }

  // Bubble content
  let bubbleHTML = '';
  if (msg.type === 'image') {
    bubbleHTML = `
      <div class="bubble image-bubble">
        ${replyHTML}
        <img class="chat-image" src="${escapeHtml(msg.imageUrl)}" alt="صورة" loading="lazy"
          onclick="openModal('${escapeHtml(msg.imageUrl)}')" />
        ${msg.caption ? `<div class="img-caption">${escapeHtml(msg.caption)}</div>` : ''}
      </div>`;
  } else if (msg.type === 'file') {
    bubbleHTML = `
      <a class="file-bubble" href="${escapeHtml(msg.fileUrl)}" target="_blank" download>
        <div class="file-bubble-icon">${getFileIcon(msg.fileName)}</div>
        <div class="file-bubble-info">
          <div class="file-bubble-name">${escapeHtml(msg.fileName)}</div>
          <div class="file-bubble-size">${escapeHtml(msg.fileSize || '')} • اضغط للتحميل</div>
        </div>
      </a>`;
  } else {
    bubbleHTML = `<div class="bubble">${replyHTML}${escapeHtml(msg.text).replace(/\n/g, '<br>')}</div>`;
  }

  // Read receipt (only for my messages)
  const receiptHTML = isMe ? `<div class="read-receipt" title="أُرسلت">✓</div>` : '';

  // Action buttons (hover)
  const actionsHTML = `
    <div class="msg-actions">
      <button class="msg-action-btn" onclick="triggerReply('${msg.id}')">↩ رد</button>
      <button class="msg-action-btn" onclick="openReactPicker(event, '${msg.id}')">❤️</button>
      ${isMe ? `<button class="msg-action-btn" style="color:var(--danger)" onclick="deleteMsg('${msg.id}')">🗑️</button>` : ''}
    </div>`;

  wrapper.innerHTML = `
    <div class="msg-meta">
      ${!isMe ? `<span class="msg-username">${escapeHtml(msg.username)}</span>` : ''}
      <span class="msg-time">${time}</span>
    </div>
    ${actionsHTML}
    ${bubbleHTML}
    ${receiptHTML}
    <div class="reactions-bar" id="reactions-${msg.id}"></div>`;

  // Update existing reactions if any
  if (msg.reactions) updateReactionsBar(msg.id, msg.reactions);

  messagesArea.appendChild(wrapper);
}

// ─── Trigger Reply from button ───
window.triggerReply = function(msgId) {
  const wrapper = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!wrapper) return;
  const bubble = wrapper.querySelector('.bubble');
  const username = wrapper.querySelector('.msg-username')?.textContent || myUsername;
  const text = bubble?.textContent?.trim() || '[ملف]';
  setReply(msgId, text, username);
};

// ─── Delete Message ───
window.deleteMsg = function(msgId) {
  if (!socket?.connected) return;
  socket.emit('delete_message', { msgId });
};

// ─── Reactions ───
window.openReactPicker = function(e, msgId) {
  e.stopPropagation();
  reactMsgId = msgId;
  const rect = e.target.getBoundingClientRect();
  reactionPicker.style.top = (rect.top - 50) + 'px';
  reactionPicker.style.left = rect.left + 'px';
  reactionPicker.classList.remove('hidden');
};

reactionPicker.querySelectorAll('.react-emoji').forEach(el => {
  el.addEventListener('click', () => {
    if (!socket?.connected || !reactMsgId) return;
    socket.emit('react', { msgId: reactMsgId, emoji: el.dataset.emoji });
    reactionPicker.classList.add('hidden');
    reactMsgId = null;
  });
});

function updateReactionsBar(msgId, reactions) {
  const bar = document.getElementById(`reactions-${msgId}`);
  if (!bar) return;
  bar.innerHTML = '';
  Object.entries(reactions || {}).forEach(([emoji, users]) => {
    if (!users.length) return;
    const chip = document.createElement('div');
    const isMine = users.includes(mySocketId) || users.includes(myUsername);
    chip.className = `reaction-chip${isMine ? ' mine' : ''}`;
    chip.title = users.join(', ');
    chip.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
    chip.addEventListener('click', () => socket?.emit('react', { msgId, emoji }));
    bar.appendChild(chip);
  });
}

// ─── Context Menu (right-click) ───
messagesArea.addEventListener('contextmenu', e => {
  const wrapper = e.target.closest('.message-wrapper');
  if (!wrapper) return;
  e.preventDefault();
  contextMsgId = wrapper.dataset.msgId;
  const isMe = wrapper.classList.contains('me');
  ctxDelete.style.display = isMe ? '' : 'none';

  contextMenu.style.top = e.clientY + 'px';
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.classList.remove('hidden');
});

ctxReply.addEventListener('click', () => {
  if (contextMsgId) triggerReply(contextMsgId);
  contextMenu.classList.add('hidden');
});

ctxReact.addEventListener('click', e => {
  const btn = document.querySelector(`[data-msg-id="${contextMsgId}"] .msg-action-btn`);
  openReactPicker({ target: btn || e.target, stopPropagation: () => {} }, contextMsgId);
  contextMenu.classList.add('hidden');
});

ctxDelete.addEventListener('click', () => {
  if (contextMsgId) deleteMsg(contextMsgId);
  contextMenu.classList.add('hidden');
});

// Close menus on click outside
document.addEventListener('click', e => {
  if (!contextMenu.contains(e.target)) contextMenu.classList.add('hidden');
  if (!reactionPicker.contains(e.target) && !e.target.closest('.msg-action-btn')) {
    reactionPicker.classList.add('hidden');
  }
  if (!emojiPicker.contains(e.target) && e.target !== emojiBtnEl) {
    emojiPicker.classList.add('hidden');
  }
});

// ─── Emoji Picker ───
const emojiCategories = Object.keys(EMOJIS);
let currentCat = 'smileys';

function renderEmojiGrid(emojis) {
  emojiGrid.innerHTML = '';
  emojis.forEach(em => {
    const span = document.createElement('span');
    span.className = 'emoji-item';
    span.textContent = em;
    span.addEventListener('click', () => {
      const pos = messageInput.selectionStart;
      const val = messageInput.value;
      messageInput.value = val.slice(0, pos) + em + val.slice(pos);
      messageInput.selectionStart = messageInput.selectionEnd = pos + em.length;
      messageInput.focus();
    });
    emojiGrid.appendChild(span);
  });
}

emojiBtnEl.addEventListener('click', e => {
  e.stopPropagation();
  emojiPicker.classList.toggle('hidden');
  if (!emojiPicker.classList.contains('hidden')) renderEmojiGrid(EMOJIS[currentCat]);
});

document.querySelectorAll('.emoji-cat').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.emoji-cat').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentCat = btn.dataset.cat;
    renderEmojiGrid(EMOJIS[currentCat]);
    emojiSearch.value = '';
  });
});

emojiSearch.addEventListener('input', () => {
  const q = emojiSearch.value.trim();
  if (!q) { renderEmojiGrid(EMOJIS[currentCat]); return; }
  const all = Object.values(EMOJIS).flat();
  // Simple filter by trying to match unicode name – fallback: show all
  renderEmojiGrid(all.slice(0, 48));
});

// ─── System Message ───
function addSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'system-msg';
  el.textContent = text;
  messagesArea.appendChild(el);
  scrollToBottom();
}

// ─── Scroll ───
function scrollToBottom() {
  requestAnimationFrame(() => { messagesArea.scrollTop = messagesArea.scrollHeight; });
}

// ─── Image Modal ───
window.openModal = function(url) {
  modalImg.src = url;
  imgModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

function closeModal() {
  imgModal.classList.add('hidden');
  document.body.style.overflow = '';
  modalImg.src = '';
}

modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); contextMenu.classList.add('hidden'); } });

// ─── Sound ───
function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

// ─── Helpers ───
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function formatTime(iso) {
  try {
    return new Date(iso).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch (_) { return ''; }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(name = '') {
  const ext = name.split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return '📕';
  if (['doc','docx'].includes(ext)) return '📘';
  if (['xls','xlsx'].includes(ext)) return '📗';
  if (['zip','rar'].includes(ext)) return '🗜️';
  return '📄';
}

// Fade out animation
const style = document.createElement('style');
style.textContent = `@keyframes fadeOut { from { opacity: 1; } to { opacity: 0; } }`;
document.head.appendChild(style);
