// ══════════════════════════════════════════
// وَصْل — script.js
// ══════════════════════════════════════════

// ─── DOM: Auth ───
const authScreen    = document.getElementById('auth-screen');
const lobbyScreen   = document.getElementById('lobby-screen');
const chatScreen    = document.getElementById('chat-screen');
const loginUsernameEl = document.getElementById('login-username');
const loginPasswordEl = document.getElementById('login-password');
const loginError    = document.getElementById('login-error');
const regUsernameEl = document.getElementById('reg-username');
const regPasswordEl = document.getElementById('reg-password');
const regError      = document.getElementById('reg-error');

// ─── DOM: Lobby ───
const lobbyAvatar   = document.getElementById('lobby-avatar');
const lobbyUsername = document.getElementById('lobby-username-display');
const myRoomsList   = document.getElementById('my-rooms-list');
const allRoomsList  = document.getElementById('all-rooms-list');
const newRoomName   = document.getElementById('new-room-name');
const newRoomPersist= document.getElementById('new-room-persistent');
const createRoomErr = document.getElementById('create-room-error');
const joinRoomIdEl  = document.getElementById('join-room-id');
const joinRoomErr   = document.getElementById('join-room-error');

// ─── DOM: Chat ───
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
const sidebarRoomName  = document.getElementById('sidebar-room-name');
const headerRoomName   = document.getElementById('header-room-name');
const roomIdDisplay    = document.getElementById('room-id-display');
const imgModal         = document.getElementById('img-modal');
const modalImg         = document.getElementById('modal-img');
const modalClose       = document.getElementById('modal-close');
const modalBackdrop    = document.getElementById('modal-backdrop');
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
let socket        = null;
let myUsername    = '';
let mySocketId    = '';
let currentRoomId = null;
let currentRoomName = '';
let pendingFile   = null;
let typingTimeout = null;
let isTyping      = false;
let isDark        = true;
let replyTo       = null;
let contextMsgId  = null;
let reactMsgId    = null;

// ══════════════════════════════════════════
// ─── Theme ───
// ══════════════════════════════════════════
function applyTheme() {
  document.body.classList.toggle('dark-mode',  isDark);
  document.body.classList.toggle('light-mode', !isDark);
  ['theme-icon','theme-icon-lobby'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = isDark ? '☀️' : '🌙';
  });
}

document.getElementById('theme-toggle')?.addEventListener('click', () => { isDark = !isDark; applyTheme(); });
document.getElementById('theme-toggle-lobby')?.addEventListener('click', () => { isDark = !isDark; applyTheme(); });

// ══════════════════════════════════════════
// ─── Auth Tab Switch ───
// ══════════════════════════════════════════
window.switchTab = function(tab) {
  document.getElementById('form-login').classList.toggle('hidden', tab !== 'login');
  document.getElementById('form-register').classList.toggle('hidden', tab !== 'register');
  document.getElementById('tab-login').classList.toggle('active', tab === 'login');
  document.getElementById('tab-register').classList.toggle('active', tab === 'register');
};

// ─── Enter key on auth inputs ───
loginPasswordEl?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
loginUsernameEl?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
regPasswordEl?.addEventListener('keydown', e => { if (e.key === 'Enter') doRegister(); });

// ══════════════════════════════════════════
// ─── Login ───
// ══════════════════════════════════════════
window.doLogin = async function() {
  const username = loginUsernameEl.value.trim();
  const password = loginPasswordEl.value;
  if (!username || !password) return showError(loginError, 'أدخل اسم المستخدم وكلمة المرور');

  try {
    const res  = await fetch('/api/login', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!res.ok) return showError(loginError, data.error);

    localStorage.setItem('wasl_user', JSON.stringify({ username }));
    myUsername = username;
    enterLobby(data.myRooms || []);
  } catch { showError(loginError, 'خطأ في الاتصال بالسيرفر'); }
};

