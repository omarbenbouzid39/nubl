const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 10e6 // 10MB for image uploads
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create uploads directory if it doesn't exist
if (!fs.existsSync('./uploads')) fs.mkdirSync('./uploads');

// Multer config for image uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, './uploads/'),
  filename: (req, file, cb) => {
    const uniqueName = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, uniqueName + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp/;
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) cb(null, true);
    else cb(new Error('Only images are allowed'));
  }
});

// Image upload endpoint
app.post('/upload', upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  res.json({ url: `/uploads/${req.file.filename}` });
});

// In-memory message store (last 100 messages)
const messages = [];
const MAX_MESSAGES = 100;

// Connected users
const users = {};

io.on('connection', (socket) => {
  console.log(`🔌 New connection: ${socket.id}`);

  // User joins with a username
  socket.on('join', (username) => {
    users[socket.id] = username;
    socket.username = username;

    // Send message history to new user
    socket.emit('history', messages);

    // Notify all users about the new user
    io.emit('user_joined', {
      username,
      users: Object.values(users),
      count: Object.keys(users).length
    });

    console.log(`👤 ${username} joined. Total: ${Object.keys(users).length}`);
  });

  // Text message
  socket.on('message', (data) => {
    const msg = {
      id: Date.now() + Math.random(),
      type: 'text',
      text: data.text,
      username: socket.username || 'Unknown',
      timestamp: new Date().toISOString(),
      socketId: socket.id
    };

    messages.push(msg);
    if (messages.length > MAX_MESSAGES) messages.shift();

    io.emit('message', msg);
  });

  // Image message
  socket.on('image_message', (data) => {
    const msg = {
      id: Date.now() + Math.random(),
      type: 'image',
      imageUrl: data.imageUrl,
      caption: data.caption || '',
      username: socket.username || 'Unknown',
      timestamp: new Date().toISOString(),
      socketId: socket.id
    };

    messages.push(msg);
    if (messages.length > MAX_MESSAGES) messages.shift();

    io.emit('message', msg);
  });

  // Typing indicator
  socket.on('typing', (isTyping) => {
    socket.broadcast.emit('typing', {
      username: socket.username,
      isTyping
    });
  });

  // Disconnect
  socket.on('disconnect', () => {
    const username = users[socket.id];
    delete users[socket.id];

    if (username) {
      io.emit('user_left', {
        username,
        users: Object.values(users),
        count: Object.keys(users).length
      });
      console.log(`👋 ${username} left. Total: ${Object.keys(users).length}`);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n🚀 Chat Server running at http://localhost:${PORT}`);
  console.log(`📡 Socket.io ready for real-time connections\n`);
});
