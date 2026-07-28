const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron')

// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true } }
])
const path = require('path')
const fs = require('fs')
const https = require('https')
const http = require('http')
const { spawn, spawnSync, execSync } = require('child_process')
const os = require('os')

// ---- Platform abstraction -------------------------------------------------
// The app downloads prebuilt whisper-cli + ffmpeg binaries on first run. Their
// names, download URLs, GPU backend, and how the archive is extracted all differ
// per OS, so every part of the code that touches the binary layer goes through
// the constants and helpers below instead of hard-coding Windows paths.
const PLATFORM = process.platform               // 'win32' | 'darwin' | 'linux'
const ARCH = process.arch                        // 'x64' | 'arm64'
const IS_WIN = PLATFORM === 'win32'
const IS_MAC = PLATFORM === 'darwin'
const IS_LINUX = PLATFORM === 'linux'
const EXE = IS_WIN ? '.exe' : ''                 // executable suffix

const RELEASE_BASE = 'https://github.com/Bernardo-Andreatta/Stradiz-Transcriber/releases/download/v1.0.0'

// Whisper engine build per platform. Windows ships a Vulkan GPU build; macOS a
// universal Metal build (Apple Silicon + Intel); Linux a CPU build (broadest
// compatibility — no GPU driver assumptions). All self-hosted on our release.
const WHISPER_BUILD = IS_MAC
  ? { url: `${RELEASE_BASE}/whisper-metal-bin-universal.zip`, name: 'whisper-metal-bin-universal.zip', hasGpu: true }
  : IS_LINUX
  ? { url: `${RELEASE_BASE}/whisper-linux-bin-x64.zip`,       name: 'whisper-linux-bin-x64.zip',       hasGpu: false }
  : { url: `${RELEASE_BASE}/whisper-vulkan-bin-x64.zip`,      name: 'whisper-vulkan-bin-x64.zip',      hasGpu: true }

// sherpa-onnx offline speaker-diarization engine per platform. All three are the
// official k2-fsa prebuilt "shared" bundles: a `bin/` with the diarization CLI
// plus the shared libs (onnxruntime, sherpa C-API) it links against. Pinned to a
// known-good release. These are .tar.bz2, not .zip (see extractArchive).
const SHERPA_VERSION = 'v1.12.14'
const SHERPA_RELEASE = `https://github.com/k2-fsa/sherpa-onnx/releases/download/${SHERPA_VERSION}`
const SHERPA_BUILD = IS_MAC
  ? { url: `${SHERPA_RELEASE}/sherpa-onnx-${SHERPA_VERSION}-osx-universal2-shared.tar.bz2`, name: `sherpa-onnx-${SHERPA_VERSION}-osx-universal2-shared.tar.bz2` }
  : IS_LINUX
  ? { url: `${SHERPA_RELEASE}/sherpa-onnx-${SHERPA_VERSION}-linux-x64-shared.tar.bz2`,      name: `sherpa-onnx-${SHERPA_VERSION}-linux-x64-shared.tar.bz2` }
  : { url: `${SHERPA_RELEASE}/sherpa-onnx-${SHERPA_VERSION}-win-x64-shared.tar.bz2`,        name: `sherpa-onnx-${SHERPA_VERSION}-win-x64-shared.tar.bz2` }

// Diarization models (platform-independent). Segmentation is a .tar.bz2 that
// extracts to a folder holding model.onnx + model.int8.onnx; embedding is a bare
// .onnx. The embedding model is zh+en trained but generalises across languages.
const SEG_MODEL_BUILD = {
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
  name: 'sherpa-onnx-pyannote-segmentation-3-0.tar.bz2',
}
const EMBED_MODEL_BUILD = {
  url: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
  name: '3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
}

