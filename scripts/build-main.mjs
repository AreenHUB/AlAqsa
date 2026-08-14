// ============================================================================
// AlAqsa — Bundle the Electron main process with esbuild.
//
// Why bundle instead of shipping loose files + node_modules?
//
// electron-builder decides for itself which packages are "production" and
// prunes the rest. pdfmake reaches some of its dependencies through a chain
// the packer fails to trace (call-bind-apply-helpers via dunder-proto), so the
// packaged app threw "Cannot find module" on every PDF export even though the
// package was declared as a dependency and present in node_modules.
//
// Bundling removes the guesswork: everything the main process actually imports
// is compiled into a single file, so nothing can be pruned by mistake.
//
// Native modules (.node) and Electron itself cannot be bundled and stay
// external — they are resolved at runtime from node_modules as usual.
//
// pdfmake/exceljs are copied into dist/vendor rather than dist/node_modules:
// electron-builder hoists any node_modules folder to the package root and
// merges it with its own pruned tree, which silently discarded the copy.
// ============================================================================

import { build } from 'esbuild';
import { rmSync, mkdirSync, cpSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'dist');

// Anything that must NOT be inlined.
const external = [
  'electron',
  // Native binding: has a .node binary, loaded at runtime.
  'better-sqlite3-multiple-ciphers',
  // pdfmake -> fontkit reads a data.trie asset relative to its own file on
  // disk. Bundling it breaks that lookup, so pdfmake stays external and its
  // whole tree is copied into the package by copyPdfmakeTree() below.
  'pdfmake',
  // exceljs similarly relies on its own package layout.
  'exceljs',
];

/**
 * Copy a package and everything it needs into dist/node_modules.
 *
 * This sidesteps electron-builder's dependency pruning entirely: whatever ends
 * up in dist/ is shipped verbatim, so a package it wrongly classifies as
 * dev-only (call-bind-apply-helpers, reached via dunder-proto) cannot go
 * missing at runtime.
 */
function copyPackageTree(names) {
  const seen = new Set();
  const queue = [...names];

  while (queue.length) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);

    const src = path.join(root, 'node_modules', name);
    if (!existsSync(src)) continue;

    const dest = path.join(outDir, 'vendor', name);
    mkdirSync(path.dirname(dest), { recursive: true });
    cpSync(src, dest, { recursive: true });

    // Follow this package's own dependencies.
    try {
      const pkg = JSON.parse(
        readFileSync(path.join(src, 'package.json'), 'utf8'),
      );
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        if (!seen.has(dep)) queue.push(dep);
      }
    } catch { /* package.json missing or unreadable — nothing to follow */ }
  }

  return seen;
}

/** Shared options for both entry points. */
const common = {
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: false,
  minify: false,
  external,
  // Resolve the "@shared/*" alias at build time so no runtime hook is needed.
  alias: {
    '@shared': path.join(root, 'src/shared'),
  },
  logLevel: 'info',
};

async function run() {
  rmSync(path.join(outDir, 'main'), { recursive: true, force: true });
  rmSync(path.join(outDir, 'preload'), { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  await build({
    ...common,
    entryPoints: [path.join(root, 'src/main/main.ts')],
    outfile: path.join(outDir, 'main/main.js'),
  });

  await build({
    ...common,
    entryPoints: [path.join(root, 'src/preload/preload.ts')],
    outfile: path.join(outDir, 'preload/preload.js'),
  });

  // Ship the externals (and their full dependency chains) ourselves.
  rmSync(path.join(outDir, 'vendor'), { recursive: true, force: true });
  const copied = copyPackageTree(['pdfmake', 'exceljs']);
  console.log(`  copied ${copied.size} packages into dist/vendor`);

  // The renderer is built separately by Vite into dist/renderer.
  if (!existsSync(path.join(outDir, 'renderer'))) {
    console.warn('  ! dist/renderer is missing — run the Vite build too.');
  }

  console.log('  main + preload bundled');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
