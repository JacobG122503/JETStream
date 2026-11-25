import type { ReactElement } from 'react'
import type { RouteObject } from 'react-router-dom'
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
import { PersonPage } from './pages/team/PersonPage'
import { RolePage } from './pages/settings/RolePage'
import { RolesPage } from './pages/settings/RolesPage'
import { SettingsPage } from './pages/settings/SettingsPage'
import { ActivityPage } from './pages/settings/ActivityPage'
import { CompanyPage } from './pages/settings/CompanyPage'
import { ProjectEditPage } from './pages/work/ProjectEditPage'
import { ClientPage } from './pages/work/ClientPage'
import { ClientsPage } from './pages/work/ClientsPage'
import { ExpensesPage } from './pages/work/ExpensesPage'
import { HomePage } from './pages/work/HomePage'
import { InvoicePage } from './pages/work/InvoicePage'
import { InvoicesPage } from './pages/work/InvoicesPage'
import { NewInvoicePage } from './pages/work/NewInvoicePage'
import { ProjectPage } from './pages/work/ProjectPage'
import { ProjectsPage } from './pages/work/ProjectsPage'
import { ReportsPage } from './pages/work/ReportsPage'
import { TasksPage } from './pages/work/TasksPage'
import { TimePage } from './pages/work/TimePage'
import { TeamPage } from './pages/team/TeamPage'
import { AccountMenu } from './shell/AccountMenu'
import { AppShell } from './shell/AppShell'
import { type NavItem, navItems } from './shell/navigation'
import { PlainLayout } from './shell/PlainLayout'
import { RouteEffects } from './shell/RouteEffects'
import { SignedInShell } from './shell/SignedInShell'
import { StartPage } from './shell/StartPage'

/** Opting in to the v7 behaviour keeps React Router's deprecation warnings out of the console. */
export const routerFuture = {
  v7_relativeSplatPath: true,
  v7_fetcherPersist: true,
  v7_normalizeFormMethod: true,
  v7_partialHydration: true,
  v7_skipActionErrorRevalidation: true,
} as const

const pages: Record<string, ReactElement> = {
  home: <HomePage />, time: <TimePage />, expenses: <ExpensesPage />, projects: <ProjectsPage />, clients: <ClientsPage />, tasks: <TasksPage />, team: <TeamPage />,
  reports: <ReportsPage />, invoices: <InvoicesPage />, settings: <SettingsPage />,
}

const sectionPage = ({ needs, ...item }: NavItem) => {
  const page = pages[item.id]
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
      { path: '/', element: <StartPage /> },
      {
        element: <RequireActive><SignedInShell /></RequireActive>,
        children: [
          ...navItems.map((item) => ({ path: item.path, element: sectionPage(item) })),
          { path: '/team/:id', element: <Needs any={['people.view']} title="Person"><PersonPage /></Needs> },
          { path: '/projects/:id', element: <ProjectPage /> },
          { path: '/projects/:id/edit', element: <ProjectEditPage /> },
          { path: '/settings/company', element: <Needs any={['settings.manage']} title="Company settings"><CompanyPage /></Needs> },
          { path: '/settings/activity', element: <Needs any={['activity.view']} title="Activity log"><ActivityPage /></Needs> },
          { path: '/clients/:id', element: <Needs any={['clients.view']} title="Client"><ClientPage /></Needs> },
          { path: '/invoices/new', element: <Needs any={['invoices.manage']} title="New invoice"><NewInvoicePage /></Needs> },
          { path: '/invoices/:id', element: <Needs any={['invoices.manage']} title="Invoice"><InvoicePage /></Needs> },
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