// ffmpeg static build per platform. Windows pulls the well-known BtbN nightly;
// macOS and Linux pull the martin-riedl.de static builds (a single self-contained
// binary). All third-party static builds.
const FFMPEG_BUILD = IS_MAC
  ? { url: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${ARCH === 'arm64' ? 'arm64' : 'amd64'}/release/ffmpeg.zip`, name: `ffmpeg-mac-${ARCH}.zip` }
  : IS_LINUX
  ? { url: 'https://ffmpeg.martin-riedl.de/redirect/latest/linux/amd64/release/ffmpeg.zip', name: 'ffmpeg-linux-x64.zip' }
  : { url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip', name: 'ffmpeg-win64-gpl.zip' }

const isDev = !app.isPackaged
const APP_DATA = path.join(os.homedir(), '.whisper-app')
const WHISPER_DIR = path.join(APP_DATA, 'whisper.cpp')
const MODELS_DIR = path.join(APP_DATA, 'models')
const FFMPEG_DIR = path.join(APP_DATA, 'ffmpeg')
const SHERPA_DIR = path.join(APP_DATA, 'sherpa')
const DB_FILE = path.join(APP_DATA, 'catalog.json')

function ensureDirs() {
  [APP_DATA, MODELS_DIR, FFMPEG_DIR].forEach(d => fs.mkdirSync(d, { recursive: true }))
}

function loadCatalog() {
  if (!fs.existsSync(DB_FILE)) return []
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')) } catch { return [] }
}

function saveCatalog(items) {
  fs.writeFileSync(DB_FILE, JSON.stringify(items, null, 2))
}

function findExeInDir(dir, name) {
  if (!fs.existsSync(dir)) return null
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) { const found = findExeInDir(full, name); if (found) return found }
      else if (entry.name.toLowerCase() === name.toLowerCase()) return full
    }
  } catch {}
  return null
}

const WHISPER_GPU_FLAG = path.join(APP_DATA, 'whisper_gpu.txt')

function getWhisperCli() {
  return findExeInDir(WHISPER_DIR, 'whisper-cli' + EXE) || path.join(WHISPER_DIR, 'whisper-cli' + EXE)
}

// chmod downloaded binaries +x on Unix — zip archives don't always preserve the
// executable bit, and macOS won't spawn a file that isn't marked executable.
function ensureExecutable(p) {
  if (!IS_WIN && p) { try { fs.chmodSync(p, 0o755) } catch {} }
}

function getWhisperHasGpu() {
  try { return fs.readFileSync(WHISPER_GPU_FLAG, 'utf8').trim() === '1' } catch { return false }
}

function getFFmpeg() {
  // Windows static build nests the binary under bin/; the macOS build ships it
  // at the archive root. Check the Windows path first, then fall back to a
  // recursive search that covers both layouts.
  if (IS_WIN) {
    const winFfmpeg = path.join(FFMPEG_DIR, 'bin', 'ffmpeg.exe')
    if (fs.existsSync(winFfmpeg)) return winFfmpeg
  }
  return findExeInDir(FFMPEG_DIR, 'ffmpeg' + EXE)
}

function getModel() {
  return path.join(MODELS_DIR, 'ggml-large-v3-turbo.bin')
}

function getVadModel() {
  return path.join(MODELS_DIR, 'ggml-silero-v5.1.2.bin')
}

// ---- Speaker diarization (sherpa-onnx) ------------------------------------
// The diarization CLI is unpacked somewhere under SHERPA_DIR/bin; find it
// recursively (layout differs slightly per platform bundle).
function getDiarizeCli() {
  return findExeInDir(SHERPA_DIR, 'sherpa-onnx-offline-speaker-diarization' + EXE)
}

// The exe links against shared libs shipped in a sibling of bin/ (usually lib/).
// Return that dir so we can put it on the loader path when spawning.
function getSherpaLibDir() {
  const cli = getDiarizeCli()
  if (!cli) return null
  const binDir = path.dirname(cli)
  const libDir = path.join(path.dirname(binDir), 'lib')
  // Windows bundles keep the DLLs next to the exe; Unix bundles use ../lib.
  return fs.existsSync(libDir) ? libDir : binDir
}

function getSegModel() {
  return path.join(MODELS_DIR, 'sherpa-onnx-pyannote-segmentation-3-0', 'model.int8.onnx')
}

function getEmbedModel() {
  return path.join(MODELS_DIR, EMBED_MODEL_BUILD.name)
}

// ---- Component versioning -------------------------------------------------
// Setup downloads each component only if it's missing OR out of date. Bump a
// component's string here whenever you host a newer build/asset; on the next
// setup the app re-downloads just that component and leaves the rest alone.
const CURRENT_VERSIONS = {
  whisper: IS_MAC ? 'metal-1.7.6' : IS_LINUX ? 'linux-cpu-1.7.6' : 'vulkan-1',
  ffmpeg: '1',
  model: 'large-v3-turbo',
  vad: 'silero-v5.1.2',
  sherpa: SHERPA_VERSION,
  segModel: 'pyannote-segmentation-3-0',
  embedModel: 'campplus-zh-en-common-advanced',
}
const INSTALLED_FILE = path.join(APP_DATA, 'installed.json')

function readInstalled() {
  try { return JSON.parse(fs.readFileSync(INSTALLED_FILE, 'utf8')) } catch { return {} }
}
function writeInstalled(patch) {
  const next = { ...readInstalled(), ...patch }
  try { fs.writeFileSync(INSTALLED_FILE, JSON.stringify(next, null, 2)) } catch {}
}
function isCurrent(component) {
  return readInstalled()[component] === CURRENT_VERSIONS[component]
}

// Installs from before versioning existed have no installed.json. If every
// component file is already present, treat them as current so upgrading the app
// doesn't force a needless ~1.6 GB re-download — only real version bumps do.
function backfillVersionsIfNeeded() {
  if (fs.existsSync(INSTALLED_FILE)) return
  const haveCore = fs.existsSync(getWhisperCli()) && !!getFFmpeg() &&
    fs.existsSync(getModel()) && fs.existsSync(getVadModel())
  if (!haveCore) return
  // Mark each component current only if its files are actually present, so a
  // pre-diarization install isn't falsely tagged as already having sherpa/models
  // (which would skip downloading them). The core four are present by the guard
  // above; the diarization pieces are opt-in and may be missing.
  const patch = {
    whisper: CURRENT_VERSIONS.whisper,
    ffmpeg: CURRENT_VERSIONS.ffmpeg,
    model: CURRENT_VERSIONS.model,
    vad: CURRENT_VERSIONS.vad,
  }
  if (getDiarizeCli()) patch.sherpa = CURRENT_VERSIONS.sherpa
  if (fs.existsSync(getSegModel())) patch.segModel = CURRENT_VERSIONS.segModel
  if (fs.existsSync(getEmbedModel())) patch.embedModel = CURRENT_VERSIONS.embedModel
  writeInstalled(patch)
}

function detectGPU() {
  // Every Mac runs the Metal backend, so report the GPU type without probing.
  if (IS_MAC) return 'apple'
  // Linux ships the CPU build — don't claim a GPU.
  if (IS_LINUX) return 'cpu'
  try {
    const out = execSync('powershell -Command "Get-WmiObject Win32_VideoController | Select-Object -ExpandProperty Name"', { timeout: 8000 }).toString()
    if (/nvidia/i.test(out)) return 'nvidia'
    if (/amd|radeon/i.test(out)) return 'amd'
  } catch {}
  return 'cpu'
}

// HEAD a URL to confirm an asset is reachable before committing to a download.
function headOk(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD', headers: { 'User-Agent': 'whisper-app/1.0' } }, res => {
      res.resume()
      if ([200, 301, 302, 307, 308].includes(res.statusCode)) resolve()
      else reject(new Error(`HTTP ${res.statusCode}`))
    })
    req.on('error', reject)
    req.setTimeout(15000, () => req.destroy(new Error('HEAD request timed out')))
    req.end()
  })
}

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const proto = url.startsWith('https') ? https : http
    proto.get(url, { headers: { 'User-Agent': 'whisper-app/1.0', 'Accept': 'application/vnd.github.v3+json' } }, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return resolve(fetchJson(res.headers.location))
      let data = ''
      res.on('data', chunk => data += chunk)
      res.on('end', () => { try { resolve(JSON.parse(data)) } catch (e) { reject(e) } })
      res.on('error', reject)
    }).on('error', reject)
  })
}

// Robust downloader: follows redirects, checks HTTP status, enforces an idle
// timeout, waits for the file to be fully flushed to disk, and verifies the
// downloaded size matches Content-Length. Cleans up the partial file on failure.
function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const MAX_REDIRECTS = 10
    const IDLE_TIMEOUT_MS = 60000
    let redirects = 0
    let settled = false

    const finish = (err) => {
      if (settled) return
      settled = true
      if (err) { try { fs.unlinkSync(dest) } catch {} ; reject(err) }
      else resolve()
    }

    const request = (u) => {
      let proto
      try { proto = (new URL(u).protocol === 'http:') ? http : https }
      catch (e) { return finish(new Error(`Invalid URL: ${u}`)) }

      const req = proto.get(u, { headers: { 'User-Agent': 'whisper-app/1.0' } }, res => {
        // Follow redirects (all the common kinds)
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume() // drain so the socket can be reused
          if (++redirects > MAX_REDIRECTS) return finish(new Error('Too many redirects'))
          const loc = res.headers.location
          if (!loc) return finish(new Error(`Redirect ${res.statusCode} with no Location header`))
          return request(new URL(loc, u).toString())
        }
        if (res.statusCode !== 200) {
          res.resume()
          return finish(new Error(`HTTP ${res.statusCode} while downloading`))
        }

        const total = parseInt(res.headers['content-length'] || '0')
        let received = 0
        const file = fs.createWriteStream(dest)
        file.on('error', finish)

        res.on('data', chunk => {
          received += chunk.length
          if (total > 0) onProgress(Math.round((received / total) * 100), received, total)
        })
        res.on('error', finish)
        res.pipe(file)

        // 'finish' fires only after every byte is flushed to disk
        file.on('finish', () => {
          file.close(() => {
            if (total > 0 && received !== total) {
              return finish(new Error(`Incomplete download: got ${received} of ${total} bytes`))
            }
            finish(null)
          })
        })
      })

      req.on('error', finish)
      // Abort if the connection stalls (no data for IDLE_TIMEOUT_MS)
      req.setTimeout(IDLE_TIMEOUT_MS, () => {
        req.destroy(new Error(`Download stalled (no data for ${IDLE_TIMEOUT_MS / 1000}s)`))
      })
    }

    request(url)
  })
}

// Extract a .zip or .tar.bz2. Uses bsdtar (built into Win10+ and macOS, handles
// both formats incl. bzip2), then falls back to PowerShell Expand-Archive on
// Windows for zips. On macOS it also clears the quarantine flag so Gatekeeper
// doesn't block the freshly downloaded binaries from running.
function extractArchive(zipPath, destDir) {
  // Sanity check the magic bytes: zips start with "PK", bzip2 archives with
  // "BZh". Catches truncated/HTML downloads with a clear message instead of a
  // cryptic extractor error.
  try {
    const fd = fs.openSync(zipPath, 'r')
    const sig = Buffer.alloc(3)
    fs.readSync(fd, sig, 0, 3, 0)
    fs.closeSync(fd)
    const isZip = sig[0] === 0x50 && sig[1] === 0x4b            // PK
    const isBz2 = sig[0] === 0x42 && sig[1] === 0x5a && sig[2] === 0x68  // BZh
    if (!isZip && !isBz2) {
      throw new Error('downloaded file is not a valid archive (corrupt or incomplete)')
    }
  } catch (e) {
    if (/not a valid archive/.test(e.message)) throw e
    // openSync/readSync failure — fall through and let the extractor try
  }

  // macOS: drop the quarantine attribute on the extracted tree so spawning the
  // unsigned binaries doesn't trigger a Gatekeeper "cannot be opened" block.
  const clearQuarantine = () => {
    if (IS_MAC) { try { execSync(`xattr -dr com.apple.quarantine "${destDir}"`) } catch {} }
  }

  const escPs = (p) => p.replace(/'/g, "''")
  try {
    execSync(`tar -xf "${zipPath}" -C "${destDir}"`, { stdio: ['ignore', 'ignore', 'pipe'] })
    clearQuarantine()
    return
  } catch (tarErr) {
    if (IS_WIN) {
      try {
        execSync(
          `powershell.exe -NoProfile -NonInteractive -Command "$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath '${escPs(zipPath)}' -DestinationPath '${escPs(destDir)}' -Force"`,
          { stdio: ['ignore', 'ignore', 'pipe'], timeout: 600000 }
        )
        return
      } catch (psErr) {
        const tarMsg = (tarErr.stderr || tarErr.message || '').toString().split('\n')[0].trim()
        const psMsg = (psErr.stderr || psErr.message || '').toString().split('\n')[0].trim()
        throw new Error(`extraction failed — tar: ${tarMsg || 'failed'}; Expand-Archive: ${psMsg || 'failed'}`)
      }
    }
    const tarMsg = (tarErr.stderr || tarErr.message || '').toString().split('\n')[0].trim()
    throw new Error(`extraction failed — tar: ${tarMsg || 'failed'}`)
  }
}

// Run an async step with up to `max` attempts, reporting progress via send().
async function withRetry(label, send, fn, max = 3) {
  let lastErr
  for (let attempt = 1; attempt <= max; attempt++) {
    try {
      if (attempt > 1) send('setup:status', `Retrying ${label} (attempt ${attempt}/${max})...`)
      await fn(attempt)
      return true
    } catch (e) {
      lastErr = e
      send('setup:status', `${label} attempt ${attempt}/${max} failed: ${e.message}`)
    }
  }
  send('setup:status', `Failed to set up ${label} after ${max} attempts: ${lastErr ? lastErr.message : 'unknown error'}`)
  return false
}

async function setupWhisper(win) {
  const send = (event, data) => win.webContents.send(event, data)
  ensureDirs()

  const gpu = detectGPU()
  send('setup:gpu', gpu)

  // Treat a complete pre-versioning install as up to date so we don't re-download it.
  backfillVersionsIfNeeded()

  // Each component is (re)installed only if its file is missing or its recorded
  // version is older than what this build expects.
  const whisperCli = getWhisperCli()
  const ffmpeg = getFFmpeg()
  const model = getModel()

  const vadModel = getVadModel()
  const needsWhisper = !fs.existsSync(whisperCli) || !isCurrent('whisper')
  const needsFfmpeg = !ffmpeg || !isCurrent('ffmpeg')
  const needsModel = !fs.existsSync(model) || !isCurrent('model')
  const needsVad = !fs.existsSync(vadModel) || !isCurrent('vad')
  const needsSherpa = !getDiarizeCli() || !isCurrent('sherpa')
  const needsSeg = !fs.existsSync(getSegModel()) || !isCurrent('segModel')
  const needsEmbed = !fs.existsSync(getEmbedModel()) || !isCurrent('embedModel')

  if (!needsWhisper && !needsFfmpeg && !needsModel && !needsVad && !needsSherpa && !needsSeg && !needsEmbed) {
    send('setup:done', {
      whisperCli, ffmpeg: getFFmpeg(), model, vadModel, gpu,
      diarizeCli: getDiarizeCli(), segModel: getSegModel(), embedModel: getEmbedModel(),
    })
    return
  }

  // Download whisper-cli if needed
  if (needsWhisper) {
    // Resolve which build to download once (URL resolution isn't retried, the
    // download/extract is). Prefer our platform build; on Windows fall back to
    // the upstream CPU build if our release asset is unreachable.
    let downloadUrl = WHISPER_BUILD.url
    let assetName = WHISPER_BUILD.name
    let hasGpu = WHISPER_BUILD.hasGpu

    send('setup:status', `Checking Whisper ${IS_MAC ? 'Metal' : 'Vulkan'} build availability...`)
    let available = false
    try { await headOk(downloadUrl); available = true } catch {}

    if (!available && IS_WIN) {
      try {
        send('setup:status', 'Fetching latest Whisper release info...')
        const release = await fetchJson('https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest')
        const assets = release.assets || []
        const asset =
          assets.find(a => a.name === 'whisper-bin-x64.zip') ||
          assets.find(a => /x64/i.test(a.name) && a.name.endsWith('.zip') && !/cuda|cublas|blas/i.test(a.name))
        if (asset) { downloadUrl = asset.browser_download_url; assetName = asset.name; hasGpu = false; available = true }
      } catch {}
    }

    if (!available) {
      send('setup:status', `Could not reach the download server for the Whisper ${IS_MAC ? 'macOS' : 'Windows'} build. Check your connection and retry setup.`)
    } else {
      const zipPath = path.join(APP_DATA, 'whisper.zip')
      await withRetry('Whisper', send, async (attempt) => {
        if (attempt === 1) send('setup:status', `Downloading Whisper (${assetName})...`)
        // Start each attempt from a clean slate
        try { if (fs.existsSync(zipPath)) fs.unlinkSync(zipPath) } catch {}
        if (fs.existsSync(WHISPER_DIR)) fs.rmSync(WHISPER_DIR, { recursive: true, force: true })
        fs.mkdirSync(WHISPER_DIR, { recursive: true })

        await downloadFile(downloadUrl, zipPath,
          (pct, rcv, total) => send('setup:progress', { task: 'whisper', pct, rcv, total })
        )
        send('setup:status', 'Extracting Whisper...')
        extractArchive(zipPath, WHISPER_DIR)
        try { fs.unlinkSync(zipPath) } catch {}
        const cliPath = findExeInDir(WHISPER_DIR, 'whisper-cli' + EXE)
        if (!cliPath) {
          throw new Error(`whisper-cli${EXE} not found after extraction`)
        }
        ensureExecutable(cliPath)
        fs.writeFileSync(WHISPER_GPU_FLAG, hasGpu ? '1' : '0')
        writeInstalled({ whisper: CURRENT_VERSIONS.whisper })
      })
    }
  }

  // Download ffmpeg if needed
  if (needsFfmpeg) {
    const ffmpegZip = path.join(APP_DATA, 'ffmpeg.zip')
    await withRetry('ffmpeg', send, async (attempt) => {
      if (attempt === 1) send('setup:status', 'Downloading ffmpeg...')
      // Start each attempt from a clean slate
      try { if (fs.existsSync(ffmpegZip)) fs.unlinkSync(ffmpegZip) } catch {}
      if (fs.existsSync(FFMPEG_DIR)) fs.rmSync(FFMPEG_DIR, { recursive: true, force: true })
      fs.mkdirSync(FFMPEG_DIR, { recursive: true })

      await downloadFile(
        FFMPEG_BUILD.url,
        ffmpegZip,
        (pct, rcv, total) => send('setup:progress', { task: 'ffmpeg', pct, rcv, total })
      )
      send('setup:status', 'Extracting ffmpeg...')
      extractArchive(ffmpegZip, FFMPEG_DIR)
      // The Windows build nests everything in a versioned folder (ffmpeg-N.N-...);
      // flatten it so bin/ffmpeg.exe sits directly under FFMPEG_DIR. The macOS
      // build ships the binary at the root, so only flatten real subfolders.
      const inner = fs.readdirSync(FFMPEG_DIR).find(f =>
        f.startsWith('ffmpeg') && fs.statSync(path.join(FFMPEG_DIR, f)).isDirectory()
      )
      if (inner) {
        const innerPath = path.join(FFMPEG_DIR, inner)
        fs.cpSync(innerPath, FFMPEG_DIR, { recursive: true })
        fs.rmSync(innerPath, { recursive: true, force: true })
      }
      try { fs.unlinkSync(ffmpegZip) } catch {}
      const ffmpegPath = getFFmpeg()
      if (!ffmpegPath) throw new Error(`ffmpeg${EXE} not found after extraction`)
      ensureExecutable(ffmpegPath)
      writeInstalled({ ffmpeg: CURRENT_VERSIONS.ffmpeg })
    })
  }

  // Download model if needed (downloadFile verifies the full size via Content-Length)
  if (needsModel) {
    const modelPath = path.join(MODELS_DIR, 'ggml-large-v3-turbo.bin')
    await withRetry('model', send, async (attempt) => {
      if (attempt === 1) send('setup:status', 'Downloading Whisper large-v3-turbo model (1.5 GB)...')
      try { if (fs.existsSync(modelPath)) fs.unlinkSync(modelPath) } catch {}
      await downloadFile(
        'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
        modelPath,
        (pct, rcv, total) => send('setup:progress', { task: 'model', pct, rcv, total })
      )
      writeInstalled({ model: CURRENT_VERSIONS.model })
    })
  }

  // Download VAD model if needed
  if (needsVad) {
    const vadPath = path.join(MODELS_DIR, 'ggml-silero-v5.1.2.bin')
    await withRetry('VAD model', send, async (attempt) => {
      if (attempt === 1) send('setup:status', 'Downloading VAD model (silence detection)...')
      try { if (fs.existsSync(vadPath)) fs.unlinkSync(vadPath) } catch {}
      await downloadFile(
        'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',
        vadPath,
        (pct, rcv, total) => send('setup:progress', { task: 'vad', pct, rcv, total })
      )
      writeInstalled({ vad: CURRENT_VERSIONS.vad })
    })
  }

  // Download the sherpa-onnx diarization engine if needed
  if (needsSherpa) {
    const sherpaZip = path.join(APP_DATA, 'sherpa.tar.bz2')
    await withRetry('speaker engine', send, async (attempt) => {
      if (attempt === 1) send('setup:status', 'Downloading speaker-detection engine...')
      try { if (fs.existsSync(sherpaZip)) fs.unlinkSync(sherpaZip) } catch {}
      if (fs.existsSync(SHERPA_DIR)) fs.rmSync(SHERPA_DIR, { recursive: true, force: true })
      fs.mkdirSync(SHERPA_DIR, { recursive: true })

      await downloadFile(SHERPA_BUILD.url, sherpaZip,
        (pct, rcv, total) => send('setup:progress', { task: 'sherpa', pct, rcv, total })
      )
      send('setup:status', 'Extracting speaker-detection engine...')
      extractArchive(sherpaZip, SHERPA_DIR)
      try { fs.unlinkSync(sherpaZip) } catch {}
      const cliPath = getDiarizeCli()
      if (!cliPath) throw new Error(`sherpa-onnx-offline-speaker-diarization${EXE} not found after extraction`)
      ensureExecutable(cliPath)
      // The shared libs the CLI links against also need +x on Unix.
      const libDir = getSherpaLibDir()
      if (!IS_WIN && libDir && fs.existsSync(libDir)) {
        try { for (const f of fs.readdirSync(libDir)) ensureExecutable(path.join(libDir, f)) } catch {}
      }
      writeInstalled({ sherpa: CURRENT_VERSIONS.sherpa })
    })
  }

  // Download the pyannote segmentation model if needed
  if (needsSeg) {
    const segZip = path.join(APP_DATA, 'seg-model.tar.bz2')
    const segDir = path.join(MODELS_DIR, 'sherpa-onnx-pyannote-segmentation-3-0')
    await withRetry('segmentation model', send, async (attempt) => {
      if (attempt === 1) send('setup:status', 'Downloading speaker segmentation model...')
      try { if (fs.existsSync(segZip)) fs.unlinkSync(segZip) } catch {}
      if (fs.existsSync(segDir)) fs.rmSync(segDir, { recursive: true, force: true })
      await downloadFile(SEG_MODEL_BUILD.url, segZip,
        (pct, rcv, total) => send('setup:progress', { task: 'segModel', pct, rcv, total })
      )
      send('setup:status', 'Extracting segmentation model...')
      extractArchive(segZip, MODELS_DIR)
      try { fs.unlinkSync(segZip) } catch {}
      if (!fs.existsSync(getSegModel())) throw new Error('segmentation model not found after extraction')
      writeInstalled({ segModel: CURRENT_VERSIONS.segModel })
    })
  }

  // Download the speaker-embedding model if needed (bare .onnx, no extraction)
  if (needsEmbed) {
    const embedPath = getEmbedModel()
    await withRetry('speaker embedding model', send, async (attempt) => {
      if (attempt === 1) send('setup:status', 'Downloading speaker embedding model...')
      try { if (fs.existsSync(embedPath)) fs.unlinkSync(embedPath) } catch {}
      await downloadFile(EMBED_MODEL_BUILD.url, embedPath,
        (pct, rcv, total) => send('setup:progress', { task: 'embedModel', pct, rcv, total })
      )
      writeInstalled({ embedModel: CURRENT_VERSIONS.embedModel })
    })
  }

  const finalCli = getWhisperCli()
  const finalFfmpeg = getFFmpeg()
  const finalModel = getModel()
  const finalVad = getVadModel()
  const finalDiarize = getDiarizeCli()
  const finalSeg = getSegModel()
  const finalEmbed = getEmbedModel()
  const allReady = fs.existsSync(finalCli) && !!finalFfmpeg && fs.existsSync(finalModel) && fs.existsSync(finalVad) &&
    !!finalDiarize && fs.existsSync(finalSeg) && fs.existsSync(finalEmbed)
  if (!allReady) send('setup:status', 'Setup incomplete — one or more components failed to install. Click Setup again to retry.')
  send('setup:done', {
    whisperCli: finalCli, ffmpeg: finalFfmpeg, model: finalModel, vadModel: finalVad, gpu,
    whisperHasGpu: getWhisperHasGpu(), ready: allReady,
    diarizeCli: finalDiarize, segModel: finalSeg, embedModel: finalEmbed,
  })
}

let mainWindow
let currentConfig = {}
let currentProc = null
let stopRequested = false

// If whisper emits no output at all for this long, treat it as hung and kill it
// rather than waiting forever (some inputs wedge the decoder with no progress).
const WHISPER_STALL_MS = 180000

// Force-terminate a child process. On Windows a wedged process (and any children
// it spawned) won't reliably die from Node's signal-based kill, so use taskkill
// to take down the whole tree; elsewhere SIGKILL. Both ffmpeg and whisper ignore
// SIGTERM while busy, so Stop must always force.
function forceKill(proc) {
  if (!proc) return
  if (IS_WIN && proc.pid) {
    try { execSync(`taskkill /pid ${proc.pid} /T /F`, { stdio: 'ignore' }) } catch {}
  } else {
    try { proc.kill('SIGKILL') } catch {}
  }
}

function killCurrentProc() {
  const proc = currentProc
  currentProc = null
  forceKill(proc)
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
    titleBarStyle: 'default',
    title: 'Stradiz Transcriber',
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  protocol.handle('localfile', (request) => {
    const filePath = decodeURIComponent(request.url.slice('localfile://'.length))
    return net.fetch(`file:///${filePath}`)
  })
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })

