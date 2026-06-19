import { useState, useEffect, useRef } from 'react'
import { Mic, Cpu, CheckCircle2, Zap } from 'lucide-react'
import './Setup.css'

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
  const logRef = useRef(null)

  const addLog = (msg) => {
    setLogs(prev => [...prev, msg])
    setTimeout(() => { if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight }, 30)
  }

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
        <h1><Mic size={28} /> Stradiz Transcriber</h1>
        <p className="subtitle">GPU-accelerated transcription on your machine</p>

        <div className="status-row">
          <span className="status-dot" style={{ background: done ? 'var(--green)' : downloading ? 'var(--yellow)' : 'var(--text-dim)' }} />
          <span>{status}</span>
        </div>

        {gpu && (
          <div className="gpu-row">
            {gpu === 'amd' && <span className="badge amd"><Zap size={12} /> AMD GPU (Vulkan)</span>}
            {gpu === 'nvidia' && <span className="badge nvidia"><Zap size={12} /> NVIDIA GPU (Vulkan)</span>}
            {gpu === 'cpu' && <span className="badge cpu"><Cpu size={12} /> CPU only</span>}
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
          <div className="setup-log" ref={logRef}>
            {logs.map((l, i) => <div key={i} className="setup-log-line">{l}</div>)}
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
