import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router-dom'
import '@fontsource-variable/archivo/wdth.css'
import './styles/tokens.css'
import './styles/base.css'
import { App } from './App'
import { basePath } from './basePath'
import { routerFuture, routes } from './routes'
// Last, to win over the components' styles.
import './styles/print.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

const router = createBrowserRouter(routes, { basename: basePath, future: routerFuture })

createRoot(container).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
)
