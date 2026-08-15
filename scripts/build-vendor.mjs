// ============================================================================
// AlAqsa — Build dist/vendor with a real npm install.
//
// Why not copy packages by hand?
//
// Two attempts at walking the dependency graph manually both shipped a broken
// app: first call-bind-apply-helpers went missing (electron-builder pruned
// it), then readable-stream@2 (npm nests a conflicting version), then
// minimatch (present only inside other packages' node_modules). Every fix
// revealed another edge case in npm's layout.
//
// npm already solves this exactly. So instead of imitating it, we write a
// minimal package.json listing only what the main process needs at runtime,
// and let `npm install --omit=dev` produce a correct, complete tree.
//
// Those packages stay out of the esbuild bundle because they read asset files
// relative to their own location on disk (pdfmake -> fontkit -> data.trie),
// which bundling breaks.
// ============================================================================

import { execFileSync } from 'node:child_process';
import { rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, cpSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendorDir = path.join(root, 'dist', 'vendor');

/** Packages the bundled main process requires at runtime. */
const RUNTIME_PACKAGES = ['pdfmake', 'exceljs'];

export function buildVendor() {
  const appPkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

  const deps = {};
  for (const name of RUNTIME_PACKAGES) {
    const version = appPkg.dependencies?.[name];
    if (!version) throw new Error(`${name} is not a dependency of the app`);
    deps[name] = version;
  }

  rmSync(vendorDir, { recursive: true, force: true });
  mkdirSync(vendorDir, { recursive: true });

  // npm insists on creating "node_modules". electron-builder prunes any
  // directory with that name, which previously stripped this whole tree from
  // the installer (only vendor/package.json survived). So npm runs in a temp
  // directory and the result is copied to a neutral name.
  const stagingDir = path.join(root, 'dist', '.vendor-staging');
  rmSync(stagingDir, { recursive: true, force: true });
  mkdirSync(stagingDir, { recursive: true });

  writeFileSync(
    path.join(stagingDir, 'package.json'),
    JSON.stringify({
      name: 'alaqsa-vendor',
      version: '1.0.0',
      private: true,
      description: 'Runtime packages that cannot be bundled; installed by npm so the tree is complete.',
      dependencies: deps,
    }, null, 2),
  );

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npm, [
    'install',
    '--omit=dev',
    '--no-audit',
    '--no-fund',
    '--ignore-scripts',   // nothing here needs a build step
    '--silent',
  ], { cwd: stagingDir, stdio: 'inherit', shell: process.platform === 'win32' });

  const shipped = path.join(vendorDir, 'pkgs');
  cpSync(path.join(stagingDir, 'node_modules'), shipped, { recursive: true });
  rmSync(stagingDir, { recursive: true, force: true });

  // Sanity check: the packages that broke previous builds must be present.
  const mustExist = [
    'pdfmake/src/printer.js',
    'exceljs/excel.js',
    'call-bind-apply-helpers/index.js',
  ];
  for (const rel of mustExist) {
    if (!existsSync(path.join(shipped, rel))) {
      throw new Error(`vendor tree is incomplete: missing ${rel}`);
    }
  }

  return vendorDir;
}