// IPC Handlers
ipcMain.handle('setup:start', async () => {
  await setupWhisper(mainWindow)
})

// macOS DMG apps can't run an uninstall script, so this is the in-app way to
// reclaim the ~1.6 GB of downloaded data (also works on Windows). Removes the
// engine, ffmpeg, and model but keeps catalog.json so the user's transcription
// library survives — their .srt/.txt files live next to the source media anyway.
ipcMain.handle('setup:removeData', async () => {
  const { response } = await dialog.showMessageBox(mainWindow, {
    type: 'warning',
    buttons: ['Cancel', 'Remove'],
    defaultId: 1,
    cancelId: 0,
    title: 'Remove downloaded data',
    message: 'Remove downloaded data?',
    detail: 'Deletes the Whisper engine, FFmpeg, and the model (~1.6 GB) from ~/.whisper-app. Your transcription catalog is kept, and you can re-download anytime from Setup.',
  })
  if (response !== 1) return { ok: false, canceled: true }
  for (const target of [WHISPER_DIR, FFMPEG_DIR, MODELS_DIR, SHERPA_DIR, WHISPER_GPU_FLAG, INSTALLED_FILE]) {
    try { if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true }) } catch {}
  }
  return { ok: true }
})

ipcMain.handle('setup:check', async () => {
  backfillVersionsIfNeeded()
  const whisperCli = getWhisperCli()
  const ffmpeg = getFFmpeg()
  const model = getModel()
  const vadModel = getVadModel()
  const diarizeCli = getDiarizeCli()
  const segModel = getSegModel()
  const embedModel = getEmbedModel()
  const gpu = detectGPU()
  const filesExist = fs.existsSync(whisperCli) && !!ffmpeg && fs.existsSync(model) && fs.existsSync(vadModel) &&
    !!diarizeCli && fs.existsSync(segModel) && fs.existsSync(embedModel)
  const versionsCurrent = isCurrent('whisper') && isCurrent('ffmpeg') && isCurrent('model') && isCurrent('vad') &&
    isCurrent('sherpa') && isCurrent('segModel') && isCurrent('embedModel')
  return {
    // Ready only when everything is present AND current — an outdated component
    // routes the user back to Setup, which then re-downloads just that piece.
    ready: filesExist && versionsCurrent,
    updateAvailable: filesExist && !versionsCurrent,
    whisperCli,
    ffmpeg,
    model,
    vadModel,
    diarizeCli,
    segModel,
    embedModel,
    gpu,
    whisperHasGpu: getWhisperHasGpu(),
  }
})

