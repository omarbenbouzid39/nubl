require('dotenv').config();
const express   = require('express');
const http      = require('http');
const socketIo  = require('socket.io');
const multer    = require('multer');
const path      = require('path');
const fs        = require('fs');
const mongoose  = require('mongoose');

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server, { cors: { origin: '*' }, maxHttpBufferSize: 20e6 });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// ══════════════════════════════════════════
// ─── MongoDB Connection ───
// ══════════════════════════════════════════
mongoose.connect(process.env.MONGO_URI || 'mongodb://localhost:27017/wasl')
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => {
    console.error('❌ MongoDB connection error:', err.message);
    console.log('⚠️  Running without MongoDB — using JSON files as fallback');
  });

// ══════════════════════════════════════════
// ─── Mongoose Models ───
// ══════════════════════════════════════════

// ── User Model ──
const UserSchema = new mongoose.Schema({
  username:  { type: String, required: true, unique: true, trim: true, minlength: 2, maxlength: 20 },
  password:  { type: String, required: true },
  verified:  { type: Boolean, default: false },
  isAdmin:   { type: Boolean, default: false },
  avatar:    { type: String, default: '', maxlength: 500 },
  bio:       { type: String, default: '', maxlength: 200 },
  myRooms:   [{ type: String }],
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });

const UserModel = mongoose.model('User', UserSchema);

// ── Room Model ──
const RoomSchema = new mongoose.Schema({
  id:          { type: String, required: true, unique: true },
  name:        { type: String, required: true, trim: true, maxlength: 30 },
  description: { type: String, default: '', maxlength: 200 },
  avatar:      { type: String, default: '', maxlength: 500 },
  persistent:  { type: Boolean, default: false },
  isPrivate:   { type: Boolean, default: false },
  password:    { type: String, default: '' },
  maxUsers:    { type: Number, default: 50, min: 2, max: 100 },
  owner:       { type: String, default: '' },
  createdAt:   { type: Date, default: Date.now }
}, { versionKey: false });

const RoomModel = mongoose.model('Room', RoomSchema);

// ── Message Model ──
const MessageSchema = new mongoose.Schema({
  id:        { type: String, required: true, unique: true },
  roomId:    { type: String, required: true, index: true },
  type:      { type: String, enum: ['text','image','file'], default: 'text' },
  text:      { type: String, default: '' },
  imageUrl:  { type: String, default: '' },
  fileUrl:   { type: String, default: '' },
  fileName:  { type: String, default: '' },
  fileSize:  { type: String, default: '' },
  caption:   { type: String, default: '' },
  username:  { type: String, required: true },
  socketId:  { type: String, default: '' },
  verified:  { type: Boolean, default: false },
  avatar:    { type: String, default: '' },
  replyTo:   { type: mongoose.Schema.Types.Mixed, default: null },
  reactions: { type: mongoose.Schema.Types.Mixed, default: {} },
  deleted:   { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now }
}, { versionKey: false });

const MessageModel = mongoose.model('Message', MessageSchema);

// ══════════════════════════════════════════
// ─── In-Memory Room Cache (users only) ───
// ══════════════════════════════════════════
// rooms cache: { roomId → { ...roomData, users: { socketId: username } } }
const rooms        = {};
const activeSockets = {};
const MAX_ROOMS    = 20;
const MAX_MSG_LEN  = 1000;
const MAX_MSGS_HISTORY = 100; // messages to send on join

// ── Seed admin user if not exists ──
async function seedAdmin() {
  try {
    const exists = await UserModel.findOne({ username: 'admin' });
    if (!exists) {
      await UserModel.create({
        username: 'admin', password: 'admin123',
        verified: true, isAdmin: true,
        bio: 'مؤسس المنصة ومديرها 🔗'
      });
      console.log('✅ Admin user created');
    }
  } catch(e) { console.error('Admin seed error:', e.message); }
}

// ── Load ALL rooms into memory on startup ──
async function loadPersistentRooms() {
  try {
    const allRooms = await RoomModel.find({});
    allRooms.forEach(r => {
      rooms[r.id] = { ...r.toObject(), users: {} };
    });
    console.log(`📂 Loaded ${allRooms.length} rooms (${allRooms.filter(r=>r.persistent).length} persistent)`);
  } catch(e) { console.error('Load rooms error:', e.message); }
}

// ── Run init ──
mongoose.connection.once('open', async () => {
  await seedAdmin();
  await loadPersistentRooms();
});

// ══════════════════════════════════════════
// ─── Multer ───
// ══════════════════════════════════════════
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
// ─── Auth REST API ───
// ══════════════════════════════════════════

