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

  win.once('ready-to-show', () => win.show());

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

  // Minimal application menu (kept small; the UI has its own navigation).
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      {
        label: 'AlAqsa',
        submenu: [
          { role: 'reload' },
          { role: 'toggleDevTools', visible: isDev },
          { type: 'separator' },
          { role: 'quit' },
        ],
      },
      {
        label: 'Edit',
        submenu: [
          { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
          { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
        ],
      },
      {
        label: 'View',
        submenu: [
          { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' },
          { type: 'separator' }, { role: 'togglefullscreen' },
        ],
      },
    ]),
  );

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

export function getContext(): AppContext {
  return ctx;
}
