const { app, BrowserWindow, ipcMain, dialog, shell, protocol, net, Menu } = require('electron')

// Must be called before app.whenReady()
protocol.registerSchemesAsPrivileged([
  { scheme: 'localfile', privileges: { secure: true, standard: true, stream: true, supportFetchAPI: true } }
])
const path = require('path')
const fs = require('fs')
const https = require('https')
const http = require('http')
const { spawn, execSync } = require('child_process')
const os = require('os')

const isDev = !app.isPackaged
const APP_DATA = path.join(os.homedir(), '.whisper-app')
const WHISPER_DIR = path.join(APP_DATA, 'whisper.cpp')
const MODELS_DIR = path.join(APP_DATA, 'models')
const FFMPEG_DIR = path.join(APP_DATA, 'ffmpeg')
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
  return findExeInDir(WHISPER_DIR, 'whisper-cli.exe') || path.join(WHISPER_DIR, 'whisper-cli.exe')
}

function getWhisperHasGpu() {
  try { return fs.readFileSync(WHISPER_GPU_FLAG, 'utf8').trim() === '1' } catch { return false }
}

function getFFmpeg() {
  const appFfmpeg = path.join(FFMPEG_DIR, 'bin', 'ffmpeg.exe')
  if (fs.existsSync(appFfmpeg)) return appFfmpeg
  return null
}

function getModel() {
  return path.join(MODELS_DIR, 'ggml-large-v3-turbo.bin')
}

function getVadModel() {
  return path.join(MODELS_DIR, 'ggml-silero-v5.1.2.bin')
}

function detectGPU() {
  try {
    const out = execSync('powershell -Command "Get-WmiObject Win32_VideoController | Select-Object -ExpandProperty Name"', { timeout: 8000 }).toString()
    if (/nvidia/i.test(out)) return 'nvidia'
    if (/amd|radeon/i.test(out)) return 'amd'
  } catch {}
  return 'cpu'
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

function downloadFile(url, dest, onProgress) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest)
    const protocol = url.startsWith('https') ? https : http

    const request = (u) => {
      protocol.get(u, res => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return request(res.headers.location)
        }
        const total = parseInt(res.headers['content-length'] || '0')
        let received = 0
        res.on('data', chunk => {
          received += chunk.length
          file.write(chunk)
          if (total > 0) onProgress(Math.round((received / total) * 100), received, total)
        })
        res.on('end', () => { file.end(); resolve() })
        res.on('error', reject)
      }).on('error', reject)
    }
    request(url)
  })
}

