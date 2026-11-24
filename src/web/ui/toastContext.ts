import { createContext, useContext } from 'react'

export type ToastKind = 'success' | 'info' | 'warning' | 'error'

export interface ToastOptions {
  action?: { label: string; onAction: () => void }
}

export interface ToastApi {
  success: (message: string, options?: ToastOptions) => void
  info: (message: string, options?: ToastOptions) => void
  warning: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast needs a ToastProvider')
  return api
}
