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
 * its own location, so it cannot be inlined). npm installs them into
 * dist/vendor/pkgs at build time (not "node_modules" — electron-builder
 * prunes any folder with that name). This makes `require('pdfmake')` resolve
 * there, with npm's own nesting intact.
 */
const VENDOR_DIR = path.join(__dirname, '..', 'vendor', 'pkgs');

type ResolveFilename = (
  request: string,
  parent: NodeJS.Module | undefined,
  isMain: boolean,
  options?: unknown,
) => string;

const moduleInternals = Module as unknown as { _resolveFilename: ResolveFilename };
const original = moduleInternals._resolveFilename;

/**
 * Teach Node that dist/vendor/pkgs is a module directory.
 *
 * Joining the vendor root onto the request (the previous approach) resolved
 * only top-level packages: a nested dependency such as lazystream's own
 * readable-stream was never found, because that lookup walks
 * `<pkg>/node_modules` — which is what _nodeModulePaths produces. Appending
 * the vendor directory to that candidate list lets Node's own algorithm do the
 * work, nesting and all.
 */
const nodeModulePaths = (Module as unknown as {
  _nodeModulePaths: (from: string) => string[];
})._nodeModulePaths;

(Module as unknown as { _nodeModulePaths: (from: string) => string[] })
  ._nodeModulePaths = function (from: string): string[] {
    const paths = nodeModulePaths.call(this, from);
    // Packages inside the vendor tree resolve their own deps from it too.
    return paths.includes(VENDOR_DIR) ? paths : [...paths, VENDOR_DIR];
  };

moduleInternals._resolveFilename = function (request, parent, isMain, options) {
  if (request.startsWith(ALIAS_PREFIX)) {
    const resolved = path.join(sharedDir, request.slice(ALIAS_PREFIX.length));
    return original.call(this, resolved, parent, isMain, options);
  }
  return original.call(this, request, parent, isMain, options);
};

export {};
