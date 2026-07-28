import { useState, useEffect, useRef } from 'react'
import { FolderOpen, Folder, Loader2, CheckCircle2, Clock, AlertTriangle, Play, Square, X, XCircle, Terminal, ChevronDown, ChevronUp, Languages, Users, FlaskConical, RotateCcw } from 'lucide-react'
import LogConsole from '../components/LogConsole.jsx'
import Waveform from '../components/Waveform.jsx'
import { speakerColor, speakerLabel } from '../speakers.js'
import './Transcribe.css'

const ACCEPTED_EXT = ['mp3', 'mp4', 'm4a', 'wav', 'ogg', 'flac', 'mkv', 'mov', 'avi', 'webm', 'aac']

// Experimental-slider defaults. Each slider marks this spot on its track and
// offers a one-click reset back to it.
const VAD_THRESHOLD_DEFAULT = 0.5
const SPEAKER_THRESHOLD_DEFAULT = 0.7
// Percent position of a value along a [min,max] slider, for the default tick.
const trackPct = (v, min, max) => ((v - min) / (max - min)) * 100
const isDefault = (v, def) => Math.abs(v - def) < 0.001

// whisper.cpp language codes. 'auto' detects the spoken language per file.
const LANGUAGES = [
  { code: 'auto', label: 'Auto-detect' },
  { code: 'en', label: 'English' },
  { code: 'pt', label: 'Portuguese' },
  { code: 'es', label: 'Spanish' },
  { code: 'fr', label: 'French' },
  { code: 'de', label: 'German' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'ru', label: 'Russian' },
  { code: 'zh', label: 'Chinese' },
  { code: 'ja', label: 'Japanese' },
  { code: 'ko', label: 'Korean' },
  { code: 'ar', label: 'Arabic' },
  { code: 'hi', label: 'Hindi' },
]

