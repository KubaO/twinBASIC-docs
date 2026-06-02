import fs from 'node:fs/promises';
import path from 'node:path';
import { fetchUpdatedSources } from './lib/sync.mjs';
import { preprocessVB6, CONTAINER_MAP } from './lib/vb6-preprocess.mjs';
import { lex } from './lib/lexer.mjs';
import { extract } from './lib/extractor.mjs';
import { emitMarkdown } from './lib/emitter.mjs';

// --- CLI ---

const args = process.argv.slice(2);
let outDir = './package-indexes/';
let packagesRoot = './package-indexes/packages';
let legacyDiskMode = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) {
    outDir = args[++i];
  } else if (args[i] === '--no-sync') {
    legacyDiskMode = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node indexer/twin-index.mjs [options] [<packages-root>]');
    console.log('');
    console.log('  Default: fetch from TWINSERV and index all packages in memory.');
    console.log('');
    console.log('Options:');
    console.log('  --no-sync          Index from disk only (legacy mode)');
    console.log('  --out <dir>        Output directory (default: ./package-indexes/)');
    console.log('  <packages-root>    Package source directory (with --no-sync)');
    process.exit(0);
  } else if (!args[i].startsWith('-')) {
    packagesRoot = args[i];
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

// --- Glob (legacy mode) ---

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
  await fs.mkdir(outDir, { recursive: true });

  if (legacyDiskMode) {
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

      const files = [];
      for (const { fullPath, relativePath } of sourceFiles) {
        const raw = await fs.readFile(fullPath, 'utf-8');
        files.push({ relativePath, content: raw });
      }

      const { fileResults, declCount } = indexFiles(files);

      const md = emitMarkdown(pkg, fileResults);
      const outPath = path.join(outDir, `${pkg}.md`);
      await fs.writeFile(outPath, md, 'utf-8');

      totalFiles += sourceFiles.length;
      totalDecls += declCount;
      console.log(`  ${pkg}: ${sourceFiles.length} files, ${declCount} declarations`);
    }

    console.log(`\nDone. ${packageDirs.length} packages, ${totalFiles} files, ${totalDecls} declarations.`);
    console.log(`Output: ${path.resolve(outDir)}`);
    return;
  }

  // Default mode: in-memory pipeline
  const manifestPath = path.join(outDir, 'manifest.json');
  console.log('Fetching packages from TWINSERV...');
  const result = await fetchUpdatedSources(manifestPath);

  const addedCount = result.toIndex.filter(p => p.reason === 'added').length;
  const updatedCount = result.toIndex.filter(p => p.reason === 'updated').length;
  console.log(
    `Sync: ${addedCount} added, ${updatedCount} updated, ` +
    `${result.removed.length} removed, ${result.unchanged.length} unchanged` +
    (result.failed.length ? `, ${result.failed.length} failed` : ''),
  );
  for (const f of result.failed) {
    console.warn(`  FAILED: ${f.symbol}: ${f.error}`);
  }

  let totalFiles = 0;
  let totalDecls = 0;

  for (const pkg of result.toIndex) {
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
    const outPath = path.join(outDir, `${pkg.symbol}.md`);
    await fs.writeFile(outPath, md, 'utf-8');

    totalFiles += sourceFiles.length;
    totalDecls += declCount;
    console.log(`  ${pkg.symbol}: ${sourceFiles.length} files, ${declCount} declarations`);
  }

  for (const { symbol } of result.removed) {
    const mdPath = path.join(outDir, `${symbol}.md`);
    try {
      await fs.unlink(mdPath);
      console.log(`  Removed: ${symbol}.md`);
    } catch { /* file didn't exist */ }
  }

  await fs.writeFile(manifestPath, JSON.stringify(result.manifest, null, 2) + '\n');

  console.log(
    `\nDone. ${result.toIndex.length} indexed, ${result.unchanged.length} unchanged, ` +
    `${result.removed.length} removed.`,
  );
  console.log(`Output: ${path.resolve(outDir)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
