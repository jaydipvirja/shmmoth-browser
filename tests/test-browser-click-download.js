/**
 * TEST: Real click inside WebContentsView tab to test browser download behavior
 */
const http = require('http');
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, WebContentsView, session } = require('electron');
const StorageService = require('../src/services/storage');
const DownloadManager = require('../src/services/downloadManager');

const PORT = 47890;
let server;

function startServer() {
  return new Promise(resolve => {
    server = http.createServer((req, res) => {
      console.log(`[HTTP REQ] ${req.method} ${req.url}`);
      if (req.url === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
          <!DOCTYPE html>
          <html>
          <body>
            <h1>Download Test Page</h1>
            <!-- Direct link -->
            <a id="link-direct" href="/file-direct.zip">Direct Link</a><br><br>
            <!-- Target blank link -->
            <a id="link-target-blank" href="/file-blank.zip" target="_blank">Target Blank Link</a><br><br>
            <!-- JS location href -->
            <button id="btn-js" onclick="window.location.href='/file-js.zip'">JS Location</button><br><br>
            <!-- JS window.open -->
            <button id="btn-open" onclick="window.open('/file-window-open.zip')">Window Open</button><br><br>
            <!-- Blob link -->
            <a id="link-blob" download="blob-file.txt">Blob Link</a>
            <script>
              const b = new Blob(['blob content'], { type: 'text/plain' });
              document.getElementById('link-blob').href = URL.createObjectURL(b);
            </script>
          </body>
          </html>
        `);
        return;
      }

      if (req.url.startsWith('/file-')) {
        const name = req.url.slice(1);
        const data = Buffer.alloc(1024 * 50, 'FILE DATA ');
        res.writeHead(200, {
          'Content-Type': 'application/zip',
          'Content-Length': data.length,
          'Content-Disposition': `attachment; filename="${name}"`
        });
        res.end(data);
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    });

    server.listen(PORT, resolve);
  });
}

app.whenReady().then(async () => {
  await startServer();

  const storage = new StorageService();
  const dm = new DownloadManager(storage);
  const downloadedFiles = [];

  dm.attach(session.defaultSession, (rec) => {
    console.log(`[DOWNLOAD UPDATE] ${rec.filename}: ${rec.state} (${rec.received}/${rec.total})`);
    if (rec.state === 'completed') {
      downloadedFiles.push(rec);
    }
  });

  const win = new BrowserWindow({
    width: 800,
    height: 600,
    show: false
  });

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 800, height: 600 });

  const wc = view.webContents;

  // Let's attach our exact main.js handlers on wc!
  wc.on('will-navigate', (event, navUrl) => {
    console.log(`[MAIN: will-navigate] ${navUrl}`);
  });

  wc.setWindowOpenHandler(({ url, disposition }) => {
    console.log(`[MAIN: setWindowOpenHandler] url=${url} disposition=${disposition}`);
    // Simulate what main.js does:
    if (disposition === 'foreground-tab' || disposition === 'background-tab' || disposition === 'new-window') {
      console.log(`[MAIN: setWindowOpenHandler creating new tab for] ${url}`);
      // In main.js: this.createTab(url)
      const newView = new WebContentsView({ webPreferences: { contextIsolation: true, nodeIntegration: false } });
      newView.webContents.loadURL(url).catch(e => console.log(`[NEW TAB LOAD ERR] ${e.message}`));
      return { action: 'deny' };
    }
    return { action: 'deny' };
  });

  console.log('Loading test page...');
  await wc.loadURL(`http://127.0.0.1:${PORT}/`);
  console.log('Test page loaded!');

  // Test 1: Click Direct Link
  console.log('\n--- Clicking Direct Link ---');
  await wc.executeJavaScript('document.getElementById("link-direct").click()');
  await new Promise(r => setTimeout(r, 1000));

  // Test 2: Click Target Blank Link
  console.log('\n--- Clicking Target Blank Link ---');
  await wc.executeJavaScript('document.getElementById("link-target-blank").click()');
  await new Promise(r => setTimeout(r, 1000));

  // Test 3: Click JS Location
  console.log('\n--- Clicking JS Location Button ---');
  await wc.executeJavaScript('document.getElementById("btn-js").click()');
  await new Promise(r => setTimeout(r, 1000));

  // Test 4: Click Window Open Button
  console.log('\n--- Clicking Window Open Button ---');
  await wc.executeJavaScript('document.getElementById("btn-open").click()');
  await new Promise(r => setTimeout(r, 1000));

  // Test 5: Click Blob Link
  console.log('\n--- Clicking Blob Link ---');
  await wc.executeJavaScript('document.getElementById("link-blob").click()');
  await new Promise(r => setTimeout(r, 1000));

  console.log('\n--- SUMMARY ---');
  console.log(`Total completed downloads: ${downloadedFiles.length}`);
  downloadedFiles.forEach(f => console.log(`  - ${f.filename} (${f.savePath})`));

  server.close();
  app.exit(0);
});
