import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeImage,
  nativeTheme,
  safeStorage,
  shell,
} from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir, copyFile, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { z } from 'zod'
import {
  checkoutBranch,
  commitWorktree,
  detectProviderToken,
  discardFile,
  discoverRepositories,
  evaluateSafety,
  getFileDiff,
  getBranches,
  getCurrentBranch,
  getDefaultBranch,
  getGitDir,
  getHeadCommit,
  getWorktreeDetails,
  getWorktreeStatus,
  mergeBranch,
  parseProviderFromRemoteUrl,
  pruneWorktrees,
  pullWorktree,
  pushWorktree,
  rebaseWorktree,
  refreshPullRequest,
  refreshBaseBranch,
  runCommand,
  toRepositoryBaseStatus,
  updateBaseBranch,
  type MergeMode,
} from '@worktree/shared'
import {
  appSettingsSchema,
  repositorySchema,
  worktreeSchema,
  type AppSettings,
  type Repository,
  type RepositoryBaseStatus,
  type ScanProgress,
  type ScanResult,
  type Worktree,
  type WorktreeDetails,
  type WorktreeStatus,
} from '@worktree/contracts'

type BaseBranchSnapshot = Awaited<ReturnType<typeof refreshBaseBranch>>

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Give the app a real name (otherwise it shows as "Electron" in the menu bar,
// dock, and window title while running unpackaged). Must be set before the app
// is ready and before any getPath('userData') call so the config path is stable.
app.setName('Worktree Manager')

// Animate mouse-wheel scrolling instead of stepping line-by-line (feels much
// smoother with a physical mouse on macOS). Must be set before app is ready.
app.commandLine.appendSwitch('enable-smooth-scrolling', 'true')

const isDev = !app.isPackaged

const AI_AGENT_DIRS = ['.t3', '.claude', '.codex', '.devin', '.aider', '.windsurf', '.cursor']

function getAiAgentRoots(): string[] {
  const home = homedir()
  return AI_AGENT_DIRS.map((d) => join(home, d)).filter(existsSync)
}

/** Drop roots that live inside another root so we don't scan the same tree twice. */
function dedupeRoots(roots: string[]): string[] {
  const cleaned = Array.from(
    new Set(roots.map((r) => r.replace(/\/+$/, '')).filter((r) => r.length > 0))
  ).sort((a, b) => a.length - b.length)
  const kept: string[] = []
  for (const root of cleaned) {
    if (kept.some((k) => root === k || root.startsWith(k + '/'))) continue
    kept.push(root)
  }
  return kept
}

/** Seconds-since-epoch `exp` claim of a JWT, or undefined for non-JWTs. */
function jwtExpiry(token: string): number | undefined {
  const parts = token.split('.')
  if (parts.length < 2) return undefined
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf-8'))
    return typeof payload.exp === 'number' ? payload.exp : undefined
  } catch {
    return undefined
  }
}

// Azure AAD access tokens (from `az account get-access-token`) expire ~hourly.
// Cache a fresh one in memory and re-fetch via the CLI when it's about to expire
// so PR lookups keep working instead of silently going stale.
let azureTokenCache: { token: string; exp: number } | null = null

function tokenIsFresh(token: string | undefined): boolean {
  if (!token) return false
  const exp = jwtExpiry(token)
  if (exp === undefined) return true // opaque PAT — assume long-lived
  return exp * 1000 > Date.now() + 60_000
}

async function resolveAzureToken(stored?: string): Promise<string | undefined> {
  if (tokenIsFresh(stored)) return stored
  if (azureTokenCache && azureTokenCache.exp * 1000 > Date.now() + 60_000) {
    return azureTokenCache.token
  }
  const detected = await detectProviderToken('azure').catch(() => undefined)
  if (detected?.token) {
    const exp = jwtExpiry(detected.token) ?? Math.floor(Date.now() / 1000) + 3000
    azureTokenCache = { token: detected.token, exp }
    // Persist so the Settings screen and next launch start from a fresh token.
    try {
      const settings = await loadSettings()
      if (settings.azureToken !== detected.token) {
        await saveSettings({ ...settings, azureToken: detected.token })
      }
    } catch {
      // best-effort persistence
    }
    return detected.token
  }
  return stored // fall back to the (possibly expired) stored token
}

const configDir = () => join(app.getPath('userData'), 'config')
const configPath = () => join(configDir(), 'settings.json')
const reposPath = () => join(configDir(), 'repositories.json')
const worktreesPath = () => join(configDir(), 'worktrees.json')