// ══════════════════════════════════════════
// ─── Register ───
// ══════════════════════════════════════════
window.doRegister = async function() {
  const username = regUsernameEl.value.trim();
  const password = regPasswordEl.value;
  if (!username || !password) return showError(regError, 'أدخل جميع البيانات');

  try {
    const res  = await fetch('/api/register', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (!res.ok) return showError(regError, data.error);

    localStorage.setItem('wasl_user', JSON.stringify({ username }));
    myUsername = username;
    enterLobby([]);
  } catch { showError(regError, 'خطأ في الاتصال بالسيرفر'); }
};

// ══════════════════════════════════════════
// ─── Logout ───
// ══════════════════════════════════════════
window.doLogout = function() {
  localStorage.removeItem('wasl_user');
  if (socket) { socket.disconnect(); socket = null; }
  currentRoomId = null;
  showScreen('auth');
};

// ══════════════════════════════════════════
// ─── Lobby ───
// ══════════════════════════════════════════
function enterLobby(savedRoomIds) {
  showScreen('lobby');
  lobbyAvatar.textContent = myUsername.charAt(0).toUpperCase();
  lobbyUsername.textContent = myUsername;

  if (!socket || !socket.connected) initSocket();

  // Load all rooms
  fetchAllRooms();

  // Load my rooms
  fetchMyRooms();
}

async function fetchAllRooms() {
  try {
    const res  = await fetch('/api/rooms');
    const data = await res.json();
    renderAllRooms(data.rooms || []);
  } catch {}
}

async function fetchMyRooms() {
  try {
    const res  = await fetch('/api/my-rooms', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: myUsername }) });
    const data = await res.json();
    renderMyRooms(data.rooms || []);
  } catch {}
}

function renderAllRooms(rooms) {
  allRoomsList.innerHTML = rooms.length ? '' : '<div class="rooms-empty">لا توجد غرف حالياً</div>';
  rooms.forEach(r => {
    const item = document.createElement('div');
    item.className = 'room-item';
    item.innerHTML = `
      <div class="room-item-icon">${r.persistent ? '📌' : '💬'}</div>
      <div class="room-item-info">
        <div class="room-item-name">${escapeHtml(r.name)}</div>
        <div class="room-item-meta">${r.userCount} متصل • ${r.persistent ? 'دائمة' : 'مؤقتة'}</div>
      </div>
      <div class="room-item-actions">
        <button class="room-action-btn" onclick="enterRoom('${r.id}','${escapeHtml(r.name)}')">دخول</button>
      </div>`;
    allRoomsList.appendChild(item);
  });
}

function renderMyRooms(rooms) {
  myRoomsList.innerHTML = rooms.length ? '' : '<div class="rooms-empty">لم تدخل أي غرفة بعد</div>';
  rooms.forEach(r => {
    const item = document.createElement('div');
    item.className = 'room-item';
    item.innerHTML = `
      <div class="room-item-icon">${r.persistent ? '📌' : '💬'}</div>
      <div class="room-item-info">
        <div class="room-item-name">${escapeHtml(r.name)}</div>
        <div class="room-item-meta">${r.userCount} متصل</div>
      </div>
      <div class="room-item-actions">
        <button class="room-action-btn" onclick="enterRoom('${r.id}','${escapeHtml(r.name)}')">دخول</button>
        <button class="room-action-btn danger" onclick="removeMyRoom('${r.id}', this)">❌</button>
      </div>`;
    myRoomsList.appendChild(item);
  });
}

window.removeMyRoom = async function(roomId, btn) {
  btn.disabled = true;
  try {
    await fetch('/api/my-rooms/remove', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ username: myUsername, roomId }) });
    fetchMyRooms();
  } catch { btn.disabled = false; }
};

// ──── Create Room ────
window.createRoom = function() {
  const name       = newRoomName.value.trim();
  const persistent = newRoomPersist.checked;
  if (!name || name.length < 2) return showError(createRoomErr, 'اسم الغرفة يجب أن يكون حرفين على الأقل');
  hideError(createRoomErr);

  socket.emit('create_room', { name, persistent }, (res) => {
    if (res?.error) return showError(createRoomErr, res.error);
    newRoomName.value = '';
    newRoomPersist.checked = false;
    enterRoom(res.roomId, name);
  });
};

