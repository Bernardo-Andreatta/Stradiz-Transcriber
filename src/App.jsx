import { useState, useEffect } from 'react'
import { Mic, Cpu, Info, X } from 'lucide-react'
import Setup from './screens/Setup.jsx'
import Transcribe from './screens/Transcribe.jsx'
import Catalog from './screens/Catalog.jsx'
import Waveform from './components/Waveform.jsx'
import './App.css'

function AboutModal({ onClose }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title"><Mic size={16} /> Stradiz Transcriber</span>
          <button className="modal-close" onClick={onClose}><X size={14} /></button>
        </div>
        <p className="modal-desc">
          A local, privacy-first audio transcription app with an editable subtitle catalog,
          hallucination recovery, and GPU acceleration.
        </p>
        <p className="modal-built">Built by <strong>Stradiz</strong></p>
        <div className="modal-credits">
          <div className="credit-title">Open-source components</div>
          <div className="credit-row">
            <span className="credit-name">whisper.cpp</span>
            <span className="credit-author">© The ggml authors — MIT License</span>
          </div>
          <div className="credit-row">
            <span className="credit-name">OpenAI Whisper</span>
            <span className="credit-author">© OpenAI — MIT License</span>
          </div>
          <div className="credit-row">
            <span className="credit-name">FFmpeg</span>
            <span className="credit-author">© FFmpeg contributors — LGPL / GPL</span>
          </div>
        </div>
        <div className="modal-version">v1.0.1</div>
      </div>
    </div>
  )
}

export default function App() {
  const [screen, setScreen] = useState('setup')
  const [config, setConfig] = useState(null)
  const [showAbout, setShowAbout] = useState(false)

  useEffect(() => {
    window.api.setup.check().then(res => {
      if (res.ready) {
        setConfig(res)
        setTimeout(() => setScreen('transcribe'), 2000)
      }
    })
  }, [])

  return (
    <div className="app">
      <nav className="nav">
        <span className="nav-logo"><Waveform className="nav-wave" /> Stradiz Transcriber</span>
        <div className="nav-links">
          <button className={screen === 'transcribe' ? 'active' : ''} onClick={() => setScreen('transcribe')} disabled={!config}>Transcribe</button>
          <button className={screen === 'catalog' ? 'active' : ''} onClick={() => setScreen('catalog')} disabled={!config}>Catalog</button>
          <button className={screen === 'setup' ? 'active' : ''} onClick={() => setScreen('setup')}>Setup</button>
        </div>
        <div className="nav-right">
          {config && (
            <span className="gpu-badge">
              <Cpu size={12} />
              {config.gpu === 'amd' ? ' AMD GPU' : config.gpu === 'nvidia' ? ' NVIDIA GPU' : config.gpu === 'apple' ? ' Apple GPU' : ' CPU'}
              <span className="gpu-dot" data-gpu={config.gpu} />
            </span>
          )}
          <button className="about-btn" onClick={() => setShowAbout(true)} title="About"><Info size={15} /></button>
        </div>
      </nav>

      <main className="main">
        {screen === 'setup' && <Setup onReady={(cfg) => { setConfig(cfg); setScreen('transcribe') }} />}
        {/* Transcribe stays mounted once set up so an in-progress transcription
            keeps running and updating when you switch tabs — only hidden. */}
        {config && <Transcribe config={config} onDone={() => setScreen('catalog')} hidden={screen !== 'transcribe'} />}
        {screen === 'catalog' && config && <Catalog />}
        {screen === 'transcribe' && !config && <div className="center-msg">Complete setup first.</div>}
      </main>

      {showAbout && <AboutModal onClose={() => setShowAbout(false)} />}
    </div>
  )
}
