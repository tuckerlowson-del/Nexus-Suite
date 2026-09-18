# ⚡ William Remote Panel

Full remote device control panel. Cross-network via Railway.

---

## 🚀 Deploy to Railway (Server)

1. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub repo
   **OR** drag the zip into Railway's UI

2. Set these Environment Variables in Railway dashboard:
   ```
   AUTH_TOKEN=your_agent_token_here
   PANEL_PASSWORD=your_panel_password_here
   PORT=3000
   ```

3. Railway gives you a public URL like:
   `https://william-panel-xxx.up.railway.app`

---

## 🖥️ Panel (Your Control Browser)

1. Open the Railway URL in your browser
2. Enter PANEL_PASSWORD
3. Done — you're in

---

## 🤖 Agent (Run on Your Devices)

### Step 1 — Edit the agent file
Open `agent/agent-windows.js` (or linux) and set:
```js
const SERVER_URL = 'https://YOUR_RAILWAY_URL.up.railway.app';
const AUTH_TOKEN = 'your_agent_token_here';  // must match Railway env
```

### Step 2 — Install deps & run
```bash
cd agent
npm install
node agent-windows.js   # Windows
node agent-linux.js     # Linux / macOS
```

### Step 3 — Build to single EXE (optional, no Node needed)
```bash
npm install -g pkg
npm run build:win    # → dist/william-agent-win.exe
npm run build:linux  # → dist/william-agent-linux
npm run build:mac    # → dist/william-agent-mac
```
Drop the exe on your device, run it, it connects automatically.

---

## ✨ Features

| Feature | Details |
|---------|---------|
| 💻 Shell | Remote terminal, command history, quick commands |
| 📁 File Manager | Browse, read, edit, upload, download, delete files |
| 📸 Screenshot | Manual + auto screenshot every 5s |
| ⚙️ Processes | List all processes, filter, kill by PID |
| 🖥️ System Info | RAM, CPU, uptime, platform, user info |
| 🎹 Keylog Stream | Active window tracking + full keylog (with iohook) |
| 📋 Clipboard | Get/set clipboard on device |
| 🌐 Open URL | Open any URL on device browser |
| 💬 Alert Popup | Send popup message to device screen |
| ⚡ Power | Shutdown, restart, sleep, log off |
| 🔄 Multi-device | Manage unlimited devices from one panel |
| 🔒 Auth | Panel password + agent token protection |

---

## 🎹 Full Keylogger (optional)

The default agent uses window-title polling.
For full keystroke capture:

```bash
cd agent
npm install iohook
```

Then uncomment the `iohook` block at the bottom of the agent file.

---

## 🔒 Security

- Change AUTH_TOKEN and PANEL_PASSWORD before deploying
- Panel is password-protected
- Agents verify token before registering
- Use on your own devices only

---

*"I just hand over the tools, what you do with them is your call, boss."*
