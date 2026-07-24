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
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { z } from 'zod'
import {
  commitWorktree,
  detectProviderToken,
  discardFile,
  discoverRepositories,
  evaluateSafety,
  getFileDiff,
  getBranches,
  getDefaultBranch,
  getWorktreeDetails,
  getWorktreeStatus,
  parseProviderFromRemoteUrl,
  pullWorktree,
  pushWorktree,
  rebaseWorktree,
  refreshPullRequest,
  runCommand,
  updateBaseBranch,
} from '@worktree/shared'
import {
  appSettingsSchema,
  repositorySchema,
  worktreeSchema,
  type AppSettings,
  type Repository,
  type ScanProgress,
  type ScanResult,
  type Worktree,
  type WorktreeDetails,
  type WorktreeStatus,
} from '@worktree/contracts'

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

function getIconPath(): string | undefined {
  const candidates = [
    join(app.getAppPath(), 'resources', 'icon.png'),
    join(__dirname, '..', '..', 'resources', 'icon.png'),
    join(__dirname, '..', 'resources', 'icon.png'),
    join(process.resourcesPath, 'icon.png'),
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

  const iconPath = getIconPath()
  if (iconPath && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }

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
        const repo = args.repositories.find((r) => r.id === worktree.repositoryId)
        if (repo) {
          const pullRequest = await refreshPullRequest(worktree, repo, globalTokens).catch(
            () => undefined
          )
          results[i] = await getWorktreeStatus({
            worktree,
            repository: repo,
            pullRequest: pullRequest ?? null,
          }).catch(() => null)
        }
        done++
        emitProgress()
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, total) }, () => worker()))
    return results.filter((s): s is WorktreeStatus => s !== null)
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

ipcMain.handle('trash-worktree', async (_, path: string) => {
  return shell.trashItem(path)
})

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
