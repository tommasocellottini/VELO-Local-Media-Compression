// Audio Processing State
const audioState = {
    files: [],
    selectedFileId: null,
    globalFormat: 'mp3',
    compressionSettings: {
        bitDepth: 16,
        sampleRate: 44100,
        cutoffFrequency: 16000
    },
    trimSettings: {
        start: 0,
        end: 0
    },
    waveformZoom: {
        scale: 1.0,      // Zoom scale (1.0 = no zoom, 2.0 = 2x zoom, etc.)
        offsetX: 0,      // Horizontal offset in pixels
        minScale: 1.0,
        maxScale: 20.0
    },
    showProcessedWaveform: true  // Toggle between original and processed waveform
};

// Audio Context
let audioContext = null;
let currentAudioBuffer = null;
let waveformCanvas = null;
let waveformCtx = null;

// Initialize Audio Context
function getAudioContext() {
    if (!audioContext) {
        audioContext = new (window.AudioContext || window.webkitAudioContext)();
    }
    return audioContext;
}

// Handle Audio Files
async function handleAudioFiles(fileList) {
    // Debug logging (can be removed for production)
    console.log('handleAudioFiles called with', fileList.length, 'files');
    const newFiles = Array.from(fileList).filter(f => 
        f.type.startsWith('audio/') || 
        f.name.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i)
    );
    
    console.log('Filtered to', newFiles.length, 'audio files');
    
    if (newFiles.length === 0) {
        console.warn('No valid audio files found');
        alert('Please select valid audio files');
        return;
    }

    for (const file of newFiles) {
        // Avoid duplicates
        if (audioState.files.some(f => f.name === file.name)) continue;

        const fileEntry = {
            id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substr(2, 9),
            name: file.name,
            originalFile: file,
            originalUrl: URL.createObjectURL(file),
            size: file.size,
            format: audioState.globalFormat,
            duration: 0,
            processedBlob: null,
            processedUrl: null,
            processedSize: 0,
            savings: 0,
            audioBuffer: null,
            originalAudioBuffer: null // Store original buffer for reset
        };

        audioState.files.push(fileEntry);
        if (!audioState.selectedFileId) audioState.selectedFileId = fileEntry.id;

        // Load audio buffer
        await loadAudioBuffer(fileEntry);
    }

    if (els.fileInput) els.fileInput.value = '';
    updateAudioUI();
}

// Load Audio Buffer
async function loadAudioBuffer(fileEntry) {
    try {
        const arrayBuffer = await fileEntry.originalFile.arrayBuffer();
        const ctx = getAudioContext();
        const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
        
        // Create a copy of the buffer to preserve original
        fileEntry.originalAudioBuffer = decodedBuffer;
        
        // Create working copy
        fileEntry.audioBuffer = copyAudioBuffer(decodedBuffer);
        fileEntry.duration = fileEntry.audioBuffer.duration;
        
        // Initial processing
        await processAudioFile(fileEntry);
    } catch (error) {
        console.error('Error loading audio:', error);
        alert(`Error loading ${fileEntry.name}: ${error.message}`);
    }
}

// Copy Audio Buffer
function copyAudioBuffer(buffer) {
    const ctx = getAudioContext();
    const copy = ctx.createBuffer(
        buffer.numberOfChannels,
        buffer.length,
        buffer.sampleRate
    );
    
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
        const sourceData = buffer.getChannelData(channel);
        const copyData = copy.getChannelData(channel);
        copyData.set(sourceData);
    }
    
    return copy;
}

// Process Audio File (Compression, Format Conversion)
async function processAudioFile(fileEntry) {
    if (!fileEntry.audioBuffer) return;

    try {
        // Apply compression and filters
        let processedBuffer = fileEntry.audioBuffer;
        
        // Apply high-frequency filter
        processedBuffer = await applyHighFrequencyFilter(
            processedBuffer, 
            audioState.compressionSettings.cutoffFrequency
        );

        // Convert to target format
        let processedBlob = null;
        if (fileEntry.format === 'mp3') {
            processedBlob = await encodeToMP3(processedBuffer);
        } else if (fileEntry.format === 'wav') {
            processedBlob = await encodeToWAV(processedBuffer);
        }

        if (processedBlob) {
            // Only use processed file if it's smaller than original
            if (processedBlob.size < fileEntry.size) {
                fileEntry.processedBlob = processedBlob;
                fileEntry.processedUrl = URL.createObjectURL(processedBlob);
                fileEntry.processedSize = processedBlob.size;
                fileEntry.savings = Math.round((1 - fileEntry.processedSize / fileEntry.size) * 100);
            } else {
                // Keep original file if processed is larger
                fileEntry.processedBlob = fileEntry.originalFile;
                fileEntry.processedUrl = fileEntry.originalUrl;
                fileEntry.processedSize = fileEntry.size;
                fileEntry.savings = 0;
            }
        }

        updateAudioUI();
    } catch (error) {
        console.error('Error processing audio:', error);
    }
}

// Apply High-Frequency Filter
async function applyHighFrequencyFilter(audioBuffer, cutoffFrequency) {
    const ctx = getAudioContext();
    const offlineCtx = new OfflineAudioContext(
        audioBuffer.numberOfChannels,
        audioBuffer.length,
        audioBuffer.sampleRate
    );

    const source = offlineCtx.createBufferSource();
    source.buffer = audioBuffer;

    const filter = offlineCtx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = cutoffFrequency;
    filter.Q.value = 1;

    source.connect(filter);
    filter.connect(offlineCtx.destination);
    source.start(0);

    const filteredBuffer = await offlineCtx.startRendering();
    return filteredBuffer;
}

