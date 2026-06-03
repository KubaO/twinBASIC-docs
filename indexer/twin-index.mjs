import fs from 'node:fs/promises';
import path from 'node:path';
import { compareWithManifest, fetchPackage, versionString } from './lib/sync.mjs';
import { preprocessVB6, CONTAINER_MAP } from './lib/vb6-preprocess.mjs';
import { lex } from './lib/lexer.mjs';
import { extract } from './lib/extractor.mjs';
import { emitMarkdown } from './lib/emitter.mjs';

// --- CLI ---

const args = process.argv.slice(2);
let outDir = './package-indexes/';
let savePackages = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) {
    outDir = args[++i];
  } else if (args[i] === '--save-packages') {
    savePackages = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node indexer/twin-index.mjs [options]');
    console.log('');
    console.log('  Fetch packages from TWINSERV and generate markdown indexes.');
    console.log('');
    console.log('Options:');
    console.log('  --out <dir>        Output directory (default: ./package-indexes/)');
    console.log('  --save-packages    Also write package source files to <out>/packages/');
    process.exit(0);
  }
}

// --- Shared ---

const VB6_EXTS = new Set(Object.keys(CONTAINER_MAP));
const SOURCE_EXTS = new Set(['.twin', ...VB6_EXTS]);

function countDecls(nodes) {
  let c = 0;
  for (const n of nodes) {
    c++;
    if (n.children) c += countDecls(n.children);
  }
  return c;
}

function indexFiles(files) {
  const fileResults = [];
  let declCount = 0;

  for (const { relativePath, content } of files) {
    const ext = path.extname(relativePath).toLowerCase();

    let processedContent = content;
    if (VB6_EXTS.has(ext)) {
      ({ content: processedContent } = preprocessVB6(content, ext));
    }

    const logicalLines = lex(processedContent);
    const { declarations, collectEnums, allEnums } = extract(logicalLines);
    collectEnums(declarations, relativePath);

    declCount += countDecls(declarations);
    fileResults.push({ relativePath, declarations, enums: allEnums });
  }

  return { fileResults, declCount };
}

// --- Main ---

async function main() {
  await fs.mkdir(outDir, { recursive: true });
  const manifestPath = path.join(outDir, 'manifest.json');

  // Phase 1: Fetch package index
  console.log('Fetching package index...');
  const { toDownload, unchanged, removed, manifest } = await compareWithManifest(manifestPath);

  const added = toDownload.filter(p => p.reason === 'added');
  const updated = toDownload.filter(p => p.reason === 'updated');
  if (added.length) console.log(`  Add: ${added.map(p => p.symbol).join(', ')}`);
  if (updated.length) console.log(`  Update: ${updated.map(p => p.symbol).join(', ')}`);
  if (removed.length) console.log(`  Remove: ${removed.map(p => p.symbol).join(', ')}`);
  if (unchanged.length) console.log(`  ${unchanged.length} unchanged`);

  if (!toDownload.length && !removed.length) {
    console.log('\nUp to date.');
    return;
  }

  // Phase 2: Fetch packages
  const toIndex = [];
  const failed = [];
  if (toDownload.length) {
    console.log('\nFetching packages...');
    for (const item of toDownload) {
      try {
        const files = await fetchPackage(item.id, item.version);
        toIndex.push({ symbol: item.symbol, files });
        manifest.packages[item.id] = {
          symbol: item.symbol,
          publisher: item.pkg.publisher,
          version: versionString(item.version),
          publishedDate: item.version.publishedDate,
          publishedTime: item.version.publishedTime,
        };
        console.log(`  ${item.symbol}`);
      } catch (e) {
        failed.push({ symbol: item.symbol, error: e.message });
        console.warn(`  FAILED: ${item.symbol}: ${e.message}`);
      }
    }
  }

  // Phase 3: Index packages
  const packagesDir = path.join(outDir, 'packages');
  if (toIndex.length) {
    console.log('\nIndexing packages...');
    for (const pkg of toIndex) {
      const sourceFiles = pkg.files
        .filter(f => SOURCE_EXTS.has(path.extname(f.relativePath).toLowerCase()))
        .map(f => {
          const rel = f.relativePath.startsWith('Sources/')
            ? f.relativePath.slice('Sources/'.length)
            : f.relativePath;
          return { relativePath: rel, content: f.content.toString('utf-8') };
        });

      const { fileResults, declCount } = indexFiles(sourceFiles);
      const md = emitMarkdown(pkg.symbol, fileResults);
      await fs.writeFile(path.join(outDir, `${pkg.symbol}.md`), md, 'utf-8');

      if (savePackages) {
        for (const f of pkg.files) {
          const dest = path.join(packagesDir, pkg.symbol, f.relativePath);
          await fs.mkdir(path.dirname(dest), { recursive: true });
          await fs.writeFile(dest, f.content);
        }
      }

      console.log(`  ${pkg.symbol}: ${sourceFiles.length} files, ${declCount} declarations`);
    }
  }

  for (const { symbol } of removed) {
    try {
      await fs.unlink(path.join(outDir, `${symbol}.md`));
      console.log(`  Removed: ${symbol}.md`);
    } catch { /* didn't exist */ }
    if (savePackages) {
      await fs.rm(path.join(packagesDir, symbol), { recursive: true, force: true });
    }
  }

  manifest.syncedAt = new Date().toISOString();
  await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

  console.log(
    `\nDone. ${toIndex.length} indexed, ${unchanged.length} unchanged, ` +
    `${removed.length} removed.` +
    (failed.length ? ` ${failed.length} failed.` : ''),
  );
  console.log(`Output: ${path.resolve(outDir)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
