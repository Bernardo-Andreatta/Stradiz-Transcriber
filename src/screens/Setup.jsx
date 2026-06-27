import { useState, useEffect } from 'react'
import { Cpu, CheckCircle2, Zap, Sparkles } from 'lucide-react'
import LogConsole from '../components/LogConsole.jsx'
import Waveform from '../components/Waveform.jsx'
import './Setup.css'

// Friendly label + accent for whichever GPU backend the engine will use.
const GPU_BADGES = {
  amd:    { label: 'AMD GPU (Vulkan)',    icon: Zap },
  nvidia: { label: 'NVIDIA GPU (Vulkan)', icon: Zap },
  apple:  { label: 'Apple GPU (Metal)',   icon: Sparkles },
  cpu:    { label: 'CPU only',            icon: Cpu },
}

function fmt(bytes) {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export default function Setup({ onReady }) {
  const [status, setStatus] = useState('Checking system...')
  const [logs, setLogs] = useState([])
  const [gpu, setGpu] = useState(null)
  const [progress, setProgress] = useState({})
  const [downloading, setDownloading] = useState(false)
  const [done, setDone] = useState(false)

  const addLog = (msg) => setLogs(prev => [...prev, msg])

  useEffect(() => {
    window.api.setup.onStatus(msg => { setStatus(msg); addLog(msg) })
    window.api.setup.onGpu(setGpu)
    window.api.setup.onProgress((d) => setProgress(prev => ({ ...prev, [d.task]: d })))
    window.api.setup.onDone((cfg) => {
      setDownloading(false)
      if (cfg.ready === false) {
        setDone(false)
        addLog('Setup failed — check the log above and retry.')
      } else {
        setDone(true)
        setStatus('Ready!')
        addLog('Setup complete!')
        onReady(cfg)
      }
    })
    window.api.setup.check().then(res => {
      if (res.ready) {
        setGpu(res.gpu)
        setStatus('Already configured — ready to transcribe!')
        setDone(true)
      }
    })
  }, [])

  const start = async () => {
    setDownloading(true)
    setLogs([])
    setStatus('Starting setup...')
    await window.api.setup.start()
  }

  return (
    <div className="setup">
      <div className="setup-card">
        <div className="setup-hero">
          <Waveform active={downloading} bars={7} className="setup-hero-wave" />
          <h1>Stradiz Transcriber</h1>
          <p className="subtitle">Private, GPU-accelerated transcription that runs entirely on your machine — nothing is uploaded.</p>
        </div>

        <div className="status-row">
          <span className="status-dot" style={{ background: done ? 'var(--green)' : downloading ? 'var(--yellow)' : 'var(--text-dim)' }} />
          <span>{status}</span>
        </div>

        {gpu && GPU_BADGES[gpu] && (
          <div className="gpu-row">
            <span className={`badge ${gpu}`}>
              {(() => { const Icon = GPU_BADGES[gpu].icon; return <Icon size={12} /> })()} {GPU_BADGES[gpu].label}
            </span>
          </div>
        )}

        {Object.entries(progress).map(([task, d]) => (
          <div key={task} className="dl-row">
            <div className="dl-label">
              <span>{task === 'model' ? 'Whisper large-v3 model' : task === 'vad' ? 'VAD silence detection model' : task === 'whisper' ? 'Whisper engine' : 'ffmpeg'}</span>
              <span className="dl-size">{fmt(d.rcv)} / {fmt(d.total)}</span>
            </div>
            <div className="progress-bar">
              <div className="progress-bar-fill" style={{ width: `${d.pct}%` }} />
            </div>
            <span className="dl-pct">{d.pct}%</span>
          </div>
        ))}

        {logs.length > 0 && (
          <div className="setup-log-wrap">
            <LogConsole logs={logs} title="Setup activity" emptyHint="Setup steps will appear here." />
          </div>
        )}

        {!done && (
          <button className="btn-primary start-btn" onClick={start} disabled={downloading}>
            {downloading ? 'Setting up...' : 'Download & Set Up'}
          </button>
        )}

        {done && (
          <div className="done-msg"><CheckCircle2 size={15} /> All set! Switching to Transcribe...</div>
        )}
      </div>
    </div>
  )
}
