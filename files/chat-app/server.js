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

// Users: { username → { password, myRooms, verified, avatar, bio } }
const usersDB = {
  admin: { password: 'admin123', myRooms: [], verified: true, avatar: '', bio: 'مؤسس المنصة ومديرها 🔗', isAdmin: true }
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
  usersDB[username] = { password, myRooms: [], verified: false, avatar: '', bio: '', isAdmin: false };
  console.log(`✅ Registered: ${username}`);
  res.json({ ok: true, username });
});

// Login
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = usersDB[username];
  if (!user || user.password !== password) return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور خاطئة' });
  res.json({ ok: true, username, myRooms: user.myRooms, verified: user.verified, avatar: user.avatar, bio: user.bio, isAdmin: !!user.isAdmin });
});

// Get profile
app.get('/api/profile/:username', (req, res) => {
  const user = usersDB[req.params.username];
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  res.json({ username: req.params.username, verified: user.verified, avatar: user.avatar, bio: user.bio, isAdmin: !!user.isAdmin });
});

// Update profile (avatar + bio only — not password/verified)
app.post('/api/profile/update', (req, res) => {
  const { username, avatar, bio } = req.body;
  const user = usersDB[username];
  if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
  if (avatar !== undefined) user.avatar = (avatar || '').substring(0, 500);
  if (bio    !== undefined) user.bio    = (bio    || '').substring(0, 200);
  // Notify all sockets of this user about profile update
  io.emit('profile_updated', { username, avatar: user.avatar, bio: user.bio, verified: user.verified });
  res.json({ ok: true, avatar: user.avatar, bio: user.bio });
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
    messages: r.messages.slice(-20),
    createdAt: r.createdAt
  }));
  // Include users list with verified status
  const usersList = Object.entries(usersDB).map(([uname, u]) => ({
    username: uname,
    verified: !!u.verified,
    avatar: u.avatar || '',
    bio: u.bio || '',
    isAdmin: !!u.isAdmin
  }));
  res.json({
    totalRooms: roomList.length,
    totalUsers: Object.keys(activeSockets).length,
    registeredUsers: Object.keys(usersDB).length,
    rooms: roomList,
    users: usersList
  });
});

// ─── Admin: Verify / Unverify user ───
app.post('/api/admin/verify', (req, res) => {
  const { adminUsername, targetUsername, action } = req.body;
  // Security: only admin can verify
  const admin = usersDB[adminUsername];
  if (!admin || !admin.isAdmin) return res.status(403).json({ error: 'غير مصرح — فقط الأدمن' });
  const target = usersDB[targetUsername];
  if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
  // Prevent self-verify via API (though admin already verified)
  target.verified = action === 'verify';
  // Broadcast update to all connected clients
  io.emit('profile_updated', { username: targetUsername, avatar: target.avatar, bio: target.bio, verified: target.verified });
  console.log(`🔵 Admin ${adminUsername} ${action === 'verify' ? 'verified' : 'unverified'} user: ${targetUsername}`);
  res.json({ ok: true, username: targetUsername, verified: target.verified });
});

