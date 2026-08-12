import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { SyncBaseMode, SyncBaseResult, SyncTarget } from '@worktree/contracts'
import { runGit } from './exec.js'
import { refreshBaseBranch } from './base.js'
import {
  countMergeCommits,
  fetchBaseBranch,
  getConflictedFiles,
  getCurrentBranch,
  getDefaultBranch,
  getGitDir,
  getUpstream,
  mergeWouldBeClean,
  refExists,
  shortRefName,
  type GitActionResult,
} from './git.js'

/**
 * A rebase/merge takes minutes on a big repo with hooks; the 30s default would
 * kill it mid-flight and leave exactly the half-applied state this is meant to
 * prevent.
 */
const SYNC_TIMEOUT_MS = 10 * 60 * 1000

/** Ref namespace holding the pre-sync HEAD of each branch, so the state before
 *  a sync stays reachable (and out of gc's reach) even after a rebase. */
const BACKUP_REF_PREFIX = 'refs/worktree-manager/pre-sync'

/** How each mode reads once it has landed, for the summary line. */
const PAST_TENSE: Record<SyncBaseMode, string> = {
  ff: 'Fast-forwarded to',
  rebase: 'Rebased onto',
  merge: 'Merged',
}

type InProgress = 'rebase' | 'merge' | 'cherry-pick' | 'revert' | 'bisect'

/**
 * Files git leaves in the git dir while an operation is mid-flight. Starting a
 * second one on top produces exactly the "cannot rebase" mess this replaces, so
 * the sync refuses instead.
 */
const IN_PROGRESS_MARKERS: { marker: string; operation: InProgress }[] = [
  { marker: 'rebase-merge', operation: 'rebase' },
  { marker: 'rebase-apply', operation: 'rebase' },
  { marker: 'MERGE_HEAD', operation: 'merge' },
  { marker: 'CHERRY_PICK_HEAD', operation: 'cherry-pick' },
  { marker: 'REVERT_HEAD', operation: 'revert' },
  { marker: 'BISECT_LOG', operation: 'bisect' },
]

/** Where git parks the autostash for each operation. Present after an abort only
 *  if git failed to put the changes back, which is the one case worth rescuing. */
const AUTOSTASH_FILES = [
  'MERGE_AUTOSTASH',
  join('rebase-merge', 'autostash'),
  join('rebase-apply', 'autostash'),
]

function inProgressOperation(gitDir: string | undefined): InProgress | undefined {
  if (!gitDir) return undefined
  for (const { marker, operation } of IN_PROGRESS_MARKERS) {
    if (existsSync(join(gitDir, marker))) return operation
  }
  return undefined
}

async function revParse(cwd: string, rev: string): Promise<string | undefined> {
  const { stdout, exitCode } = await runGit(cwd, ['rev-parse', rev])
  return exitCode === 0 && stdout ? stdout : undefined
}

/** Raw porcelain output, used only to prove the working tree came back intact. */
async function porcelain(cwd: string): Promise<string> {
  const { stdout } = await runGit(cwd, ['status', '--porcelain', '-uall'], { raw: true })
  return stdout
}

function backupRefFor(branch: string): string {
  // Ref names forbid a lot of what branch names allow only in theory, but
  // slashes nest fine and the rest is safest collapsed.
  const safe = branch.replace(/[^A-Za-z0-9._/-]/g, '_').replace(/\.\.+/g, '_')
  return `${BACKUP_REF_PREFIX}/${safe}`
}

/**
 * Git normally re-applies its own autostash when an operation is aborted. If it
 * did not, the changes are still sitting in a dangling commit named by the
 * autostash file — move it onto the stash list so `git stash list` finds it
 * rather than leaving it reachable only from a file nobody knows to look at.
 */
