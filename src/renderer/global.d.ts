// ============================================================================
// AlAqsa — Renderer global typings for the preload bridge.
// ============================================================================

import type { IpcApi } from '@shared/ipc';
import type { Reminder } from '@shared/types';

declare global {
  interface Window {
    alaqsa: IpcApi & {
      events: {
        onReminderDue(cb: (payload: Reminder) => void): () => void;
        onLocked(cb: () => void): () => void;
        onDataChanged(cb: (entity: string) => void): () => void;
      };
    };
  }
}

export {};
