import { useState, useEffect, useMemo, useRef } from 'react'
import { FolderOpen, Trash2, Save, Pencil, Play, Pause, Plus, Users, Loader2 } from 'lucide-react'
import { speakerColor, speakerLabel } from '../speakers.js'
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

// Milliseconds since start → SRT "HH:MM:SS,mmm".
function msToSrtRaw(ms) {
  const clamped = Math.max(0, Math.round(ms))
  const t = Math.floor(clamped / 1000)
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(clamped % 1000).padStart(3,'0')}`
}

// Local-state insert form. Keeping the draft here (not in Catalog) means typing
// doesn't re-render the whole subtitle list on every keystroke.
function InsertForm({ defaultTime, onAdd, onCancel }) {
  const [time, setTime] = useState(defaultTime || '')
  const [text, setText] = useState('')
  const timeRef = useRef(null)
  useEffect(() => { timeRef.current?.focus() }, [])
  return (
    <div className="sub-insert-form" onClick={e => e.stopPropagation()}>
      <input
        ref={timeRef}
        className="insert-time-input"
        placeholder="m:ss"
        value={time}
        onChange={e => setTime(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') onCancel() }}
      />
      <textarea
        className="insert-text-input"
        placeholder="Type the missing text..."
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onAdd(time, text) }
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="insert-actions">
        <button className="btn-primary insert-save-btn" onClick={() => onAdd(time, text)}>Add</button>
        <button className="btn-secondary insert-cancel-btn" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}

// Inline editor for a line: adjustable start/end timestamps, text, and delete.
// Holds its own draft state so keystrokes don't re-render the full list.
function LineEditor({ line, onSave, onDelete, onCancel, speakerIds = [], speakerNames = {} }) {
  const [start, setStart] = useState(srtToDisplay(line.startRaw))
  const [end, setEnd] = useState(srtToDisplay(line.endRaw))
  const [text, setText] = useState(line.text)
  const [speaker, setSpeaker] = useState(line.speaker || 0) // 0 = no speaker
  const textRef = useRef(null)
  useEffect(() => {
    const el = textRef.current
    if (el) { el.focus(); el.setSelectionRange(el.value.length, el.value.length) }
  }, [])
  const save = () => onSave({ start, end, text, speaker })
  const onTimeKey = e => {
    if (e.key === 'Enter') { e.preventDefault(); save() }
    if (e.key === 'Escape') onCancel()
  }
  return (
    <div className="sub-edit-form" onClick={e => e.stopPropagation()}>
      <div className="sub-edit-timerow">
        <input className="edit-time-input" value={start} onChange={e => setStart(e.target.value)} onKeyDown={onTimeKey} title="Start time" />
        <span className="edit-time-sep">→</span>
        <input className="edit-time-input" value={end} onChange={e => setEnd(e.target.value)} onKeyDown={onTimeKey} title="End time" />
        {speakerIds.length > 0 && (
          <select
            className="edit-speaker-select"
            value={speaker}
            onChange={e => setSpeaker(Number(e.target.value))}
            title="Speaker"
          >
            <option value={0}>No speaker</option>
            {/* Include the line's current speaker even if it's not in the detected set. */}
            {(speakerIds.includes(speaker) || !speaker ? speakerIds : [speaker, ...speakerIds]).map(id => (
              <option key={id} value={id}>{speakerLabel(id, speakerNames)}</option>
            ))}
          </select>
        )}
        <button className="edit-delete-btn" title="Delete this line" onClick={onDelete}><Trash2 size={12} /> Delete</button>
      </div>
      <textarea
        ref={textRef}
        className="sub-edit"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); save() }
          if (e.key === 'Escape') onCancel()
        }}
      />
      <div className="sub-edit-actions">
        <button className="btn-primary insert-save-btn" onClick={save}>Save</button>
        <button className="insert-cancel-btn" onClick={onCancel}>Cancel</button>
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
  const [insertingAfterIdx, setInsertingAfterIdx] = useState(null)
  const [insertDefaultTime, setInsertDefaultTime] = useState('')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  const [hoverTime, setHoverTime] = useState(null)
  const [hoverX, setHoverX] = useState(0)
  const [redetectOpen, setRedetectOpen] = useState(false)
  const [redetectSpeakers, setRedetectSpeakers] = useState(0) // 0 = auto
  const [redetecting, setRedetecting] = useState(false)
  const [redetectProgress, setRedetectProgress] = useState(0)
  const [redetectError, setRedetectError] = useState(null)
  const [speakerNames, setSpeakerNames] = useState({}) // { [number]: name }
  const [autoSave, setAutoSave] = useState(() => {
    try { return localStorage.getItem('catalogAutoSave') === '1' } catch { return false }
  })
  const audioRef = useRef(null)
  const subtitleRef = useRef(null)
  const seekTimerRef = useRef(null)
  const progressRef = useRef(null)
  const clickTimerRef = useRef(null)
  const resumeAfterEditRef = useRef(false)

  useEffect(() => {
    window.api.catalog.load().then(setItems)
  }, [])

  // Live progress for a re-detect run, keyed to the selected entry.
  useEffect(() => {
    window.api.catalog.onDiarizeProgress(({ id, progress }) => {
      if (selected && id === selected.id) setRedetectProgress(progress)
    })
    return () => window.api.catalog.removeDiarizeListeners()
  }, [selected])

  // Reset the re-detect panel whenever a different file is opened.
  useEffect(() => {
    setRedetectOpen(false)
    setRedetecting(false)
    setRedetectError(null)
  }, [selected])

  const runRedetect = async () => {
    if (!selected || redetecting) return
    setRedetecting(true)
    setRedetectError(null)
    setRedetectProgress(0)
    const res = await window.api.catalog.redetectSpeakers(selected.id, { speakers: redetectSpeakers, threshold: 0.7 })
    setRedetecting(false)
    if (res?.ok) {
      setSubtitles(res.lines)
      setDirty(false)
      window.api.catalog.load().then(setItems)
      setRedetectOpen(false)
    } else {
      setRedetectError(res?.error || 'Speaker detection failed')
    }
  }

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
    setSpeakerNames(selected.speakerNames || {})
    window.api.file.readSrt(selected.srtPath).then(subs => {
      if (cancelled) return
      setSubtitles(subs)
      setEditingIdx(-1)
      setInsertingAfterIdx(null)
      setDirty(false)
    })
    return () => { cancelled = true }
  }, [selected])

  // Distinct speakers actually present in the transcript, ascending.
  const speakerIds = useMemo(
    () => [...new Set(subtitles.map(s => s.speaker).filter(Boolean))].sort((a, b) => a - b),
    [subtitles]
  )

  // Rename a speaker: update the label everywhere live, and persist to the
  // catalog (blank clears back to the default "Speaker N").
  const renameSpeaker = (id, name) => {
    const next = { ...speakerNames, [id]: name }
    if (!name.trim()) delete next[id]
    setSpeakerNames(next)
  }
  const persistSpeakerNames = () => {
    if (!selected) return
    window.api.catalog.setSpeakerNames(selected.id, speakerNames)
      .then(() => window.api.catalog.load().then(setItems))
  }

  // Keep the active subtitle scrolled into view, but not while editing/inserting.
  useEffect(() => {
    if (activeIdx < 0 || editingIdx !== -1 || insertingAfterIdx !== null) return
    const el = subtitleRef.current?.querySelector(`[data-idx="${activeIdx}"]`)
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }, [activeIdx])

  // Remember the auto-save preference across sessions.
  useEffect(() => {
    try { localStorage.setItem('catalogAutoSave', autoSave ? '1' : '0') } catch { /* ignore */ }
  }, [autoSave])

  // With auto-save on, persist edits a moment after they stop. Re-runs on each
  // change to subtitles, so the timer debounces rapid successive edits.
  useEffect(() => {
    if (!autoSave || !dirty || !selected || saving) return
    const t = setTimeout(() => { save() }, 1000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSave, dirty, subtitles, selected, saving])

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

  const startEdit = (i) => {
    setInsertingAfterIdx(null)
    setEditingIdx(i)
    // Pause playback while editing so the audio doesn't run past the line being
    // fixed; it resumes automatically once the edit is committed or cancelled.
    const audio = audioRef.current
    if (audio && !audio.paused) {
      resumeAfterEditRef.current = true
      audio.pause()
    }
  }

  // Leave edit mode, resuming playback if we auto-paused when the edit began.
  const endEditing = () => {
    setEditingIdx(-1)
    if (resumeAfterEditRef.current) {
      resumeAfterEditRef.current = false
      // play() rejects if a pause() interrupts it — harmless, so swallow it.
      audioRef.current?.play().catch(() => {})
    }
  }

  const saveEdit = (i, { start, end, text, speaker }) => {
    // Blank lines inside a subtitle would split its block in the saved SRT
    const clean = text.split('\n').map(s => s.trim()).filter(Boolean).join('\n')
    const startRaw = parseUserTime(start)
    let endRaw = parseUserTime(end)
    // Keep end after start so the cue and all downstream timing stay valid.
    if (srtToMs(endRaw) <= srtToMs(startRaw)) endRaw = msToSrtRaw(srtToMs(startRaw) + 2000)
    const finalText = clean || subtitles[i].text
    const finalSpeaker = speaker || undefined // 0/none -> no speaker
    // Re-sort in case the start time moved the line relative to its neighbours.
    const updated = subtitles
      .map((s, idx) => idx === i ? { ...s, text: finalText, startRaw, endRaw, time: srtToDisplay(startRaw), speaker: finalSpeaker } : s)
      .sort((a, b) => srtToMs(a.startRaw) - srtToMs(b.startRaw))
    setSubtitles(updated)
    setDirty(true)
    endEditing()
  }

  const deleteLine = (i) => {
    setSubtitles(subtitles.filter((_, idx) => idx !== i))
    setDirty(true)
    endEditing()
  }

  const startInsert = (afterIdx, e) => {
    e.stopPropagation()
    setEditingIdx(-1)
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
    setInsertDefaultTime(defaultTime)
    setInsertingAfterIdx(afterIdx)
  }

  const commitInsert = (time, text) => {
    const clean = text.split('\n').map(s => s.trim()).filter(Boolean).join('\n')
    const timeStr = (time || '').trim()
    if (!clean || !timeStr) { setInsertingAfterIdx(null); return }
    const startRaw = parseUserTime(timeStr)
    const endRaw = msToSrtRaw(srtToMs(startRaw) + 2000)
    const newLine = { time: srtToDisplay(startRaw), startRaw, endRaw, text: clean }
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
      seekTimerRef.current = setTimeout(() => { seekTimerRef.current = null; audio.play().catch(() => {}) }, 250)
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
    if (audio.paused) { audio.play().catch(() => {}) } else { audio.pause() }
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
                {!autoSave && dirty && (
                  <button className="btn-primary save-btn" onClick={save} disabled={saving}>
                    {saving ? 'Saving...' : <><Save size={13} /> Save edits</>}
                  </button>
                )}
                {autoSave && (dirty || saving) && (
                  <span className="autosave-status">{saving ? 'Saving…' : 'Saving soon…'}</span>
                )}
                <label className="autosave-toggle" title="Automatically save edits after you make them">
                  <input type="checkbox" checked={autoSave} onChange={e => setAutoSave(e.target.checked)} />
                  <span>Auto-save</span>
                </label>
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
              {!autoSave && dirty && <div className="unsaved-hint">You have unsaved edits</div>}
              {autoSave && !dirty && !saving && <div className="unsaved-hint saved-hint">All changes saved</div>}

              <div className="redetect">
                {!redetectOpen ? (
                  <button className="redetect-toggle" onClick={() => setRedetectOpen(true)}>
                    <Users size={13} /> Detect speakers
                  </button>
                ) : (
                  <div className="redetect-panel">
                    <div className="redetect-row">
                      <span className="redetect-label"><Users size={13} /> Speakers</span>
                      <div className="stepper">
                        <button
                          type="button"
                          className="stepper-btn"
                          onClick={() => setRedetectSpeakers(c => (c <= 2 ? 0 : c - 1))}
                          disabled={redetecting || redetectSpeakers === 0}
                          aria-label="Fewer speakers"
                        >−</button>
                        <input
                          className="stepper-value"
                          type="text"
                          inputMode="numeric"
                          value={redetectSpeakers === 0 ? 'Auto' : String(redetectSpeakers)}
                          onChange={e => {
                            const digits = e.target.value.replace(/\D/g, '')
                            if (!digits) return setRedetectSpeakers(0)
                            const n = Math.min(20, parseInt(digits))
                            setRedetectSpeakers(n < 2 ? 0 : n)
                          }}
                          disabled={redetecting}
                        />
                        <button
                          type="button"
                          className="stepper-btn"
                          onClick={() => setRedetectSpeakers(c => (c === 0 ? 2 : Math.min(20, c + 1)))}
                          disabled={redetecting || redetectSpeakers >= 20}
                          aria-label="More speakers"
                        >+</button>
                      </div>
                      {redetecting ? (
                        <span className="redetect-progress"><Loader2 size={12} className="spin" /> {redetectProgress}%</span>
                      ) : (
                        <>
                          <button className="btn-primary redetect-run" onClick={runRedetect}>Run</button>
                          <button className="redetect-cancel" onClick={() => setRedetectOpen(false)}>Cancel</button>
                        </>
                      )}
                    </div>
                    <p className="redetect-help">
                      Re-labels every line by who’s speaking — no need to transcribe again.
                      Leave “Speakers” on Auto, or set the exact count for better accuracy.
                      This overwrites the current speaker labels and saves the file.
                    </p>
                    {redetectError && <div className="redetect-error">{redetectError}</div>}
                  </div>
                )}
              </div>
            </div>

            {speakerIds.length > 0 && (
              <div className="speaker-legend">
                <span className="speaker-legend-title"><Users size={12} /> Speakers</span>
                {speakerIds.map(id => (
                  <div className="speaker-legend-item" key={id}>
                    <span className="speaker-swatch" style={{ background: speakerColor(id) }} />
                    <input
                      className="speaker-name-input"
                      value={speakerNames[id] || ''}
                      placeholder={`Speaker ${id}`}
                      onChange={e => renameSpeaker(id, e.target.value)}
                      onBlur={persistSpeakerNames}
                      onKeyDown={e => { if (e.key === 'Enter') e.target.blur() }}
                    />
                  </div>
                ))}
              </div>
            )}

            <div className="subtitle-panel" ref={subtitleRef}>
              {subtitles.length === 0 && (
                <div className="no-subs">
                  This file has no subtitle lines yet.
                  <button className="sub-insert-trigger" onClick={e => startInsert(-1, e)}><Plus size={12} /> Add line</button>
                </div>
              )}

              {insertingAfterIdx === -1 && <InsertForm defaultTime={insertDefaultTime} onAdd={commitInsert} onCancel={() => setInsertingAfterIdx(null)} />}

              {subtitles.map((line, i) => (
                <div key={i}>
                  {editingIdx === i ? (
                    <LineEditor
                      line={line}
                      onSave={vals => saveEdit(i, vals)}
                      onDelete={() => deleteLine(i)}
                      onCancel={endEditing}
                      speakerIds={speakerIds}
                      speakerNames={speakerNames}
                    />
                  ) : (
                    <div
                      data-idx={i}
                      className={`sub-line ${i === activeIdx ? 'active' : ''}`}
                      onClick={() => {
                        if (insertingAfterIdx === null) {
                          clearTimeout(clickTimerRef.current)
                          clickTimerRef.current = setTimeout(() => {
                            if (audioRef.current) {
                              audioRef.current.currentTime = srtToMs(line.startRaw) / 1000
                              audioRef.current.play().catch(() => {})
                            }
                          }, 220)
                        }
                      }}
                    >
                      <span className="sub-time">{line.time}</span>
                      {line.speaker && (
                        <span className="speaker-chip" style={{ '--speaker-color': speakerColor(line.speaker) }}>
                          {speakerLabel(line.speaker, speakerNames)}
                        </span>
                      )}
                      <span
                        className="sub-text"
                        title="Double-click to edit"
                        onDoubleClick={(e) => { e.stopPropagation(); clearTimeout(clickTimerRef.current); startEdit(i) }}
                      >
                        {line.text}
                      </span>
                      <button className="sub-edit-btn" title="Edit" onClick={e => { e.stopPropagation(); startEdit(i) }}><Pencil size={12} /></button>
                    </div>
                  )}

                  {insertingAfterIdx === i ? (
                    <InsertForm defaultTime={insertDefaultTime} onAdd={commitInsert} onCancel={() => setInsertingAfterIdx(null)} />
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