ipcMain.handle('dialog:openFiles', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio/Video', extensions: ['mp3', 'mp4', 'wav', 'm4a', 'ogg', 'flac', 'mkv', 'mov', 'avi'] }]
  })
  return filePaths
})

ipcMain.handle('dialog:openFolder', async () => {
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
  })
  return filePaths[0] || null
})

ipcMain.handle('shell:openFolder', (event, folderPath) => {
  shell.openPath(folderPath)
})

function toSrtTime(t) {
  const [timePart, ms = '000'] = t.split('.')
  const segs = timePart.split(':')
  while (segs.length < 3) segs.unshift('00')
  return segs.join(':') + ',' + ms
}

function srtTimeToMs(t) {
  const [hms, ms = '0'] = t.split(',')
  const [h, m, s] = hms.split(':').map(Number)
  return (h * 3600 + m * 60 + s) * 1000 + parseInt(ms)
}

function msToSrtTime(ms) {
  const totalSecs = Math.floor(ms / 1000)
  const millis = ms % 1000
  const h = Math.floor(totalSecs / 3600)
  const m = Math.floor((totalSecs % 3600) / 60)
  const s = totalSecs % 60
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')},${String(millis).padStart(3,'0')}`
}

function msToDisplayTime(ms) {
  return msToSrtTime(ms).split(',')[0].replace(/^00:/, '')
}

