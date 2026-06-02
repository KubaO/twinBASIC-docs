import fs from 'node:fs/promises';
import path from 'node:path';

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

// --- Lexer ---

function lex(fileContent) {
  const raw = fileContent.replace(/^﻿/, '');
  const physicalLines = raw.split(/\r?\n/);
  const result = [];

  let i = 0;
  while (i < physicalLines.length) {
    const startLine = i + 1; // 1-based
    let joinedCode = '';
    let joinedRaw = '';

    for (;;) {
      const physLine = physicalLines[i] ?? '';
      i++;

      // character-by-character strip
      let code = '';
      let inString = false;
      for (let c = 0; c < physLine.length; c++) {
        const ch = physLine[c];
        if (inString) {
          if (ch === '"') {
            if (physLine[c + 1] === '"') {
              c++; // escaped quote — skip both
            } else {
              inString = false;
              code += '""'; // placeholder
            }
          }
          // else skip string content
        } else {
          if (ch === "'") break; // rest is comment
          if (ch === '"') {
            inString = true;
          } else {
            code += ch;
          }
        }
      }

      joinedCode += code;
      joinedRaw += (joinedRaw ? '\n' : '') + physLine;

      // check continuation: _ preceded by whitespace at end of stripped code
      const contMatch = joinedCode.match(/\s_\s*$/);
      if (contMatch) {
        joinedCode = joinedCode.slice(0, contMatch.index) + ' ';
        if (i >= physicalLines.length) break;
        // continue to next physical line
      } else {
        break;
      }
    }

    const trimmed = joinedCode.trim();
    if (trimmed) {
      result.push({ line: startLine, text: trimmed, rawText: joinedRaw });
    }
  }

  return result;
}

// --- Extractor ---

const ATTR_SKIP = new Set(['UseGetLastError', 'MustBeQualified']);

function scanAttributes(rawText) {
  const attrs = [];
  let description = null;

  // find each [...] block (may contain comma-separated attributes)
  const bracketRe = /\[([^\]]+)\]/g;
  let bm;
  while ((bm = bracketRe.exec(rawText)) !== null) {
    const inner = bm[1];
    // split by commas, but not commas inside parentheses
    const parts = [];
    let depth = 0, start = 0;
    for (let c = 0; c < inner.length; c++) {
      if (inner[c] === '(') depth++;
      else if (inner[c] === ')') depth--;
      else if (inner[c] === ',' && depth === 0) {
        parts.push(inner.slice(start, c).trim());
        start = c + 1;
      }
    }
    parts.push(inner.slice(start).trim());

    for (const part of parts) {
      const am = part.match(/^(\w+)(?:\((.+)\))?$/);
      if (!am) continue;
      const name = am[1];
      const value = am[2]?.trim() ?? null;
      if (ATTR_SKIP.has(name)) continue;
      if (name === 'Description') {
        if (value) {
          const strMatch = value.match(/"([^"]*)"/);
          if (strMatch && strMatch[1]) description = strMatch[1];
        }
        continue;
      }
      if (value && /^"[0-9A-Fa-f-]{36}"$/.test(value)) {
        attrs.push(name);
      } else if (value !== null) {
        attrs.push(`${name}(${value})`);
      } else {
        attrs.push(name);
      }
    }
  }
  return { attrs, description };
}

function isAttributeOnlyLine(text) {
  // after stripping all [...] blocks, only whitespace remains
  return /^\s*(\[[^\]]*\]\s*,?\s*)+\s*$/.test(text);
}

