import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeFileSync } from 'node:fs'
import {
  createCredentialStore,
  hasSecureEncryption,
  migrateLegacyCredentialFiles,
  migrateLegacyProfile,
} from './credential-store.js'

const crypto = {
  isEncryptionAvailable: () => true,
  getSelectedStorageBackend: () => 'gnome_libsecret',
  encryptString: (plain: string) => Buffer.from(`encrypted:${plain}`),
  decryptString: (encrypted: Buffer) => encrypted.toString().replace(/^encrypted:/, ''),
}

test('Linux basic_text backend is not secure credential storage', () => {
  assert.equal(
    hasSecureEncryption(
      {
        isEncryptionAvailable: crypto.isEncryptionAvailable,
        encryptString: crypto.encryptString,
        decryptString: crypto.decryptString,
      },
      'linux'
    ),
    false
  )
  assert.equal(
    hasSecureEncryption({ ...crypto, getSelectedStorageBackend: () => 'basic_text' }, 'linux'),
    false
  )
  assert.equal(
    hasSecureEncryption({ ...crypto, getSelectedStorageBackend: () => 'unknown' }, 'linux'),
    false
  )
  assert.equal(
    hasSecureEncryption({ ...crypto, getSelectedStorageBackend: () => 'gnome_libsecret' }, 'linux'),
    true
  )
})