async function ensureConfigDir() {
  await mkdir(configDir(), { recursive: true })
}

// Earlier builds ran unpackaged with the default app name, storing config under
// `<appData>/@worktree/desktop`. Now that we set a stable name ("Worktree
// Manager") the userData dir changes, so carry the old config over once.
async function migrateLegacyConfig() {
  try {
    if (existsSync(configPath())) return
    const legacyDir = join(app.getPath('appData'), '@worktree', 'desktop', 'config')
    if (!existsSync(join(legacyDir, 'settings.json'))) return
    await ensureConfigDir()
    for (const file of ['settings.json', 'repositories.json', 'worktrees.json']) {
      const src = join(legacyDir, file)
      if (existsSync(src)) await copyFile(src, join(configDir(), file))
    }
    console.log('[worktree] migrated legacy config from', legacyDir)
  } catch (err) {
    console.error('[worktree] legacy config migration failed', err)
  }
}

async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await readFile(configPath(), 'utf-8')
    return appSettingsSchema.parse(JSON.parse(raw))
  } catch {
    return appSettingsSchema.parse({})
  }
}

async function saveSettings(settings: AppSettings) {
  await ensureConfigDir()
  await writeFile(configPath(), JSON.stringify(settings, null, 2))
}

async function loadRepositories(): Promise<Repository[]> {
  try {
    const raw = await readFile(reposPath(), 'utf-8')
    const repos = z.array(repositorySchema).parse(JSON.parse(raw))
    // Backfill provider from remote URL for repos scanned before auto-detect
    let changed = false
    const next = repos.map((repo) => {
      if (repo.provider || !repo.remoteUrl) return repo
      const provider = parseProviderFromRemoteUrl(repo.remoteUrl)
      if (!provider) return repo
      changed = true
      return { ...repo, provider }
    })
    if (changed) {
      await saveRepositories(next)
    }
    return next
  } catch {
    return []
  }
}

async function saveRepositories(repositories: Repository[]) {
  await ensureConfigDir()
  await writeFile(reposPath(), JSON.stringify(repositories, null, 2))
}

async function loadWorktrees(): Promise<Worktree[]> {
  try {
    const raw = await readFile(worktreesPath(), 'utf-8')
    return z.array(worktreeSchema).parse(JSON.parse(raw))
  } catch {
    return []
  }
}

async function saveWorktrees(worktrees: Worktree[]) {
  await ensureConfigDir()
  await writeFile(worktreesPath(), JSON.stringify(worktrees, null, 2))
}

function getIconPath(file = 'icon.png'): string | undefined {
  const candidates = [
    join(app.getAppPath(), 'resources', file),
    join(__dirname, '..', '..', 'resources', file),
    join(__dirname, '..', 'resources', file),
    join(process.resourcesPath, file),
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }
  return undefined
}

const EDITOR_LAUNCHERS: Record<string, { commands: string[]; macApp?: string }> = {
  cursor: { commands: ['cursor'], macApp: 'Cursor' },
  windsurf: { commands: ['windsurf'], macApp: 'Windsurf' },
  code: { commands: ['code'], macApp: 'Visual Studio Code' },
  'code-insiders': { commands: ['code-insiders'], macApp: 'Visual Studio Code - Insiders' },
  zed: { commands: ['zed', 'zeditor'], macApp: 'Zed' },
  webstorm: { commands: ['webstorm'], macApp: 'WebStorm' },
  pycharm: { commands: ['pycharm'], macApp: 'PyCharm' },
  idea: { commands: ['idea'], macApp: 'IntelliJ IDEA' },
  rider: { commands: ['rider'], macApp: 'Rider' },
  goland: { commands: ['goland'], macApp: 'GoLand' },
  phpstorm: { commands: ['phpstorm'], macApp: 'PhpStorm' },
  rubymine: { commands: ['rubymine'], macApp: 'RubyMine' },
  'android-studio': { commands: ['studio'], macApp: 'Android Studio' },
  xcode: { commands: ['xed'], macApp: 'Xcode' },
  sublime: { commands: ['subl'], macApp: 'Sublime Text' },
  devin: { commands: ['devin'], macApp: 'Devin' },
  'file-manager': { commands: [] },
}

