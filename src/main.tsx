// Must stay first: makes every local-time operation in the app use Central time (see centralTime.ts).
import './centralTime'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode><App /></StrictMode>,
)
