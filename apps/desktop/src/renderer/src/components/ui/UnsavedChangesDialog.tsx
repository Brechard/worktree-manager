import { useId } from 'react'
import { Button } from './Button'
import { Dialog } from './Dialog'

export function UnsavedChangesDialog({
  onKeep,
  onDiscard,
  onSave,
  saving = false,
  error,
}: {
  onKeep: () => void
  onDiscard: () => void
  onSave: () => void
  saving?: boolean
  error?: string | null
}) {
  const titleId = useId()
  return (
    <Dialog titleId={titleId} onClose={onKeep} canClose={!saving} size="compact">
      <div className="space-y-4 p-5">
        <div>
          <h2 id={titleId} className="text-base font-semibold">
            Unsaved changes
          </h2>
          <p className="mt-1 text-sm text-muted">Save your changes before leaving?</p>
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="quiet" onClick={onKeep} disabled={saving}>
            Keep editing
          </Button>
          <Button onClick={onDiscard} disabled={saving}>
            Discard changes
          </Button>
          <Button variant="primary" onClick={onSave} loading={saving}>
            Save changes
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