// ──── Join by ID ────
window.joinRoomById = function() {
  const id = joinRoomIdEl.value.trim();
  if (!id) return showError(joinRoomErr, 'أدخل رمز الغرفة');
  hideError(joinRoomErr);
  enterRoom(id, '');
};

newRoomName.addEventListener('keydown', e => { if (e.key === 'Enter') createRoom(); });
joinRoomIdEl.addEventListener('keydown', e => { if (e.key === 'Enter') joinRoomById(); });

// ══════════════════════════════════════════
// ─── Enter Room (join and switch to chat) ───
// ══════════════════════════════════════════
window.enterRoom = function(roomId, roomName) {
  socket.emit('join_room', { roomId, username: myUsername }, (res) => {
    if (res?.error) {
      showError(joinRoomErr, res.error);
      showError(createRoomErr, res.error);
      return;
    }
    currentRoomId   = roomId;
    currentRoomName = res.room?.name || roomName;

    // Update UI
    myAvatar.textContent      = myUsername.charAt(0).toUpperCase();
    myNameDisplay.textContent = myUsername;
    sidebarRoomName.textContent = currentRoomName;
    headerRoomName.textContent  = currentRoomName;
    roomIdDisplay.textContent   = roomId;
    roomStatus.textContent = 'متصل';

    // Show loading state — room_history will fill messages
    messagesArea.innerHTML = `<div class="welcome-msg"><div class="welcome-icon">⏳</div><p>جاري تحميل الرسائل...</p></div>`;

    showScreen('chat');
    setConnectionStatus(true);
  });
};

window.backToLobby = function() {
  if (currentRoomId && socket) socket.emit('leave_room', { roomId: currentRoomId });
  currentRoomId = null;
  showScreen('lobby');
  fetchAllRooms();
  fetchMyRooms();
};

window.copyRoomId = function() {
  navigator.clipboard.writeText(currentRoomId || '').then(() => {
    const btn = document.querySelector('.copy-btn');
    if (btn) { btn.textContent = '✅'; setTimeout(() => btn.textContent = '📋', 1500); }
  });
};