// Encode to WAV
async function encodeToWAV(audioBuffer) {
    const numberOfChannels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const bitDepth = audioState.compressionSettings.bitDepth;
    const length = audioBuffer.length * numberOfChannels * (bitDepth / 8);

    const buffer = new ArrayBuffer(44 + length);
    const view = new DataView(buffer);

    // WAV Header
    const writeString = (offset, string) => {
        for (let i = 0; i < string.length; i++) {
            view.setUint8(offset + i, string.charCodeAt(i));
        }
    };

    writeString(0, 'RIFF');
    view.setUint32(4, 36 + length, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numberOfChannels * (bitDepth / 8), true);
    view.setUint16(32, numberOfChannels * (bitDepth / 8), true);
    view.setUint16(34, bitDepth, true);
    writeString(36, 'data');
    view.setUint32(40, length, true);

    // Write audio data
    let offset = 44;
    const maxAmplitude = Math.pow(2, bitDepth - 1) - 1;
    
    for (let i = 0; i < audioBuffer.length; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const sample = audioBuffer.getChannelData(channel)[i];
            const clampedSample = Math.max(-1, Math.min(1, sample));
            
            if (bitDepth === 16) {
                view.setInt16(offset, clampedSample * maxAmplitude, true);
                offset += 2;
            } else if (bitDepth === 8) {
                view.setUint8(offset, (clampedSample + 1) * 127.5);
                offset += 1;
            }
        }
    }

    return new Blob([buffer], { type: 'audio/wav' });
}

// Encode to MP3 (using lamejs library)
async function encodeToMP3(audioBuffer) {
    // Check if lamejs is available
    if (typeof lamejs === 'undefined') {
        console.warn('lamejs not available, using WAV format instead');
        // For now, return WAV when MP3 encoding is not available
        // In production, you would need to include the lamejs library
        return encodeToWAV(audioBuffer);
    }

    const channels = audioBuffer.numberOfChannels;
    const sampleRate = audioBuffer.sampleRate;
    const kbps = 128;

    const mp3encoder = new lamejs.Mp3Encoder(channels, sampleRate, kbps);
    const mp3Data = [];

    const sampleBlockSize = 1152;
    const leftChannel = audioBuffer.getChannelData(0);
    const rightChannel = channels > 1 ? audioBuffer.getChannelData(1) : leftChannel;
    
    // Convert to Int16 (only when MP3 encoding is available)
    const leftSamples = new Int16Array(leftChannel.length);
    const rightSamples = new Int16Array(rightChannel.length);
    
    for (let i = 0; i < leftChannel.length; i++) {
        leftSamples[i] = leftChannel[i] < 0 ? leftChannel[i] * 32768 : leftChannel[i] * 32767;
        rightSamples[i] = rightChannel[i] < 0 ? rightChannel[i] * 32768 : rightChannel[i] * 32767;
    }

    // Encode in blocks
    for (let i = 0; i < leftSamples.length; i += sampleBlockSize) {
        const leftChunk = leftSamples.subarray(i, i + sampleBlockSize);
        const rightChunk = rightSamples.subarray(i, i + sampleBlockSize);
        const mp3buf = channels === 1 ? 
            mp3encoder.encodeBuffer(leftChunk) : 
            mp3encoder.encodeBuffer(leftChunk, rightChunk);
        if (mp3buf.length > 0) {
            mp3Data.push(mp3buf);
        }
    }

    const mp3buf = mp3encoder.flush();
    if (mp3buf.length > 0) {
        mp3Data.push(mp3buf);
    }

    return new Blob(mp3Data, { type: 'audio/mp3' });
}

// Trim Audio
async function trimAudio(fileEntry, startTime, endTime) {
    if (!fileEntry.audioBuffer) return;

    const ctx = getAudioContext();
    const sampleRate = fileEntry.audioBuffer.sampleRate;
    const numberOfChannels = fileEntry.audioBuffer.numberOfChannels;

    const startSample = Math.floor(startTime * sampleRate);
    const endSample = Math.floor(endTime * sampleRate);
    const newLength = endSample - startSample;

    const trimmedBuffer = ctx.createBuffer(
        numberOfChannels,
        newLength,
        sampleRate
    );

    for (let channel = 0; channel < numberOfChannels; channel++) {
        const originalData = fileEntry.audioBuffer.getChannelData(channel);
        const trimmedData = trimmedBuffer.getChannelData(channel);
        
        for (let i = 0; i < newLength; i++) {
            trimmedData[i] = originalData[startSample + i];
        }
    }

    // Update the audio buffer with trimmed version
    fileEntry.audioBuffer = trimmedBuffer;
    fileEntry.duration = trimmedBuffer.duration;
    
    // Reprocess with new buffer
    await processAudioFile(fileEntry);
}

// Reset Trim to Original
async function resetTrim(fileEntry) {
    if (!fileEntry || !fileEntry.originalAudioBuffer) return;
    
    // Restore original audio buffer by creating a fresh copy
    fileEntry.audioBuffer = copyAudioBuffer(fileEntry.originalAudioBuffer);
    fileEntry.duration = fileEntry.originalAudioBuffer.duration;
    
    // Reset trim settings
    audioState.trimSettings.start = 0;
    audioState.trimSettings.end = 0;
    
    // Reprocess with original buffer
    await processAudioFile(fileEntry);
}


// Get the appropriate audio buffer based on waveform view toggle state
function getWaveformBuffer(fileEntry) {
    if (!fileEntry) return null;
    
    return audioState.showProcessedWaveform 
        ? fileEntry.audioBuffer 
        : (fileEntry.originalAudioBuffer || fileEntry.audioBuffer);
}