// Whether the installed whisper-cli understands --vad (added in whisper.cpp
// 1.7.6). Probed once per app run — self-hosted builds may predate it.
let whisperVadSupport = null
function whisperSupportsVad(whisperCli) {
  if (whisperVadSupport !== null) return whisperVadSupport
  try {
    const out = spawnSync(whisperCli, ['--help'], { encoding: 'utf8', timeout: 10000 })
    whisperVadSupport = `${out.stdout || ''}${out.stderr || ''}`.includes('--vad')
  } catch {
    whisperVadSupport = false
  }
  return whisperVadSupport
}

// ---- Speaker diarization --------------------------------------------------
// The label written into the SRT/TXT for a line's speaker, e.g. "Speaker 1: ".
// Speaker indices are 1-based; index 0 or null means "no speaker" (no prefix).
function speakerPrefix(line) {
  return line && line.speaker ? `Speaker ${line.speaker}: ` : ''
}

// Run sherpa-onnx offline speaker diarization on a 16 kHz mono WAV and return
// [{ startMs, endMs, speaker }] segments (speaker = raw 0-based sherpa id).
// Best-effort: any failure resolves to [] so it can never break a transcription.
function runDiarization(wavPath, config, filePath, send) {
  return new Promise(resolve => {
    const cli = config.diarizeCli
    const seg = config.segModel
    const embed = config.embedModel
    if (!cli || !seg || !embed || !fs.existsSync(cli) || !fs.existsSync(seg) || !fs.existsSync(embed)) {
      send('transcribe:log', '[diarize] speaker-detection components missing — skipping (re-run Setup)')
      return resolve([])
    }

    // A fixed speaker count (>0) is far more accurate than auto-clustering when
    // the user knows it; otherwise fall back to threshold-based auto detection.
    // The CLI default (0.5) over-splits real-world audio into too many speakers;
    // a higher threshold yields fewer, more realistic clusters. The user can tune
    // it via the experimental sensitivity control (config.threshold); 0.7 default.
    const nSpeakers = parseInt(config.speakers) || 0
    const threshold = Number(config.threshold) > 0 ? Number(config.threshold) : 0.7
    const clusterArg = nSpeakers > 0
      ? `--clustering.num-clusters=${nSpeakers}`
      : `--clustering.cluster-threshold=${threshold}`
    const threads = Math.max(1, Math.min(8, os.cpus()?.length || 2))
    // min-duration-on drops sub-0.5s blips; min-duration-off merges same-speaker
    // segments split by gaps under 1s. Both cut the spurious short flip-flops that
    // plague similar-sounding voices — measured ~35% fewer speaker switches vs the
    // 0.3/0.5 CLI defaults, without noticeably merging genuine quick exchanges.
    const args = [
      `--segmentation.pyannote-model=${seg}`,
      `--embedding.model=${embed}`,
      clusterArg,
      '--min-duration-on=0.5',
      '--min-duration-off=1.0',
      // Thread count is per-model in this CLI — there is no top-level
      // --num-threads (passing one makes it exit with "Invalid option").
      `--segmentation.num-threads=${threads}`,
      `--embedding.num-threads=${threads}`,
      wavPath,
    ]

    // The CLI links shared libs shipped alongside it. Put that dir on the loader
    // path (and cwd there) so it resolves them at spawn time.
    const libDir = getSherpaLibDir()
    const env = { ...process.env }
    if (libDir) {
      if (IS_MAC) env.DYLD_LIBRARY_PATH = `${libDir}${path.delimiter}${env.DYLD_LIBRARY_PATH || ''}`
      else if (IS_LINUX) env.LD_LIBRARY_PATH = `${libDir}${path.delimiter}${env.LD_LIBRARY_PATH || ''}`
    }

    send('transcribe:log', `[diarize] spawn: ${path.basename(cli)} ${args.join(' ')}`)
    let proc
    try {
      proc = spawn(cli, args, { cwd: libDir || path.dirname(cli), env })
    } catch (e) {
      send('transcribe:log', `[diarize] failed to start: ${e.message}`)
      return resolve([])
    }
    currentProc = proc

    const segments = []
    let out = ''
    const parse = (text) => {
      out += text
      text.split('\n').filter(l => l.trim()).forEach(l => send('transcribe:log', `[diarize] ${l.trim()}`))
      // Drive the "Detecting speakers" loading bar off the CLI's own progress
      // ("progress 8.67%"). Take the last match in the chunk so bursts don't lag.
      const progMatches = [...text.matchAll(/progress\s*([\d.]+)\s*%/gi)]
      if (progMatches.length) {
        const pct = parseFloat(progMatches[progMatches.length - 1][1])
        if (!Number.isNaN(pct)) send('transcribe:diarizeProgress', { file: filePath, progress: Math.round(pct) })
      }
      const re = /([\d.]+)\s*--\s*([\d.]+)\s*speaker_(\d+)/g
      let m
      while ((m = re.exec(text)) !== null) {
        segments.push({
          startMs: Math.round(parseFloat(m[1]) * 1000),
          endMs: Math.round(parseFloat(m[2]) * 1000),
          speaker: parseInt(m[3]),
        })
      }
    }
    proc.stdout.on('data', d => parse(d.toString()))
    proc.stderr.on('data', d => parse(d.toString()))
    proc.on('error', e => { currentProc = null; send('transcribe:log', `[diarize] error: ${e.message}`); resolve([]) })
    proc.on('close', code => {
      currentProc = null
      send('transcribe:log', `[diarize] exit code ${code} — ${segments.length} segment(s)`)
      resolve(segments)
    })
  })
}

