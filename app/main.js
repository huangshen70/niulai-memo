const { app, BrowserWindow, Menu, Tray, ipcMain, shell, screen, nativeImage, dialog, session } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFile } = require('child_process');
const crypto = require('crypto');

const VERSION = require('./package.json').version;
const REPO = 'huangshen70/niulai-memo';

// ---------------------------------------------------------------- 数据层
const storeFile = path.join(app.getPath('userData'), 'store.json');
const storeBak = storeFile + '.bak';
// 与 js/petdraw.js 的 SPRITES 保持一致（主进程不能 require 浏览器脚本）
const KNOWN_SKINS = [
  'xiaoxin', 'anon', 'momoco', 'labubu', 'hanabi',
  'guga', 'biscuit', 'kitsune', 'ember', 'prism',
];
// 旧版默认宠物名（随外观一起下线），仅当用户没改过名字时才替换
const STALE_PET_NAMES = ['小牛', '薄荷', '樱花', '暗夜'];
const DEFAULT_STORE = {
  notes: [], wfs: [], tpls: [{ name: '商品上架流程', steps: ['制作信息表', '上马帮', '商品上架'] }],
  pet: { name: '小新', skin: 'xiaoxin', xp: 0, lv: 1, totalDone: 0, atlas: null, lastSeen: '' },
  settings: { bubbleInterval: 5000, idleMoves: true, alwaysOnTop: true, autoCheck: true, minimizedToPet: true, walkSpeed: 5, followMouse: true },
  meta: { schema: 4 },
};
let store = null;

function readStore() {
  for (const f of [storeFile, storeBak]) {
    try {
      if (!fs.existsSync(f)) continue;
      const raw = fs.readFileSync(f, 'utf8');
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object') return obj;
    } catch (e) { /* 损坏则尝试备份 */ }
  }
  return null;
}
function mergeDeep(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const k in over) {
    const v = over[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object'
      ? mergeDeep(base[k], v) : v;
  }
  return out;
}
function loadStore() {
  const found = readStore();
  store = found ? mergeDeep(DEFAULT_STORE, found) : JSON.parse(JSON.stringify(DEFAULT_STORE));
  // 旧版本存的是已下线的外观（guga/biscuit/kitsune/cinder/prism 或内置矢量色），
  // 统一迁到当前默认外观，否则设置面板里没有任何一项是高亮的。
  if (!KNOWN_SKINS.includes(store.pet.skin)) store.pet.skin = DEFAULT_STORE.pet.skin;
  // 旧版默认名跟已下线的宠物绑定（咕嘎/饼干/…），一并换掉；用户自定义的名字保留
  if (STALE_PET_NAMES.includes(store.pet.name)) store.pet.name = DEFAULT_STORE.pet.name;
  if (!found) saveStore();
  return store;
}
let saveTimer = null;
function saveStore() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const tmp = storeFile + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(store, null, 2), 'utf8');
      if (fs.existsSync(storeFile)) { try { fs.copyFileSync(storeFile, storeBak); } catch (e) {} }
      fs.renameSync(tmp, storeFile);
    } catch (e) { console.error('[store] save failed', e); }
  }, 120);
}
function flushStore() {
  clearTimeout(saveTimer);
  try { fs.writeFileSync(storeFile, JSON.stringify(store, null, 2), 'utf8'); } catch (e) {}
}

// ---------------------------------------------------------------- 窗口
let win = null, petWin = null, panelWin = null, settingsWin = null, tray = null;
let quitting = false;
let petBoundsCache = null;
// 宠物窗尺寸：宠物本体与主窗口内一致（98px），窗口只留出气泡与等级条的空间
const PET_W = 190, PET_H = 240;
const PET_HOME_Y = 172;
// 宠物窗内：宠物可见头顶在窗口坐标系里的 y。
// 各只外形的头顶留白差别很大，由 pet.html 实测后回传，这里只做初值。
let petHeadY = 121;
// 悬停任务面板
const PANEL_W = 340, PANEL_H = 520, PANEL_MIN_H = 90;

