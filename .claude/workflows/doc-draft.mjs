export const meta = {
  name: 'doc-draft',
  description: 'Draft documentation pages from an analyze change report',
  phases: [
    { title: 'Triage', detail: 'Read report, resolve paths', model: 'haiku' },
    { title: 'Draft', detail: 'Write doc pages (one agent per symbol)', model: 'sonnet' },
    { title: 'Index', detail: 'Update package index pages', model: 'sonnet' },
  ],
}

const REPORT_PATH = 'indexer/.packages/report.json'

const GROUP_DIR = {
  'default': 'Default',
  'built-in': 'Built-In',
  'contributed': 'Contributed',
}

const EXAMPLES_BY_KIND = {
  Sub: [
    'docs/Reference/Default/VBA/Interaction/AppActivate.md',
    'docs/Reference/Default/VBA/Interaction/Beep.md',
  ],
  Function: [
    'docs/Reference/Default/VBA/Interaction/AppActivate.md',
    'docs/Reference/Default/VBA/Interaction/Beep.md',
  ],
  Declare: [
    'docs/Reference/Default/VBA/Interaction/AppActivate.md',
    'docs/Reference/Default/VBA/Interaction/Beep.md',
  ],
  Property: [
    'docs/Reference/Default/VBRUN/AmbientProperties/BackColor.md',
    'docs/Reference/Default/VBA/DateTime/Date.md',
  ],
  Field: [
    'docs/Reference/Default/VBRUN/AmbientProperties/BackColor.md',
    'docs/Reference/Default/VBA/DateTime/Date.md',
  ],
  Const: [
    'docs/Reference/Built-In/CustomControls/Enumerations/WindowState.md',
  ],
  Event: [
    'docs/Reference/Default/VB/CheckBox/index.md',
  ],
  Class: [
    'docs/Reference/Built-In/CEF/CefBrowser/index.md',
    'docs/Reference/Built-In/WinEventLogLib/EventLog.md',
  ],
  Interface: [
    'docs/Reference/Built-In/CEF/CefBrowser/index.md',
    'docs/Reference/Built-In/WinEventLogLib/EventLog.md',
  ],
  CoClass: [
    'docs/Reference/Built-In/CEF/CefBrowser/index.md',
    'docs/Reference/Built-In/WinEventLogLib/EventLog.md',
  ],
  CoClassInterface: [
    'docs/Reference/Default/VBRUN/AmbientProperties/BackColor.md',
  ],
  Module: [
    'docs/Reference/Built-In/Assert/Exact.md',
  ],
  Enum: [
    'docs/Reference/Built-In/CustomControls/Enumerations/WindowState.md',
  ],
  Type: [
    'docs/Reference/Default/VBRUN/PropertyBag/index.md',
  ],
}

const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          package: { type: 'string' },
          group: { type: 'string' },
          groupDir: { type: 'string' },
          version: { type: 'string' },
          module: { type: 'string' },
          symbol: { type: 'string' },
          kind: { type: 'string' },
          signature: { type: 'string' },
          sourcePath: { type: 'string' },
          targetPath: { type: 'string' },
          existingPagePath: { type: 'string' },
          reason: { type: 'string' },
          oldSignature: { type: 'string' },
          newSignature: { type: 'string' },
        },
        required: ['action', 'package', 'group', 'groupDir', 'version',
                   'module', 'symbol', 'kind', 'sourcePath', 'targetPath'],
      },
    },
    flagged: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          symbol: { type: 'string' },
          module: { type: 'string' },
          docPage: { type: 'string' },
        },
        required: ['symbol', 'module'],
      },
    },
  },
  required: ['tasks', 'flagged'],
}

// --- Phase 1: Triage ---

phase('Triage')
log('Reading analyze report and resolving file paths...')

const packageFilter = typeof args === 'string' ? args : null