// ══════════════════════════════════════════
// ─── Socket Init ───
// ══════════════════════════════════════════
function initSocket() {
  socket     = io();
  mySocketId = null;

  socket.on('connect', () => {
    mySocketId = socket.id;
    setConnectionStatus(true);
    socket.emit('app_join', { username: myUsername });

    // Re-join room if we were in one (handles page reconnects)
    if (currentRoomId) {
      socket.emit('join_room', { roomId: currentRoomId, username: myUsername }, (res) => {
        if (res?.error) {
          addSystemMessage('⚠️ تعذّر إعادة الاتصال بالغرفة');
          return;
        }
        roomStatus.textContent = 'متصل';
      });
    }
  });

  socket.on('disconnect', () => setConnectionStatus(false));

  socket.on('rooms_list', rooms => renderAllRooms(rooms));
  socket.on('rooms_updated', rooms => {
    renderAllRooms(rooms);
    // Re-render my rooms too (count may have changed)
    fetchMyRooms();
  });

  socket.on('room_deleted', ({ roomId }) => {
    if (roomId === currentRoomId) {
      addSystemMessage('⚠️ تم حذف هذه الغرفة من السيرفر');
      setTimeout(backToLobby, 2000);
    }
  });

  socket.on('room_history', ({ messages }) => {
    messagesArea.innerHTML = '';
    if (!messages || !messages.length) {
      messagesArea.innerHTML = `<div class="welcome-msg"><div class="welcome-icon">🔗</div><p>${escapeHtml(currentRoomName)}</p><small>ابدأ الدردشة الآن</small></div>`;
      return;
    }
    messages.forEach(msg => {
      if (msg.deleted) {
        // Render deleted messages as deleted bubbles
        renderMessage(msg);
        const el = document.querySelector(`[data-msg-id="${msg.id}"] .bubble`);
        if (el) { el.innerHTML = '🗑️ تم حذف الرسالة'; el.classList.add('deleted'); }
      } else {
        renderMessage(msg);
      }
    });
    scrollToBottom();
  });

  socket.on('message', msg => {
    document.querySelector('.welcome-msg')?.remove();
    renderMessage(msg);
    scrollToBottom();
    if (msg.socketId !== mySocketId) playNotificationSound();
    if (msg.socketId !== mySocketId) socket.emit('read', { msgId: msg.id, roomId: currentRoomId });
  });

  socket.on('message_read', ({ msgId }) => {
    const el = document.querySelector(`[data-msg-id="${msgId}"] .read-receipt`);
    if (el) { el.textContent = '✓✓'; el.classList.add('read'); }
  });

  socket.on('message_deleted', ({ msgId }) => {
    const el = document.querySelector(`[data-msg-id="${msgId}"] .bubble`);
    if (el) { el.innerHTML = '🗑️ تم حذف الرسالة'; el.classList.add('deleted'); }
  });

  socket.on('reaction_update', ({ msgId, reactions }) => updateReactionsBar(msgId, reactions));

  socket.on('room_user_joined', data => {
    if (data.roomId !== currentRoomId) return;
    if (data.username !== myUsername) addSystemMessage(`${data.username} انضم إلى الغرفة 👋`);
    updateUsersList(data.users);
    updateOnlineCount(data.count);
    roomStatus.textContent = `${data.count} متصل`;
  });

  socket.on('room_user_left', data => {
    if (data.roomId !== currentRoomId) return;
    addSystemMessage(`${data.username} غادر الغرفة`);
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

// ══════════════════════════════════════════
// ─── UI Helpers ───
// ══════════════════════════════════════════
function showScreen(name) {
  authScreen.classList.toggle('hidden',  name !== 'auth');
  lobbyScreen.classList.toggle('hidden', name !== 'lobby');
  chatScreen.classList.toggle('hidden',  name !== 'chat');
  // Footer: only show in lobby and chat
  const footer = document.getElementById('app-footer');
  if (footer) footer.style.display = name === 'auth' ? 'none' : '';
}

function setConnectionStatus(online) {
  connectionBadge.className = `connection-badge ${online ? 'online' : 'offline'}`;
  badgeText.textContent = online ? 'متصل' : 'غير متصل';
}

function updateUsersList(users) {
  usersList.innerHTML = '';
  users.forEach(username => {
    const item = document.createElement('div');
    item.className = 'user-item';
    item.innerHTML = `<div class="user-avatar">${username.charAt(0).toUpperCase()}</div><div class="user-name">${escapeHtml(username)}</div>`;
    usersList.appendChild(item);
  });
}

function updateOnlineCount(count) { onlineCount.textContent = `${count} متصل الآن`; }

function showError(el, msg) { el.textContent = msg; el.classList.remove('hidden'); }
function hideError(el) { el.classList.add('hidden'); }

function addSystemMessage(text) {
  const el = document.createElement('div');
  el.className = 'system-msg';
  el.textContent = text;
  messagesArea.appendChild(el);
  scrollToBottom();
}

function scrollToBottom() { requestAnimationFrame(() => { messagesArea.scrollTop = messagesArea.scrollHeight; }); }

// ══════════════════════════════════════════
// ─── Send Message ───
// ══════════════════════════════════════════
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text && !pendingFile) return;
  if (!socket?.connected || !currentRoomId) return;

  const replyData = replyTo ? { msgId: replyTo.msgId, text: replyTo.text, username: replyTo.username } : null;

  if (pendingFile) {
    if (pendingFile.type === 'image') {
      socket.emit('image_message', { imageUrl: pendingFile.url, caption: text, replyTo: replyData, roomId: currentRoomId });
    } else {
      socket.emit('file_message', { fileUrl: pendingFile.url, fileName: pendingFile.name, fileSize: pendingFile.size, caption: text, replyTo: replyData, roomId: currentRoomId });
    }
    clearAttachment();
  } else {
    socket.emit('message', { text, replyTo: replyData, roomId: currentRoomId });
  }

  messageInput.value = '';
  messageInput.style.height = 'auto';
  clearReply();
  stopTyping();
}

sendBtn.addEventListener('click', sendMessage);
messageInput.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } });
messageInput.addEventListener('input', () => {
  messageInput.style.height = 'auto';
  messageInput.style.height = Math.min(messageInput.scrollHeight, 120) + 'px';
  handleTyping();
});

