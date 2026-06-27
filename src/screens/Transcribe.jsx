import { useState, useEffect, useRef } from 'react'
import { FolderOpen, Folder, Loader2, CheckCircle2, Clock, AlertTriangle, Play, Square, X, XCircle, Terminal, ChevronDown, ChevronUp } from 'lucide-react'
import LogConsole from '../components/LogConsole.jsx'
import Waveform from '../components/Waveform.jsx'
import './Transcribe.css'

export default function Transcribe({ config, onDone }) {
  const [files, setFiles] = useState([])
  const [running, setRunning] = useState(false)
  const [fileStates, setFileStates] = useState({})
  const [lines, setLines] = useState({})
  const [removeSilence, setRemoveSilence] = useState(true)
  const [outputDir, setOutputDir] = useState(null)
  const [debugLogs, setDebugLogs] = useState([])
  const [showLog, setShowLog] = useState(false)
  const linesRef = useRef({})
  const transcriptRef = useRef(null)

  useEffect(() => {
    window.api.transcribe.removeAllListeners()
    window.api.transcribe.onFile(({ file, status, entry, error }) => {
      setFileStates(prev => ({ ...prev, [file]: { ...(prev[file] || {}), status, entry, error } }))
    })
    window.api.transcribe.onLine(({ file, line }) => {
      linesRef.current[file] = [...(linesRef.current[file] || []), line]
      setLines({ ...linesRef.current })
      setTimeout(() => {
        if (transcriptRef.current) transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight
      }, 50)
    })
    window.api.transcribe.onProgress(({ file, progress }) => {
      setFileStates(prev => ({ ...prev, [file]: { ...(prev[file] || {}), progress } }))
    })
    window.api.transcribe.onHallucination(({ file, at, resumeAt, autoRecovery }) => {
      if (autoRecovery) {
        setFileStates(prev => ({
          ...prev,
          [file]: { ...(prev[file] || {}), lastSkip: { at, resumeAt } }
        }))
      }
    })
    window.api.transcribe.onLog((msg) => {
      setDebugLogs(prev => [...prev, msg])
    })
    return () => window.api.transcribe.removeAllListeners()
  }, [])

  const pickFiles = async () => {
    const picked = await window.api.dialog.openFiles()
    if (picked && picked.length) setFiles(picked)
  }

  const pickOutputDir = async () => {
    const dir = await window.api.dialog.openFolder()
    if (dir) setOutputDir(dir)
  }

  const start = async () => {
    if (!files.length) return
    setRunning(true)
    setDebugLogs([])
    linesRef.current = {}
    setLines({})
    setFileStates({})
    await window.api.transcribe.start(files, { ...config, removeSilence, outputDir })
    setRunning(false)
    onDone()
  }

  const activeFile = files.find(f => fileStates[f]?.status === 'transcribing') || files[files.length - 1]
  const activeLines = activeFile ? (lines[activeFile] || []) : []

  return (
    <div className="transcribe">
      <div className="left-panel">
        <div className="drop-zone" onClick={pickFiles}>
          {files.length === 0 ? (
            <>
              <span className="drop-icon"><FolderOpen size={28} /></span>
              <span>Click to select audio / video files</span>
              <span className="drop-hint">mp3, mp4, m4a, wav, ogg, mkv…</span>
            </>
          ) : (
            <span>{files.length} file{files.length > 1 ? 's' : ''} selected — click to change</span>
          )}
        </div>

        <div className="file-list">
          {files.map(f => {
            const name = f.split(/[\\/]/).pop()
            const state = fileStates[f] || {}
            return (
              <div key={f} className={`file-item ${state.status || ''}`}>
                <span className="file-name">{name}</span>
                <span className="file-status">
                  {state.status === 'converting' && <><Loader2 size={11} className="spin" /> Preparing audio…</>}
                  {state.status === 'transcribing' && <><Waveform active bars={4} /> Transcribing…</>}
                  {state.status === 'done' && <><CheckCircle2 size={11} /> Done</>}
                  {state.status === 'stopped' && <><Square size={11} /> Stopped{state.entry ? ' — partial saved' : ''}</>}
                  {state.status === 'error' && <><XCircle size={11} /> {state.error || 'Something went wrong'}</>}
                  {!state.status && <><Clock size={11} /> Queued</>}
                </span>
                {state.lastSkip && (
                  <span className="file-skip">
                    <AlertTriangle size={10} /> Skipped {state.lastSkip.at} → resumed at {state.lastSkip.resumeAt}
                  </span>
                )}
                {(state.status === 'transcribing') && (
                  <div className="progress-bar" style={{ marginTop: 6 }}>
                    <div className="progress-bar-fill" style={{ width: `${state.progress || 0}%` }} />
                  </div>
                )}
                {state.status === 'done' && (
                  <div className="progress-bar" style={{ marginTop: 6 }}>
                    <div className="progress-bar-fill" style={{ width: '100%', background: 'var(--green)' }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <label className="toggle-row">
          <input type="checkbox" checked={removeSilence} onChange={e => setRemoveSilence(e.target.checked)} />
          <span>Remove silence before transcribing</span>
        </label>

        <div className="output-dir-row">
          <button className="output-dir-btn" onClick={pickOutputDir} disabled={running}>
            <Folder size={13} /> {outputDir ? outputDir.split(/[\\/]/).pop() : 'Same as input'}
          </button>
          {outputDir && (
            <button className="output-dir-clear" onClick={() => setOutputDir(null)} disabled={running} title="Reset to same folder as input"><X size={11} /></button>
          )}
        </div>

        <div className="run-row">
          <button className="btn-primary run-btn" onClick={start} disabled={running || !files.length}>
            {running ? <><Loader2 size={14} className="spin" /> Transcribing...</> : <><Play size={14} /> Start Transcription</>}
          </button>
          {running && (
            <button className="btn-danger stop-btn" onClick={() => window.api.transcribe.stop()}>
              <Square size={14} /> Stop
            </button>
          )}
        </div>
      </div>

      <div className="right-panel">
        <div className="transcript-header">
          {activeFile && <span className="transcript-title">{activeFile.split(/[\\/]/).pop()}</span>}
          {!activeFile && <span className="transcript-title" style={{ color: 'var(--text-dim)' }}>Transcript will appear here</span>}
          <button className={`log-toggle ${showLog ? 'on' : ''}`} onClick={() => setShowLog(v => !v)} title="Toggle engine log">
            <Terminal size={13} /> Engine log
            {debugLogs.length > 0 && <span className="log-toggle-count">{debugLogs.length}</span>}
            {showLog ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
          </button>
        </div>
        <div className="transcript" ref={transcriptRef} style={showLog ? { flex: '1 1 0', minHeight: 0 } : {}}>
          {activeLines.map((line, i) => (
            <div key={i} className="transcript-line">
              <span className="line-time">{line.time}</span>
              <span className="line-text">{line.text}</span>
            </div>
          ))}
          {activeLines.length === 0 && (
            <div className="transcript-idle">
              <Waveform active={running} bars={7} className="transcript-idle-wave" />
              <span className="transcript-idle-text">
                {running
                  ? 'Listening for the first words…'
                  : 'Your transcript appears here, line by line, as the engine works.'}
              </span>
            </div>
          )}
        </div>
        {showLog && (
          <div className="engine-log-wrap">
            <LogConsole
              logs={debugLogs}
              title="Engine log"
              emptyHint="No engine output yet — start a transcription."
              onClear={() => setDebugLogs([])}
            />
          </div>
        )}
      </div>
    </div>
  )
}
