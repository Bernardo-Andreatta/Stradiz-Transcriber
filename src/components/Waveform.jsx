import './Waveform.css'

// The app's signature: sound becoming text. Rendered as a row of bars that sit
// still as a brand mark and pulse as a live "listening" indicator while the
// engine is working. Pure CSS, inherits the current text color, and falls back
// to a static shape when the user prefers reduced motion.
export default function Waveform({ active = false, bars = 5, className = '' }) {
  return (
    <span className={`wave ${active ? 'wave-active' : ''} ${className}`.trim()} aria-hidden="true">
      {Array.from({ length: bars }).map((_, i) => (
        <span key={i} className="wave-bar" style={{ '--i': i }} />
      ))}
    </span>
  )
}