const triage = await agent(
  `Read the file ${REPORT_PATH} and prepare documentation tasks.

The report is a JSON array of package objects, each with: package, group, mode, from, to, tasks[], summary.
${packageFilter ? 'Only process the package named "' + packageFilter + '". Skip all others.' : ''}

For each task in each package report:

1. SKIP tasks with action "flag_removal" — add them to the "flagged" list.

2. For "create" and "update" tasks, resolve paths:
   - groupDir: "default"→"Default", "built-in"→"Built-In", "contributed"→"Contributed"
   - version: the report's "to" field
   - sourcePath: indexer/.packages/{group}/{package}/sources/{task.file}
     (group is lowercase: "default", "built-in", "contributed")
   - targetPath: MUST be relative to docs/Reference/{groupDir}/{package}/ — do NOT include that prefix.
     Examples: "RegCls/DeleteKey.md", "Enumerations/WindowState.md", "EventLog.md"
     WRONG: "docs/Reference/Built-In/WinReg/RegCls/DeleteKey.md"
     Check the filesystem to determine:
     * For member symbols (Sub/Function/Property/Event/Field/Declare/Const):
       If docs/Reference/{groupDir}/{package}/{task.module}/ exists as a directory → {module}/{symbol}.md
       If {module}.md exists as a single file → target IS that file (member documented inline)
       Otherwise → create folder-style: {module}/{symbol}.md
     * For container symbols (Class/Module/Interface/CoClass):
       Follow existing package conventions (folder-style or single-file)
     * For Enum: if Enumerations/ subdirectory exists → Enumerations/{symbol}.md. Otherwise → {symbol}.md
     * For Type: {symbol}.md
   - existingPagePath: for "update" tasks, use the task's doc_page field
   - reason, oldSignature, newSignature: carry over from update tasks

Do NOT write intermediate output to files. Return the data via the
structured output schema only — your response is consumed by the
workflow directly. Files like enriched_tasks.json, final_output.json,
etc. should never be created.

Return the flat enriched task list and flagged items.`,
  { schema: TRIAGE_SCHEMA, label: 'triage', model: 'haiku' }
)

const actionable = (triage.tasks || []).filter(
  t => t.action === 'create' || t.action === 'update'
)

if (!actionable.length) {
  log('No documentation tasks to draft.')
  if (triage.flagged && triage.flagged.length) {
    log(triage.flagged.length + ' symbols flagged for removal review.')
  }
  return { status: 'no-tasks', flagged: triage.flagged || [] }
}

log(actionable.length + ' tasks to draft.')

// --- Phase 2: Draft ---

phase('Draft')

await pipeline(
  actionable,
  (task, _, i) => agent(buildDraftPrompt(task), {
    label: 'draft:' + task.symbol,
    phase: 'Draft',
    model: 'sonnet',
  })
)

// --- Phase 3: Index updates ---

const pkgSet = new Set()
const packages = []
for (const t of actionable) {
  if (!pkgSet.has(t.package)) {
    pkgSet.add(t.package)
    packages.push({
      name: t.package,
      group: t.group,
      groupDir: t.groupDir,
      version: t.version,
    })
  }
}

phase('Index')

await parallel(packages.map(pkg => () =>
  agent(buildIndexPrompt(pkg, actionable.filter(t => t.package === pkg.name)), {
    label: 'index:' + pkg.name,
    phase: 'Index',
    model: 'sonnet',
  })
))

log('Done. ' + actionable.length + ' pages drafted, ' + packages.length + ' index pages updated.')

return {
  drafted: actionable.length,
  flagged: triage.flagged || [],
  packages: packages.map(p => p.name),
}

// --- Helper functions ---

