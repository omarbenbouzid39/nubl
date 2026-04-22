const express  = require('express');
const http     = require('http');
const socketIo = require('socket.io');
const multer   = require('multer');
const path     = require('path');
const fs       = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server, { cors: { origin: '*' }, maxHttpBufferSize: 20e6 });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// ─── Multer ───
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads/'),
  filename:    (req, file, cb) => {
    const u = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, u + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = /jpeg|jpg|png|gif|webp|pdf|doc|docx/.test(path.extname(file.originalname).toLowerCase());
    ok ? cb(null, true) : cb(new Error('File type not allowed'));
  }
});

app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

// ══════════════════════════════════════════
// ─── In-Memory Data Store ───
// ══════════════════════════════════════════

// Users: { username → { password, myRooms:[roomId] } }
const usersDB = {
  admin: { password: 'admin123', myRooms: [] }
};

// Connected sockets: { socketId → { username, roomId } }
const activeSockets = {};

// Rooms: { roomId → { id, name, persistent, messages[], users:{socketId→username}, createdAt } }
const rooms = {};

const MAX_ROOMS    = 20;
const MAX_MSG_LEN  = 1000;
const MAX_MSGS     = 200;

// ══════════════════════════════════════════
// ─── Auth REST API ───
// ══════════════════════════════════════════

// Register
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'بيانات ناقصة' });
  if (username.length < 2 || username.length > 20) return res.status(400).json({ error: 'الاسم بين 2 و 20 حرف' });
  if (password.length < 4) return res.status(400).json({ error: 'كلمة المرور 4 أحرف على الأقل' });
  if (usersDB[username]) return res.status(400).json({ error: 'الاسم مستخدم بالفعل' });
  usersDB[username] = { password, myRooms: [], createdAt: new Date().toISOString(), banned: false, verified: false };
  console.log(`✅ Registered: ${username}`);
  res.json({ ok: true, username });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = usersDB[username];
  if (!user || user.password !== password) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور خاطئة' });
  if (user.banned) return res.status(403).json({ error: 'تم حظر هذا الحساب. تواصل مع المشرف.' });
  res.json({ ok: true, username, myRooms: user.myRooms });
});

// Get my rooms details
app.post('/api/my-rooms', (req, res) => {
  const { username } = req.body;
  if (!usersDB[username]) return res.status(401).json({ error: 'غير مصرح' });
  const ids = usersDB[username].myRooms || [];
  const list = ids.map(id => {
    const r = rooms[id];
    if (!r) return null;
    return { id: r.id, name: r.name, persistent: r.persistent, userCount: Object.keys(r.users).length };
  }).filter(Boolean);
  res.json({ rooms: list });
});

// Remove room from my list (not delete from server)
app.post('/api/my-rooms/remove', (req, res) => {
  const { username, roomId } = req.body;
  if (!usersDB[username]) return res.status(401).json({ error: 'غير مصرح' });
  usersDB[username].myRooms = (usersDB[username].myRooms || []).filter(id => id !== roomId);
  res.json({ ok: true });
});

// ─── Rooms REST API ───
app.get('/api/rooms', (req, res) => {
  const list = Object.values(rooms).map(r => ({
    id: r.id, name: r.name, persistent: r.persistent,
    userCount: Object.keys(r.users).length, msgCount: r.messages.length, createdAt: r.createdAt
  }));
  res.json({ rooms: list });
});

// ─── Admin API ───
app.get('/api/admin/stats', (req, res) => {
  const roomList = Object.values(rooms).map(r => ({
    id: r.id, name: r.name, persistent: r.persistent,
    users: Object.values(r.users),
    userCount: Object.keys(r.users).length,
    msgCount: r.messages.length,
    messages: r.messages.slice(-20), // last 20
    createdAt: r.createdAt
  }));
  res.json({
    totalRooms: roomList.length,
    totalUsers: Object.keys(activeSockets).length,
    registeredUsers: Object.keys(usersDB).length,
    rooms: roomList
  });
});