async function rescueAutostash(cwd: string, gitDir: string | undefined): Promise<boolean> {
  if (!gitDir) return false
  for (const file of AUTOSTASH_FILES) {
    const path = join(gitDir, file)
    if (!existsSync(path)) continue
    const sha = (await readFile(path, 'utf8').catch(() => '')).trim()
    if (!sha) continue
    const { exitCode } = await runGit(cwd, [
      'stash',
      'store',
      '-m',
      'worktree-manager: uncommitted changes rescued from an aborted sync',
      sha,
    ])
    if (exitCode === 0) return true
  }
  return false
}

export interface SyncWithBaseOptions {
  /** The worktree to sync. */
  cwd: string
  /** The repository's configured base branch (short name). Unused when the
   *  target is `upstream` — that one is read off the branch itself. */
  baseBranch: string
  /** Which ref to bring in: this branch's own upstream, or the base branch. */
  target?: SyncTarget
  /** `ff` only fast-forwards, `rebase` replays this branch on top of the ref,
   *  `merge` merges the ref in. */
  mode?: SyncBaseMode
}

/** The ref a sync brings in, once it has been fetched and resolved. */
interface SyncTargetRef {
  /** Full ref, e.g. `refs/remotes/origin/main`. */
  fullRef: string
  /** Display form, e.g. `origin/main`. */
  ref: string
}

/**
 * Resolve what to sync from, fetching it first so the operation always targets
 * what origin has right now rather than whatever was last pulled into this
 * clone. Returns the reason instead when there is nothing to sync from.
 */
async function resolveSyncTarget(
  cwd: string,
  branch: string,
  target: SyncTarget,
  baseBranch: string
): Promise<{ target?: SyncTargetRef; error?: string }> {
  if (target === 'upstream') {
    const upstream = await getUpstream(cwd)
    if (!upstream) {
      return { error: `${branch} is not tracking a remote branch, so there is nothing to pull.` }
    }
    // Local upstreams (a branch tracking another local branch) have nothing to
    // fetch; remote ones are force-updated exactly as a normal fetch would.
    if (upstream.ref.startsWith('refs/remotes/')) {
      const fetched = await runGit(cwd, [
        'fetch',
        '--no-tags',
        upstream.remote,
        `+refs/heads/${upstream.remoteBranch}:${upstream.ref}`,
      ])
      if (fetched.exitCode !== 0 && !(await refExists(cwd, upstream.ref))) {
        return {
          error: `Could not fetch ${upstream.short}: ${fetched.stderr || fetched.stdout || 'fetch failed'}`,
        }
      }
    }
    return { target: { fullRef: upstream.ref, ref: upstream.short } }
  }

  const snapshot = await refreshBaseBranch(cwd, baseBranch).catch(() => undefined)
  const fullRef = snapshot?.mergeRef
  if (!fullRef) {
    return {
      error: snapshot?.fetchError
        ? `Could not resolve ${baseBranch}: ${snapshot.fetchError}`
        : `Could not find ${baseBranch} locally or on origin.`,
    }
  }
  if (fullRef === `refs/heads/${branch}`) {
    return { error: `${branch} is the base branch and has no remote ref to sync from.` }
  }
  return { target: { fullRef, ref: shortRefName(fullRef) } }
}

/** Commits on HEAD that `ref` does not have — what a fast-forward trips over. */
async function countAhead(cwd: string, ref: string): Promise<number> {
  const { stdout, exitCode } = await runGit(cwd, ['rev-list', '--count', `${ref}..HEAD`])
  if (exitCode !== 0) return 0
  return Number.parseInt(stdout || '0', 10) || 0
}

/**
 * Bring a worktree up to date with its base branch without ever putting it in a
 * state the user has to dig out of by hand.
 *
 * The contract, in order of importance:
 *  1. Uncommitted work is never lost. Git's own `--autostash` carries it across
 *     the operation and restores it on abort; if that restore ever fails, the
 *     changes are pushed onto the stash list instead of left dangling.
 *  2. Conflicts roll the whole thing back. The worktree is returned to the exact
 *     commit and working tree it started from, with no rebase left in progress —
 *     the caller gets the conflicting paths to show instead.
 *  3. The pre-sync HEAD is pinned to a ref before anything runs, so even a
 *     failure mode nobody anticipated leaves a way back.
 */
