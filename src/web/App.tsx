import { RouterProvider, type RouterProviderProps } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { ToastProvider } from './ui'

/** The router is passed in so tests can use an in-memory one. */
export function App({ router }: Pick<RouterProviderProps, 'router'>) {
  return (
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} future={{ v7_startTransition: true }} />
      </AuthProvider>
    </ToastProvider>
  )
}
