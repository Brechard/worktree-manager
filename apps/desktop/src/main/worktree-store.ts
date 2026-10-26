import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { worktreeSchema, type Worktree } from '@worktree/contracts'

/** Serializes read/modify/write operations on the single worktree snapshot. */
export function createWorktreeStore(path: string) {
  let queue: Promise<unknown> = Promise.resolve()
  const createdIds = new Set<string>()
  const removedIds = new Set<string>()

  async function read(): Promise<Worktree[]> {
    try {
      return z.array(worktreeSchema).parse(JSON.parse(await readFile(path, 'utf8')))
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw error
    }
  }

  function transact<T>(
    change: (
      current: Worktree[]
    ) => Promise<{ next: Worktree[]; value: T }> | { next: Worktree[]; value: T }
  ): Promise<T> {
    const operation = queue.then(async () => {
      const { next, value } = await change(await read())
      await mkdir(dirname(path), { recursive: true })
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600 })
        await rename(temporary, path)
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined)
        throw error
      }
      return value
    })
    queue = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  return {
    read: async () => {
      await queue
      return read()
    },
    /** Renderer snapshots may predate a completed creation or removal. */
    saveSnapshot: (incoming: Worktree[]) =>
      transact((current) => {
        const previous = new Map(current.map((item) => [item.id, item]))
        const next: Worktree[] = incoming
          .filter((item) => !removedIds.has(item.id))
          .map((item) => {
            const old = previous.get(item.id)
            // Setup metadata belongs to main. A renderer snapshot may still hold
            // "running" or an older failure after a retry has already succeeded.
            return old
              ? {
                  ...item,
                  postCreateSetup: old.postCreateSetup,
                  postCreateSetupState: old.postCreateSetupState,
                  postCreateCommandOverride: old.postCreateCommandOverride,
                }
              : item
          })
        const included = new Set(next.map((item) => item.id))
        for (const item of current) {
          if (createdIds.has(item.id) && !removedIds.has(item.id) && !included.has(item.id))
            next.push(item)
        }
        return { next, value: undefined }
      }),
    upsertCreated: (worktree: Worktree) =>
      transact((current) => {
        const next = [...current.filter((item) => item.id !== worktree.id), worktree]
        return { next, value: undefined }
      }).then(() => {
        removedIds.delete(worktree.id)
        createdIds.add(worktree.id)
      }),
    update: (id: string, patch: Partial<Worktree>) =>
      transact((current) => ({
        next: current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
        value: current.some((item) => item.id === id),
      })),
    remove: (id: string) => {
      removedIds.add(id)
      createdIds.delete(id)
      return transact((current) => ({
        next: current.filter((item) => item.id !== id),
        value: undefined,
      }))
    },
  }
}