function createMain() {
  win = new BrowserWindow({
    width: 1000, height: 760, minWidth: 720, minHeight: 560,
    title: '牛来备忘录', backgroundColor: '#f5f5f7', autoHideMenuBar: true,
    icon: path.join(__dirname, 'build', 'icon.png'),
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.loadFile('index.html');
  win.once('ready-to-show', () => win.show());
  win.on('close', e => {
    if (quitting) return;
    e.preventDefault();
    if (store.settings.minimizedToPet === false) { quitting = true; flushStore(); app.quit(); return; }
    minimizeToPet();
  });
  // 最小化同样收到桌面宠物（与关闭一致）。'minimize' 不可取消，先还原再播放收缩动画。
  win.on('minimize', () => {
    if (quitting) return;
    if (store.settings.minimizedToPet === false) return;
    win.restore();
    setTimeout(() => minimizeToPet(), 0);
  });
  win.on('show', () => hidePanel());
}

function petDefaultPos() {
  const a = screen.getPrimaryDisplay().workArea;
  return { x: a.x + a.width - PET_W - 24, y: a.y + a.height - PET_H - 16 };
}

function createPet() {
  const saved = store.pet.pos;
  const d = petDefaultPos();
  let pos = saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) ? saved : d;
  // 尺寸改小过、或显示器换过，旧坐标可能落到屏幕外，夹回主屏可见区
  const area = screen.getPrimaryDisplay().workArea;
  if (pos.x < area.x - PET_W || pos.x > area.x + area.width + PET_W - 40 ||
      pos.y < area.y - PET_H || pos.y > area.y + area.height + PET_H - 40) pos = d;
  petWin = new BrowserWindow({
    width: PET_W, height: PET_H, x: Math.round(pos.x), y: Math.round(pos.y), useContentSize: true,
    frame: false, transparent: true, resizable: false, skipTaskbar: true,
    alwaysOnTop: store.settings.alwaysOnTop, hasShadow: false, show: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  petWin.loadFile('pet.html');
  petWin.setAlwaysOnTop(store.settings.alwaysOnTop, 'screen-saver');
  petWin.once('ready-to-show', () => petWin.showInactive());
  petWin.on('moved', () => {
    if (!petWin) return;
    const [x, y] = petWin.getPosition();
    store.pet.pos = { x, y };
    saveStore();
  });
  petWin.on('closed', () => { petWin = null; });
}

// 悬停面板是独立窗口，避免改动宠物窗尺寸（Windows 下 transparent + resizable:false 会忽略 setBounds）
function createPanel() {
  if (panelWin && !panelWin.isDestroyed()) return;
  panelWin = new BrowserWindow({
    width: PANEL_W, height: panelH, useContentSize: true,
    minWidth: PANEL_W, maxWidth: PANEL_W,
    frame: false, transparent: true, resizable: false, skipTaskbar: true,
    alwaysOnTop: true, hasShadow: false, show: false, focusable: false,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  panelWin.loadFile('panel.html');
  panelWin.setAlwaysOnTop(true, 'screen-saver');
  panelWin.on('closed', () => { panelWin = null; });
}

// 悬停任务面板：底边始终贴住宠物可见头顶（gap 固定 6px）。
// 头顶上方放不下时先把宠物整窗往下挪，屏幕太矮才退化成贴屏幕顶端。
function headYOf(pb) { return pb.y + petHeadY; }

function panelPosition(h) {
  const pb = petWin && !petWin.isDestroyed()
    ? petWin.getBounds()
    : { x: 0, y: 0, width: PET_W, height: PET_H };
  const disp = screen.getDisplayMatching(pb).workArea;
  // 面板底边离宠物头顶留的固定空隙。设得太小（<6）时面板阴影会压在头顶上，
  // 太大又显得"离头顶很远"，10 在 1.75 倍缩放下实测视觉间隙约 6px。
  const gap = 10;

  let y = headYOf(pb) - h - gap;
  if (y < disp.y + gap) {
    const shift = Math.min(disp.y + gap - y, disp.y + disp.height - (pb.y + pb.height + gap));
    if (shift > 0 && petWin && !petWin.isDestroyed()) {
      petWin.setBounds({ x: pb.x, y: Math.round(pb.y + shift), width: pb.width, height: pb.height });
      pb.y = Math.round(pb.y + shift);
      y = headYOf(pb) - h - gap;
    }
  }
  y = Math.max(disp.y + gap, Math.min(disp.y + disp.height - h - gap, y));

  let x = pb.x + pb.width / 2 - PANEL_W / 2;
  x = Math.max(disp.x + gap, Math.min(disp.x + disp.width - PANEL_W - gap, x));
  return { x: Math.round(x), y: Math.round(y) };
}

let panelH = PANEL_H;
function showPanel() {
  if (!panelWin || panelWin.isDestroyed()) createPanel();
  const p = panelPosition(panelH);
  panelWin.setBounds({ x: p.x, y: p.y, width: PANEL_W, height: panelH });
  panelWin.webContents.send('panel:refresh');
  // 先让页面播放"从下往上滑出"的动画，再显示窗口
  panelWin.webContents.send('panel:slide');
  panelWin.showInactive();
}
function hidePanel() {
  if (panelWin && !panelWin.isDestroyed()) panelWin.hide();
}
// 内容变高/变矮时，保持底边贴着头顶重新贴合
function resizePanel(h) {
  // 下限降到卡片实际需要的高度，否则只有一两条重要事项时会被撑出一大块空白、
  // 面板底边离头顶很远。
  const next = Math.max(PANEL_MIN_H, Math.min(PANEL_H, Math.round(h) || 0));
  if (next === panelH || !panelWin || panelWin.isDestroyed()) { panelH = next; return; }
  panelH = next;
  if (panelWin.isVisible()) {
    const p = panelPosition(panelH);
    panelWin.setBounds({ x: p.x, y: p.y, width: PANEL_W, height: panelH });
  }
}

// 悬停状态机：宠物窗与面板窗任一被悬停就保持展开。
// dragging 期间强制收起，松手后也不主动弹出，等鼠标重新进入宠物才恢复。
let hoverPet = false, hoverPanel = false, hideTimer = null, petDragging = false;
// 鼠标从宠物移到面板的途中必然会短暂离开两者，留一段宽限期再收起，
// 否则面板会在手还没点到"已完成"时就消失，导致按钮点不动。
const PANEL_LEAVE_GRACE = 700;
function syncPanel() {
  clearTimeout(hideTimer);
  const petShown = petWin && !petWin.isDestroyed() && petWin.isVisible();
  if (!petShown || petDragging) { hidePanel(); return; }
  if (hoverPet || hoverPanel) {
    hideTimer = setTimeout(() => { if ((hoverPet || hoverPanel) && !petDragging) showPanel(); }, 120);
  } else {
    hideTimer = setTimeout(() => {
      if (!hoverPet && !hoverPanel) hidePanel();
    }, PANEL_LEAVE_GRACE);
  }
}

// 收缩动画：主窗逐帧插值到宠物位置
function minimizeToPet() {
  if (!win || win.isDestroyed()) return;
  if (!petWin) createPet();
  const from = win.getBounds();
  const pb = petWin.getBounds();
  const to = { x: pb.x + pb.width / 2 - 6, y: pb.y + PET_HOME_Y - 6, width: 12, height: 12 };
  const dur = 260, t0 = Date.now();
  win.setResizable(false);
  const step = () => {
    if (!win || win.isDestroyed()) return;
    const t = Math.min(1, (Date.now() - t0) / dur);
    const e = 1 - Math.pow(1 - t, 3);
    win.setBounds({
      x: Math.round(from.x + (to.x - from.x) * e),
      y: Math.round(from.y + (to.y - from.y) * e),
      width: Math.max(12, Math.round(from.width + (to.width - from.width) * e)),
      height: Math.max(12, Math.round(from.height + (to.height - from.height) * e)),
    });
    if (t < 1) setTimeout(step, 12);
    else {
      win.hide();
      win.setBounds(from);
      win.setResizable(true);
      petBoundsCache = from;
      hidePanel();
      if (!petWin) createPet();
      else { petWin.showInactive(); petWin.webContents.send('pet:mode', 'floating'); }
    }
  };
  step();
}

function restoreMain() {
  if (!win) createMain();
  hidePanel();
  hoverPet = false; hoverPanel = false;
  const b = petBoundsCache || { width: 1000, height: 760 };
  win.setBounds(b);
  win.show();
  win.focus();
  if (petWin) { petWin.hide(); }
}
function toggleMain() {
  if (win && win.isVisible() && !win.isMinimized()) minimizeToPet();
  else restoreMain();
}

function createSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.show(); settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    width: 720, height: 620, minWidth: 620, minHeight: 520,
    title: '设置 · 牛来备忘录', backgroundColor: '#f5f5f7', autoHideMenuBar: true,
    parent: win && win.isVisible() ? win : undefined,
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  settingsWin.loadFile('settings.html');
  settingsWin.on('closed', () => { settingsWin = null; });
}

function createTray() {
  const ico = nativeImage.createFromPath(path.join(__dirname, 'build', 'icon.png')).resize({ width: 16, height: 16 });
  tray = new Tray(ico);
  tray.setToolTip('牛来备忘录');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: '显示主窗口', click: restoreMain },
    { label: '宠物悬浮桌面', click: minimizeToPet },
    { label: '设置…', click: createSettings },
    { type: 'separator' },
    { label: '检查更新', click: () => checkUpdate(true) },
    { type: 'separator' },
    { label: '退出', click: quitApp },
  ]));
  tray.on('double-click', toggleMain);
}

