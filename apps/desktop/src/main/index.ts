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
import { createCredentialStore, migrateLegacyProfile } from './credential-store.js'
import { verifiedRemovalTarget } from './removal-target.js'
import { recheckRemovalStatus } from './removal-status.js'
import { scanRoots } from './scan-sources.js'
import { createWorktreeStore } from './worktree-store.js'
import { stat, readdir, unlink, rm, realpath } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import {
  checkoutBranch,
  commitWorktree,
  detectProviderToken,
  deleteLocalBranch,
  runPreDeleteCommand,
  discardFile,
  discoverRepositories,
  evaluateSafety,
  getFileDiff,
  getBranches,
  getCurrentBranch,
  getDefaultBranch,
  getGitDir,
  getHeadCommit,
  clearPullRequestHistory,
  clearProviderLookupCache,
  getWorktreeDetails,
  getWorktreeStatus,
  hydrateShellPath,
  measureWorktreeDisk,
  lookupPullRequest,
  mergeBranch,
  parseProviderFromRemoteUrl,
  pruneWorktrees,
  pushWorktree,
  reclaimWorktreeSpace,
  refreshPullRequest,
  refreshBaseBranch,
  resolveWorkingDirectory,
  runCommand,
  runProjectCommand,
  previewWorktreeCreation,
  createGitWorktree,
  runPostCreateSetup,
  syncWithBase,
  toRepositoryBaseStatus,
  updateBaseBranch,
  type MergeMode,
} from '@worktree/shared'
import {
  cleanupCandidacy,
  type AppSettings,
  createWorktreeRequestSchema,
  type CreateWorktreeRequest,
  type WorktreeCreationResult,
  type WorktreeCreationProgress,
  type Repository,
  type RepositoryBaseStatus,
  type ScanProgress,
  type ScanResult,
  type SyncBaseMode,
  type SyncTarget,
  type Worktree,
  type WorktreeDetails,
  type WorktreeDiskUsage,
  type WorktreeStatus,
  type PullRequestLookup,
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

function tokenIsFresh(token: string | undefined): boolean {
  if (!token) return false
  const exp = jwtExpiry(token)
  // Opaque PAT expiry is unknown. The provider response determines its health.
  return exp === undefined || exp * 1000 > Date.now() + 60_000
}

let azureDetection:
  { expiresAt: number; value?: Awaited<ReturnType<typeof detectProviderToken>> } | undefined
let azureDetectionPending: Promise<Awaited<ReturnType<typeof detectProviderToken>>> | undefined

async function detectAzureCredential(force = false) {
  if (!force && azureDetection && azureDetection.expiresAt > Date.now()) return azureDetection.value
  if (!azureDetectionPending) {
    azureDetectionPending = detectProviderToken('azure')
      .catch(() => undefined)
      .then((value) => {
        azureDetection = { value, expiresAt: Date.now() + 30_000 }
        return value
      })
      .finally(() => {
        azureDetectionPending = undefined
      })
  }
  return azureDetectionPending
}

async function resolveAzureToken(
  stored?: string,
  forceDetection = false
): Promise<{ token?: string; source: 'global' | 'environment' | 'cli' | 'none' }> {
  if (stored && tokenIsFresh(stored)) return { token: stored, source: 'global' }
  const detected = await detectAzureCredential(forceDetection)
  if (detected?.token)
    return {
      token: detected.token,
      source: detected.source.startsWith('env:') ? 'environment' : 'cli',
    }
  return stored ? { token: stored, source: 'global' } : { source: 'none' }
}

const configDir = () => join(app.getPath('userData'), 'config')
const worktreesPath = () => join(configDir(), 'worktrees.json')

// Earlier builds ran unpackaged with the default app name, storing config under
// `<appData>/@worktree/desktop`. Now that we set a stable name ("Worktree
// Manager") the userData dir changes, so carry the old config over once.
async function migrateLegacyConfig() {
  try {
    const legacyDir = () => join(app.getPath('appData'), '@worktree', 'desktop', 'config')
    if (
      await migrateLegacyProfile(
        legacyDir,
        configDir(),
        secureStorage,
        app.commandLine.hasSwitch('user-data-dir')
      )
    )
      console.log('[worktree] migrated legacy config from', legacyDir())
  } catch (err) {
    console.error('[worktree] legacy config migration failed', err)
  }
}

const secureStorage = {
  isEncryptionAvailable: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== 'linux' ||
      !['basic_text', 'unknown'].includes(safeStorage.getSelectedStorageBackend())),
  getSelectedStorageBackend: () => safeStorage.getSelectedStorageBackend(),
  encryptString: (value: string) => safeStorage.encryptString(value),
  decryptString: (value: Buffer) => safeStorage.decryptString(value),
}
const credentialStore = createCredentialStore(configDir(), secureStorage)

