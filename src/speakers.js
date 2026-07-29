// Stable per-speaker accent colors + label, shared by the Transcribe and Catalog
// screens so a given speaker looks the same everywhere. Speaker numbers are
// 1-based; the palette cycles for recordings with many speakers.
const SPEAKER_COLORS = [
  '#4f8cff', // blue
  '#ff6b6b', // red
  '#2fbf71', // green
  '#c084fc', // purple
  '#ff9f43', // orange
  '#22d3ee', // cyan
  '#f472b6', // pink
  '#a3b18a', // olive
]

export function speakerColor(n) {
  if (!n) return null
  return SPEAKER_COLORS[(n - 1) % SPEAKER_COLORS.length]
}

// Display label for a speaker. Falls back to "Speaker N" unless a custom name
// has been set for that number in the optional names map ({ 1: 'Alice', … }).
export function speakerLabel(n, names) {
  if (!n) return ''
  const custom = names && names[n]
  return custom && String(custom).trim() ? custom : `Speaker ${n}`
}