function extract(logicalLines) {
  const roots = [];
  const containerStack = [];
  const allEnums = [];
  let inProcedure = false;

  let pendingAttrs = [];
  let pendingDescription = null;

  function currentContainer() {
    return containerStack.length > 0 ? containerStack[containerStack.length - 1] : null;
  }
  function addChild(node) {
    const parent = currentContainer();
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }
  function consumeAttrs(node) {
    if (pendingAttrs.length) node.attrs = [...pendingAttrs];
    if (pendingDescription) node.description = pendingDescription;
    pendingAttrs = [];
    pendingDescription = null;
  }

  for (const { line, text, rawText } of logicalLines) {
    let m;

    // scan attributes from rawText for this line
    const lineAttrInfo = scanAttributes(rawText);

    // check if this is an attribute-only line
    if (isAttributeOnlyLine(text)) {
      pendingAttrs.push(...lineAttrInfo.attrs);
      if (lineAttrInfo.description) pendingDescription = lineAttrInfo.description;
      continue;
    }

    // inline attributes: if line has attrs AND a declaration, merge them in
    if (lineAttrInfo.attrs.length || lineAttrInfo.description) {
      pendingAttrs.push(...lineAttrInfo.attrs);
      if (lineAttrInfo.description) pendingDescription = lineAttrInfo.description;
    }

    // strip leading attribute brackets from text for pattern matching
    const stripped = text.replace(/^\s*(\[[^\]]*\]\s*,?\s*)*/, '').trim();

    // Priority 1: Container ends
    if ((m = stripped.match(/^End\s+(Module|Class|Interface|Enum|Type|CoClass)\b/i))) {
      const kind = m[1];
      if (/^(Sub|Function|Property)$/i.test(kind)) {
        // shouldn't happen here but safety
      } else {
        // pop matching container
        for (let s = containerStack.length - 1; s >= 0; s--) {
          if (containerStack[s].kind.toLowerCase() === kind.toLowerCase()) {
            containerStack.splice(s, 1);
            break;
          }
        }
      }
      pendingAttrs = [];
      pendingDescription = null;
      continue;
    }

    // Priority 2: CoClass interface references (only inside CoClass)
    // match against original text (not stripped) since [Default]/[Source] are the key markers
    const cur = currentContainer();
    if (cur && cur.kind === 'CoClass') {
      if ((m = text.match(/(Default|Source).*Interface\s+(\w+)/i))) {
        const refText = text.replace(/^\s*/, '').replace(/\s+/g, ' ');
        const node = { kind: 'CoClassInterface', name: m[2], line, signature: refText, children: [] };
        // signature already includes [Default]/[Source] — don't duplicate as attrs
        pendingAttrs = [];
        pendingDescription = null;
        addChild(node);
        continue;
      }
    }

    // Priority 3: Container starts (Interface suppressed inside CoClass)
    if ((m = stripped.match(/^(?:Public|Private|Protected)?\s*Module\s+(\w+)/i))) {
      const node = { kind: 'Module', name: m[1], line, children: [] };
      consumeAttrs(node);
      addChild(node);
      containerStack.push(node);
      continue;
    }
    if ((m = stripped.match(/^(?:Public|Private|Protected)?\s*Class\s+(\w+)/i))) {
      const node = { kind: 'Class', name: m[1], line, children: [] };
      consumeAttrs(node);
      addChild(node);
      containerStack.push(node);
      continue;
    }
    if (!(cur && cur.kind === 'CoClass') &&
        (m = stripped.match(/^(?:Public|Private)?\s*Interface\s+(\w+)(?:\s+Extends\s+(\S+))?/i))) {
      const node = { kind: 'Interface', name: m[1], line, extends: m[2] || null, children: [] };
      consumeAttrs(node);
      addChild(node);
      containerStack.push(node);
      continue;
    }
    if ((m = stripped.match(/^(?:Public|Private)?\s*Enum\s+(\w+)/i))) {
      const node = { kind: 'Enum', name: m[1], line, children: [], members: [] };
      consumeAttrs(node);
      addChild(node);
      containerStack.push(node);
      continue;
    }
    if ((m = stripped.match(/^(?:Public|Private)?\s*Type\s+(\w+)/i))) {
      const node = { kind: 'Type', name: m[1], line, children: [] };
      consumeAttrs(node);
      addChild(node);
      containerStack.push(node);
      continue;
    }
    if ((m = stripped.match(/^CoClass\s+(\w+)/i))) {
      const node = { kind: 'CoClass', name: m[1], line, children: [] };
      consumeAttrs(node);
      addChild(node);
      containerStack.push(node);
      continue;
    }

    // Priority 4: Procedure ends
    if ((m = stripped.match(/^End\s+(Sub|Function|Property)\b/i))) {
      inProcedure = false;
      pendingAttrs = [];
      pendingDescription = null;
      continue;
    }

    // If inside a procedure body, only look for nested Type/Enum (already handled above)
    if (inProcedure) {
      pendingAttrs = [];
      pendingDescription = null;
      continue;
    }

    // Priority 5: Declare
    if ((m = stripped.match(/^(?:Public\s+|Private\s+|Protected\s+|Friend\s+)?Declare(?:Wide)?\s+(?:PtrSafe\s+)?(Sub|Function)\s+(\w+)\s+Lib\s+"([^"]*)"/i))) {
      const subOrFunc = m[1];
      const name = m[2];
      const lib = m[3];
      let returnType = null;
      if (/function/i.test(subOrFunc)) {
        const rtm = stripped.match(/\)\s+As\s+(\w[\w.]*(?:\(Of\s+[^)]+\))?)/i);
        if (rtm) returnType = rtm[1];
      }
      const sig = returnType ? `Declare ${subOrFunc} ${name}` : `Declare ${subOrFunc} ${name}`;
      const node = { kind: 'Declare', subKind: subOrFunc, name, line, lib, returnType, signature: sig };
      consumeAttrs(node);
      addChild(node);
      continue;
    }

    // Priority 6: Const
    if ((m = stripped.match(/^(?:Public|Private)?\s*Const\s+(\w+)/i))) {
      const node = { kind: 'Const', name: m[1], line };
      consumeAttrs(node);
      addChild(node);
      continue;
    }

    // Priority 7: Event
    if ((m = stripped.match(/^(?:Public|Private|Protected)?\s*Event\s+(\w+)/i))) {
      const node = { kind: 'Event', name: m[1], line };
      consumeAttrs(node);
      addChild(node);
      continue;
    }

    // Priority 8: Sub/Function
    if ((m = stripped.match(/^(?:Public|Private|Protected|Friend)?\s*(?:Static\s+)?(Sub|Function)\s+(\w+)/i))) {
      const subOrFunc = m[1];
      const name = m[2];
      let returnType = null;
      if (/function/i.test(subOrFunc)) {
        const rtm = stripped.match(/\)\s+As\s+(\w[\w.]*(?:\(Of\s+[^)]+\))?)/i);
        if (rtm) returnType = rtm[1];
      }
      const node = { kind: subOrFunc, name, line, returnType };
      consumeAttrs(node);
      addChild(node);
      // interface/type members are bodyless signatures — don't enter procedure mode
      if (!(cur && (cur.kind === 'Interface' || cur.kind === 'Type'))) {
        inProcedure = true;
      }
      continue;
    }

    // Priority 9: Property
    if ((m = stripped.match(/^(?:Public|Private|Protected|Friend)?\s*Property\s+(Get|Let|Set)\s+(\w+)/i))) {
      const accessor = m[1];
      const name = m[2];
      let returnType = null;
      if (/get/i.test(accessor)) {
        const rtm = stripped.match(/\)\s+As\s+(\w[\w.]*(?:\(Of\s+[^)]+\))?)/i);
        if (rtm) returnType = rtm[1];
      }
      const node = { kind: 'Property', accessor, name, line, returnType };
      consumeAttrs(node);
      addChild(node);
      if (!(cur && (cur.kind === 'Interface' || cur.kind === 'Type'))) {
        inProcedure = true;
      }
      continue;
    }

    // Priority 10: Implements / Inherits
    if ((m = stripped.match(/^Implements\s+(\S+)/i))) {
      const node = { kind: 'Implements', name: m[1], line };
      consumeAttrs(node);
      addChild(node);
      continue;
    }
    if ((m = stripped.match(/^Inherits\s+(\S+)/i))) {
      const node = { kind: 'Inherits', name: m[1], line };
      consumeAttrs(node);
      addChild(node);
      continue;
    }

    // Priority 11: Enum members (only inside Enum)
    if (cur && cur.kind === 'Enum') {
      if ((m = stripped.match(/^(\w+)\s*(?:=\s*(.+))?$/))) {
        cur.members.push({ name: m[1], value: m[2]?.trim() ?? null });
        pendingAttrs = [];
        pendingDescription = null;
        continue;
      }
    }

    // Priority 12: Fields (only inside Class/Type, not in procedure)
    if (cur && (cur.kind === 'Class' || cur.kind === 'Type')) {
      if ((m = stripped.match(/^(Public|Protected)\s+(WithEvents\s+)?(\w+)\s+As\s+/i))) {
        const withEvents = !!m[2];
        const name = m[3];
        // skip if name is a keyword that would have been caught above
        const node = { kind: 'Field', name, line, withEvents };
        consumeAttrs(node);
        addChild(node);
        continue;
      }
    }

    // non-matching, non-blank line → clear pending attrs
    if (stripped) {
      pendingAttrs = [];
      pendingDescription = null;
    }
  }

  // collect all enums from the tree
  function collectEnums(nodes, filePath) {
    for (const node of nodes) {
      if (node.kind === 'Enum' && node.members) {
        allEnums.push({ name: node.name, line: node.line, members: node.members, file: filePath });
      }
      if (node.children) collectEnums(node.children, filePath);
    }
  }

  return { declarations: roots, collectEnums, allEnums };
}

