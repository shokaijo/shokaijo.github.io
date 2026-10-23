// 画面を手元で試すためのサーバー。docs/ を配り、/api を模擬の Apps Script につなぐ。
// node test/dev-server.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { createEnv } = require('./gas-mock');

const port = Number(process.argv[2] || 8787);
const root = path.join(__dirname, '..', 'docs');
const env = createEnv();
env.sandbox.setup();
env.sheets['設定'].data.find((r) => r[0] === '画面のURL')[1] = `http://localhost:${port}/`;
const link = env.sandbox.addReferrer('紹介する人A', '店');
const refId = link.split('r=')[1];
const codes = Object.fromEntries(env.sheets['店'].data.slice(1).map((r) => [r[0], r[6]]));
fs.writeFileSync(path.join(__dirname, 'dev-state.json'), JSON.stringify({ refId, codes, link }, null, 2));

const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  if (url.pathname === '/api') {
    const send = (out) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(out.text); };
    if (req.method === 'GET') return send(env.sandbox.doGet({ parameter: Object.fromEntries(url.searchParams) }));
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => send(env.sandbox.doPost({ postData: { contents: body } })));
    return;
  }
  if (url.pathname === '/config.js') {
    res.writeHead(200, { 'Content-Type': types['.js'] });
    return res.end("window.SHOKAIJO_API = '/api';");
  }
  if (url.pathname === '/__state') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ refId, codes, letters: env.sheets['紹介状'].data }));
  }
  const file = path.join(root, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!file.startsWith(root) || !fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(port, () => console.log(`http://localhost:${port}/?r=${refId}`));
