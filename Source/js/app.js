// DOM Elements cache
const els = {};

const initApp = () => {
    // Cache elements by ID
    const ids = [
        'imageCompressorContainer', 'audioCompressorContainer', 'videoCompressorContainer',
        'fileInput', 'initOverlay', 'appInterface',
        'fileListContainer', 'previewStage', 'imgOriginal', 'imgOptimized',
        'zoomFrame', 'veloContainer', 'filesCountLabel', 'privacyDate',
        'btnAbout', 'modalAbout', 'backdropAbout', 'btnCloseAbout',
        'modalPrivacy', 'backdropPrivacy', 'btnClosePrivacy', 'linkPrivacy',
        'btnSelectImages', 'btnAddImg', 'globalFormat', 'globalMaxWidth', 'btnClear', 'btnZip',
        'btnResetZoom', 'compareSlider', 'compareOverlay'
    ];

    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) els[id] = el;
    });

    // Set Date
    if (els.privacyDate) {
        els.privacyDate.textContent = new Date().toLocaleDateString('en-US', { month: 'long', day: '2-digit', year: 'numeric' });
    }

    setupEventListeners();
};

document.addEventListener('DOMContentLoaded', initApp);
document.addEventListener('velo-ready', initApp);

function setupEventListeners() {
    // Modals Helper
    const toggle = (id, show) => {
        const el = document.getElementById(id);
        if (el) show ? el.classList.remove('d-none') : el.classList.add('d-none');
    };

    // About Modal
    if (els.btnAbout) els.btnAbout.onclick = () => toggle('modalAbout', true);
    if (els.backdropAbout) els.backdropAbout.onclick = () => toggle('modalAbout', false);
    if (els.btnCloseAbout) els.btnCloseAbout.onclick = () => toggle('modalAbout', false);

    // Privacy Modal
    if (els.linkPrivacy) els.linkPrivacy.onclick = (e) => { e.preventDefault(); toggle('modalPrivacy', true); };
    if (els.backdropPrivacy) els.backdropPrivacy.onclick = () => toggle('modalPrivacy', false);
    if (els.btnClosePrivacy) els.btnClosePrivacy.onclick = () => toggle('modalPrivacy', false);

    // File Input & Selection - Only set up if audio component is NOT active
    // Audio component has its own event handlers in appAudio.js
    const isAudioComponent = document.getElementById('audioCompressorContainer') !== null;
    if (!isAudioComponent) {
        if (els.btnSelectImages) els.btnSelectImages.onclick = () => els.fileInput.click();
        if (els.btnAddImg) els.btnAddImg.onclick = () => els.fileInput.click();
        if (els.fileInput) els.fileInput.onchange = (e) => handleFiles(e.target.files);
    }

    // Drag & Drop
    // Prevent adding duplicate global listeners if initApp runs multiple times
    if (!window.hasGlobalDragListeners) {
        window.addEventListener('dragover', (e) => e.preventDefault(), false);
        window.addEventListener('drop', (e) => e.preventDefault(), false);
        window.hasGlobalDragListeners = true;
    }

    if (els.dropZone) {
        els.dropZone.ondragover = (e) => { e.preventDefault(); els.dropZone.classList.add('border-primary'); };
        els.dropZone.ondragleave = () => els.dropZone.classList.remove('border-primary');
        els.dropZone.ondrop = (e) => {
            e.preventDefault();
            els.dropZone.classList.remove('border-primary');
            if (e.dataTransfer.files.length > 0) handleFiles(e.dataTransfer.files);
        };
    }

    // Global Actions
    if (els.btnClear) els.btnClear.onclick = clearAll;
    if (els.btnZip) els.btnZip.onclick = downloadZip;
    if (els.globalFormat) els.globalFormat.onchange = (e) => {
        state.globalFormat = e.target.value;
        state.files.forEach(f => {
            f.format = state.globalFormat;
            processFile(f);
        });
    };
    if (els.globalMaxWidth) els.globalMaxWidth.oninput = (e) => {
        const val = parseInt(e.target.value);
        state.maxWidth = (val > 0) ? val : null;
        // Debounce could be added here for performance, but for now direct update:
        state.files.forEach(f => {
            processFile(f);
        });
    };

    // Zoom Controls
    if (els.btnResetZoom) els.btnResetZoom.onclick = resetZoom;

    // Comparison Slider (only available in Image Compressor component)
    if (typeof setupComparisonSlider !== 'undefined') {
        setupComparisonSlider();
    }

    // Zoom Interaction (Pan & Wheel)
    if (els.veloContainer) {
        els.veloContainer.onwheel = handleWheel;
        els.veloContainer.onmousedown = startDrag;

        // Remove existing listeners before adding to avoid duplicates
        window.removeEventListener('mousemove', drag);
        window.removeEventListener('mouseup', stopDrag);

        window.addEventListener('mousemove', drag);
        window.addEventListener('mouseup', stopDrag);
    }

    function loadComponent(componentUrl) {
        console.log(`Tentativo di caricamento: ${componentUrl}`);
        fetch(componentUrl)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`Could not load ${componentUrl}: ${response.statusText}`);
                }
                return response.text();
            })
            .then(html => {
                console.log("HTML ricevuto con successo");

                const placeholder = document.getElementById('component-placeholder');
                const selector = document.getElementById('serviceSelector');

                if (selector) selector.classList.add('d-none');
                if (placeholder) {
                    placeholder.innerHTML = html;
                    console.log("Componente iniettato nel placeholder"); // DEBUG
                } else {
                    console.error("ERRORE: #component-placeholder non trovato!");
                }

                // document.getElementById('serviceSelector').classList.add('hidden');
                document.dispatchEvent(new Event('velo-ready'));
            })
            .catch(err => {
                console.error('Failed to load component:', err);
                const selector = document.getElementById('serviceSelector');
                const placeholder = document.getElementById('component-placeholder');

                // Hide selector to show error clearly
                if (selector) selector.classList.add('d-none');

                if (placeholder) {
                    placeholder.innerHTML = `
                            <div class="d-flex flex-column justify-content-center align-items-center vh-100 text-center text-danger">
                                <h3 class="mb-3">⚠️ Error Loading Component</h3>
                                <p class="lead">Browsers block loading external files when opening HTML directly via <code>file://</code>.</p>
                                <p class="text-white-50">Please serve this project using a local web server (e.g., VS Code Live Server).</p>
                                <button class="btn btn-outline-light mt-3" onclick="location.reload()">Reload</button>
                            </div>
                        `;
                }
            });
    }

    document.getElementById('btnHome').addEventListener('click', () => {
        const placeholder = document.getElementById('component-placeholder');
        const selector = document.getElementById('serviceSelector');

        if (placeholder) {
            placeholder.innerHTML = "";
            console.log("Componente iniettato nel placeholder"); // DEBUG
        } else {
            console.error("ERRORE: #component-placeholder non trovato!");
        }

        if (selector) selector.classList.remove('d-none');
        // document.getElementById('serviceSelector').classList.remove('hidden');
    });

    document.getElementById('btnLoadImageCompressor').addEventListener('click', () => {
        loadComponent('components/ImageCompressor.html');
    });
    
    document.getElementById('btnLoadAudioCompressor').addEventListener('click', () => {
        loadComponent('components/AudioCompressor.html');
    });
}