// Draw Waveform with optional playback position indicator
// Pass playbackPosition = -1 to hide the playback indicator
// Pass playbackPosition >= 0 to show indicator at that position (in seconds)
// Pass hoverPosition >= 0 to show hover indicator at that position (in seconds)
function drawWaveform(audioBuffer, canvas, playbackPosition = -1, hoverPosition = -1) {
    if (!canvas || !audioBuffer) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#1e1e1e';
    ctx.fillRect(0, 0, width, height);

    const data = audioBuffer.getChannelData(0);
    const zoom = audioState.waveformZoom;
    
    // Calculate visible range based on zoom
    const totalSamples = data.length;
    const samplesPerPixel = totalSamples / width;
    const visibleWidth = width / zoom.scale;
    const startPixel = Math.max(0, Math.min(zoom.offsetX, width - visibleWidth));
    const endPixel = Math.min(width, startPixel + visibleWidth);
    
    const startSample = Math.floor(startPixel * samplesPerPixel);
    const endSample = Math.min(totalSamples, Math.ceil(endPixel * samplesPerPixel));
    const visibleSamples = endSample - startSample;
    const step = Math.max(1, Math.ceil(visibleSamples / width));
    
    const amp = height / 2;

    ctx.strokeStyle = '#0d6efd';
    ctx.lineWidth = 1;
    ctx.beginPath();

    for (let i = 0; i < width; i++) {
        let min = 1.0;
        let max = -1.0;
        
        const sampleIndex = startSample + Math.floor((i / width) * visibleSamples);
        
        for (let j = 0; j < step; j++) {
            const idx = sampleIndex + j;
            if (idx >= endSample) break;
            const datum = data[idx] || 0;
            if (datum < min) min = datum;
            if (datum > max) max = datum;
        }
        
        const yMin = (1 + min) * amp;
        const yMax = (1 + max) * amp;
        
        if (i === 0) {
            ctx.moveTo(i, yMin);
        }
        ctx.lineTo(i, yMin);
        ctx.lineTo(i, yMax);
    }

    ctx.stroke();

    // Draw trim markers if trim has been applied
    if ((audioState.trimSettings.start > 0 || audioState.trimSettings.end > 0) && 
        audioState.trimSettings.end > audioState.trimSettings.start) {
        const duration = audioBuffer.duration;
        const visibleDuration = duration / zoom.scale;
        const startTime = (startPixel / width) * duration;
        const endTime = startTime + visibleDuration;
        
        // Only draw markers if they're in the visible range
        const trimStartTime = audioState.trimSettings.start;
        const trimEndTime = audioState.trimSettings.end > 0 ? audioState.trimSettings.end : duration;
        
        if (trimStartTime >= startTime && trimStartTime <= endTime) {
            const startX = ((trimStartTime - startTime) / visibleDuration) * width;
            ctx.strokeStyle = '#0d6efd';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(startX, 0);
            ctx.lineTo(startX, height);
            ctx.stroke();
        }
        
        if (trimEndTime >= startTime && trimEndTime <= endTime) {
            const endX = ((trimEndTime - startTime) / visibleDuration) * width;
            ctx.strokeStyle = '#0d6efd';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(endX, 0);
            ctx.lineTo(endX, height);
            ctx.stroke();
        }
    }
    
    // Draw playback position indicator (pass -1 to hide indicator)
    if (playbackPosition >= 0 && playbackPosition <= audioBuffer.duration) {
        const duration = audioBuffer.duration;
        const visibleDuration = duration / zoom.scale;
        const startTime = (startPixel / width) * duration;
        const endTime = startTime + visibleDuration;
        
        // Only draw if playback position is in visible range
        if (playbackPosition >= startTime && playbackPosition <= endTime) {
            const posX = ((playbackPosition - startTime) / visibleDuration) * width;
        
            // Draw vertical line
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(posX, 0);
            ctx.lineTo(posX, height);
            ctx.stroke();
        
            // Draw triangle at top
            ctx.fillStyle = '#ff0000';
            ctx.beginPath();
            ctx.moveTo(posX, 0);
            ctx.lineTo(posX - 5, 8);
            ctx.lineTo(posX + 5, 8);
            ctx.closePath();
            ctx.fill();
        }
    }
    
    // Draw hover position indicator (shows even when playing)
    if (hoverPosition >= 0 && hoverPosition <= audioBuffer.duration) {
        const duration = audioBuffer.duration;
        const visibleDuration = duration / zoom.scale;
        const startTime = (startPixel / width) * duration;
        const endTime = startTime + visibleDuration;
        
        // Only draw if hover position is in visible range
        if (hoverPosition >= startTime && hoverPosition <= endTime) {
            const posX = ((hoverPosition - startTime) / visibleDuration) * width;
        
            // Draw vertical line (slightly transparent red)
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(posX, 0);
            ctx.lineTo(posX, height);
            ctx.stroke();
        
            // Draw triangle at top
            ctx.fillStyle = 'rgba(255, 0, 0, 0.7)';
            ctx.beginPath();
            ctx.moveTo(posX, 0);
            ctx.lineTo(posX - 5, 8);
            ctx.lineTo(posX + 5, 8);
            ctx.closePath();
            ctx.fill();
        }
    }
}

