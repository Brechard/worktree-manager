import type { RemovalPhase } from './removalVisibility'

export interface RemovalBackendResult {
  success: boolean
  error?: string
  branchError?: string
}
export interface RemovalOutcome {
  deleted: boolean
  error?: string
}

/** Runs only after confirmation. Store mutation happens solely after backend success. */
export async function runRemovalOperation(args: {
  id: string
  visibility: {
    begin: (id: string) => boolean
    finish: (id: string) => void
    isPending: (id: string) => boolean
    getSnapshot: () => Record<string, RemovalPhase>
  }
  preclaimed?: boolean
  cleanup: () => Promise<boolean>
  remove: () => Promise<RemovalBackendResult>
  commit: () => void
  persist: () => Promise<void>
  refreshAfterFailure: () => void
  waitForSweep?: () => Promise<void>
}): Promise<RemovalOutcome> {
  const { id, visibility } = args
  if (args.preclaimed ? !visibility.isPending(id) : !visibility.begin(id)) return { deleted: false }
  let deleted = false
  try {
    if (!(await args.cleanup()))
      return { deleted: false, error: 'Removal cancelled after the cleanup command failed.' }
    const result = await args.remove()
    if (!result.success)
      return { deleted: false, error: result.error || 'Failed to remove worktree' }
    deleted = true
    await (args.waitForSweep?.() ?? Promise.resolve())
    args.commit()
    try {
      await args.persist()
    } catch (error) {
      return {
        deleted: true,
        error: `Worktree removed, but the list could not be saved: ${String(error)}`,
      }
    }
    return result.branchError ? { deleted: true, error: result.branchError } : { deleted: true }
  } catch (error) {
    return { deleted, error: String(error) }
  } finally {
    visibility.finish(id)
    if (!deleted) args.refreshAfterFailure()
  }
}
