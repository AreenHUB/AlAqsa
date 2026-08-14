// ============================================================================
// AlAqsa — Runtime resolution for the "@shared/*" TypeScript path alias.
//
// tsc type-checks the alias but emits it verbatim into the JavaScript, so Node
// cannot resolve it at runtime. Hooking Module._resolveFilename maps it to the
// compiled files. This must be imported before anything that uses the alias.
// ============================================================================

import path from 'node:path';
import Module from 'node:module';

const ALIAS_PREFIX = '@shared/';
// Compiled layout: dist/main/aliasRegister.js -> dist/shared/*
const sharedDir = path.join(__dirname, '..', 'shared');

/**
 * Packages that stay outside the bundle (pdfmake reads asset files relative to
 * its own location, so it cannot be inlined). They are copied to dist/vendor
 * at build time; this makes `require('pdfmake')` find them there first.
 */
const VENDOR_DIR = path.join(__dirname, '..', 'vendor');

type ResolveFilename = (
  request: string,
  parent: NodeJS.Module | undefined,
  isMain: boolean,
  options?: unknown,
) => string;

const moduleInternals = Module as unknown as { _resolveFilename: ResolveFilename };
const original = moduleInternals._resolveFilename;

moduleInternals._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith(ALIAS_PREFIX)) {
    const resolved = path.join(sharedDir, request.slice(ALIAS_PREFIX.length));
    return original.call(this, resolved, parent, isMain, options);
  }

  // Bare specifier (not relative/absolute): try dist/vendor before the normal
  // lookup so the copied trees are used in the packaged app.
  if (!request.startsWith('.') && !path.isAbsolute(request)) {
    try {
      return original.call(this, path.join(VENDOR_DIR, request), parent, isMain, options);
    } catch {
      // Not vendored — fall through to the standard resolution below.
    }
  }

  return original.call(this, request, parent, isMain, options);
};

export {};
