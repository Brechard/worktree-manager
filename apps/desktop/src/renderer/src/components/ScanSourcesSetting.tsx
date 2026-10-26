interface ScanSourcesSettingProps {
  includeAgentWorktrees: boolean
  onChange: (include: boolean) => void
}

export function ScanSourcesSetting({ includeAgentWorktrees, onChange }: ScanSourcesSettingProps) {
  return (
    <section>
      <h2 className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">
        Scan sources
      </h2>
      <label className="flex cursor-pointer items-start gap-3 rounded-md py-2 text-sm">
        <input
          type="checkbox"
          checked={includeAgentWorktrees}
          onChange={(event) => onChange(event.target.checked)}
          className="mt-0.5 accent-primary"
        />
        <span>
          <span className="block font-medium">Include worktrees created by coding tools</span>
          <span className="mt-1 block text-xs text-muted">
            Also scan coding tool folders in your home directory. Your chosen directories are always
            scanned.
          </span>
        </span>
      </label>
    </section>
  )
}