async function createWindow() {
  const iconPath = getIconPath()
  if (iconPath) {
    console.log(`[worktree] using app icon: ${iconPath}`)
  } else {
    console.log(`[worktree] no app icon found`)
  }
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: '#0b1220',
    show: false,
    ...(iconPath ? { icon: iconPath } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  win.once('ready-to-show', () => {
    win.show()
    win.focus()
  })

  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await migrateLegacyConfig()
  nativeTheme.themeSource = 'system'

  // Dock icons are drawn without macOS's rounding mask, so use the pre-rounded
  // variant here (the packaged .icns stays full-bleed for the OS to mask).
  const dockIconPath = getIconPath('icon-rounded.png') ?? getIconPath()
  if (dockIconPath && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(dockIconPath))
  }
  // Unmistakable "this is a hot-reload dev run, not the installed app" marker.
  if (isDev && app.dock) app.dock.setBadge('DEV')

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

ipcMain.handle('get-settings', async () => loadSettings())
ipcMain.handle('set-settings', async (_, settings: AppSettings) => saveSettings(settings))

ipcMain.handle('get-repositories', async () => loadRepositories())
ipcMain.handle('set-repositories', async (_, repositories: Repository[]) =>
  saveRepositories(repositories)
)
ipcMain.handle('get-worktrees', async () => loadWorktrees())
ipcMain.handle('set-worktrees', async (_, worktrees: Worktree[]) => saveWorktrees(worktrees))

let cancelScan = false

ipcMain.handle(
  'discover-worktrees',
  async (
    _,
    options: { roots: string[]; maxDepth?: number }
  ): Promise<ScanResult & { cancelled: boolean }> => {
    cancelScan = false
    const onProgress = (_progress: ScanProgress) => {
      BrowserWindow.getAllWindows().forEach((win) => {
        win.webContents.send('scan-progress', _progress)
      })
    }

    const roots = dedupeRoots([...(options.roots ?? []), ...getAiAgentRoots()])

    const result = await discoverRepositories({
      roots,
      maxDepth: options.maxDepth ?? 5,
      onProgress,
      shouldCancel: () => cancelScan,
    })

    return { ...result, cancelled: cancelScan }
  }
)

ipcMain.handle('cancel-scan', async () => {
  cancelScan = true
})

function statusCwd(repository: Repository, worktrees: Worktree[]): string {
  if (existsSync(repository.path)) return repository.path
  return (
    worktrees.find(
      (worktree) =>
        worktree.repositoryId === repository.id &&
        existsSync(worktree.path)
    )?.path ?? repository.path
  )
}

async function refreshRepositoryBaseStatuses(
  repositories: Repository[],
  worktrees: Worktree[]
): Promise<{
  snapshots: Map<string, BaseBranchSnapshot>
  statuses: RepositoryBaseStatus[]
}> {
  const worktreeRepositoryIds = new Set(worktrees.map((worktree) => worktree.repositoryId))
  const relevantRepositories = repositories.filter((repository) =>
    worktreeRepositoryIds.has(repository.id)
  )
  const snapshots = new Map<string, BaseBranchSnapshot>()
  const statuses: (RepositoryBaseStatus | undefined)[] = new Array(
    relevantRepositories.length
  ).fill(undefined)
  let cursor = 0

  // One fetch per repository, rather than one fetch per worktree. Keep a small
  // bound so opening a large workspace does not start dozens of network calls.
  const CONCURRENCY = 4
  const worker = async () => {
    while (cursor < relevantRepositories.length) {
      const index = cursor++
      const repository = relevantRepositories[index]!
      const snapshot = await refreshBaseBranch(
        statusCwd(repository, worktrees),
        repository.baseBranch || 'main'
      )
      snapshots.set(repository.id, snapshot)
      statuses[index] = toRepositoryBaseStatus(repository, snapshot)
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(CONCURRENCY, relevantRepositories.length) },
      () => worker()
    )
  )

  return {
    snapshots,
    statuses: statuses.filter((status): status is RepositoryBaseStatus => status !== undefined),
  }
}