// Comparison Slider Functionality
function setupComparisonSlider() {
    if (!els.compareSlider || !els.compareOverlay) return;

    const slider = els.compareSlider;
    const overlay = els.compareOverlay;

    const startSliding = (e) => {
        state.isSliding = true;
        e.preventDefault();
        e.stopPropagation();
    };

    const slide = (e) => {
        if (!state.isSliding) return;
        
        const container = els.zoomFrame;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        let x = e.clientX - rect.left;
        
        // Clamp between 0 and width
        x = Math.max(0, Math.min(x, rect.width));
        
        const percentage = (x / rect.width) * 100;
        
        slider.style.left = percentage + '%';
        overlay.style.width = percentage + '%';
    };

    const stopSliding = () => {
        state.isSliding = false;
    };

    // Mouse events
    slider.addEventListener('mousedown', startSliding);
    window.addEventListener('mousemove', slide);
    window.addEventListener('mouseup', stopSliding);

    // Touch events for mobile
    slider.addEventListener('touchstart', (e) => {
        state.isSliding = true;
        e.preventDefault();
        e.stopPropagation();
    });

    window.addEventListener('touchmove', (e) => {
        if (!state.isSliding) return;
        
        const touch = e.touches[0];
        const container = els.zoomFrame;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        let x = touch.clientX - rect.left;
        
        x = Math.max(0, Math.min(x, rect.width));
        const percentage = (x / rect.width) * 100;
        
        slider.style.left = percentage + '%';
        overlay.style.width = percentage + '%';
    });

    window.addEventListener('touchend', stopSliding);
}