// ─── Typing ───
function handleTyping() {
  if (!socket?.connected || !currentRoomId) return;
  if (!isTyping) { isTyping = true; socket.emit('typing', { isTyping: true, roomId: currentRoomId }); }
  clearTimeout(typingTimeout);
  typingTimeout = setTimeout(stopTyping, 1500);
}

function stopTyping() {
  if (isTyping && socket) { isTyping = false; socket.emit('typing', { isTyping: false, roomId: currentRoomId }); }
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
    const res  = await fetch('/upload', { method: 'POST', body: formData });
    const data = await res.json();
    if (!data.url) throw new Error();
    pendingFile = { url: data.url, name: file.name, type: isImage ? 'image' : 'file', size: formatFileSize(file.size) };
    attachPreview.classList.remove('hidden');
    if (isImage) { previewImg.src = data.url; previewImg.classList.remove('hidden'); filePreviewInfo.classList.add('hidden'); }
    else { previewImg.classList.add('hidden'); filePreviewInfo.classList.remove('hidden'); filePreviewName.textContent = file.name; }
    messageInput.placeholder = isImage ? 'أضف تعليقاً (اختياري)...' : 'أضف تعليقاً للملف (اختياري)...';
    messageInput.focus();
  } catch { alert('فشل رفع الملف'); }
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

function clearReply() { replyTo = null; replyPreview.classList.add('hidden'); }
cancelReply.addEventListener('click', clearReply);

// ══════════════════════════════════════════
// ─── Render Message ───
// ══════════════════════════════════════════
function renderMessage(msg) {
  const isMe = msg.socketId === mySocketId || msg.username === myUsername;
  const wrapper = document.createElement('div');
  wrapper.className = `message-wrapper ${isMe ? 'me' : 'them'}`;
  wrapper.dataset.msgId = msg.id;

  let replyHTML = '';
  if (msg.replyTo) {
    replyHTML = `<div class="reply-quote">↩ ${escapeHtml(msg.replyTo.username)}: ${escapeHtml((msg.replyTo.text || '[ملف]').substring(0, 60))}</div>`;
  }

  let bubbleHTML = '';
  if (msg.type === 'image') {
    bubbleHTML = `<div class="bubble image-bubble">${replyHTML}<img class="chat-image" src="${escapeHtml(msg.imageUrl)}" alt="صورة" loading="lazy" onclick="openModal('${escapeHtml(msg.imageUrl)}')" />${msg.caption ? `<div class="img-caption">${escapeHtml(msg.caption)}</div>` : ''}</div>`;
  } else if (msg.type === 'file') {
    bubbleHTML = `<a class="file-bubble" href="${escapeHtml(msg.fileUrl)}" target="_blank" download><div class="file-bubble-icon">${getFileIcon(msg.fileName)}</div><div class="file-bubble-info"><div class="file-bubble-name">${escapeHtml(msg.fileName)}</div><div class="file-bubble-size">${escapeHtml(msg.fileSize || '')} • اضغط للتحميل</div></div></a>`;
  } else {
    bubbleHTML = `<div class="bubble">${replyHTML}${escapeHtml(msg.text || '').replace(/\n/g, '<br>')}</div>`;
  }

  const receiptHTML = isMe ? `<div class="read-receipt">✓</div>` : '';
  const actionsHTML = `<div class="msg-actions">
    <button class="msg-action-btn" onclick="triggerReply('${msg.id}')">↩ رد</button>
    <button class="msg-action-btn" onclick="openReactPicker(event,'${msg.id}')">❤️</button>
    ${isMe ? `<button class="msg-action-btn" style="color:var(--danger)" onclick="deleteMsg('${msg.id}')">🗑️</button>` : ''}
  </div>`;

  wrapper.innerHTML = `
    <div class="msg-meta">
      ${!isMe ? `<span class="msg-username">${escapeHtml(msg.username)}</span>` : ''}
      <span class="msg-time">${formatTime(msg.timestamp)}</span>
    </div>
    ${actionsHTML}
    ${bubbleHTML}
    ${receiptHTML}
    <div class="reactions-bar" id="reactions-${msg.id}"></div>`;

  if (msg.reactions) updateReactionsBar(msg.id, msg.reactions);
  messagesArea.appendChild(wrapper);
}

