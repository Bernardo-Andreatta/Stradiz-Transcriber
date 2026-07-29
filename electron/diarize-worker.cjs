// Speaker-diarization worker (runs as a child Node process, isolated from the
// UI). Pipeline: sherpa-onnx segmentation -> a speaker embedding per segment ->
// ward/AHC clustering. This REPLACES sherpa's built-in greedy clustering, which
// separates similar voices far better (measured ~2.6x cleaner on real audio).
//
// Invoked as: node diarize-worker.cjs '<json-job>'
//   job = { wavPath, segModel, embedModel, numSpeakers, threshold,
//           minDurationOn, minDurationOff, numThreads }
// Emits { segments: [{ start, end, speaker }] } (JSON) on stdout; progress lines
// "PROGRESS <pct>" and diagnostics on stderr. On any failure it prints an empty
// segment list and exits 0 so the caller simply keeps the plain transcript.
const fs = require('fs')

function log(m) { process.stderr.write(`[diarize-worker] ${m}\n`) }
let _lastPct = -1
function progress(p) {
  const v = Math.round(p)
  if (v === _lastPct) return // only emit on integer-percent change
  _lastPct = v
  process.stderr.write(`PROGRESS ${v}\n`)
}
function emit(segments) { process.stdout.write(JSON.stringify({ segments })); process.exit(0) }

// Read a 16 kHz mono s16le wav into Float32 [-1,1], locating the data chunk.
function readWav(p) {
  const b = fs.readFileSync(p)
  let off = 12
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4)
    const size = b.readUInt32LE(off + 4)
    if (id === 'data') {
      off += 8
      const n = Math.min(Math.floor(size / 2), (b.length - off) >> 1)
      const f = new Float32Array(n)
      for (let i = 0; i < n; i++) f[i] = b.readInt16LE(off + i * 2) / 32768
      return f
    }
    off += 8 + size + (size & 1)
  }
  const n = (b.length - 44) >> 1
  const f = new Float32Array(n)
  for (let i = 0; i < n; i++) f[i] = b.readInt16LE(44 + i * 2) / 32768
  return f
}

function normalize(e) { let s = 0; for (const x of e) s += x * x; const nn = Math.sqrt(s) || 1; return e.map(x => x / nn) }

// Full ward/AHC linkage over L2-normalized vectors. Runs all the way down to one
// cluster, recording — for every cluster count K down to 1 — the labelling at K
// and the cost of the merge that produced it (distByK[K]). This lets us both cut
// at a fixed K and estimate K from where the merge cost jumps. Standard
// agglomerative clustering, as used across speaker-diarization systems.
function wardLinkage(vecs) {
  const norm = vecs.map(normalize)
  let cl = norm.map((c, i) => ({ c: c.slice(), n: 1, ids: [i] }))
  const sq = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += (a[i] - b[i]) ** 2; return s }
  const wd = (x, y) => (x.n * y.n / (x.n + y.n)) * sq(x.c, y.c)
  const labByK = {}, distByK = {}
  const snap = () => { const lab = new Array(vecs.length); cl.forEach((c, ci) => c.ids.forEach(id => lab[id] = ci)); return lab }
  labByK[cl.length] = snap()
  while (cl.length > 1) {
    let bi = 0, bj = 1, bd = Infinity
    for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) { const d = wd(cl[i], cl[j]); if (d < bd) { bd = d; bi = i; bj = j } }
    const a = cl[bi], b = cl[bj], n = a.n + b.n
    const c = a.c.map((x, t) => (x * a.n + b.c[t] * b.n) / n)
    cl.splice(bj, 1); cl.splice(bi, 1); cl.push({ c, n, ids: [...a.ids, ...b.ids] })
    labByK[cl.length] = snap(); distByK[cl.length] = bd
  }
  return { labByK, distByK }
}

function wardCluster(vecs, k) { return wardLinkage(vecs).labByK[Math.min(k, vecs.length)] }

// Mean cosine silhouette of a labelling over already-normalized vectors.
function silhouette(norm, lab) {
  const dot = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
  const N = norm.length
  let tot = 0
  for (let i = 0; i < N; i++) {
    const groups = {}
    for (let j = 0; j < N; j++) { if (i === j) continue; (groups[lab[j]] = groups[lab[j]] || []).push(1 - dot(norm[i], norm[j])) }
    let a = 0, b = Infinity
    for (const g in groups) { const m = groups[g].reduce((s, x) => s + x, 0) / groups[g].length; if (+g === lab[i]) a = m; else b = Math.min(b, m) }
    if (b !== Infinity) tot += (b - a) / Math.max(a, b)
  }
  return tot / N
}

// Estimate the number of speakers when the user didn't specify, via the
// dendrogram gap: the K where the cost of the *next* merge jumps most sharply
// (merging two distinct speakers is far costlier than merging within one). More
// robust than silhouette-argmax, which over-counts clean audio and under-counts
// similar voices. A weak overall separation falls back to a single speaker.
function estimateK(embs, maxK) {
  const norm = embs.map(normalize)
  const { labByK, distByK } = wardLinkage(embs)
  let bestK = 2, bestGap = -Infinity
  for (let k = 2; k <= maxK; k++) {
    // distByK[k-1] = cost to go from k clusters to k-1; distByK[k] = the last
    // within-k merge. A big ratio means k clusters were genuinely distinct.
    const gap = (distByK[k - 1] || 0) / ((distByK[k] || 1e-9) + 1e-9)
    log(`  auto-K probe k=${k}: mergeCost=${(distByK[k] || 0).toFixed(4)} gap=${gap.toFixed(2)}`)
    if (gap > bestGap) { bestGap = gap; bestK = k }
  }
  // Single-speaker guard: if the chosen split isn't actually cohesive, it's one.
  const sil = silhouette(norm, labByK[bestK])
  if (sil < 0.10) { log(`  chosen split silhouette=${sil.toFixed(3)} < 0.10 -> 1 speaker`); return { k: 1, lab: new Array(embs.length).fill(0) } }
  return { k: bestK, lab: labByK[bestK] }
}

