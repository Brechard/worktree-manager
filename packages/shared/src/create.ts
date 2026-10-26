import { lstat, mkdir, realpath, readFile, appendFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type {
  AppSettings,
  CreateWorktreeRequest,
  Repository,
  Worktree,
  WorktreeCreationPreview,
} from '@worktree/contracts'
import { runGit } from './exec.js'
import { getWorktreeList } from './git.js'
import { runShellCommand, commandEnv } from './command.js'

function slugForBranch(branch: string): string {
  return branch
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 90)
}

function worktreeId(path: string): string {
  let hash = 5381
  for (let i = 0; i < path.length; i++) hash = (hash * 33) ^ path.charCodeAt(i)
  return `id_${Math.abs(hash).toString(36)}_${basename(path).slice(0, 20)}`
}

async function exists(path: string): Promise<boolean> {
  return lstat(path).then(
    () => true,
    () => false
  )
}

function destination(
  request: CreateWorktreeRequest,
  repository: Repository,
  settings: AppSettings
): string {
  const location =
    request.location ?? repository.worktreeLocation ?? settings.defaultWorktreeLocation ?? 'sibling'
  const slug = slugForBranch(request.branch)
  if (!slug) throw new Error('Branch name cannot make a readable folder name.')
  if (location === 'sibling')
    return join(dirname(repository.path), `${basename(repository.path)}.worktrees`, slug)
  if (location === 'inside') return join(repository.path, '.worktrees', slug)
  if (location === 'managed')
    return join(homedir(), '.worktree-manager', basename(repository.path), slug)
  const parent =
    request.customParent ?? repository.worktreeCustomParent ?? settings.defaultWorktreeCustomParent
  if (!parent?.trim() || !isAbsolute(parent))
    throw new Error('Choose an absolute custom parent directory.')
  const resolvedParent = resolve(parent)
  const repoPath = resolve(repository.path)
  if (resolvedParent === repoPath || resolvedParent.startsWith(repoPath + '/'))
    throw new Error('Use “Inside project” for a destination within this repository.')
  return join(resolvedParent, slug)
}