export async function syncWithBase(options: SyncWithBaseOptions): Promise<SyncBaseResult> {
  const { cwd, baseBranch } = options
  const mode: SyncBaseMode = options.mode ?? 'rebase'
  const target: SyncTarget = options.target ?? 'base'
  const blocked = (output: string): SyncBaseResult => ({
    success: false,
    outcome: 'blocked',
    mode,
    target,
    output,
    conflictedFiles: [],
    stashed: false,
  })

  const gitDir = await getGitDir(cwd).catch(() => undefined)

  const existing = inProgressOperation(gitDir)
  if (existing) {
    return blocked(
      `A ${existing} is already in progress in this worktree. Finish or abort it before syncing.`
    )
  }

  const branch = await getCurrentBranch(cwd).catch(() => 'HEAD')
  if (branch === 'HEAD') {
    return blocked('This worktree is on a detached HEAD. Check out a branch before syncing.')
  }

  const resolved = await resolveSyncTarget(cwd, branch, target, baseBranch)
  if (!resolved.target) return blocked(resolved.error ?? 'Could not resolve what to sync from.')
  const { fullRef: baseFullRef, ref: baseRef } = resolved.target

  const behind = await runGit(cwd, ['rev-list', '--count', `HEAD..${baseFullRef}`])
  const behindCount = Number.parseInt(behind.stdout || '0', 10) || 0
  if (behind.exitCode === 0 && behindCount === 0) {
    return {
      success: true,
      outcome: 'up-to-date',
      mode,
      target,
      baseRef,
      output: `Already up to date with ${baseRef}.`,
      conflictedFiles: [],
      stashed: false,
    }
  }

  const previousHead = await revParse(cwd, 'HEAD')
  const beforeTree = await porcelain(cwd)
  // Autostash only carries tracked changes; untracked files are left alone (and
  // a rebase that would clobber one refuses outright rather than losing it).
  const stashed = beforeTree
    .split('\n')
    .some((line) => line.trim().length > 0 && !line.startsWith('??'))
  const backupRef = backupRefFor(branch)
  if (previousHead) {
    await runGit(cwd, ['update-ref', backupRef, previousHead]).catch(() => undefined)
  }
  const shortPreviousHead = previousHead?.slice(0, 7)
  const recovery = previousHead
    ? `The previous state is pinned at ${backupRef} (${shortPreviousHead}) — \`git reset --hard ${backupRef}\` restores it.`
    : undefined

  const args =
    mode === 'rebase'
      ? ['rebase', '--autostash', baseFullRef]
      : mode === 'ff'
        ? // Explicitly ff-only: a plain merge would happily write a merge commit
          // here (and `merge.ff = false` makes it do so even when it need not),
          // which is precisely what the user did *not* click.
          ['merge', '--ff-only', '--autostash', baseFullRef]
        : ['merge', '--autostash', '--no-edit', baseFullRef]
  const result = await runGit(cwd, args, { timeout: SYNC_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 })

  const settled: Omit<SyncBaseResult, 'success' | 'outcome' | 'output' | 'conflictedFiles'> = {
    mode,
    target,
    baseRef,
    stashed,
    ...(previousHead ? { backupRef, previousHead: previousHead.slice(0, 7) } : {}),
  }

  if (result.exitCode !== 0) {
    const conflictedFiles = await getConflictedFiles(cwd)
    const gitSaid = (result.stderr || result.stdout || '').trim()

    // Undo whatever git started. `--abort` also puts the autostash back, which is
    // why the operation is aborted before anything else is attempted. Without a
    // git dir to inspect, abort the operation that was actually launched — it is
    // a no-op if nothing is in progress.
    const stuck = gitDir ? inProgressOperation(gitDir) : mode === 'rebase' ? 'rebase' : 'merge'
    if (stuck === 'rebase') await runGit(cwd, ['rebase', '--abort']).catch(() => undefined)
    else if (stuck === 'merge') await runGit(cwd, ['merge', '--abort']).catch(() => undefined)

    // Belt and braces: if HEAD moved anyway, put it back by hand.
    let headNow = await revParse(cwd, 'HEAD')
    if (previousHead && headNow !== previousHead) {
      await runGit(cwd, ['reset', '--hard', previousHead]).catch(() => undefined)
      headNow = await revParse(cwd, 'HEAD')
    }

    const rescued = await rescueAutostash(cwd, gitDir)
    // Only claim the rollback was complete after checking that it was.
    const restored = headNow === previousHead && (await porcelain(cwd)) === beforeTree
    const untouched = restored ? ' — nothing was changed' : ''

    // A rebase conflicts far more readily than a merge — it replays each commit
    // against a moved base, so one old commit can collide even when the branch
    // as a whole does not. Rather than leave the user to guess, find out.
    let recommendedMode: SyncBaseMode | undefined
    let advice: string
    // A fast-forward all but always fails one way: this branch has commits of
    // its own, so the two histories have to be reconciled rather than skipped
    // over. Git's own wording for that is `fatal: Not possible to fast-forward`
    // plus a wall of hints, which is exactly the dead end this replaces. Only
    // that cause gets a recommendation — anything else (an untracked file in the
    // way, say) is not something another mode would fix.
    let divergedBy = 0
    if (mode === 'ff') {
      divergedBy = await countAhead(cwd, baseFullRef)
      const merges = divergedBy > 0 ? await countMergeCommits(cwd, baseFullRef) : 0
      if (divergedBy > 0) recommendedMode = merges > 0 ? 'merge' : 'rebase'
      advice =
        recommendedMode === 'rebase'
          ? `Rebasing replays your ${divergedBy} commit${divergedBy === 1 ? '' : 's'} on top of ${baseRef} — the button is now set to Rebase, so just click it.`
          : recommendedMode === 'merge'
            ? `This branch contains merge commits a rebase would replay one by one, so merge ${baseRef} in instead — the button is now set to Merge.`
            : `Fast-forwarding to ${baseRef} was refused, and not because the branches diverged — the git output above says why.`
    } else if (mode === 'rebase') {
      const mergeClean = await mergeWouldBeClean(cwd, baseFullRef)
      if (mergeClean === true) {
        recommendedMode = 'merge'
        advice = `Merging ${baseRef} instead applies cleanly — the button is now set to Merge, so just click it.`
      } else if (mergeClean === false) {
        advice = `Merging ${baseRef} hits the same conflict, so these edits genuinely overlap and have to be resolved by hand.`
      } else {
        advice = 'Try merging instead, or resolve the conflicts by running the rebase yourself.'
      }
    } else {
      advice = 'These edits genuinely overlap — resolve them by running the merge yourself.'
    }

    const lines: string[] = []
    if (conflictedFiles.length > 0) {
      lines.push(
        `${mode === 'rebase' ? 'Rebase onto' : 'Merge from'} ${baseRef} hit conflicts in ${conflictedFiles.length} file(s)${untouched}.`,
        conflictedFiles.slice(0, 10).map((file) => `  • ${file}`).join('\n')
      )
      if (conflictedFiles.length > 10) lines.push(`  …and ${conflictedFiles.length - 10} more`)
      lines.push(advice)
    } else if (mode === 'ff' && divergedBy > 0) {
      lines.push(
        `${branch} and ${baseRef} have both moved on — ${divergedBy} commit${divergedBy === 1 ? '' : 's'} here that ${baseRef} does not have, and ${behindCount} there that this branch does not. A fast-forward cannot bridge that${untouched}.`,
        advice
      )
    } else {
      lines.push(`Could not sync with ${baseRef}${untouched}.`)
      if (gitSaid) lines.push(gitSaid)
    }
    if (rescued) {
      lines.push(
        'Your uncommitted changes could not be put back automatically and were saved to `git stash list` — run `git stash pop` to restore them.'
      )
    } else if (!restored) {
      lines.push(
        'Heads up: this worktree does not look exactly as it did before. Check `git status` and `git stash list`.'
      )
    }
    if (recovery) lines.push(recovery)

    return {
      ...settled,
      success: false,
      outcome: conflictedFiles.length > 0 ? 'conflict' : 'blocked',
      output: lines.join('\n'),
      conflictedFiles,
      ...(recommendedMode ? { recommendedMode } : {}),
    }
  }

  // The operation landed. The one remaining hazard is git failing to re-apply
  // its own autostash, which it reports by keeping the changes on the stash list.
  const conflictedFiles = await getConflictedFiles(cwd)
  const restoreFailed =
    conflictedFiles.length > 0 || /autostash resulted in conflicts/i.test(result.stderr)
  if (restoreFailed) {
    const lines = [
      `${PAST_TENSE[mode]} ${baseRef}, but re-applying your uncommitted changes conflicted.`,
      'Nothing is lost: they are both in the working tree (with conflict markers) and on the stash. Resolve the markers and run `git stash drop`, or run `git reset --hard` then `git stash pop` to start the restore over.',
    ]
    if (conflictedFiles.length > 0) {
      lines.push(conflictedFiles.slice(0, 10).map((file) => `  • ${file}`).join('\n'))
    }
    if (recovery) lines.push(recovery)
    return {
      ...settled,
      success: true,
      outcome: 'restore-conflict',
      output: lines.join('\n'),
      conflictedFiles,
    }
  }

  const summary = `${PAST_TENSE[mode]} ${baseRef} (${behindCount} commit${behindCount === 1 ? '' : 's'})${stashed ? ', uncommitted changes restored' : ''}.`
  return {
    ...settled,
    success: true,
    outcome: 'synced',
    output: recovery ? `${summary}\n${recovery}` : summary,
    conflictedFiles: [],
  }
}

