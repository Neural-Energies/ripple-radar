/**
 * Ripple Radar window. Hosts the desk on 127.0.0.1 and never opens a console.
 * The server is Electron itself with ELECTRON_RUN_AS_NODE, so Windows does not
 * allocate a console for a second node.exe. Desk data lives in userData,
 * outside the install directory, so an update does not wipe it.
 */
const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const APP_NAME = "Ripple Radar";

let server = null;
let mainWindow = null;
let updater = null;
let downloaded = false;
let installWhenReady = false;
let updateState = {
  state: "none",
  current: "0.0.0",
  latest: null,
  message: "No published release yet. This copy stays as it is.",
};

function logLine(name, line) {
  try {
    fs.mkdirSync(app.getPath("userData"), { recursive: true });
    fs.appendFileSync(path.join(app.getPath("userData"), name), `${line}\n`);
  } catch {
    // A log failure must not take the window down.
  }
}

function serverEntry() {
  const packaged = path.join(process.resourcesPath, "output", "server", "index.mjs");
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(__dirname, "..", ".output", "server", "index.mjs");
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1", () => {
      const addr = probe.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      probe.close(() => resolve(port));
    });
    probe.on("error", reject);
  });
}

function waitForHttp(port, timeoutMs = 60_000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ hostname: "127.0.0.1", port, path: "/", timeout: 1500 }, (res) => {
        res.resume();
        if ((res.statusCode ?? 500) < 500) resolve();
        else retry();
      });
      const retry = () => {
        if (Date.now() - start > timeoutMs) reject(new Error("The local desk did not start. See server.log in the app data folder."));
        else setTimeout(tick, 300);
      };
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    tick();
  });
}

function startServer(port) {
  const entry = serverEntry();
  if (!fs.existsSync(entry)) {
    throw new Error(`Desk server is missing (${entry}).`);
  }
  const dataRoot = app.getPath("userData");
  const pglite = path.join(dataRoot, "pglite");
  fs.mkdirSync(pglite, { recursive: true });
  const env = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    HOST: "127.0.0.1",
    PORT: String(port),
    NITRO_HOST: "127.0.0.1",
    NITRO_PORT: String(port),
    NODE_ENV: "production",
    PGLITE_DATA_DIR: pglite,
  };
  server = spawn(process.execPath, [entry], {
    env,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const write = (buf) => logLine("server.log", String(buf).trimEnd());
  server.stdout.on("data", write);
  server.stderr.on("data", write);
  server.on("exit", (code) => logLine("server.log", `[desktop] server exited ${code}`));
}

function stopServer() {
  if (!server || server.killed) return;
  try {
    server.kill();
  } catch {
    // Already gone.
  }
  server = null;
}

function sendStatus() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("desktop:update-status", updateState);
  }
}

function noRelease(message) {
  return /404|no published|not found|latest.yml|HttpError: 404/i.test(message);
}

