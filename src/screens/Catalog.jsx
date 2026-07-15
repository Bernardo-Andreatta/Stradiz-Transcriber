import { useState, useEffect, useMemo, useRef } from 'react'
import { FolderOpen, Trash2, Save, Pencil, Play, Pause, Plus } from 'lucide-react'
import './Catalog.css'

function srtToMs(srt) {
  if (!srt) return 0
  const [hms, ms = '0'] = srt.split(',')
  const [h, m, s] = hms.split(':').map(Number)
  return (h * 3600 + m * 60 + s) * 1000 + parseInt(ms)
}

// Parse user-typed time like "4:23", "1:04:23", "4:23.5" → SRT "00:04:23,000"
function parseUserTime(input) {
  const t = input.trim().replace(',', '.')
  const [timePart, fracStr = '0'] = t.split('.')
  const parts = timePart.split(':').map(s => parseInt(s) || 0)
  let h = 0, m = 0, s
  if (parts.length >= 3) [h, m, s] = parts
  else if (parts.length === 2) [m, s] = parts
  else [s] = parts
  const ms = Math.min(999, Math.round(parseFloat('0.' + fracStr) * 1000))
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(ms).padStart(3,'0')}`
}

// Same display format readSrt produces: "MM:SS.mmm", hours kept when nonzero.
function srtToDisplay(srt) {
  if (!srt) return ''
  return srt.replace(',', '.').replace(/^00:/, '')
}

function InsertForm({ insertTime, setInsertTime, insertText, setInsertText, commitInsert, cancel, insertTimeRef }) {
  return (
    <div className="sub-insert-form" onClick={e => e.stopPropagation()}>
      <input
        ref={insertTimeRef}
        className="insert-time-input"
        placeholder="m:ss"
        value={insertTime}
        onChange={e => setInsertTime(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') cancel() }}
      />
      <textarea
        className="insert-text-input"
        placeholder="Type the missing text..."
        value={insertText}
        onChange={e => setInsertText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitInsert() }
          if (e.key === 'Escape') cancel()
        }}
      />
      <div className="insert-actions">
        <button className="btn-primary insert-save-btn" onClick={commitInsert}>Add</button>
        <button className="btn-secondary insert-cancel-btn" onClick={cancel}>Cancel</button>
      </div>
    </div>
  )
}

export default function Catalog() {
  const [items, setItems] = useState([])
  const [selected, setSelected] = useState(null)
  const [subtitles, setSubtitles] = useState([])
  const [currentTime, setCurrentTime] = useState(0)
  const [editingIdx, setEditingIdx] = useState(-1)
  const [editText, setEditText] = useState('')
  const [insertingAfterIdx, setInsertingAfterIdx] = useState(null)
  const [insertTime, setInsertTime] = useState('')
  const [insertText, setInsertText] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [hoverTime, setHoverTime] = useState(null)
  const [hoverX, setHoverX] = useState(0)
  const audioRef = useRef(null)
  const subtitleRef = useRef(null)
  const insertTimeRef = useRef(null)
  const seekTimerRef = useRef(null)
  const progressRef = useRef(null)
  const clickTimerRef = useRef(null)

  useEffect(() => {
    window.api.catalog.load().then(setItems)
  }, [])

  // The currently-playing subtitle is derived from playback position, not stored
  // in state — keeps it in sync without a setState-in-effect cascade. Always
  // compare against startRaw: it's the millisecond-precise time that actually
  // gets saved to the SRT, so tracker, seek, and file can never disagree.
  const activeIdx = useMemo(
    () => subtitles.findLastIndex(s => srtToMs(s.startRaw) / 1000 <= currentTime),
    [subtitles, currentTime]
  )

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    window.api.file.readSrt(selected.srtPath).then(subs => {
      if (cancelled) return
      setSubtitles(subs)
      setEditingIdx(-1)
      setInsertingAfterIdx(null)
      setDirty(false)
    })
    return () => { cancelled = true }
  }, [selected])

  // Keep the active subtitle scrolled into view, but not while editing/inserting.
  useEffect(() => {
    if (activeIdx < 0 || editingIdx !== -1 || insertingAfterIdx !== null) return
    const el = subtitleRef.current?.querySelector(`[data-idx="${activeIdx}"]`)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIdx])

  const deleteItem = async (e, id) => {
    e.stopPropagation()
    const updated = await window.api.catalog.delete(id)
    setItems(updated)
    if (selected?.id === id) setSelected(null)
  }

  const importFile = async () => {
    const updated = await window.api.catalog.import()
    if (updated) setItems(updated)
  }

  const startEdit = (i, text) => {
    setInsertingAfterIdx(null)
    setEditingIdx(i)
    setEditText(text)
  }

  const commitEdit = (i) => {
    // Blank lines inside a subtitle would split its block in the saved SRT
    const clean = editText.split('\n').map(s => s.trim()).filter(Boolean).join('\n')
    if (clean === subtitles[i].text) { setEditingIdx(-1); return }
    setSubtitles(subtitles.map((s, idx) => idx === i ? { ...s, text: clean } : s))
    setEditingIdx(-1)
    setDirty(true)
  }

  const startInsert = (afterIdx, e) => {
    e.stopPropagation()
    setEditingIdx(-1)
    setInsertingAfterIdx(afterIdx)
    // Pre-fill time: midpoint between surrounding lines
    const prev = afterIdx >= 0 ? subtitles[afterIdx] : null
    const next = afterIdx + 1 < subtitles.length ? subtitles[afterIdx + 1] : null
    let defaultTime = ''
    if (prev && next) {
      const midMs = Math.round((srtToMs(prev.endRaw) + srtToMs(next.startRaw)) / 2)
      const total = Math.floor(midMs / 1000)
      const m = Math.floor(total / 60), s = total % 60
      defaultTime = `${m}:${String(s).padStart(2,'0')}`
    } else if (prev) {
      const total = Math.floor(srtToMs(prev.endRaw) / 1000) + 1
      const m = Math.floor(total / 60), s = total % 60
      defaultTime = `${m}:${String(s).padStart(2,'0')}`
    }
    setInsertTime(defaultTime)
    setInsertText('')
    setTimeout(() => insertTimeRef.current?.focus(), 50)
  }

  const commitInsert = () => {
    const text = insertText.split('\n').map(s => s.trim()).filter(Boolean).join('\n')
    const timeStr = insertTime.trim()
    if (!text || !timeStr) { setInsertingAfterIdx(null); return }
    const startRaw = parseUserTime(timeStr)
    // endRaw = startRaw + 2 seconds
    const endMs = srtToMs(startRaw) + 2000
    const et = Math.floor(endMs / 1000)
    const eh = Math.floor(et / 3600), em = Math.floor((et % 3600) / 60), es = et % 60
    const endRaw = `${String(eh).padStart(2,'0')}:${String(em).padStart(2,'0')}:${String(es).padStart(2,'0')},${String(endMs % 1000).padStart(3,'0')}`
    const newLine = { time: srtToDisplay(startRaw), startRaw, endRaw, text }
    const updated = [...subtitles, newLine].sort((a, b) => srtToMs(a.startRaw) - srtToMs(b.startRaw))
    setSubtitles(updated)
    setInsertingAfterIdx(null)
    setDirty(true)
  }

  const seek = (delta) => {
    const audio = audioRef.current
    if (!audio) return
    const shouldResume = !audio.paused || seekTimerRef.current != null
    audio.currentTime = Math.max(0, audio.currentTime + delta)
    if (shouldResume) {
      if (!audio.paused) audio.pause()
      clearTimeout(seekTimerRef.current)
      seekTimerRef.current = setTimeout(() => { seekTimerRef.current = null; audio.play() }, 250)
    }
  }

  const formatTime = (s) => {
    if (!isFinite(s) || s == null) return ''
    const h = Math.floor(s / 3600)
    const m = Math.floor((s % 3600) / 60)
    const sec = Math.floor(s % 60)
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
    return `${m}:${String(sec).padStart(2,'0')}`
  }

  const onProgressMouseMove = (e) => {
    const rect = progressRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    setHoverTime(ratio * duration)
    setHoverX(e.clientX - rect.left)
  }

  const onProgressClick = (e) => {
    if (!audioRef.current || !duration) return
    const rect = progressRef.current.getBoundingClientRect()
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width))
    audioRef.current.currentTime = ratio * duration
  }

  const togglePlay = () => {
    const audio = audioRef.current
    if (!audio) return
    if (audio.paused) { audio.play() } else { audio.pause() }
  }

  const setPlaybackSpeed = (s) => {
    setSpeed(s)
    if (audioRef.current) audioRef.current.playbackRate = s
  }

  const save = async () => {
    setSaving(true)
    await window.api.file.saveSrt({ srtPath: selected.srtPath, txtPath: selected.txtPath, lines: subtitles })
    setSaving(false)
    setDirty(false)
  }


  return (
    <div className="catalog">
      <div className="catalog-list">
        <div className="catalog-header">
          <span>Transcribed Files</span>
          <button className="catalog-import-btn" onClick={importFile} title="Import audio + SRT"><Plus size={11} /> Import</button>
        </div>
        {items.length === 0 && <div className="catalog-empty">Your transcriptions will appear here. Transcribe a file, or import one you already have.</div>}
        {items.map(item => (
          <div
            key={item.id}
            className={`catalog-item ${selected?.id === item.id ? 'active' : ''}`}
            onClick={() => setSelected(item)}
          >
            <div className="ci-name">{item.name.replace(/_whisper\.wav$/i, '')}</div>
            <div className="ci-date">{new Date(item.date).toLocaleDateString()}</div>
            <div className="ci-actions">
              <button
                className="ci-folder"
                title="Open folder"
                onClick={e => {
                  e.stopPropagation()
                  const p = item.srtPath || item.filePath
                  const folder = p.substring(0, p.lastIndexOf('\\') + 1) || p.substring(0, p.lastIndexOf('/') + 1)
                  window.api.shell.openFolder(folder)
                }}
              ><FolderOpen size={12} /></button>
              <button className="ci-delete" onClick={(e) => deleteItem(e, item.id)}><Trash2 size={12} /></button>
            </div>
          </div>
        ))}
      </div>

      <div className="catalog-player">
        {!selected && <div className="player-empty">Pick a transcription to play and edit its lines.</div>}
        {selected && (
          <>
            <div className="player-top">
              <div className="player-name-row">
                <span className="player-name">{selected.name}</span>
                {dirty && (
                  <button className="btn-primary save-btn" onClick={save} disabled={saving}>
                    {saving ? 'Saving...' : <><Save size={13} /> Save edits</>}
                  </button>
                )}
              </div>
              <audio
                ref={audioRef}
                src={encodeURI(`file:///${selected.filePath.replace(/\\/g, '/')}`)}
                onTimeUpdate={e => setCurrentTime(e.target.currentTime)}
                onLoadedMetadata={e => setDuration(e.target.duration)}
                onPlay={() => setPlaying(true)}
                onPause={() => setPlaying(false)}
                onEnded={() => setPlaying(false)}
              />
              <div className="custom-player">
                <button className="play-pause-btn" onClick={togglePlay}>
                  {playing ? <Pause size={14} /> : <Play size={14} />}
                </button>
                <span className="player-time">{formatTime(currentTime)}</span>
                <div
                  className="custom-progress"
                  ref={progressRef}
                  onMouseMove={onProgressMouseMove}
                  onMouseLeave={() => setHoverTime(null)}
                  onClick={onProgressClick}
                >
                  <div
                    className="custom-progress-fill"
                    style={{ width: duration ? `${(currentTime / duration) * 100}%` : '0%' }}
                  />
                  {hoverTime != null && (
                    <div className="progress-tooltip" style={{ left: hoverX }}>
                      {formatTime(hoverTime)}
                    </div>
                  )}
                </div>
                <span className="player-time player-duration">{formatTime(duration)}</span>
              </div>
              <div className="player-controls">
                <div className="seek-controls">
                  {[-10, -5, -1].map(d => (
                    <button key={d} className="seek-btn" onClick={() => seek(d)}>{d}s</button>
                  ))}
                </div>
                <select
                  className="speed-select"
                  value={speed}
                  onChange={e => setPlaybackSpeed(Number(e.target.value))}
                >
                  {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map(s => (
                    <option key={s} value={s}>{s}×</option>
                  ))}
                </select>
                <div className="seek-controls">
                  {[1, 5, 10].map(d => (
                    <button key={d} className="seek-btn" onClick={() => seek(d)}>+{d}s</button>
                  ))}
                </div>
              </div>
              {dirty && <div className="unsaved-hint">You have unsaved edits</div>}
            </div>

            <div className="subtitle-panel" ref={subtitleRef}>
              {subtitles.length === 0 && (
                <div className="no-subs">
                  This file has no subtitle lines yet.
                  <button className="sub-insert-trigger" onClick={e => startInsert(-1, e)}><Plus size={12} /> Add line</button>
                </div>
              )}

              {insertingAfterIdx === -1 && <InsertForm insertTime={insertTime} setInsertTime={setInsertTime} insertText={insertText} setInsertText={setInsertText} commitInsert={commitInsert} cancel={() => setInsertingAfterIdx(null)} insertTimeRef={insertTimeRef} />}

              {subtitles.map((line, i) => (
                <div key={i}>
                  <div
                    data-idx={i}
                    className={`sub-line ${i === activeIdx ? 'active' : ''} ${editingIdx === i ? 'editing' : ''}`}
                    onClick={() => {
                      if (editingIdx !== i && insertingAfterIdx === null) {
                        clearTimeout(clickTimerRef.current)
                        clickTimerRef.current = setTimeout(() => {
                          if (audioRef.current) {
                            audioRef.current.currentTime = srtToMs(line.startRaw) / 1000
                            audioRef.current.play()
                          }
                        }, 220)
                      }
                    }}
                  >
                    <span className="sub-time">{line.time}</span>
                    {editingIdx === i ? (
                      <textarea
                        className="sub-edit"
                        value={editText}
                        autoFocus
                        onChange={e => setEditText(e.target.value)}
                        onBlur={() => commitEdit(i)}
                        onKeyDown={e => {
                          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitEdit(i) }
                          if (e.key === 'Escape') setEditingIdx(-1)
                        }}
                        onClick={e => e.stopPropagation()}
                      />
                    ) : (
                      <span
                        className="sub-text"
                        title="Double-click to edit"
                        onDoubleClick={(e) => { e.stopPropagation(); clearTimeout(clickTimerRef.current); startEdit(i, line.text) }}
                      >
                        {line.text}
                      </span>
                    )}
                    <button className="sub-edit-btn" title="Edit" onClick={e => { e.stopPropagation(); startEdit(i, line.text) }}><Pencil size={12} /></button>
                  </div>

                  {insertingAfterIdx === i ? (
                    <InsertForm insertTime={insertTime} setInsertTime={setInsertTime} insertText={insertText} setInsertText={setInsertText} commitInsert={commitInsert} cancel={() => setInsertingAfterIdx(null)} insertTimeRef={insertTimeRef} />
                  ) : (
                    <div className="sub-insert-row">
                      <button className="sub-insert-trigger" onClick={e => startInsert(i, e)}><Plus size={11} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
