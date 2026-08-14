// ============================================================================
// AlAqsa — Electron main process entry point.
// ============================================================================

// Must come first: teaches Node how to resolve the "@shared/*" alias at runtime.
import './aliasRegister';

import { app, BrowserWindow, shell, Menu, nativeTheme } from 'electron';
import path from 'node:path';
import { SecureStore } from './security/secureStore';
import { LicenseManager } from './security/license';
import { registerIpcHandlers } from './ipc/registry';
import { setCurrentUser } from './security/permissions';
import type { Role } from '@shared/types';
import { readJson, writeJson, configPath } from './storage/paths';
import { closeDatabase } from './db/database';
import { startReminderScheduler } from './services/reminderService';
import { APP_NAME } from '@shared/constants';

// A single app-wide context passed to IPC handlers.
export interface AppContext {
  secure: SecureStore;
  license: LicenseManager;
  mainWindow: BrowserWindow | null;
  tempDir: string;
}

export interface LocalConfig {
  language: 'ar' | 'en';
  theme: 'light' | 'dark';
  networkMode: 'standalone' | 'host' | 'client';
  hostAddress?: string;
  hostPort?: number;
}

const DEFAULT_CONFIG: LocalConfig = {
  language: 'ar',
  theme: 'light',
  networkMode: 'standalone',
};

export function loadConfig(): LocalConfig {
  return { ...DEFAULT_CONFIG, ...readJson<Partial<LocalConfig>>(configPath(), {}) };
}

export function saveConfig(patch: Partial<LocalConfig>): LocalConfig {
  const next = { ...loadConfig(), ...patch };
  writeJson(configPath(), next);
  return next;
}

const ctx: AppContext = {
  secure: new SecureStore(),
  license: new LicenseManager(),
  mainWindow: null,
  tempDir: '',
};

// Only one instance may run (avoids two processes writing the same DB).
// Chromium ships the Shape Detection API (BarcodeDetector) behind a flag.
// Without this the camera scanner reports "not supported on this device",
// which is what the hardware-reader-less fallback was hitting.
app.commandLine.appendSwitch('enable-features', 'ShapeDetection,BarcodeDetector');

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (ctx.mainWindow) {
      if (ctx.mainWindow.isMinimized()) ctx.mainWindow.restore();
      ctx.mainWindow.focus();
    }
  });
}

// Dev mode is opt-in via ALAQSA_DEV=1 so that running the unpackaged build
// (npm start) loads the compiled renderer instead of expecting a Vite server.
const isDev = process.env.ALAQSA_DEV === '1';

function createWindow(): void {
  const config = loadConfig();
  nativeTheme.themeSource = config.theme === 'dark' ? 'dark' : 'light';

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: config.theme === 'dark' ? '#0d1520' : '#F7F9FC',
    title: APP_NAME,
    icon: path.join(__dirname, '../../build/icon.ico'),
    // Hide the native menu bar; the app draws its own modern menu. The menu
    // still exists so its keyboard accelerators keep working.
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      // Security hardening: renderer has no direct Node access.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs limited node APIs via contextBridge only
      webviewTag: false,
      spellcheck: false,
    },
  });

  ctx.mainWindow = win;

  win.setMenuBarVisibility(false);
  win.once('ready-to-show', () => win.show());

  /**
   * Zoom shortcuts.
   *
   * Menu accelerators alone proved unreliable here: the menu bar is hidden, and
   * Windows reports Ctrl+"+" as Ctrl+Shift+"=" on most layouts, so the
   * accelerator never matched. Handling the raw key event before the page sees
   * it makes Ctrl +/-/0 work regardless of keyboard layout.
   */
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || !input.control) return;
    const wc = win.webContents;
    const key = input.key;

    if (key === '+' || key === '=' || key === 'Add') {
      wc.setZoomLevel(Math.min(wc.getZoomLevel() + 0.5, 5));
      event.preventDefault();
    } else if (key === '-' || key === '_' || key === 'Subtract') {
      wc.setZoomLevel(Math.max(wc.getZoomLevel() - 0.5, -3));
      event.preventDefault();
    } else if (key === '0') {
      wc.setZoomLevel(0);
      event.preventDefault();
    }
  });

  // Allow the in-app camera scanner (and nothing else). Electron denies media
  // access by default, which made getUserMedia fail silently.
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(permission === 'media');
  });
  win.webContents.session.setPermissionCheckHandler((_wc, permission) => permission === 'media');

  // Block navigation away from the app and open external links in the browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, url) => {
    const devUrl = 'http://localhost:5273';
    if (!url.startsWith(devUrl) && !url.startsWith('file://')) {
      event.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });

  if (isDev) {
    win.loadURL('http://localhost:5273');
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  win.on('closed', () => {
    ctx.mainWindow = null;
  });
}

app.whenReady().then(() => {
  ctx.tempDir = path.join(app.getPath('temp'), 'alaqsa-open');
  ctx.license.load();
  registerIpcHandlers(ctx);
  startReminderScheduler(ctx);

  // The window is frameless-styled by the renderer, so the native menu bar is
  // hidden. Accelerators are still registered here (an invisible menu keeps
  // them working), which is what makes Ctrl +/-, Ctrl+0, undo/redo and the
  // clipboard roles respond to the keyboard without a visible menu bar.
  const menu = Menu.buildFromTemplate([
    {
      label: 'AlAqsa',
      submenu: [
        { role: 'reload', accelerator: 'CmdOrCtrl+R' },
        { role: 'toggleDevTools', visible: isDev, accelerator: 'F12' },
        { type: 'separator' },
        { role: 'quit', accelerator: 'CmdOrCtrl+Q' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo', accelerator: 'CmdOrCtrl+Z' },
        { role: 'redo', accelerator: 'CmdOrCtrl+Shift+Z' },
        { type: 'separator' },
        { role: 'cut', accelerator: 'CmdOrCtrl+X' },
        { role: 'copy', accelerator: 'CmdOrCtrl+C' },
        { role: 'paste', accelerator: 'CmdOrCtrl+V' },
        { role: 'selectAll', accelerator: 'CmdOrCtrl+A' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+Plus' },
        // Register the numpad/secondary bindings too: on many keyboards the
        // "+" key only reports as Shift+= or numadd.
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+=', visible: false },
        { role: 'zoomIn', accelerator: 'CmdOrCtrl+numadd', visible: false },
        { role: 'zoomOut', accelerator: 'CmdOrCtrl+-' },
        { role: 'zoomOut', accelerator: 'CmdOrCtrl+numsub', visible: false },
        { role: 'resetZoom', accelerator: 'CmdOrCtrl+0' },
        { type: 'separator' },
        { role: 'togglefullscreen', accelerator: 'F11' },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  // Wipe decrypted temp copies and close the DB cleanly.
  try {
    const fs = require('node:fs') as typeof import('node:fs');
    if (ctx.tempDir && fs.existsSync(ctx.tempDir)) {
      fs.rmSync(ctx.tempDir, { recursive: true, force: true });
    }
  } catch { /* best effort */ }
  ctx.secure.lock();
  closeDatabase();
});

export function getContext(): AppContext & {
  __setRole: (id: string | null, role: Role | null) => void;
} {
  // __setRole exists so the automated security suite can exercise every role
  // through the real IPC boundary. It is not reachable from the renderer.
  return Object.assign(ctx, { __setRole: setCurrentUser });
}