// Update Audio UI
function updateAudioUI() {
    // Update file list
    renderAudioFileList();

    // Update selected file preview
    const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
    if (selected && selected.audioBuffer) {
        // Resize canvas first
        resizeWaveformCanvas();
        
        const canvas = document.getElementById('waveformCanvas');
        if (canvas) {
            drawWaveform(getWaveformBuffer(selected), canvas, -1, -1);
        }
        
        // Update trim input defaults
        const trimStart = document.getElementById('trimStart');
        const trimEnd = document.getElementById('trimEnd');
        if (trimStart) {
            trimStart.value = "0";
            trimStart.max = selected.duration;
        }
        if (trimEnd) {
            trimEnd.value = selected.duration.toFixed(1);
            trimEnd.max = selected.duration;
        }
    }
    
    // Update audio duration display
    const audioDuration = document.getElementById('audioDuration');
    if (audioDuration && selected && selected.duration) {
        audioDuration.textContent = formatDuration(selected.duration);
    } else if (audioDuration) {
        audioDuration.textContent = '0:00';
    }

    // Update files count
    if (els.filesCountLabel) {
        els.filesCountLabel.textContent = `Selected files (${audioState.files.length})`;
    }

    // Show/hide interface
    if (audioState.files.length > 0) {
        if (els.initOverlay) els.initOverlay.classList.add('d-none');
        if (els.appInterface) els.appInterface.classList.remove('d-none');
    }
    
    // Update scrollbar
    updateWaveformScrollbar();
}

// Render Audio File List
function renderAudioFileList() {
    const container = document.getElementById('fileListContainer');
    if (!container) return;

    container.innerHTML = '';

    audioState.files.forEach(file => {
        const isActive = file.id === audioState.selectedFileId;
        const savings = file.savings || 0;
        // Treat 0 or positive savings as success (green), negative as failure (red)
        const savingsColor = savings < 0 ? 'text-danger' : 'text-success';

        const div = document.createElement('div');
        div.className = `file-item p-2 mb-2 rounded border ${isActive ? 'active border-primary' : 'border-secondary'}`;
        div.style.cursor = 'pointer';

        div.innerHTML = `
            <div class="d-flex justify-content-between align-items-start">
                <div class="flex-grow-1 text-truncate">
                    <div class="small text-truncate" title="${file.name}">${file.name}</div>
                    <div class="small text-white-50">
                        ${formatFileSize(file.size)} → ${formatFileSize(file.processedSize)}
                        <span class="${savingsColor}">(${savings >= 0 ? '-' : '+'}${Math.abs(savings).toFixed(1)}%)</span>
                    </div>
                    <div class="small text-white-50">${formatDuration(file.duration)}</div>
                </div>
                <div class="d-flex gap-1">
                    <button class="btn btn-sm btn-blue" onclick="downloadAudioFile('${file.id}')" title="Download">
                        <img src="assets/download.svg" class="icon" alt="Download">
                    </button>
                    <button class="btn btn-sm btn-red" onclick="removeAudioFile('${file.id}')" title="Remove">
                        <img src="assets/deleteClose.svg" class="icon" alt="Remove">
                    </button>
                </div>
            </div>
        `;

        div.onclick = (e) => {
            if (!e.target.closest('button')) {
                audioState.selectedFileId = file.id;
                // Reset zoom when changing files
                audioState.waveformZoom.scale = 1.0;
                audioState.waveformZoom.offsetX = 0;
                updateAudioUI();
            }
        };

        container.appendChild(div);
    });
}

