import { BrowserRouter } from 'react-router-dom'

import { AppBootstrap } from './providers/app-bootstrap'
import { AppRoutes } from './routes/app-routes'

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <AppBootstrap>
        <AppRoutes />
      </AppBootstrap>
    </BrowserRouter>
  )
}
