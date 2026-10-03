/**
 * Ripple Radar window. Hosts the desk on 127.0.0.1 and never opens a console.
 * The server is Electron itself with ELECTRON_RUN_AS_NODE, so Windows does not
 * allocate a console for a second node.exe. Desk data lives in userData,
 * outside the install directory, so an update does not wipe it.
 */
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeImage, Notification, shell, Tray } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

const APP_NAME = "Ripple Radar";

let server = null;
let serverPort = 0;
let mainWindow = null;
let tray = null;
let allowQuit = false;
let updater = null;

const SKIP_COPY = new Set(["Cache", "GPUCache", "Code Cache", "DawnGraphiteCache", "DawnWebGPUCache", "blob_storage"]);
const BACKUP_MARKER = "ripple-radar-backup.json";
let downloaded = false;
let installWhenReady = false;
let updateState = {
  state: "none",
  current: "0.0.0",
  latest: null,
  message: "No published release yet. This copy stays as it is.",
};

function openHttp(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return;
  void shell.openExternal(url.href);
}

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

function copyFilter(src) {
  const base = path.basename(src);
  return !SKIP_COPY.has(base) && base !== "restore-after-restart.json";
}

/** Copy what we can. A locked cache file must not fail the whole backup. */
function copyTree(src, dest, skipped) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (SKIP_COPY.has(entry.name) || entry.name === "restore-after-restart.json") continue;
    const from = path.join(src, entry.name);
    const to = path.join(dest, entry.name);
    try {
      if (entry.isDirectory()) copyTree(from, to, skipped);
      else if (entry.isFile()) fs.copyFileSync(from, to);
    } catch (err) {
      skipped.n += 1;
      logLine("server.log", `[desktop] skipped ${from}: ${err instanceof Error ? err.message : err}`);
    }
  }
}