ipcMain.handle(
  'get-worktree-statuses',
  async (event, args: { worktrees: Worktree[]; repositories: Repository[] }) => {
    const settings = await loadSettings()
    const azureToken = await resolveAzureToken(settings.azureToken)
    const globalTokens = {
      ...(settings.githubToken ? { github: settings.githubToken } : {}),
      ...(azureToken ? { azure: azureToken } : {}),
    }

    const total = args.worktrees.length
    let done = 0
    const emitProgress = () => event.sender.send('status-progress', { current: done, total })
    emitProgress()

    const { snapshots: baseSnapshots, statuses: baseStatuses } =
      await refreshRepositoryBaseStatuses(args.repositories, args.worktrees)
    const repositoriesById = new Map(args.repositories.map((repository) => [repository.id, repository]))

    // Fetch statuses with bounded concurrency — each does git + a network PR
    // lookup, so a few in flight is much faster than one at a time, while
    // reporting progress as each completes.
    const CONCURRENCY = 6
    const results: (WorktreeStatus | null)[] = new Array(total).fill(null)
    let cursor = 0
    const worker = async () => {
      while (cursor < total) {
        const i = cursor++
        const worktree = args.worktrees[i]!
        const repo = repositoriesById.get(worktree.repositoryId)
        if (repo) {
          const baseSnapshot = baseSnapshots.get(repo.id)
          results[i] = await getWorktreeStatus({
            worktree,
            repository: repo,
            resolvePullRequest: (branch) =>
              refreshPullRequest(branch, repo, globalTokens).catch(() => undefined),
            ...(baseSnapshot ? { baseSnapshot } : {}),
          }).catch(() => null)
        }
        done++
        emitProgress()
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()))
    return {
      statuses: results.filter((s): s is WorktreeStatus => s !== null),
      baseStatuses,
    }
  }
)

// Refresh a single worktree's status (git + one PR lookup) without re-scanning
// every other worktree — used after a git action touches just this worktree.
ipcMain.handle(
  'get-worktree-status',
  async (_, args: { worktree: Worktree; repository: Repository }): Promise<WorktreeStatus> => {
    const settings = await loadSettings()
    const azureToken = await resolveAzureToken(settings.azureToken)
    const globalTokens = {
      ...(settings.githubToken ? { github: settings.githubToken } : {}),
      ...(azureToken ? { azure: azureToken } : {}),
    }
    // Take the same fetched, remote-first base ref the full refresh uses.
    // Without it this path fell back to the local `refs/heads/<base>`, so the
    // merged/unmerged verdict right after a pull or push was computed against a
    // base that may not have been fetched in days — and then silently flipped
    // on the next full refresh.
    const baseSnapshot = await refreshBaseBranch(
      statusCwd(args.repository, [args.worktree]),
      args.repository.baseBranch || 'main'
    ).catch(() => undefined)
    return getWorktreeStatus({
      worktree: args.worktree,
      repository: args.repository,
      resolvePullRequest: (branch) =>
        refreshPullRequest(branch, args.repository, globalTokens).catch(() => undefined),
      ...(baseSnapshot ? { baseSnapshot } : {}),
    })
  }
)

// Branch switches made outside the app (a checkout in a terminal) rewrite the
// worktree's HEAD, so watching it reports them in the moment instead of on the
// renderer's next poll. Keyed by worktree id; the renderer re-registers the
// set whenever the visible project changes.
//
// Stat polling rather than `fs.watch`: git replaces HEAD by renaming HEAD.lock
// over it, so a file watcher ends up on the dead inode, and watching the parent
// directory never reported the replacement at all on macOS (measured: only
// FETCH_HEAD/index.lock events came through). `fs.watchFile` reads the right
// thing but its poll timer misbehaved inside Electron's main loop — several
// seconds late when unref'd, silent when not — so the timer is ours. One stat
// per visible worktree per second is still far cheaper than the `rev-parse` per
// worktree the fallback below costs.
const HEAD_POLL_INTERVAL = 1000

interface HeadWatch {
  worktree: Worktree
  headPath: string
  mtimeMs: number
}

const headWatches = new Map<string, HeadWatch>()
let headPollTimer: NodeJS.Timeout | undefined

function stopHeadPoll() {
  if (!headPollTimer) return
  clearInterval(headPollTimer)
  headPollTimer = undefined
}

app.on('before-quit', () => {
  headWatches.clear()
  stopHeadPoll()
})

async function pollHeads(sender: Electron.WebContents) {
  if (sender.isDestroyed()) {
    headWatches.clear()
    stopHeadPoll()
    return
  }

  await Promise.all(
    Array.from(headWatches.values()).map(async (watch) => {
      const stats = await stat(watch.headPath).catch(() => undefined)
      if (!stats || stats.mtimeMs === watch.mtimeMs) return
      watch.mtimeMs = stats.mtimeMs

      const [branch, headCommit] = await Promise.all([
        getCurrentBranch(watch.worktree.path).catch(() => undefined),
        getHeadCommit(watch.worktree.path).catch(() => undefined),
      ])
      if (!branch || sender.isDestroyed()) return
      sender.send('worktree-head-changed', {
        worktreeId: watch.worktree.id,
        branch,
        ...(headCommit ? { headCommit } : {}),
      })
    })
  )
}

