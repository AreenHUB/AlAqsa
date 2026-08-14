// ============================================================================
// AlAqsa — Preload bridge. The renderer gets NO Node access; it only sees the
// typed `window.alaqsa` API, which forwards to whitelisted IPC channels.
// ============================================================================

import { contextBridge, ipcRenderer } from 'electron';

/** Groups and their methods — must mirror `IpcApi` in shared/ipc.ts. */
const API_MAP: Record<string, string[]> = {
  auth: ['status', 'firstRunSetup', 'unlock', 'unlockWithRecovery', 'changePassword', 'regenerateRecoveryKey', 'lock'],
  license: ['state', 'activate'],
  clients: ['list', 'get', 'create', 'update', 'remove', 'contacts', 'saveContacts'],
  branches: ['listByClient', 'create', 'update', 'remove'],
  devices: ['listByBranch', 'listByClient', 'create', 'update', 'remove', 'findBySerial', 'qrDataUrl'],
  documents: ['listByClient', 'listByBranch', 'add', 'remove', 'open'],
  licenses: ['listByClient', 'save', 'remove'],
  visits: ['listByClient', 'listByBranch', 'get', 'create', 'update', 'remove'],
  inventory: ['list', 'upsert', 'remove', 'importExcel'],
  amc: ['listByClient', 'save', 'remove'],
  invoices: ['listByClient', 'save', 'remove'],
  reminders: ['upcoming', 'all', 'save', 'markDone', 'remove'],
  statusLabels: ['list', 'save', 'remove'],
  reports: ['visitPdf', 'agreementPdf', 'exportClientExcel', 'exportAllExcel', 'shareWhatsApp', 'print'],
  search: ['global'],
  dashboard: ['stats'],
  users: ['list', 'save', 'remove'],
  audit: ['recent'],
  backup: ['now', 'exportEncrypted', 'restore', 'factoryReset'],
  files: ['pickOpen', 'pickSave', 'saveDataUrl', 'importDocument'],
  settings: ['get', 'set', 'setLanguage', 'setTheme'],
  network: ['getMode', 'setHost', 'discover', 'connect', 'disconnect'],
  app: ['about', 'seedDemoData'],
};

const api: Record<string, Record<string, (...args: unknown[]) => Promise<unknown>>> = {};

for (const [group, methods] of Object.entries(API_MAP)) {
  api[group] = {};
  for (const method of methods) {
    const channel = `${group}:${method}`;
    api[group][method] = (...args: unknown[]) => ipcRenderer.invoke(channel, ...args);
  }
}

/** Main-process -> renderer events (notifications, sync updates, lock). */
const events = {
  onReminderDue: (cb: (payload: unknown) => void) => {
    const listener = (_e: unknown, payload: unknown) => cb(payload);
    ipcRenderer.on('event:reminder-due', listener);
    return () => ipcRenderer.removeListener('event:reminder-due', listener);
  },
  onLocked: (cb: () => void) => {
    const listener = () => cb();
    ipcRenderer.on('event:locked', listener);
    return () => ipcRenderer.removeListener('event:locked', listener);
  },
  onDataChanged: (cb: (entity: string) => void) => {
    const listener = (_e: unknown, entity: string) => cb(entity);
    ipcRenderer.on('event:data-changed', listener);
    return () => ipcRenderer.removeListener('event:data-changed', listener);
  },
};

contextBridge.exposeInMainWorld('alaqsa', { ...api, events });
