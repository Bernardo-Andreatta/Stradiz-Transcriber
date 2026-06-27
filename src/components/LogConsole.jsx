import { useRef, useEffect, useState } from 'react'
import { Terminal, Copy, Trash2, Check } from 'lucide-react'
import './LogConsole.css'

// Classify a raw log line into a severity so the console can color it. The
// engine emits free-form text from ffmpeg/whisper plus our own status strings,
// so we match on meaning rather than a strict format.
function classify(line) {
  const l = line.toLowerCase()
  if (/error|fail|not found|crash|incomplete|could not|stalled|invalid/.test(l)) return 'error'
  if (/retry|warn|skip|hallucinat/.test(l)) return 'warn'
  if (/done|complete|ready|exit code 0\b/.test(l)) return 'ok'
  return 'info'
}

// A real, reusable activity console: severity-colored lines, a live count,
// copy-to-clipboard and clear actions, and auto-scroll that pauses the moment
// the reader scrolls up to inspect history.
export default function LogConsole({ logs, title = 'Activity', onClear, emptyHint = 'Nothing logged yet.' }) {
  const bodyRef = useRef(null)
  const pinnedToBottom = useRef(true)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (pinnedToBottom.current && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight
    }
  }, [logs])

  const handleScroll = () => {
    const el = bodyRef.current
    if (!el) return
    // Re-pin only when the reader returns to the bottom edge.
    pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logs.join('\n'))
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // Clipboard can be unavailable (denied permission / no focus); ignore.
    }
  }

  return (
    <div className="logc">
      <div className="logc-head">
        <span className="logc-title"><Terminal size={12} /> {title}</span>
        <span className="logc-count">{logs.length} {logs.length === 1 ? 'line' : 'lines'}</span>
        <div className="logc-actions">
          <button className="logc-btn" onClick={copy} title="Copy log" disabled={!logs.length}>
            {copied ? <Check size={12} /> : <Copy size={12} />}
          </button>
          {onClear && (
            <button className="logc-btn" onClick={onClear} title="Clear log" disabled={!logs.length}>
              <Trash2 size={12} />
            </button>
          )}
        </div>
      </div>
      <div className="logc-body" ref={bodyRef} onScroll={handleScroll}>
        {logs.length === 0
          ? <div className="logc-empty">{emptyHint}</div>
          : logs.map((line, i) => (
              <div key={i} className={`logc-line ${classify(line)}`}>{line}</div>
            ))}
      </div>
    </div>
  )
}
