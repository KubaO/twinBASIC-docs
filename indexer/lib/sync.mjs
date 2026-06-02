import { readFile } from 'node:fs/promises';
import { queryPackages, downloadPackage } from './twinserv-client.mjs';
import { parseTwinpack, collectFiles } from './twinpack-parser.mjs';

function latestVersion(pkg) {
  return pkg.versions[pkg.versions.length - 1];
}

function versionString(v) {
  return `${v.versionMajor}.${v.versionMinor}.${v.versionRevision}.${v.versionBuild}`;
}

async function loadManifest(manifestPath) {
  try {
    return JSON.parse(await readFile(manifestPath, 'utf8'));
  } catch {
    return { syncedAt: null, packages: {} };
  }
}

async function fetchUpdatedSources(manifestPath, { concurrency = 4 } = {}) {
  const manifest = await loadManifest(manifestPath);
  const { public: packages } = await queryPackages();

  const toIndex = [];
  const unchanged = [];
  const removed = [];
  const failed = [];

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
    } else {
      unchanged.push(cached.symbol);
    }
  }

  for (const [id, info] of Object.entries(manifest.packages)) {
    if (!remoteIds.has(id)) {
      removed.push({ id, symbol: info.symbol });
      delete manifest.packages[id];
    }
  }

  async function processDownload({ pkg, version, reason }) {
    const symbol = version.symbol;
    const id = pkg.projectId;

    let buf, root;
    try {
      buf = await downloadPackage(id, version);
      root = parseTwinpack(buf);
    } catch (e) {
      failed.push({ symbol, error: e.message });
      return;
    }

    const files = collectFiles(root);

    manifest.packages[id] = {
      symbol,
      publisher: pkg.publisher,
      version: versionString(version),
      publishedDate: version.publishedDate,
      publishedTime: version.publishedTime,
    };

    toIndex.push({ symbol, projectId: id, reason, versionInfo: version, files });
  }

  for (let i = 0; i < toDownload.length; i += concurrency) {
    const batch = toDownload.slice(i, i + concurrency);
    await Promise.all(batch.map(item => processDownload(item)));
  }

  manifest.syncedAt = new Date().toISOString();

  return { toIndex, unchanged, removed, failed, manifest };
}

export { fetchUpdatedSources };