// --- Emitter ---

function formatSignature(node) {
  switch (node.kind) {
    case 'Module':
    case 'Class':
    case 'Type':
    case 'CoClass':
      return `${node.kind} ${node.name}`;
    case 'Interface':
      return node.extends ? `Interface ${node.name} Extends ${node.extends}` : `Interface ${node.name}`;
    case 'Enum':
      return `Enum ${node.name}`;
    case 'Declare': {
      let sig = `Declare ${node.subKind} ${node.name}`;
      if (node.returnType) sig += `() As ${node.returnType}`;
      return sig;
    }
    case 'Sub':
    case 'Function': {
      let sig = `${node.kind} ${node.name}`;
      if (node.returnType) sig += `() As ${node.returnType}`;
      return sig;
    }
    case 'Property': {
      let sig = `Property ${node.accessor} ${node.name}`;
      if (node.returnType) sig += `() As ${node.returnType}`;
      return sig;
    }
    case 'Const':
      return `Const ${node.name}`;
    case 'Event':
      return `Event ${node.name}`;
    case 'Implements':
      return `Implements ${node.name}`;
    case 'Inherits':
      return `Inherits ${node.name}`;
    case 'Field':
      return node.withEvents ? `WithEvents ${node.name}` : node.name;
    case 'CoClassInterface':
      return node.signature || `Interface ${node.name}`;
    default:
      return node.name;
  }
}

