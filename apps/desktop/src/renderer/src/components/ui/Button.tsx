import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cn } from '../../lib/utils'

export type ButtonVariant =
  'primary' | 'neutral' | 'softPrimary' | 'softWarning' | 'danger' | 'quiet'
export type ButtonSize = 'default' | 'compact'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
}

export function Button({
  variant = 'neutral',
  size = 'default',
  loading = false,
  disabled,
  type = 'button',
  ref,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn('ui-button', `ui-button--${variant}`, `ui-button--${size}`, className)}
    >
      {children}
    </button>
  )
}

export interface IconButtonProps extends Omit<ButtonProps, 'children'> {
  'aria-label': string
  children: ReactNode
}

export function IconButton({ className, ...props }: IconButtonProps) {
  return <Button {...props} className={cn('ui-icon-button', className)} />
}