async function loadSettings(): Promise<AppSettings> {
  return credentialStore.loadSettings()
}
async function saveSettings(settings: AppSettings): Promise<void> {
  const previous = await credentialStore.loadSettings()
  await credentialStore.saveSettings(settings)
  const changedProviders = new Set<string>()
  if (previous.githubToken !== settings.githubToken) changedProviders.add('github')
  if (previous.azureToken !== settings.azureToken) {
    changedProviders.add('azure')
    azureDetection = undefined
  }
  if (changedProviders.size) {
    clearPullRequestHistory({ providerTypes: changedProviders })
    clearProviderLookupCache()
  }
}
async function loadRepositories(): Promise<Repository[]> {
  const repos = await credentialStore.loadRepositories()
  let changed = false
  const next = repos.map((repo) => {
    if (repo.provider || !repo.remoteUrl) return repo
    const provider = parseProviderFromRemoteUrl(repo.remoteUrl)
    if (!provider) return repo
    changed = true
    return { ...repo, provider }
  })
  if (changed) await saveRepositories(next)
  return next
}
async function saveRepositories(repositories: Repository[]): Promise<void> {
  const previous = await credentialStore.loadRepositories()
  await credentialStore.saveRepositories(repositories)
  const previousById = new Map(previous.map((repository) => [repository.id, repository]))
  const changedIds = new Set<string>()
  for (const repository of repositories) {
    if (
      JSON.stringify(previousById.get(repository.id)?.provider) !==
      JSON.stringify(repository.provider)
    )
      changedIds.add(repository.id)
    previousById.delete(repository.id)
  }
  for (const id of previousById.keys()) changedIds.add(id)
  if (changedIds.size) {
    clearPullRequestHistory({ repositoryIds: changedIds })
    clearProviderLookupCache()
  }
}

const worktreeStore = createWorktreeStore(worktreesPath())
const loadWorktrees = () => worktreeStore.read()
const saveWorktrees = (worktrees: Worktree[]) => worktreeStore.saveSnapshot(worktrees)

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
  trae: { commands: ['trae'], macApp: 'Trae' },
  kiro: { commands: ['kiro'], macApp: 'Kiro' },
  code: { commands: ['code'], macApp: 'Visual Studio Code' },
  'code-insiders': { commands: ['code-insiders'], macApp: 'Visual Studio Code - Insiders' },
  vscodium: { commands: ['codium'], macApp: 'VSCodium' },
  zed: { commands: ['zed', 'zeditor'], macApp: 'Zed' },
  antigravity: { commands: ['agy'], macApp: 'Antigravity' },
  webstorm: { commands: ['webstorm'], macApp: 'WebStorm' },
  pycharm: { commands: ['pycharm'], macApp: 'PyCharm' },
  idea: { commands: ['idea'], macApp: 'IntelliJ IDEA' },
  aqua: { commands: ['aqua'], macApp: 'Aqua' },
  clion: { commands: ['clion'], macApp: 'CLion' },
  datagrip: { commands: ['datagrip'], macApp: 'DataGrip' },
  dataspell: { commands: ['dataspell'], macApp: 'DataSpell' },
  rider: { commands: ['rider'], macApp: 'Rider' },
  goland: { commands: ['goland'], macApp: 'GoLand' },
  phpstorm: { commands: ['phpstorm'], macApp: 'PhpStorm' },
  rubymine: { commands: ['rubymine'], macApp: 'RubyMine' },
  rustrover: { commands: ['rustrover'], macApp: 'RustRover' },
  'android-studio': { commands: ['studio'], macApp: 'Android Studio' },
  xcode: { commands: ['xed'], macApp: 'Xcode' },
  sublime: { commands: ['subl'], macApp: 'Sublime Text' },
  devin: { commands: ['devin-desktop', 'devin'], macApp: 'Devin' },
  'file-manager': { commands: [] },
}

const MAC_APP_DIRS = [join('/Applications'), join(homedir(), 'Applications')]

function findMacAppPath(appName: string): string | undefined {
  for (const dir of MAC_APP_DIRS) {
    const appPath = join(dir, `${appName}.app`)
    if (existsSync(appPath)) return appPath
  }
  return undefined
}

function hasMacApp(appName: string): boolean {
  return Boolean(findMacAppPath(appName))
}

async function commandExists(command: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  const result = await runCommand(probe, [command], {
    timeout: 4000,
    shell: process.platform === 'win32',
  })
  return result.exitCode === 0
}

async function isEditorAvailable(editorId: string): Promise<boolean> {
  if (editorId === 'file-manager') return true

  const launcher = EDITOR_LAUNCHERS[editorId]
  if (!launcher) return false

  if (process.platform === 'darwin' && launcher.macApp && hasMacApp(launcher.macApp)) {
    return true
  }

  const commands = launcher.commands.length > 0 ? launcher.commands : [editorId]
  for (const command of commands) {
    if (await commandExists(command)) return true
  }

  return false
}

async function getAvailableEditors(): Promise<string[]> {
  const editorIds = Object.keys(EDITOR_LAUNCHERS)
  const checks = await Promise.all(editorIds.map((editorId) => isEditorAvailable(editorId)))
  return editorIds.filter((_, index) => checks[index])
}

const editorIconCache = new Map<string, string | undefined>()

