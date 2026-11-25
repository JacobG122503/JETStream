import type { ReactElement } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'
import { KnownSession, RequireActive, SignedOutOnly } from './auth/guards'
import { AccountPage } from './pages/account/AccountPage'
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage'
import { InvitePage } from './pages/auth/InvitePage'
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage'
import { SignInPage } from './pages/auth/SignInPage'
import { SignUpPage } from './pages/auth/SignUpPage'
import { GalleryPage } from './pages/design/GalleryPage'
import { PlainLayoutPage } from './pages/design/PlainLayoutPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SectionPage } from './pages/SectionPage'
import { PersonPage } from './pages/team/PersonPage'
import { TeamPage } from './pages/team/TeamPage'
import { AccountMenu } from './shell/AccountMenu'
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

const shell = <AppShell headerContent={<AccountMenu />} />
/** Sections that have been built; the others say that they are not there yet. */
const built: Partial<Record<string, ReactElement>> = { team: <TeamPage /> }

export const routes: RouteObject[] = [
  {
    element: <RouteEffects />,
    children: [
      { path: '/', element: <Navigate to="/time" replace /> },
      {
        element: <RequireActive>{shell}</RequireActive>,
        children: [
          ...navItems.map((item) => ({ path: item.path, element: built[item.id] ?? <SectionPage key={item.id} item={item} /> })),
          { path: '/team/:id', element: <PersonPage /> },
          { path: '/account', element: <AccountPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      { element: shell, children: [{ path: '/design', element: <GalleryPage /> }] },
      {
        element: <PlainLayout />,
        children: [
          { path: '/design/plain', element: <PlainLayoutPage /> },
          { path: '/sign-in', element: <KnownSession><SignInPage /></KnownSession> },
          { path: '/sign-up', element: <SignedOutOnly><SignUpPage /></SignedOutOnly> },
          { path: '/forgot-password', element: <SignedOutOnly><ForgotPasswordPage /></SignedOutOnly> },
          { path: '/invite', element: <InvitePage /> },
          { path: '/reset-password', element: <ResetPasswordPage /> },
        ],
      },
    ],
  },
]
