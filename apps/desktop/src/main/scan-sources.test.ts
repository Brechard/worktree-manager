import { test } from 'node:test'
import assert from 'node:assert/strict'
import { appSettingsSchema } from '@worktree/contracts'
import { scanRoots } from './scan-sources.js'

test('default scan uses only selected roots, even when home agent folders exist', () => {
  const settings = appSettingsSchema.parse({ watchedDirectories: ['/fixture/chosen'] })
  assert.equal(settings.includeAgentWorktrees, false)
  const roots = scanRoots(
    settings.watchedDirectories,
    settings.includeAgentWorktrees,
    '/fixture/home',
    () => true
  )
  assert.deepEqual(roots, ['/fixture/chosen'])
})

test('opted-in scan adds existing agent roots and keeps explicitly selected agent roots', () => {
  const exists = (path: string) => path.endsWith('/.codex') || path.endsWith('/.claude')
  assert.deepEqual(scanRoots(['/fixture/chosen'], true, '/fixture/home', exists), [
    '/fixture/chosen',
    '/fixture/home/.codex',
    '/fixture/home/.claude',
  ])
  assert.deepEqual(scanRoots(['/fixture/home/.codex'], false, '/fixture/home', exists), [
    '/fixture/home/.codex',
  ])
})