// Tag each whisper line with a 1-based speaker number by max temporal overlap
// with the diarized segments. Speaker ids are remapped to stable 1-based labels
// ordered by first appearance in the transcript. Mutates and returns `lines`.
function assignSpeakers(lines, segments) {
  if (!segments.length) return lines
  const remap = new Map()
  let next = 1
  for (const line of lines) {
    const startMs = srtTimeToMs(line.startRaw)
    const endMs = srtTimeToMs(line.endRaw)
    let best = null
    let bestOverlap = 0
    for (const s of segments) {
      const overlap = Math.min(endMs, s.endMs) - Math.max(startMs, s.startMs)
      if (overlap > bestOverlap) { bestOverlap = overlap; best = s }
    }
    if (best) {
      if (!remap.has(best.speaker)) remap.set(best.speaker, next++)
      line.speaker = remap.get(best.speaker)
    }
  }
  return lines
}

ipcMain.handle('transcribe:start', async (event, { files, config }) => {
  currentConfig = config
  stopRequested = false
  const send = (ch, data) => mainWindow.webContents.send(ch, data)
  const ffmpegExe = config.ffmpeg
  const whisperCli = config.whisperCli
  const model = config.model
  const results = []

  // Skip any of our own temp wav files the user may have accidentally selected
  const tempWavPattern = /_whisper\.wav$|_seg\d+\.wav$|_resume\.wav$/
  const filteredFiles = files.filter(f => !tempWavPattern.test(path.basename(f)))

  for (const filePath of filteredFiles) {
    if (stopRequested) break
    const base = path.basename(filePath, path.extname(filePath))
    const outDir = config.outputDir || path.dirname(filePath)
    fs.mkdirSync(outDir, { recursive: true })
    const wavPath = path.join(outDir, base + '_whisper.wav')

    // Clean up any leftover temp wav from a previous interrupted run
    if (fs.existsSync(wavPath)) try { fs.unlinkSync(wavPath) } catch {}
    const finalSrt = path.join(outDir, base + '.srt')
    const finalTxt = path.join(outDir, base + '.txt')

    // Convert to 16kHz wav once — kept for all recovery passes. The audio is
    // NEVER silence-stripped here: cutting samples out shortens the timeline
    // whisper timestamps against, so every removed gap would shift all later
    // subtitles earlier relative to the original file the catalog plays.
    // Silence skipping is done by whisper's built-in VAD instead (below),
    // which keeps timestamps on the original timeline.
    if (!ffmpegExe || !fs.existsSync(ffmpegExe)) {
      send('transcribe:file', { file: filePath, status: 'error', error: 'ffmpeg not found — please re-run Setup' })
      continue
    }
    send('transcribe:file', { file: filePath, status: 'converting' })
    send('transcribe:log', `[ffmpeg] Converting: ${path.basename(filePath)}`)
    const convertOk = await new Promise(resolve => {
      const ff = spawn(ffmpegExe, ['-i', filePath,
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath, '-y'])
      currentProc = ff
      ff.stderr.on('data', d => send('transcribe:log', `[ffmpeg] ${d.toString().trim()}`))
      ff.on('close', code => { currentProc = null; send('transcribe:log', `[ffmpeg] exit code ${code}`); resolve(code === 0) })
      ff.on('error', err => { currentProc = null; send('transcribe:log', `[ffmpeg] error: ${err.message}`); resolve(false) })
    })
    // Stop pressed during conversion: ffmpeg was killed, drop the partial wav and bail.
    if (stopRequested) {
      if (fs.existsSync(wavPath)) try { fs.unlinkSync(wavPath) } catch {}
      send('transcribe:file', { file: filePath, status: 'stopped' })
      break
    }
    if (!convertOk) {
      send('transcribe:file', { file: filePath, status: 'error', error: 'ffmpeg conversion failed' })
      continue
    }

    send('transcribe:file', { file: filePath, status: 'transcribing' })

    const allLines = []
    let offsetMs = 0
    let whisperExitCode = null
    let fileStalled = false
    const INITIAL_SKIP_MS = 20000
    let skipMs = INITIAL_SKIP_MS
    for (let skip = 0; !stopRequested; skip++) {
      // For recovery passes: extract a segment from the silence-removed wav starting at offsetMs
      let segWav = wavPath
      let tempSeg = null
      if (skip > 0) {
        tempSeg = path.join(outDir, base + `_seg${skip}.wav`)
        await new Promise(resolve => {
          const ff = spawn(ffmpegExe, [
            '-ss', (offsetMs / 1000).toString(), '-i', wavPath,
            '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', tempSeg, '-y'
          ])
          currentProc = ff
          ff.on('close', () => { currentProc = null; resolve() })
          ff.on('error', () => { currentProc = null; resolve() })
        })
        segWav = tempSeg
        // Stop pressed during segment extraction: abandon this pass.
        if (stopRequested) {
          if (tempSeg && fs.existsSync(tempSeg)) try { fs.unlinkSync(tempSeg) } catch {}
          break
        }
      }

      const runLines = []
      let hallucinationAtMs = null
      let passStalled = false
      whisperExitCode = null

      await new Promise(resolve => {
        // Vulkan build auto-detects GPU; only pass -ng to force CPU when no GPU build
        const gpuArgs = config.whisperHasGpu ? [] : ['-ng']
        // 'auto' lets whisper detect the spoken language per file; otherwise
        // force the user-picked code (pt, en, es…). Defaults to auto-detect.
        const lang = config.language || 'auto'
        // Silence skipping via whisper's silero VAD: skips non-speech chunks
        // for speed while reporting timestamps on the unmodified timeline.
        let vadArgs = []
        if (config.removeSilence && config.vadModel && fs.existsSync(config.vadModel)) {
          if (whisperSupportsVad(whisperCli)) {
            // --vad-threshold: how confidently audio must read as speech to be
            // kept. Higher = stricter (skips more, may drop quiet talkers); lower
            // = keeps faint speech (but more noise). User-tunable; 0.5 default.
            const vt = Number(config.vadThreshold) > 0 ? Number(config.vadThreshold) : 0.5
            vadArgs = ['--vad', '--vad-model', config.vadModel, '--vad-threshold', String(vt)]
          } else {
            send('transcribe:log', '[whisper] this engine build has no VAD support — transcribing with silence included')
          }
        }
        // Note: no --entropy-thold here — it only gates the temperature fallback,
        // which --no-fallback disables, so setting it would have no effect.
        const args = ['-m', model, '-l', lang, '-f', segWav,
          '--no-speech-thold', '0.3',
          '--no-fallback', '--print-progress', ...gpuArgs, ...vadArgs]
        send('transcribe:log', `[whisper] spawn (pass ${skip + 1}): whisper-cli ${args.join(' ')}`)
        const proc = spawn(whisperCli, args)
        currentProc = proc

        // Watchdog: whisper prints progress continuously, so a long gap with no
        // output at all means it's wedged on this input. Kill it and flag a stall.
        let lastActivity = Date.now()
        const watchdog = setInterval(() => {
          if (Date.now() - lastActivity > WHISPER_STALL_MS) {
            passStalled = true
            send('transcribe:log', `[whisper] no output for ${WHISPER_STALL_MS / 1000}s — engine appears stuck, terminating`)
            clearInterval(watchdog)
            forceKill(proc)
          }
        }, 10000)

        let rawOutput = ''
        const seen = new Set()
        const recentTexts = []
        let hallucinationDetected = false

        const processChunk = (text) => {
          lastActivity = Date.now()
          rawOutput += text
          text.split('\n').filter(l => l.trim()).forEach(l => send('transcribe:log', `[whisper] ${l.trim()}`))
          const lineRegex = /\[(\d+:\d+(?::\d+)?\.\d+) --> (\d+:\d+(?::\d+)?\.\d+)\]\s+(.+)/g
          let m
          while ((m = lineRegex.exec(text)) !== null) {
            const lineText = m[3].trim()
            if (!lineText) continue
            const key = `${m[1]}|${lineText}`
            if (seen.has(key)) continue
            seen.add(key)

            const absStartMs = srtTimeToMs(toSrtTime(m[1])) + offsetMs
            const absEndMs = srtTimeToMs(toSrtTime(m[2])) + offsetMs
            const line = {
              time: msToDisplayTime(absStartMs),
              startRaw: msToSrtTime(absStartMs),
              endRaw: msToSrtTime(absEndMs),
              text: lineText,
            }

            recentTexts.push(line.text)
            if (recentTexts.length > 6) recentTexts.shift()
            if (!hallucinationDetected && recentTexts.length >= 4 &&
              recentTexts.slice(-4).every(t => t === recentTexts[recentTexts.length - 1])) {
              hallucinationDetected = true
              hallucinationAtMs = absStartMs
              forceKill(proc)
              return
            }

            runLines.push(line)
            send('transcribe:line', { file: filePath, line })
          }
          const prog = text.match(/progress\s*=\s*(\d+)%/)
          if (prog) send('transcribe:progress', { file: filePath, progress: parseInt(prog[1]) })
        }

        proc.stdout.on('data', d => { process.stdout.write('[whisper stdout] ' + d.toString()); processChunk(d.toString()) })
        proc.stderr.on('data', d => { process.stdout.write('[whisper stderr] ' + d.toString()); processChunk(d.toString()) })
        proc.on('close', (code) => {
          clearInterval(watchdog)
          currentProc = null
          whisperExitCode = code
          send('transcribe:log', `[whisper] exit code ${code} — ${runLines.length} lines captured`)
          resolve()
        })
      })

      if (tempSeg && fs.existsSync(tempSeg)) try { fs.unlinkSync(tempSeg) } catch {}

      allLines.push(...runLines)

      // Write SRT after every pass so partial results are always saved
      if (allLines.length > 0) {
        const srt = allLines.map((l, i) => `${i + 1}\n${l.startRaw} --> ${l.endRaw}\n${l.text}`).join('\n\n')
        try { fs.writeFileSync(finalSrt, srt, 'utf8') } catch {}
        try { fs.writeFileSync(finalTxt, allLines.map(l => l.text).join('\n'), 'utf8') } catch {}
      }

      if (passStalled) { fileStalled = true; break }
      if (hallucinationAtMs === null || stopRequested) break

      // Adjust skip: if we hallucinated immediately (< 3 lines), the bad section is larger — double the skip
      skipMs = runLines.length < 3 ? Math.min(skipMs * 2, 120000) : INITIAL_SKIP_MS
      const nextOffsetMs = hallucinationAtMs + skipMs

      send('transcribe:hallucination', {
        file: filePath,
        at: msToDisplayTime(hallucinationAtMs),
        resumeAt: msToDisplayTime(nextOffsetMs),
        autoRecovery: true,
      })

      offsetMs = nextOffsetMs
    }

    // Speaker detection: on a clean completion, run diarization on the same
    // 16 kHz wav whisper used, tag each line with a speaker, then rewrite the
    // SRT/TXT with "Speaker N:" prefixes and push the relabelled lines to the UI.
    // Best-effort — a diarization failure leaves the plain transcript intact.
    if (config.detectSpeakers && !stopRequested && !fileStalled && allLines.length > 0) {
      send('transcribe:file', { file: filePath, status: 'diarizing' })
      send('transcribe:diarizeProgress', { file: filePath, progress: 0 })
      send('transcribe:log', '[diarize] detecting speakers...')
      const segments = await runDiarization(wavPath, config, filePath, send)
      if (!stopRequested && segments.length > 0) {
        assignSpeakers(allLines, segments)
        const srt = allLines.map((l, i) => `${i + 1}\n${l.startRaw} --> ${l.endRaw}\n${speakerPrefix(l)}${l.text}`).join('\n\n')
        try { fs.writeFileSync(finalSrt, srt, 'utf8') } catch {}
        try { fs.writeFileSync(finalTxt, allLines.map(l => `${speakerPrefix(l)}${l.text}`).join('\n'), 'utf8') } catch {}
        send('transcribe:relabel', { file: filePath, lines: allLines })
      }
    }

    if (fs.existsSync(wavPath)) try { fs.unlinkSync(wavPath) } catch {}

    // Stop pressed mid-transcription: keep whatever lines were captured (already
    // written to SRT/TXT each pass), register them, mark the file stopped, exit.
    if (stopRequested) {
      let entry
      if (allLines.length > 0) {
        entry = {
          id: Date.now() + Math.random(),
          name: path.basename(filePath),
          filePath,
          srtPath: fs.existsSync(finalSrt) ? finalSrt : null,
          txtPath: fs.existsSync(finalTxt) ? finalTxt : null,
          lines: allLines,
          date: new Date().toISOString(),
        }
        const catalog = loadCatalog()
        catalog.unshift(entry)
        saveCatalog(catalog)
        results.push(entry)
      }
      send('transcribe:file', { file: filePath, status: 'stopped', entry })
      break
    }

    // Engine stalled (no output for too long): save whatever was captured and
    // report it clearly instead of leaving the file stuck on "transcribing".
    if (fileStalled) {
      let entry
      if (allLines.length > 0) {
        entry = {
          id: Date.now() + Math.random(),
          name: path.basename(filePath),
          filePath,
          srtPath: fs.existsSync(finalSrt) ? finalSrt : null,
          txtPath: fs.existsSync(finalTxt) ? finalTxt : null,
          lines: allLines,
          date: new Date().toISOString(),
        }
        const catalog = loadCatalog()
        catalog.unshift(entry)
        saveCatalog(catalog)
        results.push(entry)
      }
      send('transcribe:file', {
        file: filePath,
        status: 'error',
        error: `Engine stalled — no output for ${WHISPER_STALL_MS / 1000}s.${allLines.length ? ' Partial result saved.' : ' Try again or use a shorter clip.'}`,
        entry,
      })
      continue
    }

    if (allLines.length === 0 && whisperExitCode !== 0) {
      send('transcribe:file', { file: filePath, status: 'error', error: `Whisper crashed (code ${whisperExitCode}) — check the terminal for details` })
      continue
    }

    const entry = {
      id: Date.now() + Math.random(),
      name: path.basename(filePath),
      filePath,
      srtPath: fs.existsSync(finalSrt) ? finalSrt : null,
      txtPath: fs.existsSync(finalTxt) ? finalTxt : null,
      lines: allLines,
      date: new Date().toISOString(),
    }
    results.push(entry)

    const catalog = loadCatalog()
    catalog.unshift(entry)
    saveCatalog(catalog)

    send('transcribe:file', { file: filePath, status: 'done', entry })
    send('transcribe:progress', { file: filePath, progress: 100 })
  }

  return results
})

