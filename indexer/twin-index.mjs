import fs from 'node:fs/promises';
import path from 'node:path';
import { lex } from './lib/lexer.mjs';
import { extract } from './lib/extractor.mjs';
import { emitMarkdown } from './lib/emitter.mjs';

// --- CLI ---

const args = process.argv.slice(2);
let outDir = './package-indexes/';
let packagesRoot = '../tb-export/AllPackages/Packages';

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out' && args[i + 1]) {
    outDir = args[++i];
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log('Usage: node scripts/twin-index.mjs [--out <dir>] [<packages-root>]');
    console.log('  <packages-root>  defaults to ../tb-export/AllPackages/Packages');
    console.log('  --out <dir>      defaults to ./package-indexes/');
    process.exit(0);
  } else if (!args[i].startsWith('-')) {
    packagesRoot = args[i];
  }
}

// --- Main ---

async function globTwin(dir) {
  const results = [];
  async function walk(current, rel) {
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(fullPath, relPath);
      } else if (entry.name.endsWith('.twin')) {
        results.push({ fullPath, relativePath: relPath });
      }
    }
  }
  await walk(dir, '');
  // sort: directory first, then filename
  results.sort((a, b) => {
    const dirA = path.dirname(a.relativePath);
    const dirB = path.dirname(b.relativePath);
    if (dirA !== dirB) return dirA.localeCompare(dirB);
    return path.basename(a.relativePath).localeCompare(path.basename(b.relativePath));
  });
  return results;
}

async function main() {
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
    const twinFiles = await globTwin(sourcesDir);

    const fileResults = [];
    let pkgDecls = 0;

    for (const { fullPath, relativePath } of twinFiles) {
      const content = await fs.readFile(fullPath, 'utf-8');
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

    totalFiles += twinFiles.length;
    totalDecls += pkgDecls;
    console.log(`  ${pkg}: ${twinFiles.length} files, ${pkgDecls} declarations`);
  }

  console.log(`\nDone. ${packageDirs.length} packages, ${totalFiles} files, ${totalDecls} declarations.`);
  console.log(`Output: ${path.resolve(outDir)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
