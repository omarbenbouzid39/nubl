const express = require('express');
const http    = require('http');
const socketIo = require('socket.io');
const multer  = require('multer');
const path    = require('path');
const fs      = require('fs');

const app    = express();
const server = http.createServer(app);
const io     = socketIo(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 20e6
});

app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// ─── Multer ───
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads/'),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + path.extname(file.originalname));
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf|doc|docx/;
    const ext  = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = /image\/|application\/pdf|application\/msword|application\/vnd/.test(file.mimetype);
    (ext || mime) ? cb(null, true) : cb(new Error('File type not allowed'));
  }
});

// ─── Upload endpoint ───
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}`, name: req.file.originalname });
});

// ─── In-memory store ───
const messages = [];  // last 100 messages
const users    = {};  // socketId → username
const MAX_MSGS = 100;

// reactions: { msgId: { emoji: [socketId, ...] } }
const reactions = {};

// ─── Socket.io ───
io.on('connection', socket => {
  console.log(`🔌 Connected: ${socket.id}`);

  // Join
  socket.on('join', username => {
    users[socket.id] = username;
    socket.username  = username;
    socket.emit('history', messages);
    io.emit('user_joined', { username, users: Object.values(users), count: Object.keys(users).length });
    console.log(`👤 ${username} joined. Total: ${Object.keys(users).length}`);
  });

  // Text message
  socket.on('message', data => {
    const msg = {
      id: genId(), type: 'text',
      text: data.text,
      username: socket.username || 'Unknown',
      socketId: socket.id,
      timestamp: new Date().toISOString(),
      replyTo: data.replyTo || null,
      reactions: {}
    };
    pushMessage(msg);
    io.emit('message', msg);
  });

  // Image message
  socket.on('image_message', data => {
    const msg = {
      id: genId(), type: 'image',
      imageUrl: data.imageUrl,
      caption: data.caption || '',
      username: socket.username || 'Unknown',
      socketId: socket.id,
      timestamp: new Date().toISOString(),
      replyTo: data.replyTo || null,
      reactions: {}
    };
    pushMessage(msg);
    io.emit('message', msg);
  });

  // File message
  socket.on('file_message', data => {
    const msg = {
      id: genId(), type: 'file',
      fileUrl: data.fileUrl,
      fileName: data.fileName,
      fileSize: data.fileSize,
      caption: data.caption || '',
      username: socket.username || 'Unknown',
      socketId: socket.id,
      timestamp: new Date().toISOString(),
      replyTo: data.replyTo || null,
      reactions: {}
    };
    pushMessage(msg);
    io.emit('message', msg);
  });

  // Delete message
  socket.on('delete_message', ({ msgId }) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg || msg.socketId !== socket.id) return;
    msg.deleted = true;
    msg.text = '🗑️ تم حذف الرسالة';
    io.emit('message_deleted', { msgId });
  });

  // Read receipt
  socket.on('read', ({ msgId }) => {
    const msg = messages.find(m => m.id === msgId);
    if (msg) {
      io.to(msg.socketId).emit('message_read', { msgId });
    }
  });

  // Reaction
  socket.on('react', ({ msgId, emoji }) => {
    const msg = messages.find(m => m.id === msgId);
    if (!msg) return;

    if (!msg.reactions) msg.reactions = {};
    if (!msg.reactions[emoji]) msg.reactions[emoji] = [];

    const idx = msg.reactions[emoji].indexOf(socket.id);
    if (idx === -1) {
      msg.reactions[emoji].push(socket.id);
    } else {
      msg.reactions[emoji].splice(idx, 1);
    }

    io.emit('reaction_update', { msgId, reactions: msg.reactions });
  });

  // Typing
  socket.on('typing', isTyping => {
    socket.broadcast.emit('typing', { username: socket.username, isTyping });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const username = users[socket.id];
    delete users[socket.id];
    if (username) {
      io.emit('user_left', { username, users: Object.values(users), count: Object.keys(users).length });
      console.log(`👋 ${username} left. Total: ${Object.keys(users).length}`);
    }
  });
});

// ─── Helpers ───
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function pushMessage(msg) {
  messages.push(msg);
  if (messages.length > MAX_MSGS) messages.shift();
}

// ─── Start ───
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Chat Server → http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready\n`);
});