async function resolveAppIconPngPath(appPath: string): Promise<string | undefined> {
  const resourcesPath = join(appPath, 'Contents', 'Resources')
  if (!existsSync(resourcesPath)) return undefined

  const plistPath = join(appPath, 'Contents', 'Info.plist')
  let iconFile: string | undefined

  try {
    const result = await runCommand(
      '/usr/libexec/PlistBuddy',
      ['-c', 'Print CFBundleIconFile', plistPath],
      {
        timeout: 4000,
      }
    )
    if (result.exitCode === 0) {
      const raw = result.stdout.trim()
      if (raw) iconFile = raw
    }
  } catch {
    // PlistBuddy may fail; fall through to filesystem search
  }

  if (iconFile) {
    const candidates = [iconFile, `${iconFile}.icns`, `${iconFile}.png`]
    for (const name of candidates) {
      const candidate = join(resourcesPath, name)
      if (existsSync(candidate)) return candidate
    }
  }

  // Search Resources for any .icns file; common names first
  const preferred = ['AppIcon', 'applet', 'icon']
  const files = await readdir(resourcesPath).catch(() => [] as string[])
  const icnsFiles = files.filter((f) => f.toLowerCase().endsWith('.icns'))
  for (const p of preferred) {
    const match = icnsFiles.find((f) => f.toLowerCase().startsWith(p.toLowerCase()))
    if (match) return join(resourcesPath, match)
  }
  if (icnsFiles[0]) return join(resourcesPath, icnsFiles[0])

  return undefined
}

async function getEditorIconDataUrl(editorId: string): Promise<string | undefined> {
  if (process.platform !== 'darwin') return undefined

  const cached = editorIconCache.get(editorId)
  if (cached !== undefined) return cached

  const appPath =
    editorId === 'file-manager'
      ? '/System/Library/CoreServices/Finder.app'
      : EDITOR_LAUNCHERS[editorId]?.macApp
        ? findMacAppPath(EDITOR_LAUNCHERS[editorId]!.macApp!)
        : undefined

  if (!appPath || !existsSync(appPath)) {
    editorIconCache.set(editorId, undefined)
    return undefined
  }

  let icon: Electron.NativeImage | undefined

  try {
    const iconFile = await resolveAppIconPngPath(appPath)

    if (iconFile) {
      if (iconFile.toLowerCase().endsWith('.png')) {
        icon = nativeImage.createFromPath(iconFile)
      } else if (iconFile.toLowerCase().endsWith('.icns')) {
        const pngPath = join(tmpdir(), `worktree-icon-${editorId}.png`)
        const result = await runCommand(
          '/usr/bin/sips',
          ['-s', 'format', 'png', iconFile, '--out', pngPath],
          {
            timeout: 5000,
          }
        )
        if (result.exitCode === 0 && existsSync(pngPath)) {
          icon = nativeImage.createFromPath(pngPath)
          void unlink(pngPath).catch(() => {})
        }
      }
    }

    // Note: no app.getFileIcon() fallback here — it crashes natively on
    // macOS 26 (Tahoe) for .app bundles (EXC_BREAKPOINT, exit 133), and a
    // native CHECK failure can't be caught from JS.

    if (!icon || icon.isEmpty()) {
      editorIconCache.set(editorId, undefined)
      return undefined
    }

    const resized = icon.resize({ width: 32, height: 32, quality: 'best' })
    const png = resized.toPNG()
    const dataUrl = `data:image/png;base64,${png.toString('base64')}`
    editorIconCache.set(editorId, dataUrl)
    return dataUrl
  } catch {
    editorIconCache.set(editorId, undefined)
    return undefined
  }
}

