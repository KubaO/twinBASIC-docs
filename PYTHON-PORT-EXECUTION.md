# Python Port: Execution Notes

How to actually drive the work in
[PYTHON-PORT-PLAN.md](PYTHON-PORT-PLAN.md). The plan describes *what*
to do; this file describes *how* to run the work end-to-end without
losing focus, breaking production, or papering over critical
checkpoints.

## Overall approach

The parallel-track strategy in the plan makes execution low-risk:
`book.bat` keeps producing the Node-built `_pdf/book.pdf` throughout
Phases 1-5, untouched. The new `pybook.bat` produces a sibling
`_pdf/book-py.pdf`. The cutover (Phase 6) is a single, reviewable
commit gated on acceptance. This means:

- You can't break production by accident while iterating.
- A/B comparison is just running both scripts.
- You can pause the port indefinitely between phases — nothing in
  flight blocks anything else.
- Rollback after cutover is one `git revert` of the Phase 6 commit.

**Drive one phase per Claude Code session, not all at once.** A
single conversation handling the full 1.5-3 days of work would lose
focus around the 3-hour mark as tool output crowds the context
window. Treat each phase as an atomic unit of work with its own
fresh session.

## Before you start

**Verify the Node build still works on the current branch.** If it's
broken now, fix that first; you don't want to chase a phantom port
bug that's actually pre-existing.

```cmd
docs\build.bat
docs\book.bat
```

Confirm `_pdf\book.pdf` is produced and opens correctly. **Record the
wall-clock total** somewhere — Phase 5.6 needs it for the
performance comparison.

**Confirm the worktree is clean** (`git status` should report nothing
to commit). All port work accumulates on the current branch
(`claude/busy-sammet-b2bd86`); a dirty starting state makes commit
boundaries muddier.

## Per-phase execution loop

For each phase 1-6:

1. **Open a fresh Claude Code session in this worktree.** The plan is
   self-contained enough that the new session doesn't need any
   conversational history.

2. **Brief the session.** Something like:

   > Execute Phase N from PYTHON-PORT-PLAN.md. Stop after the "Phase N
   > done when" check and report results. Do not proceed to Phase N+1.

   Adjust for special cases noted below (3.1 spike, Phase 6 gate).

3. **Review the diff.** `git diff` between your starting commit and
   the session's end state. Spot-check the major files; you don't have
   to read every line, but you should know what changed.

4. **Run the phase's "done when" verification yourself.** Don't trust
   the agent's claim that the checks passed — run the commands again
   in your own terminal and confirm.

5. **Commit.** One commit per phase, with a message like
   `Phase N: <short summary>`. Phase 3 gets two commits (one for 3.1
   spike, one for 3.2-3.10).

6. **Move on to the next phase.** No need to wrap up between phases
   beyond the commit.

## Critical checkpoints

These are the moments where blindly continuing causes the most pain.

### After 3.1 (the spike)

Only checkpoint that can invalidate the rest of the plan. After the
spike runs:

- pypdf preserved `/Dest` as a `NameObject` round-trip + viewer
  navigation works → continue with pypdf. Commit the spike script
  (handy as documentation) and proceed to 3.2.
- pypdf rewrote `/Dest` into an explicit destination array → stop.
  Decide between:
  - Switching the plan's PDF library to pikepdf and updating Phase 3
    accordingly. ~1 day of plan rewrite + roughly 2x the original
    Phase 3 estimate to execute.
  - Working around pypdf's behavior (e.g. resolving destinations to
    page indices ourselves before writing). Possible but fragile.

**Run the spike yourself, not via an agent.** The agent can write the
script in 30 minutes; you should run it, open the output PDF in a
real viewer, and click an outline entry to confirm it navigates. A
trusted-but-not-verified spike here causes hours of wasted Phase 3
work later.

### End of Phase 3

Don't just rely on `compare_pdfs.py`. Open `_pdf/book-py.pdf` in
Acrobat or Chrome (not just `pdfinfo`) and:

- Confirm the outline panel is populated with the expected H1-H4
  hierarchy.
- Click 10 outline entries sampled across depths 1-4. Each should
  jump to the correct page in the document body.

If any sampled destination is wrong, the bug is in the `/Dest` /
`/Dests` wiring and must be fixed before Phase 4-5 build on top of
it.

### End of Phase 5

The gate for "ready to consider cutover":

- `python docs/lib/compare_pdfs.py _pdf/book.pdf _pdf/book-py.pdf`
  returns exit 0.
- Wall-clock for `pybook.bat` is within ±20% of `book.bat`.
- Spot-checked the Python PDF visually in a viewer at least once.

Don't proceed to Phase 6 the same day Phase 5 finishes unless you're
explicitly accepting the bake-in skip. See "Bake-in" below.

### Phase 6 gate (6.0)

The plan's 6.0 step describes the gate explicitly. Re-read it before
starting the cutover commit. The bake-in question is yours to
answer; the gate is there to make you pause and answer it
consciously.

## Commit and PR strategy

**Commits.** One per phase, with 3.1 as its own commit. Sample messages:

