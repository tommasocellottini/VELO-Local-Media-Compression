// --- File Handling ---

const state = {
    files: [], // Array of file objects { id, name, originalFile, originalUrl, compressedBlob, compressedUrl, quality, format, size, compressedSize, savings }
    selectedFileId: null,
    globalFormat: 'jpeg',
    maxWidth: null, // Null means original size
    showingOriginal: false,
    zoom: { scale: 1, x: 0, y: 0, isDragging: false, startX: 0, startY: 0 },
    isSliding: false, // For comparison slider interaction
    supportedFormats: { jpeg: true, png: true, webp: false, avif: false }
};

// Check browser support for formats
(function checkSupport() {
    const c = document.createElement('canvas');
    c.width = 1; c.height = 1;
    state.supportedFormats.webp = c.toDataURL('image/webp').startsWith('data:image/webp');
    state.supportedFormats.avif = c.toDataURL('image/avif').startsWith('data:image/avif');
})();

async function handleFiles(fileList) {
    const newFiles = Array.from(fileList).filter(f => f.type.startsWith('image/'));
    if (newFiles.length === 0) return;

    for (const file of newFiles) {
        // Avoid duplicates by name
        if (state.files.some(f => f.name === file.name)) continue;

        const fileEntry = {
            id: Math.random().toString(36).substr(2, 9),
            name: file.name,
            originalFile: file,
            originalUrl: URL.createObjectURL(file),
            size: file.size,
            quality: 65,
            simpleQuality: 65, // Memorizza la qualità manuale
            proQuality: null,  // Memorizza la qualità calcolata Pro
            format: state.globalFormat,
            layers: [], // Stores layer data: { quality, blob, mask, pixelCount }
            mode: 'simple', // Default all'avvio
            compressedBlob: null,
            compressedUrl: null,
            compressedSize: 0,
            savings: 0
        };

        state.files.push(fileEntry);
        if (!state.selectedFileId) state.selectedFileId = fileEntry.id;
        
        // Process (Compress)
        await processFile(fileEntry);
    }

    if(els.fileInput) els.fileInput.value = ''; // Reset input
    updateUI();
}

async function processFile(fileEntry, shouldUpdateUI = true) {
    let sourceImage;
    let width, height;
    let isResized = false;

    // 1. Source Selection (Original or Pre-processed Composite)
    // Usa la sorgente processata (composite) SOLO se siamo in modalità Pro
    if (fileEntry.mode === 'pro' && fileEntry.processedSource) {
        sourceImage = fileEntry.processedSource;
        width = sourceImage.width;
        height = sourceImage.height;
    } else {
        // Decodifica rapida con createImageBitmap
        try {
            sourceImage = await createImageBitmap(fileEntry.originalFile);
            width = sourceImage.width;
            height = sourceImage.height;
        } catch (e) {
            const img = new Image();
            img.src = fileEntry.originalUrl;
            await new Promise(r => img.onload = r);
            sourceImage = img;
            width = img.width;
            height = img.height;
        }
    }

    // 2. Calcolo dimensioni
    const originalWidth = width;
    const originalHeight = height;
    if (state.maxWidth && width > state.maxWidth) {
        const scaleFactor = state.maxWidth / width;
        width = state.maxWidth;
        height = Math.round(height * scaleFactor);
        isResized = true;
    }

    const mimeType = `image/${fileEntry.format === 'jpg' ? 'jpeg' : fileEntry.format}`;
    let blob = null;
    
    // Special handling for PNG: If not resizing and format unchanged, use original file
    // PNG compression in canvas doesn't optimize well and often increases size
    const originalFormat = fileEntry.originalFile.type.split('/')[1];
    // Normalize format comparison (jpeg vs jpg)
    const normalizedOriginal = originalFormat === 'jpg' ? 'jpeg' : originalFormat;
    const normalizedCurrent = fileEntry.format === 'jpg' ? 'jpeg' : fileEntry.format;
    const formatUnchanged = normalizedOriginal === normalizedCurrent;
    
    if (fileEntry.format === 'png' && !isResized && formatUnchanged && fileEntry.mode !== 'pro') {
        // Use original PNG if not resizing and not in Pro mode
        blob = fileEntry.originalFile;
    } else {
        // 3. Compressione (Tenta OffscreenCanvas per performance, fallback su DOM Canvas)
        // Use quality parameter for all formats
        const qualityParam = fileEntry.quality / 100;
        
        if (window.OffscreenCanvas) {
            try {
                const canvas = new OffscreenCanvas(width, height);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(sourceImage, 0, 0, width, height);
                blob = await canvas.convertToBlob({ type: mimeType, quality: qualityParam });
            } catch (e) { console.warn('OffscreenCanvas failed, using fallback', e); }
        }

        // Fallback standard (DOM Canvas)
        if (!blob) {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(sourceImage, 0, 0, width, height);
            blob = await new Promise(resolve => canvas.toBlob(resolve, mimeType, qualityParam));
        }
    }

    // Pulizia memoria bitmap
    // Don't close processedSource as it might be reused
    if (sourceImage instanceof ImageBitmap && sourceImage !== fileEntry.processedSource) sourceImage.close();

    if (blob) {
        if (fileEntry.compressedUrl) URL.revokeObjectURL(fileEntry.compressedUrl);

        // Rilevamento fallback formato (es. AVIF -> PNG)
        if (blob.type !== mimeType) {
            if (blob.type === 'image/png') fileEntry.format = 'png';
            else if (blob.type === 'image/jpeg') fileEntry.format = 'jpeg';
            else if (blob.type === 'image/webp') fileEntry.format = 'webp';
        }
        
        // Only use compressed file if it's smaller than original
        if (blob.size < fileEntry.size) {
            fileEntry.compressedBlob = blob;
            fileEntry.compressedUrl = URL.createObjectURL(blob);
            fileEntry.compressedSize = blob.size;
            fileEntry.savings = 100 - ((blob.size / fileEntry.size) * 100);
        } else {
            // Keep original file if compressed is larger
            fileEntry.compressedBlob = fileEntry.originalFile;
            fileEntry.compressedUrl = fileEntry.originalUrl;
            fileEntry.compressedSize = fileEntry.size;
            fileEntry.savings = 0;
        }

        if (shouldUpdateUI) updateUI();
    }
}