;(async () => {
  try {
    const job = JSON.parse(process.argv[2] || '{}')
    const {
      wavPath, segModel, embedModel,
      numSpeakers = 0, threshold = 0.7,
      minDurationOn = 0.5, minDurationOff = 1.0, numThreads = 4,
    } = job

    const sherpa = require('sherpa-onnx-node')
    const addon = require('sherpa-onnx-node/addon.js')
    const sr = 16000
    const samples = readWav(wavPath)
    log(`audio ${(samples.length / sr).toFixed(1)}s`)
    progress(2)

    // Segmentation pass (its clustering config just makes it emit speaker-
    // homogeneous segments; we discard the labels and re-cluster below). Use the
    // async variant so its per-chunk callback can drive real progress (this step
    // is the slow one). Segmentation maps to 2..65%.
    const diar = new sherpa.OfflineSpeakerDiarization({
      segmentation: { pyannote: { model: segModel }, numThreads },
      embedding: { model: embedModel, numThreads },
      clustering: numSpeakers > 0 ? { numClusters: numSpeakers } : { threshold },
      minDurationOn, minDurationOff,
    })
    let raw
    try {
      raw = await addon.offlineSpeakerDiarizationProcessAsync(diar.handle, samples, (done, total) => {
        if (total > 0) progress(2 + Math.min(63, (done / total) * 63))
        return 0
      })
    } catch (e) {
      log(`async process failed (${e && e.message}); falling back to sync`)
      raw = diar.process(samples)
    }
    if (!Array.isArray(raw)) raw = diar.process(samples)
    log(`segmentation: ${raw.length} segments`)
    progress(66)
    if (!raw.length) return emit([])

    // Embed EVERY segment with its own voice. Clean (>=1s) segments define the
    // speaker clusters/centroids; then every segment — including short
    // interjections — is assigned to the nearest centroid by its OWN embedding,
    // so a brief phrase from another speaker isn't just given its neighbour's
    // label. Embedding maps to 66..90%.
    const CLEAN_MIN = 1.0
    const norm = normalize
    const cos = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i] * b[i]; return s }
    const ex = new sherpa.SpeakerEmbeddingExtractor({ model: embedModel, numThreads })
    const total = raw.length
    const embAll = raw.map((s, i) => {
      if (i % 10 === 0) progress(66 + (i / total) * 24)
      // .slice() (a copy), not .subarray() (a view): Electron's V8 sandbox rejects
      // external/offset TypedArray views passed to the native addon.
      const seg = samples.slice(Math.floor(s.start * sr), Math.floor(s.end * sr))
      const st = ex.createStream(); st.acceptWaveform({ sampleRate: sr, samples: seg }); st.inputFinished()
      // compute(stream, enableExternalBuffer=false): return a normal V8 buffer —
      // Electron's V8 sandbox rejects the default external buffer.
      return Array.from(ex.compute(st, false))
    })
    progress(92)

    const cleanIdx = raw.map((_, i) => i).filter(i => raw[i].end - raw[i].start >= CLEAN_MIN)
    const cleanEmbs = cleanIdx.map(i => embAll[i])
    const out = raw.map(s => ({ start: s.start, end: s.end, speaker: 0 }))

    if (cleanEmbs.length >= 2) {
      // Cluster the clean segments (fixed K, or auto-estimated from embeddings —
      // never sherpa's greedy count, which wildly over-detects).
      let cleanLabels, K
      if (numSpeakers > 0) {
        K = Math.min(numSpeakers, cleanEmbs.length)
        cleanLabels = wardCluster(cleanEmbs, K)
        log(`clustered into K=${K} (fixed)`)
      } else {
        const est = estimateK(cleanEmbs, Math.min(8, cleanEmbs.length - 1))
        cleanLabels = est.lab; K = est.k
        log(`auto-detected ${K} speaker(s)`)
      }
      // Centroid per speaker = mean of its clean, normalized embeddings.
      const dim = embAll[0].length
      const cent = Array.from({ length: K }, () => new Array(dim).fill(0))
      const cnt = new Array(K).fill(0)
      const cleanLabelOf = new Map()
      cleanIdx.forEach((ci, li) => {
        const g = cleanLabels[li], v = norm(embAll[ci])
        for (let d = 0; d < dim; d++) cent[g][d] += v[d]
        cnt[g]++
        cleanLabelOf.set(ci, g)
      })
      const centN = cent.map((c, g) => norm(c.map(x => x / (cnt[g] || 1))))
      // Clean segments keep their cluster label (stable — this is what defines
      // the speakers). Only short segments are placed by nearest centroid, judged
      // on their own voice, so a brief interjection isn't given a neighbour's id.
      for (let i = 0; i < raw.length; i++) {
        if (cleanLabelOf.has(i)) { out[i].speaker = cleanLabelOf.get(i); continue }
        const v = norm(embAll[i])
        let best = 0, bs = -Infinity
        for (let g = 0; g < K; g++) { const s = cos(v, centN[g]); if (s > bs) { bs = s; best = g } }
        out[i].speaker = best
      }
    } else {
      raw.forEach((s, i) => { out[i].speaker = s.speaker }) // too little to re-cluster
    }
    progress(100)
    emit(out)
  } catch (e) {
    log(`error: ${e && e.message}`)
    emit([]) // best-effort: caller keeps the plain transcript
  }
})()