- `Phase 1: Python scaffolding, pyproject.toml, render_book.py skeleton`
- `Phase 2: Playwright-driven browser driver`
- `Phase 3.1 spike: confirm pypdf preserves /Dest name references`
- `Phase 3: Port outline tree builder to pypdf`
- `Phase 4: Port metadata setter to pypdf`
- `Phase 5: Add pybook.bat parallel build path + compare_pdfs.py`
- `Phase 6: Cut book.bat over to Python; remove Node toolchain`

**PRs.** I'd recommend two:

- **PR 1: Phases 1-5.** Adds the Python toolchain alongside the Node
  one. Safe to merge to `staging` whenever you're confident in the
  Python output, because it doesn't change production. Reviewers can
  focus on "is the new code correct" without worrying about cutover
  risk.
- **PR 2: Phase 6.** Removes the Node toolchain and makes `book.bat`
  call Python. Small diff, easy to review, easy to revert. Open this
  PR only after PR 1 has merged and you've decided the bake-in
  period is sufficient.

If you'd rather ship as one PR, that's fine too — the parallel-track
structure still helps the reviewer read the diff phase-by-phase.

## What to do if something goes wrong

The parallel-track structure makes failure modes much less scary
than they'd otherwise be:

**During Phases 1-5.** Production is untouched. There is no urgency.
Take as long as you need; abandon the work midway if you want; come
back to it weeks later if needed. `book.bat` still works.

**After Phase 6 cutover, before merging.** Discard the Phase 6
commit (`git reset HEAD~1` or branch surgery). `book.bat` returns to
calling Node.

**After Phase 6 cutover, after merging.** `git revert` the Phase 6
commit, push, done. The dependency state is recoverable because
`docs/package.json` (or the deleted version of it) is still in git
history.

## Bake-in for the cutover

The plan doesn't prescribe a fixed bake-in period because it depends
on how much risk you're willing to absorb. Two reasonable settings:

**Aggressive (same-day cutover).** `compare_pdfs.py` passes, you've
done a visual spot-check, you're done. Phase 6 lands the same day as
Phase 5. Acceptable if the project has low downstream-consumer risk
(e.g. only you build the book, you trust the comparison).

**Conservative (multi-day bake-in).** Merge PR 1, then live with
`pybook.bat` for a week of real build cycles before opening PR 2.
Each time the book gets rebuilt for real reasons (a docs edit, a
PDF-relevant change), run both scripts and diff. Open PR 2 once
you've gone several cycles without finding anything wrong.

I'd default to **at least a few real build cycles**. The cutover is
fundamentally cheap to delay and irreversible (mod git revert) once
done, so erring on the side of bake-in is sensible.

## Concrete starting sequence

1. **Now:** confirm `docs\book.bat` builds successfully on current
   branch; record the wall-clock total.
2. **Phase 1 (1-2 h):** open fresh session, brief it on Phase 1.
   Review, commit.
3. **Phase 2 (3-5 h):** open fresh session, brief it on Phase 2.
   Review, commit.
4. **Phase 3.1 spike (1-2 h):** open fresh session asking it to
   *write* the spike script per 3.1; **run it yourself**, open the
   output PDF, make the pypdf vs pikepdf decision. Commit.
5. **Phase 3.2-3.10 (4-6 h):** open fresh session, brief it on
   3.2-3.10 noting the spike outcome. Review carefully — this is
   the hardest phase. Commit.
6. **Phase 4 (1-2 h):** fresh session, brief, review, commit.
7. **Phase 5 (1-3 h):** fresh session, brief, review,
   `compare_pdfs.py`, commit.
8. **Open PR 1 against `staging`.** Title: "Python port of book PDF
   pipeline (parallel install)". Land it.
9. **Bake-in** for as long as you've decided is appropriate.
10. **Phase 6 (1-2 h):** fresh session, brief it on Phase 6 noting
    the bake-in completed, review the cutover commit, **open
    `_pdf/book.pdf` one more time in a viewer**, commit.
11. **Open PR 2 against `staging`.** Title: "Cut book PDF build
    over to Python". Land it.

## Tactical notes

- **Don't update `perf/` until Phase 6.** Tempting to fix
  cross-references as you go, but doing it in one pass at the end
  is cleaner.
- **Don't merge to `staging` between phases** during PR 1 unless
  you genuinely want intermediate states landed. The `claude/...`
  branch can hold all of Phases 1-5; one PR drops them all together.
- **If a phase reveals a gap in the plan**, update
  PYTHON-PORT-PLAN.md before continuing. Future-you reading the
  plan will thank present-you, and the discovery-then-fix loop is
  the actual purpose of writing a plan first.
- **The Playwright Chromium download is ~170 MB and one-time.** If
  Phase 1 finishes quickly but Chromium is still downloading,
  that's fine — it's not blocking Phase 2 work setup.
- **A `pdfinfo` command** lives in Poppler tools on Windows; if you
  don't have it installed, Adobe Acrobat or Chrome both show the
  same fields under Document Properties.