async function setupWhisper(win) {
  const send = (event, data) => win.webContents.send(event, data)
  ensureDirs()

  const gpu = detectGPU()
  send('setup:gpu', gpu)

  // Check if already set up
  const whisperCli = getWhisperCli()
  const ffmpeg = getFFmpeg()
  const model = getModel()

  const vadModel = getVadModel()
  const needsWhisper = !fs.existsSync(whisperCli)
  const needsFfmpeg = !ffmpeg
  const needsModel = !fs.existsSync(model)
  const needsVad = !fs.existsSync(vadModel)

  if (!needsWhisper && !needsFfmpeg && !needsModel && !needsVad) {
    send('setup:done', { whisperCli, ffmpeg: getFFmpeg(), model, vadModel, gpu })
    return
  }

  // Download whisper-cli if needed
  if (needsWhisper) {
    try {
      // First try our own Vulkan build (GPU-accelerated, works on AMD/NVIDIA/Intel via Vulkan)
      const vulkanUrl = 'https://github.com/Bernardo-Andreatta/Stradiz-Transcriber/releases/download/v1.0.0/whisper-vulkan-bin-x64.zip'
      let downloadUrl = null
      let assetName = null
      let hasGpu = false

      send('setup:status', 'Checking Whisper Vulkan build availability...')
      try {
        // HEAD request to verify it exists
        await new Promise((resolve, reject) => {
          const req = require('https').request(vulkanUrl, { method: 'HEAD' }, res => {
            if (res.statusCode === 200 || res.statusCode === 302 || res.statusCode === 301) resolve()
            else reject(new Error(`HTTP ${res.statusCode}`))
          })
          req.on('error', reject)
          req.end()
        })
        downloadUrl = vulkanUrl
        assetName = 'whisper-vulkan-bin-x64.zip'
        hasGpu = true
      } catch {
        // Fall back to plain CPU build from official release
        send('setup:status', 'Fetching latest Whisper release info...')
        const release = await fetchJson('https://api.github.com/repos/ggerganov/whisper.cpp/releases/latest')
        const assets = release.assets || []
        const asset =
          assets.find(a => a.name === 'whisper-bin-x64.zip') ||
          assets.find(a => /x64/i.test(a.name) && a.name.endsWith('.zip') && !/cuda|cublas|blas/i.test(a.name))
        if (!asset) throw new Error('No suitable Whisper binary found in release')
        downloadUrl = asset.browser_download_url
        assetName = asset.name
        hasGpu = false
      }

      send('setup:status', `Downloading Whisper (${assetName})...`)
      const zipPath = path.join(APP_DATA, 'whisper.zip')
      await downloadFile(downloadUrl, zipPath,
        (pct, rcv, total) => send('setup:progress', { task: 'whisper', pct, rcv, total })
      )
      send('setup:status', 'Extracting Whisper...')
      fs.mkdirSync(WHISPER_DIR, { recursive: true })
      execSync(`tar -xf "${zipPath}" -C "${WHISPER_DIR}"`, { stdio: 'ignore' })
      fs.unlinkSync(zipPath)
      const extractedCli = findExeInDir(WHISPER_DIR, 'whisper-cli.exe')
      if (!extractedCli) {
        send('setup:status', 'Extraction failed — whisper-cli.exe not found after extracting. Please retry setup.')
      } else {
        fs.writeFileSync(WHISPER_GPU_FLAG, hasGpu ? '1' : '0')
      }
    } catch (e) {
      send('setup:status', `Failed to download Whisper: ${e.message}`)
    }
  }

  // Download ffmpeg if needed
  if (needsFfmpeg) {
    const ffmpegZip = path.join(APP_DATA, 'ffmpeg.zip')
    const MAX_ATTEMPTS = 3
    let ffmpegOk = false
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !ffmpegOk; attempt++) {
      try {
        if (attempt > 1) send('setup:status', `Retrying ffmpeg download (attempt ${attempt}/${MAX_ATTEMPTS})...`)
        else send('setup:status', 'Downloading ffmpeg...')

        // Clean up any partial state from a previous failed attempt
        if (fs.existsSync(ffmpegZip)) fs.unlinkSync(ffmpegZip)
        if (fs.existsSync(FFMPEG_DIR)) fs.rmSync(FFMPEG_DIR, { recursive: true, force: true })
        fs.mkdirSync(FFMPEG_DIR, { recursive: true })

        await downloadFile(
          'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
          ffmpegZip,
          (pct, rcv, total) => send('setup:progress', { task: 'ffmpeg', pct, rcv, total })
        )
        send('setup:status', 'Extracting ffmpeg...')
        // Use 'ignore' for stdio — the zip has thousands of files and 'pipe' overflows the default buffer
        execSync(`tar -xf "${ffmpegZip}" -C "${FFMPEG_DIR}"`, { stdio: 'ignore' })
        // Flatten the inner versioned folder so bin/ffmpeg.exe is directly under FFMPEG_DIR
        const inner = fs.readdirSync(FFMPEG_DIR).find(f => f.startsWith('ffmpeg'))
        if (inner) {
          const innerPath = path.join(FFMPEG_DIR, inner)
          fs.cpSync(innerPath, FFMPEG_DIR, { recursive: true })
          fs.rmSync(innerPath, { recursive: true, force: true })
        }
        fs.unlinkSync(ffmpegZip)
        if (getFFmpeg()) {
          ffmpegOk = true
        } else {
          throw new Error('ffmpeg.exe not found after extraction')
        }
      } catch (e) {
        if (attempt === MAX_ATTEMPTS) {
          send('setup:status', `Failed to set up ffmpeg after ${MAX_ATTEMPTS} attempts: ${e.message}`)
        }
      }
    }
  }

  // Download model if needed
  if (needsModel) {
    send('setup:status', 'Downloading Whisper large-v3-turbo model (1.5 GB)...')
    const modelPath = path.join(MODELS_DIR, 'ggml-large-v3-turbo.bin')
    await downloadFile(
      'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin',
      modelPath,
      (pct, rcv, total) => send('setup:progress', { task: 'model', pct, rcv, total })
    )
  }

  // Download VAD model if needed
  if (needsVad) {
    send('setup:status', 'Downloading VAD model (silence detection)...')
    const vadPath = path.join(MODELS_DIR, 'ggml-silero-v5.1.2.bin')
    await downloadFile(
      'https://huggingface.co/ggml-org/whisper-vad/resolve/main/ggml-silero-v5.1.2.bin',
      vadPath,
      (pct, rcv, total) => send('setup:progress', { task: 'vad', pct, rcv, total })
    )
  }

  const finalCli = getWhisperCli()
  const finalFfmpeg = getFFmpeg()
  const finalModel = getModel()
  const finalVad = getVadModel()
  const allReady = fs.existsSync(finalCli) && !!finalFfmpeg && fs.existsSync(finalModel) && fs.existsSync(finalVad)
  if (!allReady) send('setup:status', 'Setup incomplete — one or more components failed to install. Click Setup again to retry.')
  send('setup:done', { whisperCli: finalCli, ffmpeg: finalFfmpeg, model: finalModel, vadModel: finalVad, gpu, whisperHasGpu: getWhisperHasGpu(), ready: allReady })
}