app.delete('/api/admin/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  if (!rooms[roomId]) return res.status(404).json({ error: 'الغرفة غير موجودة' });
  // Kick all users in this room
  const room = rooms[roomId];
  Object.keys(room.users).forEach(sid => {
    const s = io.sockets.sockets.get(sid);
    if (s) { s.leave(roomId); s.emit('room_deleted', { roomId }); }
  });
  delete rooms[roomId];
  io.emit('rooms_updated', getRoomsList());
  console.log(`🗑️ Admin deleted room: ${roomId}`);
  res.json({ ok: true });
});

// ─── Admin Users API ───

// Get all users list
app.get('/api/admin/users', (req, res) => {
  const list = Object.entries(usersDB).map(([username, data]) => {
    const socketEntry = Object.values(activeSockets).find(s => s.username === username);
    return {
      username,
      myRooms: data.myRooms || [],
      isOnline: !!socketEntry,
      currentRoom: socketEntry?.roomId || null,
      banned: data.banned || false,
      verified: data.verified || false,
      createdAt: data.createdAt || null,
    };
  });
  res.json({ users: list });
});

// Toggle ban user
app.post('/api/admin/users/:username/ban', (req, res) => {
  const { username } = req.params;
  if (!usersDB[username]) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (username === 'admin') return res.status(403).json({ error: 'لا يمكن حظر حساب المشرف' });
  usersDB[username].banned = !usersDB[username].banned;
  const isBanned = usersDB[username].banned;
  // Kick if online
  if (isBanned) {
    Object.entries(activeSockets).forEach(([sid, info]) => {
      if (info.username === username) {
        const s = io.sockets.sockets.get(sid);
        if (s) { s.emit('force_logout', { reason: 'تم حظر حسابك من قِبل المشرف' }); s.disconnect(true); }
      }
    });
  }
  console.log(`${isBanned ? '🚫' : '✅'} Admin ${isBanned ? 'banned' : 'unbanned'}: ${username}`);
  res.json({ ok: true, banned: isBanned, username });
});

// Toggle verify user
app.post('/api/admin/users/:username/verify', (req, res) => {
  const { username } = req.params;
  if (!usersDB[username]) return res.status(404).json({ error: 'المستخدم غير موجود' });
  usersDB[username].verified = !usersDB[username].verified;
  const isVerified = usersDB[username].verified;
  console.log(`${isVerified ? '✔️' : '❌'} Admin ${isVerified ? 'verified' : 'unverified'}: ${username}`);
  res.json({ ok: true, verified: isVerified, username });
});

// Reset user password
app.post('/api/admin/users/:username/reset-password', (req, res) => {
  const { username } = req.params;
  const { newPassword } = req.body;
  if (!usersDB[username]) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (!newPassword || newPassword.length < 4) return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 4 أحرف على الأقل' });
  usersDB[username].password = newPassword;
  console.log(`🔑 Admin reset password for: ${username}`);
  res.json({ ok: true });
});

// Delete user account
app.delete('/api/admin/users/:username', (req, res) => {
  const { username } = req.params;
  if (!usersDB[username]) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (username === 'admin') return res.status(403).json({ error: 'لا يمكن حذف حساب المشرف' });
  // Kick if online
  Object.entries(activeSockets).forEach(([sid, info]) => {
    if (info.username === username) {
      const s = io.sockets.sockets.get(sid);
      if (s) { s.emit('force_logout', { reason: 'تم حذف حسابك من قِبل المشرف' }); s.disconnect(true); }
    }
  });
  delete usersDB[username];
  console.log(`🗑️ Admin deleted user: ${username}`);
  res.json({ ok: true });
});

