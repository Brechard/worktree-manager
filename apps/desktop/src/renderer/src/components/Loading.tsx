import { Loader2 } from 'lucide-react'

export interface LoadingProps {
  message: string
  subMessage?: string | undefined
}

export function Loading({ message, subMessage }: LoadingProps) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-warning/50 bg-warning/20 px-3.5 py-2 text-xs font-semibold text-warning shadow-lg backdrop-blur">
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
      <span className="truncate">{subMessage ? `${message} ${subMessage}` : message}</span>
    </div>
  )
}
