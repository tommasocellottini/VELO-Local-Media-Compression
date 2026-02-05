// --- UI Rendering ---

function updateUI() {
    // Toggle Views (Init vs App)
    if (state.files.length === 0) {
        if(els.initOverlay) els.initOverlay.classList.remove('d-none');
        if(els.appInterface) {
            els.appInterface.classList.add('d-none');
            els.appInterface.classList.remove('d-flex');
        }
    } else {
        if(els.initOverlay) els.initOverlay.classList.add('d-none');
        if(els.appInterface) {
            els.appInterface.classList.remove('d-none');
            els.appInterface.classList.add('d-flex');
        }
    }

    if(els.filesCountLabel) els.filesCountLabel.textContent = `SELECTED FILES (${state.files.length})`;
    renderFileList();
    renderPreview();
}

function renderFileList() {
    if(!els.fileListContainer) return;
    els.fileListContainer.innerHTML = '';
    
    state.files.forEach(file => {
        const isSelected = file.id === state.selectedFileId;
        const isPng = file.format === 'png';
        const div = document.createElement('div');
        div.className = `file-item p-2 mb-2 rounded ${isSelected ? 'active border border-2 border-primary shadow-glow-blue' : 'border border-secondary'}`;
        div.style.cursor = 'pointer';
        div.onclick = () => { state.selectedFileId = file.id; updateUI(); };

        const savingsText = file.savings >= 0 ? `-${file.savings.toFixed(1)}%` : `+${Math.abs(file.savings).toFixed(1)}%`;
        // Treat 0 or positive savings as success (green), negative as failure (red)
        const savingsClass = file.savings < 0 ? 'text-danger' : 'text-success';

        div.innerHTML = `
            <div class="d-flex justify-content-between align-items-start mb-2">
                <div class="text-truncate max-w-75">
                    <div class="text-white fw-bold small">${file.name}</div>
                    <div class="mt-1">
                        <small class="">Before: ${formatSize(file.size)}</small>
                        <small class="${savingsClass} fw-bold ms-2">After: ${formatSize(file.compressedSize)} (${savingsText})</small>
                    </div>
                </div>
                <div class="d-flex gap-2">
                    <button class="btn btn-sm text-primary p-1 btn-download" title="Download">
                        <svg xmlns="http://www.w3.org/2000/svg" style="width:25px; height:25px" viewBox="0 0 640 640" class="icon-lg"><path d="M352 96C352 78.3 337.7 64 320 64C302.3 64 288 78.3 288 96L288 306.7L246.6 265.3C234.1 252.8 213.8 252.8 201.3 265.3C188.8 277.8 188.8 298.1 201.3 310.6L297.3 406.6C309.8 419.1 330.1 419.1 342.6 406.6L438.6 310.6C451.1 298.1 451.1 277.8 438.6 265.3C426.1 252.8 405.8 252.8 393.3 265.3L352 306.7L352 96zM160 384C124.7 384 96 412.7 96 448L96 480C96 515.3 124.7 544 160 544L480 544C515.3 544 544 515.3 544 480L544 448C544 412.7 515.3 384 480 384L433.1 384L376.5 440.6C345.3 471.8 294.6 471.8 263.4 440.6L206.9 384L160 384zM464 440C477.3 440 488 450.7 488 464C488 477.3 477.3 488 464 488C450.7 488 440 477.3 440 464C440 450.7 450.7 440 464 440z" /></svg>
                    </button>
                    <button class="btn btn-sm text-primary p-1 btn-reset" title="Reset Quality">
                        <svg xmlns="http://www.w3.org/2000/svg" style="width:20px; height:20px" viewBox="0 0 512 512" class="icon-md"><path d="M48.5 224H40c-13.3 0-24-10.7-24-24V72c0-9.7 5.8-18.5 14.8-22.2s19.3-1.7 26.2 5.2L98.6 96.6c87.6-86.5 228.7-86.2 315.8 1c87.5 87.5 87.5 229.3 0 316.8s-229.3 87.5-316.8 0c-12.5-12.5-12.5-32.8 0-45.3s32.8-12.5 45.3 0c62.5 62.5 163.8 62.5 226.3 0s62.5-163.8 0-226.3c-62.2-62.2-162.7-62.5-225.3-1L185 183c6.9 6.9 8.9 17.2 5.2 26.2s-12.5 14.8-22.2 14.8H48.5z" /></svg>
                    </button>
                    <button class="btn btn-sm text-danger p-1 btn-remove" title="Remove">
                        <svg xmlns="http://www.w3.org/2000/svg" style="width:25px; height:25px" viewBox="0 0 384 512" class="icon-lg"><path d="M342.6 150.6c12.5-12.5 12.5-32.8 0-45.3s-32.8-12.5-45.3 0L192 210.7 86.6 105.4c-12.5-12.5-32.8-12.5-45.3 0s-12.5 32.8 0 45.3L146.7 256 41.4 361.4c-12.5 12.5-12.5 32.8 0 45.3s32.8 12.5 45.3 0L192 301.3 297.4 406.6c12.5 12.5 32.8 12.5 45.3 0s12.5-32.8 0-45.3L237.3 256 342.6 150.6z" /></svg>
                    </button>
                </div>
            </div>
            <div class="d-flex justify-content-between align-items-center border-top border-secondary pt-2 mt-1">
                <select class="form-select form-select-sm text-white border-normal select-xs p-0 ps-1 file-format" style="background-color: transparent; ">
                    <option value="jpeg" ${file.format === 'jpeg' ? 'selected' : ''}>JPG</option>
                    <option value="webp" ${file.format === 'webp' ? 'selected' : ''} ${!state.supportedFormats.webp ? 'disabled' : ''}>WEBP${!state.supportedFormats.webp ? ' (N/A)' : ''}</option>
                    <option value="png" ${file.format === 'png' ? 'selected' : ''}>PNG</option>
                    <option value="avif" ${file.format === 'avif' ? 'selected' : ''} ${!state.supportedFormats.avif ? 'disabled' : ''}>AVIF${!state.supportedFormats.avif ? ' (N/A)' : ''}</option>
                </select>
                <div class="d-flex gap-2">
                    <button class="btn btn-sm fw-bold file-mode-auto ${file.mode === 'simple' ? 'btn-warning shadow-glow-yellow' : 'btn-outline-warning'}" style="width: 70px; font-size: 0.7rem; padding: 0.1rem 0.5rem;" title="Automatic global quality.">
                        Auto
                    </button>
                    <button class="btn btn-sm fw-bold file-mode-manual ${file.mode === 'pro' ? 'btn-warning shadow-glow-yellow' : 'btn-outline-warning'}" style="width: 70px; font-size: 0.7rem; padding: 0.1rem 0.5rem;" title="Manual layer-based optimization.">
                        Manual
                    </button>
                </div>
            </div>
            <div class="d-flex align-items-center gap-2 mt-2">
                <div class="d-flex align-items-center flex-grow-1 gap-1 ${file.mode === 'pro' ? 'opacity-25' : ''}">
                    <input type="range" class="form-range file-quality" min="1" max="100" step="1" value="${file.mode === 'simple' ? file.quality : (file.simpleQuality || 75)}" ${isPng || file.mode === 'pro' ? 'disabled' : ''}>
                </div>
                <span class="badge bg-primary badge-xs">${isPng ? 'Lossless' : file.quality + '%'}</span>
            </div>
        `;

        // Bind Item Events
        div.querySelector('.btn-remove').onclick = (e) => { e.stopPropagation(); removeFile(file.id); };
        div.querySelector('.btn-reset').onclick = (e) => { 
            e.stopPropagation(); 
            file.quality = 75; 
            state.selectedFileId = file.id;
            processFile(file); 
        };
        div.querySelector('.btn-download').onclick = (e) => {
            e.stopPropagation();
            downloadSingle(file);
        };
        
        const btnAuto = div.querySelector('.file-mode-auto');
        const btnManual = div.querySelector('.file-mode-manual');

        btnAuto.onclick = async (e) => {
            e.stopPropagation();
            if (file.mode === 'simple') return;
            btnAuto.disabled = true;
            btnManual.disabled = true;
            await switchFileMode(file, false); // isPro = false
        };

        btnManual.onclick = async (e) => {
            e.stopPropagation();
            if (file.mode === 'pro') return;
            btnAuto.disabled = true;
            btnManual.disabled = true;
            await switchFileMode(file, true); // isPro = true
        };

        const formatSel = div.querySelector('.file-format');
        formatSel.onclick = (e) => e.stopPropagation();
        formatSel.onchange = (e) => { file.format = e.target.value; processFile(file); };

        const qualityRange = div.querySelector('.file-quality');
        qualityRange.onclick = (e) => e.stopPropagation();
        qualityRange.oninput = (e) => { 
            if (file.mode === 'pro') return;
            file.quality = parseInt(e.target.value); 
            file.simpleQuality = file.quality; // Aggiorna la memoria Simple
            div.querySelector('.badge').textContent = file.quality + '%';
        };
        qualityRange.onchange = (e) => {
            if (file.mode === 'pro') return;
            processFile(file);
        };

        els.fileListContainer.appendChild(div);
    });
}