// Force logout user
app.post('/api/admin/users/:username/kick', (req, res) => {
  const { username } = req.params;
  let kicked = false;
  Object.entries(activeSockets).forEach(([sid, info]) => {
    if (info.username === username) {
      const s = io.sockets.sockets.get(sid);
      if (s) { s.emit('force_logout', { reason: 'تم تسجيل خروجك من قِبل المشرف' }); s.disconnect(true); kicked = true; }
    }
  });
  res.json({ ok: true, kicked });
});

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ══════════════════════════════════════════
// ─── Socket.io ───
// ══════════════════════════════════════════
io.on('connection', socket => {
  console.log(`🔌 Connected: ${socket.id}`);

  // ─── Auth & Join App ───
  socket.on('app_join', ({ username }) => {
    socket.username = username;
    activeSockets[socket.id] = { username, roomId: null };
    socket.emit('rooms_list', getRoomsList());
  });

  // ─── Create Room ───
  socket.on('create_room', ({ name, persistent }, cb) => {
    if (Object.keys(rooms).length >= MAX_ROOMS) return cb?.({ error: 'وصلت للحد الأقصى من الغرف' });
    if (!name || name.trim().length < 2) return cb?.({ error: 'اسم الغرفة قصير جداً' });

    const id   = genId();
    rooms[id]  = { id, name: name.trim(), persistent: !!persistent, users: {}, messages: [], createdAt: new Date().toISOString() };
    io.emit('rooms_updated', getRoomsList());
    console.log(`🏠 Room created: "${name}" (${id}) persistent=${persistent}`);
    cb?.({ ok: true, roomId: id });
  });

  // ─── Join Room ───
  socket.on('join_room', ({ roomId, username }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb?.({ error: 'الغرفة غير موجودة' });

    // Leave previous room if any
    const prev = activeSockets[socket.id]?.roomId;
    if (prev && prev !== roomId) leaveRoom(socket, prev);

    socket.join(roomId);
    room.users[socket.id] = username || socket.username;
    if (activeSockets[socket.id]) activeSockets[socket.id].roomId = roomId;

    // Save to user's myRooms
    if (username && usersDB[username]) {
      if (!usersDB[username].myRooms.includes(roomId)) usersDB[username].myRooms.push(roomId);
    }

    // Send history
    socket.emit('room_history', { roomId, messages: room.messages });

    // Notify room
    io.to(roomId).emit('room_user_joined', { roomId, username: room.users[socket.id], users: Object.values(room.users), count: Object.keys(room.users).length });
    io.emit('rooms_updated', getRoomsList());
    console.log(`👤 ${username} joined room "${room.name}"`);
    cb?.({ ok: true, room: { id: room.id, name: room.name, persistent: room.persistent } });
  });

  // ─── Leave Room ───
  socket.on('leave_room', ({ roomId }) => leaveRoom(socket, roomId));

  // ─── Text Message ───
  socket.on('message', data => {
    const roomId = data.roomId || activeSockets[socket.id]?.roomId;
    const room   = rooms[roomId];
    if (!room) return;

    const text = (data.text || '').substring(0, MAX_MSG_LEN);
    if (!text.trim()) return;

    const msg = buildMsg('text', { text, replyTo: data.replyTo || null }, socket, roomId);
    pushRoomMsg(room, msg);
    io.to(roomId).emit('message', msg);
  });

  // ─── Image Message ───
  socket.on('image_message', data => {
    const roomId = data.roomId || activeSockets[socket.id]?.roomId;
    const room   = rooms[roomId];
    if (!room) return;
    const msg = buildMsg('image', { imageUrl: data.imageUrl, caption: (data.caption || '').substring(0, 200), replyTo: data.replyTo || null }, socket, roomId);
    pushRoomMsg(room, msg);
    io.to(roomId).emit('message', msg);
  });

  // ─── File Message ───
  socket.on('file_message', data => {
    const roomId = data.roomId || activeSockets[socket.id]?.roomId;
    const room   = rooms[roomId];
    if (!room) return;
    const msg = buildMsg('file', { fileUrl: data.fileUrl, fileName: data.fileName, fileSize: data.fileSize, caption: data.caption || '', replyTo: data.replyTo || null }, socket, roomId);
    pushRoomMsg(room, msg);
    io.to(roomId).emit('message', msg);
  });

  // ─── Delete Message ───
  socket.on('delete_message', ({ msgId, roomId: rid }) => {
    const roomId = rid || activeSockets[socket.id]?.roomId;
    const room   = rooms[roomId];
    if (!room) return;
    const msg = room.messages.find(m => m.id === msgId);
    if (!msg || msg.socketId !== socket.id) return;
    msg.deleted = true; msg.text = '🗑️ تم حذف الرسالة';
    io.to(roomId).emit('message_deleted', { msgId });
  });

  // ─── Read Receipt ───
  socket.on('read', ({ msgId, roomId: rid }) => {
    const roomId = rid || activeSockets[socket.id]?.roomId;
    const room   = rooms[roomId];
    if (!room) return;
    const msg = room.messages.find(m => m.id === msgId);
    if (msg) io.to(msg.socketId).emit('message_read', { msgId });
  });

  // ─── Reaction ───
  socket.on('react', ({ msgId, emoji, roomId: rid }) => {
    const roomId = rid || activeSockets[socket.id]?.roomId;
    const room   = rooms[roomId];
    if (!room) return;
    const msg = room.messages.find(m => m.id === msgId);
    if (!msg) return;
    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
    const idx = msg.reactions[emoji].indexOf(socket.id);
    idx === -1 ? msg.reactions[emoji].push(socket.id) : msg.reactions[emoji].splice(idx, 1);
    io.to(roomId).emit('reaction_update', { msgId, reactions: msg.reactions });
  });

  // ─── Typing ───
  socket.on('typing', ({ isTyping, roomId: rid }) => {
    const roomId = rid || activeSockets[socket.id]?.roomId;
    if (roomId) socket.to(roomId).emit('typing', { username: socket.username, isTyping });
  });

  // ─── Disconnect ───
  socket.on('disconnect', () => {
    const info = activeSockets[socket.id];
    if (info?.roomId) leaveRoom(socket, info.roomId);
    delete activeSockets[socket.id];
    console.log(`👋 Disconnected: ${socket.id}`);
  });
});