ipcMain.handle(
  'watch-worktree-heads',
  async (event, args: { worktrees: Worktree[] }): Promise<number> => {
    const wanted = args.worktrees.filter((worktree) => !worktree.prunable)
    const keep = new Set(wanted.map((worktree) => worktree.id))
    for (const worktreeId of headWatches.keys()) {
      if (!keep.has(worktreeId)) headWatches.delete(worktreeId)
    }

    await Promise.all(
      wanted.map(async (worktree) => {
        if (headWatches.has(worktree.id)) return
        const gitDir = await getGitDir(worktree.path).catch(() => undefined)
        if (!gitDir) return
        const headPath = join(gitDir, 'HEAD')
        const stats = await stat(headPath).catch(() => undefined)
        if (!stats) return
        headWatches.set(worktree.id, { worktree, headPath, mtimeMs: stats.mtimeMs })
      })
    )

    stopHeadPoll()
    if (headWatches.size > 0) {
      headPollTimer = setInterval(() => void pollHeads(event.sender), HEAD_POLL_INTERVAL)
    }

    return headWatches.size
  }
)

// Fallback for anything the watchers miss. A cheap, local-only read of every
// worktree's current branch: one `rev-parse` each, no network and no status
// plumbing, so the renderer can re-sync only the rows that actually moved.
ipcMain.handle(
  'get-worktree-branches',
  async (
    _,
    args: { worktrees: Worktree[] }
  ): Promise<{ worktreeId: string; branch: string }[]> => {
    const entries = await Promise.all(
      args.worktrees.map(async (worktree) => {
        if (worktree.prunable) return undefined
        const branch = await getCurrentBranch(worktree.path).catch(() => undefined)
        return branch ? { worktreeId: worktree.id, branch } : undefined
      })
    )
    return entries.filter((entry): entry is { worktreeId: string; branch: string } => !!entry)
  }
)

ipcMain.handle(
  'evaluate-safety',
  async (_, args: { worktree: Worktree; status: WorktreeStatus }) => {
    return evaluateSafety(args.worktree, args.status)
  }
)

ipcMain.handle(
  'get-worktree-details',
  async (_, args: { worktree: Worktree; repository: Repository }): Promise<WorktreeDetails> => {
    return getWorktreeDetails(args)
  }
)

ipcMain.handle(
  'get-file-diff',
  async (
    _,
    args: {
      path: string
      filePath: string
      staged?: boolean
      untracked?: boolean
      fullContext?: boolean
    }
  ) => {
    return getFileDiff(args.path, args.filePath, args.staged, args.untracked, args.fullContext)
  }
)

ipcMain.handle(
  'discard-file',
  async (_, args: { path: string; filePath: string; untracked?: boolean }) => {
    return discardFile(args.path, args.filePath, args.untracked)
  }
)

ipcMain.handle('pull-worktree', async (_, path: string) => {
  return pullWorktree(path)
})

ipcMain.handle('update-base-branch', async (_, args: { path: string; baseBranch: string }) => {
  return updateBaseBranch(args.path, args.baseBranch)
})

ipcMain.handle('rebase-worktree', async (_, path: string) => {
  return rebaseWorktree(path)
})

ipcMain.handle('push-worktree', async (_, path: string) => {
  return pushWorktree(path)
})

ipcMain.handle('checkout-branch', async (_, args: { path: string; branch: string }) => {
  return checkoutBranch(args.path, args.branch)
})

ipcMain.handle(
  'merge-branch',
  async (_, args: { path: string; branch: string; mode: MergeMode }) => {
    return mergeBranch(args.path, args.branch, args.mode)
  }
)

ipcMain.handle(
  'commit-worktree',
  async (_, args: { path: string; message: string; all?: boolean }) => {
    return commitWorktree(args.path, args.message, args.all)
  }
)

ipcMain.handle('open-directory-dialog', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'multiSelections'],
  })
  return result.filePaths
})

ipcMain.handle('open-in-editor', async (_, { path, editor }: { path: string; editor?: string }) => {
  const settings = await loadSettings()
  const editorId = editor || settings.defaultEditor || 'code'
  return openInEditor(path, editorId)
})

ipcMain.handle(
  'open-in-terminal',
  async (_, { path, terminal }: { path: string; terminal?: string }) => {
    const settings = await loadSettings()
    const term = terminal || settings.defaultTerminal
    return openTerminalAt(path, term)
  }
)

