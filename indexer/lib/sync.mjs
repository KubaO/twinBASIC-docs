import { readFile, writeFile, mkdir, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { queryPackages, downloadPackage } from './twinserv-client.mjs';
import { parseTwinpack } from './twinpack-parser.mjs';

async function dirExists(path) {
  try { await access(path); return true; } catch { return false; }
}

function latestVersion(pkg) {
  return pkg.versions[pkg.versions.length - 1];
}

function versionString(v) {
  return `${v.versionMajor}.${v.versionMinor}.${v.versionRevision}.${v.versionBuild}`;
}

async function loadManifest(packagesDir) {
  try {
    return JSON.parse(await readFile(join(packagesDir, 'manifest.json'), 'utf8'));
  } catch {
    return { syncedAt: null, packages: {} };
  }
}

async function extractTree(entry, destDir) {
  if (entry.mark2 === 0x07) return;

  if (entry.kind === 'file') {
    await writeFile(join(destDir, entry.name), entry.content);
    return;
  }

  const dir = join(destDir, entry.name);
  await mkdir(dir, { recursive: true });
  if (entry.children) {
    for (const child of entry.children) {
      await extractTree(child, dir);
    }
  }
}

async function syncPackages(packagesDir, { concurrency = 4 } = {}) {
  await mkdir(packagesDir, { recursive: true });

  const manifest = await loadManifest(packagesDir);
  const { public: packages } = await queryPackages();

  const added = [];
  const updated = [];
  const removed = [];
  const unchanged = [];

  const remoteIds = new Set();
  const toDownload = [];

  for (const pkg of packages) {
    const latest = latestVersion(pkg);
    const id = pkg.projectId;
    remoteIds.add(id);

    const ver = versionString(latest);
    const cached = manifest.packages[id];

    if (!cached) {
      toDownload.push({ pkg, version: latest, reason: 'added' });
    } else if (cached.version !== ver) {
      toDownload.push({ pkg, version: latest, reason: 'updated' });
    } else if (!await dirExists(join(packagesDir, cached.symbol))) {
      toDownload.push({ pkg, version: latest, reason: 'updated' });
    } else {
      unchanged.push(cached.symbol);
    }
  }

  for (const [id, info] of Object.entries(manifest.packages)) {
    if (!remoteIds.has(id)) {
      removed.push(info.symbol);
      await rm(join(packagesDir, info.symbol), { recursive: true, force: true });
      delete manifest.packages[id];
    }
  }

  const failed = [];

  async function processDownload({ pkg, version, reason }) {
    const symbol = version.symbol;
    const id = pkg.projectId;

    const oldInfo = manifest.packages[id];
    if (oldInfo && oldInfo.symbol !== symbol) {
      await rm(join(packagesDir, oldInfo.symbol), { recursive: true, force: true });
    }

    let buf, root;
    try {
      buf = await downloadPackage(id, version);
      root = parseTwinpack(buf);
    } catch (e) {
      failed.push({ symbol, error: e.message });
      return;
    }

    const pkgDir = join(packagesDir, symbol);
    await rm(pkgDir, { recursive: true, force: true });
    await mkdir(pkgDir, { recursive: true });

    if (root.children) {
      for (const child of root.children) {
        await extractTree(child, pkgDir);
      }
    }

    manifest.packages[id] = {
      symbol,
      publisher: pkg.publisher,
      version: versionString(version),
      publishedDate: version.publishedDate,
      publishedTime: version.publishedTime,
    };

    if (reason === 'added') added.push(symbol);
    else updated.push(symbol);
  }

  for (let i = 0; i < toDownload.length; i += concurrency) {
    const batch = toDownload.slice(i, i + concurrency);
    await Promise.all(batch.map(item => processDownload(item)));
  }

  manifest.syncedAt = new Date().toISOString();
  await writeFile(
    join(packagesDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
  );

  return { added, updated, removed, unchanged, failed };
}

export { syncPackages };