// --- Smart Optimization Logic ---

async function optimizeFile(fileEntry) {
    // Content-Aware Layers
    // We define layers by complexity/variance of the original pixels.
    // This allows the user to target specific image features (e.g., smooth backgrounds vs textures).
    
    // Initialize layers if not present
    if (!fileEntry.layers || fileEntry.layers.length === 0) {
        fileEntry.layers = [
            { name: "Smooth (Background)", threshold: 4, quality: 70, blob: null, mask: null, pixelCount: 0, format: fileEntry.format },
            { name: "Soft Texture", threshold: 12, quality: 60, blob: null, mask: null, pixelCount: 0, format: fileEntry.format },
            { name: "High Detail", threshold: 30, quality: 50, blob: null, mask: null, pixelCount: 0, format: fileEntry.format },
            { name: "Sharp Edges", threshold: 255, quality: 40, blob: null, mask: null, pixelCount: 0, format: fileEntry.format }
        ];
    } else if (fileEntry.layers[0].format !== fileEntry.format) {
        // Format changed, invalidate all blobs but keep masks
        fileEntry.layers.forEach(layer => {
            layer.blob = null;
            layer.format = fileEntry.format;
        });
    }

    await generateComposite(fileEntry);
}

async function generateComposite(fileEntry) {
    const mime = `image/${fileEntry.format === 'jpg' ? 'jpeg' : fileEntry.format}`;
    const fullBmp = await createImageBitmap(fileEntry.originalFile);
    const fullW = fullBmp.width;
    const fullH = fullBmp.height;
    
    const fullCvs = new OffscreenCanvas(fullW, fullH);
    const fullCtx = fullCvs.getContext('2d', { willReadFrequently: true });
    fullCtx.drawImage(fullBmp, 0, 0);
    const originalData = fullCtx.getImageData(0, 0, fullW, fullH).data;

    // 1. Analyze Content (Create Masks) - Only if not done yet
    // We check the first layer's mask. If it exists, we assume analysis is done.
    if (!fileEntry.layers[0].mask) {
        // Initialize masks
        fileEntry.layers.forEach(l => {
            l.mask = new Uint8Array(fullW * fullH); // 0 or 1
            l.pixelCount = 0;
        });

        const len = fullW * fullH;
        for (let y = 0; y < fullH; y++) {
            for (let x = 0; x < fullW; x++) {
                const idx = (y * fullW + x) * 4;
                
                // Calculate local variance/complexity (Simple Edge Detection)
                // Compare with right and bottom neighbors
                let diff = 0;
                if (x < fullW - 1) {
                    diff += Math.abs(originalData[idx] - originalData[idx + 4]) +
                            Math.abs(originalData[idx+1] - originalData[idx + 5]) +
                            Math.abs(originalData[idx+2] - originalData[idx + 6]);
                }
                if (y < fullH - 1) {
                    diff += Math.abs(originalData[idx] - originalData[idx + fullW * 4]) +
                            Math.abs(originalData[idx+1] - originalData[idx + fullW * 4 + 1]) +
                            Math.abs(originalData[idx+2] - originalData[idx + fullW * 4 + 2]);
                }
                diff /= 2; // Average difference

                // Assign to layer based on threshold
                for (let i = 0; i < fileEntry.layers.length; i++) {
                    if (diff <= fileEntry.layers[i].threshold) {
                        fileEntry.layers[i].mask[y * fullW + x] = 1;
                        fileEntry.layers[i].pixelCount++;
                        break;
                    }
                }
            }
        }
    }

    // 2. Generate Blobs & Data for all layers
    // We only generate blobs for layers that have pixels or if quality changed
    const layerDatas = new Array(fileEntry.layers.length).fill(null);
    const tempBitmaps = [];

    for (let i = 0; i < fileEntry.layers.length; i++) {
        const layer = fileEntry.layers[i];
        if (layer.pixelCount > 0) {
            if (!layer.blob) {
                layer.blob = await fullCvs.convertToBlob({ type: mime, quality: layer.quality / 100 });
            }
            const bmp = await createImageBitmap(layer.blob);
            tempBitmaps.push(bmp);
            fullCtx.clearRect(0, 0, fullW, fullH);
            fullCtx.drawImage(bmp, 0, 0);
            layerDatas[i] = fullCtx.getImageData(0, 0, fullW, fullH).data;
        }
    }

    // 3. Composite Final Image
    const finalImageData = fullCtx.createImageData(fullW, fullH);
    const dst = finalImageData.data;
    const len = fullW * fullH;

    for (let i = 0; i < len; i++) {
        // Find which layer owns this pixel
        for (let l = 0; l < fileEntry.layers.length; l++) {
            if (fileEntry.layers[l].mask[i] === 1 && layerDatas[l]) {
                const idx = i * 4;
                dst[idx] = layerDatas[l][idx];
                dst[idx+1] = layerDatas[l][idx+1];
                dst[idx+2] = layerDatas[l][idx+2];
                dst[idx+3] = 255; // Alpha
                break;
            }
        }
    }

    fullCtx.putImageData(finalImageData, 0, 0);

    // Cleanup
    fullBmp.close();
    tempBitmaps.forEach(b => b.close());
    
    // Store the composite as the new source for this file
    if (fileEntry.processedSource) fileEntry.processedSource.close();
    fileEntry.processedSource = await createImageBitmap(fullCvs);

    fileEntry.proQuality = 80; // Nominal quality
    await processFile(fileEntry, false); // Process without UI update to check size

    updateUI(); // Final UI update
}

