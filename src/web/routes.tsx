import { Navigate, type RouteObject } from 'react-router-dom'
import { GalleryPage } from './pages/design/GalleryPage'
import { PlainLayoutPage } from './pages/design/PlainLayoutPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SectionPage } from './pages/SectionPage'
import { AppShell } from './shell/AppShell'
import { navItems } from './shell/navigation'
import { PlainLayout } from './shell/PlainLayout'
import { RouteEffects } from './shell/RouteEffects'

/** Opting in to the v7 behaviour keeps React Router's deprecation warnings out of the console. */
export const routerFuture = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const

export const routes: RouteObject[] = [
  {
    element: <RouteEffects />,
    children: [
      { path: '/', element: <Navigate to="/time" replace /> },
      {
        element: <AppShell />,
        children: [
          ...navItems.map((item) => ({ path: item.path, element: <SectionPage key={item.id} item={item} /> })),
          { path: '/design', element: <GalleryPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      { element: <PlainLayout />, children: [{ path: '/design/plain', element: <PlainLayoutPage /> }] },
    ],
  },
]