async function getEditorIcons(editorIds: string[]): Promise<Record<string, string>> {
  const icons: Record<string, string> = {}

  const pairs = await Promise.all(
    editorIds.map(async (editorId) => {
      const iconDataUrl = await getEditorIconDataUrl(editorId)
      return { editorId, iconDataUrl }
    })
  )

  for (const { editorId, iconDataUrl } of pairs) {
    if (iconDataUrl) icons[editorId] = iconDataUrl
  }

  return icons
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
  // Before anything spawns a child process: a Finder-launched app only has the
  // bare launchd PATH, which hides Homebrew tools like `az` and `gh`.
  await hydrateShellPath()

  await migrateLegacyConfig()
  // A process exit cannot finish an in-flight shell command. Keep the
  // worktree and make the interrupted setup explicit on the next launch.
  const startupWorktrees = await loadWorktrees()
  await Promise.all(
    startupWorktrees
      .filter((worktree) => worktree.postCreateSetupState === 'running')
      .map((worktree) => worktreeStore.update(worktree.id, { postCreateSetupState: 'interrupted' }))
  )
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

ipcMain.handle(
  'check-provider-connection',
  async (_, repositoryId: string): Promise<PullRequestLookup> => {
    const repository = (await loadRepositories()).find((item) => item.id === repositoryId)
    if (!repository)
      return {
        state: 'error',
        checkedAt: Date.now(),
        error: { kind: 'configuration', message: 'Project was not found.' },
      }
    if (!repository.provider)
      return { state: 'not-configured', checkedAt: Date.now(), credentialSource: 'none' }
    const settings = await loadSettings()
    const azureCredential =
      repository.provider.type === 'azure' && !repository.provider.personalAccessToken
        ? await resolveAzureToken(settings.azureToken, true)
        : { source: 'none' as const }
    const globalTokens = {
      ...(settings.githubToken ? { github: settings.githubToken } : {}),
      ...(azureCredential.token ? { azure: azureCredential.token } : {}),
    }
    const worktrees = await loadWorktrees()
    const branch =
      worktrees.find(
        (item) =>
          item.repositoryId === repositoryId &&
          item.branch !== 'HEAD' &&
          item.branch !== repository.baseBranch
      )?.branch ??
      repository.baseBranch ??
      'main'
    return lookupPullRequest(
      branch,
      repository,
      globalTokens,
      repository.provider.type === 'azure' ? azureCredential.source : 'global',
      true
    )
  }
)
ipcMain.handle('get-worktrees', async () => loadWorktrees())
ipcMain.handle('set-worktrees', async (_, worktrees: Worktree[]) => saveWorktrees(worktrees))

const activeCreations = new Set<string>()
const activeSetups = new Set<string>()
const setupIsRunning = (worktree: Worktree) =>
  activeSetups.has(`${worktree.repositoryId}:${worktree.id}`) ||
  worktree.postCreateSetupState === 'running'
const creationProgress = (
  event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent,
  progress: WorktreeCreationProgress
) => {
  if (!event.sender.isDestroyed()) event.sender.send('worktree-creation-progress', progress)
}

ipcMain.handle('preview-worktree-creation', async (_, input: CreateWorktreeRequest) => {
  const request = createWorktreeRequestSchema.parse(input)
  const repository = (await loadRepositories()).find((item) => item.id === request.repositoryId)
  if (!repository)
    return { path: '', branch: request.branch, startRef: '', error: 'Project was not found.' }
  return previewWorktreeCreation(request, repository, await loadSettings())
})

ipcMain.handle(
  'create-worktree',
  async (event, input: CreateWorktreeRequest): Promise<WorktreeCreationResult> => {
    const request = createWorktreeRequestSchema.parse(input)
    if (activeCreations.has(request.repositoryId))
      return { success: false, error: 'A worktree is already being created for this project.' }
    activeCreations.add(request.repositoryId)
    const progress = (
      stage: WorktreeCreationProgress['stage'],
      message: string,
      output?: string,
      worktree?: Worktree
    ) =>
      creationProgress(event, {
        repositoryId: request.repositoryId,
        stage,
        message,
        ...(output ? { output } : {}),
        ...(worktree ? { worktree } : {}),
      })
    try {
      progress('validating', 'Checking branch and destination…')
      const repository = (await loadRepositories()).find((item) => item.id === request.repositoryId)
      if (!repository) return { success: false, error: 'Project was not found.' }
      progress('creating', 'Creating Git worktree…')
      const created = await createGitWorktree(request, repository, await loadSettings())
      if (!created.worktree)
        return { success: false, error: created.error ?? 'Git could not create the worktree.' }
      const worktree = created.worktree
      if (repository.postCreateCommand?.trim()) worktree.postCreateSetupState = 'running'
      progress('saving', 'Adding worktree to the project…')
      try {
        await worktreeStore.upsertCreated(worktree)
      } catch (error) {
        return {
          success: true,
          worktree,
          warning: `Git created the worktree, but the app could not save it: ${error instanceof Error ? error.message : String(error)}. Keep this window open and retry saving or scan the project.`,
        }
      }
      progress('registered', 'Worktree created and available.', undefined, worktree)
      let setup
      if (repository.postCreateCommand?.trim()) {
        const key = `${repository.id}:${worktree.id}`
        activeSetups.add(key)
        progress('setup', 'Running project setup…', undefined, worktree)
        try {
          setup = await runPostCreateSetup(repository, worktree)
        } catch (error) {
          setup = { success: false, output: error instanceof Error ? error.message : String(error) }
        } finally {
          activeSetups.delete(key)
        }
        if (setup) {
          worktree.postCreateSetup = setup
          worktree.postCreateSetupState = undefined
          try {
            await worktreeStore.update(worktree.id, {
              postCreateSetup: setup,
              postCreateSetupState: undefined,
            })
          } catch (error) {
            created.warning = `Setup finished, but its result could not be saved: ${error instanceof Error ? error.message : String(error)}`
          }
        }
      }
      progress(
        'done',
        setup?.success === false
          ? 'Worktree created. Setup failed; retry is available.'
          : 'Worktree ready.',
        setup?.output,
        worktree
      )
      return {
        success: true,
        worktree,
        ...(setup ? { setup } : {}),
        ...(created.warning ? { warning: created.warning } : {}),
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      activeCreations.delete(request.repositoryId)
    }
  }
)

ipcMain.handle(
  'retry-worktree-setup',
  async (event, input: { repositoryId: string; worktreeId: string }) => {
    const key = `${input.repositoryId}:${input.worktreeId}`
    if (activeCreations.has(input.repositoryId) || activeSetups.has(key))
      return { success: false, output: 'Setup is already running for this worktree.' }
    activeSetups.add(key)
    try {
      const repository = (await loadRepositories()).find((item) => item.id === input.repositoryId)
      const worktree = (await loadWorktrees()).find(
        (item) => item.id === input.worktreeId && item.repositoryId === input.repositoryId
      )
      if (!repository || !worktree)
        return { success: false, output: 'Registered worktree or project was not found.' }
      if (!repository.postCreateCommand?.trim())
        return { success: false, output: 'Configure a setup command in Project settings first.' }
      worktree.postCreateSetupState = 'running'
      await worktreeStore.update(worktree.id, { postCreateSetupState: 'running' })
      creationProgress(event, {
        repositoryId: input.repositoryId,
        stage: 'setup',
        message: 'Retrying project setup…',
        worktree,
      })
      let result
      try {
        result = await runPostCreateSetup(repository, worktree)
      } catch (error) {
        result = { success: false, output: error instanceof Error ? error.message : String(error) }
      }
      if (!result) return { success: false, output: 'No setup command is configured.' }
      worktree.postCreateSetup = result
      worktree.postCreateSetupState = undefined
      await worktreeStore.update(worktree.id, {
        postCreateSetup: result,
        postCreateSetupState: undefined,
      })
      creationProgress(event, {
        repositoryId: input.repositoryId,
        stage: 'done',
        message: result.success ? 'Setup finished.' : 'Setup failed; retry is available.',
        output: result.output,
        worktree,
      })
      return result
    } finally {
      activeSetups.delete(key)
    }
  }
)

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

    const settings = await loadSettings()
    const roots = scanRoots(options.roots ?? [], settings.includeAgentWorktrees)

    const result = await discoverRepositories({
      roots,
      maxDepth: options.maxDepth ?? 5,
      excludedPaths: settings.excludedPaths,
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
      (worktree) => worktree.repositoryId === repository.id && existsSync(worktree.path)
    )?.path ?? repository.path
  )
}

function createSemaphore(concurrency: number) {
  let inFlight = 0
  const queue: (() => void)[] = []
  return {
    acquire: async () => {
      if (inFlight < concurrency) {
        inFlight++
        return
      }
      await new Promise<void>((resolve) => queue.push(resolve))
      inFlight++
    },
    release: () => {
      inFlight--
      const next = queue.shift()
      if (next) next()
    },
  }
}

// Module-level, not per-invocation: the renderer refreshes one project at a
// time now, so several `get-worktree-statuses` calls can be in flight at once.
// A per-call semaphore would let N concurrent projects mean N × the git and
// network fan-out; these keep the ceiling the same no matter how many run.
const baseFetchSemaphore = createSemaphore(4)
const statusFetchSemaphore = createSemaphore(6)

ipcMain.handle(
  'get-worktree-statuses',
  async (event, args: { worktrees: Worktree[]; repositories: Repository[]; scopeId?: string }) => {
    const settings = await loadSettings()
    const azureCredential = args.repositories.some(
      (repo) => repo.provider?.type === 'azure' && !repo.provider.personalAccessToken
    )
      ? await resolveAzureToken(settings.azureToken)
      : { source: 'none' as const }
    const globalTokens = {
      ...(settings.githubToken ? { github: settings.githubToken } : {}),
      ...(azureCredential.token ? { azure: azureCredential.token } : {}),
    }

    // Progress is tagged with the caller's scope so two projects refreshing at
    // once each drive their own pill instead of overwriting one shared counter.
    const scopeId = args.scopeId
    const total = args.worktrees.length
    let done = 0
    const emitProgress = () =>
      event.sender.send('status-progress', { scopeId, current: done, total })
    emitProgress()

    const repositoriesById = new Map(
      args.repositories.map((repository) => [repository.id, repository])
    )

    // Start base-branch fetches per repository in parallel with the per-worktree
    // status calls. Each worktree waits only for its own repository's base snapshot
    // so repos that finish base fetching first start their worktree statuses sooner.
    const worktreeRepositoryIds = new Set(args.worktrees.map((worktree) => worktree.repositoryId))
    const relevantRepositories = args.repositories.filter((repository) =>
      worktreeRepositoryIds.has(repository.id)
    )
    const baseSnapshots = new Map<string, BaseBranchSnapshot>()
    const baseStatuses: RepositoryBaseStatus[] = []
    const basePromises = new Map<string, Promise<BaseBranchSnapshot | undefined>>()
    const repoCount = relevantRepositories.length
    let baseDone = 0
    const emitBaseProgress = () =>
      event.sender.send('base-status-progress', { scopeId, current: baseDone, total: repoCount })
    emitBaseProgress()

    for (const repository of relevantRepositories) {
      const promise = (async () => {
        await baseFetchSemaphore.acquire()
        try {
          return await refreshBaseBranch(
            statusCwd(repository, args.worktrees),
            repository.baseBranch || 'main'
          )
        } finally {
          baseFetchSemaphore.release()
        }
      })()
        .then((snapshot) => {
          baseSnapshots.set(repository.id, snapshot)
          baseStatuses.push(toRepositoryBaseStatus(repository, snapshot))
          baseDone++
          emitBaseProgress()
          return snapshot
        })
        .catch((error) => {
          baseDone++
          emitBaseProgress()
          console.error('[worktree] refreshBaseBranch failed:', repository.path, error)
          return undefined
        })
      basePromises.set(repository.id, promise)
    }

    // Fetch statuses with bounded concurrency — each does git + a network PR
    // lookup, so a few in flight is much faster than one at a time, while
    // reporting progress as each completes. The base snapshot is awaited before
    // taking a slot so a worktree waiting on its repo's fetch doesn't hold one.
    const results = await Promise.all(
      args.worktrees.map(async (worktree): Promise<WorktreeStatus | null> => {
        const repo = repositoriesById.get(worktree.repositoryId)
        if (!repo) {
          done++
          emitProgress()
          return null
        }
        const baseSnapshot = await basePromises.get(worktree.repositoryId)
        await statusFetchSemaphore.acquire()
        try {
          return await getWorktreeStatus({
            worktree,
            repository: repo,
            resolvePullRequest: (branch) =>
              refreshPullRequest(
                branch,
                repo,
                globalTokens,
                repo.provider?.type === 'azure' ? azureCredential.source : 'global'
              ),
            ...(baseSnapshot ? { baseSnapshot } : {}),
          }).catch(() => null)
        } finally {
          statusFetchSemaphore.release()
          done++
          emitProgress()
        }
      })
    )
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
    const azureCredential =
      args.repository.provider?.type === 'azure' && !args.repository.provider.personalAccessToken
        ? await resolveAzureToken(settings.azureToken)
        : { source: 'none' as const }
    const globalTokens = {
      ...(settings.githubToken ? { github: settings.githubToken } : {}),
      ...(azureCredential.token ? { azure: azureCredential.token } : {}),
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
        refreshPullRequest(
          branch,
          args.repository,
          globalTokens,
          args.repository.provider?.type === 'azure' ? azureCredential.source : 'global'
        ),
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
  async (_, args: { worktrees: Worktree[] }): Promise<{ worktreeId: string; branch: string }[]> => {
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

ipcMain.handle('update-base-branch', async (_, args: { path: string; baseBranch: string }) => {
  return updateBaseBranch(args.path, args.baseBranch)
})

// The project's pre-delete hook, run as its own step so the renderer can show
// what it printed and let the user decide what to do when it fails — rather
// than folding a failed Docker teardown into "could not remove worktree".
ipcMain.handle(
  'run-worktree-cleanup',
  async (
    _,
    args: {
      command: string
      worktreePath: string
      repoPath: string
      branch?: string
      repoName?: string
      timeoutSeconds?: number
    }
  ) => {
    try {
      const target = await verifiedRemovalTarget(
        args.worktreePath,
        args.repoPath,
        await loadRepositories(),
        await loadWorktrees()
      )
      if (
        !target ||
        !target.repository.preDeleteCommand ||
        target.repository.preDeleteCommand !== args.command
      ) {
        return {
          success: false,
          output: 'Cleanup target or project command is no longer registered.',
        }
      }
      return await runPreDeleteCommand(
        args.command,
        {
          worktreePath: args.worktreePath,
          repoPath: args.repoPath,
          ...(args.branch ? { branch: args.branch } : {}),
          ...(args.repoName ? { repoName: args.repoName } : {}),
        },
        args.timeoutSeconds
      )
    } catch (err) {
      return { success: false, output: String(err) }
    }
  }
)

ipcMain.handle(
  'sync-with-base',
  async (
    _,
    args: { path: string; baseBranch: string; target?: SyncTarget; mode?: SyncBaseMode }
  ) => {
    return syncWithBase({
      cwd: args.path,
      baseBranch: args.baseBranch,
      ...(args.target ? { target: args.target } : {}),
      ...(args.mode ? { mode: args.mode } : {}),
    })
  }
)

ipcMain.handle('push-worktree', async (_, path: string) => {
  return pushWorktree(path)
})

ipcMain.handle('checkout-branch', async (_, args: { path: string; branch: string }) => {
  const actualPath = await realpath(args.path).catch(() => args.path)
  const target = (await loadWorktrees()).find((worktree) => worktree.path === actualPath)
  if (target && setupIsRunning(target))
    return {
      success: false,
      output: 'Project setup is running. Wait for it to finish before switching branches.',
    }
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

ipcMain.handle(
  'open-in-editor',
  async (
    _,
    { path, editor, subdirectory }: { path: string; editor?: string; subdirectory?: string }
  ) => {
    const settings = await loadSettings()
    const editorId = editor || settings.defaultEditor || 'code'
    return openInEditor(resolveWorkingDirectory(path, subdirectory), editorId)
  }
)

ipcMain.handle(
  'open-in-terminal',
  async (
    _,
    { path, terminal, subdirectory }: { path: string; terminal?: string; subdirectory?: string }
  ) => {
    const settings = await loadSettings()
    const term = terminal || settings.defaultTerminal
    // Projects that keep their app in a subfolder want the shell to land there,
    // not at the worktree root they never work in.
    return openTerminalAt(resolveWorkingDirectory(path, subdirectory), term)
  }
)

// One of a project's custom actions, for one worktree. The terminal app comes
// from Settings here rather than the renderer so an action and the row's
// terminal button always open the same thing.
ipcMain.handle(
  'run-project-action',
  async (
    _,
    args: {
      command: string
      worktreePath: string
      repoPath: string
      branch?: string
      repoName?: string
      subdirectory?: string
      mode: 'terminal' | 'background'
      timeoutSeconds?: number
      label?: string
    }
  ) => {
    try {
      const settings = await loadSettings()
      return await runProjectCommand({
        command: args.command,
        context: {
          worktreePath: args.worktreePath,
          repoPath: args.repoPath,
          ...(args.branch ? { branch: args.branch } : {}),
          ...(args.repoName ? { repoName: args.repoName } : {}),
        },
        mode: args.mode,
        ...(args.subdirectory ? { subdirectory: args.subdirectory } : {}),
        ...(settings.defaultTerminal ? { terminal: settings.defaultTerminal } : {}),
        ...(args.timeoutSeconds ? { timeoutSeconds: args.timeoutSeconds } : {}),
        ...(args.label ? { label: args.label } : {}),
      })
    } catch (err) {
      return { success: false, output: String(err) }
    }
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
    {
      path,
      repoPath,
      missing,
      branch,
      deleteBranch,
      permanent,
      worktree,
      repository,
      expectedStatus,
    }: {
      path: string
      repoPath: string
      missing?: boolean
      branch?: string
      deleteBranch?: boolean
      /** Delete outright rather than move to Trash. Used by the disk cleanup
       *  flow: Trash preserves recovery, but it does not free disk space. */
      permanent?: boolean
      /** Snapshot confirmed in the UI. Permanent deletion is refused unless a
       *  fresh main-process status still describes the same landed branch. */
      worktree?: Worktree
      repository?: Repository
      expectedStatus?: WorktreeStatus
    }
  ) => {
    try {
      const target = await verifiedRemovalTarget(
        path,
        repoPath,
        await loadRepositories(),
        await loadWorktrees()
      )
      if (!target)
        return { success: false, error: 'Removal target is not a registered Git worktree.' }
      if (setupIsRunning(target.worktree))
        return {
          success: false,
          error: 'Project setup is running. Wait for it to finish before removing this worktree.',
        }
      if (missing && existsSync(path))
        return {
          success: false,
          error: 'The worktree directory exists; refresh before removing it.',
        }
      if (
        worktree &&
        (worktree.id !== target.worktree.id || repository?.id !== target.repository.id)
      ) {
        return { success: false, error: 'Removal target does not match the registered worktree.' }
      }
      worktree = target.worktree
      repository = target.repository
      // Any automatic branch deletion is destructive even when the directory
      // itself goes to Trash. Revalidate it in main; renderer status is only a
      // display snapshot and can change before the click reaches IPC.
      const requiresSafetyValidation = permanent || deleteBranch === true
      if (requiresSafetyValidation) {
        if (!worktree || !repository || !expectedStatus) {
          return {
            success: false,
            error: 'Automatic branch deletion requires a fresh safety check.',
          }
        }
        if (path !== worktree.path || repoPath !== repository.path) {
          return {
            success: false,
            error: 'The deletion target does not match the verified worktree.',
          }
        }
        const settings = await loadSettings()
        const azureCredential =
          repository.provider?.type === 'azure' && !repository.provider.personalAccessToken
            ? await resolveAzureToken(settings.azureToken, true)
            : { source: 'none' as const }
        const globalTokens = {
          ...(settings.githubToken ? { github: settings.githubToken } : {}),
          ...(azureCredential.token ? { azure: azureCredential.token } : {}),
        }
        const baseSnapshot = await refreshBaseBranch(
          statusCwd(repository!, [worktree!]),
          repository.baseBranch || 'main'
        ).catch(() => undefined)
        if (!baseSnapshot) {
          return { success: false, error: 'Could not verify the base branch before deletion.' }
        }
        const { status: rechecked, stable: sameLocalState } = await recheckRemovalStatus({
          worktree,
          repository,
          resolvePullRequest: (liveBranch) =>
            refreshPullRequest(
              liveBranch,
              repository!,
              globalTokens,
              repository!.provider?.type === 'azure' ? azureCredential.source : 'global',
              true
            ),
          ...(baseSnapshot ? { baseSnapshot } : {}),
        })
        const expectedBranch = expectedStatus.branch ?? worktree.branch
        const freshBranch = rechecked.branch ?? worktree.branch
        const sameSnapshot =
          sameLocalState &&
          freshBranch === expectedBranch &&
          rechecked.headCommit === expectedStatus.headCommit &&
          rechecked.dirty === expectedStatus.dirty &&
          rechecked.staged === expectedStatus.staged &&
          rechecked.hasUntracked === expectedStatus.hasUntracked &&
          rechecked.ahead === expectedStatus.ahead &&
          rechecked.unpushed === expectedStatus.unpushed
        const freshCandidacy = cleanupCandidacy(worktree, rechecked)
        // Permanent cleanup is reserved for the plain, clean case. A review
        // candidate can still be removed to Trash, but its uncommitted,
        // untracked or unpushed contents must remain recoverable.
        if (!sameSnapshot || freshCandidacy?.kind !== 'ready') {
          return {
            success: false,
            error:
              'This worktree changed after the cleanup list was opened. It was kept; refresh and review it again.',
          }
        }
        // Branch deletion below must use the status we just proved, not the
        // renderer's snapshot. Squash-merged PRs are landed even though their
        // head is not an ancestor of base.
        branch = freshBranch
        deleteBranch = freshCandidacy.kind === 'ready'
      }

      // Use the paths loaded from persisted records for every destructive call.
      path = worktree.path
      repoPath = repository.path

      // Present worktree: ordinary row deletes go to the system Trash and stay
      // recoverable. Explicit disk cleanup deletes outright so its promised
      // reclaimed bytes are real immediately.
      // Missing/stale worktree: nothing on disk to remove — skip straight to prune.
      if (!missing) {
        try {
          if (permanent) await rm(path, { recursive: true, force: true })
          else await shell.trashItem(path)
        } catch (err) {
          // If it failed only because the folder is already gone, fall through to
          // prune so git's stale record still gets cleaned up.
          if (existsSync(path)) return { success: false, error: String(err) }
        }
      }
      invalidateDiskUsage(path)
      // Deregister from git so no prunable "ghost" entry lingers (this also clears
      // any other already-stale worktrees in the same repo).
      if (repoPath) await pruneWorktrees(repoPath).catch(() => undefined)
      // Record the successful Git removal before any older renderer scan can save
      // its snapshot. The store tombstone also rejects a late stale save.
      await worktreeStore.remove(worktree.id).catch((error) => {
        console.error('[worktree] could not persist removed worktree', error)
      })
      if (repoPath && deleteBranch && branch && branch !== 'HEAD') {
        const result = await deleteLocalBranch(repoPath, branch)
        if (!result.success) {
          return {
            success: true,
            branchError: `Worktree removed, but the local branch could not be deleted: ${result.output}`,
          }
        }
      }
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  }
)

// Measuring a worktree walks its whole tree, so results are held per path and
// only re-measured on request (after a reclaim, or when the user asks). The
// cache also collapses the burst of parallel calls a project's list makes when
// several rows ask for the same path at once.
const diskUsageCache = new Map<string, WorktreeDiskUsage>()
const diskUsageInFlight = new Map<string, Promise<WorktreeDiskUsage>>()
// Incrementing a path invalidates both its cached result and every measurement
// already walking it. A stale promise may still finish, but it cannot put its
// old number back after a reclaim/removal or overwrite a newer refresh.
const diskUsageGeneration = new Map<string, number>()

function invalidateDiskUsage(path: string): void {
  diskUsageCache.delete(path)
  diskUsageGeneration.set(path, (diskUsageGeneration.get(path) ?? 0) + 1)
}

ipcMain.handle(
  'measure-worktree-disk',
  async (
    _,
    { worktreeId, path, refresh }: { worktreeId: string; path: string; refresh?: boolean }
  ): Promise<WorktreeDiskUsage> => {
    if (!refresh) {
      const cached = diskUsageCache.get(path)
      if (cached) return { ...cached, worktreeId }
      const pending = diskUsageInFlight.get(path)
      if (pending) return pending.then((usage) => ({ ...usage, worktreeId }))
    }

    // A forced refresh supersedes any older walk of the same path.
    if (refresh) invalidateDiskUsage(path)
    const generation = diskUsageGeneration.get(path) ?? 0
    let work: Promise<WorktreeDiskUsage>
    work = measureWorktreeDisk(path)
      .then((measurement) => {
        const usage: WorktreeDiskUsage = {
          worktreeId,
          path,
          totalBytes: measurement.totalBytes,
          reclaimableBytes: measurement.reclaimableBytes,
          entries: measurement.entries,
          measuredAt: Date.now(),
          ...(measurement.error ? { error: measurement.error } : {}),
        }
        if (!usage.error && diskUsageGeneration.get(path) === generation) {
          diskUsageCache.set(path, usage)
        }
        return usage
      })
      .finally(() => {
        if (diskUsageInFlight.get(path) === work) diskUsageInFlight.delete(path)
      })

    diskUsageInFlight.set(path, work)
    return work
  }
)

ipcMain.handle(
  'reclaim-worktree-space',
  async (_, { path, entries }: { path: string; entries: string[] }) => {
    try {
      const result = await reclaimWorktreeSpace(path, entries)
      invalidateDiskUsage(path)
      return result
    } catch (err) {
      return { freedBytes: 0, removed: [], errors: [String(err)] }
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
ipcMain.handle('get-available-editors', async () => getAvailableEditors())
ipcMain.handle('get-editor-icons', async (_, editorIds: string[]) => getEditorIcons(editorIds))

ipcMain.handle('get-repo-branches', async (_, path: string) => {
  const [branches, defaultBranch] = await Promise.all([
    getBranches(path).catch(() => [] as string[]),
    getDefaultBranch(path).catch(() => undefined),
  ])
  return { branches, defaultBranch }
})

ipcMain.handle('encrypt-token', async (_, token: string) => {
  if (!secureStorage.isEncryptionAvailable())
    throw new Error('Secure credential storage is unavailable.')
  return safeStorage.encryptString(token).toString('base64')
})

ipcMain.handle('decrypt-token', async (_, encrypted: string) => {
  if (!secureStorage.isEncryptionAvailable())
    throw new Error('Secure credential storage is unavailable.')
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
