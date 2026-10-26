import { afterEach, describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AppSettings, Repository, Worktree } from '@worktree/contracts'
import {
  createGitWorktree,
  previewWorktreeCreation,
  runPostCreateSetup,
  setupCommandForWorktree,
} from './create.js'

const fixtures: string[] = []
const git = (cwd: string, ...args: string[]) =>
  execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'wt-create-test-'))
  fixtures.push(root)
  const path = join(root, 'demo')
  await mkdir(path)
  git(path, 'init', '-q', '-b', 'main')
  git(path, 'config', 'user.email', 'test@example.invalid')
  git(path, 'config', 'user.name', 'Test')
  await writeFile(join(path, 'README.md'), 'synthetic\n')
  git(path, 'add', 'README.md')
  git(path, 'commit', '-q', '-m', 'initial')
  const repository: Repository = {
    id: 'repo',
    name: 'demo',
    path,
    baseBranch: 'main',
    favorite: false,
    actions: [],
  }
  const settings = { defaultWorktreeLocation: 'sibling' } as AppSettings
  return { root, repository, settings }
}

afterEach(async () => {
  for (const path of fixtures.splice(0)) await rm(path, { recursive: true, force: true })
})

describe('worktree creation', () => {
  test('creates a new branch beside the repo from the displayed commit', async () => {
    const { root, repository, settings } = await fixture()
    const request = { repositoryId: 'repo', mode: 'new' as const, branch: 'feature/port-slots' }
    const preview = await previewWorktreeCreation(request, repository, settings)
    expect(preview.path).toBe(join(root, 'demo.worktrees', 'feature-port-slots'))
    expect(preview.sourceCommit).toBe(git(repository.path, 'rev-parse', 'HEAD'))
    const created = await createGitWorktree(request, repository, settings)
    expect(created.error).toBeUndefined()
    expect(created.worktree?.branch).toBe('feature/port-slots')
    expect(git(created.worktree!.path, 'branch', '--show-current')).toBe('feature/port-slots')
    expect((await previewWorktreeCreation(request, repository, settings)).error).toContain(
      'Destination already exists'
    )
  })

  test('rejects invalid, checked-out, and missing branches without changing Git', async () => {
    const { repository, settings } = await fixture()
    expect(
      (
        await previewWorktreeCreation(
          { repositoryId: 'repo', mode: 'new', branch: '-oops' },
          repository,
          settings
        )
      ).error
    ).toContain('valid Git branch')
    expect(
      (
        await previewWorktreeCreation(
          { repositoryId: 'repo', mode: 'existing', branch: 'main' },
          repository,
          settings
        )
      ).error
    ).toContain('already checked out')
    expect(
      (
        await previewWorktreeCreation(
          { repositoryId: 'repo', mode: 'existing', branch: 'missing' },
          repository,
          settings
        )
      ).error
    ).toContain('does not exist')
    expect(
      (
        await previewWorktreeCreation(
          { repositoryId: 'repo', mode: 'new', branch: 'new', startRef: 'missing' },
          repository,
          settings
        )
      ).error
    ).toContain('does not resolve')
    expect(git(repository.path, 'branch', '--list', 'new')).toBe('')
  })

  test('supports internal and managed paths; internal contents are hidden from parent status', async () => {
    const { repository, settings } = await fixture()
    const inside = {
      repositoryId: 'repo',
      mode: 'new' as const,
      branch: 'inside',
      location: 'inside' as const,
    }
    expect((await createGitWorktree(inside, repository, settings)).worktree?.path).toBe(
      await realpath(join(repository.path, '.worktrees', 'inside'))
    )
    expect(git(repository.path, 'status', '--porcelain')).toBe('')
    const exclude = git(repository.path, 'rev-parse', '--git-path', 'info/exclude')
    expect(await readFile(join(repository.path, exclude), 'utf8')).toContain('/.worktrees/')
    const managedPreview = await previewWorktreeCreation(
      { repositoryId: 'repo', mode: 'new', branch: 'managed', location: 'managed' },
      repository,
      settings
    )
    expect(managedPreview.path).toContain('.worktree-manager/demo/managed')
    const internalCustom = await previewWorktreeCreation(
      {
        repositoryId: 'repo',
        mode: 'new',
        branch: 'custom-inside',
        location: 'custom',
        customParent: repository.path,
      },
      repository,
      settings
    )
    expect(internalCustom.error).toContain('Inside project')
  })

  test('setup runs only configured command in registered new root and can be retried', async () => {
    const { repository, settings } = await fixture()
    const created = await createGitWorktree(
      { repositoryId: 'repo', mode: 'new', branch: 'setup' },
      repository,
      settings
    )
    const worktree = created.worktree!
    expect(await runPostCreateSetup(repository, worktree)).toBeUndefined()
    repository.postCreateCommand =
      'printf "%s|%s|%s|%s" "$WORKTREE_PATH" "$WORKTREE_BRANCH" "$REPO_PATH" "$REPO_NAME" > setup.out'
    const result = await runPostCreateSetup(repository, worktree)
    expect(result?.success).toBe(true)
    expect(await readFile(join(worktree.path, 'setup.out'), 'utf8')).toBe(
      `${worktree.path}|setup|${repository.path}|demo`
    )
    repository.postCreateCommand = 'exit 7'
    expect((await runPostCreateSetup(repository, worktree))?.exitCode).toBe(7)
    expect(git(repository.path, 'branch', '--list', 'setup')).toContain('setup')
  })

  test('setup uses the creation override, including an explicit blank, without changing the project', async () => {
    const { repository, settings } = await fixture()
    repository.postCreateCommand = 'printf default > setup.out'

    const inherited = (
      await createGitWorktree(
        { repositoryId: 'repo', mode: 'new', branch: 'inherit' },
        repository,
        settings
      )
    ).worktree!
    expect(setupCommandForWorktree(repository, inherited)).toBe(repository.postCreateCommand)
    expect((await runPostCreateSetup(repository, inherited))?.success).toBe(true)
    expect(await readFile(join(inherited.path, 'setup.out'), 'utf8')).toBe('default')

    const custom = (
      await createGitWorktree(
        {
          repositoryId: 'repo',
          mode: 'new',
          branch: 'custom',
          postCreateCommandOverride: 'printf custom > setup.out',
        },
        repository,
        settings
      )
    ).worktree!
    expect(custom.postCreateCommandOverride).toBe('printf custom > setup.out')
    expect((await runPostCreateSetup(repository, custom))?.success).toBe(true)
    expect(await readFile(join(custom.path, 'setup.out'), 'utf8')).toBe('custom')

    const skipped = (
      await createGitWorktree(
        {
          repositoryId: 'repo',
          mode: 'new',
          branch: 'skip',
          postCreateCommandOverride: '',
        },
        repository,
        settings
      )
    ).worktree!
    expect(skipped.postCreateCommandOverride).toBe('')
    expect(setupCommandForWorktree(repository, skipped)).toBe('')
    expect(await runPostCreateSetup(repository, skipped)).toBeUndefined()
    expect(await readFile(join(skipped.path, 'setup.out')).catch(() => null)).toBeNull()
    expect(repository.postCreateCommand).toBe('printf default > setup.out')
  })

  test('a failed override retries its original command after the project default changes', async () => {
    const { repository, settings } = await fixture()
    repository.postCreateCommand = 'printf default > setup.out'
    const worktree = (
      await createGitWorktree(
        {
          repositoryId: 'repo',
          mode: 'new',
          branch: 'failed',
          postCreateCommandOverride: 'exit 7',
        },
        repository,
        settings
      )
    ).worktree!
    expect((await runPostCreateSetup(repository, worktree))?.exitCode).toBe(7)
    repository.postCreateCommand = 'printf changed > setup.out'
    expect(setupCommandForWorktree(repository, worktree)).toBe('exit 7')
    expect((await runPostCreateSetup(repository, worktree))?.exitCode).toBe(7)
    expect(await readFile(join(worktree.path, 'setup.out')).catch(() => null)).toBeNull()

    const inherited = (
      await createGitWorktree(
        { repositoryId: 'repo', mode: 'new', branch: 'default-retry' },
        repository,
        settings
      )
    ).worktree!
    repository.postCreateCommand = 'printf latest > setup.out'
    expect((await runPostCreateSetup(repository, inherited))?.success).toBe(true)
    expect(await readFile(join(inherited.path, 'setup.out'), 'utf8')).toBe('latest')
  })

  test('keeps the chosen command text but treats whitespace-only overrides as skip', () => {
    const repository = { postCreateCommand: 'printf default' } as Repository
    const worktree = { postCreateCommandOverride: '  printf custom\n' } as Worktree
    expect(setupCommandForWorktree(repository, worktree)).toBe('  printf custom\n')
    expect(
      setupCommandForWorktree(repository, { ...worktree, postCreateCommandOverride: ' \n ' })
    ).toBe('')
  })

  test('reuses an unchecked-out local branch and rejects a stale source preview', async () => {
    const { repository, settings } = await fixture()
    git(repository.path, 'branch', 'ready')
    const existing = await createGitWorktree(
      { repositoryId: 'repo', mode: 'existing', branch: 'ready' },
      repository,
      settings
    )
    expect(existing.worktree?.branch).toBe('ready')
    expect(
      (
        await previewWorktreeCreation(
          {
            repositoryId: 'repo',
            mode: 'new',
            branch: 'candidate',
            location: 'custom',
            customParent: 'relative',
          },
          repository,
          settings
        )
      ).error
    ).toContain('absolute')
    const stale = await createGitWorktree(
      { repositoryId: 'repo', mode: 'new', branch: 'stale', expectedSourceCommit: '0000000' },
      repository,
      settings
    )
    expect(stale.error).toContain('moved since the preview')
    expect(git(repository.path, 'branch', '--list', 'stale')).toBe('')
  })

  test('setup refuses a path that is not registered in this repository', async () => {
    const { repository, settings, root } = await fixture()
    repository.postCreateCommand = 'touch touched'
    const created = await createGitWorktree(
      { repositoryId: 'repo', mode: 'new', branch: 'valid' },
      repository,
      settings
    )
    const forged = { ...created.worktree!, path: join(root, 'other') }
    await mkdir(forged.path)
    const result = await runPostCreateSetup(repository, forged)
    expect(result?.success).toBe(false)
    expect(result?.output).toContain('no longer registered')
    expect(await readFile(join(forged.path, 'touched')).catch(() => null)).toBeNull()
  })

  test('custom destination uses its parent and slug collisions fail without clobbering', async () => {
    const { root, repository, settings } = await fixture()
    const parent = join(root, 'chosen')
    const first = await createGitWorktree(
      {
        repositoryId: 'repo',
        mode: 'new',
        branch: 'feature/same',
        location: 'custom',
        customParent: parent,
      },
      repository,
      settings
    )
    expect(first.worktree?.path).toBe(await realpath(join(parent, 'feature-same')))
    const collision = await createGitWorktree(
      {
        repositoryId: 'repo',
        mode: 'new',
        branch: 'feature-same',
        location: 'custom',
        customParent: parent,
      },
      repository,
      settings
    )
    expect(collision.worktree).toBeUndefined()
    expect(collision.error).toContain('Destination already exists')
    expect(git(first.worktree!.path, 'branch', '--show-current')).toBe('feature/same')
  })
})