// ---------------------------------------------------------------- IPC
ipcMain.handle('store:get', () => store);
// 设置变更后即时应用到已存在的窗口（尤其是置顶开关，改完要立刻生效）
function applySettingsToWindows() {
  const top = store.settings.alwaysOnTop !== false;
  if (petWin && !petWin.isDestroyed()) petWin.setAlwaysOnTop(top, 'screen-saver');
  // 面板始终跟随宠物：宠物不置顶时，面板也不能压在别的窗口上
  if (panelWin && !panelWin.isDestroyed()) panelWin.setAlwaysOnTop(top, 'screen-saver');
}
ipcMain.handle('store:set', (_e, next) => {
  store = mergeDeep(DEFAULT_STORE, next || {});
  saveStore();
  applySettingsToWindows();
  broadcast('store:changed', store);
  return store;
});
ipcMain.handle('store:patch', (_e, patch) => {
  store = mergeDeep(store, patch || {});
  saveStore();
  applySettingsToWindows();
  broadcast('store:changed', store);
  return store;
});
function broadcast(ch, payload) {
  for (const w of [win, petWin, panelWin, settingsWin]) {
    if (w && !w.isDestroyed()) w.webContents.send(ch, payload);
  }
}
ipcMain.handle('win:minimize-to-pet', () => minimizeToPet());
ipcMain.handle('win:restore', () => restoreMain());
ipcMain.handle('win:open-settings', () => createSettings());
ipcMain.handle('win:pet-drag', (_e, on) => {
  if (!petWin) return;
  if (on) petWin.setIgnoreMouseEvents(false);
});
ipcMain.handle('pet:move-to', (_e, x, y) => { if (petWin) petWin.setPosition(Math.round(x), Math.round(y)); });
ipcMain.handle('pet:get-bounds', () => (petWin ? petWin.getBounds() : null));
ipcMain.handle('pet:hover', (_e, on) => { hoverPet = !!on; syncPanel(); });
// 宠物窗把当前可见头顶的窗口内 y 报上来（换外观 / 缩放后会变）
ipcMain.handle('pet:head-y', (_e, y) => {
  if (Number.isFinite(y) && y > 0) petHeadY = y;
  // 宠物在窗内漫步时头顶会上下浮动，面板必须每帧重新贴合，否则会忽远忽近。
  if (panelWin && !panelWin.isDestroyed() && panelWin.isVisible()) {
    const p = panelPosition(panelH);
    const b = panelWin.getBounds();
    if (b.x !== p.x || b.y !== p.y) panelWin.setBounds({ x: p.x, y: p.y, width: PANEL_W, height: panelH });
  }
});
// 拖动宠物：由主进程直接读系统光标位置来跟随。
// 渲染进程的 pointermove 在鼠标拖出这扇 190×240 的小窗后就收不到了，
// 靠它驱动窗口位置会导致"拖到一半就拖不动"。
let dragTimer = null, dragOff = null;
function stopPetDrag() {
  clearInterval(dragTimer);
  dragTimer = null;
  dragOff = null;
  petDragging = false;
}
function startPetDrag() {
  if (!petWin || petWin.isDestroyed()) return null;
  const [wx, wy] = petWin.getPosition();
  const cur = screen.getCursorScreenPoint();
  dragOff = { dx: cur.x - wx, dy: cur.y - wy };
  petDragging = true;
  clearTimeout(hideTimer);
  hidePanel();
  clearInterval(dragTimer);
  let lastX = wx, lastY = wy;
  dragTimer = setInterval(() => {
    if (!petWin || petWin.isDestroyed()) { stopPetDrag(); return; }
    const p = screen.getCursorScreenPoint();
    const nx = Math.round(p.x - dragOff.dx), ny = Math.round(p.y - dragOff.dy);
    if (nx === lastX && ny === lastY) return;
    lastX = nx; lastY = ny;
    petWin.setPosition(nx, ny);
  }, 12);
  return { x: wx, y: wy };
}
ipcMain.handle('pet:drag-start', () => startPetDrag());
ipcMain.handle('pet:drag-end', () => { stopPetDrag(); });
// 兼容旧调用：true 只收起面板，实际跟随由 drag-start 接管
ipcMain.handle('pet:drag', (_e, on) => {
  petDragging = !!on;
  if (petDragging) { clearTimeout(hideTimer); hidePanel(); }
});
ipcMain.handle('panel:hover', (_e, on) => { hoverPanel = !!on; syncPanel(); });
ipcMain.handle('panel:hide', () => { hoverPanel = false; hidePanel(); });
ipcMain.handle('panel:size', (_e, h) => resizePanel(h));
// 面板内"显示窗口"按钮 / 单击宠物 -> 回主窗口
ipcMain.handle('win:show-main', () => restoreMain());
// 悬浮宠物右键：打开主窗口 / 设置 / 真正退出
ipcMain.handle('pet:context-menu', () => {
  const winShown = !!(win && !win.isDestroyed() && win.isVisible() && !win.isMinimized());
  const menu = Menu.buildFromTemplate([
    { label: '打开牛来备忘录', click: restoreMain },
    { label: winShown ? '收回到桌面宠物' : '隐藏到桌面宠物', enabled: winShown, click: minimizeToPet },
    { label: '设置…', click: createSettings },
    { type: 'separator' },
    { label: '检查更新', click: () => checkUpdate(true) },
    { type: 'separator' },
    { label: '退出程序', click: quitApp },
  ]);
  menu.popup({ window: petWin && !petWin.isDestroyed() ? petWin : undefined });
});
ipcMain.handle('app:quit', () => quitApp());
ipcMain.handle('app:version', () => VERSION);
ipcMain.handle('app:open-external', (_e, url) => shell.openExternal(url));

