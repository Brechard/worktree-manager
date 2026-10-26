import { type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

export type FieldDensity = 'default' | 'compact'

export function Field({
  label,
  htmlFor,
  help,
  error,
  children,
  className,
}: {
  label: ReactNode
  htmlFor: string
  help?: ReactNode
  error?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <div className={cn('ui-field', className)}>
      <label htmlFor={htmlFor} className="ui-field__label">
        {label}
      </label>
      {children}
      {help && <p className="ui-field__help">{help}</p>}
      {error && (
        <p className="ui-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

export interface TextInputProps extends InputHTMLAttributes<HTMLInputElement> {
  density?: FieldDensity
}

export function TextInput({ density = 'default', className, ...props }: TextInputProps) {
  return (
    <input {...props} className={cn('ui-input', `ui-input--${density}`, 'w-full', className)} />
  )
}

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  density?: FieldDensity
}

export function Select({ density = 'default', className, ...props }: SelectProps) {
  return (
    <select {...props} className={cn('ui-input', `ui-input--${density}`, 'w-full', className)} />
  )
}
