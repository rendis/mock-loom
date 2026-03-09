import React from 'react'
import { createRoot } from 'react-dom/client'
import 'monaco-editor/min/vs/editor/editor.main.css'
import { App } from './app/App'
import { setupMonacoEnvironment } from './shared/lib/monaco/setup'
import './styles.css'

setupMonacoEnvironment()

const node = document.getElementById('root')
if (!node) {
  throw new Error('root node not found')
}

createRoot(node).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