function quitApp() {
  quitting = true;
  flushStore();
  app.quit();
}

// 数据导入导出
ipcMain.handle('data:export', async () => {
  const r = await dialog.showSaveDialog(win || settingsWin, {
    title: '导出数据', defaultPath: `niulai-backup-${new Date().toISOString().slice(0, 10)}.json`,
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePath) return { ok: false };
  fs.writeFileSync(r.filePath, JSON.stringify(store, null, 2), 'utf8');
  return { ok: true, path: r.filePath };
});
ipcMain.handle('data:import', async () => {
  const r = await dialog.showOpenDialog(win || settingsWin, {
    title: '导入数据', properties: ['openFile'], filters: [{ name: 'JSON', extensions: ['json'] }],
  });
  if (r.canceled || !r.filePaths[0]) return { ok: false };
  try {
    const obj = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    store = mergeDeep(DEFAULT_STORE, obj);
    saveStore();
    broadcast('store:changed', store);
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
});
ipcMain.handle('data:reset', () => {
  store = JSON.parse(JSON.stringify(DEFAULT_STORE));
  saveStore();
  broadcast('store:changed', store);
  return store;
});

// ---------------------------------------------------------------- 自动更新
// portable exe 运行时不锁原文件，PORTABLE_EXECUTABLE_FILE 指向它，可直接替换。
const UPDATE_BASE = process.env.NIULAI_UPDATE_BASE || `https://github.com/${REPO}/releases/latest/download`;
const manifestUrl = `${UPDATE_BASE}/update.json`;

function cmpVer(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}
// 走 Electron net，跟随系统代理设置（Node 的 https 不认 Windows 系统代理，
// 在国内/公司网络下会 ETIMEDOUT）。
// 更新器网络层。不能用裸 https：Node 不认 Windows 系统代理，国内会 ETIMEDOUT。
// 也不用 Electron net：实测走系统代理只有 ~16 KB/s（114 MB 要两小时），
// 而自己开 CONNECT 隧道能跑 2 MB/s。所以从 session.resolveProxy 读系统代
// 理地址，自己建隧道；没有代理时直连。
const httpMod = require('http');
const httpsMod = require('https');
const tlsMod = require('tls');
const { URL } = require('url');

let proxyAddr; // null = 直连（已探测）
async function resolveProxy() {
  if (proxyAddr !== undefined) return proxyAddr;
  try {
    const p = await new Promise(r => session.defaultSession.resolveProxy('https://github.com'));
    const m = /PROXY\s+([^;\s]+)/i.exec(p || '');
    proxyAddr = m ? m[1] : null;
  } catch (e) {
    proxyAddr = null;
  }
  return proxyAddr;
}

function openTunnel(host, port) {
  return new Promise((resolve, reject) => {
    resolveProxy().then(addr => {
      if (!addr) return resolve(null); // 直连
      const [ph, pp] = addr.split(':');
      const req = httpMod.request({
        host: ph, port: Number(pp) || 80, method: 'CONNECT',
        path: `${host}:${port}`, headers: { Host: `${host}:${port}` },
      });
      req.on('connect', (res, socket, head) => {
        if (res.statusCode !== 200) return reject(new Error('代理返回 ' + res.statusCode));
        if (head && head.length) socket.unshift(head);
        resolve(socket);
      });
      req.on('error', reject);
      req.end();
    }).catch(reject);
  });
}

// 发一个 GET，自动跟随重定向，返回 IncomingMessage
async function request(url, depth = 0) {
  const u = new URL(url);
  const sock = await openTunnel(u.hostname, Number(u.port) || 443);
  return new Promise((resolve, reject) => {
    const opts = {
      host: u.hostname,
      path: u.pathname + u.search,
      headers: { Host: u.hostname, 'User-Agent': `niulai-memo/${VERSION}` },
      agent: false,
    };
    if (sock) {
      opts.socket = sock;
      opts.servername = u.hostname;
      opts.createConnection = () => tlsMod.connect({ socket: sock, servername: u.hostname });
    }
    const req = httpsMod.request(opts, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && depth < 6) {
        res.resume();
        return resolve(request(new URL(res.headers.location, url).href, depth + 1));
      }
      resolve(res);
    });
    req.on('error', reject);
    req.end();
  });
}
async function getJSON(url) {
  const res = await request(url);
  if (res.statusCode !== 200) { res.resume(); throw new Error('HTTP ' + res.statusCode); }
  res.setEncoding('utf8');
  let body = '';
  res.on('data', c => body += c);
  await new Promise((res2, rej2) => { res.on('end', res2); res.on('error', rej2); });
  return JSON.parse(body);
}
async function download(url, dest, onProgress) {
  const res = await request(url);
  if (res.statusCode !== 200) { res.resume(); throw new Error('HTTP ' + res.statusCode); }
  const total = Number(res.headers['content-length'] || 0);
  let got = 0;
  const out = fs.createWriteStream(dest);
  res.on('data', c => {
    got += c.length;
    if (total && onProgress) onProgress(Math.round(got / total * 100));
  });
  res.pipe(out);
  await new Promise((res2, rej2) => {
    out.on('finish', () => out.close(res2));
    out.on('error', rej2);
    res.on('error', rej2);
  });
  return { size: got };
}
const sha256 = f => new Promise((res, rej) => {
  const h = crypto.createHash('sha256');
  const s = fs.createReadStream(f);
  s.on('data', d => h.update(d));
  s.on('end', () => res(h.digest('hex')));
  s.on('error', rej);
});

