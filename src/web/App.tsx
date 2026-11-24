import { RouterProvider, type RouterProviderProps } from 'react-router-dom'

/** The router is passed in so tests can use an in-memory one. */
export function App({ router }: Pick<RouterProviderProps, 'router'>) {
  return <RouterProvider router={router} future={{ v7_startTransition: true }} />
}
