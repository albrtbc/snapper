const { pathToFileURL } = require('node:url');

// Only registered local top-level documents may call the preload API.
// Window identity alone would also admit messages from its child frames.
function createSecureIpc(ipcMain) {
  const documents = new Map();
  function registerWindow(win, file, role) {
    const contents = win.webContents;
    documents.set(contents, { url: pathToFileURL(file).href, role });
    contents.once('destroyed', () => documents.delete(contents));
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    for (const event of ['will-navigate', 'will-frame-navigate', 'will-attach-webview']) {
      contents.on(event, (event) => event.preventDefault());
    }
    contents.session.setPermissionRequestHandler((_contents, _permission, callback) =>
      callback(false),
    );
    contents.session.setPermissionCheckHandler(() => false);
  }
  function allowed(event, roles) {
    const document = documents.get(event.sender);
    if (!document || !event.senderFrame || event.senderFrame !== event.sender.mainFrame)
      return false;
    if (!roles.includes(document.role)) return false;
    try {
      const url = new URL(event.senderFrame.url);
      url.search = '';
      url.hash = '';
      return url.href === document.url;
    } catch {
      return false;
    }
  }
  const allRoles = ['overlay', 'settings'];
  return {
    registerWindow,
    handle(channel, handler, roles = allRoles) {
      ipcMain.handle(channel, (event, ...args) => {
        if (!allowed(event, roles)) throw new Error('Untrusted IPC sender');
        return handler(event, ...args);
      });
    },
    on(channel, handler, roles = ['overlay']) {
      ipcMain.on(channel, (event, ...args) => {
        if (allowed(event, roles)) handler(event, ...args);
      });
    },
  };
}
module.exports = { createSecureIpc };
