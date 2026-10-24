// 宠物渲染探针：逐个皮肤加载图集，确认帧切分正确
const { app, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');

const APP = path.join(__dirname, '..', 'app');
const OUT = path.join(__dirname, '..', '.tmp', 'probe');

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const win = new BrowserWindow({
    width: 1000, height: 760, show: false,
    webPreferences: { preload: path.join(APP, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  await win.loadFile(path.join(APP, 'index.html'));
  win.webContents.on('console-message', (_e, lvl, msg) => console.log('[console]', lvl, msg));
  await new Promise(r => setTimeout(r, 2500));
  const diag = await win.webContents.executeJavaScript(`({petType: typeof pet, petNull: pet===null, hasPC: typeof PetCanvas, hasPre: typeof preloadPetSkins})`);
  console.log('DIAG', JSON.stringify(diag));

  const skins = ['guga', 'biscuit', 'kitsune', 'cinder', 'prism'];
  const report = [];
  for (const skin of skins) {
    const r = await win.webContents.executeJavaScript(`(async () => {
      pet.setSkin('${skin}');
      pet.setState('idle');
      pet.x = 300; pet.y = 300; pet.tx = 300; pet.ty = 300;
      await new Promise(r => setTimeout(r, 900));
      const s = pet.sheet;
      return {
        skin: '${skin}',
        ready: !!(s && s.ready), error: !!(s && s.error),
        cw: s && s.cw, ch: s && s.ch, rows: s && s.rows,
        imgW: s && s.img.naturalWidth, imgH: s && s.img.naturalHeight,
        row: pet.rowForSprite(),
      };
    })()`);
    report.push(r);
    const png = await win.webContents.capturePage({ x: 240, y: 240, width: 140, height: 140 });
    fs.writeFileSync(path.join(OUT, skin + '.png'), png.toPNG());
  }
  console.log('PROBE ' + JSON.stringify(report));
  app.quit();
});
