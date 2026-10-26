import { cn } from '../../lib/utils'

interface SettingsTabsProps<T extends string> {
  tabs: readonly { id: T; label: string }[]
  section: T
  onChange: (section: T) => void
  prefix: string
  label: string
}

export function SettingsTabs<T extends string>({
  tabs,
  section,
  onChange,
  prefix,
  label,
}: SettingsTabsProps<T>) {
  return (
    <div
      className="flex shrink-0 overflow-x-auto border-b border-border px-6"
      role="tablist"
      aria-label={label}
    >
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          id={`${prefix}-tab-${tab.id}`}
          type="button"
          role="tab"
          aria-selected={section === tab.id}
          aria-controls={`${prefix}-panel`}
          tabIndex={section === tab.id ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => {
            const next =
              event.key === 'ArrowRight'
                ? index + 1
                : event.key === 'ArrowLeft'
                  ? index - 1
                  : event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : null
            if (next === null) return
            event.preventDefault()
            const target = tabs[(next + tabs.length) % tabs.length]!
            onChange(target.id)
            document.getElementById(`${prefix}-tab-${target.id}`)?.focus()
          }}
          className={cn(
            'relative min-h-11 shrink-0 px-3 text-sm font-medium text-muted outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-inset',
            section === tab.id &&
              'text-primary after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:bg-primary'
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
