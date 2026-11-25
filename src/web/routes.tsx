import type { ReactElement } from 'react'
import { Navigate, type RouteObject } from 'react-router-dom'
import { Needs } from './auth/Needs'
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
import { RolePage } from './pages/settings/RolePage'
import { RolesPage } from './pages/settings/RolesPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { TeamPage } from './pages/team/TeamPage'
import { AccountMenu } from './shell/AccountMenu'
import { AppShell } from './shell/AppShell'
import { type NavItem, navItems } from './shell/navigation'
import { PlainLayout } from './shell/PlainLayout'
import { RouteEffects } from './shell/RouteEffects'
import { SignedInShell } from './shell/SignedInShell'

/** Opting in to the v7 behaviour keeps React Router's deprecation warnings out of the console. */
export const routerFuture = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const

/** Sections that have been built; the others say that they are not there yet. */
const built: Partial<Record<string, ReactElement>> = { team: <TeamPage />, settings: <SettingsPage /> }

const sectionPage = ({ needs, ...item }: NavItem) => {
  const page = built[item.id] ?? <SectionPage key={item.id} item={item} />
  return needs ? (
    <Needs any={needs} title={item.label}>
      {page}
    </Needs>
  ) : (
    page
  )
}

export const routes: RouteObject[] = [
  {
    element: <RouteEffects />,
    children: [
      { path: '/', element: <Navigate to="/home" replace /> },
      {
        element: <RequireActive><SignedInShell /></RequireActive>,
        children: [
          ...navItems.map((item) => ({ path: item.path, element: sectionPage(item) })),
          { path: '/team/:id', element: <Needs any={['people.view']} title="Person"><PersonPage /></Needs> },
          { path: '/settings/roles', element: <Needs any={['roles.manage']} title="Roles"><RolesPage /></Needs> },
          { path: '/settings/roles/:id', element: <Needs any={['roles.manage']} title="Role"><RolePage /></Needs> },
          { path: '/account', element: <AccountPage /> },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
      { element: <AppShell headerContent={<AccountMenu />} />, children: [{ path: '/design', element: <GalleryPage /> }] },
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