let updateBusy = false;
async function checkUpdate(manual = false) {
  if (updateBusy) return { status: 'busy' };
  updateBusy = true;
  const notify = (stage, extra = {}) => broadcast('update:progress', { stage, current: VERSION, ...extra });
  try {
    notify('checking');
    const m = await getJSON(manifestUrl + '?t=' + Date.now());
    if (!m || !m.version) throw new Error('清单格式不正确');
    if (cmpVer(m.version, VERSION) <= 0) {
      notify('latest', { latest: m.version });
      if (manual) dialog.showMessageBox(win || settingsWin, { type: 'info', title: '检查更新', message: `已是最新版本 v${VERSION}` });
      return { status: 'latest', version: VERSION };
    }
    if (m.minVersion && cmpVer(VERSION, m.minVersion) < 0) {
      notify('blocked', { latest: m.version });
      return { status: 'blocked', message: `当前版本过低，请手动下载 v${m.version}` };
    }
    notify('found', { latest: m.version, notes: m.notes || '' });
    const exePath = process.env.PORTABLE_EXECUTABLE_FILE || app.getPath('exe');
    const target = path.join(os.tmpdir(), `niulai-update-${m.version}.exe`);
    if (fs.existsSync(target)) fs.unlinkSync(target);
    notify('downloading', { latest: m.version, pct: 0 });
    await download(m.url, target, pct => notify('downloading', { latest: m.version, pct }));
    if (m.sha256) {
      const got = await sha256(target);
      if (got.toLowerCase() !== String(m.sha256).toLowerCase()) {
        fs.unlinkSync(target);
        throw new Error('校验失败，文件可能损坏');
      }
    }
    notify('ready', { latest: m.version });
    applyUpdate(target, exePath, m.version);
    return { status: 'installing', version: m.version };
  } catch (e) {
    notify('error', { message: String(e.message || e) });
    if (manual) dialog.showMessageBox(win || settingsWin, { type: 'error', title: '检查更新失败', message: String(e.message || e) });
    return { status: 'error', message: String(e.message || e) };
  } finally {
    updateBusy = false;
  }
}