export async function previewWorktreeCreation(
  request: CreateWorktreeRequest,
  repository: Repository,
  settings: AppSettings
): Promise<WorktreeCreationPreview> {
  let path = ''
  const branch = request.branch.trim()
  const startRef =
    request.mode === 'existing'
      ? branch
      : request.startRef?.trim() || repository.baseBranch || 'HEAD'
  try {
    if (!(await exists(repository.path))) throw new Error('The project checkout is missing.')
    const check = await runGit(repository.path, ['check-ref-format', '--branch', branch])
    if (check.exitCode !== 0) throw new Error('Enter a valid Git branch name.')
    path = destination({ ...request, branch }, repository, settings)
    if (await exists(path)) throw new Error(`Destination already exists: ${path}`)
    const entries = await getWorktreeList(repository.path)
    if (entries.some((entry) => resolve(entry.path) === resolve(path)))
      throw new Error('Git already has a worktree registered at this destination.')
    const local = await runGit(repository.path, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branch}`,
    ])
    if (request.mode === 'new' && local.exitCode === 0)
      throw new Error('This branch already exists. Select “Existing branch” or enter a new name.')
    if (request.mode === 'existing' && local.exitCode !== 0)
      throw new Error('This local branch does not exist. Select “New branch” to create it.')
    if (
      request.mode === 'existing' &&
      entries.some((entry) => entry.branch === branch && !entry.prunable)
    )
      throw new Error('This branch is already checked out in another worktree.')
    const source = await runGit(repository.path, [
      'rev-parse',
      '--verify',
      '--end-of-options',
      `${request.mode === 'existing' ? `refs/heads/${branch}` : startRef}^{commit}`,
    ])
    if (source.exitCode !== 0)
      throw new Error(`Starting ref “${startRef}” does not resolve to a commit.`)
    return { path, branch, startRef, sourceCommit: source.stdout }
  } catch (error) {
    return { path, branch, startRef, error: error instanceof Error ? error.message : String(error) }
  }
}

/** Git is given argv, never a shell command, and the commit is pinned to the previewed source. */
export async function createGitWorktree(
  request: CreateWorktreeRequest,
  repository: Repository,
  settings: AppSettings
): Promise<{ worktree?: Worktree; error?: string; warning?: string }> {
  const preview = await previewWorktreeCreation(request, repository, settings)
  if (preview.error || !preview.sourceCommit)
    return { error: preview.error ?? 'Starting commit is unavailable.' }
  if (request.expectedSourceCommit && request.expectedSourceCommit !== preview.sourceCommit)
    return { error: 'The starting ref moved since the preview. Review it and try again.' }
  await mkdir(dirname(preview.path), { recursive: true })
  // A custom parent may be a symlink. Resolve it after creation so the registered path is canonical.
  const parent = await realpath(dirname(preview.path))
  if (
    (request.location ?? repository.worktreeLocation ?? settings.defaultWorktreeLocation) ===
    'custom'
  ) {
    const canonicalRepo = await realpath(repository.path)
    if (parent === canonicalRepo || parent.startsWith(canonicalRepo + '/'))
      return { error: 'Use “Inside project” for a destination within this repository.' }
  }
  const path = join(parent, basename(preview.path))
  if (await exists(path)) return { error: `Destination already exists: ${path}` }
  const args =
    request.mode === 'new'
      ? ['worktree', 'add', '-b', preview.branch, '--', path, preview.sourceCommit]
      : ['worktree', 'add', '--', path, preview.branch]
  const result = await runGit(repository.path, args, {
    timeout: 120000,
    maxBuffer: 4 * 1024 * 1024,
  })
  if (result.exitCode !== 0)
    return { error: result.stderr || result.stdout || 'Git could not create the worktree.' }
  let warning: string | undefined
  let headCommit = preview.sourceCommit.slice(0, 7)
  try {
    const entries = await getWorktreeList(repository.path)
    const entry = entries.find(
      (item) => resolve(item.path) === path && item.branch === preview.branch && !item.prunable
    )
    if (!entry)
      warning =
        'Git created the worktree, but its registration could not be confirmed. Check Git before retrying.'
    else {
      headCommit = entry.head?.slice(0, 7) ?? headCommit
      if (request.mode === 'existing' && entry.head && entry.head !== preview.sourceCommit)
        warning =
          'The existing branch moved during creation. Review its current commit before working.'
    }
    if (
      (request.location ?? repository.worktreeLocation ?? settings.defaultWorktreeLocation) ===
      'inside'
    ) {
      const excludePath = await runGit(repository.path, ['rev-parse', '--git-path', 'info/exclude'])
      if (excludePath.exitCode === 0) {
        const absoluteExclude = resolve(repository.path, excludePath.stdout)
        const current = await readFile(absoluteExclude, 'utf8').catch(() => '')
        if (!current.split(/\r?\n/).includes('/.worktrees/')) {
          await appendFile(
            absoluteExclude,
            `${current.endsWith('\n') || !current ? '' : '\n'}/.worktrees/\n`
          )
        }
      }
    }
  } catch (error) {
    warning = `Git created the worktree, but final checks failed: ${error instanceof Error ? error.message : String(error)}`
  }
  return {
    worktree: {
      id: worktreeId(path),
      repositoryId: repository.id,
      path,
      branch: preview.branch,
      headCommit,
      isMain: false,
      lastModified: Date.now(),
      prunable: false,
    },
    ...(warning ? { warning } : {}),
  }
}

export async function runPostCreateSetup(repository: Repository, worktree: Worktree) {
  const command = repository.postCreateCommand?.trim()
  if (!command) return undefined
  const entries = await getWorktreeList(repository.path)
  const registered = entries.some(
    (entry) =>
      resolve(entry.path) === resolve(worktree.path) &&
      entry.branch === worktree.branch &&
      !entry.prunable
  )
  if (!registered || !(await exists(worktree.path)))
    return { success: false, output: 'This worktree is no longer registered in Git.' }
  return runShellCommand(command, {
    cwd: worktree.path,
    env: commandEnv({
      worktreePath: worktree.path,
      branch: worktree.branch,
      repoPath: repository.path,
      repoName: repository.name,
    }),
    timeoutSeconds: repository.postCreateTimeoutSeconds ?? 600,
  })
}
