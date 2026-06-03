import fs from 'node:fs/promises';
import path from 'node:path';
import { compareWithManifest, fetchPackage, versionString } from './lib/sync.mjs';
import { compareBuiltinManifest, extractBuiltinPackages } from './lib/builtin-sync.mjs';
import { downloadRelease } from './lib/github-release.mjs';
import { preprocessVB6, CONTAINER_MAP } from './lib/vb6-preprocess.mjs';
import { lex } from './lib/lexer.mjs';
import { extract } from './lib/extractor.mjs';
import { emitMarkdown } from './lib/emitter.mjs';

// --- CLI ---

const args = process.argv.slice(2);
let outDir = './package-indexes/';
let builtinOutDir = './builtin-indexes/';
let savePackages = true;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) {
    outDir = args[++i];
  } else if (args[i] === '--builtin-out' && args[i + 1]) {
    builtinOutDir = args[++i];
  } else if (args[i] === '--dont-save-packages') {
    savePackages = false;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node indexer/twin-index.mjs [options]');
    console.log('');
    console.log('  Fetch packages from TWINSERV and twinBASIC releases, generate markdown indexes.');
    console.log('');
    console.log('Options:');
    console.log('  --out <dir>              TWINSERV output directory (default: ./package-indexes/)');
    console.log('  --builtin-out <dir>      Built-in package output directory (default: ./builtin-indexes/)');
    console.log('  --dont-save-packages     Skip writing package source files to <out>/packages/');
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
  const packagesDir = path.join(outDir, 'packages');

  // Phase 1: Fetch package index
  console.log('Fetching package index...');
  const { toDownload, unchanged, removed, manifest } = await compareWithManifest(manifestPath);

  // If saving packages, re-download any "unchanged" package whose folder is missing
  if (savePackages) {
    const missing = [];
    const stillUnchanged = [];
    for (const item of unchanged) {
      try {
        await fs.access(path.join(packagesDir, item.symbol));
        stillUnchanged.push(item);
      } catch {
        toDownload.push({ ...item, reason: 'missing-sources' });
        missing.push(item.symbol);
      }
    }
    unchanged.length = 0;
    unchanged.push(...stillUnchanged);
    if (missing.length) console.log(`  Missing sources: ${missing.join(', ')}`);
  }

  const added = toDownload.filter(p => p.reason === 'added');
  const updated = toDownload.filter(p => p.reason === 'updated');
  if (added.length) console.log(`  Add: ${added.map(p => p.symbol).join(', ')}`);
  if (updated.length) console.log(`  Update: ${updated.map(p => p.symbol).join(', ')}`);
  if (removed.length) console.log(`  Remove: ${removed.map(p => p.symbol).join(', ')}`);
  if (unchanged.length) console.log(`  ${unchanged.length} unchanged`);

  if (!toDownload.length && !removed.length) {
    console.log('\nUp to date.');
    await indexBuiltinPackages();
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

  // --- Built-in packages from twinBASIC GitHub releases ---
  await indexBuiltinPackages();
}

async function indexBuiltinPackages() {
  await fs.mkdir(builtinOutDir, { recursive: true });
  const manifestPath = path.join(builtinOutDir, 'manifest.json');
  const packagesDir = path.join(builtinOutDir, 'packages');

  // Phase 1: Check twinBASIC release
  console.log('\nChecking twinBASIC release...');
  const release = await compareBuiltinManifest(manifestPath);
  console.log(`  Tag: ${release.tag}`);

  // If saving packages, check for missing folders even when tag matches
  if (!release.needsUpdate && savePackages) {
    const symbols = Object.values(release.manifest.packages).map(p => p.symbol);
    const missing = [];
    for (const symbol of symbols) {
      try {
        await fs.access(path.join(packagesDir, symbol));
      } catch {
        missing.push(symbol);
      }
    }
    if (missing.length) {
      console.log(`  Missing source folders: ${missing.join(', ')}`);
      release.needsUpdate = true;
    }
  }

  if (!release.needsUpdate) {
    console.log(`  Built-in packages up to date (${release.tag}).`);
    return;
  }

  // Phase 2: Download release and extract built-in packages
  console.log('\nDownloading release...');
  const zipBuffer = await downloadRelease(release.assetUrl);
  const builtinPackages = extractBuiltinPackages(zipBuffer);
  console.log(`  Extracted ${builtinPackages.length} built-in packages`);

  // Phase 3: Index built-in packages
  console.log('\nIndexing built-in packages...');
  const builtinManifest = {
    syncedAt: new Date().toISOString(),
    twinbasicTag: release.tag,
    publishedAt: release.publishedAt,
    packages: {},
  };

  for (const pkg of builtinPackages) {
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
    await fs.writeFile(path.join(builtinOutDir, `${pkg.symbol}.md`), md, 'utf-8');

    if (savePackages) {
      for (const f of pkg.files) {
        const dest = path.join(packagesDir, pkg.symbol, f.relativePath);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.writeFile(dest, f.content);
      }
    }

    builtinManifest.packages[pkg.guid] = { symbol: pkg.symbol };
    console.log(`  ${pkg.symbol}: ${sourceFiles.length} files, ${declCount} declarations`);
  }

  await fs.writeFile(manifestPath, JSON.stringify(builtinManifest, null, 2) + '\n');
  console.log(`\nBuilt-in: ${builtinPackages.length} packages indexed.`);
  console.log(`Output: ${path.resolve(builtinOutDir)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