function backupFolderName(now) {
  const p = (n) => String(n).padStart(2, "0");
  return `RippleRadar-backup-${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
}

/** Applied before the window opens, so the previous process has released the files. */
function consumePendingRestore() {
  let userData;
  try {
    userData = app.getPath("userData");
  } catch {
    return;
  }
  const markerPath = path.join(userData, "restore-after-restart.json");
  if (!fs.existsSync(markerPath)) return;
  let from = "";
  try {
    from = JSON.parse(fs.readFileSync(markerPath, "utf8")).from || "";
  } catch {
    from = "";
  }
  fs.rmSync(markerPath, { force: true });
  if (!from || !fs.existsSync(from)) return;
  const safety = path.join(app.getPath("temp"), "RippleRadar-before-restore");
  try {
    fs.rmSync(safety, { recursive: true, force: true });
    fs.cpSync(userData, safety, { recursive: true, filter: copyFilter });
    fs.cpSync(from, userData, { recursive: true, force: true, filter: copyFilter });
    fs.rmSync(from, { recursive: true, force: true });
  } catch (err) {
    logLine("server.log", `[desktop] restore failed: ${err instanceof Error ? err.message : err}`);
  }
}

function readOpenAtLogin() {
  try {
    return app.getLoginItemSettings().openAtLogin === true;
  } catch {
    return false;
  }
}

function setOpenAtLogin(open) {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(open), path: process.execPath });
  } catch (err) {
    logLine("server.log", `[desktop] startup setting failed: ${err instanceof Error ? err.message : err}`);
  }
  return readOpenAtLogin();
}

function showMain() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function trayImage() {
  const ico = path.join(__dirname, "build", "icon.ico");
  const png = path.join(__dirname, "build", "icon.png");
  const file = fs.existsSync(ico) ? ico : fs.existsSync(png) ? png : "";
  if (!file) return nativeImage.createEmpty();
  const image = nativeImage.createFromPath(file);
  return image.isEmpty() ? nativeImage.createEmpty() : image;
}

function rebuildTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Open Ripple Radar", click: showMain },
      { type: "separator" },
      {
        label: "Launch at startup",
        type: "checkbox",
        checked: readOpenAtLogin(),
        click: (item) => {
          setOpenAtLogin(item.checked);
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          allowQuit = true;
          app.quit();
        },
      },
    ]),
  );
}

function createTray() {
  if (tray) return;
  try {
    tray = new Tray(trayImage());
    tray.setToolTip("Ripple Radar — alerts stay on while this sits in the tray");
    rebuildTrayMenu();
    tray.on("click", showMain);
    tray.on("double-click", showMain);
  } catch (err) {
    logLine("server.log", `[desktop] tray failed: ${err instanceof Error ? err.message : err}`);
    tray = null;
  }
}

async function restartServer() {
  const port = serverPort || (await freePort());
  serverPort = port;
  stopServer();
  startServer(port);
  await waitForHttp(port);
}

async function backupData() {
  const picked = await dialog.showOpenDialog({
    title: "Choose a folder for the backup",
    properties: ["openDirectory", "createDirectory"],
  });
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, path: null, message: "Backup cancelled." };
  const dest = path.join(picked.filePaths[0], backupFolderName(new Date()));
  try {
    stopServer();
    const skipped = { n: 0 };
    copyTree(app.getPath("userData"), dest, skipped);
    fs.writeFileSync(
      path.join(dest, BACKUP_MARKER),
      JSON.stringify({ app: APP_NAME, created: new Date().toISOString() }, null, 2),
    );
    await restartServer();
    const missed = skipped.n ? ` ${skipped.n} locked file${skipped.n === 1 ? "" : "s"} left out — see server.log.` : "";
    return { ok: true, path: dest, message: `Backup saved to ${dest}.${missed}` };
  } catch (err) {
    try {
      await restartServer();
    } catch {
      // The window already explains a dead server.
    }
    return { ok: false, path: null, message: err instanceof Error ? err.message : "Backup failed." };
  }
}

async function restoreData() {
  const picked = await dialog.showOpenDialog({
    title: "Choose a Ripple Radar backup folder",
    properties: ["openDirectory"],
  });
  if (picked.canceled || !picked.filePaths[0]) return { ok: false, message: "Restore cancelled." };
  const src = picked.filePaths[0];
  let names = [];
  try {
    names = fs.readdirSync(src);
  } catch {
    names = [];
  }
  if (!names.includes(BACKUP_MARKER) && !names.includes("pglite")) {
    return { ok: false, message: "That folder is not a Ripple Radar backup." };
  }
  const pending = path.join(app.getPath("temp"), "RippleRadar-restore-pending");
  fs.rmSync(pending, { recursive: true, force: true });
  fs.cpSync(src, pending, { recursive: true, filter: copyFilter });
  fs.writeFileSync(path.join(app.getPath("userData"), "restore-after-restart.json"), JSON.stringify({ from: pending }));
  allowQuit = true;
  app.relaunch();
  app.exit(0);
  return { ok: true, message: "Restoring and reopening." };
}

function notifyUser(title, body) {
  if (!Notification.isSupported()) return false;
  const note = new Notification({
    title: String(title || APP_NAME).slice(0, 120),
    body: String(body || "").slice(0, 240),
    icon: trayImage(),
  });
  note.on("click", showMain);
  note.show();
  return true;
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
  // A hidden window still has to poll the tape, or tray alerts never fire.
  mainWindow.webContents.setBackgroundThrottling(false);
  mainWindow.on("close", (event) => {
    if (allowQuit) return;
    event.preventDefault();
    mainWindow.hide();
  });
  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openHttp(url);
    return { action: "deny" };
  });
  try {
    const port = await freePort();
    serverPort = port;
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
  app.on("second-instance", () => showMain());

  consumePendingRestore();

  app.whenReady().then(() => {
    app.setAppUserModelId("com.neuralenergies.rippleradar");
    updateState.current = app.getVersion();
    createTray();
    ipcMain.handle("desktop:get-info", () => ({
      version: app.getVersion(),
      name: APP_NAME,
      userData: app.getPath("userData"),
      launchAtStartup: readOpenAtLogin(),
    }));
    ipcMain.handle("desktop:check-for-updates", () => checkForUpdates());
    ipcMain.handle("desktop:install-update", () => installUpdate());
    ipcMain.handle("desktop:set-launch-at-startup", (_event, on) => {
      const next = setOpenAtLogin(on);
      rebuildTrayMenu();
      return next;
    });
    ipcMain.handle("desktop:backup", () => backupData());
    ipcMain.handle("desktop:restore", () => restoreData());
    ipcMain.handle("desktop:notify", (_event, payload) => notifyUser(payload && payload.title, payload && payload.body));
    return createWindow();
  }).catch((err) => {
    logLine("server.log", `[desktop] ${err instanceof Error ? err.stack || err.message : String(err)}`);
  });

  app.on("window-all-closed", () => {
    // Closing the window hides to the tray. Quit is explicit.
  });
  app.on("before-quit", () => {
    allowQuit = true;
    stopServer();
  });
}