// ══════════════════════════════════════════
// ─── Helpers ───
// ══════════════════════════════════════════
function leaveRoom(socket, roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const username = room.users[socket.id];
  socket.leave(roomId);
  delete room.users[socket.id];
  if (activeSockets[socket.id]) activeSockets[socket.id].roomId = null;

  io.to(roomId).emit('room_user_left', { roomId, username, users: Object.values(room.users), count: Object.keys(room.users).length });

  // Delete non-persistent empty rooms
  if (!room.persistent && Object.keys(room.users).length === 0) {
    delete rooms[roomId];
    console.log(`🗑️ Auto-deleted non-persistent room: "${room.name}"`);
  }
  io.emit('rooms_updated', getRoomsList());
}

function buildMsg(type, data, socket, roomId) {
  return { id: genId(), type, ...data, username: socket.username || 'Unknown', socketId: socket.id, roomId, timestamp: new Date().toISOString(), reactions: {} };
}

function pushRoomMsg(room, msg) {
  room.messages.push(msg);
  if (room.messages.length > MAX_MSGS) room.messages.shift();
}

function getRoomsList() {
  return Object.values(rooms).map(r => ({ id: r.id, name: r.name, persistent: r.persistent, userCount: Object.keys(r.users).length }));
}

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ─── Start ───
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 وَصْل Chat Server → http://localhost:${PORT}`);
  console.log(`🛡️  Admin Panel   → http://localhost:${PORT}/admin`);
  console.log(`📡 Socket.io ready\n`);
});