// Register
app.post('/api/register', async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'بيانات ناقصة' });
    if (username.length < 2 || username.length > 20) return res.status(400).json({ error: 'الاسم بين 2 و 20 حرف' });
    if (password.length < 4) return res.status(400).json({ error: 'كلمة المرور 4 أحرف على الأقل' });

    const exists = await UserModel.findOne({ username });
    if (exists) return res.status(400).json({ error: 'الاسم مستخدم بالفعل' });

    await UserModel.create({ username, password });
    console.log(`✅ Registered: ${username}`);
    res.json({ ok: true, username });
  } catch(e) { res.status(500).json({ error: 'خطأ في السيرفر' }); }
});

// Login
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = await UserModel.findOne({ username });
    if (!user || user.password !== password)
      return res.status(401).json({ error: 'اسم المستخدم أو كلمة المرور خاطئة' });
    res.json({
      ok: true, username,
      myRooms:  user.myRooms || [],
      verified: user.verified,
      avatar:   user.avatar,
      bio:      user.bio,
      isAdmin:  !!user.isAdmin
    });
  } catch(e) { res.status(500).json({ error: 'خطأ في السيرفر' }); }
});

// Get profile
app.get('/api/profile/:username', async (req, res) => {
  try {
    const user = await UserModel.findOne({ username: req.params.username }, '-password');
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    res.json({ username: user.username, verified: user.verified, avatar: user.avatar, bio: user.bio, isAdmin: !!user.isAdmin });
  } catch(e) { res.status(500).json({ error: 'خطأ في السيرفر' }); }
});

// Update profile
app.post('/api/profile/update', async (req, res) => {
  try {
    const { username, avatar, bio } = req.body;
    const user = await UserModel.findOne({ username });
    if (!user) return res.status(404).json({ error: 'المستخدم غير موجود' });
    if (avatar !== undefined) user.avatar = (avatar || '').substring(0, 500);
    if (bio    !== undefined) user.bio    = (bio    || '').substring(0, 200);
    await user.save();
    io.emit('profile_updated', { username, avatar: user.avatar, bio: user.bio, verified: user.verified });
    res.json({ ok: true, avatar: user.avatar, bio: user.bio });
  } catch(e) { res.status(500).json({ error: 'خطأ في السيرفر' }); }
});

// My rooms
app.post('/api/my-rooms', async (req, res) => {
  try {
    const { username } = req.body;
    const user = await UserModel.findOne({ username });
    if (!user) return res.status(401).json({ error: 'غير مصرح' });
    const list = (user.myRooms || []).map(id => {
      const r = rooms[id];
      if (!r) return null;
      return { id: r.id, name: r.name, persistent: r.persistent, userCount: Object.keys(r.users).length };
    }).filter(Boolean);
    res.json({ rooms: list });
  } catch(e) { res.status(500).json({ error: 'خطأ في السيرفر' }); }
});

// Remove room from my list
app.post('/api/my-rooms/remove', async (req, res) => {
  try {
    const { username, roomId } = req.body;
    await UserModel.updateOne({ username }, { $pull: { myRooms: roomId } });
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'خطأ في السيرفر' }); }
});

// ─── Rooms REST API ───
app.get('/api/rooms', (req, res) => {
  res.json({ rooms: getRoomsList() });
});

// ─── Admin API ───
app.get('/api/admin/stats', async (req, res) => {
  try {
    const roomList = await Promise.all(
      Object.values(rooms).map(async r => {
        const msgs = await MessageModel.find({ roomId: r.id }).sort({ timestamp: -1 }).limit(20).lean();
        return {
          id: r.id, name: r.name, persistent: r.persistent,
          users: Object.values(r.users),
          userCount: Object.keys(r.users).length,
          msgCount: await MessageModel.countDocuments({ roomId: r.id }),
          messages: msgs.reverse(),
          createdAt: r.createdAt
        };
      })
    );
    const usersFromDB = await UserModel.find({}, '-password').lean();
    const usersList   = usersFromDB.map(u => ({
      username: u.username, verified: !!u.verified,
      avatar: u.avatar || '', bio: u.bio || '', isAdmin: !!u.isAdmin
    }));
    res.json({
      totalRooms: roomList.length,
      totalUsers: Object.keys(activeSockets).length,
      registeredUsers: await UserModel.countDocuments(),
      rooms: roomList, users: usersList
    });
  } catch(e) { res.status(500).json({ error: 'خطأ في السيرفر' }); }
});