function buildDraftPrompt(task) {
  const examples = EXAMPLES_BY_KIND[task.kind] || EXAMPLES_BY_KIND['Sub']
  const exList = examples.map(p => '   - ' + p).join('\n')
  const docsBase = 'docs/Reference/' + task.groupDir + '/' + task.package + '/'
  const fullTarget = docsBase + task.targetPath

  const lines = [
    'You are writing documentation for `' + task.symbol + '` from the `' + task.package + '` package.',
    '',
    'ACTION: ' + task.action,
    'PACKAGE: ' + task.package + ' (' + task.groupDir + ')',
    'MODULE/CONTAINER: ' + task.module,
    'SYMBOL: ' + task.symbol,
    'KIND: ' + task.kind,
  ]

  if (task.signature) lines.push('SIGNATURE: ' + task.signature)
  lines.push('SOURCE FILE: ' + task.sourcePath)
  lines.push('TARGET FILE: ' + fullTarget)

  if (task.action === 'update') {
    const existingPath = task.existingPagePath || fullTarget
    lines.push('EXISTING PAGE: ' + existingPath)
    if (task.reason) lines.push('REASON: ' + task.reason)
    if (task.oldSignature) lines.push('OLD SIGNATURE: ' + task.oldSignature)
    if (task.newSignature) lines.push('NEW SIGNATURE: ' + task.newSignature)
  }

  lines.push('')
  lines.push('STEPS:')
  lines.push('1. Read the source file at ' + task.sourcePath + ' to understand the symbol.')
  lines.push('2. Read WIP.md (repo root) for the page template skeleton and formatting conventions.')
  lines.push('3. Read these example pages for reference:')
  lines.push(exList)
  lines.push('4. Read the package index: ' + docsBase + 'index.md')
  if (task.action === 'update') {
    const existingPath = task.existingPagePath || fullTarget
    lines.push('5. Read the existing page at ' + existingPath + ' and preserve its structure.')
  }

  lines.push('')
  lines.push('DOCUMENTATION CONVENTIONS:')
  lines.push('- Frontmatter: title, parent, permalink, has_toc: false.')
  lines.push('  parent: MUST match the exact title: field of the parent page.')
  lines.push('  For member pages inside a container folder, read the container page to get its exact title (usually the bare name like "RegCls", NOT "RegCls Class").')
  lines.push('  For top-level container pages, use "' + task.package + ' Package".')
  lines.push('  permalink: follow the URL scheme in WIP.md (cross-section linking table).')
  lines.push('- Bold (**...**) for keywords/literals; italic (*...*) for placeholders.')
  lines.push('- Parameters: definition-list format (term on own line, : definition indented).')
  lines.push('- Code blocks: ```tb fence.')
  lines.push('- Sections: one-line description, Syntax, parameters, Remarks, Example, See Also.')
  lines.push('- Set vba_attribution: true ONLY if content derives from Microsoft VBA-Docs.')
  lines.push('')

  if (task.action === 'create') {
    lines.push('Write the COMPLETE markdown file using the Write tool at: ' + fullTarget)
  } else {
    lines.push('Update the file at ' + fullTarget + ' using the Edit tool.')
    lines.push('Preserve existing structure; change only what the update requires.')
  }

  return lines.join('\n')
}

function buildIndexPrompt(pkg, tasks) {
  const created = tasks.filter(t => t.action === 'create')
  const updated = tasks.filter(t => t.action === 'update')
  const indexPath = 'docs/Reference/' + pkg.groupDir + '/' + pkg.name + '/index.md'

  const lines = [
    'Update the package index page for ' + pkg.name + '.',
    '',
    'INDEX FILE: ' + indexPath,
    'NEW VERSION: ' + pkg.version,
    '',
  ]

  if (created.length) {
    lines.push('NEW SYMBOLS (' + created.length + '):')
    for (const t of created) {
      lines.push('  - ' + t.symbol + ' (' + t.kind + ') at ' + t.targetPath)
    }
    lines.push('')
  }
  if (updated.length) {
    lines.push('UPDATED SYMBOLS (' + updated.length + '):')
    for (const t of updated) {
      lines.push('  - ' + t.symbol + ' (' + t.kind + ')')
    }
    lines.push('')
  }

  lines.push('STEPS:')
  lines.push('1. Read the current index page at ' + indexPath + '.')
  lines.push('2. For each new symbol, add a bullet entry in the appropriate section')
  lines.push('   (Classes, Modules, Enumerations, Types, etc.).')
  lines.push('   Format: - [SymbolName](relative-link) -- one-line description')
  lines.push('   Place it alphabetically. Read the source file to write an accurate description.')
  lines.push('3. Add or update indexed_from in the YAML frontmatter to: ' + pkg.version)
  lines.push('4. Save with the Edit tool. Keep all existing content.')

  return lines.join('\n')
}
