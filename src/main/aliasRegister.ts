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
  return original.call(this, request, parent, isMain, options);
};

export {};
