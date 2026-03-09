import { BrowserRouter } from 'react-router-dom'

import { AuthProvider } from '../features/auth/auth-provider'
import { AppRoutes } from './routes/app-routes'

const basePath = (import.meta.env.VITE_BASE_PATH as string | undefined) || '/'

export function App(): JSX.Element {
  return (
    <BrowserRouter basename={basePath}>
      <AuthProvider>
        <AppRoutes />
      </AuthProvider>
    </BrowserRouter>
  )
}
