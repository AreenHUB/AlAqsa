// ============================================================================
// AlAqsa — Sharing: WhatsApp, print, email.
//
// WhatsApp cannot be scripted to auto-send an attachment (a WhatsApp-side
// restriction, not a limitation of this app). So the flow is:
//   1. The PDF is generated and its folder is revealed in Explorer.
//   2. WhatsApp Desktop (or web.whatsapp.com as fallback) opens the chat with
//      the message pre-filled.
//   3. The user drags/attaches the already-open PDF and presses send.
// ============================================================================

import { shell } from 'electron';
import { exec } from 'node:child_process';
import fs from 'node:fs';

/** Normalize a UAE/international phone number to wa.me digits form. */
export function normalizePhone(raw: string): string {
  let p = raw.replace(/[^\d+]/g, '');
  if (p.startsWith('+')) p = p.slice(1);
  if (p.startsWith('00')) p = p.slice(2);
  // Local UAE format like 0509471769 -> 971509471769
  if (p.startsWith('0') && p.length === 10) p = '971' + p.slice(1);
  return p;
}

export async function shareViaWhatsApp(pdfPath: string, phone: string, message: string): Promise<void> {
  const digits = normalizePhone(phone);
  const text = encodeURIComponent(message);

  // Reveal the PDF so it is ready to attach.
  if (pdfPath && fs.existsSync(pdfPath)) {
    shell.showItemInFolder(pdfPath);
  }

  // `whatsapp://` opens WhatsApp Desktop when installed; otherwise fall back to
  // the web client. Opening the protocol URL first is harmless if unregistered.
  const deepLink = `whatsapp://send?phone=${digits}&text=${text}`;
  const webLink = `https://wa.me/${digits}?text=${text}`;

  try {
    await shell.openExternal(deepLink);
  } catch {
    await shell.openExternal(webLink);
  }
}

/**
 * Share plain text (a location, a note, a heads-up to the team). No file is
 * involved, so this opens straight into the chat with the message ready.
 */
export async function shareTextViaWhatsApp(phone: string, message: string): Promise<void> {
  const digits = normalizePhone(phone);
  const text = encodeURIComponent(message);
  const deepLink = `whatsapp://send?phone=${digits}&text=${text}`;
  const webLink = `https://wa.me/${digits}?text=${text}`;
  try {
    await shell.openExternal(deepLink);
  } catch {
    await shell.openExternal(webLink);
  }
}

/** Send the default printer the file via the Windows shell "print" verb. */
export async function printFile(filePath: string): Promise<void> {
  if (!fs.existsSync(filePath)) throw new Error('FILE_NOT_FOUND');
  if (process.platform === 'win32') {
    await new Promise<void>((resolve, reject) => {
      // Use the shell's print verb through PowerShell (handles PDF associations).
      const cmd = `powershell -NoProfile -Command "Start-Process -FilePath '${filePath.replace(/'/g, "''")}' -Verb Print"`;
      exec(cmd, (error) => (error ? reject(error) : resolve()));
    });
  } else {
    await shell.openPath(filePath);
  }
}

/** Open the default mail client with the report attached by the user. */
export async function shareViaEmail(to: string, subject: string, body: string, attachmentPath?: string): Promise<void> {
  if (attachmentPath && fs.existsSync(attachmentPath)) {
    shell.showItemInFolder(attachmentPath);
  }
  const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  await shell.openExternal(url);
}