// 等待当前 PID 退出后替换 exe 的批处理。
// 所有路径通过环境变量传入（环境变量是 UTF-16，不受控制台代码页影响）；
// bat 正文必须是纯 ASCII —— 中文路径直接写进 bat 在 GBK 代码页下会解析失败。
function applyUpdate(newExe, curExe, version) {
  const pid = process.pid;
  const bak = curExe + '.bak';
  const bat = path.join(os.tmpdir(), `niulai-apply-${version}.bat`);
  const log = path.join(os.tmpdir(), 'niulai-update-error.log');
  const lines = [
    '@echo off',
    'setlocal',
    ':wait',
    `tasklist /FI "PID eq %NIU_PID%" 2>nul | find "%NIU_PID%" >nul`,
    'if not errorlevel 1 (',
    '  timeout /t 1 /nobreak >nul',
    '  goto wait',
    ')',
    'rem portable 外壳进程可能比子进程晚一步退出，还锁着 exe；重试替换',
    'set TRY=0',
    ':mv1',
    'timeout /t 1 /nobreak >nul',
    'move /y "%NIU_CUR%" "%NIU_BAK%" >nul 2>&1',
    'if not errorlevel 1 goto mv2',
    'set /a TRY+=1',
    'if %TRY% lss 90 goto mv1',
    'echo Update failed, rolled back.>"%NIU_LOG%"',
    'del /f /q "%~f0" >nul 2>&1',
    'exit /b 1',
    ':mv2',
    'move /y "%NIU_NEW%" "%NIU_CUR%" >nul 2>&1',
    'if not errorlevel 1 goto ok',
    'move /y "%NIU_BAK%" "%NIU_CUR%" >nul 2>&1',
    'echo Update failed, rolled back.>"%NIU_LOG%"',
    'del /f /q "%~f0" >nul 2>&1',
    'exit /b 1',
    ':ok',
    'start "" "%NIU_CUR%"',
    'timeout /t 4 /nobreak >nul',
    'del /f /q "%NIU_BAK%" >nul 2>&1',
    'del /f /q "%~f0" >nul 2>&1',
  ];
  fs.writeFileSync(bat, lines.join('\r\n'), 'ascii');
  quitting = true;
  flushStore();
  const env = {
    ...process.env,
    NIU_PID: String(pid),
    NIU_NEW: newExe,
    NIU_CUR: curExe,
    NIU_BAK: bak,
    NIU_LOG: log,
  };
  const cp = require('child_process').spawn('cmd.exe', ['/c', bat], { env, detached: true, stdio: 'ignore', windowsHide: true });
  cp.unref();
  setTimeout(() => app.quit(), 300);
}

ipcMain.handle('update:check', (_e, manual) => checkUpdate(!!manual));
ipcMain.handle('update:apply-now', () => checkUpdate(true));

// ---------------------------------------------------------------- 生命周期
app.requestSingleInstanceLock();
app.on('second-instance', () => restoreMain());

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  loadStore();
  createMain();
  createTray();
  if (store.settings.autoCheck) {
    setTimeout(() => checkUpdate(false), 8000);
    setInterval(() => checkUpdate(false), 6 * 3600 * 1000);
  }
});
app.on('before-quit', () => { quitting = true; flushStore(); });
app.on('window-all-closed', () => { if (quitting) app.quit(); });
app.on('activate', () => restoreMain());
