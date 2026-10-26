import { link, lstat, mkdir, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import {
  appSettingsSchema,
  repositorySchema,
  type AppSettings,
  type Repository,
  worktreeSchema,
} from '@worktree/contracts'

interface Encryption {
  isEncryptionAvailable(): boolean
  getSelectedStorageBackend?(): string
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
}

export function hasSecureEncryption(encryption: Encryption, platform = process.platform): boolean {
  if (!encryption.isEncryptionAvailable()) return false
  if (platform !== 'linux') return true
  const backend = encryption.getSelectedStorageBackend?.()
  return !!backend && backend !== 'basic_text' && backend !== 'unknown'
}

type Envelope = { version: 1; ciphertext: string }
const envelopeSchema = z.object({ version: z.literal(1), ciphertext: z.string().min(1) })
const rawSettingsSchema = appSettingsSchema.extend({
  githubTokenEncrypted: envelopeSchema.optional(),
  azureTokenEncrypted: envelopeSchema.optional(),
})
const rawRepositorySchema = repositorySchema.extend({
  provider: repositorySchema.shape.provider
    .unwrap()
    .extend({
      personalAccessTokenEncrypted: envelopeSchema.optional(),
    })
    .optional(),
})

export function createCredentialStore(directory: string, encryption: Encryption) {
  async function readJson(path: string): Promise<unknown | undefined> {
    try {
      return JSON.parse(await readFile(path, 'utf8'))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw new Error(`Could not read ${path}: configuration is invalid or inaccessible.`)
    }
  }
  function encrypt(value: string): Envelope {
    if (!hasSecureEncryption(encryption))
      throw new Error(
        'Secure credential storage is unavailable. Enable the operating system key store and try again.'
      )
    try {
      return { version: 1, ciphertext: encryption.encryptString(value).toString('base64') }
    } catch {
      throw new Error('Could not encrypt provider credential. Existing configuration was kept.')
    }
  }
  function decrypt(value: Envelope): string {
    if (!hasSecureEncryption(encryption))
      throw new Error(
        'Secure credential storage is unavailable. Existing encrypted credentials were kept.'
      )
    try {
      return encryption.decryptString(Buffer.from(value.ciphertext, 'base64'))
    } catch {
      throw new Error('Could not decrypt provider credential. Existing configuration was kept.')
    }
  }
  async function atomicWrite(path: string, data: unknown) {
    await mkdir(directory, { recursive: true })
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, JSON.stringify(data, null, 2), { mode: 0o600 })
      await rename(temporary, path)
    } catch (error) {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw error
    }
  }
  async function loadSettings(): Promise<AppSettings> {
    const raw = readJson.bind(null, join(directory, 'settings.json'))
    const value = await raw()
    if (value === undefined) return appSettingsSchema.parse({})
    const parsed = rawSettingsSchema.parse(value)
    const result = appSettingsSchema.parse({
      ...parsed,
      ...(parsed.githubTokenEncrypted ? { githubToken: decrypt(parsed.githubTokenEncrypted) } : {}),
      ...(parsed.azureTokenEncrypted ? { azureToken: decrypt(parsed.azureTokenEncrypted) } : {}),
    })
    if (parsed.githubToken || parsed.azureToken) await saveSettings(result)
    return result
  }
  async function saveSettings(settings: AppSettings): Promise<void> {
    // Read first so a damaged file is never overwritten by an ordinary save.
    const old = await readJson(join(directory, 'settings.json'))
    if (old !== undefined) rawSettingsSchema.parse(old)
    const { githubToken, azureToken, ...plain } = appSettingsSchema.parse(settings)
    const raw = {
      ...plain,
      ...(githubToken ? { githubTokenEncrypted: encrypt(githubToken) } : {}),
      ...(azureToken ? { azureTokenEncrypted: encrypt(azureToken) } : {}),
    }
    await atomicWrite(join(directory, 'settings.json'), raw)
  }
  async function loadRepositories(): Promise<Repository[]> {
    const value = await readJson(join(directory, 'repositories.json'))
    if (value === undefined) return []
    const parsed = z.array(rawRepositorySchema).parse(value)
    const result = parsed.map((repo) =>
      repositorySchema.parse({
        ...repo,
        ...(repo.provider
          ? {
              provider: {
                ...repo.provider,
                ...(repo.provider.personalAccessTokenEncrypted
                  ? { personalAccessToken: decrypt(repo.provider.personalAccessTokenEncrypted) }
                  : {}),
              },
            }
          : {}),
      })
    )
    if (parsed.some((repo) => repo.provider?.personalAccessToken)) await saveRepositories(result)
    return result
  }
  async function saveRepositories(repositories: Repository[]): Promise<void> {
    const old = await readJson(join(directory, 'repositories.json'))
    if (old !== undefined) z.array(rawRepositorySchema).parse(old)
    const sanitized = z
      .array(repositorySchema)
      .parse(repositories)
      .map((repo) => {
        if (!repo.provider) return repo
        const { personalAccessToken, ...provider } = repo.provider
        return {
          ...repo,
          provider: {
            ...provider,
            ...(personalAccessToken
              ? { personalAccessTokenEncrypted: encrypt(personalAccessToken) }
              : {}),
          },
        }
      })
    await atomicWrite(join(directory, 'repositories.json'), sanitized)
  }
  return { loadSettings, saveSettings, loadRepositories, saveRepositories }
}

