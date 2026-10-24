// CDP 探针：启动真实 app（main.js 全量 IPC），连 remote-debugging 端口注入 JS。
// 用法： node scripts/probe-cdp.js <脚本文件>   —— 脚本文件内容是待执行的 JS 表达式
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const APP = path.join(ROOT, 'app');
const PORT = 9222;

const scriptFile = process.argv[2];
const code = scriptFile ? fs.readFileSync(scriptFile, 'utf8') : '1';

const electronBin = require(path.join(APP, 'node_modules', 'electron'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electronBin, ['.', `--remote-debugging-port=${PORT}`], {
  cwd: APP, stdio: ['ignore', 'pipe', 'pipe'], env,
});
child.stdout.on('data', d => process.stdout.write('[app] ' + d));
child.stderr.on('data', d => process.stdout.write('[app!] ' + d));

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function targets() {
  const r = await fetch(`http://127.0.0.1:${PORT}/json/list`);
  return r.json();
}

async function main() {
  let list = [];
  for (let i = 0; i < 60; i++) {
    try { list = await targets(); if (list.some(t => t.type === 'page')) break; } catch (e) {}
    await sleep(500);
  }
  const page = list.find(t => t.type === 'page' && new RegExp(process.env.PAGE || 'index\\.html').test(t.url));
  if (!page) { console.log('NO_PAGE', JSON.stringify(list.map(t => t.url))); return; }
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  ws.onmessage = ev => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    else if (m.method === 'Runtime.consoleAPICalled') {
      console.log('[console]', m.params.args.map(a => a.value ?? a.description).join(' '));
    } else if (m.method === 'Runtime.exceptionThrown') {
      console.log('[exception]', m.params.exceptionDetails.text,
        m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description);
    }
  };
  const send = (method, params = {}) => new Promise(res => {
    const mid = ++id;
    pending.set(mid, res);
    ws.send(JSON.stringify({ id: mid, method, params }));
  });
  await new Promise(r => ws.onopen = r);
  await send('Runtime.enable');
  await sleep(1800);

  const r = await send('Runtime.evaluate', {
    expression: `(async () => { ${code} })()`,
    awaitPromise: true, returnByValue: true,
  });
  if (r.result && r.result.exceptionDetails) {
    console.log('THROWN', JSON.stringify(r.result.exceptionDetails).slice(0, 600));
  } else {
    console.log('RESULT ' + JSON.stringify(r.result && r.result.result && r.result.result.value));
  }

  // 截图（可选）
  if (process.env.SHOT) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    if (shot.result && shot.result.data) {
      fs.writeFileSync(process.env.SHOT, Buffer.from(shot.result.data, 'base64'));
      console.log('SHOT ' + process.env.SHOT);
    }
  }
  ws.close();

  // 第二窗口截图：SHOT_PAGE=正则 SHOT2=文件 [CODE2=脚本]
  if (process.env.SHOT_PAGE) {
    await sleep(500);
    const l2 = await targets();
    const p2 = l2.find(t => t.type === 'page' && new RegExp(process.env.SHOT_PAGE).test(t.url));
    if (!p2) { console.log('NO_PAGE2', JSON.stringify(l2.map(t => t.url))); return; }
    const ws2 = new WebSocket(p2.webSocketDebuggerUrl);
    let id2 = 0;
    const pend2 = new Map();
    ws2.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pend2.has(m.id)) { pend2.get(m.id)(m); pend2.delete(m.id); }
      else if (m.method === 'Runtime.consoleAPICalled') {
        console.log('[console2]', m.params.args.map(a => a.value ?? a.description).join(' '));
      }
    };
    const send2 = (method, params = {}) => new Promise(res => {
      const mid = ++id2; pend2.set(mid, res);
      ws2.send(JSON.stringify({ id: mid, method, params }));
    });
    await new Promise(r => ws2.onopen = r);
    await send2('Runtime.enable');
    await sleep(1500);
    if (process.env.CODE2) {
      const code2 = fs.readFileSync(process.env.CODE2, 'utf8');
      const r2 = await send2('Runtime.evaluate', { expression: `(async () => { ${code2} })()`, awaitPromise: true, returnByValue: true });
      console.log('RESULT2 ' + JSON.stringify(r2.result && r2.result.result && r2.result.result.value));
    }
    if (process.env.SHOT2) {
      const s2 = await send2('Page.captureScreenshot', { format: 'png' });
      if (s2.result && s2.result.data) {
        fs.writeFileSync(process.env.SHOT2, Buffer.from(s2.result.data, 'base64'));
        console.log('SHOT2 ' + process.env.SHOT2);
      }
    }
    ws2.close();
  }
}

main()
  .catch(e => console.log('PROBE_ERROR', e.message))
  .finally(() => { try { child.kill(); } catch (e) {} setTimeout(() => process.exit(0), 400); });