async function updateLayerQuality(fileEntry, layerIndex, newQuality) {
    // Invalidate blob for this layer
    fileEntry.layers[layerIndex].quality = newQuality;
    fileEntry.layers[layerIndex].blob = null;
    
    // Re-run composite (will regenerate blob and re-calculate masks)
    // Note: Changing quality changes the error map, so pixels might move layers.
    await generateComposite(fileEntry);
}

async function mergeLayers(fileEntry, indices) {
    if (!fileEntry.layers || indices.length < 2) return;

    // Ordina decrescente per rimuovere senza alterare gli indici precedenti
    indices.sort((a, b) => b - a);

    // Il target è il layer più in basso (indice più alto tra quelli selezionati)
    const targetIndex = indices[0];
    const targetLayer = fileEntry.layers[targetIndex];

    // Unisci gli altri layer nel target
    for (let i = 1; i < indices.length; i++) {
        const sourceIndex = indices[i];
        const sourceLayer = fileEntry.layers[sourceIndex];

        // Merge mask (OR logico)
        for (let k = 0; k < sourceLayer.mask.length; k++) {
            if (sourceLayer.mask[k] === 1) {
                targetLayer.mask[k] = 1;
            }
        }
        targetLayer.pixelCount += sourceLayer.pixelCount;

        // Rimuovi il layer sorgente
        fileEntry.layers.splice(sourceIndex, 1);
    }

    targetLayer.name = "Merged Layer";
    targetLayer.blob = null; // Invalida blob per rigenerazione

    await generateComposite(fileEntry);
    updateUI();
}

async function resetLayers(fileEntry) {
    if (!fileEntry || fileEntry.mode !== 'pro') return;
    
    fileEntry.layers = []; // Clear existing layers
    // Invalidate processed source to force re-analysis
    if (fileEntry.processedSource) {
        fileEntry.processedSource.close();
        fileEntry.processedSource = null;
    }
    await optimizeFile(fileEntry); // Re-run the optimization to create fresh layers
}

async function switchFileMode(fileEntry, isPro) {
    fileEntry.mode = isPro ? 'pro' : 'simple';
    
    if (isPro) {
        // Se abbiamo già i dati Pro calcolati, usiamoli per evitare ricalcoli
        if (fileEntry.processedSource && fileEntry.proQuality) {
            fileEntry.quality = fileEntry.proQuality;
            await processFile(fileEntry);
        } else {
            await optimizeFile(fileEntry);
        }
    } else {
        // Passa a Simple: ripristina la qualità manuale e usa l'immagine originale
        fileEntry.quality = fileEntry.simpleQuality || 75;
        await processFile(fileEntry);
    }
}

function removeFile(id) {
    const idx = state.files.findIndex(f => f.id === id);
    if (idx > -1) {
        const f = state.files[idx];
        URL.revokeObjectURL(f.originalUrl);
        if (f.compressedUrl) URL.revokeObjectURL(f.compressedUrl);
        state.files.splice(idx, 1);
        
        if (state.selectedFileId === id) {
            state.selectedFileId = state.files.length > 0 ? state.files[0].id : null;
        }
        updateUI();
    }
}

function clearAll() {
    state.files.forEach(f => {
        URL.revokeObjectURL(f.originalUrl);
        if (f.compressedUrl) URL.revokeObjectURL(f.compressedUrl);
    });
    state.files = [];
    state.selectedFileId = null;
    updateUI();
}