ipcMain.handle('transcribe:stop', () => {
  stopRequested = true
  killCurrentProc()
})


ipcMain.handle('catalog:load', () => loadCatalog())

ipcMain.handle('catalog:delete', (event, id) => {
  const catalog = loadCatalog().filter(e => e.id !== id)
  saveCatalog(catalog)
  return catalog
})

ipcMain.handle('catalog:import', async () => {
  const audioResult = await dialog.showOpenDialog({
    title: 'Select audio / video file',
    filters: [{ name: 'Audio / Video', extensions: ['mp3','mp4','m4a','wav','ogg','mkv','webm','aac','flac','mov'] }],
    properties: ['openFile'],
  })
  if (audioResult.canceled || !audioResult.filePaths.length) return null

  const filePath = audioResult.filePaths[0]
  const baseName = path.basename(filePath, path.extname(filePath))
  const dir = path.dirname(filePath)
  const autoSrt = path.join(dir, baseName + '.srt')
  const autoTxt = path.join(dir, baseName + '.txt')

  let srtPath = fs.existsSync(autoSrt) ? autoSrt : null
  let txtPath = fs.existsSync(autoTxt) ? autoTxt : null

  if (!srtPath) {
    const srtResult = await dialog.showOpenDialog({
      title: 'Select SRT subtitle file (optional)',
      filters: [{ name: 'Subtitles', extensions: ['srt'] }],
      properties: ['openFile'],
    })
    if (!srtResult.canceled && srtResult.filePaths.length) {
      srtPath = srtResult.filePaths[0]
    }
  }

  const entry = {
    id: Date.now() + Math.random(),
    name: path.basename(filePath),
    filePath,
    srtPath,
    txtPath,
    lines: [],
    date: new Date().toISOString(),
  }

  const catalog = loadCatalog()
  catalog.unshift(entry)
  saveCatalog(catalog)
  return catalog
})