let mainWindow
let currentConfig = {}
let currentProc = null
let stopRequested = false

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

ipcMain.handle('setup:check', async () => {
  const whisperCli = getWhisperCli()
  const ffmpeg = getFFmpeg()
  const model = getModel()
  const vadModel = getVadModel()
  const gpu = detectGPU()
  return {
    ready: fs.existsSync(whisperCli) && !!ffmpeg && fs.existsSync(model) && fs.existsSync(vadModel),
    whisperCli,
    ffmpeg,
    model,
    vadModel,
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

    // Convert to silence-removed wav once — kept for all recovery passes
    if (!ffmpegExe || !fs.existsSync(ffmpegExe)) {
      send('transcribe:file', { file: filePath, status: 'error', error: 'ffmpeg not found — please re-run Setup' })
      continue
    }
    send('transcribe:file', { file: filePath, status: 'converting' })
    const convertOk = await new Promise(resolve => {
      const silenceFilter = config.removeSilence
        ? ['-af', 'silenceremove=stop_periods=-1:stop_duration=1:stop_threshold=-50dB']
        : []
      const ff = spawn(ffmpegExe, ['-i', filePath, ...silenceFilter,
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wavPath, '-y'])
      ff.on('close', code => resolve(code === 0))
      ff.on('error', () => resolve(false))
    })
    if (!convertOk) {
      send('transcribe:file', { file: filePath, status: 'error', error: 'ffmpeg conversion failed' })
      continue
    }

    send('transcribe:file', { file: filePath, status: 'transcribing' })

    const allLines = []
    let offsetMs = 0
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
          ff.on('close', () => resolve())
        })
        segWav = tempSeg
      }

      const runLines = []
      let hallucinationAtMs = null
      let whisperExitCode = null

      await new Promise(resolve => {
        // Vulkan build auto-detects GPU; only pass -ng to force CPU when no GPU build
        const gpuArgs = config.whisperHasGpu ? [] : ['-ng']
        const args = ['-m', model, '-l', 'pt', '-f', segWav,
          '--no-speech-thold', '0.3', '--entropy-thold', '2.8',
          '--no-fallback', '--print-progress', '-nfa', ...gpuArgs]
        const proc = spawn(whisperCli, args)
        currentProc = proc

        let rawOutput = ''
        const seen = new Set()
        const recentTexts = []
        let hallucinationDetected = false

        const processChunk = (text) => {
          rawOutput += text
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
              proc.kill()
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
          currentProc = null
          whisperExitCode = code
          console.log(`[whisper close] code=${code} rawOutput.length=${rawOutput.length} lines=${runLines.length}`)
          console.log(`[whisper cmd] ${whisperCli} ${args.join(' ')}`)
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

    if (fs.existsSync(wavPath)) try { fs.unlinkSync(wavPath) } catch {}

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
  if (currentProc) {
    currentProc.kill()
    currentProc = null
  }
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

ipcMain.handle('file:saveSrt', (event, { srtPath, txtPath, lines }) => {
  const srt = lines.map((line, i) => {
    const start = line.startRaw || '00:00:00,000'
    const end = line.endRaw || '00:00:01,000'
    return `${i + 1}\n${start} --> ${end}\n${line.text}`
  }).join('\n\n')
  if (srtPath) fs.writeFileSync(srtPath, srt, 'utf8')

  const resolvedTxt = txtPath || (srtPath ? srtPath.replace(/\.srt$/i, '.txt') : null)
  const txt = lines.map(l => l.text).join('\n')
  if (resolvedTxt) fs.writeFileSync(resolvedTxt, txt, 'utf8')
})

ipcMain.handle('file:readSrt', (event, srtPath) => {
  if (!srtPath || !fs.existsSync(srtPath)) return []
  const text = fs.readFileSync(srtPath, 'utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = text.trim().split(/\n\n+/)
  return blocks.map(block => {
    const lines = block.split('\n')
    const timeLine = lines[1] || ''
    const [startRaw, endRaw] = timeLine.split(' --> ')
    const displayTime = startRaw ? startRaw.trim().replace(',', '.').replace(/^00:/, '') : ''
    return {
      time: displayTime,
      startRaw: startRaw ? startRaw.trim() : '',
      endRaw: endRaw ? endRaw.trim() : '',
      text: lines.slice(2).join('\n').trim()
    }
  }).filter(b => b.text)
})