app.delete('/api/admin/rooms/:roomId', (req, res) => {
  const { roomId } = req.params;
  if (!rooms[roomId]) return res.status(404).json({ error: 'الغرفة غير موجودة' });
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

// Serve admin page
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// Serve profile page
app.get('/profile', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
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
    // Send user's own profile back
    const u = usersDB[username] || {};
    socket.emit('my_profile', { verified: !!u.verified, avatar: u.avatar || '', bio: u.bio || '', isAdmin: !!u.isAdmin });
  });

  // ─── Create Room ───
  socket.on('create_room', ({ name, persistent, isPrivate, password, avatar, description, maxUsers }, cb) => {
    if (Object.keys(rooms).length >= MAX_ROOMS) return cb?.({ error: 'وصلت للحد الأقصى من الغرف' });
    if (!name || name.trim().length < 2) return cb?.({ error: 'اسم الغرفة قصير جداً' });

    const id  = genId();
    rooms[id] = {
      id,
      name:        name.trim(),
      description: (description || '').substring(0, 200),
      avatar:      (avatar || '').substring(0, 500),
      persistent:  !!persistent,
      isPrivate:   !!isPrivate,
      password:    isPrivate ? (password || '').substring(0, 40) : '',
      maxUsers:    Math.min(Math.max(parseInt(maxUsers) || 50, 2), 100),
      owner:       socket.username,
      users:       {},
      messages:    [],
      createdAt:   new Date().toISOString()
    };
    io.emit('rooms_updated', getRoomsList());
    console.log(`🏠 Room created: "${name}" (${id}) private=${isPrivate} persistent=${persistent}`);
    cb?.({ ok: true, roomId: id });
  });

  // ─── Edit Room (owner only) ───
  socket.on('edit_room', ({ roomId, name, description, avatar, persistent, isPrivate, password, maxUsers }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb?.({ error: 'الغرفة غير موجودة' });
    if (room.owner !== socket.username && !usersDB[socket.username]?.isAdmin)
      return cb?.({ error: 'فقط مالك الغرفة يمكنه التعديل' });

    if (name && name.trim().length >= 2) room.name        = name.trim();
    if (description !== undefined)       room.description = (description || '').substring(0, 200);
    if (avatar      !== undefined)       room.avatar      = (avatar      || '').substring(0, 500);
    if (persistent  !== undefined)       room.persistent  = !!persistent;
    if (isPrivate   !== undefined) {
      room.isPrivate = !!isPrivate;
      room.password  = isPrivate ? (password || room.password || '').substring(0, 40) : '';
    }
    if (maxUsers !== undefined) room.maxUsers = Math.min(Math.max(parseInt(maxUsers) || 50, 2), 100);

    // Broadcast updated room info to all in room
    io.to(roomId).emit('room_updated', {
      roomId, name: room.name, description: room.description,
      avatar: room.avatar, persistent: room.persistent,
      isPrivate: room.isPrivate, maxUsers: room.maxUsers,
      owner: room.owner
    });
    io.emit('rooms_updated', getRoomsList());
    console.log(`✏️ Room edited: "${room.name}" by ${socket.username}`);
    cb?.({ ok: true });
  });

  // ─── Join Room ───
  socket.on('join_room', ({ roomId, username, password }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb?.({ error: 'الغرفة غير موجودة' });

    // Check max users
    if (Object.keys(room.users).length >= room.maxUsers) return cb?.({ error: `الغرفة ممتلئة (${room.maxUsers} مستخدم كحد أقصى)` });

    // Check private password
    if (room.isPrivate && room.password) {
      const isOwner = (username || socket.username) === room.owner;
      const isAdmin = usersDB[username || socket.username]?.isAdmin;
      if (!isOwner && !isAdmin && password !== room.password) {
        return cb?.({ error: 'كلمة المرور غير صحيحة' });
      }
    }

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

    // Notify room — include verified status
    const usersWithInfo = Object.entries(room.users).map(([sid, uname]) => ({
      username: uname,
      verified: !!(usersDB[uname]?.verified),
      avatar:   usersDB[uname]?.avatar || ''
    }));
    io.to(roomId).emit('room_user_joined', { roomId, username: room.users[socket.id], users: usersWithInfo, count: Object.keys(room.users).length });
    io.emit('rooms_updated', getRoomsList());
    console.log(`👤 ${username} joined room "${room.name}"`);
    cb?.({ ok: true, room: {
      id: room.id, name: room.name, description: room.description || '',
      avatar: room.avatar || '', persistent: room.persistent,
      isPrivate: room.isPrivate, maxUsers: room.maxUsers, owner: room.owner
    }});
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

    // ── Push notification to users NOT in this room ──
    Object.entries(activeSockets).forEach(([sid, info]) => {
      if (sid !== socket.id && info.roomId !== roomId) {
        const s = io.sockets.sockets.get(sid);
        if (s) s.emit('push_notification', {
          type: 'message',
          roomId, roomName: room.name,
          from: socket.username,
          text: text.substring(0, 60),
          timestamp: msg.timestamp
        });
      }
    });
  });

  // ─── Image Message ───
  socket.on('image_message', data => {
    const roomId = data.roomId || activeSockets[socket.id]?.roomId;
    const room   = rooms[roomId];
    if (!room) return;
    const msg = buildMsg('image', { imageUrl: data.imageUrl, caption: (data.caption || '').substring(0, 200), replyTo: data.replyTo || null }, socket, roomId);
    pushRoomMsg(room, msg);
    io.to(roomId).emit('message', msg);
    Object.entries(activeSockets).forEach(([sid, info]) => {
      if (sid !== socket.id && info.roomId !== roomId) {
        const s = io.sockets.sockets.get(sid);
        if (s) s.emit('push_notification', { type: 'image', roomId, roomName: room.name, from: socket.username, text: '📷 أرسل صورة', timestamp: msg.timestamp });
      }
    });
  });

  // ─── File Message ───
  socket.on('file_message', data => {
    const roomId = data.roomId || activeSockets[socket.id]?.roomId;
    const room   = rooms[roomId];
    if (!room) return;
    const msg = buildMsg('file', { fileUrl: data.fileUrl, fileName: data.fileName, fileSize: data.fileSize, caption: data.caption || '', replyTo: data.replyTo || null }, socket, roomId);
    pushRoomMsg(room, msg);
    io.to(roomId).emit('message', msg);
    Object.entries(activeSockets).forEach(([sid, info]) => {
      if (sid !== socket.id && info.roomId !== roomId) {
        const s = io.sockets.sockets.get(sid);
        if (s) s.emit('push_notification', { type: 'file', roomId, roomName: room.name, from: socket.username, text: `📎 ${data.fileName || 'ملف'}`, timestamp: msg.timestamp });
      }
    });
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

  const usersWithInfo2 = Object.entries(room.users).map(([sid, uname]) => ({
    username: uname,
    verified: !!(usersDB[uname]?.verified),
    avatar:   usersDB[uname]?.avatar || ''
  }));
  io.to(roomId).emit('room_user_left', { roomId, username, users: usersWithInfo2, count: Object.keys(room.users).length });

  // Delete non-persistent empty rooms
  if (!room.persistent && Object.keys(room.users).length === 0) {
    delete rooms[roomId];
    console.log(`🗑️ Auto-deleted non-persistent room: "${room.name}"`);
  }
  io.emit('rooms_updated', getRoomsList());
}

function buildMsg(type, data, socket, roomId) {
  const userInfo = usersDB[socket.username] || {};
  return {
    id: genId(), type, ...data,
    username: socket.username || 'Unknown',
    verified: !!userInfo.verified,
    avatar:   userInfo.avatar || '',
    socketId: socket.id, roomId,
    timestamp: new Date().toISOString(),
    reactions: {}
  };
}

function pushRoomMsg(room, msg) {
  room.messages.push(msg);
  if (room.messages.length > MAX_MSGS) room.messages.shift();
}

function getRoomsList() {
  return Object.values(rooms).map(r => ({
    id:          r.id,
    name:        r.name,
    description: r.description || '',
    avatar:      r.avatar      || '',
    persistent:  r.persistent,
    isPrivate:   r.isPrivate   || false,
    maxUsers:    r.maxUsers    || 50,
    owner:       r.owner       || '',
    userCount:   Object.keys(r.users).length
  }));
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