function emitNode(node, depth, lines) {
  const indent = '  '.repeat(depth);
  let entry = `${indent}- L${node.line}: \`${formatSignature(node)}\``;

  if (node.kind === 'Enum' && node.members) {
    const count = node.members.length;
    const anchor = node.name.toLowerCase();
    entry += ` (${count} member${count !== 1 ? 's' : ''}) — [full listing](#${anchor})`;
  }

  if (node.attrs && node.attrs.length) {
    entry += ` \`[${node.attrs.join(', ')}]\``;
  }
  if (node.description) {
    entry += ` — ${node.description}`;
  }

  lines.push(entry);

  if (node.children) {
    for (const child of node.children) {
      emitNode(child, depth + 1, lines);
    }
  }
}

function emitMarkdown(packageName, fileResults) {
  const lines = [`# ${packageName}`, ''];

  for (const { relativePath, declarations } of fileResults) {
    if (!declarations.length) continue;
    lines.push(`## ${relativePath}`, '');
    for (const decl of declarations) {
      emitNode(decl, 0, lines);
    }
    lines.push('');
  }

  // Enum Details chapter
  const allEnums = [];
  for (const { relativePath, enums } of fileResults) {
    for (const e of enums) {
      allEnums.push({ ...e, file: relativePath });
    }
  }

  if (allEnums.length) {
    lines.push('## Enum Details', '');
    for (const e of allEnums) {
      lines.push(`### ${e.name}`);
      lines.push(`_${e.file}, L${e.line}_`, '');
      lines.push('| Value | Name |');
      lines.push('|-------|------|');
      for (const mem of e.members) {
        lines.push(`| ${mem.value ?? ''} | ${mem.name} |`);
      }
      lines.push('');
    }
  }

  return lines.join('\n');
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
