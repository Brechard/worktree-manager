import { app, BrowserWindow, dialog, ipcMain, nativeImage, nativeTheme, safeStorage, shell } from 'electron'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { existsSync } from 'node:fs'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { homedir } from 'node:os'
import { z } from 'zod'
import {
  commitWorktree,
  detectProviderToken,
  discoverRepositories,
  evaluateSafety,
  getFileDiff,
  getWorktreeDetails,
  getWorktreeStatus,
  parseProviderFromRemoteUrl,
  pullWorktree,
  pushWorktree,
  rebaseWorktree,
  refreshPullRequest,
  runCommand,
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

const isDev = !app.isPackaged

const AI_AGENT_DIRS = ['.t3', '.claude', '.codex', '.devin', '.aider', '.windsurf', '.cursor']

function getAiAgentRoots(): string[] {
  const home = homedir()
  return AI_AGENT_DIRS.map((d) => join(home, d)).filter(existsSync)
}

const configDir = () => join(app.getPath('userData'), 'config')
const configPath = () => join(configDir(), 'settings.json')
const reposPath = () => join(configDir(), 'repositories.json')
const worktreesPath = () => join(configDir(), 'worktrees.json')

async function ensureConfigDir() {
  await mkdir(configDir(), { recursive: true })
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

  if (iconPath && process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(nativeImage.createFromPath(iconPath))
  }

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

app.whenReady().then(() => {
  nativeTheme.themeSource = 'system'
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

    const roots = Array.from(new Set([...(options.roots ?? []), ...getAiAgentRoots()]))

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
  async (_, args: { worktrees: Worktree[]; repositories: Repository[] }) => {
    const settings = await loadSettings()
    const globalTokens = {
      ...(settings.githubToken ? { github: settings.githubToken } : {}),
      ...(settings.azureToken ? { azure: settings.azureToken } : {}),
    }
    const statuses: WorktreeStatus[] = []
    for (const worktree of args.worktrees) {
      const repo = args.repositories.find((r) => r.id === worktree.repositoryId)
      if (!repo) continue

      const pullRequest = await refreshPullRequest(worktree, repo, globalTokens).catch(() => undefined)
      const status = await getWorktreeStatus({
        worktree,
        repository: repo,
        pullRequest: pullRequest ?? null,
      })
      statuses.push(status)
    }
    return statuses
  }
)

ipcMain.handle('evaluate-safety', async (_, args: { worktree: Worktree; status: WorktreeStatus }) => {
  return evaluateSafety(args.worktree, args.status)
})

ipcMain.handle(
  'get-worktree-details',
  async (_, args: { worktree: Worktree; repository: Repository }): Promise<WorktreeDetails> => {
    return getWorktreeDetails(args)
  }
)

ipcMain.handle(
  'get-file-diff',
  async (_, args: { path: string; filePath: string; staged?: boolean; untracked?: boolean }) => {
    return getFileDiff(args.path, args.filePath, args.staged, args.untracked)
  }
)

ipcMain.handle('pull-worktree', async (_, path: string) => {
  return pullWorktree(path)
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

ipcMain.handle('open-in-terminal', async (_, { path, terminal }: { path: string; terminal?: string }) => {
  const settings = await loadSettings()
  const term = terminal || settings.defaultTerminal
  return openTerminalAt(path, term)
})

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
