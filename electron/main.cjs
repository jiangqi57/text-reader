// electron/main.js
const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 920,
    minWidth: 700,
    minHeight: 700,
    autoHideMenuBar: true,
    title: 'TXT Reader',
    webPreferences: {
      // 保持 contextIsolation 为 true 是安全的做法
      contextIsolation: true,
      nodeIntegration: false,
      // 如果后续想用原生 Node.js 读文件，建议在这里引入 Preload 脚本
    },
  });

  if (app.isPackaged) {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  } else {
    win.loadURL('http://localhost:5173');
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // 这样关闭窗口时，后台服务器进程（Electron 进程）会彻底退出
  if (process.platform !== 'darwin') app.quit();
});