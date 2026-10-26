export type RemovalPhase = 'sweeping' | 'hidden'

export interface RemovalFailure {
  worktreeId: string
  repositoryId: string
  message: string
}

/** Process-long state: Dashboard can unmount while a cleanup hook is running. */
export function createRemovalVisibility(
  clock: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'> = globalThis
) {
  let phases: Record<string, RemovalPhase> = {}
  let failure: RemovalFailure | null = null
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const listeners = new Set<() => void>()
  const emit = () => listeners.forEach((listener) => listener())
  return {
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    getSnapshot: () => phases,
    getFailure: () => failure,
    begin(id: string): boolean {
      if (id in phases) return false
      phases = { ...phases, [id]: 'sweeping' }
      if (failure?.worktreeId === id) failure = null
      emit()
      timers.set(
        id,
        clock.setTimeout(() => {
          timers.delete(id)
          if (!(id in phases)) return
          phases = { ...phases, [id]: 'hidden' }
          emit()
        }, 220)
      )
      return true
    },
    finish(id: string): void {
      const timer = timers.get(id)
      if (timer !== undefined) clock.clearTimeout(timer)
      timers.delete(id)
      if (!(id in phases)) return
      const { [id]: _finished, ...rest } = phases
      phases = rest
      emit()
    },
    fail(failed: RemovalFailure): void {
      failure = failed
      this.finish(failed.worktreeId)
      emit()
    },
    clearFailure(): void {
      failure = null
      emit()
    },
    isPending: (id: string) => id in phases,
  }
}

export const removalVisibility = createRemovalVisibility()
/** A scan started before deletion cannot resurrect a removed path. */
export const removedWorktreePaths = new Set<string>()