export async function migrateLegacyProfile(
  getLegacyDirectory: () => string,
  destinationDirectory: string,
  encryption: Encryption,
  explicitUserDataDir: boolean
): Promise<boolean> {
  // An explicit profile is isolated from the host's normal app-data directory,
  // even when only some of its config files have been seeded.
  if (explicitUserDataDir) return false
  if (
    ['settings.json', 'repositories.json', 'worktrees.json'].every((name) =>
      existsSync(join(destinationDirectory, name))
    )
  )
    return false
  const legacyDirectory = getLegacyDirectory()
  if (!existsSync(join(legacyDirectory, 'settings.json'))) return false
  await migrateLegacyCredentialFiles(legacyDirectory, destinationDirectory, encryption)
  return true
}

/** Copy the app's old config into its current location, then remove only the
 * credential files we copied once both destination files have migrated safely. */
export async function migrateLegacyCredentialFiles(
  legacyDirectory: string,
  destinationDirectory: string,
  encryption: Encryption
): Promise<void> {
  await mkdir(destinationDirectory, { recursive: true })
  type PreparedFile = {
    source: string
    destination: string
    original: Buffer
    contents: Buffer
    credentialFile: boolean
  }
  const created: Array<PreparedFile & { device: number; inode: number }> = []
  async function stillOwned(entry: (typeof created)[number]): Promise<boolean> {
    const info = await lstat(entry.destination).catch(() => undefined)
    if (!info?.isFile() || info.dev !== entry.device || info.ino !== entry.inode) return false
    const current = await readFile(entry.destination).catch(() => undefined)
    return !!current?.equals(entry.contents)
  }
  // Prepare every credential in memory before creating any destination file.
  // A failed encryption must not leave a plaintext copy in the new profile.
  function encrypted(value: string): Envelope {
    if (!hasSecureEncryption(encryption))
      throw new Error('Secure credential storage is unavailable. Legacy configuration was kept.')
    try {
      return { version: 1, ciphertext: encryption.encryptString(value).toString('base64') }
    } catch {
      throw new Error('Could not encrypt provider credential. Legacy configuration was kept.')
    }
  }
  function validateEncrypted(value: Envelope | undefined): void {
    if (!value) return
    if (!hasSecureEncryption(encryption))
      throw new Error('Secure credential storage is unavailable. Legacy configuration was kept.')
    try {
      encryption.decryptString(Buffer.from(value.ciphertext, 'base64'))
    } catch {
      throw new Error('Could not decrypt provider credential. Legacy configuration was kept.')
    }
  }
  async function prepareFile(name: string): Promise<PreparedFile | undefined> {
    const source = join(legacyDirectory, name)
    const destination = join(destinationDirectory, name)
    const existing = await lstat(destination).catch((error) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    })
    if (existing?.isFile()) return undefined
    let original: Buffer
    try {
      original = await readFile(source)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
      throw error
    }
    let contents = original
    if (name === 'settings.json') {
      const parsed = rawSettingsSchema.parse(JSON.parse(original.toString('utf8')))
      const { githubToken, azureToken, ...plain } = parsed
      validateEncrypted(parsed.githubTokenEncrypted)
      validateEncrypted(parsed.azureTokenEncrypted)
      contents = Buffer.from(
        JSON.stringify(
          {
            ...plain,
            ...(githubToken ? { githubTokenEncrypted: encrypted(githubToken) } : {}),
            ...(azureToken ? { azureTokenEncrypted: encrypted(azureToken) } : {}),
          },
          null,
          2
        )
      )
    } else if (name === 'repositories.json') {
      const parsed = z.array(rawRepositorySchema).parse(JSON.parse(original.toString('utf8')))
      for (const repo of parsed) validateEncrypted(repo.provider?.personalAccessTokenEncrypted)
      contents = Buffer.from(
        JSON.stringify(
          parsed.map((repo) => {
            if (!repo.provider) return repo
            const { personalAccessToken, ...provider } = repo.provider
            return {
              ...repo,
              provider: {
                ...provider,
                ...(personalAccessToken
                  ? { personalAccessTokenEncrypted: encrypted(personalAccessToken) }
                  : {}),
              },
            }
          }),
          null,
          2
        )
      )
    } else {
      z.array(worktreeSchema).parse(JSON.parse(original.toString('utf8')))
    }
    return {
      source,
      destination,
      original,
      contents,
      credentialFile: name !== 'worktrees.json',
    }
  }
  // Read and validate all sources before any destination is created. The
  // independent reads may overlap; commit and cleanup below stay ordered.
  const prepared = (
    await Promise.all(['settings.json', 'repositories.json', 'worktrees.json'].map(prepareFile))
  ).filter((entry): entry is PreparedFile => entry !== undefined)
  async function commitPreparedFile(index: number): Promise<void> {
    const entry = prepared[index]
    if (!entry) return
    const temporary = `${entry.destination}.${randomUUID()}.tmp`
    try {
      await writeFile(temporary, entry.contents, { flag: 'wx', mode: 0o600 })
      try {
        const info = await lstat(temporary)
        // link is atomic and fails if another process already owns this name.
        await link(temporary, entry.destination)
        created.push({ ...entry, device: info.dev, inode: info.ino })
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (!(await lstat(entry.destination)).isFile())
          throw new Error('Legacy destination is not a regular file. Originals were kept.')
      }
    } finally {
      await rm(temporary, { force: true })
    }
    await commitPreparedFile(index + 1)
  }
  async function verifyCreatedFile(index: number): Promise<void> {
    const entry = created[index]
    if (!entry) return
    if (!(await stillOwned(entry)))
      throw new Error('Legacy destination changed during migration. Originals were kept.')
    await verifyCreatedFile(index + 1)
  }
  try {
    await commitPreparedFile(0)
    await verifyCreatedFile(0)
  } catch (error) {
    // Roll back only files this invocation created and that still contain its
    // bytes. A concurrent writer or a partial preexisting profile is retained.
    await Promise.all(
      created.map(async (entry) => {
        if (await stillOwned(entry)) await rm(entry.destination, { force: true })
      })
    )
    throw error
  }
  async function removeOriginalCredential(index: number): Promise<void> {
    const entry = created[index]
    if (!entry) return
    if (entry.credentialFile) {
      const source = await readFile(entry.source).catch(() => undefined)
      if ((await stillOwned(entry)) && source?.equals(entry.original)) await unlink(entry.source)
    }
    await removeOriginalCredential(index + 1)
  }
  await removeOriginalCredential(0)
}