// ─── Actions ───
window.triggerReply = function(msgId) {
  const wrapper  = document.querySelector(`[data-msg-id="${msgId}"]`);
  if (!wrapper) return;
  const bubble   = wrapper.querySelector('.bubble');
  const username = wrapper.querySelector('.msg-username')?.textContent || myUsername;
  const text     = bubble?.textContent?.trim() || '[ملف]';
  setReply(msgId, text, username);
};

window.deleteMsg = function(msgId) {
  if (!socket?.connected) return;
  socket.emit('delete_message', { msgId, roomId: currentRoomId });
};

window.openReactPicker = function(e, msgId) {
  e.stopPropagation();
  reactMsgId = msgId;
  const rect = e.target.getBoundingClientRect();
  reactionPicker.style.top  = (rect.top - 54) + 'px';
  reactionPicker.style.left = rect.left + 'px';
  reactionPicker.classList.remove('hidden');
};

reactionPicker.querySelectorAll('.react-emoji').forEach(el => {
  el.addEventListener('click', () => {
    if (!socket?.connected || !reactMsgId) return;
    socket.emit('react', { msgId: reactMsgId, emoji: el.dataset.emoji, roomId: currentRoomId });
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
    const chip  = document.createElement('div');
    const isMine = users.includes(mySocketId);
    chip.className = `reaction-chip${isMine ? ' mine' : ''}`;
    chip.title     = users.join(', ');
    chip.innerHTML = `${emoji} <span class="reaction-count">${users.length}</span>`;
    chip.addEventListener('click', () => socket?.emit('react', { msgId, emoji, roomId: currentRoomId }));
    bar.appendChild(chip);
  });
}

// ─── Context Menu ───
messagesArea.addEventListener('contextmenu', e => {
  const wrapper = e.target.closest('.message-wrapper');
  if (!wrapper) return;
  e.preventDefault();
  contextMsgId = wrapper.dataset.msgId;
  ctxDelete.style.display = wrapper.classList.contains('me') ? '' : 'none';
  contextMenu.style.top  = e.clientY + 'px';
  contextMenu.style.left = e.clientX + 'px';
  contextMenu.classList.remove('hidden');
});

ctxReply.addEventListener('click',  () => { if (contextMsgId) triggerReply(contextMsgId); contextMenu.classList.add('hidden'); });
ctxReact.addEventListener('click',  e  => { openReactPicker({ target: e.target, stopPropagation: ()=>{} }, contextMsgId); contextMenu.classList.add('hidden'); });
ctxDelete.addEventListener('click', () => { if (contextMsgId) deleteMsg(contextMsgId); contextMenu.classList.add('hidden'); });

document.addEventListener('click', e => {
  if (!contextMenu.contains(e.target)) contextMenu.classList.add('hidden');
  if (!reactionPicker.contains(e.target) && !e.target.closest('.msg-action-btn')) reactionPicker.classList.add('hidden');
  if (!emojiPicker.contains(e.target) && e.target !== emojiBtnEl) emojiPicker.classList.add('hidden');
});

// ─── Emoji Picker ───
const EMOJIS = {
  smileys:  ['😀','😁','😂','🤣','😊','😇','🥰','😍','😎','🤩','😋','😜','😝','🤪','🤓','🧐','😏','😒','🙄','😔','😢','😭','😤','😠','🤬','🤯','😱','😨','🥶','🥵','😴','🤤','🤢','🤮','🤧','🥴','😵','🥸','🤠','🎭'],
  gestures: ['👋','🤚','🖐','✋','🤙','👌','🤌','🤏','✌','🤞','🤟','🤘','👍','👎','👊','✊','🤛','🤜','👏','🙌','🤲','🙏','✍','💅','🤳','💪','🦾','🦵','🦶','👁','👀'],
  hearts:   ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☯️','🕉','🛐','💯','♾️','✔️','❌','❓','❗','💢','♨️','🔥'],
  objects:  ['🎉','🎊','🎈','🎁','🎀','🏆','🥇','🎯','🎮','🕹','🎲','🃏','🎴','🎭','🎨','🖼','🎬','🎤','🎧','🎼','🎹','🥁','🎸','🎷','🎺','📱','💻','🖥','⌨️','🖱','🖨','📷','📸','📹','🎥','📞','☎️','📺','📻'],
  nature:   ['🌿','🌱','🌲','🌳','🌴','🌵','🌾','🍀','🌺','🌸','🌼','🌻','🌹','🌷','🌙','⭐','🌟','💫','✨','☀️','🌤','⛅','🌥','☁️','🌦','🌧','⛈','🌩','🌨','❄️','🌈','🌊','🌀','🌪','🌫','🌬','🐶','🐱','🐻','🦊'],
  food:     ['🍕','🍔','🌮','🌯','🥗','🍜','🍣','🍱','🥟','🍛','🍲','🥘','🫕','🍝','🍗','🍖','🥩','🥚','🍳','🧇','🥞','🧈','🍞','🥖','🧀','🥑','🍅','🥦','🌽','🥕','🍎','🍊','🍋','🍇','🍓','🫐','🍒','🍑','🥭','🍌'],
};

let currentCat = 'smileys';

function renderEmojiGrid(emojis) {
  emojiGrid.innerHTML = '';
  emojis.forEach(em => {
    const span = document.createElement('span');
    span.className   = 'emoji-item';
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
  if (!emojiSearch.value.trim()) { renderEmojiGrid(EMOJIS[currentCat]); return; }
  renderEmojiGrid(Object.values(EMOJIS).flat().slice(0, 48));
});

// ─── Image Modal ───
window.openModal = function(url) {
  modalImg.src = url;
  imgModal.classList.remove('hidden');
  document.body.style.overflow = 'hidden';
};

function closeModal() { imgModal.classList.add('hidden'); document.body.style.overflow = ''; modalImg.src = ''; }
modalClose.addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', closeModal);
document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeModal(); contextMenu.classList.add('hidden'); } });

