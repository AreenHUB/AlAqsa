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
 * Copy a package and everything it needs into dist/vendor.
 *
 * This sidesteps electron-builder's dependency pruning entirely: whatever ends
 * up in dist/ is shipped verbatim, so a package it wrongly classifies as
 * dev-only (call-bind-apply-helpers, reached via dunder-proto) cannot go
 * missing at runtime.
 *
 * Dependencies are followed the way Node resolves them, walking up through
 * parent node_modules folders. That matters because npm nests a *different*
 * version of a package when versions conflict — lazystream needs
 * readable-stream@2 while the hoisted copy is v3, and only the nested one has
 * passthrough.js. Copying just the top-level package produced an app that
 * crashed on launch.
 */
function resolvePackageDir(name, fromDir) {
  // Walk up from fromDir looking for node_modules/<name>, exactly like Node.
  let dir = fromDir;
  for (;;) {
    const candidate = path.join(dir, 'node_modules', name);
    if (existsSync(path.join(candidate, 'package.json'))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
    // Never escape the project.
    if (!dir.startsWith(root.slice(0, 3))) return null;
    if (dir.length < root.length && !root.startsWith(dir)) return null;
  }
}

function copyPackageTree(names) {
  const copied = new Set();
  const queue = names.map((n) => ({ name: n, from: root }));

  while (queue.length) {
    const { name, from } = queue.shift();

    const src = resolvePackageDir(name, from);
    if (!src) continue;

    // Destination mirrors the source layout relative to node_modules, so a
    // nested copy keeps its position and shadows the hoisted version exactly
    // as npm intended.
    const rel = path.relative(path.join(root, 'node_modules'), src);
    const dest = path.join(outDir, 'vendor', rel);

    if (copied.has(dest)) continue;
    copied.add(dest);

    mkdirSync(path.dirname(dest), { recursive: true });
    // Copy the package WITH any node_modules it carries. Attempting to filter
    // those out and re-resolve them by hand silently lost nested version
    // conflicts (lazystream's readable-stream@2), which crashed the app on
    // launch. Copying wholesale is larger but always correct.
    cpSync(src, dest, { recursive: true });

    try {
      const pkg = JSON.parse(readFileSync(path.join(src, 'package.json'), 'utf8'));
      for (const dep of Object.keys(pkg.dependencies ?? {})) {
        queue.push({ name: dep, from: src });
      }
      // Optional deps are best-effort: unresolvable ones are skipped above.
      for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
        queue.push({ name: dep, from: src });
      }
    } catch { /* package.json missing or unreadable — nothing to follow */ }
  }

  return copied;
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