export default function Transcribe({ config, onDone, hidden }) {
  const [files, setFiles] = useState([])
  const [running, setRunning] = useState(false)
  const [fileStates, setFileStates] = useState({})
  const [lines, setLines] = useState({})
  const [removeSilence, setRemoveSilence] = useState(true)
  const [vadThreshold, setVadThreshold] = useState(VAD_THRESHOLD_DEFAULT)
  const [detectSpeakers, setDetectSpeakers] = useState(false)
  const [speakerCount, setSpeakerCount] = useState(0)
  const [threshold, setThreshold] = useState(SPEAKER_THRESHOLD_DEFAULT)
  const [language, setLanguage] = useState('auto')
  const [outputDir, setOutputDir] = useState(null)
  const [debugLogs, setDebugLogs] = useState([])
  const [showLog, setShowLog] = useState(false)
  const [logHeight, setLogHeight] = useState(220)
  const [dragging, setDragging] = useState(false)
  const linesRef = useRef({})
  const transcriptRef = useRef(null)

  // Drag the top edge of the engine log to resize it. It's anchored to the
  // bottom, so dragging up (negative delta) makes it taller.
  const startLogResize = (e) => {
    e.preventDefault()
    const startY = e.clientY
    const startH = logHeight
    const onMove = (ev) => setLogHeight(Math.min(600, Math.max(120, startH - (ev.clientY - startY))))
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

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
    // Diarization replaces the whole line set for a file with speaker-tagged
    // versions once whisper is done — swap them in so the transcript shows chips.
    window.api.transcribe.onRelabel(({ file, lines: relabelled }) => {
      linesRef.current[file] = relabelled
      setLines({ ...linesRef.current })
    })
    window.api.transcribe.onDiarizeProgress(({ file, progress }) => {
      setFileStates(prev => ({ ...prev, [file]: { ...(prev[file] || {}), diarizeProgress: progress } }))
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

  const onDrop = (e) => {
    e.preventDefault()
    setDragging(false)
    if (running) return
    const paths = Array.from(e.dataTransfer.files)
      .map(f => window.api.getPathForFile(f))
      .filter(p => p && ACCEPTED_EXT.includes(p.split('.').pop().toLowerCase()))
    if (paths.length) setFiles(paths)
  }

  const onDragOver = (e) => {
    e.preventDefault()
    if (!running && !dragging) setDragging(true)
  }

  const onDragLeave = (e) => {
    e.preventDefault()
    setDragging(false)
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
    await window.api.transcribe.start(files, {
      ...config, removeSilence, vadThreshold, outputDir, language,
      detectSpeakers, speakers: detectSpeakers ? speakerCount : 0, threshold,
    })
    setRunning(false)
    onDone()
  }

  const activeFile = files.find(f => fileStates[f]?.status === 'transcribing') || files[files.length - 1]
  const activeLines = activeFile ? (lines[activeFile] || []) : []

  return (
    <div className="transcribe" style={hidden ? { display: 'none' } : undefined}>
      <div className="left-panel">
        <div
          className={`drop-zone ${dragging ? 'dragover' : ''}`}
          onClick={pickFiles}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
        >
          {files.length === 0 ? (
            <>
              <span className="drop-icon"><FolderOpen size={28} /></span>
              <span>{dragging ? 'Drop to add files' : 'Drop files here, or click to browse'}</span>
              <span className="drop-hint">mp3, mp4, m4a, wav, ogg, mkv…</span>
            </>
          ) : (
            <span>{dragging ? 'Drop to replace selection' : `${files.length} file${files.length > 1 ? 's' : ''} selected — click or drop to change`}</span>
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
                  {state.status === 'diarizing' && <><Loader2 size={11} className="spin" /> Detecting speakers… {state.diarizeProgress != null ? `${state.diarizeProgress}%` : ''}</>}
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
                {(state.status === 'diarizing') && (
                  <div className="progress-bar" style={{ marginTop: 6 }}>
                    <div className="progress-bar-fill" style={{ width: `${state.diarizeProgress || 0}%`, background: 'var(--accent2)' }} />
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
          <input type="checkbox" checked={removeSilence} onChange={e => setRemoveSilence(e.target.checked)} disabled={running} />
          <span>Skip silence while transcribing (keeps subtitle timing)</span>
        </label>

        {removeSilence && (
          <div className="threshold-box">
            <div className="threshold-head">
              <FlaskConical size={12} />
              <span className="threshold-title">Speech sensitivity</span>
              <span className="threshold-badge">experimental</span>
              <span className="threshold-meta">
                <span className="threshold-value">{vadThreshold.toFixed(2)}</span>
                {!isDefault(vadThreshold, VAD_THRESHOLD_DEFAULT) && (
                  <button
                    type="button"
                    className="threshold-reset"
                    onClick={() => setVadThreshold(VAD_THRESHOLD_DEFAULT)}
                    disabled={running}
                    title={`Reset to default (${VAD_THRESHOLD_DEFAULT.toFixed(2)})`}
                  >
                    <RotateCcw size={11} /> reset
                  </button>
                )}
              </span>
            </div>
            <div className="threshold-slider-wrap">
              <span className="threshold-tick" style={{ left: `${trackPct(VAD_THRESHOLD_DEFAULT, 0.2, 0.8)}%` }} title={`Default ${VAD_THRESHOLD_DEFAULT.toFixed(2)}`} />
              <input
                type="range"
                className="threshold-slider"
                min={0.2}
                max={0.8}
                step={0.05}
                value={vadThreshold}
                onChange={e => setVadThreshold(parseFloat(e.target.value))}
                disabled={running}
              />
            </div>
            <div className="threshold-ends">
              <span>keep faint speech</span>
              <span>only clear</span>
            </div>
            <p className="threshold-help">
              Used only while “skip silence” is on. Sets how sure the detector must be
              that audio is speech before keeping it. If quiet talkers or soft words get
              dropped, drag toward <strong>keep faint speech</strong>; if background noise
              or music is being transcribed as gibberish, drag toward <strong>only clear</strong>.
            </p>
          </div>
        )}

        <label className="toggle-row">
          <input type="checkbox" checked={detectSpeakers} onChange={e => setDetectSpeakers(e.target.checked)} disabled={running} />
          <span><Users size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />Detect speakers (label each line by who's talking)</span>
        </label>

        {detectSpeakers && (
          <div className="speaker-count-row">
            <span className="speaker-count-label">Number of speakers</span>
            <div className="stepper">
              {/* 0 = Auto is the floor; − from 2 collapses back to Auto, never below. */}
              <button
                type="button"
                className="stepper-btn"
                onClick={() => setSpeakerCount(c => (c <= 2 ? 0 : c - 1))}
                disabled={running || speakerCount === 0}
                aria-label="Fewer speakers"
              >−</button>
              <input
                className="stepper-value"
                type="text"
                inputMode="numeric"
                value={speakerCount === 0 ? 'Auto' : String(speakerCount)}
                onChange={e => {
                  const digits = e.target.value.replace(/\D/g, '')
                  if (!digits) return setSpeakerCount(0)
                  const n = Math.min(20, parseInt(digits))
                  setSpeakerCount(n < 2 ? 0 : n) // below the 2-speaker minimum = Auto
                }}
                disabled={running}
              />
              <button
                type="button"
                className="stepper-btn"
                onClick={() => setSpeakerCount(c => (c === 0 ? 2 : Math.min(20, c + 1)))}
                disabled={running || speakerCount >= 20}
                aria-label="More speakers"
              >+</button>
            </div>
            <span className="speaker-count-hint">{speakerCount === 0 ? 'auto-detect' : `exactly ${speakerCount}`}</span>
          </div>
        )}

        {detectSpeakers && speakerCount === 0 && (
          <div className="threshold-box">
            <div className="threshold-head">
              <FlaskConical size={12} />
              <span className="threshold-title">Sensitivity</span>
              <span className="threshold-badge">experimental</span>
              <span className="threshold-meta">
                <span className="threshold-value">{threshold.toFixed(2)}</span>
                {!isDefault(threshold, SPEAKER_THRESHOLD_DEFAULT) && (
                  <button
                    type="button"
                    className="threshold-reset"
                    onClick={() => setThreshold(SPEAKER_THRESHOLD_DEFAULT)}
                    disabled={running}
                    title={`Reset to default (${SPEAKER_THRESHOLD_DEFAULT.toFixed(2)})`}
                  >
                    <RotateCcw size={11} /> reset
                  </button>
                )}
              </span>
            </div>
            <div className="threshold-slider-wrap">
              <span className="threshold-tick" style={{ left: `${trackPct(SPEAKER_THRESHOLD_DEFAULT, 0.3, 0.95)}%` }} title={`Default ${SPEAKER_THRESHOLD_DEFAULT.toFixed(2)}`} />
              <input
                type="range"
                className="threshold-slider"
                min={0.3}
                max={0.95}
                step={0.05}
                value={threshold}
                onChange={e => setThreshold(parseFloat(e.target.value))}
                disabled={running}
              />
            </div>
            <div className="threshold-ends">
              <span>more speakers</span>
              <span>fewer</span>
            </div>
            <p className="threshold-help">
              Used only in auto-detect (leave “Number of speakers” at 0). It sets how
              readily two voices are treated as the <em>same</em> person.
              If auto splits one speaker into several, drag toward <strong>fewer</strong>;
              if it merges two people into one, drag toward <strong>more speakers</strong>.
              Set an exact speaker count above whenever you know it — it’s more reliable
              than tuning this.
            </p>
          </div>
        )}

        <div className="lang-row">
          <span className="lang-label"><Languages size={13} /> Language</span>
          <select
            className="lang-select"
            value={language}
            onChange={e => setLanguage(e.target.value)}
            disabled={running}
          >
            {LANGUAGES.map(l => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </div>

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
              {line.speaker && (
                <span className="speaker-chip" style={{ '--speaker-color': speakerColor(line.speaker) }}>
                  {speakerLabel(line.speaker)}
                </span>
              )}
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
          <div className="engine-log-wrap" style={{ height: logHeight }}>
            <div className="engine-log-resize" onPointerDown={startLogResize} title="Drag to resize" />
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
