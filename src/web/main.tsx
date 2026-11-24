import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router-dom'
import { App } from './App'
import { basePath } from './basePath'
import { routerFuture, routes } from './routes'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

const router = createBrowserRouter(routes, { basename: basePath, future: routerFuture })

createRoot(container).render(
  <StrictMode>
    <App router={router} />
  </StrictMode>,
)