function renderLayerPanel(file) {
    const panel = document.getElementById('layerPanel');
    
    if (!file || file.mode !== 'pro' || !file.layers) {
        panel.classList.add('d-none');
        return;
    }

    panel.classList.remove('d-none');
    
    // Ricostruisce l'header del pannello con il bottone Merge
    panel.innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-2">
            <h6 class="text-white small m-0">Manual Mode Layers</h6>
            <div class="d-flex gap-2">
                <button id="btnResetLayers" class="btn btn-secondary btn-sm py-0" style="font-size: 0.75rem; width: 60px;" title="Reset layers to their original state">Reset</button>
                <button id="btnMergeLayers" class="btn btn-primary btn-sm py-0" style="font-size: 0.75rem; width: 60px;" disabled>Merge</button>
            </div>
        </div>
        <div id="layerList" class="d-flex flex-column gap-1"></div>
    `;

    const list = document.getElementById('layerList');
    const btnMerge = document.getElementById('btnMergeLayers');
    const btnReset = document.getElementById('btnResetLayers');

    btnReset.onclick = () => {
        resetLayers(file);
    };
    
    // Gestione click Merge
    btnMerge.onclick = () => {
        const checkboxes = list.querySelectorAll('.layer-checkbox');
        const indices = [];
        checkboxes.forEach((cb, idx) => {
            if (cb.checked) indices.push(idx);
        });
        mergeLayers(file, indices);
    };

    const updateMergeButton = () => {
        const checkedCount = list.querySelectorAll('.layer-checkbox:checked').length;
        btnMerge.disabled = checkedCount < 2;
    };

    list.innerHTML = '';

    file.layers.forEach((layer, index) => {
        const div = document.createElement('div');
        div.className = 'layer-item p-2 rounded d-flex flex-column gap-1';
        
        // Calculate percentage of image covered
        const totalPixels = file.processedSource ? (file.processedSource.width * file.processedSource.height) : 1;
        const coverage = ((layer.pixelCount / totalPixels) * 100).toFixed(1);

        div.innerHTML = `
            <div class="d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center gap-2 text-truncate" style="max-width: 70%;">
                    <input type="checkbox" class="form-check-input layer-checkbox m-0" style="width: 14px; height: 14px; cursor: pointer;">
                    <span class="small fw-bold text-white text-truncate" title="${layer.name}">${layer.name || 'Layer ' + (index + 1)}</span>
                </div>
                <span class="badge bg-secondary badge-xs">${coverage}%</span>
            </div>
            <div class="d-flex align-items-center gap-2">
                <input type="range" class="form-range layer-quality" min="10" max="100" step="5" value="${layer.quality}">
                <span class="small text-white-50" style="width: 30px; text-align: right;">${layer.quality}%</span>
            </div>
        `;

        // Highlight on hover
        div.onmouseenter = () => highlightLayer(file, index, true);
        div.onmouseleave = () => highlightLayer(file, index, false);
        
        // Checkbox logic
        const checkbox = div.querySelector('.layer-checkbox');
        checkbox.onclick = (e) => {
            e.stopPropagation();
            updateMergeButton();
        };

        // Quality Change
        const range = div.querySelector('.layer-quality');
        range.onchange = async (e) => {
            const val = parseInt(e.target.value);
            div.style.opacity = '0.5'; // Loading state
            await updateLayerQuality(file, index, val);
            div.style.opacity = '1';
        };
        range.oninput = (e) => div.querySelector('span.text-white-50').textContent = e.target.value + '%';

        list.appendChild(div);
    });
}

function renderPreview() {
    const file = state.files.find(f => f.id === state.selectedFileId);
    if (!file) {
        if(els.previewStage) els.previewStage.classList.add('d-none');
        return;
    }

    if(els.previewStage) els.previewStage.classList.remove('d-none');
    
    // Only update src if changed to prevent flickering
    if (els.imgOriginal && els.imgOriginal.src !== file.originalUrl) {
        els.imgOriginal.src = file.originalUrl;
        resetZoom();
    }
    // Always update optimized as it changes often
    if (els.imgOptimized && file.compressedUrl) els.imgOptimized.src = file.compressedUrl;

    renderLayerPanel(file);
}

function highlightLayer(file, layerIndex, show) {
    if (!els.veloContainer || !file.layers) return;
    
    // Remove existing highlight
    const existing = document.getElementById('layerHighlight');
    if (existing) existing.remove();

    if (!show) return;

    // Create highlight canvas overlay
    const canvas = document.createElement('canvas');
    canvas.id = 'layerHighlight';
    canvas.style.position = 'absolute';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.pointerEvents = 'none'; // Pass through clicks
    canvas.style.zIndex = '50';
    canvas.style.opacity = '0.6';
    
    // Match dimensions of the image in the zoom frame
    const img = els.imgOptimized;
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    canvas.className = 'frame-img'; // Inherit zoom transform

    const ctx = canvas.getContext('2d');
    const mask = file.layers[layerIndex].mask;
    const idata = ctx.createImageData(canvas.width, canvas.height);
    const d = idata.data;

    for (let i = 0; i < mask.length; i++) {
        if (mask[i] === 1) {
            const idx = i * 4;
            d[idx] = 0;   // R
            d[idx+1] = 255; // G (Green highlight)
            d[idx+2] = 0;   // B
            d[idx+3] = 150; // Alpha
        }
    }
    ctx.putImageData(idata, 0, 0);
    
    document.getElementById('zoomFrame').appendChild(canvas);
}
