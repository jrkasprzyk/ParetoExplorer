import React from 'react'
import ReactDOM from 'react-dom/client'
import 'parasol-es/dist/parcoords.css'
import './parasol-overrides.css'
import ParetoApp from './ParetoApp.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ParetoApp />
  </React.StrictMode>,
)