// Admin: Verify / Unverify
app.post('/api/admin/verify', async (req, res) => {
  try {
    const { adminUsername, targetUsername, action } = req.body;
    const admin = await UserModel.findOne({ username: adminUsername });
    if (!admin?.isAdmin) return res.status(403).json({ error: 'غير مصرح — فقط الأدمن' });
    const target = await UserModel.findOneAndUpdate(
      { username: targetUsername },
      { verified: action === 'verify' },
      { new: true }
    );
    if (!target) return res.status(404).json({ error: 'المستخدم غير موجود' });
    io.emit('profile_updated', { username: targetUsername, avatar: target.avatar, bio: target.bio, verified: target.verified });
    res.json({ ok: true, username: targetUsername, verified: target.verified });
  } catch(e) { res.status(500).json({ error: 'خطأ في السيرفر' }); }
});

// Admin: Delete room
app.delete('/api/admin/rooms/:roomId', async (req, res) => {
  try {
    const { roomId } = req.params;
    if (!rooms[roomId]) return res.status(404).json({ error: 'الغرفة غير موجودة' });
    const room = rooms[roomId];
    Object.keys(room.users).forEach(sid => {
      const s = io.sockets.sockets.get(sid);
      if (s) { s.leave(roomId); s.emit('room_deleted', { roomId }); }
    });
    delete rooms[roomId];
    await RoomModel.deleteOne({ id: roomId });
    await MessageModel.deleteMany({ roomId });
    io.emit('rooms_updated', getRoomsList());
    res.json({ ok: true });
  } catch(e) { res.status(500).json({ error: 'خطأ في السيرفر' }); }
});

