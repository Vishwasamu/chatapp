require('dotenv').config();

const http = require('http');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const mongoose = require('mongoose');
const { Server } = require('socket.io');

const connectDB = require('./config/db');
const User = require('./models/User');
const registerSocketHandlers = require('./sockets');

if (!process.env.JWT_SECRET) {
  console.error('❌ JWT_SECRET is not set. Copy .env.example to .env first.');
  process.exit(1);
}

const origins = (process.env.CLIENT_ORIGIN || '*').split(',').map((s) => s.trim());
const corsOrigin = origins.includes('*') ? '*' : origins;

const app = express();
app.use(helmet());
app.use(cors({ origin: corsOrigin }));
app.use(express.json({ limit: '1mb' }));

// One HTTP server shared by Express (REST) and Socket.io (WebSocket).
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: corsOrigin },
  pingInterval: 25000,
  pingTimeout: 20000,
});
app.set('io', io); // lets REST routes push socket events / manage rooms

app.get('/health', (_req, res) => res.json({ status: 'ok' }));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/users', require('./routes/users'));
app.use('/api/chats', require('./routes/chats'));

app.use((_req, res) => res.status(404).json({ message: 'Not found' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error(err);
  const status = err.status || 500;
  res.status(status).json({ message: status === 500 ? 'Internal server error' : err.message });
});

registerSocketHandlers(io);

async function start() {
  await connectDB();
  // After a crash/restart nobody is really connected, so reset stale presence.
  await User.updateMany({}, { isOnline: false });

  const port = process.env.PORT || 5001;
  server.listen(port, '0.0.0.0', () => console.log(`🚀 Server listening on :${port}`));
}

async function shutdown() {
  console.log('Shutting down...');
  io.close();
  server.close(async () => {
    await mongoose.disconnect();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

start().catch((err) => {
  console.error('❌ Failed to start server:', err.message);
  process.exit(1);
});
