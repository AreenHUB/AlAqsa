// ============================================================================
// AlAqsa — LAN sharing between 2-3 shop PCs.
//
// One PC runs as HOST: it owns the encrypted database and exposes a WebSocket
// on SYNC_PORT. Other PCs run as CLIENT: they forward data operations to the
// host over that socket, so every machine sees the same live data.
//
// The host is advertised over mDNS/Bonjour so clients can auto-discover it —
// no fixed IP required. Traffic is confined to the LAN and authenticated with
// a shared token derived from the database key.
// ============================================================================

import { WebSocketServer, WebSocket } from 'ws';
import { Bonjour, type Service } from 'bonjour-service';
import os from 'node:os';
import type { AppContext } from '../main';
import { SYNC_PORT, MDNS_SERVICE_TYPE } from '@shared/constants';
import { sha256 } from '../security/crypto';

interface DiscoveredHost {
  name: string;
  address: string;
  port: number;
}

class NetworkService {
  private wss: WebSocketServer | null = null;
  private clientSocket: WebSocket | null = null;
  private bonjour: Bonjour | null = null;
  private published: Service | null = null;
  private ctx: AppContext | null = null;

  /** Token both sides must present; derived from the DB key so only machines
   *  unlocked with the same master password can join. */
  private authToken(ctx: AppContext): string {
    return sha256('alaqsa-sync|' + ctx.secure.getSqlcipherKey()).slice(0, 32);
  }

  startHost(ctx: AppContext): void {
    this.stop();
    this.ctx = ctx;
    const token = this.authToken(ctx);

    this.wss = new WebSocketServer({ port: SYNC_PORT });
    this.wss.on('connection', (ws, req) => {
      let authed = false;
      const timeout = setTimeout(() => { if (!authed) ws.close(); }, 5000);

      ws.on('message', async (raw) => {
        let msg: any;
        try { msg = JSON.parse(raw.toString()); } catch { return; }

        if (!authed) {
          if (msg.type === 'auth' && msg.token === token) {
            authed = true;
            clearTimeout(timeout);
            ws.send(JSON.stringify({ type: 'auth-ok' }));
          } else {
            ws.close();
          }
          return;
        }

        if (msg.type === 'invoke') {
          // Execute the requested repository call locally and return the result.
          try {
            const result = await this.executeLocal(msg.channel, msg.args ?? []);
            ws.send(JSON.stringify({ type: 'result', id: msg.id, ok: true, data: result }));
          } catch (e) {
            ws.send(JSON.stringify({
              type: 'result', id: msg.id, ok: false,
              error: e instanceof Error ? e.message : String(e),
            }));
          }
        }
      });

      ws.on('close', () => clearTimeout(timeout));
    });

    // Advertise on the LAN so clients can find this host without an IP.
    this.bonjour = new Bonjour();
    this.published = this.bonjour.publish({
      name: `AlAqsa Host (${os.hostname()})`,
      type: MDNS_SERVICE_TYPE,
      port: SYNC_PORT,
    });
  }

  /** Discover hosts advertised on the LAN (3-second sweep). */
  discover(): Promise<DiscoveredHost[]> {
    return new Promise((resolve) => {
      const found: DiscoveredHost[] = [];
      const bonjour = new Bonjour();
      const browser = bonjour.find({ type: MDNS_SERVICE_TYPE }, (service) => {
        const address = service.addresses?.find((a) => a.includes('.')) ?? service.host;
        if (address) found.push({ name: service.name, address, port: service.port });
      });
      setTimeout(() => {
        browser.stop();
        bonjour.destroy();
        // De-duplicate by address:port.
        const seen = new Set<string>();
        resolve(found.filter((h) => {
          const k = `${h.address}:${h.port}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        }));
      }, 3000);
    });
  }

  connectToHost(address: string, port: number): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.ctx) return reject(new Error('NO_CONTEXT'));
      const ws = new WebSocket(`ws://${address}:${port}`);
      const timeout = setTimeout(() => {
        ws.close();
        reject(new Error('CONNECT_TIMEOUT'));
      }, 8000);

      ws.on('open', () => {
        ws.send(JSON.stringify({ type: 'auth', token: this.authToken(this.ctx!) }));
      });
      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'auth-ok') {
            clearTimeout(timeout);
            this.clientSocket = ws;
            resolve();
          }
        } catch { /* ignore */ }
      });
      ws.on('error', (e) => {
        clearTimeout(timeout);
        reject(e);
      });
    });
  }

  setContext(ctx: AppContext): void {
    this.ctx = ctx;
  }

  isClient(): boolean {
    return this.clientSocket !== null && this.clientSocket.readyState === WebSocket.OPEN;
  }

  stop(): void {
    this.published?.stop?.();
    this.bonjour?.destroy();
    this.bonjour = null;
    this.published = null;
    this.wss?.close();
    this.wss = null;
    this.clientSocket?.close();
    this.clientSocket = null;
  }

  /**
   * Execute a repository operation on the host. Kept deliberately narrow: only
   * whitelisted read/write channels are reachable over the network.
   */
  private async executeLocal(channel: string, args: unknown[]): Promise<unknown> {
    const { clientsRepo } = require('../db/repositories/clientsRepo');
    const { branchesRepo } = require('../db/repositories/branchesRepo');
    const { devicesRepo } = require('../db/repositories/devicesRepo');
    const { visitsRepo } = require('../db/repositories/visitsRepo');
    const misc = require('../db/repositories/miscRepo');

    const table: Record<string, (...a: any[]) => unknown> = {
      'clients:list': (q) => clientsRepo.list(q ?? {}),
      'clients:get': (id) => clientsRepo.get(id),
      'clients:create': (i) => clientsRepo.create(i),
      'clients:update': (id, p) => clientsRepo.update(id, p),
      'clients:remove': (id) => { clientsRepo.remove(id); return null; },
      'clients:contacts': (id) => clientsRepo.contacts(id),
      'clients:saveContacts': (id, c) => clientsRepo.saveContacts(id, c),
      'branches:listByClient': (id) => branchesRepo.listByClient(id),
      'branches:create': (i) => branchesRepo.create(i),
      'branches:update': (id, p) => branchesRepo.update(id, p),
      'branches:remove': (id) => { branchesRepo.remove(id); return null; },
      'devices:listByBranch': (id) => devicesRepo.listByBranch(id),
      'devices:listByClient': (id) => devicesRepo.listByClient(id),
      'devices:create': (i) => devicesRepo.create(i),
      'devices:update': (id, p) => devicesRepo.update(id, p),
      'devices:remove': (id) => { devicesRepo.remove(id); return null; },
      'devices:findBySerial': (s) => devicesRepo.findBySerial(s),
      'visits:listByClient': (id) => visitsRepo.listByClient(id),
      'visits:listByBranch': (id) => visitsRepo.listByBranch(id),
      'visits:get': (id) => visitsRepo.get(id),
      'visits:create': (i) => visitsRepo.create(i),
      'visits:update': (id, p) => visitsRepo.update(id, p),
      'search:global': (t) => misc.searchRepo.global(t),
      'dashboard:stats': () => misc.dashboardRepo.stats(),
      'inventory:list': (s) => misc.inventoryRepo.list(s),
      'reminders:upcoming': (d) => misc.remindersRepo.upcoming(d),
    };

    const fn = table[channel];
    if (!fn) throw new Error('CHANNEL_NOT_ALLOWED');
    return fn(...args);
  }
}

export const networkService = new NetworkService();