// ─── Sound ───
function playNotificationSound() {
  try {
    const ctx  = new (window.AudioContext || window.webkitAudioContext)();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.value = 880; osc.type = 'sine';
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.3);
  } catch (_) {}
}

// ══════════════════════════════════════════
// ─── Utils ───
// ══════════════════════════════════════════
function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function formatTime(iso) {
  try { return new Date(iso).toLocaleTimeString('ar-EG', { hour:'2-digit', minute:'2-digit', hour12:false }); }
  catch (_) { return ''; }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024*1024) return (bytes/1024).toFixed(1) + ' KB';
  return (bytes/(1024*1024)).toFixed(1) + ' MB';
}

function getFileIcon(name='') {
  const ext = name.split('.').pop().toLowerCase();
  if (ext === 'pdf') return '📕';
  if (['doc','docx'].includes(ext)) return '📘';
  if (['xls','xlsx'].includes(ext)) return '📗';
  return '📄';
}

// ══════════════════════════════════════════
// ─── Auto Login from localStorage ───
// ══════════════════════════════════════════
(function init() {
  const saved = localStorage.getItem('wasl_user');
  if (saved) {
    try {
      const { username } = JSON.parse(saved);
      if (username) {
        myUsername = username;
        initSocket();
        // Verify session is still valid by entering lobby
        setTimeout(() => enterLobby([]), 300);
        return;
      }
    } catch (_) {}
  }
  showScreen('auth');
  // Hide footer on auth screen
  const footer = document.getElementById('app-footer');
  if (footer) footer.style.display = 'none';
})();

// Fadeout animation
const _s = document.createElement('style');
_s.textContent = `@keyframes fadeOut { from { opacity:1; } to { opacity:0; } }`;
document.head.appendChild(_s);
