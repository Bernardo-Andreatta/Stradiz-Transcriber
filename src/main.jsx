import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Stop the window from navigating to / opening a file when one is dropped
// outside a drop target. Individual drop zones still handle their own drops.
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => e.preventDefault())

createRoot(document.getElementById('root')).render(<App />)