function attachUpdater() {
  let autoUpdater;
  try {
    ({ autoUpdater } = require("electron-updater"));
  } catch (err) {
    updateState = {
      state: "error",
      current: app.getVersion(),
      latest: null,
      message: err instanceof Error ? err.message : "Updater is not packaged.",
    };
    return null;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = {
    info: (m) => logLine("update-check.log", `[info] ${m}`),
    warn: (m) => logLine("update-check.log", `[warn] ${m}`),
    error: (m) => logLine("update-check.log", `[error] ${m}`),
    debug: (m) => logLine("update-check.log", `[debug] ${m}`),
  };
  autoUpdater.on("update-available", (info) => {
    updateState = {
      state: "available",
      current: app.getVersion(),
      latest: info?.version ?? null,
      message: `Version ${info?.version ?? ""} is published. This copy is ${app.getVersion()}.`,
    };
    logLine("update-check.log", updateState.message);
    sendStatus();
  });
  autoUpdater.on("update-not-available", () => {
    updateState = {
      state: "current",
      current: app.getVersion(),
      latest: app.getVersion(),
      message: `This copy is ${app.getVersion()}, the latest published release.`,
    };
    logLine("update-check.log", updateState.message);
    sendStatus();
  });
  autoUpdater.on("error", (err) => {
    const message = err && err.message ? err.message : "Update check failed.";
    updateState = noRelease(message)
      ? {
          state: "none",
          current: app.getVersion(),
          latest: null,
          message: "No published release yet. This copy stays as it is.",
        }
      : {
          state: "error",
          current: app.getVersion(),
          latest: updateState.latest,
          message,
        };
    logLine("update-check.log", `[result] ${updateState.state} ${updateState.message}`);
    sendStatus();
  });
  autoUpdater.on("download-progress", (progress) => {
    const pct = Math.round(progress?.percent ?? 0);
    updateState = { ...updateState, state: "available", message: `Downloading ${pct}%…` };
    sendStatus();
  });
  autoUpdater.on("update-downloaded", () => {
    downloaded = true;
    updateState = {
      ...updateState,
      state: "available",
      message: "Update downloaded. Restarting to install. Your desk data stays in place.",
    };
    logLine("update-check.log", updateState.message);
    sendStatus();
    if (installWhenReady) setImmediate(() => autoUpdater.quitAndInstall(false, true));
  });
  return autoUpdater;
}

async function checkForUpdates() {
  updateState = { ...updateState, current: app.getVersion() };
  logLine("update-check.log", `[check] ${new Date().toISOString()} version ${app.getVersion()} packaged=${app.isPackaged}`);
  if (!app.isPackaged) {
    updateState = {
      state: "none",
      current: app.getVersion(),
      latest: null,
      message: "Updates install from a published GitHub Release. This window is not an installed copy.",
    };
    logLine("update-check.log", updateState.message);
    sendStatus();
    return updateState;
  }
  if (!updater) updater = attachUpdater();
  if (!updater) {
    sendStatus();
    return updateState;
  }
  try {
    await updater.checkForUpdates();
  } catch (err) {
    const message = err instanceof Error ? err.message : "Update check failed.";
    if (updateState.state !== "available" && updateState.state !== "current") {
      updateState = noRelease(message)
        ? { state: "none", current: app.getVersion(), latest: null, message: "No published release yet. This copy stays as it is." }
        : { state: "error", current: app.getVersion(), latest: null, message };
    }
    logLine("update-check.log", `[result] ${updateState.state} ${updateState.message}`);
  }
  return updateState;
}

async function installUpdate() {
  if (!app.isPackaged) {
    return {
      state: "none",
      current: app.getVersion(),
      latest: null,
      message: "Install the Windows app to update in place. This window is not an installed copy.",
    };
  }
  if (!updater) updater = attachUpdater();
  if (!updater) return updateState;
  installWhenReady = true;
  if (downloaded) {
    updater.quitAndInstall(false, true);
    return updateState;
  }
  if (updateState.state !== "available") await checkForUpdates();
  if (updateState.state !== "available") return updateState;
  updateState = { ...updateState, message: "Downloading the update…" };
  sendStatus();
  await updater.downloadUpdate();
  return updateState;
}

function errorPage(message) {
  const safe = String(message).replace(/[&<>]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[ch]);
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${APP_NAME}</title></head>
<body style="margin:0;background:#f5f7fa;color:#0d1726;font-family:Segoe UI,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center">
<main style="max-width:32rem;padding:2rem;text-align:center">
<h1 style="font-size:1.25rem;font-weight:600">${APP_NAME} could not open the desk</h1>
<p style="color:#44536b">${safe}</p>
<p style="color:#44536b">Your data is still in the app data folder. Close this window and open Ripple Radar again.</p>
</main></body></html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function createWindow() {
  const icon = path.join(__dirname, "build", "icon.png");
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    title: APP_NAME,
    backgroundColor: "#f5f7fa",
    show: false,
    autoHideMenuBar: true,
    icon: fs.existsSync(icon) ? icon : undefined,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  try {
    const port = await freePort();
    startServer(port);
    await waitForHttp(port);
    await mainWindow.loadURL(`http://127.0.0.1:${port}/`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "The desk did not start.";
    logLine("server.log", `[desktop] ${message}`);
    if (mainWindow && !mainWindow.isDestroyed()) await mainWindow.loadURL(errorPage(message));
  }
  if (app.isPackaged) void checkForUpdates();
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
    app.setAppUserModelId("com.neuralenergies.rippleradar");
    updateState.current = app.getVersion();
    ipcMain.handle("desktop:get-info", () => ({
      version: app.getVersion(),
      name: APP_NAME,
      userData: app.getPath("userData"),
    }));
    ipcMain.handle("desktop:check-for-updates", () => checkForUpdates());
    ipcMain.handle("desktop:install-update", () => installUpdate());
    return createWindow();
  }).catch((err) => {
    logLine("server.log", `[desktop] ${err instanceof Error ? err.stack || err.message : String(err)}`);
  });

  app.on("window-all-closed", () => {
    stopServer();
    app.quit();
  });
  app.on("before-quit", () => stopServer());
}