test('migrates global and project plaintext secrets without leaving plaintext on disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wt-credentials-'))
  try {
    await writeFile(join(dir, 'settings.json'), JSON.stringify({ githubToken: 'secret-global' }))
    await writeFile(
      join(dir, 'repositories.json'),
      JSON.stringify([
        {
          id: 'r',
          name: 'r',
          path: '/fixture',
          provider: { type: 'github', repository: 'r', personalAccessToken: 'secret-project' },
        },
      ])
    )
    const store = createCredentialStore(dir, crypto)
    assert.equal((await store.loadSettings()).githubToken, 'secret-global')
    assert.equal(
      (await store.loadRepositories())[0]?.provider?.personalAccessToken,
      'secret-project'
    )
    assert.equal(
      (await readFile(join(dir, 'settings.json'), 'utf8')).includes('secret-global'),
      false
    )
    assert.equal(
      (await readFile(join(dir, 'repositories.json'), 'utf8')).includes('secret-project'),
      false
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('unavailable encryption and invalid JSON preserve original data', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wt-credentials-'))
  try {
    const path = join(dir, 'settings.json')
    await writeFile(path, '{invalid')
    const store = createCredentialStore(dir, { ...crypto, isEncryptionAvailable: () => false })
    await assert.rejects(store.loadSettings())
    assert.equal(await readFile(path, 'utf8'), '{invalid')
    await assert.rejects(store.saveSettings({ githubToken: 'secret' } as never))
    assert.equal(await readFile(path, 'utf8'), '{invalid')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('plaintext migration waits for secure storage and decryption failure preserves ciphertext', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wt-credentials-'))
  try {
    const path = join(dir, 'settings.json')
    const plain = JSON.stringify({ githubToken: 'legacy-secret' })
    await writeFile(path, plain)
    await assert.rejects(
      createCredentialStore(dir, { ...crypto, isEncryptionAvailable: () => false }).loadSettings(),
      /Secure credential storage/
    )
    assert.equal(await readFile(path, 'utf8'), plain)
    const encrypted = JSON.stringify({
      githubTokenEncrypted: { version: 1, ciphertext: Buffer.from('cipher').toString('base64') },
    })
    await writeFile(path, encrypted)
    await assert.rejects(
      createCredentialStore(dir, {
        ...crypto,
        decryptString: () => {
          throw new Error('key unavailable')
        },
      }).loadSettings(),
      /Could not decrypt/
    )
    assert.equal(await readFile(path, 'utf8'), encrypted)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('encryption failure keeps the prior healthy configuration intact', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'wt-credentials-'))
  try {
    const path = join(dir, 'settings.json')
    const store = createCredentialStore(dir, crypto)
    await store.saveSettings({ githubToken: 'original' } as never)
    const before = await readFile(path, 'utf8')
    const failing = createCredentialStore(dir, {
      ...crypto,
      encryptString: () => {
        throw new Error('secret-bearing native failure')
      },
    })
    await assert.rejects(
      failing.saveSettings({ githubToken: 'replacement' } as never),
      /Could not encrypt/
    )
    assert.equal(await readFile(path, 'utf8'), before)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('legacy migration removes only successfully migrated app-owned credential files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-legacy-'))
  const legacy = join(root, 'legacy')
  const current = join(root, 'current')
  try {
    await mkdir(legacy)
    await writeFile(join(legacy, 'settings.json'), JSON.stringify({ githubToken: 'legacy-global' }))
    await writeFile(
      join(legacy, 'repositories.json'),
      JSON.stringify([
        {
          id: 'repo',
          name: 'repo',
          path: '/fixture',
          provider: { type: 'github', repository: 'repo', personalAccessToken: 'legacy-project' },
        },
      ])
    )
    await writeFile(join(legacy, 'worktrees.json'), '[]')
    await migrateLegacyCredentialFiles(legacy, current, crypto)
    assert.equal(
      (await createCredentialStore(current, crypto).loadSettings()).githubToken,
      'legacy-global'
    )
    assert.equal(
      (await readFile(join(current, 'settings.json'), 'utf8')).includes('legacy-global'),
      false
    )
    assert.equal(
      (await readFile(join(current, 'repositories.json'), 'utf8')).includes('legacy-project'),
      false
    )
    await assert.rejects(readFile(join(legacy, 'settings.json')))
    await assert.rejects(readFile(join(legacy, 'repositories.json')))
    assert.equal(await readFile(join(legacy, 'worktrees.json'), 'utf8'), '[]')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failed legacy migration preserves originals and leaves no plaintext destination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-legacy-'))
  const legacy = join(root, 'legacy')
  const current = join(root, 'current')
  try {
    await mkdir(legacy)
    const plain = JSON.stringify({ githubToken: 'legacy-secret' })
    await writeFile(join(legacy, 'settings.json'), plain)
    await assert.rejects(
      migrateLegacyCredentialFiles(legacy, current, {
        ...crypto,
        isEncryptionAvailable: () => false,
      })
    )
    assert.equal(await readFile(join(legacy, 'settings.json'), 'utf8'), plain)
    await assert.rejects(readFile(join(current, 'settings.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('unreadable encrypted legacy credentials keep originals and preexisting destinations', async () => {
  for (const name of ['settings.json', 'repositories.json'] as const) {
    const root = await mkdtemp(join(tmpdir(), 'wt-legacy-'))
    const legacy = join(root, 'legacy')
    const current = join(root, 'current')
    try {
      await mkdir(legacy)
      await mkdir(current)
      const envelope = { version: 1, ciphertext: Buffer.from('bad-cipher').toString('base64') }
      const settings = JSON.stringify({ githubTokenEncrypted: envelope })
      const repositories = JSON.stringify([
        {
          id: 'r',
          name: 'r',
          path: '/fixture',
          provider: {
            type: 'github',
            repository: 'r',
            personalAccessTokenEncrypted: envelope,
          },
        },
      ])
      await writeFile(join(legacy, 'settings.json'), name === 'settings.json' ? settings : '{}')
      await writeFile(
        join(legacy, 'repositories.json'),
        name === 'repositories.json' ? repositories : '[]'
      )
      await writeFile(join(current, 'worktrees.json'), '[ ]')
      const original = await readFile(join(legacy, name), 'utf8')
      await assert.rejects(
        migrateLegacyCredentialFiles(legacy, current, {
          ...crypto,
          decryptString: () => {
            throw new Error('synthetic key failure')
          },
        }),
        /Could not decrypt provider credential/
      )
      assert.equal(await readFile(join(legacy, name), 'utf8'), original)
      assert.equal(await readFile(join(current, 'worktrees.json'), 'utf8'), '[ ]')
      await assert.rejects(readFile(join(current, 'settings.json')))
      await assert.rejects(readFile(join(current, 'repositories.json')))
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  }
})

test('readable encrypted legacy credentials remain usable after migration', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-legacy-'))
  const legacy = join(root, 'legacy')
  const current = join(root, 'current')
  try {
    await mkdir(legacy)
    const envelope = (secret: string) => ({
      version: 1,
      ciphertext: crypto.encryptString(secret).toString('base64'),
    })
    const settings = JSON.stringify({ githubTokenEncrypted: envelope('global') })
    const repositories = JSON.stringify([
      {
        id: 'r',
        name: 'r',
        path: '/fixture',
        provider: {
          type: 'github',
          repository: 'r',
          personalAccessTokenEncrypted: envelope('project'),
        },
      },
    ])
    await writeFile(join(legacy, 'settings.json'), settings)
    await writeFile(join(legacy, 'repositories.json'), repositories)
    await migrateLegacyCredentialFiles(legacy, current, crypto)
    const store = createCredentialStore(current, crypto)
    assert.equal((await store.loadSettings()).githubToken, 'global')
    assert.equal((await store.loadRepositories())[0]?.provider?.personalAccessToken, 'project')
    await assert.rejects(readFile(join(legacy, 'settings.json')))
    await assert.rejects(readFile(join(legacy, 'repositories.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('explicit partial profile never resolves or imports host legacy config', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-legacy-'))
  const legacy = join(root, 'synthetic-app-data', '@worktree', 'desktop', 'config')
  const current = join(root, 'custom-profile', 'config')
  try {
    await mkdir(legacy, { recursive: true })
    await mkdir(current, { recursive: true })
    const original = JSON.stringify({ githubToken: 'synthetic-legacy' })
    await writeFile(join(legacy, 'settings.json'), original)
    await writeFile(join(current, 'worktrees.json'), '[]')
    let resolved = false
    assert.equal(
      await migrateLegacyProfile(
        () => {
          resolved = true
          return legacy
        },
        current,
        crypto,
        true
      ),
      false
    )
    assert.equal(resolved, false)
    assert.equal(await readFile(join(legacy, 'settings.json'), 'utf8'), original)
    await assert.rejects(readFile(join(current, 'settings.json')))
    assert.equal(await readFile(join(current, 'worktrees.json'), 'utf8'), '[]')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('default partial profile still imports missing legacy credentials', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-legacy-'))
  const legacy = join(root, 'synthetic-app-data', '@worktree', 'desktop', 'config')
  const current = join(root, 'default-profile', 'config')
  try {
    await mkdir(legacy, { recursive: true })
    await mkdir(current, { recursive: true })
    await writeFile(
      join(legacy, 'settings.json'),
      JSON.stringify({ githubToken: 'synthetic-legacy' })
    )
    await writeFile(join(current, 'worktrees.json'), '[ ]')
    assert.equal(await migrateLegacyProfile(() => legacy, current, crypto, false), true)
    assert.equal(
      (await createCredentialStore(current, crypto).loadSettings()).githubToken,
      'synthetic-legacy'
    )
    assert.equal(await readFile(join(current, 'worktrees.json'), 'utf8'), '[ ]')
    await assert.rejects(readFile(join(legacy, 'settings.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('partial destination keeps preexisting repository and worktree files byte-for-byte', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-legacy-'))
  const legacy = join(root, 'legacy')
  const current = join(root, 'current')
  try {
    await mkdir(legacy)
    await mkdir(current)
    const oldSettings = JSON.stringify({ githubToken: 'synthetic-old' })
    const oldRepos = JSON.stringify([{ id: 'old', name: 'old', path: '/old' }])
    const currentRepos = JSON.stringify([{ id: 'current', name: 'current', path: '/current' }])
    const currentWorktrees = '[ ]'
    await writeFile(join(legacy, 'settings.json'), oldSettings)
    await writeFile(join(legacy, 'repositories.json'), oldRepos)
    await writeFile(join(legacy, 'worktrees.json'), '[]')
    await writeFile(join(current, 'repositories.json'), currentRepos)
    await writeFile(join(current, 'worktrees.json'), currentWorktrees)
    await migrateLegacyCredentialFiles(legacy, current, crypto)
    assert.equal(await readFile(join(current, 'repositories.json'), 'utf8'), currentRepos)
    assert.equal(await readFile(join(current, 'worktrees.json'), 'utf8'), currentWorktrees)
    assert.equal(await readFile(join(legacy, 'repositories.json'), 'utf8'), oldRepos)
    assert.equal(
      (await createCredentialStore(current, crypto).loadSettings()).githubToken,
      'synthetic-old'
    )
    await assert.rejects(readFile(join(legacy, 'settings.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failed encryption preserves a partial destination and all legacy originals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-legacy-'))
  const legacy = join(root, 'legacy')
  const current = join(root, 'current')
  try {
    await mkdir(legacy)
    await mkdir(current)
    const currentRepos = '[]'
    const oldSettings = JSON.stringify({ githubToken: 'synthetic-old' })
    await writeFile(join(legacy, 'settings.json'), oldSettings)
    await writeFile(join(current, 'repositories.json'), currentRepos)
    await assert.rejects(
      migrateLegacyCredentialFiles(legacy, current, {
        ...crypto,
        encryptString: () => {
          throw new Error('synthetic failure')
        },
      }),
      /Could not encrypt/
    )
    assert.equal(await readFile(join(current, 'repositories.json'), 'utf8'), currentRepos)
    assert.equal(await readFile(join(legacy, 'settings.json'), 'utf8'), oldSettings)
    await assert.rejects(readFile(join(current, 'settings.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('failure on third destination rolls back only newly created files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-legacy-'))
  const legacy = join(root, 'legacy')
  const current = join(root, 'current')
  try {
    await mkdir(legacy)
    await mkdir(current)
    const oldSettings = JSON.stringify({ githubToken: 'synthetic-old' })
    const oldRepos = '[]'
    await writeFile(join(legacy, 'settings.json'), oldSettings)
    await writeFile(join(legacy, 'repositories.json'), oldRepos)
    await writeFile(join(legacy, 'worktrees.json'), '[]')
    await mkdir(join(current, 'worktrees.json'))
    await assert.rejects(migrateLegacyCredentialFiles(legacy, current, crypto), /regular file/)
    assert.equal(await readFile(join(legacy, 'settings.json'), 'utf8'), oldSettings)
    assert.equal(await readFile(join(legacy, 'repositories.json'), 'utf8'), oldRepos)
    await assert.rejects(readFile(join(current, 'settings.json')))
    await assert.rejects(readFile(join(current, 'repositories.json')))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('source changed during migration is retained', async () => {
  const root = await mkdtemp(join(tmpdir(), 'wt-legacy-'))
  const legacy = join(root, 'legacy')
  const current = join(root, 'current')
  try {
    await mkdir(legacy)
    const source = join(legacy, 'settings.json')
    const changed = JSON.stringify({ githubToken: 'synthetic-new' })
    await writeFile(source, JSON.stringify({ githubToken: 'synthetic-old' }))
    await migrateLegacyCredentialFiles(legacy, current, {
      ...crypto,
      encryptString: (plain: string) => {
        writeFileSync(source, changed)
        return crypto.encryptString(plain)
      },
    })
    assert.equal(await readFile(source, 'utf8'), changed)
    assert.equal(
      (await createCredentialStore(current, crypto).loadSettings()).githubToken,
      'synthetic-old'
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