app.get('/admin',   (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/profile', (req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/chat',    (req, res) => res.sendFile(path.join(__dirname, 'public', 'chat.html')));

// ══════════════════════════════════════════
// ─── Socket.io ───
// ══════════════════════════════════════════
io.on('connection', socket => {
  console.log(`🔌 Connected: ${socket.id}`);

  // ─── Join App ───
  socket.on('app_join', async ({ username }) => {
    socket.username = username;
    activeSockets[socket.id] = { username, roomId: null };
    socket.emit('rooms_list', getRoomsList());
    try {
      const u = await UserModel.findOne({ username }, '-password');
      if (u) socket.emit('my_profile', { verified: !!u.verified, avatar: u.avatar || '', bio: u.bio || '', isAdmin: !!u.isAdmin });
    } catch(_) {}
  });

  // ─── Create Room ───
  socket.on('create_room', async ({ name, persistent, isPrivate, password, avatar, description, maxUsers }, cb) => {
    if (Object.keys(rooms).length >= MAX_ROOMS) return cb?.({ error: 'وصلت للحد الأقصى من الغرف' });
    if (!name || name.trim().length < 2) return cb?.({ error: 'اسم الغرفة قصير جداً' });
    try {
      const id   = genId();
      const room = {
        id, name: name.trim(),
        description: (description || '').substring(0, 200),
        avatar:      (avatar      || '').substring(0, 500),
        persistent:  !!persistent,
        isPrivate:   !!isPrivate,
        password:    isPrivate ? (password || '').substring(0, 40) : '',
        maxUsers:    Math.min(Math.max(parseInt(maxUsers) || 50, 2), 100),
        owner:       socket.username,
        users:       {},
        createdAt:   new Date()
      };
      rooms[id] = room;
      // Save to MongoDB
      await RoomModel.create({ ...room, users: undefined });
      io.emit('rooms_updated', getRoomsList());
      console.log(`🏠 Room created: "${name}" (${id})`);
      cb?.({ ok: true, roomId: id });
    } catch(e) { cb?.({ error: 'فشل إنشاء الغرفة' }); }
  });

  // ─── Edit Room ───
  socket.on('edit_room', async ({ roomId, name, description, avatar, persistent, isPrivate, password, maxUsers }, cb) => {
    const room = rooms[roomId];
    if (!room) return cb?.({ error: 'الغرفة غير موجودة' });
    try {
      const user = await UserModel.findOne({ username: socket.username });
      if (room.owner !== socket.username && !user?.isAdmin)
        return cb?.({ error: 'فقط مالك الغرفة يمكنه التعديل' });

      if (name && name.trim().length >= 2) room.name = name.trim();
      if (description !== undefined) room.description = (description || '').substring(0, 200);
      if (avatar      !== undefined) room.avatar      = (avatar      || '').substring(0, 500);
      if (persistent  !== undefined) room.persistent  = !!persistent;
      if (isPrivate   !== undefined) {
        room.isPrivate = !!isPrivate;
        room.password  = isPrivate ? (password || room.password || '').substring(0, 40) : '';
      }
      if (maxUsers !== undefined) room.maxUsers = Math.min(Math.max(parseInt(maxUsers) || 50, 2), 100);

      await RoomModel.updateOne({ id: roomId }, {
        name: room.name, description: room.description, avatar: room.avatar,
        persistent: room.persistent, isPrivate: room.isPrivate,
        password: room.password, maxUsers: room.maxUsers
      });

      io.to(roomId).emit('room_updated', {
        roomId, name: room.name, description: room.description,
        avatar: room.avatar, persistent: room.persistent,
        isPrivate: room.isPrivate, maxUsers: room.maxUsers, owner: room.owner
      });
      io.emit('rooms_updated', getRoomsList());
      cb?.({ ok: true });
    } catch(e) { cb?.({ error: 'فشل تعديل الغرفة' }); }
  });

  // ─── Join Room ───
  socket.on('join_room', async ({ roomId, username, password }, cb) => {
    // Try memory first, then MongoDB
    let room = rooms[roomId];
    if (!room) {
      try {
        const dbRoom = await RoomModel.findOne({ id: roomId }).lean();
        if (dbRoom) {
          rooms[roomId] = { ...dbRoom, users: {} };
          room = rooms[roomId];
        }
      } catch(_) {}
    }
    if (!room) return cb?.({ error: 'الغرفة غير موجودة' });
    if (Object.keys(room.users).length >= room.maxUsers)
      return cb?.({ error: `الغرفة ممتلئة (${room.maxUsers} مستخدم كحد أقصى)` });

    if (room.isPrivate && room.password) {
      try {
        const u = await UserModel.findOne({ username: username || socket.username });
        const isOwner = (username || socket.username) === room.owner;
        if (!isOwner && !u?.isAdmin && password !== room.password)
          return cb?.({ error: 'كلمة المرور غير صحيحة' });
      } catch(_) { return cb?.({ error: 'خطأ في التحقق' }); }
    }

    const prev = activeSockets[socket.id]?.roomId;
    if (prev && prev !== roomId) leaveRoom(socket, prev);

    socket.join(roomId);
    room.users[socket.id] = username || socket.username;
    if (activeSockets[socket.id]) activeSockets[socket.id].roomId = roomId;

    // Save room to user's myRooms in DB
    try {
      await UserModel.updateOne({ username: username || socket.username }, { $addToSet: { myRooms: roomId } });
    } catch(_) {}

    // Load messages from MongoDB
    try {
      const messages = await MessageModel
        .find({ roomId, deleted: { $ne: true } })
        .sort({ timestamp: 1 })
        .limit(MAX_MSGS_HISTORY)
        .lean();
      socket.emit('room_history', { roomId, messages });
    } catch(_) {
      socket.emit('room_history', { roomId, messages: [] });
    }

    // Notify room users
    const usersWithInfo = await buildUsersInfo(room.users);
    io.to(roomId).emit('room_user_joined', { roomId, username: room.users[socket.id], users: usersWithInfo, count: Object.keys(room.users).length });
    io.emit('rooms_updated', getRoomsList());

    cb?.({ ok: true, room: {
      id: room.id, name: room.name, description: room.description || '',
      avatar: room.avatar || '', persistent: room.persistent,
      isPrivate: room.isPrivate, maxUsers: room.maxUsers, owner: room.owner
    }});
  });

  // ─── Leave Room ───
  socket.on('leave_room', ({ roomId }) => leaveRoom(socket, roomId));

  // ─── Text Message ───
  socket.on('message', async data => {
    const roomId = data.roomId || activeSockets[socket.id]?.roomId;
    const room   = rooms[roomId];
    if (!room) return;
    const text = (data.text || '').substring(0, MAX_MSG_LEN);
    if (!text.trim()) return;
    try {
      const msg = await createAndSaveMsg('text', { text, replyTo: data.replyTo || null }, socket, roomId);
      io.to(roomId).emit('message', msg);
      sendPushNotif(socket, roomId, room.name, { type: 'message', text: text.substring(0, 60), timestamp: msg.timestamp });
    } catch(e) { console.error('Message error:', e.message); }
  });

  // ─── Image Message ───
  socket.on('image_message', async data => {
    const roomId = data.roomId || activeSockets[socket.id]?.roomId;
    const room   = rooms[roomId];
    if (!room) return;
    try {
      const msg = await createAndSaveMsg('image', { imageUrl: data.imageUrl, caption: (data.caption||'').substring(0,200), replyTo: data.replyTo||null }, socket, roomId);
      io.to(roomId).emit('message', msg);
      sendPushNotif(socket, roomId, room.name, { type: 'image', text: '📷 أرسل صورة', timestamp: msg.timestamp });
    } catch(e) {}
  });

  // ─── File Message ───
  socket.on('file_message', async data => {
    const roomId = data.roomId || activeSockets[socket.id]?.roomId;
    const room   = rooms[roomId];
    if (!room) return;
    try {
      const msg = await createAndSaveMsg('file', { fileUrl: data.fileUrl, fileName: data.fileName, fileSize: data.fileSize, caption: data.caption||'', replyTo: data.replyTo||null }, socket, roomId);
      io.to(roomId).emit('message', msg);
      sendPushNotif(socket, roomId, room.name, { type: 'file', text: `📎 ${data.fileName||'ملف'}`, timestamp: msg.timestamp });
    } catch(e) {}
  });

  // ─── Delete Message ───
  socket.on('delete_message', async ({ msgId, roomId: rid }) => {
    const roomId = rid || activeSockets[socket.id]?.roomId;
    try {
      const msg = await MessageModel.findOne({ id: msgId, socketId: socket.id });
      if (!msg) return;
      msg.deleted = true;
      msg.text = '🗑️ تم حذف الرسالة';
      await msg.save();
      io.to(roomId).emit('message_deleted', { msgId });
    } catch(_) {}
  });

  // ─── Read Receipt ───
  socket.on('read', async ({ msgId, roomId: rid }) => {
    try {
      const msg = await MessageModel.findOne({ id: msgId }).lean();
      if (msg) io.to(msg.socketId).emit('message_read', { msgId });
    } catch(_) {}
  });

  // ─── Reaction ───
  socket.on('react', async ({ msgId, emoji, roomId: rid }) => {
    const roomId = rid || activeSockets[socket.id]?.roomId;
    try {
      const msg = await MessageModel.findOne({ id: msgId });
      if (!msg) return;
      if (!msg.reactions) msg.reactions = {};
      if (!msg.reactions[emoji]) msg.reactions[emoji] = [];
      const idx = msg.reactions[emoji].indexOf(socket.id);
      idx === -1 ? msg.reactions[emoji].push(socket.id) : msg.reactions[emoji].splice(idx, 1);
      msg.markModified('reactions');
      await msg.save();
      io.to(roomId).emit('reaction_update', { msgId, reactions: msg.reactions });
    } catch(_) {}
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
async function leaveRoom(socket, roomId) {
  const room = rooms[roomId];
  if (!room) return;
  const username = room.users[socket.id];
  socket.leave(roomId);
  delete room.users[socket.id];
  if (activeSockets[socket.id]) activeSockets[socket.id].roomId = null;

  const usersWithInfo = await buildUsersInfo(room.users);
  io.to(roomId).emit('room_user_left', { roomId, username, users: usersWithInfo, count: Object.keys(room.users).length });

  // Delete non-persistent empty rooms
  if (!room.persistent && Object.keys(room.users).length === 0) {
    delete rooms[roomId];
    await RoomModel.deleteOne({ id: roomId }).catch(() => {});
    console.log(`🗑️ Auto-deleted non-persistent room: "${room.name}"`);
  }
  io.emit('rooms_updated', getRoomsList());
}

async function buildUsersInfo(usersObj) {
  const result = [];
  for (const [sid, uname] of Object.entries(usersObj)) {
    try {
      const u = await UserModel.findOne({ username: uname }, 'verified avatar').lean();
      result.push({ username: uname, verified: !!u?.verified, avatar: u?.avatar || '' });
    } catch(_) { result.push({ username: uname, verified: false, avatar: '' }); }
  }
  return result;
}

async function createAndSaveMsg(type, data, socket, roomId) {
  const userInfo = await UserModel.findOne({ username: socket.username }, 'verified avatar').lean().catch(() => null);
  const msgData  = {
    id:        genId(),
    type,
    ...data,
    username:  socket.username || 'Unknown',
    verified:  !!userInfo?.verified,
    avatar:    userInfo?.avatar || '',
    socketId:  socket.id,
    roomId,
    timestamp: new Date(),
    reactions: {}
  };
  await MessageModel.create(msgData);
  return { ...msgData, timestamp: msgData.timestamp.toISOString() };
}

function sendPushNotif(socket, roomId, roomName, extra) {
  Object.entries(activeSockets).forEach(([sid, info]) => {
    if (sid !== socket.id && info.roomId !== roomId) {
      const s = io.sockets.sockets.get(sid);
      if (s) s.emit('push_notification', { roomId, roomName, from: socket.username, ...extra });
    }
  });
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
