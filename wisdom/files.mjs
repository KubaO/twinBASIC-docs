// files.mjs — how wisdom writes and reads the state files it keeps between runs.
//
// A state file is written to `<file>.tmp` and renamed over the old one, so a
// write cut off part way leaves the previous file whole.  A JSON state file
// that does not parse is reported by its path, not as a bare SyntaxError.

import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'

/**
 * Write `text` to `path` through a temp file and a rename.  The caller makes
 * sure the folder exists.
 */
export function writeFileAtomic(path, text) {
  const tmpPath = path + '.tmp'
  writeFileSync(tmpPath, text)
  renameSync(tmpPath, path)
}

/**
 * Parse the JSON file at `path`, or return `fallback` when there is none.  A
 * file that does not parse throws an error that names it, followed by
 * `remedy`, which says what deleting the file costs.
 */
export function readJsonFile(path, fallback, remedy) {
  if (!existsSync(path)) return fallback
  const text = readFileSync(path, 'utf-8')
  try {
    return JSON.parse(text)
  } catch (err) {
    throw new Error(`${path} is not valid JSON (${err.message}). ${remedy}`)
  }
}