/**
 * Bring the repository's base branch up to origin.
 *
 * Which is two different operations wearing one name: when the base is checked
 * out in this worktree it is a working-tree move, and goes through the sync
 * engine above so uncommitted work is carried across and a failure rolls back.
 * Anywhere else it is a ref update, which git only allows as a fast-forward.
 *
 * A local base that has drifted ahead of origin used to dead-end here on git's
 * `Not possible to fast-forward`; those commits are by definition unpushed, so
 * replaying them on top of origin is both safe and what was meant.
 */
export async function updateBaseBranch(cwd: string, baseBranch: string): Promise<GitActionResult> {
  let base = baseBranch
  const localBaseExists = await refExists(cwd, `refs/heads/${base}`)
  const remoteBaseExists = await refExists(cwd, `refs/remotes/origin/${base}`)
  if (!localBaseExists && !remoteBaseExists) {
    const defaultBranch = await getDefaultBranch(cwd)
    if (!defaultBranch) {
      return { success: false, output: 'Could not determine a base branch to update' }
    }
    base = defaultBranch
  }

  const current = await getCurrentBranch(cwd)
  if (current !== base) return fetchBaseBranch(cwd, base)

  let result = await syncWithBase({ cwd, baseBranch: base, target: 'upstream', mode: 'ff' })
  // The fast-forward was refused because the two have diverged, and the engine
  // has already worked out which of rebase/merge reconciles them.
  if (!result.success && result.recommendedMode) {
    const fallback = await syncWithBase({
      cwd,
      baseBranch: base,
      target: 'upstream',
      mode: result.recommendedMode,
    })
    result = fallback.success
      ? { ...fallback, output: `${base} had diverged from origin.\n${fallback.output}` }
      : fallback
  }
  return { success: result.success, output: result.output }
}