// Format Duration
function formatDuration(seconds) {
    if (!seconds || isNaN(seconds)) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Format File Size
function formatFileSize(bytes) {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
}

// Download Audio File
window.downloadAudioFile = function(fileId) {
    const file = audioState.files.find(f => f.id === fileId);
    if (!file || !file.processedBlob) return;

    const link = document.createElement('a');
    link.href = file.processedUrl;
    const ext = file.format === 'mp3' ? 'mp3' : 'wav';
    link.download = file.name.replace(/\.[^.]+$/, `.${ext}`);
    link.click();
};

// Remove Audio File
window.removeAudioFile = function(fileId) {
    const index = audioState.files.findIndex(f => f.id === fileId);
    if (index === -1) return;

    const file = audioState.files[index];
    if (file.originalUrl) URL.revokeObjectURL(file.originalUrl);
    if (file.processedUrl) URL.revokeObjectURL(file.processedUrl);

    audioState.files.splice(index, 1);

    if (audioState.selectedFileId === fileId) {
        audioState.selectedFileId = audioState.files.length > 0 ? 
            audioState.files[0].id : null;
    }
    document.querySelector("#btnStop").click();
    updateAudioUI();

    if (audioState.files.length === 0) {
        clearAllAudio();
    }
};

// Clear All Audio
function clearAllAudio() {
    audioState.files.forEach(file => {
        if (file.originalUrl) URL.revokeObjectURL(file.originalUrl);
        if (file.processedUrl) URL.revokeObjectURL(file.processedUrl);
    });

    audioState.files = [];
    audioState.selectedFileId = null;

    if (els.initOverlay) els.initOverlay.classList.remove('d-none');
    if (els.appInterface) els.appInterface.classList.add('d-none');
    if (els.fileListContainer) els.fileListContainer.innerHTML = '';
}

// Download All as ZIP
async function downloadAudioZip() {
    if (audioState.files.length === 0) return;

    const zip = new JSZip();
    
    for (const file of audioState.files) {
        if (file.processedBlob) {
            const ext = file.format === 'mp3' ? 'mp3' : 'wav';
            const filename = file.name.replace(/\.[^.]+$/, `.${ext}`);
            zip.file(filename, file.processedBlob);
        }
    }

    const blob = await zip.generateAsync({ type: 'blob' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'velo-audio-compressed.zip';
    link.click();
}

// Function to update scrollbar visibility and value
function updateWaveformScrollbar() {
    const scrollbarContainer = document.getElementById('waveformScrollbarContainer');
    const scrollbar = document.getElementById('waveformScrollbar');
    const waveformCanvas = document.getElementById('waveformCanvas');
    
    if (!scrollbarContainer || !scrollbar || !waveformCanvas) return;
    
    const zoom = audioState.waveformZoom;
    
    // Show scrollbar only when zoomed in
    if (zoom.scale > 1.0) {
        scrollbarContainer.style.display = 'block';
        
        // Calculate scrollbar value (0-100)
        const canvasWidth = waveformCanvas.width;
        const visibleWidth = canvasWidth / zoom.scale;
        const maxOffset = canvasWidth - visibleWidth;
        const scrollValue = maxOffset > 0 ? (zoom.offsetX / maxOffset) * 100 : 0;
        
        scrollbar.value = scrollValue;
    } else {
        scrollbarContainer.style.display = 'none';
    }
}

// Function to resize canvas dynamically to 95% of parent container
function resizeWaveformCanvas() {
    const canvas = document.getElementById('waveformCanvas');
    const container = document.getElementById('spectro');
    
    if (!canvas || !container) return;
    
    // Get the container width and set canvas to 95% of it
    const containerWidth = container.clientWidth;
    const canvasWidth = Math.floor(containerWidth * 0.95);
    
    // Only update if size has changed significantly (to avoid constant redraws)
    if (Math.abs(canvas.width - canvasWidth) > 5) {
        canvas.width = canvasWidth;
        
        // Redraw waveform if there's an audio buffer loaded
        const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
        if (selected && selected.audioBuffer) {
            const playbackPosition = isPlaying ? (getAudioContext().currentTime - playbackStartTime) : -1;
            drawWaveform(getWaveformBuffer(selected), canvas, playbackPosition, -1);
        }
        
        // Update scrollbar after resize
        updateWaveformScrollbar();
    }
}

// Setup Audio Event Listeners
function setupAudioEventListeners() {
    // Debug logging (can be removed for production)
    console.log('Setting up audio event listeners');
    // File input handlers
    if (els.btnSelectImages) {
        els.btnSelectImages.onclick = () => {
            console.log('Select Audio Files button clicked');
            els.fileInput.click();
        };
    }
    if (els.btnAddImg) {
        els.btnAddImg.onclick = () => {
            console.log('Add Audio button clicked');
            els.fileInput.click();
        };
    }
    if (els.fileInput) {
        console.log('Setting up fileInput change handler');
        els.fileInput.onchange = (e) => {
            console.log('File input changed, files:', e.target.files);
            handleAudioFiles(e.target.files);
        };
    } else {
        console.error('fileInput element not found!');
    }

    // Global actions
    if (els.btnClear) {
        els.btnClear.onclick = clearAllAudio;
    }
    if (els.btnZip) {
        els.btnZip.onclick = downloadAudioZip;
    }
    if (els.globalFormat) {
        els.globalFormat.onchange = (e) => {
            audioState.globalFormat = e.target.value;
            audioState.files.forEach(f => {
                f.format = audioState.globalFormat;
                processAudioFile(f);
            });
        };
    }

    // Waveform view toggle
    const waveformViewToggle = document.getElementById('waveformViewToggle');
    if (waveformViewToggle) {
        waveformViewToggle.onchange = (e) => {
            audioState.showProcessedWaveform = e.target.checked;
            updateAudioUI();
        };
    }

    // Audio-specific controls
    const bitDepthSelect = document.getElementById('bitDepthSelect');
    if (bitDepthSelect) {
        bitDepthSelect.onchange = (e) => {
            audioState.compressionSettings.bitDepth = parseInt(e.target.value);
            const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
            if (selected) processAudioFile(selected);
        };
    }

    const cutoffFrequencyRange = document.getElementById('cutoffFrequencyRange');
    const cutoffFrequencyLabel = document.getElementById('cutoffFrequencyLabel');
    if (cutoffFrequencyRange) {
        cutoffFrequencyRange.oninput = (e) => {
            const value = parseInt(e.target.value);
            audioState.compressionSettings.cutoffFrequency = value;
            if (cutoffFrequencyLabel) {
                cutoffFrequencyLabel.textContent = (value / 1000).toFixed(0) + ' kHz';
            }
        };
        cutoffFrequencyRange.onchange = () => {
            const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
            if (selected) processAudioFile(selected);
        };
    }

    // Trim controls
    const btnApplyTrim = document.getElementById('btnApplyTrim');
    if (btnApplyTrim) {
        btnApplyTrim.onclick = async () => {
            const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
            if (!selected) return;

            const trimStart = parseFloat(document.getElementById('trimStart')?.value || 0);
            const trimEnd = parseFloat(document.getElementById('trimEnd')?.value || selected.duration);

            if (trimStart >= 0 && trimEnd > trimStart && trimEnd <= selected.duration) {
                audioState.trimSettings.start = trimStart;
                audioState.trimSettings.end = trimEnd;
                await trimAudio(selected, trimStart, trimEnd);
                updateAudioUI();
            } else {
                alert('Invalid trim range');
            }
        };
    }

    // Reset trim controls
    const btnResetTrim = document.getElementById('btnResetTrim');
    if (btnResetTrim) {
        btnResetTrim.onclick = async () => {
            const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
            if (!selected) return;

            await resetTrim(selected);
            updateAudioUI();
        };
    }

    // Playback controls
    let currentSource = null;
    let playbackStartTime = 0;
    let playbackDuration = 0;
    let playbackInterval = null;
    let isPlaying = false;
    let currentPlaybackPosition = 0; // Track current position in seconds
    
    // Constants for playback control
    const SKIP_SECONDS = 10;
    
    // Helper function to save current playback position
    function saveCurrentPosition() {
        if (isPlaying && currentSource) {
            const ctx = getAudioContext();
            currentPlaybackPosition = ctx.currentTime - playbackStartTime;
        }
    }
    
    // Helper function to reset play button text
    function resetPlayButtonText() {
        const btnPlayOriginal = document.getElementById('btnPlayOriginal');
        if (btnPlayOriginal) btnPlayOriginal.textContent = 'Play Original';
        const btnPlayProcessed = document.getElementById('btnPlayProcessed');
        if (btnPlayProcessed) btnPlayProcessed.textContent = 'Play Processed';
    }
    
    // Update progress bar and time display
    function updatePlaybackProgress() {
        const audioProgressBar = document.getElementById('audioProgressBar');
        const audioCurrentTime = document.getElementById('audioCurrentTime');
        const audioDuration = document.getElementById('audioDuration');
        const canvas = document.getElementById('waveformCanvas');
        
        if (!audioProgressBar || !audioCurrentTime || !audioDuration) return;
        
        const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
        
        if (isPlaying && currentSource) {
            const ctx = getAudioContext();
            const elapsed = ctx.currentTime - playbackStartTime;
            currentPlaybackPosition = elapsed; // Update current position
            const progress = (elapsed / playbackDuration) * 100;
            
            audioProgressBar.value = Math.min(progress, 100);
            audioCurrentTime.textContent = formatDuration(elapsed);
            audioDuration.textContent = formatDuration(playbackDuration);
            
            // Update waveform with playback position
            if (selected && selected.audioBuffer && canvas) {
                drawWaveform(getWaveformBuffer(selected), canvas, elapsed, -1);
            }
        } else {
            audioProgressBar.value = (currentPlaybackPosition / playbackDuration) * 100 || 0;
            audioCurrentTime.textContent = formatDuration(currentPlaybackPosition);
            
            if (selected && selected.duration) {
                audioDuration.textContent = formatDuration(selected.duration);
            } else {
                audioDuration.textContent = '0:00';
            }
        }
    }
    
    // Stop current playback
    function stopPlayback() {
        if (currentSource) {
            currentSource.stop();
            currentSource = null;
        }
        if (playbackInterval) {
            clearInterval(playbackInterval);
            playbackInterval = null;
        }
        isPlaying = false;
        updatePlaybackProgress();
        
        // Redraw waveform without playback indicator
        const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
        const canvas = document.getElementById('waveformCanvas');
        if (selected && selected.audioBuffer && canvas) {
            drawWaveform(getWaveformBuffer(selected), canvas, -1, -1);
        }
    }
    
    const btnPlayOriginal = document.getElementById('btnPlayOriginal');
    if (btnPlayOriginal) {
        btnPlayOriginal.onclick = async () => {
            const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
            if (!selected || !selected.originalFile) return;

            if (currentSource) {
                stopPlayback();
                btnPlayOriginal.textContent = 'Play Original';
                const btnPlayProcessed = document.getElementById('btnPlayProcessed');
                if (btnPlayProcessed) btnPlayProcessed.textContent = 'Play Processed';
                return;
            }

            try {
                const arrayBuffer = await selected.originalFile.arrayBuffer();
                const ctx = getAudioContext();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                
                currentSource = ctx.createBufferSource();
                currentSource.buffer = audioBuffer;
                currentSource.connect(ctx.destination);
                
                playbackStartTime = ctx.currentTime;
                playbackDuration = audioBuffer.duration;
                isPlaying = true;
                
                currentSource.start(0);
                
                btnPlayOriginal.textContent = 'Stop';
                updatePlaybackProgress();
                
                // Update progress bar every 100ms
                playbackInterval = setInterval(updatePlaybackProgress, 100);
                
                currentSource.onended = () => {
                    stopPlayback();
                    btnPlayOriginal.textContent = 'Play Original';
                };
            } catch (error) {
                console.error('Error playing audio:', error);
            }
        };
    }

    const btnPlayProcessed = document.getElementById('btnPlayProcessed');
    if (btnPlayProcessed) {
        btnPlayProcessed.onclick = async () => {
            const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
            if (!selected || !selected.processedBlob) return;

            if (currentSource) {
                stopPlayback();
                btnPlayProcessed.textContent = 'Play Processed';
                const btnPlayOriginal = document.getElementById('btnPlayOriginal');
                if (btnPlayOriginal) btnPlayOriginal.textContent = 'Play Original';
                return;
            }

            try {
                const arrayBuffer = await selected.processedBlob.arrayBuffer();
                const ctx = getAudioContext();
                const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
                
                currentSource = ctx.createBufferSource();
                currentSource.buffer = audioBuffer;
                currentSource.connect(ctx.destination);
                
                playbackStartTime = ctx.currentTime;
                playbackDuration = audioBuffer.duration;
                isPlaying = true;
                
                currentSource.start(0);
                
                btnPlayProcessed.textContent = 'Stop';
                updatePlaybackProgress();
                
                // Update progress bar every 100ms
                playbackInterval = setInterval(updatePlaybackProgress, 100);
                
                currentSource.onended = () => {
                    stopPlayback();
                    btnPlayProcessed.textContent = 'Play Processed';
                };
            } catch (error) {
                console.error('Error playing audio:', error);
            }
        };
    }
    
    // New Playback Control Buttons
    const btnBackward10 = document.getElementById('btnBackward10');
    if (btnBackward10) {
        btnBackward10.onclick = () => {
            try {
                const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
                if (!selected || !selected.audioBuffer) return;
                
                // Stop current playback
                const wasPlaying = isPlaying;
                if (currentSource) {
                    stopPlayback();
                    resetPlayButtonText();
                }
                
                // Calculate new position - use currentPlaybackPosition instead of calculating
                const newTime = Math.max(0, currentPlaybackPosition - SKIP_SECONDS);
                currentPlaybackPosition = newTime;
                updatePlaybackProgress();
                
                // If was playing, restart from new position
                if (wasPlaying) {
                    playFromPosition(selected, newTime);
                }
            } catch (error) {
                console.error('Error in btnBackward10:', error);
            }
        };
    }
    
    const btnPlay = document.getElementById('btnPlay');
    if (btnPlay) {
        btnPlay.onclick = async () => {
            try {
                const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
                if (!selected || !selected.audioBuffer) return;
                
                // If already playing, do nothing
                if (isPlaying && currentSource) return;
                
                // Play from current position
                await playFromPosition(selected, currentPlaybackPosition);
            } catch (error) {
                console.error('Error in btnPlay:', error);
            }
        };
    }
    
    const btnPause = document.getElementById('btnPause');
    if (btnPause) {
        btnPause.onclick = () => {
            try {
                if (currentSource && isPlaying) {
                    // Save current position before stopping
                    saveCurrentPosition();
                    
                    stopPlayback();
                    resetPlayButtonText();
                    
                    updatePlaybackProgress();
                }
            } catch (error) {
                console.error('Error in btnPause:', error);
            }
        };
    }
    
    const btnStop = document.getElementById('btnStop');
    if (btnStop) {
        btnStop.onclick = () => {
            try {
                // Stop playback and reset to 0s
                if (currentSource) {
                    stopPlayback();
                    resetPlayButtonText();
                }
                
                // Reset position to 0
                currentPlaybackPosition = 0;
                updatePlaybackProgress();
            } catch (error) {
                console.error('Error in btnStop:', error);
            }
        };
    }
    
    const btnForward10 = document.getElementById('btnForward10');
    if (btnForward10) {
        btnForward10.onclick = () => {
            try {
                const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
                if (!selected || !selected.audioBuffer) return;
                
                // Stop current playback
                const wasPlaying = isPlaying;
                
                if (currentSource) {
                    // Save current position before stopping
                    saveCurrentPosition();
                    
                    stopPlayback();
                    resetPlayButtonText();
                }
                
                // Calculate new position
                const duration = selected.audioBuffer.duration;
                const newTime = currentPlaybackPosition + SKIP_SECONDS;
                
                // If less than 10s remaining, stop
                if (newTime >= duration) {
                    currentPlaybackPosition = 0;
                    updatePlaybackProgress();
                    return;
                }
                
                currentPlaybackPosition = newTime;
                updatePlaybackProgress();
                
                // If was playing, restart from new position
                if (wasPlaying) {
                    playFromPosition(selected, newTime);
                }
            } catch (error) {
                console.error('Error in btnForward10:', error);
            }
        };
    }
    
    // Helper function to play from a specific position
    async function playFromPosition(fileEntry, startTime) {
        try {
            const ctx = getAudioContext();
            const audioBuffer = fileEntry.audioBuffer;
            
            currentSource = ctx.createBufferSource();
            currentSource.buffer = audioBuffer;
            currentSource.connect(ctx.destination);
            
            playbackStartTime = ctx.currentTime - startTime;
            playbackDuration = audioBuffer.duration;
            isPlaying = true;
            
            currentSource.start(0, startTime);
            
            updatePlaybackProgress();
            
            // Update progress bar every 100ms
            playbackInterval = setInterval(updatePlaybackProgress, 100);
            
            currentSource.onended = () => {
                stopPlayback();
                currentPlaybackPosition = 0;
                updatePlaybackProgress();
            };
        } catch (error) {
            console.error('Error playing from position:', error);
        }
    }
    
    // Handle progress bar - disable during playback (seeking not implemented)
    const audioProgressBar = document.getElementById('audioProgressBar');
    if (audioProgressBar) {
        audioProgressBar.disabled = false;
        audioProgressBar.oninput = (e) => {
            // Reset to current playback position if user tries to seek during playback
            if (isPlaying) {
                e.preventDefault();
                const ctx = getAudioContext();
                const elapsed = ctx.currentTime - playbackStartTime;
                const progress = (elapsed / playbackDuration) * 100;
                audioProgressBar.value = progress;
            }
        };
    }

    // Waveform zoom and click-to-seek functionality
    const waveformCanvas = document.getElementById('waveformCanvas');
    if (waveformCanvas) {
        // Mouse wheel zoom
        waveformCanvas.addEventListener('wheel', (e) => {
            e.preventDefault();
            
            const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
            if (!selected || !selected.audioBuffer) return;
            
            const zoom = audioState.waveformZoom;
            const rect = waveformCanvas.getBoundingClientRect();
            const canvasWidth = waveformCanvas.width;
            const mouseX = e.clientX - rect.left;
            const mouseXRatio = mouseX / canvasWidth;
            
            // Calculate zoom change
            const zoomDelta = e.deltaY > 0 ? 0.9 : 1.1;
            const newScale = Math.max(zoom.minScale, Math.min(zoom.maxScale, zoom.scale * zoomDelta));
            
            if (newScale !== zoom.scale) {
                // Adjust offset to zoom towards mouse position
                const oldVisibleWidth = canvasWidth / zoom.scale;
                const newVisibleWidth = canvasWidth / newScale;
                const oldMouseTime = (zoom.offsetX + mouseXRatio * oldVisibleWidth);
                const newOffsetX = oldMouseTime - mouseXRatio * newVisibleWidth;
                
                zoom.scale = newScale;
                zoom.offsetX = Math.max(0, Math.min(canvasWidth - newVisibleWidth, newOffsetX));
                
                // Update scrollbar
                updateWaveformScrollbar();
                
                // Redraw waveform with new zoom
                const playbackPosition = isPlaying ? (getAudioContext().currentTime - playbackStartTime) : -1;
                drawWaveform(getWaveformBuffer(selected), waveformCanvas, playbackPosition, -1);
            }
        });
        
        // Click to seek
        waveformCanvas.addEventListener('click', async (e) => {
            const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
            if (!selected || !selected.audioBuffer) return;
            
            const rect = waveformCanvas.getBoundingClientRect();
            const canvasWidth = waveformCanvas.width;
            const clickX = e.clientX - rect.left;
            const clickXRatio = clickX / canvasWidth;
            
            // Calculate time position based on zoom
            const zoom = audioState.waveformZoom;
            const duration = selected.audioBuffer.duration;
            const visibleDuration = duration / zoom.scale;
            const startTime = (zoom.offsetX / canvasWidth) * duration;
            const clickTime = startTime + (clickXRatio * visibleDuration);
            
            // Stop current playback if any
            if (currentSource) {
                currentSource.stop();
                currentSource = null;
                if (playbackInterval) {
                    clearInterval(playbackInterval);
                    playbackInterval = null;
                }
            }
            
            // Start playback from clicked position using the already-decoded buffer
            // If music was already playing, continue playing from the new position
            // If music was not playing, start playing from the clicked position
            try {
                const ctx = getAudioContext();
                const audioBuffer = selected.audioBuffer;
                
                currentSource = ctx.createBufferSource();
                currentSource.buffer = audioBuffer;
                currentSource.connect(ctx.destination);
                
                // Start from clicked position
                const startOffset = Math.max(0, Math.min(clickTime, audioBuffer.duration));
                playbackStartTime = ctx.currentTime - startOffset;
                playbackDuration = audioBuffer.duration;
                isPlaying = true;
                
                currentSource.start(0, startOffset);
                
                const btnPlayOriginal = document.getElementById('btnPlayOriginal');
                if (btnPlayOriginal) btnPlayOriginal.textContent = 'Stop';
                updatePlaybackProgress();
                
                // Update progress bar every 100ms
                playbackInterval = setInterval(updatePlaybackProgress, 25);
                
                currentSource.onended = () => {
                    //stopPlayback();
                    if (btnPlayOriginal) btnPlayOriginal.textContent = 'Play Original';
                };
            } catch (error) {
                console.error('Error playing audio from position:', error);
            }
        });
        
        // Mouse move to show hover indicator
        waveformCanvas.addEventListener('mousemove', (e) => {
            const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
            if (!selected || !selected.audioBuffer) return;
            
            const rect = waveformCanvas.getBoundingClientRect();
            const canvasWidth = waveformCanvas.width;
            const mouseX = e.clientX - rect.left;
            const mouseXRatio = mouseX / canvasWidth;
            
            // Calculate time position based on zoom
            const zoom = audioState.waveformZoom;
            const duration = selected.audioBuffer.duration;
            const visibleDuration = duration / zoom.scale;
            const startTime = (zoom.offsetX / canvasWidth) * duration;
            const hoverTime = startTime + (mouseXRatio * visibleDuration);
            
            // Redraw waveform with hover indicator (only if not playing)
            const playbackPosition = isPlaying ? (getAudioContext().currentTime - playbackStartTime) : -1;
            drawWaveform(getWaveformBuffer(selected), waveformCanvas, playbackPosition, hoverTime);
        });
        
        // Mouse leave to hide hover indicator
        waveformCanvas.addEventListener('mouseleave', () => {
            const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
            if (!selected || !selected.audioBuffer) return;
            
            // Redraw waveform without hover indicator
            const playbackPosition = isPlaying ? (getAudioContext().currentTime - playbackStartTime) : -1;
            drawWaveform(getWaveformBuffer(selected), waveformCanvas, playbackPosition, -1);
        });
    }
    
    // Scrollbar event listener
    const waveformScrollbar = document.getElementById('waveformScrollbar');
    if (waveformScrollbar && waveformCanvas) {
        waveformScrollbar.addEventListener('input', (e) => {
            const selected = audioState.files.find(f => f.id === audioState.selectedFileId);
            if (!selected || !selected.audioBuffer) return;
            
            const zoom = audioState.waveformZoom;
            const scrollValue = parseFloat(e.target.value);
            
            // Calculate new offset from scrollbar value
            const canvasWidth = waveformCanvas.width;
            const visibleWidth = canvasWidth / zoom.scale;
            const maxOffset = canvasWidth - visibleWidth;
            zoom.offsetX = (scrollValue / 100) * maxOffset;
            
            // Redraw waveform
            const playbackPosition = isPlaying ? (getAudioContext().currentTime - playbackStartTime) : -1;
            drawWaveform(getWaveformBuffer(selected), waveformCanvas, playbackPosition, -1);
        });
    }

    // Drag & Drop for audio files
    const audioCompressorContainer = document.getElementById('audioCompressorContainer');
    if (audioCompressorContainer) {
        audioCompressorContainer.ondragover = (e) => e.preventDefault();
        audioCompressorContainer.ondrop = (e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) {
                handleAudioFiles(e.dataTransfer.files);
            }
        };
    }
}

// Initialize audio component when loaded
// Use a listener that checks if audio component exists when the event fires
document.addEventListener('velo-ready', () => {
    if (document.getElementById('audioCompressorContainer')) {
        // Debug logging (can be removed for production)
        console.log('Audio component detected, setting up event listeners');
        setupAudioEventListeners();
        
        // Initial canvas resize with a short delay to ensure DOM is fully rendered
        const CANVAS_RESIZE_DELAY_MS = 100;
        setTimeout(resizeWaveformCanvas, CANVAS_RESIZE_DELAY_MS);
        
        // Add window resize listener
        window.addEventListener('resize', resizeWaveformCanvas);
    }
});