ipcMain.handle('open-in-file-manager', async (_, path: string) => {
  const err = await shell.openPath(path)
  return err ? { success: false, error: err } : { success: true }
})

ipcMain.handle(
  'remove-worktree',
  async (
    _,
    { path, repoPath, missing }: { path: string; repoPath: string; missing?: boolean }
  ) => {
    try {
      // Present worktree: move its files to the system Trash (recoverable).
      // Missing/stale worktree: nothing on disk to trash — skip straight to prune.
      if (!missing) {
        try {
          await shell.trashItem(path)
        } catch (err) {
          // If it failed only because the folder is already gone, fall through to
          // prune so git's stale record still gets cleaned up.
          if (existsSync(path)) return { success: false, error: String(err) }
        }
      }
      // Deregister from git so no prunable "ghost" entry lingers (this also clears
      // any other already-stale worktrees in the same repo).
      if (repoPath) await pruneWorktrees(repoPath).catch(() => undefined)
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }
)

ipcMain.handle('open-external', async (_, url: string) => {
  return shell.openExternal(url)
})

ipcMain.handle('detect-provider-token', async (_, provider: 'github' | 'azure') => {
  return detectProviderToken(provider)
})

ipcMain.handle('parse-remote-provider', async (_, remoteUrl: string) => {
  return parseProviderFromRemoteUrl(remoteUrl)
})

ipcMain.handle('get-app-version', () => app.getVersion())
ipcMain.handle('is-dev', () => isDev)

ipcMain.handle('get-repo-branches', async (_, path: string) => {
  const [branches, defaultBranch] = await Promise.all([
    getBranches(path).catch(() => [] as string[]),
    getDefaultBranch(path).catch(() => undefined),
  ])
  return { branches, defaultBranch }
})

ipcMain.handle('encrypt-token', async (_, token: string) => {
  if (!safeStorage.isEncryptionAvailable()) return token
  return safeStorage.encryptString(token).toString('base64')
})

ipcMain.handle('decrypt-token', async (_, encrypted: string) => {
  if (!safeStorage.isEncryptionAvailable()) return encrypted
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
})

async function openWithCommand(
  command: string,
  args: string[],
  { cwd }: { cwd?: string } = {}
): Promise<{ success: boolean; error?: string }> {
  try {
    const { exitCode, stderr } = await runCommand(command, args, {
      timeout: 15000,
      shell: process.platform === 'win32',
      ...(cwd ? { cwd } : {}),
    })
    if (exitCode !== 0) {
      return { success: false, error: stderr || `Command failed: ${command}` }
    }
    return { success: true }
  } catch (error) {
    return { success: false, error: String(error) }
  }
}

async function openInEditor(
  path: string,
  editorId: string
): Promise<{ success: boolean; error?: string }> {
  if (editorId === 'file-manager') {
    const err = await shell.openPath(path)
    return err ? { success: false, error: err } : { success: true }
  }

  const launcher = EDITOR_LAUNCHERS[editorId]
  const commands = launcher?.commands?.length ? launcher.commands : [editorId]
  const errors: string[] = []

  for (const cmd of commands) {
    const result = await openWithCommand(cmd, [path])
    if (result.success) return result
    if (result.error) errors.push(result.error)
  }

  // macOS: fall back to opening the .app by name (CLI often missing from Electron PATH)
  if (process.platform === 'darwin') {
    const appName = launcher?.macApp ?? editorId
    const result = await openWithCommand('open', ['-a', appName, path])
    if (result.success) return result
    if (result.error) errors.push(result.error)
  }

  return {
    success: false,
    error:
      errors.filter(Boolean).join('; ') ||
      `Could not open editor "${editorId}". Install its CLI or pick another editor in Settings.`,
  }
}

async function openTerminalAt(
  path: string,
  terminal?: string
): Promise<{ success: boolean; error?: string }> {
  if (process.platform === 'darwin') {
    const app = terminal && terminal.length > 0 ? terminal : 'Terminal'
    return openWithCommand('open', ['-a', app, path])
  }

  if (terminal) {
    return openWithCommand(terminal, [path])
  }

  if (process.platform === 'win32') {
    return openWithCommand('wt', ['-d', path])
  }

  const linuxTerms = [
    'gnome-terminal',
    'konsole',
    'alacritty',
    'kitty',
    'x-terminal-emulator',
    'terminator',
  ]
  for (const term of linuxTerms) {
    const result = await openWithCommand(term, [`--working-directory=${path}`])
    if (result.success) return result
  }

  return { success: false, error: 'No terminal found' }
}