// Blank lines inside a subtitle's text would split its SRT block apart on the
// next read, silently dropping text and breaking cue timing — strip them.
function cleanSubText(t) {
  return (t || '').replace(/\r/g, '').split('\n').map(s => s.trim()).filter(Boolean).join('\n')
}

// Split a leading speaker label ("Speaker 2: …", or the raw "SPEAKER_01: …")
// off a cue's text so it round-trips as a structured field. Returns the 1-based
// speaker number (or null) and the text with the label removed.
function parseSpeakerLabel(text) {
  const m = (text || '').match(/^\s*(?:Speaker\s+(\d+)|SPEAKER_(\d+))\s*:\s*/i)
  if (!m) return { speaker: null, text: text || '' }
  return { speaker: parseInt(m[1] || m[2]), text: text.slice(m[0].length) }
}

// Write SRT + TXT from line objects, embedding any speaker as a "Speaker N:"
// prefix. Prefers the structured speaker field; strips a prefix already in the
// text either way so a label is never doubled. Shared by manual saves and the
// re-detect flow.
function writeSpeakerSrtTxt(srtPath, txtPath, lines) {
  const render = (line) => {
    const parsed = parseSpeakerLabel(line.text)
    const speaker = line.speaker || parsed.speaker
    const body = cleanSubText(parsed.text)
    return (speaker ? `Speaker ${speaker}: ` : '') + body
  }
  const srt = lines.map((line, i) => {
    const start = line.startRaw || '00:00:00,000'
    const end = line.endRaw || '00:00:01,000'
    return `${i + 1}\n${start} --> ${end}\n${render(line)}`
  }).join('\n\n')
  if (srtPath) fs.writeFileSync(srtPath, srt, 'utf8')

  const resolvedTxt = txtPath || (srtPath ? srtPath.replace(/\.srt$/i, '.txt') : null)
  const txt = lines.map(render).join('\n')
  if (resolvedTxt) fs.writeFileSync(resolvedTxt, txt, 'utf8')
}

// Parse an SRT file into line objects, pulling any "Speaker N:" prefix into a
// structured `speaker` field. Shared by file:readSrt and the re-detect flow.
function parseSrtFile(srtPath) {
  if (!srtPath || !fs.existsSync(srtPath)) return []
  const text = fs.readFileSync(srtPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  // Split only where a new cue actually starts (index line + timestamp line),
  // so stray blank lines inside a cue's text don't break the block apart.
  const blocks = text.trim().split(/\n\n+(?=\d+\s*\n\d{2}:\d{2}:\d{2})/)
  return blocks.map(block => {
    const lines = block.split('\n')
    const timeLine = lines[1] || ''
    const [startRaw, endRaw] = timeLine.split(' --> ')
    const displayTime = startRaw ? startRaw.trim().replace(',', '.').replace(/^00:/, '') : ''
    // Pull any "Speaker N:" prefix out of the cue text into a structured field.
    const { speaker, text: cueText } = parseSpeakerLabel(lines.slice(2).join('\n').trim())
    return {
      time: displayTime,
      startRaw: startRaw ? startRaw.trim() : '',
      endRaw: endRaw ? endRaw.trim() : '',
      speaker: speaker || undefined,
      text: cueText,
    }
  }).filter(b => b.text)
}

ipcMain.handle('file:saveSrt', (event, { srtPath, txtPath, lines }) => {
  writeSpeakerSrtTxt(srtPath, txtPath, lines)
})

ipcMain.handle('file:readSrt', (event, srtPath) => parseSrtFile(srtPath))

// Re-run speaker detection on an existing catalog entry without re-transcribing.
// Works even for entries transcribed with speaker detection off — it re-reads the
// existing SRT lines, diarizes the original audio, relabels the lines by overlap,
// and rewrites the SRT/TXT + catalog. { speakers, threshold } mirror the Transcribe
// controls (speakers 0 = auto).
ipcMain.handle('catalog:redetectSpeakers', async (event, { id, speakers, threshold }) => {
  const send = (ch, data) => mainWindow.webContents.send(ch, data)
  const catalog = loadCatalog()
  const entry = catalog.find(e => e.id === id)
  if (!entry) return { ok: false, error: 'Entry not found' }
  if (!entry.filePath || !fs.existsSync(entry.filePath)) return { ok: false, error: 'Original audio file not found' }
  if (currentProc) return { ok: false, error: 'Engine is busy — wait for the current job to finish' }

  const ffmpeg = getFFmpeg()
  const diarizeCli = getDiarizeCli()
  const segModel = getSegModel()
  const embedModel = getEmbedModel()
  if (!ffmpeg) return { ok: false, error: 'ffmpeg missing — run Setup' }
  if (!diarizeCli || !fs.existsSync(segModel) || !fs.existsSync(embedModel))
    return { ok: false, error: 'Speaker-detection components missing — run Setup' }

  // Lines to relabel: prefer the on-disk SRT (authoritative timings), else the
  // stored catalog lines.
  let lines = parseSrtFile(entry.srtPath)
  if (!lines.length) lines = (entry.lines || []).map(l => ({ ...l }))
  if (!lines.length) return { ok: false, error: 'No transcript lines to label' }

  // Convert the original audio to the 16 kHz mono wav sherpa needs.
  const tmpWav = path.join(os.tmpdir(), `redetect_${Date.now()}.wav`)
  const convOk = await new Promise(resolve => {
    const ff = spawn(ffmpeg, ['-i', entry.filePath, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', tmpWav, '-y'])
    currentProc = ff
    ff.on('close', code => { currentProc = null; resolve(code === 0) })
    ff.on('error', () => { currentProc = null; resolve(false) })
  })
  if (!convOk) {
    try { if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav) } catch {}
    return { ok: false, error: 'Audio conversion failed' }
  }

  send('catalog:diarizeProgress', { id, progress: 0 })
  // Route runDiarization's progress to the catalog channel, keyed by entry id.
  const diarSend = (ch, data) => {
    if (ch === 'transcribe:diarizeProgress') send('catalog:diarizeProgress', { id, progress: data.progress })
  }
  const segments = await runDiarization(tmpWav, { diarizeCli, segModel, embedModel, speakers, threshold }, entry.filePath, diarSend)
  try { if (fs.existsSync(tmpWav)) fs.unlinkSync(tmpWav) } catch {}

  if (!segments.length) return { ok: false, error: 'No speakers detected (or detection was cancelled)' }

  assignSpeakers(lines, segments)
  writeSpeakerSrtTxt(entry.srtPath, entry.txtPath, lines)
  entry.lines = lines
  saveCatalog(catalog)
  send('catalog:diarizeProgress', { id, progress: 100 })
  return { ok: true, lines }
})
