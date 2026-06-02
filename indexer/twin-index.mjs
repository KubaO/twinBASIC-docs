import fs from 'node:fs/promises';
import path from 'node:path';
import { syncPackages } from './lib/sync.mjs';
import { preprocessVB6, CONTAINER_MAP } from './lib/vb6-preprocess.mjs';
import { lex } from './lib/lexer.mjs';
import { extract } from './lib/extractor.mjs';
import { emitMarkdown } from './lib/emitter.mjs';

// --- CLI ---

const args = process.argv.slice(2);
let outDir = './package-indexes/';
let packagesRoot = './package-indexes/packages';
let doSync = true;
let doIndex = true;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) {
    outDir = args[++i];
  } else if (args[i] === '--no-sync') {
    doSync = false;
  } else if (args[i] === '--sync-only') {
    doIndex = false;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node indexer/twin-index.mjs [options] [<packages-root>]');
    console.log('');
    console.log('  Default: sync from TWINSERV then index all packages.');
    console.log('');
    console.log('Options:');
    console.log('  --no-sync          Skip sync, index only (legacy mode)');
    console.log('  --sync-only        Sync from TWINSERV, skip indexing');
    console.log('  --out <dir>        Output directory (default: ./package-indexes/)');
    console.log('  <packages-root>    Package source directory (with --no-sync)');
    process.exit(0);
  } else if (!args[i].startsWith('-')) {
    packagesRoot = args[i];
  }
}

// --- Glob ---

const VB6_EXTS = new Set(Object.keys(CONTAINER_MAP));
const SOURCE_EXTS = new Set(['.twin', ...VB6_EXTS]);

async function globSources(dir) {
  const results = [];
  async function walk(current, rel) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'Packages') continue;
        await walk(fullPath, relPath);
      } else if (SOURCE_EXTS.has(path.extname(entry.name).toLowerCase())) {
        results.push({ fullPath, relativePath: relPath });
      }
    }
  }
  await walk(dir, '');
  results.sort((a, b) => {
    const dirA = path.dirname(a.relativePath);
    const dirB = path.dirname(b.relativePath);
    if (dirA !== dirB) return dirA.localeCompare(dirB);
    return path.basename(a.relativePath).localeCompare(path.basename(b.relativePath));
  });
  return results;
}

// --- Main ---

async function main() {
  if (doSync) {
    console.log('Syncing packages from TWINSERV...');
    const result = await syncPackages(packagesRoot);
    console.log(
      `Sync: ${result.added.length} added, ${result.updated.length} updated, ` +
      `${result.removed.length} removed, ${result.unchanged.length} unchanged` +
      (result.failed.length ? `, ${result.failed.length} failed` : ''),
    );
    for (const f of result.failed) {
      console.warn(`  FAILED: ${f.symbol}: ${f.error}`);
    }
    if (!doIndex) return;
  }

  await fs.mkdir(outDir, { recursive: true });

  const entries = await fs.readdir(packagesRoot, { withFileTypes: true });
  const packageDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourcesDir = path.join(packagesRoot, entry.name, 'Sources');
    try {
      const stat = await fs.stat(sourcesDir);
      if (stat.isDirectory()) packageDirs.push(entry.name);
    } catch { /* no Sources dir */ }
  }
  packageDirs.sort();

  console.log(`Found ${packageDirs.length} packages`);

  let totalFiles = 0;
  let totalDecls = 0;

  for (const pkg of packageDirs) {
    const sourcesDir = path.join(packagesRoot, pkg, 'Sources');
    const sourceFiles = await globSources(sourcesDir);

    const fileResults = [];
    let pkgDecls = 0;

    for (const { fullPath, relativePath } of sourceFiles) {
      const raw = await fs.readFile(fullPath, 'utf-8');
      const ext = path.extname(fullPath).toLowerCase();

      let content = raw;
      if (VB6_EXTS.has(ext)) {
        ({ content } = preprocessVB6(raw, ext));
      }

      const logicalLines = lex(content);
      const { declarations, collectEnums, allEnums } = extract(logicalLines);
      collectEnums(declarations, relativePath);

      function countDecls(nodes) {
        let c = 0;
        for (const n of nodes) {
          c++;
          if (n.children) c += countDecls(n.children);
        }
        return c;
      }

      pkgDecls += countDecls(declarations);
      fileResults.push({ relativePath, declarations, enums: allEnums });
    }

    const md = emitMarkdown(pkg, fileResults);
    const outPath = path.join(outDir, `${pkg}.md`);
    await fs.writeFile(outPath, md, 'utf-8');

    totalFiles += sourceFiles.length;
    totalDecls += pkgDecls;
    console.log(`  ${pkg}: ${sourceFiles.length} files, ${pkgDecls} declarations`);
  }

  console.log(`\nDone. ${packageDirs.length} packages, ${totalFiles} files, ${totalDecls} declarations.`);
  console.log(`Output: ${path.resolve(outDir)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
