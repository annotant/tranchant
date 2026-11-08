import { createRoot } from 'react-dom/client'
import App from './App'
import { PAGE_CSS } from './styles'

function mount() {
  const root = document.getElementById('root')
  if (!root) return
  const style = document.createElement('style')
  style.textContent = PAGE_CSS
  document.head.append(style)
  createRoot(root).render(<App />)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else mount()
