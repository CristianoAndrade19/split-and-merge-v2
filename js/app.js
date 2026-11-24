// @ts-check
/// <reference path="./types.js" />

(function () {
  'use strict';

  const Geo = window.SplitMergeGeometry;
  const Ops = window.SplitMergeImageOps;
  const Seam = window.SplitMergeSeam;
  const SkinPost = window.SplitMergeSkinPost;
  const Prompts = window.SplitMergePrompts;
  const Storage = window.SplitMergeStorage;
  const ViewportClass = window.SplitMergeViewport;

  /**
   * 7 Obsidian (Black + Accent) curated themes.
   */
  const THEMES = [
    { id: 'obsidian-cyan', name: 'Preto + Ciano', sub: 'Neon Clássico', accent: '#22d3ee', accent2: '#10b981', themeColor: '#000000' },
    { id: 'obsidian-emerald', name: 'Preto + Esmeralda', sub: 'Precisão Verde', accent: '#34d399', accent2: '#22d3ee', themeColor: '#000000' },
    { id: 'obsidian-violet', name: 'Preto + Violeta', sub: 'Estúdio Púrpura', accent: '#a78bfa', accent2: '#ec4899', themeColor: '#000000' },
    { id: 'obsidian-crimson', name: 'Preto + Carmesim', sub: 'Rubi Intenso', accent: '#fb7185', accent2: '#f59e0b', themeColor: '#000000' },
    { id: 'obsidian-amber', name: 'Preto + Âmbar', sub: 'Ouro Quente', accent: '#fbbf24', accent2: '#fb923c', themeColor: '#000000' },
    { id: 'obsidian-sunset', name: 'Preto + Magenta', sub: 'Coral Elétrico', accent: '#f472b6', accent2: '#fb923c', themeColor: '#000000' },
    { id: 'obsidian-mono', name: 'Preto + Prata', sub: 'Minimalista Puro', accent: '#f4f4f5', accent2: '#a1a1aa', themeColor: '#000000' },
  ];

  /** @type {AppSettings} */
  const DEFAULT_SETTINGS = {
    theme: 'obsidian-cyan',
    precisionDefaultMobile: true,
    precisionSensitivity: 0.35,
    loupeZoom: 3.0,
    loupeSize: 132,
    autoSaveHistory: true,
  };

  function generateProjectId() {
    return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  // ===========================================================================
  // Application State
  // ===========================================================================
  const state = {
    /** @type {'studio' | 'history' | 'settings'} */
    activeView: 'studio',
    /** @type {'all' | 'in_progress' | 'completed'} */
    historyFilter: 'all',
    /** @type {1 | 2 | 3 | 4 | 5 | 6} */
    activeStep: 1,
    showGuides: true,
    targetDataFolder: '4',
    step6Subtab: 'engine', // 'engine' | 'fine' | 'samples'
    precisionCut: false,
    /** @type {AppSettings} */
    appSettings: { ...DEFAULT_SETTINGS },
    currentProjectId: generateProjectId(),
    currentProjectName: '',
    currentProjectCreatedAt: Date.now(),

    // --- Step 1: imagem1 (Cortar e isolar corpo + definir Corpo vs Face fixo) ---
    /** @type {LoadedImage | null} */
    img1: null,
    /** @type {HTMLCanvasElement | null} */
    img1Canvas: null,
    /** @type {SelectionShape | null} */
    selection1: null,
    /** @type {{ selection: SelectionShape, rawMask: Uint8Array | null, faceIsOne: boolean } | null} */
    prevSelection1: null,
    /** @type {Uint8Array | null} */
    rawMask1: null,
    faceIsOne1: true,
    /** @type {Uint8Array | null} */
    faceMask1: null,
    /** @type {Float32Array | null} */
    edtFace1OutSq: null,
    /** @type {Float32Array | null} */
    edtFace1InSq: null,
    /** @type {HTMLCanvasElement | null} */
    corpo1Canvas: null,
    /** @type {HTMLCanvasElement | null} */
    face1Canvas: null,
    /** @type {HTMLCanvasElement | null} */
    mask1OverlayCanvas: null,
    faceCentroid1: { x: 0, y: 0, count: 0 },
    bodyCentroid1: { x: 0, y: 0, count: 0 },
    /** @type {'split' | 'body' | 'face'} */
    step1View: 'split',
    /** @type {'cut' | 'pan'} */
    step1Tool: 'cut',

    // --- Step 2: imagem2 (Padding transparente + ajuste manual + isolar face) ---
    /** @type {LoadedImage | null} */
    img2: null,
    /** @type {LayerTransform} */
    img2Transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    img2OnionOpacity: 0.35,
    showAnatomicGuides: false,
    flickerActive: false,
    /** @type {{ eye1L: Point | null, eye1R: Point | null, eye2L: Point | null, eye2R: Point | null }} */
    eyeCalib: { eye1L: null, eye1R: null, eye2L: null, eye2R: null },
    /** @type {HTMLCanvasElement | null} */
    img2AlignedCanvas: null,
    /** @type {ReturnType<typeof Ops.computeFittedPlacement> | null} */
    img2Placement: null,
    /** @type {HTMLCanvasElement | null} */
    face2Canvas: null,
    /** @type {'align' | 'face' | 'split'} */
    step2View: 'align',

    // --- Step 3: imagemMerge (Unir corpo + face & isolar face+bordas imprecisas / corpo sem bordas) ---
    /** @type {HTMLCanvasElement | null} */
    imgMergeCanvas: null,
    /** @type {'expand' | 'custom'} */
    mergeRegionMode: 'expand',
    expandPx: 36,
    /** @type {SelectionShape | null} */
    customSelection2: null,
    /** @type {{ selection: SelectionShape, rawMask: Uint8Array | null, faceIsOne: boolean } | null} */
    prevCustomSelection2: null,
    /** @type {Uint8Array | null} */
    customRawMask2: null,
    customFaceIsOne2: true,
    customExtraExpandPx: 0,
    /** @type {Float32Array | null} */
    edtCustomOutSq: null,
    /** @type {Float32Array | null} */
    edtCustomInSq: null,
    /** @type {Uint8Array | null} */
    mergeFaceMask: null,
    /** @type {Float32Array | null} */
    edtMergeInsideSq: null,
    /** @type {RectBox | null} */
    mergeFaceBox: null,
    exportCroppedMode: false,
    /** @type {HTMLCanvasElement | null} */
    faceImprecisaCanvas: null,
    /** @type {HTMLCanvasElement | null} */
    corpoSemBordasCanvas: null,
    /** @type {HTMLCanvasElement | null} */
    mergeOverlayCanvas: null,
    mergeFaceCentroid: { x: 0, y: 0, count: 0 },
    mergeBodyCentroid: { x: 0, y: 0, count: 0 },
    /** @type {'split' | 'face-imp' | 'body-clean'} */
    step3View: 'split',
    /** @type {'cut' | 'pan'} */
    step3Tool: 'cut',

    // --- Step 4: IA + (face + bordas imprecisas) = (face + bordas precisas) ---
    /** @type {LoadedImage | null} */
    imgRefined: null,
    /** @type {'full' | 'cropbox'} */
    refinedTargetMode: 'full',
    /** @type {LayerTransform} */
    refinedTransform: { x: 0, y: 0, scale: 1 },
    refinedOnionOpacity: 0.32,
    /** @type {HTMLCanvasElement | null} */
    refinedAlignedCanvas: null,
    /** @type {ReturnType<typeof Ops.computeFittedPlacement> | null} */
    refinedPlacement: null,
    /** @type {HTMLCanvasElement | null} */
    facePrecisaCanvas: null,
    /** @type {'align' | 'isolated'} */
    step4View: 'align',

    // --- Step 5: (face + bordas precisas) + (corpo sem bordas imprecisas) = imagemFinal ---
    /** @type {FinalMergeOptions} */
    finalMerge: {
      mode: 'none',
      radiusPx: 28,
      colorMatchStrength: 0,
      prioritizeSkin: true,
      poissonReach: 0.75,
      protectCoreFace: true,
    },
    /** @type {HTMLCanvasElement | null} */
    imgFinalUnblendedCanvas: null,
    /** @type {HTMLCanvasElement | null} */
    imgFinalCanvas: null,
    /** @type {'final' | 'compare-raw' | 'compare-merge' | 'compare-img1'} */
    step5View: 'final',
    compareRatio: 0.5,

    // --- Step 6: Pós-Processamento — Igualar Tom de Pele (Face × Corpo) ---
    /** @type {SkinPostOptions} */
    skinPost: {
      enabled: true,
      method: 'oklab_ot',
      direction: 'face_to_body',
      strength: 1.0,
      lumaMatch: 0.88,
      chromaMatch: 1.0,
      maskSelectivity: 0.72,
      protectFeatures: true,
      seamEqualizePx: 36,
      borderMatchStrength: 0.9,
      borderMutualMeet: true,
      tempOffset: 0,
      tintOffset: 0,
      lightOffset: 0,
      satScale: 1.0,
    },
    /** @type {Point[]} */
    skinSamplesFace: [],
    /** @type {Point[]} */
    skinSamplesBody: [],
    /** @type {'pan' | 'sample-face' | 'sample-body'} */
    step6Tool: 'pan',
    /** @type {'post' | 'compare-pre' | 'compare-raw' | 'compare-img1' | 'skin-mask'} */
    step6View: 'post',
    /** @type {HTMLCanvasElement | null} */
    imgPostCanvas: null,
    /** @type {HTMLCanvasElement | null} */
    skinMaskPreviewCanvas: null,
    /** @type {SkinDiagnostics | null} */
    skinDiagnostics: null,
  };

  /** Lazy recomputation dirty flags — avoids cascading expensive steps during live drags */
  const dirtySteps = {
    2: false,
    3: false,
    4: false,
    5: false,
    6: false,
    step3RebuildBase: true,
  };

  function markDirtyFrom(startStep, rebuildMergeBase = true) {
    for (let s = startStep; s <= 6; s++) {
      dirtySteps[s] = true;
    }
    if (startStep <= 3 && rebuildMergeBase) {
      dirtySteps.step3RebuildBase = true;
    }
  }

  /**
   * Replaces a canvas property on state while freeing GPU/backing memory of the replaced canvas.
   * @param {keyof typeof state} key
   * @param {HTMLCanvasElement | null} nextCanvas
   */
  function setStateCanvas(key, nextCanvas) {
    const prev = /** @type {HTMLCanvasElement | null} */ (state[key]);
    if (prev && prev !== nextCanvas && prev !== state.img1Canvas && prev !== state.imgFinalUnblendedCanvas) {
      Ops.releaseCanvas(prev);
    }
    // @ts-ignore - controlled canvas state keys
    state[key] = nextCanvas;
  }

  // ===========================================================================
  // DOM References & Viewport Initialization
  // ===========================================================================
  const mainCanvas = /** @type {HTMLCanvasElement} */ (document.getElementById('mainCanvas'));
  const canvasDropWrap = /** @type {HTMLElement} */ (document.getElementById('canvasDropWrap'));
  const stepperNav = /** @type {HTMLElement} */ (document.getElementById('stepperNav'));
  const stageModeToolbar = /** @type {HTMLElement} */ (document.getElementById('stageModeToolbar'));
  const sidebarContent = /** @type {HTMLElement} */ (document.getElementById('sidebarContent'));
  const stageHintText = /** @type {HTMLElement} */ (document.getElementById('stageHintText'));
  const zoomReadout = /** @type {HTMLElement} */ (document.getElementById('zoomReadout'));
  const btnToggleOverlay = /** @type {HTMLButtonElement} */ (document.getElementById('btnToggleOverlay'));
  const btnZoomIn = /** @type {HTMLButtonElement} */ (document.getElementById('btnZoomIn'));
  const btnZoomOut = /** @type {HTMLButtonElement} */ (document.getElementById('btnZoomOut'));
  const btnZoomFit = /** @type {HTMLButtonElement} */ (document.getElementById('btnZoomFit'));
  const btnLoadDemo = /** @type {HTMLButtonElement} */ (document.getElementById('btnLoadDemo'));
  const btnResetAll = /** @type {HTMLButtonElement} */ (document.getElementById('btnResetAll'));

  const fileInputImg1 = /** @type {HTMLInputElement} */ (document.getElementById('fileInputImg1'));
  const fileInputImg2 = /** @type {HTMLInputElement} */ (document.getElementById('fileInputImg2'));
  const fileInputRefined = /** @type {HTMLInputElement} */ (document.getElementById('fileInputRefined'));
  const fileInputAutoPair = /** @type {HTMLInputElement} */ (document.getElementById('fileInputAutoPair'));
  const fileInputAutoImg1 = /** @type {HTMLInputElement} */ (document.getElementById('fileInputAutoImg1'));
  const fileInputAutoFace = /** @type {HTMLInputElement} */ (document.getElementById('fileInputAutoFace'));
  const workspaceStudio = /** @type {HTMLElement | null} */ (document.getElementById('workspaceStudio'));
  const viewHistory = /** @type {HTMLElement | null} */ (document.getElementById('viewHistory'));
  const viewSettings = /** @type {HTMLElement | null} */ (document.getElementById('viewSettings'));
  const btnViewStudio = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnViewStudio'));
  const btnViewHistory = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnViewHistory'));
  const btnViewSettings = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnViewSettings'));
  const metaThemeColor = /** @type {HTMLMetaElement | null} */ (document.getElementById('metaThemeColor'));
  const modalAutoSelect = /** @type {HTMLElement} */ (document.getElementById('modalAutoSelect'));

  // Prevent iOS Safari / Mobile browsers from initiating text/element selection during touch-hold or pinch
  document.addEventListener('selectstart', (e) => {
    const t = e.target;
    if (
      t instanceof HTMLInputElement ||
      t instanceof HTMLTextAreaElement ||
      (t instanceof HTMLElement && t.isContentEditable)
    ) {
      return;
    }
    e.preventDefault();
  });
  const toastContainer = /** @type {HTMLElement} */ (document.getElementById('toastContainer'));
  const sidebarPanel = /** @type {HTMLElement | null} */ (document.getElementById('sidebarPanel'));
  const sheetHandleBar = /** @type {HTMLElement | null} */ (document.getElementById('sheetHandleBar'));
  const sheetStepLabel = /** @type {HTMLElement | null} */ (document.getElementById('sheetStepLabel'));
  const btnSheetPeek = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnSheetPeek'));
  const btnSheetHalf = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnSheetHalf'));
  const btnSheetExpand = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnSheetExpand'));

  function isMobileLayout() {
    return window.matchMedia && window.matchMedia('(max-width: 960px)').matches;
  }

  function isRemoteClient() {
    const h = window.location.hostname;
    return !!h && h !== '127.0.0.1' && h !== 'localhost' && h !== '::1';
  }

  /** @type {'peek' | 'half' | 'expanded'} */
  let mobileSheetMode = 'half';

  /**
   * Controls the mobile bottom sheet snap state ('peek' | 'half' | 'expanded').
   * @param {'peek' | 'half' | 'expanded'} mode
   * @param {boolean} [refitCanvas=true]
   */
  function setMobileSheetState(mode, refitCanvas = true) {
    mobileSheetMode = mode;
    if (!sidebarPanel) return;
    sidebarPanel.style.height = '';
    sidebarPanel.classList.remove('dragging');
    sidebarPanel.setAttribute('data-sheet', mode);
    btnSheetPeek?.classList.toggle('active', mode === 'peek');
    btnSheetHalf?.classList.toggle('active', mode === 'half');
    btnSheetExpand?.classList.toggle('active', mode === 'expanded');
    if (refitCanvas && isMobileLayout()) {
      setTimeout(() => {
        viewport._syncCanvasSize();
        if (viewport.docW > 0 && viewport.docH > 0) {
          viewport.fitToViewport();
        } else {
          viewport.requestRender();
        }
      }, 240);
    }
  }

  function initMobileSheet() {
    if (!sidebarPanel || !sheetHandleBar) return;

    btnSheetPeek?.addEventListener('click', (e) => {
      e.stopPropagation();
      setMobileSheetState('peek');
    });
    btnSheetHalf?.addEventListener('click', (e) => {
      e.stopPropagation();
      setMobileSheetState('half');
    });
    btnSheetExpand?.addEventListener('click', (e) => {
      e.stopPropagation();
      setMobileSheetState('expanded');
    });

    let dragging = false;
    let startY = 0;
    let startH = 0;
    let lastY = 0;
    let moved = false;

    sheetHandleBar.addEventListener('pointerdown', (e) => {
      if (!isMobileLayout()) return;
      if (e.target instanceof HTMLElement && e.target.closest('.sheet-snap-btn')) return;
      dragging = true;
      moved = false;
      startY = e.clientY;
      lastY = e.clientY;
      startH = sidebarPanel.getBoundingClientRect().height;
      sidebarPanel.classList.add('dragging');
      try {
        sheetHandleBar.setPointerCapture(e.pointerId);
      } catch {}
    });

    sheetHandleBar.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dy = startY - e.clientY;
      if (Math.abs(dy) > 4) moved = true;
      lastY = e.clientY;
      const vh = window.innerHeight || 700;
      const minH = 54;
      const maxH = Math.round(vh * 0.84);
      const nextH = Math.max(minH, Math.min(maxH, startH + dy));
      sidebarPanel.style.height = `${nextH}px`;
    });

    const endDrag = () => {
      if (!dragging) return;
      dragging = false;
      sidebarPanel.classList.remove('dragging');
      if (!moved) {
        // Quick tap on handle cycles Peek -> Half -> Expanded -> Half
        const next =
          mobileSheetMode === 'peek'
            ? 'half'
            : mobileSheetMode === 'half'
            ? 'expanded'
            : 'peek';
        setMobileSheetState(next);
        return;
      }
      const vh = window.innerHeight || 700;
      const curH = sidebarPanel.getBoundingClientRect().height;
      const ratio = curH / vh;
      const delta = startY - lastY;
      if (ratio < 0.22 || (delta < -70 && ratio < 0.48)) {
        setMobileSheetState('peek');
      } else if (ratio > 0.62 || (delta > 70 && ratio > 0.42)) {
        setMobileSheetState('expanded');
      } else {
        setMobileSheetState('half');
      }
    };

    sheetHandleBar.addEventListener('pointerup', endDrag);
    sheetHandleBar.addEventListener('pointercancel', endDrag);

    let resizeFitTimer = 0;
    window.addEventListener('resize', () => {
      if (!isMobileLayout()) {
        sidebarPanel.style.height = '';
        sidebarPanel.classList.remove('dragging');
      }
      clearTimeout(resizeFitTimer);
      resizeFitTimer = window.setTimeout(() => {
        viewport._syncCanvasSize();
        if (viewport.docW > 0 && viewport.docH > 0) {
          viewport.fitToViewport();
        }
      }, 120);
    });
  }

  function handleEmptyCanvasClick() {
    if (state.activeStep === 1) {
      fileInputImg1.click();
    } else if (state.activeStep === 2) {
      fileInputImg2.click();
    } else if (state.activeStep === 4) {
      fileInputRefined.click();
    }
  }

  /**
   * Binds press-and-hold (or quick tap toggle) A/B flicker for both Touch & Mouse.
   * @param {HTMLElement | null} el
   * @param {boolean} [syncToolbar=false]
   */
  function bindFlickerControl(el, syncToolbar = false) {
    if (!el) return;
    let downTime = 0;
    let wasActiveOnDown = false;
    let activePointerId = -1;

    el.addEventListener('pointerdown', (e) => {
      if (el instanceof HTMLButtonElement && el.disabled) return;
      e.preventDefault();
      activePointerId = e.pointerId;
      downTime = performance.now();
      wasActiveOnDown = state.flickerActive;
      try {
        el.setPointerCapture(e.pointerId);
      } catch {}
      state.flickerActive = true;
      el.classList.add('flicker-active');
      syncViewportScene();
    });

    const release = (e) => {
      if (activePointerId !== e.pointerId) return;
      activePointerId = -1;
      const heldMs = performance.now() - downTime;
      if (heldMs >= 220) {
        // Hold-to-peek: restore on release
        state.flickerActive = false;
      } else {
        // Quick tap: toggle state
        state.flickerActive = !wasActiveOnDown;
      }
      el.classList.toggle('flicker-active', state.flickerActive);
      syncViewportScene();
      if (syncToolbar) renderStageToolbar();
    };

    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
  }

  let autoModalState = {
    /** @type {LoadedImage | null} */
    imgComplete: null,
    /** @type {LoadedImage | null} */
    imgFace: null,
  };

  const viewport = new ViewportClass(mainCanvas, {
    onSelectionComplete: handleSelectionComplete,
    onRegionClick: handleViewportRegionClick,
    onTransformChange: handleViewportTransformChange,
    onEmptyClick: handleEmptyCanvasClick,
    onStrokeStateChange: () => {
      if (state.activeStep === 1 || state.activeStep === 3) {
        renderStageToolbar();
        const sbUndo = /** @type {HTMLButtonElement | null} */ (document.getElementById('btnSbUndo1'));
        if (sbUndo) sbUndo.disabled = !viewport.hasActiveStroke() && !state.prevSelection1;
      }
    },
    onZoomChange: (z) => {
      zoomReadout.textContent = `${Math.round(z * 100)}%`;
    },
    onCompareChange: (r) => {
      state.compareRatio = r;
    },
  });

  // ===========================================================================
  // Toast Notifications
  // ===========================================================================
  function showToast(msg, isError = false) {
    const el = document.createElement('div');
    el.className = `toast${isError ? ' error' : ''}`;
    el.textContent = msg;
    toastContainer.appendChild(el);
    setTimeout(() => {
      el.style.opacity = '0';
      el.style.transition = 'opacity 0.25s ease';
      setTimeout(() => el.remove(), 260);
    }, 3100);
  }

  // ===========================================================================
  // Lazy Pipeline Recomputation (Zero Lag Under Continuous Editing)
  // ===========================================================================

  /**
   * Ensures all dirty prerequisite steps up to `targetStep` are freshly computed.
   * @param {number} targetStep
   */
  function ensureStepComputed(targetStep) {
    if (targetStep >= 2 && dirtySteps[2]) {
      recomputeStep2Outputs();
    }
    if (targetStep >= 3 && dirtySteps[3]) {
      recomputeStep3Outputs(dirtySteps.step3RebuildBase);
    }
    if (targetStep >= 4 && dirtySteps[4]) {
      recomputeStep4Outputs();
    }
    if (targetStep >= 5 && dirtySteps[5]) {
      recomputeStep5Outputs();
    }
    if (targetStep >= 6 && dirtySteps[6]) {
      recomputeStep6Outputs();
    }
  }

  let _liveRafId = 0;
  /** @type {(() => void) | null} */
  let _pendingLiveFn = null;
  function scheduleLiveRecompute(fn) {
    _pendingLiveFn = fn;
    if (_liveRafId) return;
    _liveRafId = requestAnimationFrame(() => {
      _liveRafId = 0;
      const run = _pendingLiveFn;
      _pendingLiveFn = null;
      if (run) run();
    });
  }

  /**
   * Recomputes faceMask1, EDT fields, and isolated pieces of imagem1.
   * Marks downstream Steps 2..6 dirty for lazy computation instead of blocking current frame.
   */
  function recomputeStep1Outputs(recomputeEDT = true) {
    if (!state.img1Canvas || !state.rawMask1) {
      state.faceMask1 = null;
      state.edtFace1OutSq = null;
      state.edtFace1InSq = null;
      setStateCanvas('corpo1Canvas', null);
      setStateCanvas('face1Canvas', null);
      setStateCanvas('mask1OverlayCanvas', null);
      markDirtyFrom(2, true);
      return;
    }

    const W = state.img1Canvas.width;
    const H = state.img1Canvas.height;
    const n = W * H;
    const faceMask = new Uint8Array(n);
    const targetVal = state.faceIsOne1 ? 1 : 0;
    for (let i = 0; i < n; i++) {
      faceMask[i] = state.rawMask1[i] === targetVal ? 1 : 0;
    }
    state.faceMask1 = faceMask;

    if (recomputeEDT) {
      state.edtFace1OutSq = Geo.computeEDT2DSq(faceMask, 1, W, H);
      state.edtFace1InSq = Geo.computeEDT2DSq(faceMask, 0, W, H);
    }

    setStateCanvas('face1Canvas', Ops.isolateByMask(state.img1Canvas, faceMask, 1));
    setStateCanvas('corpo1Canvas', Ops.isolateByMask(state.img1Canvas, faceMask, 0));
    setStateCanvas(
      'mask1OverlayCanvas',
      Ops.createMaskOverlayCanvas(faceMask, W, H, {
        tintOne: [56, 189, 248, 46],
        tintZero: [245, 158, 11, 28],
        borderColor: [56, 189, 248, 250],
        borderThickness: 2,
      })
    );

    state.faceCentroid1 = Geo.computeMaskCentroid(faceMask, 1, W, H);
    state.bodyCentroid1 = Geo.computeMaskCentroid(faceMask, 0, W, H);

    markDirtyFrom(2, true);
  }

  /**
   * Recomputes normalized/padded imagem2 and its isolated Face using the SAME selection & role from imagem1.
   */
  function recomputeStep2Outputs() {
    dirtySteps[2] = false;
    if (!state.img1Canvas || !state.img2) {
      setStateCanvas('img2AlignedCanvas', null);
      state.img2Placement = null;
      setStateCanvas('face2Canvas', null);
      markDirtyFrom(3, true);
      return;
    }

    const W = state.img1Canvas.width;
    const H = state.img1Canvas.height;
    const fullBox = { x: 0, y: 0, w: W, h: H };

    const { canvas, placement } = Ops.renderFittedWithPadding(
      state.img2,
      fullBox,
      W,
      H,
      state.img2Transform
    );
    setStateCanvas('img2AlignedCanvas', canvas);
    state.img2Placement = placement;

    if (state.faceMask1) {
      setStateCanvas('face2Canvas', Ops.isolateByMask(canvas, state.faceMask1, 1));
    } else {
      setStateCanvas('face2Canvas', null);
    }

    markDirtyFrom(3, true);
  }

  /**
   * Recomputes imagemMerge and splits it into:
   * - (face + bordas imprecisas)
   * - (corpo sem bordas imprecisas)
   *
   * @param {boolean} [rebuildMergeBase=true]
   */
  function recomputeStep3Outputs(rebuildMergeBase = true) {
    dirtySteps[3] = false;
    dirtySteps.step3RebuildBase = false;
    if (!state.img1Canvas || !state.corpo1Canvas || !state.face2Canvas || !state.faceMask1) {
      setStateCanvas('imgMergeCanvas', null);
      state.mergeFaceMask = null;
      state.edtMergeInsideSq = null;
      state.mergeFaceBox = null;
      setStateCanvas('faceImprecisaCanvas', null);
      setStateCanvas('corpoSemBordasCanvas', null);
      setStateCanvas('mergeOverlayCanvas', null);
      markDirtyFrom(4);
      return;
    }

    const W = state.img1Canvas.width;
    const H = state.img1Canvas.height;

    if (rebuildMergeBase || !state.imgMergeCanvas) {
      setStateCanvas(
        'imgMergeCanvas',
        Ops.uniteByComplementaryMask(state.face2Canvas, state.corpo1Canvas, state.faceMask1)
      );
    }

    /** @type {Uint8Array | null} */
    let mMask = null;

    if (state.mergeRegionMode === 'expand') {
      if (state.edtFace1OutSq) {
        mMask = Geo.dilateMaskWithEDT(
          state.faceMask1,
          state.edtFace1OutSq,
          state.edtFace1InSq,
          state.expandPx
        );
      }
    } else if (state.mergeRegionMode === 'custom') {
      if (state.customRawMask2) {
        const n = W * H;
        const baseCustom = new Uint8Array(n);
        const want = state.customFaceIsOne2 ? 1 : 0;
        for (let i = 0; i < n; i++) {
          baseCustom[i] = state.customRawMask2[i] === want ? 1 : 0;
        }
        if (state.customExtraExpandPx !== 0 && state.edtCustomOutSq) {
          mMask = Geo.dilateMaskWithEDT(
            baseCustom,
            state.edtCustomOutSq,
            state.edtCustomInSq,
            state.customExtraExpandPx
          );
        } else {
          mMask = baseCustom;
        }
      } else if (state.edtFace1OutSq) {
        mMask = new Uint8Array(state.faceMask1);
      }
    }

    state.mergeFaceMask = mMask;

    if (!mMask) {
      setStateCanvas('faceImprecisaCanvas', null);
      setStateCanvas('corpoSemBordasCanvas', null);
      setStateCanvas('mergeOverlayCanvas', null);
      state.mergeFaceBox = null;
      state.edtMergeInsideSq = null;
      markDirtyFrom(4);
      return;
    }

    state.mergeFaceBox = Geo.computeMaskBoundingBox(mMask, W, H, 0);
    setStateCanvas('faceImprecisaCanvas', Ops.isolateByMask(state.imgMergeCanvas, mMask, 1));
    setStateCanvas('corpoSemBordasCanvas', Ops.isolateByMask(state.imgMergeCanvas, mMask, 0));

    setStateCanvas(
      'mergeOverlayCanvas',
      Ops.createMaskOverlayCanvas(mMask, W, H, {
        tintOne: [167, 139, 250, 46],
        tintZero: [16, 185, 129, 24],
        borderColor: [167, 139, 250, 250],
        borderThickness: 2,
      })
    );

    state.mergeFaceCentroid = Geo.computeMaskCentroid(mMask, 1, W, H);
    state.mergeBodyCentroid = Geo.computeMaskCentroid(mMask, 0, W, H);
    state.edtMergeInsideSq = null;

    markDirtyFrom(4);
  }

  /**
   * Recomputes aligned AI-refined face image and isolates (face + bordas precisas).
   */
  function recomputeStep4Outputs() {
    dirtySteps[4] = false;
    if (!state.img1Canvas || !state.mergeFaceMask || !state.imgRefined) {
      setStateCanvas('refinedAlignedCanvas', null);
      state.refinedPlacement = null;
      setStateCanvas('facePrecisaCanvas', null);
      markDirtyFrom(5);
      return;
    }

    const W = state.img1Canvas.width;
    const H = state.img1Canvas.height;
    const targetBox =
      state.refinedTargetMode === 'cropbox' && state.mergeFaceBox
        ? state.mergeFaceBox
        : { x: 0, y: 0, w: W, h: H };

    const { canvas, placement } = Ops.renderFittedWithPadding(
      state.imgRefined,
      targetBox,
      W,
      H,
      state.refinedTransform
    );
    setStateCanvas('refinedAlignedCanvas', canvas);
    state.refinedPlacement = placement;
    setStateCanvas('facePrecisaCanvas', Ops.isolateByMask(canvas, state.mergeFaceMask, 1));

    markDirtyFrom(5);
  }

  /**
   * Recomputes imagemFinal = (face + bordas precisas) + (corpo sem bordas imprecisas)
   * with the selected seam & skin-tone merge technique.
   */
  function recomputeStep5Outputs() {
    dirtySteps[5] = false;
    if (
      !state.facePrecisaCanvas ||
      !state.corpoSemBordasCanvas ||
      !state.mergeFaceMask ||
      !state.img1Canvas
    ) {
      setStateCanvas('imgFinalUnblendedCanvas', null);
      setStateCanvas('imgFinalCanvas', null);
      markDirtyFrom(6);
      return;
    }

    const unblended = Ops.uniteByComplementaryMask(
      state.facePrecisaCanvas,
      state.corpoSemBordasCanvas,
      state.mergeFaceMask
    );
    setStateCanvas('imgFinalUnblendedCanvas', unblended);

    const fm = state.finalMerge;
    const needsAdvanced = fm.mode !== 'none' || fm.colorMatchStrength > 0.001;

    if (!needsAdvanced) {
      setStateCanvas('imgFinalCanvas', unblended);
      markDirtyFrom(6);
      return;
    }

    if (!state.edtMergeInsideSq) {
      state.edtMergeInsideSq = Geo.computeEDT2DSq(
        state.mergeFaceMask,
        0,
        state.img1Canvas.width,
        state.img1Canvas.height
      );
    }

    setStateCanvas(
      'imgFinalCanvas',
      Seam.mergeFinalAdvanced({
        facePreciseCanvas: state.facePrecisaCanvas,
        corpoSemBordasCanvas: state.corpoSemBordasCanvas,
        origFullCanvas: state.img1Canvas,
        mergeFaceMask: state.mergeFaceMask,
        origFaceMask1: state.faceMask1,
        edtToOutsideSq: state.edtMergeInsideSq,
        edtInsideOrigFaceSq: state.edtFace1InSq,
        mergeBox: state.mergeFaceBox,
        options: fm,
      })
    );

    markDirtyFrom(6);
  }

  /**
   * Recomputes Stage 6 Post-Processing Skin Color Matching after imagemFinal.
   */
  function recomputeStep6Outputs() {
    dirtySteps[6] = false;
    if (!state.imgFinalCanvas || !state.img1Canvas || !state.mergeFaceMask) {
      setStateCanvas('imgPostCanvas', null);
      setStateCanvas('skinMaskPreviewCanvas', null);
      state.skinDiagnostics = null;
      return;
    }

    if (!state.edtMergeInsideSq) {
      state.edtMergeInsideSq = Geo.computeEDT2DSq(
        state.mergeFaceMask,
        0,
        state.img1Canvas.width,
        state.img1Canvas.height
      );
    }

    const res = SkinPost.applySkinPostProcess({
      inputFinalCanvas: state.imgFinalCanvas,
      origImg1Canvas: state.img1Canvas,
      mergeFaceMask: state.mergeFaceMask,
      origFaceMask1: state.faceMask1,
      edtToOutsideSq: state.edtMergeInsideSq,
      faceSamples: state.skinSamplesFace,
      bodySamples: state.skinSamplesBody,
      options: state.skinPost,
    });

    setStateCanvas('imgPostCanvas', res.canvas);
    setStateCanvas('skinMaskPreviewCanvas', res.maskPreviewCanvas);
    state.skinDiagnostics = res.diagnostics;
  }

  /**
   * Releases inactive intermediate GPU canvases to keep continuous sessions light on RAM/VRAM.
   */
  function freeInactiveMemory() {
    const s = state.activeStep;
    let released = 0;
    const drop = (key, stepNum) => {
      if (state[key] && s !== stepNum) {
        setStateCanvas(key, null);
        dirtySteps[stepNum] = true;
        released++;
      }
    };
    if (s !== 2) {
      drop('img2AlignedCanvas', 2);
      drop('face2Canvas', 2);
    }
    if (s !== 3 && s !== 4) {
      drop('imgMergeCanvas', 3);
      drop('faceImprecisaCanvas', 3);
      drop('corpoSemBordasCanvas', 3);
      drop('mergeOverlayCanvas', 3);
      dirtySteps.step3RebuildBase = true;
    }
    if (s !== 4 && s !== 5) {
      drop('refinedAlignedCanvas', 4);
      drop('facePrecisaCanvas', 4);
    }
    if (s !== 5 && s !== 6) {
      drop('imgFinalUnblendedCanvas', 5);
      drop('imgFinalCanvas', 5);
    }
    if (s !== 6) {
      drop('imgPostCanvas', 6);
      drop('skinMaskPreviewCanvas', 6);
    }
    return released;
  }

  /**
   * Handles eyedropper clicks on canvas in Stage 6 (sample-face / sample-body).
   * @param {Point} pt
   */
  function handleViewportRegionClick(pt) {
    if (state.activeStep !== 6 || !state.imgFinalCanvas) return;
    const rounded = { x: Math.round(pt.x), y: Math.round(pt.y) };

    if (state.step6Tool === 'sample-face') {
      state.skinSamplesFace.push(rounded);
      if (state.skinSamplesFace.length > 6) state.skinSamplesFace.shift();
      recomputeStep6Outputs();
      syncAllUI();
      showToast(`Amostra da pele da Face F${state.skinSamplesFace.length} registrada!`);
    } else if (state.step6Tool === 'sample-body') {
      state.skinSamplesBody.push(rounded);
      if (state.skinSamplesBody.length > 6) state.skinSamplesBody.shift();
      recomputeStep6Outputs();
      syncAllUI();
      showToast(`Amostra da pele do Corpo C${state.skinSamplesBody.length} registrada!`);
    }
  }

  // ===========================================================================
  // Selection & Transform Event Handlers
  // ===========================================================================

  /**
   * @param {SelectionShape} sel
   */
  function handleSelectionComplete(sel) {
    if (!state.img1Canvas) return;
    const W = state.img1Canvas.width;
    const H = state.img1Canvas.height;

    if (state.activeStep === 1) {
      if (state.selection1) {
        state.prevSelection1 = {
          selection: state.selection1,
          rawMask: state.rawMask1,
          faceIsOne: state.faceIsOne1,
        };
      }
      state.selection1 = sel;
      state.rawMask1 = Geo.rasterizePolygonMask(sel.polygon, W, H);
      state.faceIsOne1 = Geo.guessFaceIsOne(state.rawMask1, W, H);
      state.step1View = 'split';
      recomputeStep1Outputs(true);
      syncAllUI();
      scheduleAutoSaveProject();
      showToast(
        sel.type === 'border-cut'
          ? 'Corte de 2 bordas concluído! Verifique Corpo e Face.'
          : 'Laço fechado concluído! Verifique Corpo e Face.'
      );
    } else if (state.activeStep === 3 && state.mergeRegionMode === 'custom') {
      if (state.customSelection2) {
        state.prevCustomSelection2 = {
          selection: state.customSelection2,
          rawMask: state.customRawMask2,
          faceIsOne: state.customFaceIsOne2,
        };
      }
      state.customSelection2 = sel;
      state.customRawMask2 = Geo.rasterizePolygonMask(sel.polygon, W, H);
      state.customFaceIsOne2 = state.faceMask1
        ? Geo.matchMaskSideToReference(state.customRawMask2, state.faceMask1)
        : Geo.guessFaceIsOne(state.customRawMask2, W, H);
      const normCustom = new Uint8Array(W * H);
      const want = state.customFaceIsOne2 ? 1 : 0;
      for (let i = 0; i < normCustom.length; i++) {
        normCustom[i] = state.customRawMask2[i] === want ? 1 : 0;
      }
      state.edtCustomOutSq = Geo.computeEDT2DSq(normCustom, 1, W, H);
      state.edtCustomInSq = Geo.computeEDT2DSq(normCustom, 0, W, H);

      state.step3View = 'split';
      recomputeStep3Outputs(false);
      syncAllUI();
      scheduleAutoSaveProject();
      showToast('Nova seleção de (face + bordas imprecisas) aplicada!');
    }
  }

  function undoCutAction() {
    if (viewport.undoStrokeSegment()) {
      renderStageToolbar();
      return;
    }
    if (state.activeStep === 1 && state.prevSelection1) {
      const snap = state.prevSelection1;
      state.prevSelection1 = null;
      state.selection1 = snap.selection;
      state.rawMask1 = snap.rawMask;
      state.faceIsOne1 = snap.faceIsOne;
      recomputeStep1Outputs(true);
      syncAllUI();
      scheduleAutoSaveProject();
      showToast('Seleção anterior restaurada.');
    } else if (state.activeStep === 3 && state.prevCustomSelection2) {
      const snap = state.prevCustomSelection2;
      state.prevCustomSelection2 = null;
      state.customSelection2 = snap.selection;
      state.customRawMask2 = snap.rawMask;
      state.customFaceIsOne2 = snap.faceIsOne;
      recomputeStep3Outputs(false);
      syncAllUI();
      scheduleAutoSaveProject();
      showToast('Corte anterior restaurado.');
    } else {
      showToast('Nada para desfazer no momento.');
    }
  }

  function handleViewportTransformChange(tx, ty, scale, rotation, isDragging) {
    if (typeof rotation === 'boolean' && isDragging === undefined) {
      isDragging = rotation;
      rotation = undefined;
    }
    if (state.activeStep === 2 && state.img2) {
      const rot = Number.isFinite(rotation) ? rotation : state.img2Transform.rotation || 0;
      state.img2Transform = {
        x: Math.round(tx * 10) / 10,
        y: Math.round(ty * 10) / 10,
        scale,
        rotation: rot,
      };
      updateSidebarLiveValues();
      const apply2 = () => {
        recomputeStep2Outputs();
        syncViewportScene();
        if (!isDragging) updateSidebarThumbnails();
      };
      if (isDragging) {
        scheduleLiveRecompute(apply2);
      } else {
        apply2();
        scheduleAutoSaveProject();
      }
    } else if (state.activeStep === 4 && state.imgRefined) {
      state.refinedTransform = { x: Math.round(tx * 10) / 10, y: Math.round(ty * 10) / 10, scale };
      updateSidebarLiveValues();
      const apply4 = () => {
        recomputeStep4Outputs();
        syncViewportScene();
        if (!isDragging) updateSidebarThumbnails();
      };
      if (isDragging) {
        scheduleLiveRecompute(apply4);
      } else {
        apply4();
        scheduleAutoSaveProject();
      }
    }
  }

  function flipCorpoAndFaceRole() {
    if (!state.rawMask1) return;
    state.faceIsOne1 = !state.faceIsOne1;
    recomputeStep1Outputs(true);
    syncAllUI();
    scheduleAutoSaveProject();
    showToast('Papéis Corpo ↔ Face invertidos (mantido fixo na imagem1 e imagem2).');
  }

  function flipCustomMergeRole() {
    if (!state.customRawMask2 || !state.img1Canvas) return;
    state.customFaceIsOne2 = !state.customFaceIsOne2;
    const W = state.img1Canvas.width;
    const H = state.img1Canvas.height;
    const normCustom = new Uint8Array(W * H);
    const want = state.customFaceIsOne2 ? 1 : 0;
    for (let i = 0; i < normCustom.length; i++) {
      normCustom[i] = state.customRawMask2[i] === want ? 1 : 0;
    }
    state.edtCustomOutSq = Geo.computeEDT2DSq(normCustom, 1, W, H);
    state.edtCustomInSq = Geo.computeEDT2DSq(normCustom, 0, W, H);
    recomputeStep3Outputs(false);
    syncAllUI();
    scheduleAutoSaveProject();
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ===========================================================================
  // Importing Images (Upload, Drag & Drop, Ctrl+V Paste)
  // ===========================================================================

  /**
   * @param {LoadedImage} loaded
   * @param {1 | 2 | 4} targetSlot
   */
  function applyLoadedImage(loaded, targetSlot) {
    if (targetSlot === 1) {
      const dimChanged =
        !state.img1 || state.img1.width !== loaded.width || state.img1.height !== loaded.height;
      state.img1 = loaded;
      setStateCanvas('img1Canvas', Ops.sourceToCanvas(loaded.img));
      if (!state.currentProjectName) {
        state.currentProjectName = (loaded.name || 'Projeto').replace(/\.[^.]+$/, '');
      }
      if (dimChanged) {
        state.selection1 = null;
        state.prevSelection1 = null;
        state.rawMask1 = null;
        state.customSelection2 = null;
        state.prevCustomSelection2 = null;
        state.customRawMask2 = null;
      }
      viewport.setDocumentSize(loaded.width, loaded.height, true);
      recomputeStep1Outputs(true);
      state.activeStep = 1;
      syncAllUI();
      scheduleAutoSaveProject();
      showToast(`imagem1 carregada (${loaded.width} × ${loaded.height} px).`);
    } else if (targetSlot === 2) {
      if (!state.img1Canvas) {
        showToast('Importe primeiro a imagem1 na Etapa 1 para definir a proporção base.', true);
        state.activeStep = 1;
        syncAllUI();
        return;
      }
      state.img2 = loaded;
      state.img2Transform = { x: 0, y: 0, scale: 1, rotation: 0 };
      state.step2View = 'align';
      recomputeStep2Outputs();
      state.activeStep = 2;
      syncAllUI();
      scheduleAutoSaveProject();

      const sameRatio =
        Math.abs(loaded.width / loaded.height - state.img1Canvas.width / state.img1Canvas.height) <
        0.004;
      showToast(
        sameRatio
          ? `imagem2 carregada (${loaded.width} × ${loaded.height} px) — mesma proporção!`
          : `imagem2 carregada (${loaded.width} × ${loaded.height} px) — centralizada com padding transparente!`
      );
    } else if (targetSlot === 4) {
      ensureStepComputed(3);
      if (!state.imgMergeCanvas || !state.mergeFaceMask) {
        showToast('Conclua até a imagemMerge (Etapa 3) antes de importar a face refinada.', true);
        return;
      }
      state.imgRefined = loaded;
      state.refinedTransform = { x: 0, y: 0, scale: 1 };

      if (state.exportCroppedMode && state.mergeFaceBox) {
        state.refinedTargetMode = 'cropbox';
      } else if (state.mergeFaceBox && state.img1Canvas) {
        const fullRatio = state.img1Canvas.width / state.img1Canvas.height;
        const boxRatio = state.mergeFaceBox.w / state.mergeFaceBox.h;
        const imgRatio = loaded.width / loaded.height;
        if (
          Math.abs(imgRatio - boxRatio) < 0.03 &&
          Math.abs(imgRatio - fullRatio) > 0.08 &&
          loaded.width <= state.mergeFaceBox.w * 1.6
        ) {
          state.refinedTargetMode = 'cropbox';
        } else {
          state.refinedTargetMode = 'full';
        }
      } else {
        state.refinedTargetMode = 'full';
      }

      state.step4View = 'align';
      recomputeStep4Outputs();
      state.activeStep = 4;
      syncAllUI();
      scheduleAutoSaveProject();
      showToast('Resultado da IA (face + bordas precisas) importado!');
    }
  }

  /**
   * Determines which image slot receives a Ctrl+V paste or canvas drop based on activeStep.
   * @returns {1 | 2 | 4}
   */
  function currentImportSlot() {
    if (!state.img1) return 1;
    if (state.activeStep === 1) return 1;
    if (state.activeStep === 2) return 2;
    if (state.activeStep === 3) return state.img2 ? 4 : 2;
    return 4;
  }

  // File input listeners
  fileInputImg1.addEventListener('change', async () => {
    const f = fileInputImg1.files && fileInputImg1.files[0];
    fileInputImg1.value = '';
    if (!f) return;
    try {
      const loaded = await Ops.loadImageFromBlob(f, f.name);
      applyLoadedImage(loaded, 1);
    } catch (err) {
      showToast(err.message || 'Erro ao abrir imagem1.', true);
    }
  });

  fileInputImg2.addEventListener('change', async () => {
    const f = fileInputImg2.files && fileInputImg2.files[0];
    fileInputImg2.value = '';
    if (!f) return;
    try {
      const loaded = await Ops.loadImageFromBlob(f, f.name);
      applyLoadedImage(loaded, 2);
    } catch (err) {
      showToast(err.message || 'Erro ao abrir imagem2.', true);
    }
  });

  fileInputRefined.addEventListener('change', async () => {
    const f = fileInputRefined.files && fileInputRefined.files[0];
    fileInputRefined.value = '';
    if (!f) return;
    try {
      const loaded = await Ops.loadImageFromBlob(f, f.name);
      applyLoadedImage(loaded, 4);
    } catch (err) {
      showToast(err.message || 'Erro ao abrir imagem refinada.', true);
    }
  });

  // Global Ctrl+V Paste listener
  window.addEventListener('paste', async (e) => {
    try {
      const loaded = await Ops.extractImageFromPasteEvent(e);
      if (loaded) {
        e.preventDefault();
        applyLoadedImage(loaded, currentImportSlot());
      }
    } catch (err) {
      showToast(err.message || 'Falha ao colar imagem.', true);
    }
  });

  // Drag & drop onto canvas wrapper
  canvasDropWrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    canvasDropWrap.classList.add('drag-over');
  });
  canvasDropWrap.addEventListener('dragleave', () => {
    canvasDropWrap.classList.remove('drag-over');
  });
  canvasDropWrap.addEventListener('drop', async (e) => {
    e.preventDefault();
    canvasDropWrap.classList.remove('drag-over');
    const files = e.dataTransfer ? Array.from(e.dataTransfer.files).filter((x) => x.type.startsWith('image/')) : [];
    if (files.length === 0) return;
    try {
      const loaded = await Ops.loadImageFromBlob(files[0], files[0].name);
      applyLoadedImage(loaded, currentImportSlot());
    } catch (err) {
      showToast(err.message || 'Falha ao soltar imagem.', true);
    }
  });

  // ===========================================================================
  // Sync Viewport Scene & Stage Toolbar
  // ===========================================================================

  function syncViewportScene() {
    const rs = viewport.renderState;
    rs.onionCanvas = null;
    rs.onionOpacity = 0;
    rs.maskOverlayCanvas = null;
    rs.showMaskOverlay = state.showGuides;
    rs.guideCutPath = null;
    rs.guideIsLasso = false;
    rs.badges = [];
    rs.samplePins = [];
    rs.alignBox = null;
    rs.targetSubBox = null;
    rs.compareBeforeCanvas = null;

    viewport.setPrecisionOptions({
      enabled: state.precisionCut,
      sensitivity: state.appSettings.precisionSensitivity,
      loupeZoom: state.appSettings.loupeZoom,
      loupeSize: state.appSettings.loupeSize,
    });

    if (!state.img1Canvas) {
      viewport.mode = 'cut';
      rs.primaryCanvas = null;
      rs.emptyHintTitle = 'Importe ou cole a imagem1 (Ctrl+V)';
      rs.emptyHintSub = 'Arraste um arquivo para cá, clique em Escolher Arquivo ou pressione Ctrl+V';
      viewport.requestRender();
      return;
    }

    const W = state.img1Canvas.width;
    const H = state.img1Canvas.height;
    if (viewport.docW !== W || viewport.docH !== H) {
      viewport.setDocumentSize(W, H, true);
    }

    if (state.activeStep === 1) {
      viewport.mode = state.step1Tool === 'pan' ? 'pan' : 'cut';
      if (state.step1View === 'body' && state.corpo1Canvas) {
        rs.primaryCanvas = state.corpo1Canvas;
      } else if (state.step1View === 'face' && state.face1Canvas) {
        rs.primaryCanvas = state.face1Canvas;
      } else {
        rs.primaryCanvas = state.img1Canvas;
        rs.maskOverlayCanvas = state.mask1OverlayCanvas;
      }

      if (state.showGuides && state.faceMask1 && state.step1View === 'split') {
        if (state.faceCentroid1.count > 0) {
          rs.badges.push({
            x: state.faceCentroid1.x,
            y: state.faceCentroid1.y,
            text: 'FACE (fixo img1/img2)',
            color: '#38bdf8',
          });
        }
        if (state.bodyCentroid1.count > 0) {
          rs.badges.push({
            x: state.bodyCentroid1.x,
            y: state.bodyCentroid1.y,
            text: 'CORPO (fixo img1/img2)',
            color: '#f59e0b',
          });
        }
      }
      stageHintText.textContent = state.precisionCut
        ? 'Modo Alta Precisão: deslize devagar com lupa; pode soltar o dedo, dar zoom com 2 dedos e continuar de onde parou.'
        : 'Etapa 1: Segure o mouse/dedo para cortar tocando 2 bordas (pode vir de fora da imagem) ou fechar um laço.';
    } else if (state.activeStep === 2) {
      if (!state.img2 || !state.img2AlignedCanvas) {
        viewport.mode = 'view';
        rs.primaryCanvas = null;
        rs.emptyHintTitle = 'Aguardando imagem2 (gerada com IA + referências)';
        rs.emptyHintSub = 'Importe ou cole (Ctrl+V) a imagem2 — o padding transparente será aplicado automaticamente';
      } else if (state.step2View === 'face' && state.face2Canvas) {
        viewport.mode = 'view';
        rs.primaryCanvas = state.face2Canvas;
        if (state.showGuides && state.selection1) {
          rs.guideCutPath = state.selection1.cutPath;
          rs.guideIsLasso = state.selection1.type === 'lasso';
        }
      } else if (state.step2View === 'split') {
        viewport.mode = 'view';
        rs.primaryCanvas = state.img2AlignedCanvas;
        rs.maskOverlayCanvas = state.mask1OverlayCanvas;
        if (state.showGuides && state.faceMask1) {
          rs.badges.push(
            { x: state.faceCentroid1.x, y: state.faceCentroid1.y, text: 'FACE (isolar da imagem2)', color: '#38bdf8' },
            { x: state.bodyCentroid1.x, y: state.bodyCentroid1.y, text: 'CORPO (descartado na imagem2)', color: '#64748b' }
          );
        }
      } else {
        // Align mode!
        viewport.mode = 'align';
        viewport.alignBaseTransform = { ...state.img2Transform };
        if (state.flickerActive) {
          // Flicker mode: displays pure imagem1 for instant A/B brain perception
          rs.primaryCanvas = state.img1Canvas;
          rs.onionCanvas = null;
          rs.onionOpacity = 0;
          rs.alignBox = null;
        } else {
          rs.primaryCanvas = state.img2AlignedCanvas;
          rs.onionCanvas = state.img1Canvas;
          rs.onionOpacity = state.img2OnionOpacity;
          rs.alignBox = state.img2Placement;
          rs.showAnatomicGuides = state.showAnatomicGuides;
          rs.faceCenter = state.faceCentroid1;
          rs.estimatedHeadWidth = state.faceCentroid1 && state.faceCentroid1.count > 100
            ? Math.sqrt(state.faceCentroid1.count) * 1.15
            : null;
        }
        if (state.showGuides && state.selection1) {
          rs.guideCutPath = state.selection1.cutPath;
          rs.guideIsLasso = state.selection1.type === 'lasso';
        }
      }
      stageHintText.textContent =
        'Etapa 2: Arraste para mover • Alça azul no topo gira • Cantos escalam • Segure F para piscar A/B.';
    } else if (state.activeStep === 3) {
      if (!state.imgMergeCanvas) {
        viewport.mode = 'view';
        rs.primaryCanvas = null;
        rs.emptyHintTitle = 'Conclua o corte na imagem1 e importe a imagem2';
        rs.emptyHintSub = 'A imagemMerge unirá automaticamente o Corpo (imagem1) + Face (imagem2)';
      } else {
        viewport.mode =
          state.mergeRegionMode === 'custom' && state.step3Tool === 'cut' ? 'cut' : 'pan';

        if (state.step3View === 'face-imp' && state.faceImprecisaCanvas) {
          rs.primaryCanvas = state.faceImprecisaCanvas;
        } else if (state.step3View === 'body-clean' && state.corpoSemBordasCanvas) {
          rs.primaryCanvas = state.corpoSemBordasCanvas;
        } else {
          rs.primaryCanvas = state.imgMergeCanvas;
          rs.maskOverlayCanvas = state.mergeOverlayCanvas;
        }

        if (state.showGuides) {
          // Always show original seam in dashed pink so user sees the "bordas imprecisas" inside the expanded zone!
          if (state.selection1) {
            rs.guideCutPath = state.selection1.cutPath;
            rs.guideIsLasso = state.selection1.type === 'lasso';
          }
          if (state.exportCroppedMode && state.mergeFaceBox) {
            rs.targetSubBox = state.mergeFaceBox;
          }
          if (state.step3View === 'split' && state.mergeFaceMask) {
            if (state.mergeFaceCentroid.count > 0) {
              rs.badges.push({
                x: state.mergeFaceCentroid.x,
                y: state.mergeFaceCentroid.y,
                text: 'FACE + BORDAS IMPRECISAS',
                color: '#a78bfa',
              });
            }
            if (state.mergeBodyCentroid.count > 0) {
              rs.badges.push({
                x: state.mergeBodyCentroid.x,
                y: state.mergeBodyCentroid.y,
                text: 'CORPO SEM BORDAS IMPRECISAS',
                color: '#10b981',
              });
            }
          }
        }
      }
      stageHintText.textContent =
        state.mergeRegionMode === 'expand'
          ? 'Etapa 3: Ajuste a expansão automática para cobrir a junção tracejada (bordas imprecisas) ou mude para Novo Corte/Laço.'
          : 'Etapa 3 (Novo Corte/Laço): Segure o mouse para cortar tocando 2 bordas ou fechar um laço ao redor da face + bordas imprecisas.';
    } else if (state.activeStep === 4) {
      if (!state.imgRefined || !state.refinedAlignedCanvas) {
        viewport.mode = 'view';
        rs.primaryCanvas = state.faceImprecisaCanvas || null;
        if (!rs.primaryCanvas) {
          rs.emptyHintTitle = 'Aguardando (face + bordas precisas) da IA';
          rs.emptyHintSub = 'Copie (face + bordas imprecisas) na Etapa 3, refine na IA e cole (Ctrl+V) aqui';
        } else if (state.showGuides && state.exportCroppedMode && state.mergeFaceBox) {
          rs.targetSubBox = state.mergeFaceBox;
        }
      } else if (state.step4View === 'isolated' && state.facePrecisaCanvas) {
        viewport.mode = 'view';
        rs.primaryCanvas = state.facePrecisaCanvas;
      } else {
        viewport.mode = 'align';
        viewport.alignBaseTransform = { ...state.refinedTransform };
        rs.primaryCanvas = state.refinedAlignedCanvas;
        rs.onionCanvas = state.imgMergeCanvas;
        rs.onionOpacity = state.refinedOnionOpacity;
        rs.alignBox = state.refinedPlacement;
        rs.maskOverlayCanvas = state.mergeOverlayCanvas;
        if (state.refinedTargetMode === 'cropbox' && state.mergeFaceBox) {
          rs.targetSubBox = state.mergeFaceBox;
        }
      }
      stageHintText.textContent =
        'Etapa 4: Cole (Ctrl+V) o resultado da IA e ajuste posição/escala se necessário para isolar (face + bordas precisas).';
    } else if (state.activeStep === 5) {
      if (!state.imgFinalCanvas) {
        viewport.mode = 'view';
        rs.primaryCanvas = state.imgMergeCanvas || null;
        rs.emptyHintTitle = 'Importe (face + bordas precisas) na Etapa 4 para gerar a imagemFinal';
        rs.emptyHintSub = '(face + bordas precisas) + (corpo sem bordas imprecisas) = imagemFinal';
      } else if (state.step5View === 'compare-raw' && state.imgFinalUnblendedCanvas) {
        viewport.mode = 'compare';
        rs.primaryCanvas = state.imgFinalCanvas;
        rs.compareBeforeCanvas = state.imgFinalUnblendedCanvas;
        rs.compareLabelBefore = 'Antes: Corte Seco (Sem Suavização)';
        rs.compareLabelAfter = 'Depois: Merge & Tom de Pele';
        rs.compareRatio = state.compareRatio;
      } else if (state.step5View === 'compare-merge' && state.imgMergeCanvas) {
        viewport.mode = 'compare';
        rs.primaryCanvas = state.imgFinalCanvas;
        rs.compareBeforeCanvas = state.imgMergeCanvas;
        rs.compareLabelBefore = 'Antes: imagemMerge';
        rs.compareLabelAfter = 'Depois: imagemFinal';
        rs.compareRatio = state.compareRatio;
      } else if (state.step5View === 'compare-img1' && state.img1Canvas) {
        viewport.mode = 'compare';
        rs.primaryCanvas = state.imgFinalCanvas;
        rs.compareBeforeCanvas = state.img1Canvas;
        rs.compareLabelBefore = 'Antes: imagem1';
        rs.compareLabelAfter = 'Depois: imagemFinal';
        rs.compareRatio = state.compareRatio;
      } else {
        viewport.mode = 'pan';
        rs.primaryCanvas = state.imgFinalCanvas;
      }
      stageHintText.textContent =
        'Etapa 5: Escolha a técnica de merge/pele à direita ou avance para a Etapa 6 (Pós-Processamento de Pele).';
    } else if (state.activeStep === 6) {
      const isSampling =
        state.step6Tool === 'sample-face' || state.step6Tool === 'sample-body';

      if (state.showGuides) {
        state.skinSamplesFace.forEach((pt, idx) => {
          rs.samplePins.push({
            x: pt.x,
            y: pt.y,
            label: `F${idx + 1}`,
            color: '#38bdf8',
          });
        });
        state.skinSamplesBody.forEach((pt, idx) => {
          rs.samplePins.push({
            x: pt.x,
            y: pt.y,
            label: `C${idx + 1}`,
            color: '#f59e0b',
          });
        });
      }

      if (!state.imgPostCanvas || !state.imgFinalCanvas) {
        viewport.mode = 'view';
        rs.primaryCanvas = state.imgMergeCanvas || null;
        rs.emptyHintTitle = 'Conclua até a imagemFinal (Etapa 5) para igualar o tom de pele';
        rs.emptyHintSub =
          'O pós-processamento analisa e iguala cientificamente a pele da Face × Corpo';
      } else if (state.step6View === 'compare-pre' && !isSampling) {
        viewport.mode = 'compare';
        rs.primaryCanvas = state.imgPostCanvas;
        rs.compareBeforeCanvas = state.imgFinalCanvas;
        rs.compareLabelBefore = 'Antes: imagemFinal (Pré-Pós)';
        rs.compareLabelAfter = 'Depois: Tom de Pele Igualado';
        rs.compareRatio = state.compareRatio;
      } else if (
        state.step6View === 'compare-raw' &&
        state.imgFinalUnblendedCanvas &&
        !isSampling
      ) {
        viewport.mode = 'compare';
        rs.primaryCanvas = state.imgPostCanvas;
        rs.compareBeforeCanvas = state.imgFinalUnblendedCanvas;
        rs.compareLabelBefore = 'Antes: Corte Seco (Bruto)';
        rs.compareLabelAfter = 'Depois: Merge + Pós de Pele';
        rs.compareRatio = state.compareRatio;
      } else if (state.step6View === 'compare-img1' && state.img1Canvas && !isSampling) {
        viewport.mode = 'compare';
        rs.primaryCanvas = state.imgPostCanvas;
        rs.compareBeforeCanvas = state.img1Canvas;
        rs.compareLabelBefore = 'Antes: imagem1 (Original)';
        rs.compareLabelAfter = 'Depois: Pós de Pele';
        rs.compareRatio = state.compareRatio;
      } else if (state.step6View === 'skin-mask' && state.skinMaskPreviewCanvas) {
        viewport.mode = isSampling ? 'sample' : 'pan';
        rs.primaryCanvas = state.skinMaskPreviewCanvas;
        if (state.showGuides && state.selection1) {
          rs.guideCutPath = state.selection1.cutPath;
          rs.guideIsLasso = state.selection1.type === 'lasso';
        }
      } else {
        viewport.mode = isSampling ? 'sample' : 'pan';
        rs.primaryCanvas = state.imgPostCanvas;
      }

      if (state.step6Tool === 'sample-face') {
        stageHintText.textContent =
          'Conta-Gotas (Face): Clique em áreas de pele limpa na Face (bochecha, testa, queixo) para calibrar.';
      } else if (state.step6Tool === 'sample-body') {
        stageHintText.textContent =
          'Conta-Gotas (Corpo): Clique em áreas de pele limpa no Corpo/Pescoço/Colo para calibrar o alvo.';
      } else if (state.step6View === 'skin-mask') {
        stageHintText.textContent =
          'Mapa Seletivo de Pele: Ciano = pele da Face | Âmbar = pele do Corpo | Cinza = olhos, lábios, cabelo e roupas protegidos.';
      } else {
        stageHintText.textContent =
          'Etapa 6 (Pós): Iguale o tom de pele entre as 2 versões (Face × Corpo) usando Transporte Ótimo Oklab, Curvas CDF ou Melanina×Hemoglobina.';
      }
    }

    viewport._updateCursor();
    viewport.requestRender();
  }

  // ===========================================================================
  // Stepper & Toolbar Rendering
  // ===========================================================================

  function renderStepper() {
    /** @type {{ id: 1 | 2 | 3 | 4 | 5 | 6, num: string, label: string, done: boolean }[]} */
    const steps = [
      { id: 1, num: '1', label: 'img1 • Corpo', done: !!(state.img1 && state.faceMask1) },
      { id: 2, num: '2', label: 'img2 • Face', done: !!(state.img2 && (state.face2Canvas || dirtySteps[2])) },
      { id: 3, num: '3', label: 'Merge • Bordas', done: !!(state.imgMergeCanvas || (state.img2 && state.faceMask1)) },
      { id: 4, num: '4', label: 'IA • Precisa', done: !!(state.imgRefined && (state.facePrecisaCanvas || dirtySteps[4])) },
      { id: 5, num: '5', label: 'imgFinal', done: !!(state.imgFinalCanvas || (state.imgRefined && dirtySteps[5])) },
      { id: 6, num: '6', label: 'Pós • Pele', done: !!(state.skinPost.enabled && (state.imgPostCanvas || (state.imgRefined && dirtySteps[6]))) },
    ];

    stepperNav.innerHTML = '';
    /** @type {HTMLButtonElement | null} */
    let activeBtn = null;
    steps.forEach((s, idx) => {
      const btn = document.createElement('button');
      const isActive = state.activeStep === s.id;
      btn.className = `step-btn${isActive ? ' active' : ''}${s.done ? ' done' : ''}`;
      btn.innerHTML = `<span class="step-num">${s.done && !isActive ? '✓' : s.num}</span><span>${s.label}</span>`;
      if (isActive) {
        activeBtn = btn;
        if (sheetStepLabel) {
          sheetStepLabel.textContent = `${s.num}. ${s.label}`;
        }
      }
      btn.addEventListener('click', () => {
        if (state.activeView !== 'studio') setActiveView('studio');
        state.activeStep = s.id;
        ensureStepComputed(s.id);
        syncAllUI();
      });
      stepperNav.appendChild(btn);

      if (idx < steps.length - 1) {
        const arrow = document.createElement('span');
        arrow.className = 'step-arrow';
        arrow.textContent = '›';
        stepperNav.appendChild(arrow);
      }
    });

    if (activeBtn && isMobileLayout()) {
      activeBtn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    }
  }

  function togglePrecisionCut() {
    state.precisionCut = !state.precisionCut;
    viewport.setPrecisionOptions({
      enabled: state.precisionCut,
      sensitivity: state.appSettings.precisionSensitivity,
      loupeZoom: state.appSettings.loupeZoom,
      loupeSize: state.appSettings.loupeSize,
    });
    if (state.precisionCut && state.activeStep === 1) {
      state.step1Tool = 'cut';
      state.step1View = 'split';
      if (isMobileLayout() && mobileSheetMode === 'expanded') setMobileSheetState('peek');
    } else if (state.precisionCut && state.activeStep === 3) {
      state.step3Tool = 'cut';
    }
    syncAllUI();
    showToast(
      state.precisionCut
        ? 'Lupa de Alta Precisão ativada: pode soltar o dedo e continuar de onde parou.'
        : 'Modo de corte rápido ativado.'
    );
  }

  function renderStageToolbar() {
    stageModeToolbar.innerHTML = '';

    /**
     * @param {string} label
     * @param {boolean} active
     * @param {() => void} onClick
     */
    const addPill = (label, active, onClick) => {
      const b = document.createElement('button');
      b.className = `tool-pill${active ? ' active' : ''}`;
      b.textContent = label;
      b.addEventListener('click', onClick);
      stageModeToolbar.appendChild(b);
      return b;
    };

    const strokeInfo = viewport.getStrokeState();

    if (state.activeStep === 1) {
      addPill('✂ Cortar / Laço', state.step1Tool === 'cut', () => {
        state.step1Tool = 'cut';
        if (isMobileLayout() && mobileSheetMode === 'expanded') setMobileSheetState('peek');
        syncViewportScene();
        renderStageToolbar();
      });
      addPill('🔍 Precisão Lupa', state.precisionCut, togglePrecisionCut);
      if (strokeInfo.active || state.prevSelection1) {
        addPill('↩ Desfazer', false, undoCutAction);
      }
      if (strokeInfo.active && strokeInfo.points >= 3) {
        addPill('✓ Fechar Laço', true, () => viewport.finishPrecisionLasso());
      }
      if (strokeInfo.active) {
        addPill('✕ Cancelar', false, () => viewport.cancelActiveStroke());
      }
      addPill('✨ Auto Selecionar', false, () => {
        openAutoSelectModal();
      });
      addPill('✋ Mover Vista', state.step1Tool === 'pan', () => {
        state.step1Tool = 'pan';
        syncViewportScene();
        renderStageToolbar();
      });
      if (state.faceMask1) {
        addPill('⇄ Inverter Corpo/Face', false, flipCorpoAndFaceRole);
        addPill('Divisão', state.step1View === 'split', () => {
          state.step1View = 'split';
          syncViewportScene();
          renderStageToolbar();
        });
        addPill('Só Corpo', state.step1View === 'body', () => {
          state.step1View = 'body';
          syncViewportScene();
          renderStageToolbar();
        });
        addPill('Só Face', state.step1View === 'face', () => {
          state.step1View = 'face';
          syncViewportScene();
          renderStageToolbar();
        });
      }
    } else if (state.activeStep === 2) {
      addPill('✥ Ajustar Manual', state.step2View === 'align', () => {
        state.step2View = 'align';
        syncViewportScene();
        renderStageToolbar();
      });
      addPill('🎯 Alinhar Olhos (IPD)', false, () => {
        openEyeCalibrateModal();
      });
      addPill('📏 Guias Cranianas', state.showAnatomicGuides, () => {
        state.showAnatomicGuides = !state.showAnatomicGuides;
        syncViewportScene();
        renderStageToolbar();
      });
      const flickPill = document.createElement('button');
      flickPill.className = `tool-pill${state.flickerActive ? ' active flicker-active' : ''}`;
      flickPill.textContent = '👁️ Piscar A/B';
      flickPill.title = 'Segure para piscar ou toque rápido para alternar (Tecla F)';
      stageModeToolbar.appendChild(flickPill);
      bindFlickerControl(flickPill, true);
      addPill('↶ -90°', false, () => {
        state.img2Transform.rotation =
          Math.round(((state.img2Transform.rotation || 0) - 90) * 10) / 10;
        recomputeStep2Outputs();
        syncViewportScene();
        updateSidebarLiveValues();
        showToast(`Imagem 2 girada para ${(state.img2Transform.rotation || 0).toFixed(1)}°`);
      });
      addPill('↷ +90°', false, () => {
        state.img2Transform.rotation =
          Math.round(((state.img2Transform.rotation || 0) + 90) * 10) / 10;
        recomputeStep2Outputs();
        syncViewportScene();
        updateSidebarLiveValues();
        showToast(`Imagem 2 girada para ${(state.img2Transform.rotation || 0).toFixed(1)}°`);
      });
      addPill('Divisão c/ Seleção', state.step2View === 'split', () => {
        state.step2View = 'split';
        syncViewportScene();
        renderStageToolbar();
      });
      addPill('Só Face Isolada', state.step2View === 'face', () => {
        state.step2View = 'face';
        syncViewportScene();
        renderStageToolbar();
      });
      if (state.faceMask1) {
        addPill('⇄ Inverter Corpo/Face', false, flipCorpoAndFaceRole);
      }
    } else if (state.activeStep === 3) {
      if (state.mergeRegionMode === 'custom') {
        addPill('✂ Desenhar Corte/Laço', state.step3Tool === 'cut', () => {
          state.step3Tool = 'cut';
          syncViewportScene();
          renderStageToolbar();
        });
        addPill('🔍 Precisão Lupa', state.precisionCut, togglePrecisionCut);
        if (strokeInfo.active || state.prevCustomSelection2) {
          addPill('↩ Desfazer', false, undoCutAction);
        }
        if (strokeInfo.active && strokeInfo.points >= 3) {
          addPill('✓ Fechar Laço', true, () => viewport.finishPrecisionLasso());
        }
        if (strokeInfo.active) {
          addPill('✕ Cancelar', false, () => viewport.cancelActiveStroke());
        }
        addPill('✋ Mover Vista', state.step3Tool === 'pan', () => {
          state.step3Tool = 'pan';
          syncViewportScene();
          renderStageToolbar();
        });
      }
      addPill('União + Seleção', state.step3View === 'split', () => {
        state.step3View = 'split';
        syncViewportScene();
        renderStageToolbar();
      });
      addPill('Face + Bordas Imprecisas', state.step3View === 'face-imp', () => {
        state.step3View = 'face-imp';
        syncViewportScene();
        renderStageToolbar();
      });
      addPill('Corpo s/ Bordas', state.step3View === 'body-clean', () => {
        state.step3View = 'body-clean';
        syncViewportScene();
        renderStageToolbar();
      });
    } else if (state.activeStep === 4) {
      addPill('✥ Ajustar Posição/Escala', state.step4View === 'align', () => {
        state.step4View = 'align';
        syncViewportScene();
        renderStageToolbar();
      });
      addPill('Ver Face + Bordas Precisas', state.step4View === 'isolated', () => {
        state.step4View = 'isolated';
        syncViewportScene();
        renderStageToolbar();
      });
    } else if (state.activeStep === 5) {
      addPill('✨ imagemFinal', state.step5View === 'final', () => {
        state.step5View = 'final';
        syncViewportScene();
        renderStageToolbar();
      });
      addPill('↔ vs Corte Seco', state.step5View === 'compare-raw', () => {
        state.step5View = 'compare-raw';
        syncViewportScene();
        renderStageToolbar();
      });
      addPill('↔ vs imagemMerge', state.step5View === 'compare-merge', () => {
        state.step5View = 'compare-merge';
        syncViewportScene();
        renderStageToolbar();
      });
      addPill('↔ vs imagem1', state.step5View === 'compare-img1', () => {
        state.step5View = 'compare-img1';
        syncViewportScene();
        renderStageToolbar();
      });
    } else if (state.activeStep === 6) {
      addPill('✨ Pós-Processado', state.step6View === 'post' && state.step6Tool === 'pan', () => {
        state.step6Tool = 'pan';
        state.step6View = 'post';
        syncAllUI();
      });
      addPill('↔ vs Pré-Pós', state.step6View === 'compare-pre' && state.step6Tool === 'pan', () => {
        state.step6Tool = 'pan';
        state.step6View = 'compare-pre';
        syncAllUI();
      });
      addPill('👁 Mapa de Pele', state.step6View === 'skin-mask', () => {
        state.step6View = 'skin-mask';
        syncAllUI();
      });
      addPill('🎯 Amostrar Face', state.step6Tool === 'sample-face', () => {
        state.step6Tool = state.step6Tool === 'sample-face' ? 'pan' : 'sample-face';
        if (state.step6Tool !== 'pan' && state.step6View.startsWith('compare')) {
          state.step6View = 'post';
        }
        if (isMobileLayout() && state.step6Tool !== 'pan' && mobileSheetMode === 'expanded') {
          setMobileSheetState('peek');
        }
        syncAllUI();
      });
      addPill('🎯 Amostrar Corpo', state.step6Tool === 'sample-body', () => {
        state.step6Tool = state.step6Tool === 'sample-body' ? 'pan' : 'sample-body';
        if (state.step6Tool !== 'pan' && state.step6View.startsWith('compare')) {
          state.step6View = 'post';
        }
        if (isMobileLayout() && state.step6Tool !== 'pan' && mobileSheetMode === 'expanded') {
          setMobileSheetState('peek');
        }
        syncAllUI();
      });
      if (state.skinSamplesFace.length > 0 || state.skinSamplesBody.length > 0) {
        addPill('↺ Limpar Amostras', false, () => {
          state.skinSamplesFace = [];
          state.skinSamplesBody = [];
          state.step6Tool = 'pan';
          recomputeStep6Outputs();
          syncAllUI();
          showToast('Amostragem restaurada para detecção automática de pele.');
        });
      }
    }

    btnToggleOverlay.classList.toggle('active', state.showGuides);
  }

  // ===========================================================================
  // Right Sidebar Inspector Rendering
  // ===========================================================================

  /**
   * Renders a thumbnail preview canvas inside a container element.
   * @param {HTMLElement | null} wrap
   * @param {HTMLCanvasElement | null} sourceCanvas
   */
  function mountThumb(wrap, sourceCanvas) {
    if (!wrap) return;
    wrap.querySelectorAll('canvas').forEach((oldC) => Ops.releaseCanvas(oldC));
    wrap.innerHTML = '';
    if (!sourceCanvas) {
      const span = document.createElement('span');
      span.style.color = '#64748b';
      span.style.fontSize = '11px';
      span.textContent = 'Pendente';
      wrap.appendChild(span);
      return;
    }
    const maxW = 320;
    const maxH = 150;
    const s = Math.min(1, maxW / sourceCanvas.width, maxH / sourceCanvas.height);
    const tc = Ops.createCanvas(
      Math.max(1, Math.round(sourceCanvas.width * s)),
      Math.max(1, Math.round(sourceCanvas.height * s))
    );
    const ctx = tc.getContext('2d');
    if (ctx) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceCanvas, 0, 0, tc.width, tc.height);
    }
    wrap.appendChild(tc);
  }

  /**
   * Helper to get the canvas to export for (face + bordas imprecisas) honoring full vs cropped mode.
   */
  function getFaceImprecisaExportCanvas() {
    if (!state.faceImprecisaCanvas) return null;
    if (state.exportCroppedMode && state.mergeFaceBox) {
      return Ops.cropCanvas(state.faceImprecisaCanvas, state.mergeFaceBox);
    }
    return state.faceImprecisaCanvas;
  }

  function renderSidebar() {
    sidebarContent.innerHTML = '';

    if (state.activeStep === 1) {
      renderSidebarStep1();
    } else if (state.activeStep === 2) {
      renderSidebarStep2();
    } else if (state.activeStep === 3) {
      renderSidebarStep3();
    } else if (state.activeStep === 4) {
      renderSidebarStep4();
    } else if (state.activeStep === 5) {
      renderSidebarStep5();
    } else if (state.activeStep === 6) {
      renderSidebarStep6();
    }

    updateSidebarThumbnails();
    updateSidebarLiveValues();
  }

  function renderSidebarStep1() {
    const dimBadge = state.img1
      ? `<span class="badge cyan">${state.img1.width} × ${state.img1.height} px</span>`
      : `<span class="badge">Não carregada</span>`;

    const selBadge = state.selection1
      ? `<span class="badge emerald">${
          state.selection1.type === 'border-cut'
            ? 'Corte 2 Bordas'
            : state.selection1.type === 'auto-face'
            ? 'Auto (Rosto Pronto)'
            : 'Laço'
        }</span>`
      : `<span class="badge amber">Desenhe ou Auto</span>`;

    sidebarContent.innerHTML = `
      <div class="panel-card highlight-cyan">
        <div class="card-header">
          <div class="card-title">1. imagem1 — Cortar e Isolar Corpo</div>
          ${dimBadge}
        </div>
        <div class="btn-row">
          <button class="btn btn-primary btn-sm" style="flex:1" id="sbImportImg1">📂 Escolher imagem1</button>
          <button class="btn btn-sm" style="flex:1" id="sbPasteImg1">📋 Colar (Ctrl+V)</button>
        </div>
        <div class="btn-row" style="margin-top:2px">
          <button class="btn btn-prompt" style="flex:1" id="btnPromptOrigHair" title="Copiar prompt: estrita preservação do cabelo original na IA">
            📋 prompt; cabelo original
          </button>
          <button class="btn btn-prompt" style="flex:1" id="btnPromptRefHair" title="Copiar prompt: substituir cabelo pela referência na IA">
            📋 prompt; cabelo referencia
          </button>
        </div>
      </div>

      <div class="panel-card">
        <div class="card-header">
          <div class="card-title">Seleção &amp; Corte de Precisão</div>
          ${selBadge}
        </div>
        <div class="btn-row">
          <button class="btn btn-sm ${state.precisionCut ? 'btn-primary' : ''}" style="flex:1.3" id="btnSbPrecision1" title="Ativa lupa ampliada, sensibilidade reduzida e permite soltar o dedo e continuar">
            🔍 ${state.precisionCut ? 'Lupa Precisão ON' : 'Lupa Precisão'}
          </button>
          <button class="btn btn-sm" id="btnSbUndo1" ${!viewport.hasActiveStroke() && !state.prevSelection1 ? 'disabled' : ''} title="Desfaz último trecho desenhado ou seleção anterior">
            ↩ Desfazer
          </button>
        </div>
        ${
          state.precisionCut
            ? `<div class="precision-status-bar"><span>Lupa ${state.appSettings.loupeZoom.toFixed(1)}× • Solte o dedo e continue de onde parou</span></div>`
            : ''
        }
        <div class="btn-row">
          <button class="btn btn-sm" style="flex:1.4;font-weight:700" id="btnAutoSelectFace" title="Auto selecionar caso já possua imagem completa e rosto já isolado (complemento vira corpo)">
            ✨ Auto Selecionar
          </button>
          <button class="btn btn-amber btn-sm" style="flex:1" id="sbFlipRole1" ${!state.faceMask1 ? 'disabled' : ''}>
            ⇄ Inverter
          </button>
          <button class="btn btn-ghost btn-sm" id="sbClearCut1" ${!state.faceMask1 ? 'disabled' : ''}>
            Limpar
          </button>
        </div>
      </div>

      <div class="panel-card">
        <div class="card-header">
          <div class="card-title">Peças da imagem1</div>
          <button class="btn btn-xs btn-ghost" id="copyOrigImg1" ${!state.img1Canvas ? 'disabled' : ''}>📋 Copiar img1</button>
        </div>
        <div class="piece-grid">
          <div class="piece-card featured">
            <div class="piece-title"><span>Corpo Isolado</span><span class="badge amber">Corpo</span></div>
            <div class="piece-thumb-wrap" id="thumbCorpo1"></div>
            <div class="piece-actions">
              <button class="btn" id="copyCorpo1" ${!state.corpo1Canvas ? 'disabled' : ''}>📋 Copiar</button>
              <button class="btn" id="dlCorpo1" ${!state.corpo1Canvas ? 'disabled' : ''}>⬇ Salvar</button>
            </div>
          </div>
          <div class="piece-card">
            <div class="piece-title"><span>Face Isolada</span><span class="badge cyan">Face</span></div>
            <div class="piece-thumb-wrap" id="thumbFace1"></div>
            <div class="piece-actions">
              <button class="btn" id="copyFace1" ${!state.face1Canvas ? 'disabled' : ''}>📋 Copiar</button>
              <button class="btn" id="dlFace1" ${!state.face1Canvas ? 'disabled' : ''}>⬇ Salvar</button>
            </div>
          </div>
        </div>
      </div>

      <button class="btn btn-primary btn-block" id="sbNextTo2" ${!state.img1Canvas ? 'disabled' : ''}>
        Avançar para Etapa 2 (imagem2) →
      </button>
    `;

    document.getElementById('btnSbPrecision1')?.addEventListener('click', togglePrecisionCut);
    document.getElementById('btnSbUndo1')?.addEventListener('click', undoCutAction);
    document.getElementById('sbImportImg1')?.addEventListener('click', () => fileInputImg1.click());
    document.getElementById('sbPasteImg1')?.addEventListener('click', () => triggerClipboardPaste(1));
    document.getElementById('btnAutoSelectFace')?.addEventListener('click', openAutoSelectModal);
    document.getElementById('sbFlipRole1')?.addEventListener('click', flipCorpoAndFaceRole);
    document.getElementById('sbClearCut1')?.addEventListener('click', () => {
      if (state.selection1) {
        state.prevSelection1 = {
          selection: state.selection1,
          rawMask: state.rawMask1,
          faceIsOne: state.faceIsOne1,
        };
      }
      viewport.cancelActiveStroke();
      state.selection1 = null;
      state.rawMask1 = null;
      recomputeStep1Outputs(true);
      syncAllUI();
      scheduleAutoSaveProject();
    });

    document.getElementById('btnPromptOrigHair')?.addEventListener('click', async () => {
      try {
        const txt = (Prompts && Prompts.originalHair) || '';
        await Ops.copyTextToClipboard(txt);
        showToast('prompt; cabelo original copiado para a área de transferência!');
      } catch (err) {
        showToast('Falha ao copiar prompt: ' + err.message, true);
      }
    });

    document.getElementById('btnPromptRefHair')?.addEventListener('click', async () => {
      try {
        const txt = (Prompts && Prompts.referenceHair) || '';
        await Ops.copyTextToClipboard(txt);
        showToast('prompt; cabelo referencia copiado para a área de transferência!');
      } catch (err) {
        showToast('Falha ao copiar prompt: ' + err.message, true);
      }
    });

    bindCopyDownload('copyCorpo1', 'dlCorpo1', () => state.corpo1Canvas, 'imagem1_corpo_isolado.png');
    bindCopyDownload('copyFace1', 'dlFace1', () => state.face1Canvas, 'imagem1_face_isolada.png');
    document.getElementById('copyOrigImg1')?.addEventListener('click', () => {
      if (state.img1Canvas) copyWithToast(state.img1Canvas, 'imagem1 copiada!', 'imagem1.png');
    });
    document.getElementById('sbNextTo2')?.addEventListener('click', () => {
      if (!state.faceMask1) {
        showToast('Dica: desenhe o corte na imagem1 agora ou volte depois — ela sincroniza automaticamente!');
      }
      state.activeStep = 2;
      ensureStepComputed(2);
      syncAllUI();
    });
  }

  /**
   * Binds manual numeric inputs cleanly so users can select, delete, type negative numbers,
   * decimals (. or ,), and overwrite from any digit without cursor locking.
   *
   * @param {HTMLInputElement | null} inputEl
   * @param {{ min: number, max: number, decimals?: number, fallback?: number, onValid: (n: number) => void, onCommit?: (n: number) => void }} opts
   */
  function bindNumericInput(inputEl, opts) {
    if (!inputEl) return;
    const dec = opts.decimals ?? 0;
    const formatNum = (n) => (dec > 0 ? Number(n).toFixed(dec) : String(Math.round(n)));
    let valueOnFocus = inputEl.value;

    inputEl.addEventListener('focus', () => {
      valueOnFocus = inputEl.value;
      try {
        inputEl.select();
      } catch (_) {}
      const preventUp = (upEv) => {
        upEv.preventDefault();
        inputEl.removeEventListener('mouseup', preventUp);
      };
      inputEl.addEventListener('mouseup', preventUp, { once: true });
    });

    inputEl.addEventListener('input', () => {
      const normalized = inputEl.value.replace(/,/g, '.').trim();
      if (normalized === '' || normalized === '-' || normalized === '.' || normalized === '-.') {
        return;
      }
      const parsed = Number(normalized);
      if (!Number.isFinite(parsed)) return;
      const clamped = Math.max(opts.min, Math.min(opts.max, parsed));
      opts.onValid(clamped);
    });

    const commit = () => {
      const normalized = inputEl.value.replace(/,/g, '.').trim();
      let parsed = Number(normalized);
      if (normalized === '' || normalized === '-' || normalized === '.' || !Number.isFinite(parsed)) {
        parsed = opts.fallback !== undefined ? opts.fallback : Number(valueOnFocus) || 0;
      }
      const clamped = Math.max(opts.min, Math.min(opts.max, parsed));
      inputEl.value = formatNum(clamped);
      opts.onValid(clamped);
      if (opts.onCommit) opts.onCommit(clamped);
    };

    inputEl.addEventListener('blur', commit);
    inputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        inputEl.blur();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        inputEl.value = valueOnFocus;
        inputEl.blur();
      }
    });
  }

  function renderSidebarStep2() {
    const w1 = state.img1Canvas ? state.img1Canvas.width : 0;
    const h1 = state.img1Canvas ? state.img1Canvas.height : 0;
    const hasDiffRatio =
      state.img2 && w1 > 0
        ? Math.abs(state.img2.width / state.img2.height - w1 / h1) >= 0.004
        : false;

    const img2Badge = state.img2
      ? `<span class="badge ${hasDiffRatio ? 'amber' : 'emerald'}">${state.img2.width}×${state.img2.height}</span>`
      : `<span class="badge">Pendente</span>`;

    sidebarContent.innerHTML = `
      <div class="panel-card highlight-cyan">
        <div class="card-header">
          <div class="card-title">2. imagem2 — Padding &amp; Face</div>
          ${img2Badge}
        </div>
        <div class="btn-row">
          <button class="btn btn-primary btn-sm" style="flex:1" id="sbImportImg2">📂 Escolher imagem2</button>
          <button class="btn btn-sm" style="flex:1" id="sbPasteImg2">📋 Colar (Ctrl+V)</button>
        </div>
      </div>

      <div class="panel-card">
        <div class="card-header">
          <div class="card-title">Ajuste Manual e Anatômico</div>
          <div style="display:flex;gap:3px">
            <button class="btn btn-xs btn-primary" id="btnSbEyeCalib" ${!state.img2 ? 'disabled' : ''} title="Calibrador matemático por 2 cliques nos olhos (IPD)">🎯 Olhos</button>
            <button class="btn btn-xs ${state.showAnatomicGuides ? 'btn-amber' : ''}" id="btnSbAnatomic" ${!state.img2 ? 'disabled' : ''} title="Alternar guias anatômicas cranianas e ombros">📏 Guias</button>
            <button class="btn btn-xs" id="btnSbFlicker" ${!state.img2 ? 'disabled' : ''} title="Segure para piscar/alternar com o original (Tecla F)">👁️ Piscar</button>
          </div>
        </div>
        <div class="control-row">
          <div class="control-label">
            <span>Escala</span>
            <span class="control-val" id="valImg2Scale">100%</span>
          </div>
          <div class="slider-line">
            <input type="range" id="rngImg2Scale" min="20" max="300" step="0.5" value="${state.img2Transform.scale * 100}" ${!state.img2 ? 'disabled' : ''} />
            <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" class="num-input" id="numImg2Scale" value="${Math.round(state.img2Transform.scale * 100)}" ${!state.img2 ? 'disabled' : ''} />
          </div>
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Rotação</span>
            <span class="control-val" id="valImg2Rot">${(state.img2Transform.rotation || 0).toFixed(1)}°</span>
          </div>
          <div class="slider-line">
            <input type="range" id="rngImg2Rot" min="-180" max="180" step="0.5" value="${state.img2Transform.rotation || 0}" ${!state.img2 ? 'disabled' : ''} />
            <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" class="num-input" style="width:54px" id="numImg2Rot" value="${(state.img2Transform.rotation || 0).toFixed(1)}" ${!state.img2 ? 'disabled' : ''} />
            <button class="btn btn-xs" id="btnRotNudgeLeft" ${!state.img2 ? 'disabled' : ''} title="Girar -1°">↶-1°</button>
            <button class="btn btn-xs" id="btnRotReset" ${!state.img2 ? 'disabled' : ''} title="Zerar Rotação">↺0°</button>
            <button class="btn btn-xs" id="btnRotNudgeRight" ${!state.img2 ? 'disabled' : ''} title="Girar +1°">↷+1°</button>
          </div>
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Posição X / Y (px)</span>
            <span class="control-val" id="valImg2XY">0, 0</span>
          </div>
          <div class="slider-line">
            <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" class="num-input" style="flex:1" id="numImg2X" value="${Math.round(state.img2Transform.x)}" ${!state.img2 ? 'disabled' : ''} title="Deslocamento X" />
            <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" class="num-input" style="flex:1" id="numImg2Y" value="${Math.round(state.img2Transform.y)}" ${!state.img2 ? 'disabled' : ''} title="Deslocamento Y" />
            <button class="btn btn-xs" id="btnImg2ResetContain" ${!state.img2 ? 'disabled' : ''} title="Centralizar">🎯 Centralizar</button>
            <button class="btn btn-xs" id="btnImg2Cover" ${!state.img2 ? 'disabled' : ''} title="Preencher">⛶ Preencher</button>
          </div>
          <div class="nudge-row">
            <button class="btn btn-xs" id="btnImg2NudgeL" ${!state.img2 ? 'disabled' : ''} title="Mover 2px para esquerda">←</button>
            <button class="btn btn-xs" id="btnImg2NudgeU" ${!state.img2 ? 'disabled' : ''} title="Mover 2px para cima">↑</button>
            <button class="btn btn-xs" id="btnImg2NudgeD" ${!state.img2 ? 'disabled' : ''} title="Mover 2px para baixo">↓</button>
            <button class="btn btn-xs" id="btnImg2NudgeR" ${!state.img2 ? 'disabled' : ''} title="Mover 2px para direita">→</button>
          </div>
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Sobreposição imagem1</span>
            <span class="control-val" id="valImg2Onion">${Math.round(state.img2OnionOpacity * 100)}%</span>
          </div>
          <input type="range" id="rngImg2Onion" min="0" max="100" step="1" value="${Math.round(state.img2OnionOpacity * 100)}" ${!state.img2 ? 'disabled' : ''} />
        </div>
      </div>

      <div class="panel-card">
        <div class="card-header">
          <div class="card-title">Face Isolada (Mesma Seleção)</div>
          <button class="btn btn-xs btn-amber" id="sbFlipRole2" ${!state.faceMask1 ? 'disabled' : ''}>⇄ Inverter</button>
        </div>
        <div class="piece-grid">
          <div class="piece-card featured">
            <div class="piece-title"><span>Face (img2)</span><span class="badge cyan">Face</span></div>
            <div class="piece-thumb-wrap" id="thumbFace2"></div>
            <div class="piece-actions">
              <button class="btn" id="copyFace2" ${!state.face2Canvas ? 'disabled' : ''}>📋 Copiar</button>
              <button class="btn" id="dlFace2" ${!state.face2Canvas ? 'disabled' : ''}>⬇ Salvar</button>
            </div>
          </div>
          <div class="piece-card">
            <div class="piece-title"><span>img2 c/ Padding</span></div>
            <div class="piece-thumb-wrap" id="thumbImg2Pad"></div>
            <div class="piece-actions">
              <button class="btn" id="copyImg2Pad" ${!state.img2AlignedCanvas ? 'disabled' : ''}>📋 Copiar</button>
              <button class="btn" id="dlImg2Pad" ${!state.img2AlignedCanvas ? 'disabled' : ''}>⬇ Salvar</button>
            </div>
          </div>
        </div>
      </div>

      <button class="btn btn-primary btn-block" id="sbNextTo3" ${!(state.face2Canvas && state.corpo1Canvas) ? 'disabled' : ''}>
        Unir Corpo + Face → Etapa 3 (imagemMerge) →
      </button>
    `;

    document.getElementById('sbImportImg2')?.addEventListener('click', () => fileInputImg2.click());
    document.getElementById('sbPasteImg2')?.addEventListener('click', () => triggerClipboardPaste(2));
    document.getElementById('sbFlipRole2')?.addEventListener('click', flipCorpoAndFaceRole);

    document.getElementById('btnSbEyeCalib')?.addEventListener('click', openEyeCalibrateModal);
    document.getElementById('btnSbAnatomic')?.addEventListener('click', () => {
      state.showAnatomicGuides = !state.showAnatomicGuides;
      syncViewportScene();
      renderSidebar();
      renderStageToolbar();
    });
    const sbFlick = document.getElementById('btnSbFlicker');
    bindFlickerControl(sbFlick, true);

    const rngScale = /** @type {HTMLInputElement | null} */ (document.getElementById('rngImg2Scale'));
    const numScale = /** @type {HTMLInputElement | null} */ (document.getElementById('numImg2Scale'));
    const rngRot = /** @type {HTMLInputElement | null} */ (document.getElementById('rngImg2Rot'));
    const numRot = /** @type {HTMLInputElement | null} */ (document.getElementById('numImg2Rot'));
    const numX = /** @type {HTMLInputElement | null} */ (document.getElementById('numImg2X'));
    const numY = /** @type {HTMLInputElement | null} */ (document.getElementById('numImg2Y'));
    const rngOnion = /** @type {HTMLInputElement | null} */ (document.getElementById('rngImg2Onion'));

    rngScale?.addEventListener('input', () => {
      state.step2View = 'align';
      state.img2Transform.scale = Math.max(0.1, Number(rngScale.value) / 100);
      updateSidebarLiveValues();
      scheduleLiveRecompute(() => {
        recomputeStep2Outputs();
        syncViewportScene();
      });
    });
    rngScale?.addEventListener('change', () => {
      recomputeStep2Outputs();
      syncViewportScene();
      updateSidebarThumbnails();
      scheduleAutoSaveProject();
    });

    bindNumericInput(numScale, {
      min: 10,
      max: 800,
      decimals: 0,
      fallback: 100,
      onValid: (val) => {
        state.step2View = 'align';
        state.img2Transform.scale = val / 100;
        updateSidebarLiveValues();
        scheduleLiveRecompute(() => {
          recomputeStep2Outputs();
          syncViewportScene();
        });
      },
      onCommit: () => {
        recomputeStep2Outputs();
        syncViewportScene();
        updateSidebarThumbnails();
        scheduleAutoSaveProject();
      },
    });

    rngRot?.addEventListener('input', () => {
      state.step2View = 'align';
      state.img2Transform.rotation = Number(rngRot.value) || 0;
      updateSidebarLiveValues();
      scheduleLiveRecompute(() => {
        recomputeStep2Outputs();
        syncViewportScene();
      });
    });
    rngRot?.addEventListener('change', () => {
      recomputeStep2Outputs();
      syncViewportScene();
      updateSidebarThumbnails();
      scheduleAutoSaveProject();
    });

    bindNumericInput(numRot, {
      min: -180,
      max: 180,
      decimals: 1,
      fallback: 0,
      onValid: (val) => {
        state.step2View = 'align';
        state.img2Transform.rotation = val;
        updateSidebarLiveValues();
        scheduleLiveRecompute(() => {
          recomputeStep2Outputs();
          syncViewportScene();
        });
      },
      onCommit: () => {
        recomputeStep2Outputs();
        syncViewportScene();
        updateSidebarThumbnails();
        scheduleAutoSaveProject();
      },
    });

    document.getElementById('btnRotNudgeLeft')?.addEventListener('click', () => {
      state.step2View = 'align';
      state.img2Transform.rotation =
        Math.round(((state.img2Transform.rotation || 0) - 1) * 10) / 10;
      recomputeStep2Outputs();
      syncViewportScene();
      updateSidebarLiveValues();
      updateSidebarThumbnails();
      scheduleAutoSaveProject();
    });

    document.getElementById('btnRotReset')?.addEventListener('click', () => {
      state.step2View = 'align';
      state.img2Transform.rotation = 0;
      recomputeStep2Outputs();
      syncViewportScene();
      updateSidebarLiveValues();
      updateSidebarThumbnails();
      scheduleAutoSaveProject();
    });

    document.getElementById('btnRotNudgeRight')?.addEventListener('click', () => {
      state.step2View = 'align';
      state.img2Transform.rotation =
        Math.round(((state.img2Transform.rotation || 0) + 1) * 10) / 10;
      recomputeStep2Outputs();
      syncViewportScene();
      updateSidebarLiveValues();
      updateSidebarThumbnails();
      scheduleAutoSaveProject();
    });

    bindNumericInput(numX, {
      min: -5000,
      max: 5000,
      decimals: 0,
      fallback: 0,
      onValid: (val) => {
        state.step2View = 'align';
        state.img2Transform.x = val;
        updateSidebarLiveValues();
        scheduleLiveRecompute(() => {
          recomputeStep2Outputs();
          syncViewportScene();
        });
      },
      onCommit: () => {
        recomputeStep2Outputs();
        syncViewportScene();
        updateSidebarThumbnails();
        scheduleAutoSaveProject();
      },
    });
    bindNumericInput(numY, {
      min: -5000,
      max: 5000,
      decimals: 0,
      fallback: 0,
      onValid: (val) => {
        state.step2View = 'align';
        state.img2Transform.y = val;
        updateSidebarLiveValues();
        scheduleLiveRecompute(() => {
          recomputeStep2Outputs();
          syncViewportScene();
        });
      },
      onCommit: () => {
        recomputeStep2Outputs();
        syncViewportScene();
        updateSidebarThumbnails();
        scheduleAutoSaveProject();
      },
    });

    const nudgeImg2 = (dx, dy) => {
      state.step2View = 'align';
      state.img2Transform.x = Math.round((state.img2Transform.x + dx) * 10) / 10;
      state.img2Transform.y = Math.round((state.img2Transform.y + dy) * 10) / 10;
      recomputeStep2Outputs();
      syncViewportScene();
      updateSidebarLiveValues();
      updateSidebarThumbnails();
    };
    document.getElementById('btnImg2NudgeL')?.addEventListener('click', () => nudgeImg2(-2, 0));
    document.getElementById('btnImg2NudgeR')?.addEventListener('click', () => nudgeImg2(2, 0));
    document.getElementById('btnImg2NudgeU')?.addEventListener('click', () => nudgeImg2(0, -2));
    document.getElementById('btnImg2NudgeD')?.addEventListener('click', () => nudgeImg2(0, 2));

    rngOnion?.addEventListener('input', () => {
      state.step2View = 'align';
      state.img2OnionOpacity = Number(rngOnion.value) / 100;
      syncViewportScene();
      updateSidebarLiveValues();
    });

    document.getElementById('btnImg2ResetContain')?.addEventListener('click', () => {
      state.img2Transform = { x: 0, y: 0, scale: 1, rotation: 0 };
      state.step2View = 'align';
      recomputeStep2Outputs();
      syncAllUI();
    });

    document.getElementById('btnImg2Cover')?.addEventListener('click', () => {
      if (!state.img2 || !state.img1Canvas) return;
      const W1 = state.img1Canvas.width;
      const H1 = state.img1Canvas.height;
      const fitS = Math.min(W1 / state.img2.width, H1 / state.img2.height);
      const coverS = Math.max(W1 / state.img2.width, H1 / state.img2.height);
      state.img2Transform = { x: 0, y: 0, scale: coverS / fitS };
      state.step2View = 'align';
      recomputeStep2Outputs();
      syncAllUI();
    });

    bindCopyDownload('copyFace2', 'dlFace2', () => state.face2Canvas, 'imagem2_face_isolada.png');
    bindCopyDownload('copyImg2Pad', 'dlImg2Pad', () => state.img2AlignedCanvas, 'imagem2_padding_alinhada.png');

    document.getElementById('sbNextTo3')?.addEventListener('click', () => {
      state.activeStep = 3;
      ensureStepComputed(3);
      syncAllUI();
    });
  }

  function renderSidebarStep3() {
    const maxExpand = state.img1Canvas
      ? Math.round(Math.max(180, Math.min(state.img1Canvas.width, state.img1Canvas.height) * 0.35))
      : 250;

    sidebarContent.innerHTML = `
      <div class="panel-card highlight-cyan">
        <div class="card-header">
          <div class="card-title">3. imagemMerge — Unir &amp; Bordas</div>
          <span class="badge emerald">Corpo + Face</span>
        </div>
        <div class="btn-row">
          <button class="btn btn-sm" style="flex:1" id="copyMergeFull" ${!state.imgMergeCanvas ? 'disabled' : ''}>📋 Copiar imagemMerge</button>
          <button class="btn btn-sm" style="flex:1" id="dlMergeFull" ${!state.imgMergeCanvas ? 'disabled' : ''}>⬇ Salvar PNG</button>
        </div>
      </div>

      <div class="panel-card">
        <div class="card-header">
          <div class="card-title">Região (Face + Bordas Imprecisas)</div>
        </div>
        <div class="segmented">
          <button class="seg-btn ${state.mergeRegionMode === 'expand' ? 'active' : ''}" id="segModeExpand">
            Expansão Automática
          </button>
          <button class="seg-btn ${state.mergeRegionMode === 'custom' ? 'active' : ''}" id="segModeCustom">
            Novo Corte / Laço
          </button>
        </div>

        ${
          state.mergeRegionMode === 'expand'
            ? `
          <div class="control-row" style="margin-top:4px">
            <div class="control-label">
              <span>Expansão da Face sobre Corpo</span>
              <span class="control-val" id="valExpandPx">+${state.expandPx} px</span>
            </div>
            <div class="slider-line">
              <input type="range" id="rngExpandPx" min="-20" max="${maxExpand}" step="1" value="${state.expandPx}" ${!state.imgMergeCanvas ? 'disabled' : ''} />
              <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" class="num-input" id="numExpandPx" value="${state.expandPx}" ${!state.imgMergeCanvas ? 'disabled' : ''} />
            </div>
          </div>
        `
            : `
          <div class="btn-row" style="margin-top:4px">
            <button class="btn btn-xs btn-amber" style="flex:1" id="btnFlipCustom2" ${!state.customRawMask2 ? 'disabled' : ''}>
              ⇄ Inverter
            </button>
            <button class="btn btn-xs btn-ghost" id="btnClearCustom2" ${!state.customRawMask2 ? 'disabled' : ''}>
              Limpar
            </button>
          </div>
          <div class="control-row">
            <div class="control-label">
              <span>Ajuste fino extra</span>
              <span class="control-val" id="valCustomExtraPx">${state.customExtraExpandPx >= 0 ? '+' : ''}${state.customExtraExpandPx} px</span>
            </div>
            <input type="range" id="rngCustomExtraPx" min="-30" max="150" step="1" value="${state.customExtraExpandPx}" ${!state.customRawMask2 ? 'disabled' : ''} />
          </div>
        `
        }
      </div>

      <div class="panel-card">
        <div class="card-header">
          <div class="card-title">Peças Isoladas da imagemMerge</div>
          <label class="checkbox-row" style="margin:0">
            <input type="checkbox" id="chkExportCrop" ${state.exportCroppedMode ? 'checked' : ''} />
            <span>Recorte Focado</span>
          </label>
        </div>

        <div class="piece-grid">
          <div class="piece-card featured">
            <div class="piece-title">
              <span>Face + Bordas Imp.</span>
              <span class="badge cyan">Para IA</span>
            </div>
            <div class="piece-thumb-wrap" id="thumbFaceImp"></div>
            <div class="piece-actions">
              <button class="btn btn-primary" id="copyFaceImp" ${!state.faceImprecisaCanvas ? 'disabled' : ''}>📋 Copiar</button>
              <button class="btn" id="dlFaceImp" ${!state.faceImprecisaCanvas ? 'disabled' : ''}>⬇ Salvar</button>
            </div>
          </div>

          <div class="piece-card">
            <div class="piece-title">
              <span>Corpo s/ Bordas</span>
            </div>
            <div class="piece-thumb-wrap" id="thumbCorpoClean"></div>
            <div class="piece-actions">
              <button class="btn" id="copyCorpoClean" ${!state.corpoSemBordasCanvas ? 'disabled' : ''}>📋 Copiar</button>
              <button class="btn" id="dlCorpoClean" ${!state.corpoSemBordasCanvas ? 'disabled' : ''}>⬇ Salvar</button>
            </div>
          </div>
        </div>
      </div>

      <button class="btn btn-primary btn-block" id="sbNextTo4" ${!state.faceImprecisaCanvas ? 'disabled' : ''}>
        Ir para Etapa 4: IA → Face + Bordas Precisas →
      </button>
    `;

    bindCopyDownload('copyMergeFull', 'dlMergeFull', () => state.imgMergeCanvas, 'imagemMerge.png');

    document.getElementById('segModeExpand')?.addEventListener('click', () => {
      state.mergeRegionMode = 'expand';
      recomputeStep3Outputs(false);
      syncAllUI();
    });

    document.getElementById('segModeCustom')?.addEventListener('click', () => {
      state.mergeRegionMode = 'custom';
      state.step3Tool = 'cut';
      state.step3View = 'split';
      recomputeStep3Outputs(false);
      syncAllUI();
    });

    const rngExpand = /** @type {HTMLInputElement | null} */ (document.getElementById('rngExpandPx'));
    const numExpand = /** @type {HTMLInputElement | null} */ (document.getElementById('numExpandPx'));

    rngExpand?.addEventListener('input', () => {
      state.expandPx = Number(rngExpand.value) || 0;
      updateSidebarLiveValues();
      scheduleLiveRecompute(() => {
        recomputeStep3Outputs(false);
        syncViewportScene();
      });
    });
    rngExpand?.addEventListener('change', () => {
      recomputeStep3Outputs(false);
      syncViewportScene();
      updateSidebarThumbnails();
      scheduleAutoSaveProject();
    });

    bindNumericInput(numExpand, {
      min: -50,
      max: maxExpand,
      decimals: 0,
      fallback: state.expandPx,
      onValid: (val) => {
        state.expandPx = Math.round(val);
        updateSidebarLiveValues();
        scheduleLiveRecompute(() => {
          recomputeStep3Outputs(false);
          syncViewportScene();
        });
      },
      onCommit: () => {
        recomputeStep3Outputs(false);
        syncViewportScene();
        updateSidebarThumbnails();
        scheduleAutoSaveProject();
      },
    });

    document.getElementById('btnFlipCustom2')?.addEventListener('click', flipCustomMergeRole);
    document.getElementById('btnClearCustom2')?.addEventListener('click', () => {
      state.customSelection2 = null;
      state.customRawMask2 = null;
      state.customExtraExpandPx = 0;
      recomputeStep3Outputs(false);
      syncAllUI();
    });

    const rngCustomExtra = /** @type {HTMLInputElement | null} */ (
      document.getElementById('rngCustomExtraPx')
    );
    rngCustomExtra?.addEventListener('input', () => {
      state.customExtraExpandPx = Number(rngCustomExtra.value) || 0;
      recomputeStep3Outputs(false);
      syncViewportScene();
      updateSidebarLiveValues();
    });
    rngCustomExtra?.addEventListener('change', () => updateSidebarThumbnails());

    const chkCrop = /** @type {HTMLInputElement | null} */ (document.getElementById('chkExportCrop'));
    chkCrop?.addEventListener('change', () => {
      state.exportCroppedMode = chkCrop.checked;
      state.refinedTargetMode = chkCrop.checked ? 'cropbox' : 'full';
      recomputeStep4Outputs();
      syncViewportScene();
      updateSidebarThumbnails();
    });

    bindCopyDownload(
      'copyFaceImp',
      'dlFaceImp',
      getFaceImprecisaExportCanvas,
      'face_mais_bordas_imprecisas.png'
    );
    bindCopyDownload(
      'copyCorpoClean',
      'dlCorpoClean',
      () => state.corpoSemBordasCanvas,
      'corpo_sem_bordas_imprecisas.png'
    );

    document.getElementById('sbNextTo4')?.addEventListener('click', () => {
      state.activeStep = 4;
      ensureStepComputed(4);
      syncAllUI();
    });
  }

  function renderSidebarStep4() {
    sidebarContent.innerHTML = `
      <div class="panel-card highlight-cyan">
        <div class="card-header">
          <div class="card-title">4. IA → Face + Bordas Precisas</div>
          ${state.imgRefined ? `<span class="badge emerald">${state.imgRefined.width}×${state.imgRefined.height}</span>` : `<span class="badge">Pendente</span>`}
        </div>
        <div class="btn-row">
          <button class="btn btn-sm btn-ghost" style="flex:1.2" id="sbQuickCopyImp" ${!state.faceImprecisaCanvas ? 'disabled' : ''}>
            📋 Copiar p/ IA
          </button>
          <button class="btn btn-primary btn-sm" style="flex:1" id="sbImportRefined">📂 Abrir</button>
          <button class="btn btn-sm" style="flex:1" id="sbPasteRefined">📋 Colar</button>
        </div>
      </div>

      <div class="panel-card">
        <div class="card-header">
          <div class="card-title">Encaixe &amp; Ajuste Manual</div>
        </div>
        <div class="segmented">
          <button class="seg-btn ${state.refinedTargetMode === 'full' ? 'active' : ''}" id="segRefFull">
            Quadro Completo
          </button>
          <button class="seg-btn ${state.refinedTargetMode === 'cropbox' ? 'active' : ''}" id="segRefCrop">
            Recorte da Seleção
          </button>
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Escala</span>
            <span class="control-val" id="valRefScale">100%</span>
          </div>
          <div class="slider-line">
            <input type="range" id="rngRefScale" min="20" max="300" step="0.5" value="${state.refinedTransform.scale * 100}" ${!state.imgRefined ? 'disabled' : ''} />
            <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" class="num-input" id="numRefScale" value="${Math.round(state.refinedTransform.scale * 100)}" ${!state.imgRefined ? 'disabled' : ''} />
          </div>
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Posição X / Y (px)</span>
            <span class="control-val" id="valRefXY">0, 0</span>
          </div>
          <div class="slider-line">
            <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" class="num-input" style="flex:1" id="numRefX" value="${Math.round(state.refinedTransform.x)}" ${!state.imgRefined ? 'disabled' : ''} />
            <input type="text" inputmode="decimal" autocomplete="off" spellcheck="false" class="num-input" style="flex:1" id="numRefY" value="${Math.round(state.refinedTransform.y)}" ${!state.imgRefined ? 'disabled' : ''} />
          </div>
          <div class="nudge-row">
            <button class="btn btn-xs" id="btnRefNudgeL" ${!state.imgRefined ? 'disabled' : ''} title="Mover 2px para esquerda">←</button>
            <button class="btn btn-xs" id="btnRefNudgeU" ${!state.imgRefined ? 'disabled' : ''} title="Mover 2px para cima">↑</button>
            <button class="btn btn-xs" id="btnRefNudgeD" ${!state.imgRefined ? 'disabled' : ''} title="Mover 2px para baixo">↓</button>
            <button class="btn btn-xs" id="btnRefNudgeR" ${!state.imgRefined ? 'disabled' : ''} title="Mover 2px para direita">→</button>
          </div>
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Sobreposição imagemMerge</span>
            <span class="control-val" id="valRefOnion">${Math.round(state.refinedOnionOpacity * 100)}%</span>
          </div>
          <input type="range" id="rngRefOnion" min="0" max="100" step="1" value="${Math.round(state.refinedOnionOpacity * 100)}" ${!state.imgRefined ? 'disabled' : ''} />
        </div>

        <div class="btn-row">
          <button class="btn btn-sm" style="flex:1" id="btnRefReset" ${!state.imgRefined ? 'disabled' : ''}>
            🎯 Centralizar
          </button>
          <button class="btn btn-sm" style="flex:1" id="btnRefCover" ${!state.imgRefined ? 'disabled' : ''}>
            ⛶ Preencher
          </button>
        </div>
      </div>

      <div class="panel-card">
        <div class="card-header">
          <div class="card-title">Peça Isolada (Face + Bordas Precisas)</div>
        </div>
        <div class="piece-grid single">
          <div class="piece-card featured">
            <div class="piece-title">
              <span>Face + Bordas Precisas</span>
              <span class="badge emerald">Refinada</span>
            </div>
            <div class="piece-thumb-wrap" id="thumbFacePrec"></div>
            <div class="piece-actions">
              <button class="btn" id="copyFacePrec" ${!state.facePrecisaCanvas ? 'disabled' : ''}>📋 Copiar</button>
              <button class="btn" id="dlFacePrec" ${!state.facePrecisaCanvas ? 'disabled' : ''}>⬇ Salvar</button>
            </div>
          </div>
        </div>
      </div>

      <button class="btn btn-emerald btn-block" id="sbNextTo5" ${!state.imgFinalCanvas ? 'disabled' : ''}>
        ✨ Ver imagemFinal (União Completa) →
      </button>
    `;

    document.getElementById('sbQuickCopyImp')?.addEventListener('click', () => {
      const c = getFaceImprecisaExportCanvas();
      if (c) {
        copyWithToast(
          c,
          '(Face + bordas imprecisas) copiada para a área de transferência!',
          'face_mais_bordas_imprecisas.png'
        );
      }
    });

    document.getElementById('sbImportRefined')?.addEventListener('click', () => fileInputRefined.click());
    document.getElementById('sbPasteRefined')?.addEventListener('click', () => triggerClipboardPaste(4));

    document.getElementById('segRefFull')?.addEventListener('click', () => {
      state.refinedTargetMode = 'full';
      state.refinedTransform = { x: 0, y: 0, scale: 1 };
      recomputeStep4Outputs();
      syncAllUI();
    });
    document.getElementById('segRefCrop')?.addEventListener('click', () => {
      state.refinedTargetMode = 'cropbox';
      state.refinedTransform = { x: 0, y: 0, scale: 1 };
      recomputeStep4Outputs();
      syncAllUI();
    });

    const rngScale = /** @type {HTMLInputElement | null} */ (document.getElementById('rngRefScale'));
    const numScale = /** @type {HTMLInputElement | null} */ (document.getElementById('numRefScale'));
    const numX = /** @type {HTMLInputElement | null} */ (document.getElementById('numRefX'));
    const numY = /** @type {HTMLInputElement | null} */ (document.getElementById('numRefY'));
    const rngOnion = /** @type {HTMLInputElement | null} */ (document.getElementById('rngRefOnion'));

    rngScale?.addEventListener('input', () => {
      state.step4View = 'align';
      state.refinedTransform.scale = Math.max(0.1, Number(rngScale.value) / 100);
      updateSidebarLiveValues();
      scheduleLiveRecompute(() => {
        recomputeStep4Outputs();
        syncViewportScene();
      });
    });
    rngScale?.addEventListener('change', () => {
      recomputeStep4Outputs();
      syncViewportScene();
      updateSidebarThumbnails();
      scheduleAutoSaveProject();
    });

    bindNumericInput(numScale, {
      min: 10,
      max: 800,
      decimals: 0,
      fallback: 100,
      onValid: (val) => {
        state.step4View = 'align';
        state.refinedTransform.scale = val / 100;
        updateSidebarLiveValues();
        scheduleLiveRecompute(() => {
          recomputeStep4Outputs();
          syncViewportScene();
        });
      },
      onCommit: () => {
        recomputeStep4Outputs();
        syncViewportScene();
        updateSidebarThumbnails();
        scheduleAutoSaveProject();
      },
    });

    bindNumericInput(numX, {
      min: -5000,
      max: 5000,
      decimals: 0,
      fallback: 0,
      onValid: (val) => {
        state.step4View = 'align';
        state.refinedTransform.x = val;
        updateSidebarLiveValues();
        scheduleLiveRecompute(() => {
          recomputeStep4Outputs();
          syncViewportScene();
        });
      },
      onCommit: () => {
        recomputeStep4Outputs();
        syncViewportScene();
        updateSidebarThumbnails();
        scheduleAutoSaveProject();
      },
    });
    bindNumericInput(numY, {
      min: -5000,
      max: 5000,
      decimals: 0,
      fallback: 0,
      onValid: (val) => {
        state.step4View = 'align';
        state.refinedTransform.y = val;
        updateSidebarLiveValues();
        scheduleLiveRecompute(() => {
          recomputeStep4Outputs();
          syncViewportScene();
        });
      },
      onCommit: () => {
        recomputeStep4Outputs();
        syncViewportScene();
        updateSidebarThumbnails();
        scheduleAutoSaveProject();
      },
    });

    const nudgeRef = (dx, dy) => {
      state.step4View = 'align';
      state.refinedTransform.x = Math.round((state.refinedTransform.x + dx) * 10) / 10;
      state.refinedTransform.y = Math.round((state.refinedTransform.y + dy) * 10) / 10;
      recomputeStep4Outputs();
      syncViewportScene();
      updateSidebarLiveValues();
      updateSidebarThumbnails();
    };
    document.getElementById('btnRefNudgeL')?.addEventListener('click', () => nudgeRef(-2, 0));
    document.getElementById('btnRefNudgeR')?.addEventListener('click', () => nudgeRef(2, 0));
    document.getElementById('btnRefNudgeU')?.addEventListener('click', () => nudgeRef(0, -2));
    document.getElementById('btnRefNudgeD')?.addEventListener('click', () => nudgeRef(0, 2));

    rngOnion?.addEventListener('input', () => {
      state.step4View = 'align';
      state.refinedOnionOpacity = Number(rngOnion.value) / 100;
      syncViewportScene();
      updateSidebarLiveValues();
    });

    document.getElementById('btnRefReset')?.addEventListener('click', () => {
      state.refinedTransform = { x: 0, y: 0, scale: 1 };
      state.step4View = 'align';
      recomputeStep4Outputs();
      syncAllUI();
    });

    document.getElementById('btnRefCover')?.addEventListener('click', () => {
      if (!state.imgRefined || !state.img1Canvas) return;
      const box =
        state.refinedTargetMode === 'cropbox' && state.mergeFaceBox
          ? state.mergeFaceBox
          : { x: 0, y: 0, w: state.img1Canvas.width, h: state.img1Canvas.height };
      const fitS = Math.min(box.w / state.imgRefined.width, box.h / state.imgRefined.height);
      const coverS = Math.max(box.w / state.imgRefined.width, box.h / state.imgRefined.height);
      state.refinedTransform = { x: 0, y: 0, scale: coverS / fitS };
      state.step4View = 'align';
      recomputeStep4Outputs();
      syncAllUI();
    });

    bindCopyDownload('copyFacePrec', 'dlFacePrec', () => state.facePrecisaCanvas, 'face_mais_bordas_precisas.png');

    document.getElementById('sbNextTo5')?.addEventListener('click', () => {
      state.activeStep = 5;
      ensureStepComputed(5);
      syncAllUI();
    });
  }

  let _step5RafPending = false;
  function scheduleStep5LiveUpdate() {
    updateSidebarLiveValues();
    if (_step5RafPending) return;
    _step5RafPending = true;
    requestAnimationFrame(() => {
      _step5RafPending = false;
      recomputeStep5Outputs();
      syncViewportScene();
    });
  }

  function renderSidebarStep5() {
    const dimText = state.imgFinalCanvas
      ? `${state.imgFinalCanvas.width} × ${state.imgFinalCanvas.height} px`
      : 'Pendente';

    const fm = state.finalMerge;
    const disabledAttr = !state.facePrecisaCanvas ? 'disabled' : '';

    /** @type {{ id: FinalMergeMode, title: string, sub: string, span2?: boolean }[]} */
    const techniques = [
      { id: 'none', title: 'Corte Exato', sub: 'Sem suavização' },
      { id: 'feather', title: 'Feather', sub: 'Cross-fade clássico' },
      { id: 'multiband', title: 'Multi-Band ★', sub: 'Pirâmide nitidez' },
      { id: 'poisson', title: 'Poisson Clone ★', sub: 'Gradiente de luz/cor' },
      { id: 'lab_skin', title: 'Pele CIE LAB ★', sub: 'Iguala tom/calor' },
      { id: 'luma_chroma', title: 'Luma × Chroma', sub: 'Cor ampla • Detalhe firme' },
      { id: 'edge_aware', title: 'Adaptativo (Pele × Roupa)', sub: 'Suave na pele, firme na roupa', span2: true },
    ];

    const techButtonsHtml = techniques
      .map(
        (t) => `
        <button class="tech-btn ${fm.mode === t.id ? 'active' : ''}" data-tech="${t.id}" ${
          t.span2 ? 'style="grid-column: span 2"' : ''
        } ${disabledAttr}>
          <span class="tech-btn-title">${t.title}</span>
          <span class="tech-btn-sub">${t.sub}</span>
        </button>`
      )
      .join('');

    sidebarContent.innerHTML = `
      <div class="panel-card highlight-emerald">
        <div class="card-header">
          <div class="card-title">5. imagemFinal — Resultado Unido</div>
          <span class="badge emerald">${dimText}</span>
        </div>
        <div class="piece-grid single">
          <div class="piece-card featured" style="border-color:rgba(16,185,129,0.5)">
            <div class="piece-thumb-wrap" id="thumbFinal"></div>
          </div>
        </div>
        <div class="btn-row">
          <button class="btn btn-emerald btn-sm" style="flex:1" id="copyImgFinal" ${disabledAttr}>
            📋 Copiar
          </button>
          <button class="btn btn-primary btn-sm" style="flex:1" id="dlImgFinal" ${disabledAttr}>
            ⬇ Salvar PNG
          </button>
        </div>
      </div>

      <div class="panel-card highlight-cyan">
        <div class="card-header">
          <div class="card-title">Técnicas de Fusão &amp; Pele</div>
          <span class="badge cyan">IA × Original</span>
        </div>

        <div class="tech-grid" id="techGrid">
          ${techButtonsHtml}
        </div>

        ${
          fm.mode !== 'none'
            ? `
          <div class="control-row">
            <div class="control-label">
              <span>${fm.mode === 'poisson' ? 'Suavização micro' : 'Raio de fusão'}</span>
              <span class="control-val" id="valFinalRadius">${fm.radiusPx} px</span>
            </div>
            <input type="range" id="rngFinalRadius" min="1" max="110" step="1" value="${fm.radiusPx}" ${disabledAttr} />
          </div>
        `
            : ''
        }

        ${
          fm.mode === 'poisson'
            ? `
          <div class="control-row">
            <div class="control-label">
              <span>Alcance na pele</span>
              <span class="control-val" id="valPoissonReach">${Math.round(fm.poissonReach * 100)}%</span>
            </div>
            <input type="range" id="rngPoissonReach" min="10" max="100" step="1" value="${Math.round(fm.poissonReach * 100)}" ${disabledAttr} />
          </div>
        `
            : ''
        }

        <div class="control-row">
          <div class="control-label">
            <span>Harmonizar Tom de Pele (CIE LAB)</span>
            <span class="control-val" id="valColorMatch">${
              fm.mode === 'lab_skin'
                ? `${Math.round(Math.max(0.85, fm.colorMatchStrength) * 100)}%`
                : `${Math.round(fm.colorMatchStrength * 100)}%`
            }</span>
          </div>
          <input type="range" id="rngColorMatch" min="0" max="100" step="1" value="${
            fm.mode === 'lab_skin'
              ? Math.round(Math.max(0.85, fm.colorMatchStrength) * 100)
              : Math.round(fm.colorMatchStrength * 100)
          }" ${disabledAttr} />
        </div>

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label class="checkbox-row" style="margin:0">
            <input type="checkbox" id="chkPrioritizeSkin" ${fm.prioritizeSkin ? 'checked' : ''} ${disabledAttr} />
            <span>Priorizar tons de pele</span>
          </label>
          ${
            fm.mode !== 'none' && fm.mode !== 'poisson'
              ? `
            <label class="checkbox-row" style="margin:0">
              <input type="checkbox" id="chkProtectCore" ${fm.protectCoreFace ? 'checked' : ''} ${disabledAttr} />
              <span>Proteger face central</span>
            </label>
          `
              : ''
          }
        </div>
      </div>

      <div class="panel-card">
        <div class="card-header">
          <div class="card-title">Comparar &amp; Avançar</div>
        </div>
        <div class="segmented">
          <button class="seg-btn ${state.step5View === 'final' ? 'active' : ''}" id="segCmpNone">Final</button>
          <button class="seg-btn ${state.step5View === 'compare-raw' ? 'active' : ''}" id="segCmpRaw" title="Comparar com corte seco">vs Seco</button>
          <button class="seg-btn ${state.step5View === 'compare-merge' ? 'active' : ''}" id="segCmpMerge">vs Merge</button>
          <button class="seg-btn ${state.step5View === 'compare-img1' ? 'active' : ''}" id="segCmpImg1">vs img1</button>
        </div>
        <button class="btn btn-primary btn-block" style="margin-top:2px" id="sbNextTo6" ${disabledAttr}>
          Ir para Etapa 6: Pós-Processamento (Igualar Pele) →
        </button>
      </div>
    `;

    bindCopyDownload('copyImgFinal', 'dlImgFinal', () => state.imgFinalCanvas, 'imagemFinal.png');

    document.getElementById('sbNextTo6')?.addEventListener('click', () => {
      state.activeStep = 6;
      ensureStepComputed(6);
      syncAllUI();
    });

    document.querySelectorAll('#techGrid .tech-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextMode = /** @type {FinalMergeMode} */ (btn.getAttribute('data-tech') || 'none');
        state.finalMerge.mode = nextMode;
        if (nextMode !== 'none' && state.finalMerge.radiusPx <= 0) {
          state.finalMerge.radiusPx = 28;
        }
        if (nextMode === 'lab_skin' && state.finalMerge.colorMatchStrength < 0.85) {
          state.finalMerge.colorMatchStrength = 0.85;
        }
        recomputeStep5Outputs();
        syncAllUI();
        scheduleAutoSaveProject();
      });
    });

    const rngRadius = /** @type {HTMLInputElement | null} */ (document.getElementById('rngFinalRadius'));
    rngRadius?.addEventListener('input', () => {
      state.finalMerge.radiusPx = Number(rngRadius.value) || 1;
      scheduleStep5LiveUpdate();
    });
    rngRadius?.addEventListener('change', () => {
      recomputeStep5Outputs();
      syncViewportScene();
      updateSidebarThumbnails();
    });

    const rngPoisson = /** @type {HTMLInputElement | null} */ (document.getElementById('rngPoissonReach'));
    rngPoisson?.addEventListener('input', () => {
      state.finalMerge.poissonReach = (Number(rngPoisson.value) || 75) / 100;
      scheduleStep5LiveUpdate();
    });
    rngPoisson?.addEventListener('change', () => {
      recomputeStep5Outputs();
      syncViewportScene();
      updateSidebarThumbnails();
    });

    const rngColor = /** @type {HTMLInputElement | null} */ (document.getElementById('rngColorMatch'));
    rngColor?.addEventListener('input', () => {
      const val = (Number(rngColor.value) || 0) / 100;
      state.finalMerge.colorMatchStrength = val;
      if (state.finalMerge.mode === 'lab_skin' && val < 0.85) {
        state.finalMerge.mode = 'feather';
      }
      scheduleStep5LiveUpdate();
    });
    rngColor?.addEventListener('change', () => {
      recomputeStep5Outputs();
      syncViewportScene();
      updateSidebarThumbnails();
    });

    const chkSkin = /** @type {HTMLInputElement | null} */ (document.getElementById('chkPrioritizeSkin'));
    chkSkin?.addEventListener('change', () => {
      state.finalMerge.prioritizeSkin = chkSkin.checked;
      recomputeStep5Outputs();
      syncViewportScene();
      updateSidebarThumbnails();
    });

    const chkCore = /** @type {HTMLInputElement | null} */ (document.getElementById('chkProtectCore'));
    chkCore?.addEventListener('change', () => {
      state.finalMerge.protectCoreFace = chkCore.checked;
      recomputeStep5Outputs();
      syncViewportScene();
      updateSidebarThumbnails();
    });

    document.getElementById('segCmpNone')?.addEventListener('click', () => {
      state.step5View = 'final';
      syncAllUI();
    });
    document.getElementById('segCmpRaw')?.addEventListener('click', () => {
      state.step5View = 'compare-raw';
      syncAllUI();
    });
    document.getElementById('segCmpMerge')?.addEventListener('click', () => {
      state.step5View = 'compare-merge';
      syncAllUI();
    });
    document.getElementById('segCmpImg1')?.addEventListener('click', () => {
      state.step5View = 'compare-img1';
      syncAllUI();
    });
  }

  let _step6RafPending = false;
  function scheduleStep6LiveUpdate() {
    updateSidebarLiveValues();
    if (_step6RafPending) return;
    _step6RafPending = true;
    requestAnimationFrame(() => {
      _step6RafPending = false;
      recomputeStep6Outputs();
      syncViewportScene();
      updateSidebarLiveValues();
    });
  }

  /**
   * Formats an RGB tuple as CSS rgb(...) string.
   * @param {[number, number, number] | undefined} rgb
   * @param {string} fallback
   */
  function fmtRgbCss(rgb, fallback = '#334155') {
    if (!rgb) return fallback;
    return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  }

  function renderSidebarStep6() {
    const dimText = state.imgPostCanvas
      ? `${state.imgPostCanvas.width} × ${state.imgPostCanvas.height} px`
      : 'Pendente';

    const sp = state.skinPost;
    const diag = state.skinDiagnostics;
    const disabledAttr = !state.imgFinalCanvas ? 'disabled' : '';

    /** @type {{ id: SkinPostMethod, title: string, sub: string, span2?: boolean }[]} */
    const skinMethods = [
      { id: 'oklab_ot', title: 'Oklab 3×3 OT ★', sub: 'Transporte Ótimo 3D' },
      { id: 'cdf_curves', title: 'Curvas CDF ★', sub: 'Sombras • Meios • Altas' },
      { id: 'melanin_hemo', title: 'Melanina × Hemo ★', sub: 'Biofísico (Tom + Rubor)' },
      { id: 'zones_lgg', title: 'Lift / Gamma / Gain', sub: '3 Zonas Tonais' },
      {
        id: 'spatial_oklab',
        title: 'Espacial + Oklab 3×3',
        sub: 'Global + local costura',
        span2: true,
      },
    ];

    const methodBtnsHtml = skinMethods
      .map(
        (m) => `
        <button class="tech-btn ${sp.method === m.id ? 'active' : ''}" data-skin-method="${m.id}" ${
          m.span2 ? 'style="grid-column: span 2"' : ''
        } ${disabledAttr}>
          <span class="tech-btn-title">${m.title}</span>
          <span class="tech-btn-sub">${m.sub}</span>
        </button>`
      )
      .join('');

    const fBeforeCss = diag?.valid ? fmtRgbCss(diag.faceRgbBefore) : '#475569';
    const bBeforeCss = diag?.valid ? fmtRgbCss(diag.bodyRgbBefore) : '#475569';
    const fAfterCss = diag?.valid ? fmtRgbCss(diag.faceRgbAfter) : '#475569';
    const bAfterCss = diag?.valid ? fmtRgbCss(diag.bodyRgbAfter) : '#475569';

    const dBefore = diag?.valid ? diag.deltaEBefore.toFixed(1) : '—';
    const dAfter = diag?.valid ? diag.deltaEAfter.toFixed(1) : '—';
    const deltaClass = !diag?.valid
      ? ''
      : diag.deltaEAfter < 1.8
      ? 'emerald'
      : diag.deltaEAfter < 4.0
      ? 'amber'
      : 'cyan';

    const faceSampleLabel =
      state.skinSamplesFace.length > 0 ? `Face (${state.skinSamplesFace.length})` : 'Face (Auto)';
    const bodySampleLabel =
      state.skinSamplesBody.length > 0 ? `Corpo (${state.skinSamplesBody.length})` : 'Corpo (Auto)';

    let subtabHtml = '';
    if (state.step6Subtab === 'engine') {
      subtabHtml = `
        <div class="control-row">
          <div class="control-label"><span>Direção da Igualação</span></div>
          <div class="segmented">
            <button class="seg-btn ${sp.direction === 'face_to_body' ? 'active' : ''}" id="segDirF2B" ${disabledAttr}>Face → Corpo</button>
            <button class="seg-btn ${sp.direction === 'body_to_face' ? 'active' : ''}" id="segDirB2F" ${disabledAttr}>Corpo → Face</button>
            <button class="seg-btn ${sp.direction === 'mutual' ? 'active' : ''}" id="segDirMut" ${disabledAttr}>Mútuo 50/50</button>
          </div>
        </div>

        <div class="tech-grid" id="skinMethodGrid" style="margin-top:2px">
          ${methodBtnsHtml}
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Intensidade Geral</span>
            <span class="control-val" id="valSkinStrength">${Math.round(sp.strength * 100)}%</span>
          </div>
          <input type="range" id="rngSkinStrength" min="0" max="150" step="1" value="${Math.round(sp.strength * 100)}" ${disabledAttr} />
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Igualar Luminosidade / Exposição</span>
            <span class="control-val" id="valSkinLuma">${Math.round(sp.lumaMatch * 100)}%</span>
          </div>
          <input type="range" id="rngSkinLuma" min="0" max="120" step="1" value="${Math.round(sp.lumaMatch * 100)}" ${disabledAttr} />
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Igualar Cor / Subtom (Matiz &amp; Croma)</span>
            <span class="control-val" id="valSkinChroma">${Math.round(sp.chromaMatch * 100)}%</span>
          </div>
          <input type="range" id="rngSkinChroma" min="0" max="120" step="1" value="${Math.round(sp.chromaMatch * 100)}" ${disabledAttr} />
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Harmonia de Pele na Borda (Sem Degrau)</span>
            <span class="control-val" id="valSkinBorderStr">${Math.round((sp.borderMatchStrength ?? 0.9) * 100)}%</span>
          </div>
          <input type="range" id="rngSkinBorderStr" min="0" max="100" step="1" value="${Math.round((sp.borderMatchStrength ?? 0.9) * 100)}" ${disabledAttr} />
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Alcance da Transição de Borda</span>
            <span class="control-val" id="valSkinSeamPx">${sp.seamEqualizePx} px</span>
          </div>
          <input type="range" id="rngSkinSeamPx" min="0" max="90" step="1" value="${sp.seamEqualizePx}" ${disabledAttr} />
        </div>

        <label class="checkbox-row" style="margin-top:2px">
          <input type="checkbox" id="chkSkinBorderMutual" ${sp.borderMutualMeet !== false ? 'checked' : ''} ${disabledAttr} />
          <span>Convergência Mútua nas Bordas (Rosto ↔ Corpo)</span>
        </label>

        <label class="checkbox-row" style="margin-top:2px">
          <input type="checkbox" id="chkSkinProtect" ${sp.protectFeatures ? 'checked' : ''} ${disabledAttr} />
          <span>Proteger olhos, dentes, boca, cabelo e roupas</span>
        </label>
      `;
    } else if (state.step6Subtab === 'fine') {
      subtabHtml = `
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
          <span style="font-size:10.5px;color:var(--text-secondary);font-weight:600">Ajuste Manual dos Subtons</span>
          <button class="btn btn-xs btn-ghost" id="btnResetFineSkin" ${disabledAttr}>↺ Resetar</button>
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Temperatura (Frio ↔ Dourado/Quente)</span>
            <span class="control-val" id="valSkinTemp">${sp.tempOffset > 0 ? '+' : ''}${sp.tempOffset}</span>
          </div>
          <input type="range" id="rngSkinTemp" min="-50" max="50" step="1" value="${sp.tempOffset}" ${disabledAttr} />
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Subtom (Oliva ↔ Rosado/Magenta)</span>
            <span class="control-val" id="valSkinTint">${sp.tintOffset > 0 ? '+' : ''}${sp.tintOffset}</span>
          </div>
          <input type="range" id="rngSkinTint" min="-50" max="50" step="1" value="${sp.tintOffset}" ${disabledAttr} />
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Brilho Seletivo da Pele</span>
            <span class="control-val" id="valSkinLight">${sp.lightOffset > 0 ? '+' : ''}${sp.lightOffset}</span>
          </div>
          <input type="range" id="rngSkinLight" min="-50" max="50" step="1" value="${sp.lightOffset}" ${disabledAttr} />
        </div>

        <div class="control-row">
          <div class="control-label">
            <span>Saturação da Pele</span>
            <span class="control-val" id="valSkinSat">${Math.round(sp.satScale * 100)}%</span>
          </div>
          <input type="range" id="rngSkinSat" min="50" max="150" step="1" value="${Math.round(sp.satScale * 100)}" ${disabledAttr} />
        </div>
      `;
    } else if (state.step6Subtab === 'samples') {
      subtabHtml = `
        <div class="btn-row">
          <button class="btn btn-sm ${state.step6Tool === 'sample-face' ? 'btn-primary' : ''}" style="flex:1" id="btnSampleFace" ${disabledAttr} title="Clique na pele da Face para calibrar">
            🎯 ${faceSampleLabel}
          </button>
          <button class="btn btn-sm ${state.step6Tool === 'sample-body' ? 'btn-amber' : ''}" style="flex:1" id="btnSampleBody" ${disabledAttr} title="Clique na pele do Corpo para calibrar">
            🎯 ${bodySampleLabel}
          </button>
          <button class="btn btn-sm btn-ghost" id="btnClearSkinSamples" ${
            state.skinSamplesFace.length === 0 && state.skinSamplesBody.length === 0 ? 'disabled' : ''
          } title="Detecção automática">
            ↺ Auto
          </button>
        </div>

        <div class="control-row" style="margin-top:4px">
          <div class="control-label">
            <span>Seletividade da Detecção de Pele</span>
            <span class="control-val" id="valSkinSelectivity">${Math.round(sp.maskSelectivity * 100)}%</span>
          </div>
          <input type="range" id="rngSkinSelectivity" min="0" max="100" step="1" value="${Math.round(sp.maskSelectivity * 100)}" ${disabledAttr} />
        </div>

        <div class="control-row" style="margin-top:4px">
          <div class="control-label"><span>Visualização &amp; Comparação</span></div>
          <div class="segmented">
            <button class="seg-btn ${state.step6View === 'post' ? 'active' : ''}" id="segS6Post">Pós</button>
            <button class="seg-btn ${state.step6View === 'compare-pre' ? 'active' : ''}" id="segS6Pre" title="Comparar Pré vs Pós">vs Pré</button>
            <button class="seg-btn ${state.step6View === 'compare-raw' ? 'active' : ''}" id="segS6Raw" title="Comparar Corte Seco vs Pós">vs Seco</button>
            <button class="seg-btn ${state.step6View === 'skin-mask' ? 'active' : ''}" id="segS6Mask" title="Visualizar máscara de pele">Mapa</button>
          </div>
        </div>
      `;
    }

    sidebarContent.innerHTML = `
      <div class="panel-card highlight-emerald">
        <div class="card-header">
          <div class="card-title">6. Pós • Tom de Pele</div>
          <span class="badge ${deltaClass} delta-pill" id="pillDeltaE">ΔE00: ${dBefore} → ${dAfter}</span>
        </div>

        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px">
          <label class="checkbox-row" style="margin:0">
            <input type="checkbox" id="chkSkinEnabled" ${sp.enabled ? 'checked' : ''} ${disabledAttr} />
            <span style="font-weight:600">Ativar Pós-Processamento</span>
          </label>
          <span class="badge emerald">${dimText}</span>
        </div>

        <div style="display:flex;gap:6px;align-items:center;margin:2px 0">
          <div class="piece-thumb-wrap" id="thumbPostFinal" style="flex:1;height:54px"></div>
          <div class="skin-meter" style="flex:1.2;padding:3px 5px">
            <div class="swatch-col">
              <div class="swatch-dot" id="swFaceBefore" style="background:${fBeforeCss}"></div>
              <div class="swatch-caption">Face Antes</div>
            </div>
            <div class="swatch-col" style="flex:1.2">
              <div class="swatch-Split" title="Esquerda: Face Pós | Direita: Corpo Pós">
                <div class="swatch-half" id="swHalfFaceAfter" style="background:${fAfterCss}"></div>
                <div class="swatch-half" id="swHalfBodyAfter" style="background:${bAfterCss}"></div>
              </div>
              <div class="swatch-caption">Depois (F | C)</div>
            </div>
            <div class="swatch-col">
              <div class="swatch-dot" id="swBodyTarget" style="background:${bBeforeCss}"></div>
              <div class="swatch-caption">Corpo Ref.</div>
            </div>
          </div>
        </div>

        <div class="btn-row">
          <button class="btn btn-emerald btn-sm" style="flex:1" id="copyImgPost" ${disabledAttr}>
            📋 Copiar Final
          </button>
          <button class="btn btn-primary btn-sm" style="flex:1" id="dlImgPost" ${disabledAttr}>
            ⬇ Salvar PNG
          </button>
        </div>
      </div>

      <div class="panel-card highlight-cyan" style="display:flex;flex-direction:column;gap:5px">
        <div class="subtabs-nav">
          <button class="subtab-btn ${state.step6Subtab === 'engine' ? 'active' : ''}" id="btnSubtabEngine">⚙ Motor</button>
          <button class="subtab-btn ${state.step6Subtab === 'fine' ? 'active' : ''}" id="btnSubtabFine">🎨 Ajuste Fino</button>
          <button class="subtab-btn ${state.step6Subtab === 'samples' ? 'active' : ''}" id="btnSubtabSamples">🎯 Amostras</button>
        </div>
        <div id="subtabBox">
          ${subtabHtml}
        </div>
      </div>
    `;

    bindCopyDownload(
      'copyImgPost',
      'dlImgPost',
      () => state.imgPostCanvas,
      'imagemFinal_pele_igualada.png'
    );

    const chkEnabled = /** @type {HTMLInputElement | null} */ (document.getElementById('chkSkinEnabled'));
    chkEnabled?.addEventListener('change', () => {
      state.skinPost.enabled = chkEnabled.checked;
      recomputeStep6Outputs();
      syncAllUI();
    });

    document.getElementById('btnSubtabEngine')?.addEventListener('click', () => {
      state.step6Subtab = 'engine';
      renderSidebarStep6();
      updateSidebarThumbnails();
      updateSidebarLiveValues();
    });
    document.getElementById('btnSubtabFine')?.addEventListener('click', () => {
      state.step6Subtab = 'fine';
      renderSidebarStep6();
      updateSidebarThumbnails();
      updateSidebarLiveValues();
    });
    document.getElementById('btnSubtabSamples')?.addEventListener('click', () => {
      state.step6Subtab = 'samples';
      renderSidebarStep6();
      updateSidebarThumbnails();
      updateSidebarLiveValues();
    });

    /**
     * Helper to bind a Step 6 slider with live rAF preview + thumbnail update on release.
     * @param {string} id
     * @param {(val: number) => void} applyVal
     */
    const bindStep6Range = (id, applyVal) => {
      const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
      if (!el) return;
      el.addEventListener('input', () => {
        applyVal(Number(el.value));
        scheduleStep6LiveUpdate();
      });
      el.addEventListener('change', () => {
        recomputeStep6Outputs();
        syncViewportScene();
        updateSidebarLiveValues();
        updateSidebarThumbnails();
      });
    };

    if (state.step6Subtab === 'engine') {
      const setDir = (/** @type {SkinMatchDirection} */ dir) => {
        state.skinPost.direction = dir;
        recomputeStep6Outputs();
        syncAllUI();
      };
      document.getElementById('segDirF2B')?.addEventListener('click', () => setDir('face_to_body'));
      document.getElementById('segDirB2F')?.addEventListener('click', () => setDir('body_to_face'));
      document.getElementById('segDirMut')?.addEventListener('click', () => setDir('mutual'));

      document.querySelectorAll('#skinMethodGrid .tech-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
          const m = /** @type {SkinPostMethod} */ (btn.getAttribute('data-skin-method') || 'oklab_ot');
          state.skinPost.method = m;
          recomputeStep6Outputs();
          syncAllUI();
        });
      });

      bindStep6Range('rngSkinStrength', (v) => {
        state.skinPost.strength = v / 100;
      });
      bindStep6Range('rngSkinLuma', (v) => {
        state.skinPost.lumaMatch = v / 100;
      });
      bindStep6Range('rngSkinChroma', (v) => {
        state.skinPost.chromaMatch = v / 100;
      });
      bindStep6Range('rngSkinBorderStr', (v) => {
        state.skinPost.borderMatchStrength = v / 100;
      });
      bindStep6Range('rngSkinSeamPx', (v) => {
        state.skinPost.seamEqualizePx = Math.round(v);
      });

      const chkMutual = /** @type {HTMLInputElement | null} */ (document.getElementById('chkSkinBorderMutual'));
      chkMutual?.addEventListener('change', () => {
        state.skinPost.borderMutualMeet = chkMutual.checked;
        recomputeStep6Outputs();
        syncViewportScene();
        updateSidebarLiveValues();
        updateSidebarThumbnails();
        scheduleAutoSaveProject();
      });

      const chkProt = /** @type {HTMLInputElement | null} */ (document.getElementById('chkSkinProtect'));
      chkProt?.addEventListener('change', () => {
        state.skinPost.protectFeatures = chkProt.checked;
        recomputeStep6Outputs();
        syncViewportScene();
        updateSidebarLiveValues();
        updateSidebarThumbnails();
        scheduleAutoSaveProject();
      });
    } else if (state.step6Subtab === 'fine') {
      bindStep6Range('rngSkinTemp', (v) => {
        state.skinPost.tempOffset = Math.round(v);
      });
      bindStep6Range('rngSkinTint', (v) => {
        state.skinPost.tintOffset = Math.round(v);
      });
      bindStep6Range('rngSkinLight', (v) => {
        state.skinPost.lightOffset = Math.round(v);
      });
      bindStep6Range('rngSkinSat', (v) => {
        state.skinPost.satScale = v / 100;
      });

      document.getElementById('btnResetFineSkin')?.addEventListener('click', () => {
        state.skinPost.tempOffset = 0;
        state.skinPost.tintOffset = 0;
        state.skinPost.lightOffset = 0;
        state.skinPost.satScale = 1.0;
        recomputeStep6Outputs();
        syncAllUI();
      });
    } else if (state.step6Subtab === 'samples') {
      document.getElementById('btnSampleFace')?.addEventListener('click', () => {
        state.step6Tool = state.step6Tool === 'sample-face' ? 'pan' : 'sample-face';
        if (state.step6Tool !== 'pan' && state.step6View.startsWith('compare')) {
          state.step6View = 'post';
        }
        syncAllUI();
      });

      document.getElementById('btnSampleBody')?.addEventListener('click', () => {
        state.step6Tool = state.step6Tool === 'sample-body' ? 'pan' : 'sample-body';
        if (state.step6Tool !== 'pan' && state.step6View.startsWith('compare')) {
          state.step6View = 'post';
        }
        syncAllUI();
      });

      document.getElementById('btnClearSkinSamples')?.addEventListener('click', () => {
        state.skinSamplesFace = [];
        state.skinSamplesBody = [];
        state.step6Tool = 'pan';
        recomputeStep6Outputs();
        syncAllUI();
        showToast('Amostragem restaurada para detecção automática de pele.');
      });

      bindStep6Range('rngSkinSelectivity', (v) => {
        state.skinPost.maskSelectivity = v / 100;
      });

      document.getElementById('segS6Post')?.addEventListener('click', () => {
        state.step6Tool = 'pan';
        state.step6View = 'post';
        syncAllUI();
      });
      document.getElementById('segS6Pre')?.addEventListener('click', () => {
        state.step6Tool = 'pan';
        state.step6View = 'compare-pre';
        syncAllUI();
      });
      document.getElementById('segS6Raw')?.addEventListener('click', () => {
        state.step6Tool = 'pan';
        state.step6View = 'compare-raw';
        syncAllUI();
      });
      document.getElementById('segS6Mask')?.addEventListener('click', () => {
        state.step6View = 'skin-mask';
        syncAllUI();
      });
    }
  }

  /**
   * Updates numeric labels & input values without replacing DOM nodes (preserves slider drag focus!).
   */
  function updateSidebarLiveValues() {
    const setTxt = (id, text) => {
      const el = document.getElementById(id);
      if (el) el.textContent = text;
    };
    const setVal = (id, val) => {
      const el = /** @type {HTMLInputElement | null} */ (document.getElementById(id));
      if (el && document.activeElement !== el) el.value = String(val);
    };

    if (state.activeStep === 2) {
      const pct = Math.round(state.img2Transform.scale * 100);
      const rot = (state.img2Transform.rotation || 0).toFixed(1);
      setTxt('valImg2Scale', `${pct}%`);
      setVal('rngImg2Scale', state.img2Transform.scale * 100);
      setVal('numImg2Scale', pct);
      setTxt('valImg2Rot', `${rot}°`);
      setVal('rngImg2Rot', state.img2Transform.rotation || 0);
      setVal('numImg2Rot', rot);
      setTxt('valImg2XY', `${Math.round(state.img2Transform.x)}, ${Math.round(state.img2Transform.y)}`);
      setVal('numImg2X', Math.round(state.img2Transform.x));
      setVal('numImg2Y', Math.round(state.img2Transform.y));
      setTxt('valImg2Onion', `${Math.round(state.img2OnionOpacity * 100)}%`);
    } else if (state.activeStep === 3) {
      setTxt('valExpandPx', `${state.expandPx >= 0 ? '+' : ''}${state.expandPx} px`);
      setVal('rngExpandPx', state.expandPx);
      setVal('numExpandPx', state.expandPx);
      setTxt(
        'valCustomExtraPx',
        `${state.customExtraExpandPx >= 0 ? '+' : ''}${state.customExtraExpandPx} px`
      );
    } else if (state.activeStep === 4) {
      const pct = Math.round(state.refinedTransform.scale * 100);
      setTxt('valRefScale', `${pct}%`);
      setVal('rngRefScale', state.refinedTransform.scale * 100);
      setVal('numRefScale', pct);
      setTxt(
        'valRefXY',
        `${Math.round(state.refinedTransform.x)}, ${Math.round(state.refinedTransform.y)}`
      );
      setVal('numRefX', Math.round(state.refinedTransform.x));
      setVal('numRefY', Math.round(state.refinedTransform.y));
      setTxt('valRefOnion', `${Math.round(state.refinedOnionOpacity * 100)}%`);
    } else if (state.activeStep === 5) {
      setTxt('valFinalRadius', `${state.finalMerge.radiusPx} px`);
      setTxt('valPoissonReach', `${Math.round(state.finalMerge.poissonReach * 100)}%`);
      const effC =
        state.finalMerge.mode === 'lab_skin'
          ? Math.max(0.85, state.finalMerge.colorMatchStrength)
          : state.finalMerge.colorMatchStrength;
      setTxt('valColorMatch', `${Math.round(effC * 100)}%`);
    } else if (state.activeStep === 6) {
      const sp = state.skinPost;
      setTxt('valSkinStrength', `${Math.round(sp.strength * 100)}%`);
      setTxt('valSkinLuma', `${Math.round(sp.lumaMatch * 100)}%`);
      setTxt('valSkinChroma', `${Math.round(sp.chromaMatch * 100)}%`);
      setTxt('valSkinSelectivity', `${Math.round(sp.maskSelectivity * 100)}%`);
      setTxt('valSkinBorderStr', `${Math.round((sp.borderMatchStrength ?? 0.9) * 100)}%`);
      setTxt('valSkinSeamPx', `${sp.seamEqualizePx} px`);
      setTxt('valSkinTemp', `${sp.tempOffset > 0 ? '+' : ''}${sp.tempOffset}`);
      setTxt('valSkinTint', `${sp.tintOffset > 0 ? '+' : ''}${sp.tintOffset}`);
      setTxt('valSkinLight', `${sp.lightOffset > 0 ? '+' : ''}${sp.lightOffset}`);
      setTxt('valSkinSat', `${Math.round(sp.satScale * 100)}%`);

      const diag = state.skinDiagnostics;
      if (diag && diag.valid) {
        const swFB = document.getElementById('swFaceBefore');
        const swBT = document.getElementById('swBodyTarget');
        const swFA = document.getElementById('swHalfFaceAfter');
        const swBA = document.getElementById('swHalfBodyAfter');
        if (swFB) swFB.style.background = fmtRgbCss(diag.faceRgbBefore);
        if (swBT) swBT.style.background = fmtRgbCss(diag.bodyRgbBefore);
        if (swFA) swFA.style.background = fmtRgbCss(diag.faceRgbAfter);
        if (swBA) swBA.style.background = fmtRgbCss(diag.bodyRgbAfter);

        const pill = document.getElementById('pillDeltaE');
        if (pill) {
          pill.textContent = `ΔE00: ${diag.deltaEBefore.toFixed(1)} → ${diag.deltaEAfter.toFixed(1)}`;
          const cls =
            diag.deltaEAfter < 1.8 ? 'emerald' : diag.deltaEAfter < 4.0 ? 'amber' : 'cyan';
          pill.className = `badge ${cls} delta-pill`;
        }
      }
    }
  }

  function updateSidebarThumbnails() {
    if (state.activeStep === 1) {
      mountThumb(document.getElementById('thumbCorpo1'), state.corpo1Canvas);
      mountThumb(document.getElementById('thumbFace1'), state.face1Canvas);
    } else if (state.activeStep === 2) {
      mountThumb(document.getElementById('thumbFace2'), state.face2Canvas);
      mountThumb(document.getElementById('thumbImg2Pad'), state.img2AlignedCanvas);
    } else if (state.activeStep === 3) {
      mountThumb(document.getElementById('thumbFaceImp'), getFaceImprecisaExportCanvas());
      mountThumb(document.getElementById('thumbCorpoClean'), state.corpoSemBordasCanvas);
    } else if (state.activeStep === 4) {
      mountThumb(document.getElementById('thumbFacePrec'), state.facePrecisaCanvas);
    } else if (state.activeStep === 5) {
      mountThumb(document.getElementById('thumbFinal'), state.imgFinalCanvas);
    } else if (state.activeStep === 6) {
      mountThumb(document.getElementById('thumbPostFinal'), state.imgPostCanvas);
    }
  }

  /**
   * @param {string} copyId
   * @param {string} dlId
   * @param {() => HTMLCanvasElement | null} getCanvas
   * @param {string} filename
   */
  function bindCopyDownload(copyId, dlId, getCanvas, filename) {
    document.getElementById(copyId)?.addEventListener('click', () => {
      ensureStepComputed(state.activeStep);
      const c = getCanvas();
      if (c) copyWithToast(c, `${filename} copiado para a área de transferência!`, filename);
    });
    document.getElementById(dlId)?.addEventListener('click', async () => {
      ensureStepComputed(state.activeStep);
      const c = getCanvas();
      if (!c) return;

      if (Ops.isIOSDevice()) {
        // Trigger native iOS Share Sheet synchronously within click gesture (no extra tab opened!)
        const sharePromise = Ops.shareOrDownloadCanvas(c, filename);
        const isLocalLan =
          window.location.protocol === 'http:' &&
          (!isRemoteClient() || /^\d+\.\d+\.\d+\.\d+$/.test(window.location.hostname));
        if (isLocalLan) {
          Ops.saveCanvasToData(c, filename, state.targetDataFolder).catch(() => {});
        }
        const action = await sharePromise;
        if (action === 'shared') {
          showToast("Toque em 'Salvar Imagem' para guardar direto na Fototeca.");
        } else if (action === 'downloaded') {
          showToast(`Download de ${filename} concluído.`);
        }
        return;
      }

      const res = await Ops.saveCanvasToData(c, filename, state.targetDataFolder);
      if (res.viaApi) {
        if (isRemoteClient()) {
          await Ops.shareOrDownloadCanvas(c, filename);
          showToast(`Salvo em /${res.path} e baixado no dispositivo!`);
        } else {
          showToast(`Salvo com sucesso em /${res.path}!`);
        }
      } else {
        showToast(`Download de ${filename} concluído.`);
      }
    });
  }

  async function initDataFolderControl() {
    const sel = /** @type {HTMLSelectElement | null} */ (document.getElementById('selDataFolder'));
    const btnOpen = document.getElementById('btnOpenDataFolder');
    if (!sel) return;

    try {
      const res = await Ops.getDataFolders();
      sel.innerHTML = '';
      const rootOpt = document.createElement('option');
      rootOpt.value = '';
      rootOpt.textContent = '/data (raiz)';
      sel.appendChild(rootOpt);

      if (res && res.folders && res.folders.length > 0) {
        res.folders.forEach((f) => {
          const opt = document.createElement('option');
          opt.value = f;
          opt.textContent = `/data/${f}`;
          sel.appendChild(opt);
        });
        if (res.defaultFolder) {
          state.targetDataFolder = res.defaultFolder;
          sel.value = res.defaultFolder;
        }
      } else {
        const opt4 = document.createElement('option');
        opt4.value = '4';
        opt4.textContent = '/data/4';
        sel.appendChild(opt4);
        state.targetDataFolder = '4';
        sel.value = '4';
      }

      const newOpt = document.createElement('option');
      newOpt.value = '__new__';
      newOpt.textContent = '+ Nova pasta...';
      sel.appendChild(newOpt);
    } catch (e) {
      sel.innerHTML = '<option value="4">/data/4</option><option value="">/data</option>';
      state.targetDataFolder = '4';
    }

    sel.addEventListener('change', () => {
      if (sel.value === '__new__') {
        const name = prompt('Nome da nova pasta em /data:', '5');
        if (name && name.trim()) {
          const clean = name.trim().replace(/[^a-zA-Z0-9_\-]/g, '');
          const opt = document.createElement('option');
          opt.value = clean;
          opt.textContent = `/data/${clean}`;
          sel.insertBefore(opt, sel.lastChild);
          sel.value = clean;
          state.targetDataFolder = clean;
          showToast(`Pasta /data/${clean} selecionada como padrão.`);
        } else {
          sel.value = state.targetDataFolder;
        }
      } else {
        state.targetDataFolder = sel.value;
        showToast(`Destino padrão de download: /data${state.targetDataFolder ? '/' + state.targetDataFolder : ''}`);
      }
    });

    btnOpen?.addEventListener('click', () => {
      Ops.openDataFolder(state.targetDataFolder);
    });
  }

  async function copyWithToast(canvas, successMsg, fallbackFilename = 'imagem.png') {
    try {
      await Ops.copyCanvasToClipboard(canvas);
      showToast(successMsg);
    } catch (err) {
      // On mobile HTTP LAN, Clipboard API for PNG may be unavailable -> seamlessly share or download!
      const action = await Ops.shareOrDownloadCanvas(canvas, fallbackFilename);
      if (action === 'shared') {
        showToast('Imagem compartilhada!');
      } else if (action === 'downloaded') {
        showToast(`PNG baixado no dispositivo (${fallbackFilename}).`);
      } else if (err && err.message) {
        showToast(err.message, true);
      }
    }
  }

  async function triggerClipboardPaste(slot) {
    try {
      const loaded = await Ops.readImageFromClipboardAPI();
      if (!loaded) {
        showToast('Nenhuma imagem encontrada na área de transferência. Use Ctrl+V!', true);
        return;
      }
      applyLoadedImage(loaded, slot);
    } catch (err) {
      showToast(err.message || 'Pressione Ctrl+V no teclado para colar a imagem.', true);
    }
  }

  // ===========================================================================
  // Modal: Auto Seleção com Rosto Isolado (Face + Complemento = Corpo)
  // ===========================================================================

  /**
   * Checks whether an image has meaningful transparent pixels (alpha < 240).
   * @param {LoadedImage | null} loaded
   * @returns {boolean}
   */
  function checkImageHasAlpha(loaded) {
    if (!loaded || !loaded.img) return false;
    const canvas = Ops.sourceToCanvas(loaded.img);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return false;
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    const len = data.length;
    let transparentCount = 0;
    const step = len > 4000000 ? 16 : 4;
    for (let i = 3; i < len; i += step) {
      if (data[i] < 240) {
        transparentCount++;
        if (transparentCount > 40) return true;
      }
    }
    return transparentCount > 8;
  }

  function openAutoSelectModal() {
    if (state.img1 && !autoModalState.imgComplete) {
      autoModalState.imgComplete = state.img1;
    }
    updateAutoModalUI();
    modalAutoSelect?.classList.add('open');
  }

  function closeAutoSelectModal() {
    modalAutoSelect?.classList.remove('open');
  }

  function renderAutoThumb(container, loaded, emptyLabel) {
    if (!container) return;
    container.innerHTML = '';
    if (!loaded || !loaded.img) {
      container.innerHTML = `<span style="color:#64748b;font-size:10px">${emptyLabel}</span>`;
      return;
    }
    const thumbCanvas = document.createElement('canvas');
    const aspect = (loaded.width || 1) / (loaded.height || 1);
    const maxH = 52;
    const maxW = 90;
    let tw = maxH * aspect;
    let th = maxH;
    if (tw > maxW) {
      tw = maxW;
      th = maxW / aspect;
    }
    thumbCanvas.width = Math.max(1, Math.round(tw));
    thumbCanvas.height = Math.max(1, Math.round(th));
    thumbCanvas.style.maxHeight = '100%';
    thumbCanvas.style.maxWidth = '100%';
    thumbCanvas.style.objectFit = 'contain';
    thumbCanvas.style.borderRadius = '3px';
    const ctx = thumbCanvas.getContext('2d');
    if (ctx) {
      ctx.drawImage(loaded.img, 0, 0, thumbCanvas.width, thumbCanvas.height);
    }
    container.appendChild(thumbCanvas);
  }

  function updateAutoModalUI() {
    const badgeImg1 = document.getElementById('badgeAutoImg1');
    const thumbImg1 = document.getElementById('thumbAutoImg1');
    const badgeFace = document.getElementById('badgeAutoFace');
    const thumbFace = document.getElementById('thumbAutoFace');
    const btnApply = /** @type {HTMLButtonElement | null} */ (
      document.getElementById('btnAutoApply')
    );

    if (badgeImg1 && thumbImg1) {
      if (autoModalState.imgComplete) {
        badgeImg1.className = 'badge emerald';
        badgeImg1.textContent = `${autoModalState.imgComplete.width} × ${autoModalState.imgComplete.height}`;
        renderAutoThumb(thumbImg1, autoModalState.imgComplete, 'Nenhuma imagem');
      } else {
        badgeImg1.className = 'badge';
        badgeImg1.textContent = 'Pendente';
        thumbImg1.innerHTML = '<span style="color:#64748b;font-size:10px">Nenhuma imagem</span>';
      }
    }

    if (badgeFace && thumbFace) {
      if (autoModalState.imgFace) {
        badgeFace.className = 'badge cyan';
        badgeFace.textContent = `${autoModalState.imgFace.width} × ${autoModalState.imgFace.height}`;
        renderAutoThumb(thumbFace, autoModalState.imgFace, 'Nenhum recorte');
      } else {
        badgeFace.className = 'badge';
        badgeFace.textContent = 'Pendente';
        thumbFace.innerHTML = '<span style="color:#64748b;font-size:10px">Nenhum recorte</span>';
      }
    }

    if (btnApply) {
      btnApply.disabled = !(autoModalState.imgComplete && autoModalState.imgFace);
    }
  }

  /**
   * Applies auto-separation: computes mask where face is 1, and complement is 0 (Corpo).
   * @param {LoadedImage | null} loadedComplete
   * @param {LoadedImage | null} loadedFace
   */
  function applyAutoSeparation(loadedComplete, loadedFace) {
    if (!loadedComplete || !loadedFace) {
      showToast('Selecione tanto a imagem completa quanto o rosto isolado.', true);
      return;
    }

    // Ensure complete image is set as imagem1
    if (!state.img1 || state.img1 !== loadedComplete) {
      applyLoadedImage(loadedComplete, 1);
    }

    if (!state.img1Canvas) {
      showToast('Erro ao carregar a imagem completa.', true);
      return;
    }

    const { mask, facePixelCount, bodyPixelCount } = Ops.createMaskFromIsolatedFace(
      state.img1Canvas,
      loadedFace.img
    );

    if (facePixelCount === 0) {
      showToast(
        'Não foi possível isolar o rosto. Certifique-se que o rosto possui fundo transparente, preto ou branco, ou corresponde ao original.',
        true
      );
      return;
    }

    state.rawMask1 = mask;
    state.faceIsOne1 = true; // Face = 1, Complement = 0 (Corpo)
    state.selection1 = {
      type: 'auto-face',
      polygon: [],
      cutPath: [],
    };
    state.step1View = 'split';
    recomputeStep1Outputs(true);
    closeAutoSelectModal();
    syncAllUI();
    showToast(
      `✨ Auto seleção concluída! Rosto isolado (${facePixelCount.toLocaleString()} px) e Corpo (${bodyPixelCount.toLocaleString()} px).`
    );
  }

  /**
   * Handles multi-file Explorer selection (Ctrl+Click or Drag 2 files).
   * @param {FileList} files
   */
  async function handleAutoPairFiles(files) {
    if (!files || files.length === 0) return;

    try {
      showToast('Analisando imagens...');
      if (files.length === 1 && state.img1) {
        const loadedFace = await Ops.loadImageFromBlob(files[0], files[0].name);
        autoModalState.imgComplete = state.img1;
        autoModalState.imgFace = loadedFace;
        updateAutoModalUI();
        applyAutoSeparation(state.img1, loadedFace);
        return;
      }

      if (files.length < 2) {
        showToast('Selecione 2 imagens no Explorer (original + rosto isolado).', true);
        return;
      }

      const loadedA = await Ops.loadImageFromBlob(files[0], files[0].name);
      const loadedB = await Ops.loadImageFromBlob(files[1], files[1].name);

      const aHasAlpha = checkImageHasAlpha(loadedA);
      const bHasAlpha = checkImageHasAlpha(loadedB);

      let comp = null;
      let face = null;

      if (aHasAlpha && !bHasAlpha) {
        face = loadedA;
        comp = loadedB;
      } else if (!aHasAlpha && bHasAlpha) {
        comp = loadedA;
        face = loadedB;
      } else {
        const bgA = Ops.detectSolidSeparationBg(loadedA.img);
        const bgB = Ops.detectSolidSeparationBg(loadedB.img);

        if (bgA.type !== 'none' && bgB.type === 'none') {
          face = loadedA;
          comp = loadedB;
        } else if (bgB.type !== 'none' && bgA.type === 'none') {
          comp = loadedA;
          face = loadedB;
        } else if (bgA.type !== 'none' && bgB.type !== 'none' && Math.abs(bgA.borderRatio - bgB.borderRatio) > 0.1) {
          if (bgA.borderRatio > bgB.borderRatio) {
            face = loadedA;
            comp = loadedB;
          } else {
            comp = loadedA;
            face = loadedB;
          }
        } else {
          const nameA = (files[0].name || '').toLowerCase();
          const nameB = (files[1].name || '').toLowerCase();
          const faceKeys = ['face', 'rosto', 'crop', 'cut', 'isola', 'head', 'recorte'];
          const aIsFace = faceKeys.some((k) => nameA.includes(k));
          const bIsFace = faceKeys.some((k) => nameB.includes(k));

          if (aIsFace && !bIsFace) {
            face = loadedA;
            comp = loadedB;
          } else if (!aIsFace && bIsFace) {
            comp = loadedA;
            face = loadedB;
          } else {
            comp = loadedA;
            face = loadedB;
          }
        }
      }

      autoModalState.imgComplete = comp;
      autoModalState.imgFace = face;
      updateAutoModalUI();
      applyAutoSeparation(comp, face);
    } catch (err) {
      showToast(err.message || 'Erro ao processar par de imagens.', true);
    }
  }

  function initAutoSelectModal() {
    const btnClose = document.getElementById('btnCloseAutoModal');
    const btnCancel = document.getElementById('btnAutoCancel');
    const btnPickBoth = document.getElementById('btnAutoPickBoth');
    const btnChooseImg1 = document.getElementById('btnAutoChooseImg1');
    const btnPasteImg1 = document.getElementById('btnAutoPasteImg1');
    const btnChooseFace = document.getElementById('btnAutoChooseFace');
    const btnPasteFace = document.getElementById('btnAutoPasteFace');
    const btnApply = document.getElementById('btnAutoApply');

    btnClose?.addEventListener('click', closeAutoSelectModal);
    btnCancel?.addEventListener('click', closeAutoSelectModal);
    modalAutoSelect?.addEventListener('click', (e) => {
      if (e.target === modalAutoSelect) closeAutoSelectModal();
    });

    btnPickBoth?.addEventListener('click', () => {
      if (fileInputAutoPair) {
        fileInputAutoPair.value = '';
        fileInputAutoPair.click();
      }
    });

    fileInputAutoPair?.addEventListener('change', (e) => {
      const files = /** @type {HTMLInputElement} */ (e.target).files;
      if (files && files.length > 0) {
        handleAutoPairFiles(files);
      }
    });

    btnChooseImg1?.addEventListener('click', () => {
      if (fileInputAutoImg1) {
        fileInputAutoImg1.value = '';
        fileInputAutoImg1.click();
      }
    });

    fileInputAutoImg1?.addEventListener('change', async (e) => {
      const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
      if (file) {
        try {
          autoModalState.imgComplete = await Ops.loadImageFromBlob(file, file.name);
          updateAutoModalUI();
        } catch (err) {
          showToast(err.message || 'Erro ao carregar imagem.', true);
        }
      }
    });

    btnPasteImg1?.addEventListener('click', async () => {
      try {
        const loaded = await Ops.readImageFromClipboardAPI();
        if (loaded) {
          autoModalState.imgComplete = loaded;
          updateAutoModalUI();
          showToast('Imagem completa colada!');
        } else {
          showToast('Nenhuma imagem na área de transferência.', true);
        }
      } catch (err) {
        showToast(err.message || 'Pressione Ctrl+V para colar.', true);
      }
    });

    btnChooseFace?.addEventListener('click', () => {
      if (fileInputAutoFace) {
        fileInputAutoFace.value = '';
        fileInputAutoFace.click();
      }
    });

    fileInputAutoFace?.addEventListener('change', async (e) => {
      const file = /** @type {HTMLInputElement} */ (e.target).files?.[0];
      if (file) {
        try {
          autoModalState.imgFace = await Ops.loadImageFromBlob(file, file.name);
          updateAutoModalUI();
        } catch (err) {
          showToast(err.message || 'Erro ao carregar rosto.', true);
        }
      }
    });

    btnPasteFace?.addEventListener('click', async () => {
      try {
        const loaded = await Ops.readImageFromClipboardAPI();
        if (loaded) {
          autoModalState.imgFace = loaded;
          updateAutoModalUI();
          showToast('Rosto isolado colado!');
        } else {
          showToast('Nenhuma imagem na área de transferência.', true);
        }
      } catch (err) {
        showToast(err.message || 'Pressione Ctrl+V para colar.', true);
      }
    });

    btnApply?.addEventListener('click', () => {
      applyAutoSeparation(autoModalState.imgComplete, autoModalState.imgFace);
    });
  }

  // ===========================================================================
  // Modal: Alinhamento por Olhos (Calibrador IPD)
  // ===========================================================================
  const modalEyeCalibrate = /** @type {HTMLElement | null} */ (
    document.getElementById('modalEyeCalibrate')
  );
  const canvasEyeImg1 = /** @type {HTMLCanvasElement | null} */ (
    document.getElementById('canvasEyeImg1')
  );
  const canvasEyeImg2 = /** @type {HTMLCanvasElement | null} */ (
    document.getElementById('canvasEyeImg2')
  );

  let eyeCalibState = {
    /** @type {Point | null} */
    p1L: null,
    /** @type {Point | null} */
    p1R: null,
    /** @type {Point | null} */
    p2L: null,
    /** @type {Point | null} */
    p2R: null,
    calcResult: null,
  };

  function openEyeCalibrateModal() {
    if (!state.img1Canvas || !state.img2) {
      showToast('Importe ou cole a imagem2 antes de alinhar por olhos.', true);
      return;
    }
    renderEyeCalibCanvases();
    updateEyeCalibUI();
    modalEyeCalibrate?.classList.add('open');
  }

  function closeEyeCalibrateModal() {
    modalEyeCalibrate?.classList.remove('open');
  }

  function resetEyePoints() {
    eyeCalibState.p1L = null;
    eyeCalibState.p1R = null;
    eyeCalibState.p2L = null;
    eyeCalibState.p2R = null;
    eyeCalibState.calcResult = null;
    renderEyeCalibCanvases();
    updateEyeCalibUI();
  }

  function renderEyeCalibCanvases() {
    if (canvasEyeImg1 && state.img1Canvas) {
      const c = canvasEyeImg1;
      c.width = state.img1Canvas.width;
      c.height = state.img1Canvas.height;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(state.img1Canvas, 0, 0);
        drawEyePins(ctx, eyeCalibState.p1L, eyeCalibState.p1R, '#38bdf8', 'L1', 'R1');
      }
    }

    if (canvasEyeImg2 && state.img2) {
      const c = canvasEyeImg2;
      c.width = state.img2.width;
      c.height = state.img2.height;
      const ctx = c.getContext('2d');
      if (ctx) {
        ctx.drawImage(state.img2.img, 0, 0);
        drawEyePins(ctx, eyeCalibState.p2L, eyeCalibState.p2R, '#f59e0b', 'L2', 'R2');
      }
    }
  }

  function drawEyePins(ctx, pL, pR, color, labelL, labelR) {
    ctx.save();
    const minDim = Math.min(ctx.canvas.width || 600, ctx.canvas.height || 600);
    const pinR = Math.max(11, Math.round(minDim * 0.022));
    const cross = Math.round(pinR * 0.65);
    const strokeW = Math.max(3, Math.round(pinR * 0.28));

    if (pL && pR) {
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.setLineDash([pinR * 0.75, pinR * 0.55]);
      ctx.beginPath();
      ctx.moveTo(pL.x, pL.y);
      ctx.lineTo(pR.x, pR.y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const drawPin = (p, label) => {
      if (!p) return;
      ctx.fillStyle = '#0f172a';
      ctx.strokeStyle = color;
      ctx.lineWidth = strokeW;
      ctx.beginPath();
      ctx.arc(p.x, p.y, pinR, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, Math.round(strokeW * 0.6));
      ctx.beginPath();
      ctx.moveTo(p.x - cross, p.y);
      ctx.lineTo(p.x + cross, p.y);
      ctx.moveTo(p.x, p.y - cross);
      ctx.lineTo(p.x, p.y + cross);
      ctx.stroke();

      ctx.fillStyle = color;
      ctx.font = `bold ${Math.max(12, Math.round(pinR * 1.1))}px system-ui, sans-serif`;
      ctx.fillText(label, p.x + pinR + 4, p.y + Math.round(pinR * 0.35));
    };

    drawPin(pL, labelL);
    drawPin(pR, labelR);
    ctx.restore();
  }

  function updateEyeCalibUI() {
    const badge1 = document.getElementById('badgeEyeImg1');
    const badge2 = document.getElementById('badgeEyeImg2');
    const stats1 = document.getElementById('statsEyeImg1');
    const stats2 = document.getElementById('statsEyeImg2');
    const banner = document.getElementById('eyeCalcStatus');
    const btnApply = /** @type {HTMLButtonElement | null} */ (
      document.getElementById('btnEyeApply')
    );

    if (badge1 && stats1) {
      if (!eyeCalibState.p1L) {
        badge1.className = 'badge cyan';
        badge1.textContent = 'Clique Olho Esquerdo';
        stats1.textContent = 'IPD: —';
      } else if (!eyeCalibState.p1R) {
        badge1.className = 'badge amber';
        badge1.textContent = 'Clique Olho Direito';
        stats1.textContent = 'Marcado Olho Esquerdo...';
      } else {
        const ipd1 = Math.round(Geo.dist(eyeCalibState.p1L, eyeCalibState.p1R));
        badge1.className = 'badge emerald';
        badge1.textContent = '✓ 2 Olhos Marcados';
        stats1.textContent = `IPD: ${ipd1} px`;
      }
    }

    if (badge2 && stats2) {
      if (!eyeCalibState.p2L) {
        badge2.className = 'badge';
        badge2.textContent = 'Clique Olho Esquerdo';
        stats2.textContent = 'IPD: —';
      } else if (!eyeCalibState.p2R) {
        badge2.className = 'badge amber';
        badge2.textContent = 'Clique Olho Direito';
        stats2.textContent = 'Marcado Olho Esquerdo...';
      } else {
        const ipd2 = Math.round(Geo.dist(eyeCalibState.p2L, eyeCalibState.p2R));
        badge2.className = 'badge emerald';
        badge2.textContent = '✓ 2 Olhos Marcados';
        stats2.textContent = `IPD: ${ipd2} px`;
      }
    }

    const ready = eyeCalibState.p1L && eyeCalibState.p1R && eyeCalibState.p2L && eyeCalibState.p2R;
    if (ready && state.img1Canvas && state.img2) {
      const res = Geo.computeSimilarityTransformFromEyes(
        eyeCalibState.p1L,
        eyeCalibState.p1R,
        eyeCalibState.p2L,
        eyeCalibState.p2R,
        state.img2.width,
        state.img2.height,
        state.img1Canvas.width,
        state.img1Canvas.height
      );
      eyeCalibState.calcResult = res;
      if (banner) {
        banner.textContent = `✨ IPD Base: ${res.ipd1}px | IPD Ref: ${res.ipd2}px | Escala: ${Math.round(res.scale * 100)}% | Rotação: ${res.rotation > 0 ? '+' : ''}${res.rotation.toFixed(1)}° | Translação: (${res.x}, ${res.y})`;
      }
      if (btnApply) btnApply.disabled = false;
    } else {
      eyeCalibState.calcResult = null;
      if (banner) {
        banner.textContent = 'Posicione os 2 olhos na imagem1 e os 2 olhos na imagem2';
      }
      if (btnApply) btnApply.disabled = true;
    }
  }

  function handleEyeCanvasClick(which, e) {
    const canvas = which === 1 ? canvasEyeImg1 : canvasEyeImg2;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const x = Math.round((e.clientX - rect.left) * scaleX);
    const y = Math.round((e.clientY - rect.top) * scaleY);
    const pt = { x, y };

    if (which === 1) {
      if (!eyeCalibState.p1L || (eyeCalibState.p1L && eyeCalibState.p1R)) {
        eyeCalibState.p1L = pt;
        eyeCalibState.p1R = null;
      } else {
        eyeCalibState.p1R = pt;
      }
    } else {
      if (!eyeCalibState.p2L || (eyeCalibState.p2L && eyeCalibState.p2R)) {
        eyeCalibState.p2L = pt;
        eyeCalibState.p2R = null;
      } else {
        eyeCalibState.p2R = pt;
      }
    }

    renderEyeCalibCanvases();
    updateEyeCalibUI();
  }

  function initEyeCalibrateModal() {
    const btnClose = document.getElementById('btnCloseEyeModal');
    const btnCancel = document.getElementById('btnEyeCancel');
    const btnReset = document.getElementById('btnEyeResetPoints');
    const btnApply = document.getElementById('btnEyeApply');

    btnClose?.addEventListener('click', closeEyeCalibrateModal);
    btnCancel?.addEventListener('click', closeEyeCalibrateModal);
    btnReset?.addEventListener('click', resetEyePoints);

    modalEyeCalibrate?.addEventListener('click', (e) => {
      if (e.target === modalEyeCalibrate) closeEyeCalibrateModal();
    });

    canvasEyeImg1?.addEventListener('click', (e) => handleEyeCanvasClick(1, e));
    canvasEyeImg2?.addEventListener('click', (e) => handleEyeCanvasClick(2, e));

    btnApply?.addEventListener('click', () => {
      if (!eyeCalibState.calcResult) return;
      const { scale, rotation, x, y } = eyeCalibState.calcResult;
      state.img2Transform = { x, y, scale, rotation };
      state.step2View = 'align';
      recomputeStep2Outputs();
      syncAllUI();
      closeEyeCalibrateModal();
      showToast(
        `🎯 Alinhamento por olhos aplicado: Escala ${Math.round(scale * 100)}%, Rotação ${rotation.toFixed(1)}°!`
      );
    });

    // Global keyboard hotkeys for Step 2
    window.addEventListener('keydown', (e) => {
      const tag = (e.target && /** @type {HTMLElement} */ (e.target).tagName) || '';
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (state.activeStep === 2) {
        if (e.code === 'KeyF' && !state.flickerActive) {
          state.flickerActive = true;
          syncViewportScene();
        } else if (e.key === '[') {
          state.img2Transform.rotation =
            Math.round(((state.img2Transform.rotation || 0) - 1) * 10) / 10;
          recomputeStep2Outputs();
          syncViewportScene();
          updateSidebarLiveValues();
        } else if (e.key === ']') {
          state.img2Transform.rotation =
            Math.round(((state.img2Transform.rotation || 0) + 1) * 10) / 10;
          recomputeStep2Outputs();
          syncViewportScene();
          updateSidebarLiveValues();
        }
      }
    });

    window.addEventListener('keyup', (e) => {
      if (e.code === 'KeyF' && state.flickerActive) {
        state.flickerActive = false;
        syncViewportScene();
      }
    });
  }

  // ===========================================================================
  // Themes, Settings & Disk-Persisted History (IndexedDB)
  // ===========================================================================

  /** @type {string[]} */
  let historyObjectUrls = [];
  function revokeHistoryObjectUrls() {
    while (historyObjectUrls.length > 0) {
      const u = historyObjectUrls.pop();
      if (u) {
        try {
          URL.revokeObjectURL(u);
        } catch (_) {}
      }
    }
  }

  function applyTheme(themeId, persist = false) {
    const chosen = THEMES.find((t) => t.id === themeId) || THEMES[0];
    state.appSettings.theme = chosen.id;
    document.documentElement.setAttribute('data-theme', chosen.id);
    if (metaThemeColor) {
      metaThemeColor.setAttribute('content', chosen.themeColor);
    }
    try {
      localStorage.setItem('sm_theme', chosen.id);
    } catch (_) {}
    viewport._gridPattern = null;
    viewport.requestRender();
    if (persist && Storage) {
      Storage.saveSettings(state.appSettings).catch(() => {});
    }
  }

  function setActiveView(view) {
    state.activeView = view;
    if (workspaceStudio) workspaceStudio.hidden = view !== 'studio';
    if (viewHistory) viewHistory.hidden = view !== 'history';
    if (viewSettings) viewSettings.hidden = view !== 'settings';

    btnViewStudio?.classList.toggle('active', view === 'studio');
    btnViewHistory?.classList.toggle('active', view === 'history');
    btnViewSettings?.classList.toggle('active', view === 'settings');

    if (view !== 'history') {
      revokeHistoryObjectUrls();
    }
    if (view === 'history') {
      renderHistoryView();
    } else if (view === 'settings') {
      renderSettingsView();
    } else {
      requestAnimationFrame(() => {
        viewport._syncCanvasSize();
        viewport.requestRender();
      });
    }
  }

  /**
   * Encodes a LoadedImage into a cached PNG blob without retaining temp canvases in RAM.
   * @param {LoadedImage & { _cachedBlob?: Blob }} loaded
   * @returns {Promise<Blob | null>}
   */
  async function loadedToBlobCached(loaded) {
    if (!loaded || !loaded.img) return null;
    if (loaded._cachedBlob) return loaded._cachedBlob;
    if (!Storage) return null;
    const tmp = Ops.sourceToCanvas(loaded.img);
    const blob = await Storage.canvasToBlob(tmp, 'image/png');
    if (tmp !== loaded.img) {
      Ops.releaseCanvas(tmp);
    }
    if (blob) loaded._cachedBlob = blob;
    return blob;
  }

  /**
   * Encodes binary mask Uint8Array to a tiny lossless grayscale PNG blob.
   * @param {Uint8Array} mask
   * @param {number} w
   * @param {number} h
   */
  async function maskToPngBlob(mask, w, h) {
    if (!Storage || !mask) return null;
    const c = Ops.createCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    const imgData = ctx.createImageData(w, h);
    const d = imgData.data;
    for (let i = 0; i < mask.length; i++) {
      const v = mask[i] ? 255 : 0;
      const p4 = i * 4;
      d[p4] = v;
      d[p4 + 1] = v;
      d[p4 + 2] = v;
      d[p4 + 3] = 255;
    }
    ctx.putImageData(imgData, 0, 0);
    const blob = await Storage.canvasToBlob(c, 'image/png');
    Ops.releaseCanvas(c);
    return blob;
  }

  let _autoSaveTimer = 0;
  function scheduleAutoSaveProject() {
    if (!state.appSettings.autoSaveHistory || !state.img1Canvas || !Storage) return;
    clearTimeout(_autoSaveTimer);
    _autoSaveTimer = window.setTimeout(() => {
      saveCurrentProjectToDisk(true).catch(() => {});
    }, 1800);
  }

  async function saveCurrentProjectToDisk(silent = true) {
    if (!Storage || !state.img1Canvas || !state.img1) {
      if (!silent) showToast('Importe pelo menos a imagem1 antes de salvar no histórico.', true);
      return false;
    }
    try {
      const isCompleted = !!(
        state.imgPostCanvas ||
        state.imgFinalCanvas ||
        (state.imgRefined && state.faceMask1)
      );
      const status = isCompleted ? 'completed' : 'in_progress';

      const thumbSrc =
        state.imgPostCanvas ||
        state.imgFinalCanvas ||
        state.imgMergeCanvas ||
        state.face1Canvas ||
        state.img1Canvas;
      const thumbBlob = await Storage.createThumbnailBlob(thumbSrc, 320);

      const img1Blob = await Storage.canvasToBlob(state.img1Canvas, 'image/png');
      const img2Blob = state.img2 ? await loadedToBlobCached(state.img2) : null;
      const imgRefinedBlob = state.imgRefined ? await loadedToBlobCached(state.imgRefined) : null;
      const finalTarget = state.imgPostCanvas || state.imgFinalCanvas;
      const finalBlob = finalTarget ? await Storage.canvasToBlob(finalTarget, 'image/png') : null;
      const mask1Blob =
        state.selection1 && state.selection1.type === 'auto-face' && state.rawMask1
          ? await maskToPngBlob(state.rawMask1, state.img1Canvas.width, state.img1Canvas.height)
          : null;

      const metaRecord = {
        id: state.currentProjectId,
        name:
          state.currentProjectName ||
          (state.img1.name ? state.img1.name.replace(/\.[^.]+$/, '') : 'Projeto sem título'),
        status,
        activeStep: state.activeStep,
        createdAt: state.currentProjectCreatedAt || Date.now(),
        updatedAt: Date.now(),
        width: state.img1Canvas.width,
        height: state.img1Canvas.height,
        thumbBlob,
        meta: {
          version: 1,
          selection1: state.selection1,
          faceIsOne1: state.faceIsOne1,
          img2Transform: { ...state.img2Transform },
          img2OnionOpacity: state.img2OnionOpacity,
          mergeRegionMode: state.mergeRegionMode,
          expandPx: state.expandPx,
          customSelection2: state.customSelection2,
          customFaceIsOne2: state.customFaceIsOne2,
          customExtraExpandPx: state.customExtraExpandPx,
          exportCroppedMode: state.exportCroppedMode,
          refinedTargetMode: state.refinedTargetMode,
          refinedTransform: { ...state.refinedTransform },
          refinedOnionOpacity: state.refinedOnionOpacity,
          finalMerge: { ...state.finalMerge },
          skinPost: { ...state.skinPost },
          skinSamplesFace: state.skinSamplesFace.slice(),
          skinSamplesBody: state.skinSamplesBody.slice(),
          img1Name: state.img1.name || 'imagem1.png',
          img2Name: state.img2 ? state.img2.name : '',
          refinedName: state.imgRefined ? state.imgRefined.name : '',
        },
      };

      const blobsRecord = {
        id: state.currentProjectId,
        img1Blob,
        img2Blob,
        imgRefinedBlob,
        finalBlob,
        mask1Blob,
      };

      await Storage.saveProject(metaRecord, blobsRecord);
      if (!silent) showToast('Projeto salvo no histórico em disco!');
      return true;
    } catch (err) {
      if (!silent) showToast((err && err.message) || 'Erro ao salvar projeto no disco.', true);
      return false;
    }
  }

  async function openStoredProject(id) {
    if (!Storage) return;
    try {
      const rec = await Storage.loadProject(id);
      if (!rec || !rec.metaRecord || !rec.blobsRecord || !rec.blobsRecord.img1Blob) {
        showToast('Não foi possível localizar os arquivos deste projeto.', true);
        return;
      }
      const { metaRecord, blobsRecord } = rec;
      const m = metaRecord.meta || {};

      clearActiveProjectMemory();

      state.currentProjectId = metaRecord.id;
      state.currentProjectName = metaRecord.name || 'Projeto';
      state.currentProjectCreatedAt = metaRecord.createdAt || Date.now();

      const img1Loaded = await Ops.loadImageFromBlob(blobsRecord.img1Blob, m.img1Name || 'imagem1.png');
      img1Loaded._cachedBlob = blobsRecord.img1Blob;
      state.img1 = img1Loaded;
      setStateCanvas('img1Canvas', Ops.sourceToCanvas(img1Loaded.img));

      const W = state.img1Canvas.width;
      const H = state.img1Canvas.height;

      state.selection1 = m.selection1 || null;
      state.faceIsOne1 = m.faceIsOne1 !== undefined ? !!m.faceIsOne1 : true;
      if (state.selection1 && state.selection1.polygon && state.selection1.polygon.length >= 3) {
        state.rawMask1 = Geo.rasterizePolygonMask(state.selection1.polygon, W, H);
      } else if (blobsRecord.mask1Blob) {
        const maskImg = await Ops.loadImageFromBlob(blobsRecord.mask1Blob, 'mask.png');
        const mc = Ops.sourceToCanvas(maskImg.img);
        const mctx = mc.getContext('2d', { willReadFrequently: true });
        if (mctx) {
          const md = mctx.getImageData(0, 0, W, H).data;
          const arr = new Uint8Array(W * H);
          for (let i = 0; i < arr.length; i++) arr[i] = md[i * 4] >= 128 ? 1 : 0;
          state.rawMask1 = arr;
        }
        Ops.releaseCanvas(mc);
      } else {
        state.rawMask1 = null;
      }

      if (blobsRecord.img2Blob) {
        const img2Loaded = await Ops.loadImageFromBlob(blobsRecord.img2Blob, m.img2Name || 'imagem2.png');
        img2Loaded._cachedBlob = blobsRecord.img2Blob;
        state.img2 = img2Loaded;
      }
      state.img2Transform = m.img2Transform ? { ...m.img2Transform } : { x: 0, y: 0, scale: 1, rotation: 0 };
      state.img2OnionOpacity = m.img2OnionOpacity ?? 0.35;
      state.mergeRegionMode = m.mergeRegionMode || 'expand';
      state.expandPx = m.expandPx ?? 36;
      state.customSelection2 = m.customSelection2 || null;
      state.customFaceIsOne2 = m.customFaceIsOne2 !== undefined ? !!m.customFaceIsOne2 : true;
      state.customExtraExpandPx = m.customExtraExpandPx ?? 0;

      if (state.customSelection2 && state.customSelection2.polygon && state.customSelection2.polygon.length >= 3) {
        state.customRawMask2 = Geo.rasterizePolygonMask(state.customSelection2.polygon, W, H);
        const normC = new Uint8Array(W * H);
        const want = state.customFaceIsOne2 ? 1 : 0;
        for (let i = 0; i < normC.length; i++) normC[i] = state.customRawMask2[i] === want ? 1 : 0;
        state.edtCustomOutSq = Geo.computeEDT2DSq(normC, 1, W, H);
        state.edtCustomInSq = Geo.computeEDT2DSq(normC, 0, W, H);
      }

      state.exportCroppedMode = !!m.exportCroppedMode;
      state.refinedTargetMode = m.refinedTargetMode || 'full';
      state.refinedTransform = m.refinedTransform ? { ...m.refinedTransform } : { x: 0, y: 0, scale: 1 };
      state.refinedOnionOpacity = m.refinedOnionOpacity ?? 0.32;

      if (blobsRecord.imgRefinedBlob) {
        const refLoaded = await Ops.loadImageFromBlob(
          blobsRecord.imgRefinedBlob,
          m.refinedName || 'refinada.png'
        );
        refLoaded._cachedBlob = blobsRecord.imgRefinedBlob;
        state.imgRefined = refLoaded;
      }

      if (m.finalMerge) state.finalMerge = { ...state.finalMerge, ...m.finalMerge };
      if (m.skinPost) state.skinPost = { ...state.skinPost, ...m.skinPost };
      state.skinSamplesFace = Array.isArray(m.skinSamplesFace) ? m.skinSamplesFace : [];
      state.skinSamplesBody = Array.isArray(m.skinSamplesBody) ? m.skinSamplesBody : [];

      const targetStep =
        metaRecord.activeStep >= 1 && metaRecord.activeStep <= 6 ? metaRecord.activeStep : 1;
      recomputeStep1Outputs(true);
      ensureStepComputed(targetStep);

      state.activeStep = targetStep;
      viewport.setDocumentSize(W, H, true);
      setActiveView('studio');
      syncAllUI();
      showToast(`Projeto "${state.currentProjectName}" reaberto do disco!`);
    } catch (err) {
      showToast((err && err.message) || 'Falha ao reabrir projeto.', true);
    }
  }

  function formatBytes(bytes) {
    if (!bytes || bytes < 1024) return `${Math.round(bytes || 0)} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  async function renderHistoryView() {
    if (!viewHistory) return;
    revokeHistoryObjectUrls();
    const allProjects = Storage ? await Storage.listProjects() : [];
    const filtered = allProjects.filter((p) => {
      if (state.historyFilter === 'all') return true;
      return p.status === state.historyFilter;
    });

    const inProgCount = allProjects.filter((p) => p.status === 'in_progress').length;
    const compCount = allProjects.filter((p) => p.status === 'completed').length;

    const cardsHtml =
      filtered.length === 0
        ? `<div class="empty-state-box">
            <div style="font-size:26px">🗂️</div>
            <div style="font-weight:700;color:var(--text-main)">Nenhum projeto nesta categoria ainda</div>
            <div style="font-size:12px;max-width:380px">Os projetos em andamento e finalizados são gravados automaticamente no disco (IndexedDB), sem consumir RAM nem cache volátil.</div>
            <button class="btn btn-primary btn-sm" id="btnHistBackStudio">← Voltar ao Estúdio</button>
          </div>`
        : `<div class="history-grid">
            ${filtered
              .map((p) => {
                let thumbUrl = '';
                if (p.thumbBlob) {
                  thumbUrl = URL.createObjectURL(p.thumbBlob);
                  historyObjectUrls.push(thumbUrl);
                }
                const dateStr = new Date(p.updatedAt || p.createdAt || Date.now()).toLocaleString(
                  'pt-BR',
                  { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }
                );
                const isCur = p.id === state.currentProjectId && !!state.img1Canvas;
                const badgeText = p.status === 'completed' ? '✓ Finalizado' : `Etapa ${p.activeStep || 1} • Em andamento`;
                return `
                  <article class="history-card ${isCur ? 'current' : ''}">
                    <div class="history-thumb-wrap">
                      ${thumbUrl ? `<img src="${thumbUrl}" alt="${escapeHtml(p.name)}" loading="lazy" />` : '<span style="color:var(--text-muted);font-size:11px">Sem miniatura</span>'}
                      <span class="history-status-badge ${p.status}">${badgeText}</span>
                    </div>
                    <div class="history-card-body">
                      <div class="history-card-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name || 'Projeto')}</div>
                      <div class="history-card-meta">
                        <span>${p.width || '?'}×${p.height || '?'} px</span>
                        <span>${dateStr}</span>
                      </div>
                      <div class="history-card-actions">
                        <button class="btn btn-primary btn-sm" style="flex:1.4" data-hist-open="${escapeHtml(p.id)}">📂 Abrir</button>
                        <button class="btn btn-sm" data-hist-dl="${escapeHtml(p.id)}" title="Baixar / Salvar PNG">⬇</button>
                        <button class="btn btn-sm btn-ghost" data-hist-ren="${escapeHtml(p.id)}" title="Renomear">✎</button>
                        <button class="btn btn-sm btn-ghost" data-hist-del="${escapeHtml(p.id)}" title="Excluir do disco">🗑</button>
                      </div>
                    </div>
                  </article>
                `;
              })
              .join('')}
          </div>`;

    viewHistory.innerHTML = `
      <div class="view-inner">
        <div class="view-header">
          <div>
            <h1 class="view-title">Histórico de Projetos</h1>
            <p class="view-subtitle">Salvos diretamente no disco do dispositivo (IndexedDB) • zero consumo contínuo de RAM</p>
          </div>
          <div class="btn-row">
            ${
              state.img1Canvas
                ? `<button class="btn btn-emerald btn-sm" id="btnHistSaveNow">💾 Salvar Projeto Atual</button>`
                : ''
            }
            <button class="btn btn-sm" id="btnHistToStudio">🎨 Ir ao Estúdio</button>
          </div>
        </div>

        <div class="filter-pills">
          <button class="filter-pill ${state.historyFilter === 'all' ? 'active' : ''}" data-hist-filter="all">Todos (${allProjects.length})</button>
          <button class="filter-pill ${state.historyFilter === 'in_progress' ? 'active' : ''}" data-hist-filter="in_progress">Em andamento (${inProgCount})</button>
          <button class="filter-pill ${state.historyFilter === 'completed' ? 'active' : ''}" data-hist-filter="completed">Finalizados (${compCount})</button>
        </div>

        ${cardsHtml}
      </div>
    `;

    document.getElementById('btnHistToStudio')?.addEventListener('click', () => setActiveView('studio'));
    document.getElementById('btnHistBackStudio')?.addEventListener('click', () => setActiveView('studio'));
    document.getElementById('btnHistSaveNow')?.addEventListener('click', async () => {
      ensureStepComputed(state.activeStep);
      const ok = await saveCurrentProjectToDisk(false);
      if (ok) renderHistoryView();
    });

    viewHistory.querySelectorAll('[data-hist-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.historyFilter = /** @type {'all' | 'in_progress' | 'completed'} */ (
          btn.getAttribute('data-hist-filter') || 'all'
        );
        renderHistoryView();
      });
    });

    viewHistory.querySelectorAll('[data-hist-open]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const id = btn.getAttribute('data-hist-open');
        if (id) openStoredProject(id);
      });
    });

    viewHistory.querySelectorAll('[data-hist-dl]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-hist-dl');
        if (!id || !Storage) return;
        const rec = await Storage.loadProject(id);
        if (!rec || !rec.blobsRecord) return;
        const blob = rec.blobsRecord.finalBlob || rec.blobsRecord.img1Blob;
        if (!blob) {
          showToast('Imagem não encontrada no disco.', true);
          return;
        }
        const loaded = await Ops.loadImageFromBlob(blob, `${rec.metaRecord.name || 'projeto'}.png`);
        const c = Ops.sourceToCanvas(loaded.img);
        await Ops.shareOrDownloadCanvas(c, `${rec.metaRecord.name || 'projeto'}.png`);
        Ops.releaseCanvas(c);
      });
    });

    viewHistory.querySelectorAll('[data-hist-ren]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-hist-ren');
        if (!id || !Storage) return;
        const nextName = prompt('Novo nome do projeto:');
        if (nextName && nextName.trim()) {
          await Storage.renameProject(id, nextName.trim());
          if (id === state.currentProjectId) state.currentProjectName = nextName.trim();
          renderHistoryView();
        }
      });
    });

    viewHistory.querySelectorAll('[data-hist-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const id = btn.getAttribute('data-hist-del');
        if (!id || !Storage) return;
        if (!confirm('Remover este projeto permanentemente do disco?')) return;
        await Storage.deleteProject(id);
        renderHistoryView();
        showToast('Projeto removido do disco.');
      });
    });
  }

  async function renderSettingsView() {
    if (!viewSettings) return;
    const est = Storage ? await Storage.estimateStorage() : { supported: false, usage: 0, quota: 0 };
    const pctUsed = est.quota > 0 ? Math.min(100, Math.round((est.usage / est.quota) * 1000) / 10) : 0;
    const cfg = state.appSettings;

    const themeCardsHtml = THEMES.map(
      (t) => `
      <button type="button" class="theme-card ${cfg.theme === t.id ? 'active' : ''}" data-theme-id="${t.id}">
        <span class="theme-swatch">
          <span class="theme-swatch-accent" style="background:linear-gradient(135deg, ${t.accent}, ${t.accent2})"></span>
        </span>
        <div>
          <div class="theme-name">${t.name}</div>
          <div class="theme-sub">${t.sub}</div>
        </div>
      </button>
    `
    ).join('');

    viewSettings.innerHTML = `
      <div class="view-inner">
        <div class="view-header">
          <div>
            <h1 class="view-title">Configurações &amp; Temas</h1>
            <p class="view-subtitle">Preferências persistidas em disco local (IndexedDB) • interface otimizada em preto obsidian</p>
          </div>
          <button class="btn btn-sm" id="btnSetToStudio">🎨 Voltar ao Estúdio</button>
        </div>

        <div class="settings-grid">
          <section class="settings-section" style="grid-column: 1 / -1">
            <div class="settings-section-title">
              <span>🎨 Tema Visual (Preto + Cor Principal)</span>
              <span class="badge cyan">${THEMES.find((x) => x.id === cfg.theme)?.name || 'Preto + Ciano'}</span>
            </div>
            <div class="theme-grid">
              ${themeCardsHtml}
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section-title">
              <span>🔍 Corte de Alta Precisão &amp; Lupa (Etapa 1)</span>
            </div>
            <label class="checkbox-row">
              <input type="checkbox" id="chkSetPrecMobile" ${cfg.precisionDefaultMobile ? 'checked' : ''} />
              <span>Ativar Lupa de Alta Precisão automaticamente no Mobile</span>
            </label>
            <div class="control-row">
              <div class="control-label">
                <span>Sensibilidade do movimento</span>
                <span class="control-val" id="valSetSens">${Math.round(cfg.precisionSensitivity * 100)}%</span>
              </div>
              <input type="range" id="rngSetSens" min="15" max="80" step="5" value="${Math.round(cfg.precisionSensitivity * 100)}" />
            </div>
            <div class="control-row">
              <div class="control-label">
                <span>Ampliação da Lupa</span>
                <span class="control-val" id="valSetZoom">${cfg.loupeZoom.toFixed(1)}×</span>
              </div>
              <input type="range" id="rngSetZoom" min="1.5" max="5.0" step="0.5" value="${cfg.loupeZoom}" />
            </div>
            <div class="control-row">
              <div class="control-label">
                <span>Diâmetro da Lupa</span>
                <span class="control-val" id="valSetSize">${cfg.loupeSize} px</span>
              </div>
              <input type="range" id="rngSetSize" min="100" max="176" step="4" value="${cfg.loupeSize}" />
            </div>
          </section>

          <section class="settings-section">
            <div class="settings-section-title">
              <span>💾 Disco &amp; Eficiência de Memória</span>
            </div>
            <label class="checkbox-row">
              <input type="checkbox" id="chkSetAutoSave" ${cfg.autoSaveHistory ? 'checked' : ''} />
              <span>Salvar projetos automaticamente no Histórico em disco</span>
            </label>
            <div style="display:flex;flex-direction:column;gap:5px;margin-top:4px">
              <div class="control-label">
                <span>Uso estimado em disco (IndexedDB)</span>
                <span class="control-val">${est.supported ? `${formatBytes(est.usage)}${est.quota ? ` / ${formatBytes(est.quota)}` : ''}` : 'Indisponível'}</span>
              </div>
              <div class="storage-bar-track">
                <div class="storage-bar-fill" style="width:${Math.max(2, pctUsed)}%"></div>
              </div>
            </div>
            <div class="btn-row" style="margin-top:6px">
              <button class="btn btn-sm" style="flex:1" id="btnSetFreeRam">🧹 Liberar memória inativa</button>
              <button class="btn btn-sm btn-ghost" id="btnSetClearHist">🗑 Limpar Histórico</button>
            </div>
          </section>
        </div>
      </div>
    `;

    document.getElementById('btnSetToStudio')?.addEventListener('click', () => setActiveView('studio'));

    viewSettings.querySelectorAll('[data-theme-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tid = btn.getAttribute('data-theme-id') || 'obsidian-cyan';
        applyTheme(tid, true);
        renderSettingsView();
        showToast('Tema atualizado!');
      });
    });

    const saveAndSyncViewport = () => {
      viewport.setPrecisionOptions({
        enabled: state.precisionCut,
        sensitivity: state.appSettings.precisionSensitivity,
        loupeZoom: state.appSettings.loupeZoom,
        loupeSize: state.appSettings.loupeSize,
      });
      if (Storage) Storage.saveSettings(state.appSettings).catch(() => {});
    };

    const chkPrecMob = /** @type {HTMLInputElement | null} */ (document.getElementById('chkSetPrecMobile'));
    chkPrecMob?.addEventListener('change', () => {
      state.appSettings.precisionDefaultMobile = chkPrecMob.checked;
      if (isMobileLayout()) state.precisionCut = chkPrecMob.checked;
      saveAndSyncViewport();
    });

    const rngSens = /** @type {HTMLInputElement | null} */ (document.getElementById('rngSetSens'));
    rngSens?.addEventListener('input', () => {
      state.appSettings.precisionSensitivity = (Number(rngSens.value) || 35) / 100;
      const lbl = document.getElementById('valSetSens');
      if (lbl) lbl.textContent = `${Math.round(state.appSettings.precisionSensitivity * 100)}%`;
      saveAndSyncViewport();
    });

    const rngZoom = /** @type {HTMLInputElement | null} */ (document.getElementById('rngSetZoom'));
    rngZoom?.addEventListener('input', () => {
      state.appSettings.loupeZoom = Number(rngZoom.value) || 3.0;
      const lbl = document.getElementById('valSetZoom');
      if (lbl) lbl.textContent = `${state.appSettings.loupeZoom.toFixed(1)}×`;
      saveAndSyncViewport();
    });

    const rngSize = /** @type {HTMLInputElement | null} */ (document.getElementById('rngSetSize'));
    rngSize?.addEventListener('input', () => {
      state.appSettings.loupeSize = Number(rngSize.value) || 132;
      const lbl = document.getElementById('valSetSize');
      if (lbl) lbl.textContent = `${state.appSettings.loupeSize} px`;
      saveAndSyncViewport();
    });

    const chkAutoSave = /** @type {HTMLInputElement | null} */ (document.getElementById('chkSetAutoSave'));
    chkAutoSave?.addEventListener('change', () => {
      state.appSettings.autoSaveHistory = chkAutoSave.checked;
      if (Storage) Storage.saveSettings(state.appSettings).catch(() => {});
    });

    document.getElementById('btnSetFreeRam')?.addEventListener('click', () => {
      const count = freeInactiveMemory();
      showToast(
        count > 0
          ? `Memória GPU liberada (${count} camadas inativas descarregadas).`
          : 'Memória já otimizada!'
      );
    });

    document.getElementById('btnSetClearHist')?.addEventListener('click', async () => {
      if (!Storage) return;
      if (!confirm('Apagar TODOS os projetos salvos no histórico em disco?')) return;
      await Storage.clearAllProjects();
      renderSettingsView();
      showToast('Histórico em disco apagado com sucesso.');
    });
  }

  function clearActiveProjectMemory() {
    viewport.cancelActiveStroke();
    state.activeStep = 1;
    state.img1 = null;
    setStateCanvas('img1Canvas', null);
    state.selection1 = null;
    state.prevSelection1 = null;
    state.rawMask1 = null;
    state.faceMask1 = null;
    state.edtFace1OutSq = null;
    state.edtFace1InSq = null;
    setStateCanvas('corpo1Canvas', null);
    setStateCanvas('face1Canvas', null);
    setStateCanvas('mask1OverlayCanvas', null);

    state.img2 = null;
    state.img2Transform = { x: 0, y: 0, scale: 1, rotation: 0 };
    setStateCanvas('img2AlignedCanvas', null);
    setStateCanvas('face2Canvas', null);

    state.customSelection2 = null;
    state.prevCustomSelection2 = null;
    state.customRawMask2 = null;
    state.edtCustomOutSq = null;
    state.edtCustomInSq = null;
    state.mergeFaceMask = null;
    state.edtMergeInsideSq = null;
    setStateCanvas('imgMergeCanvas', null);
    setStateCanvas('faceImprecisaCanvas', null);
    setStateCanvas('corpoSemBordasCanvas', null);
    setStateCanvas('mergeOverlayCanvas', null);

    state.imgRefined = null;
    state.refinedTransform = { x: 0, y: 0, scale: 1 };
    setStateCanvas('refinedAlignedCanvas', null);
    setStateCanvas('facePrecisaCanvas', null);

    state.finalMerge = {
      mode: 'none',
      radiusPx: 28,
      colorMatchStrength: 0,
      prioritizeSkin: true,
      poissonReach: 0.75,
      protectCoreFace: true,
    };
    setStateCanvas('imgFinalUnblendedCanvas', null);
    setStateCanvas('imgFinalCanvas', null);

    state.skinSamplesFace = [];
    state.skinSamplesBody = [];
    state.step6Tool = 'pan';
    state.step6View = 'post';
    setStateCanvas('imgPostCanvas', null);
    setStateCanvas('skinMaskPreviewCanvas', null);
    state.skinDiagnostics = null;
    state.skinPost = {
      enabled: true,
      method: 'oklab_ot',
      direction: 'face_to_body',
      strength: 1.0,
      lumaMatch: 0.88,
      chromaMatch: 1.0,
      maskSelectivity: 0.72,
      protectFeatures: true,
      seamEqualizePx: 36,
      borderMatchStrength: 0.9,
      borderMutualMeet: true,
      tempOffset: 0,
      tintOffset: 0,
      lightOffset: 0,
      satScale: 1.0,
    };
    markDirtyFrom(2, true);
  }

  function syncAllUI() {
    renderStepper();
    renderStageToolbar();
    renderSidebar();
    syncViewportScene();
  }

  // ===========================================================================
  // Top Toolbar & Demo Controls
  // ===========================================================================
  btnToggleOverlay.addEventListener('click', () => {
    state.showGuides = !state.showGuides;
    btnToggleOverlay.classList.toggle('active', state.showGuides);
    syncViewportScene();
  });

  btnZoomIn.addEventListener('click', () => viewport.setZoom(viewport.zoom * 1.25));
  btnZoomOut.addEventListener('click', () => viewport.setZoom(viewport.zoom / 1.25));
  btnZoomFit.addEventListener('click', () => viewport.fitToViewport());

  btnResetAll.addEventListener('click', async () => {
    if (state.img1 && !confirm('Salvar o projeto atual no histórico e iniciar um novo?')) return;
    if (state.img1 && state.appSettings.autoSaveHistory) {
      await saveCurrentProjectToDisk(true);
    }
    clearActiveProjectMemory();
    state.currentProjectId = generateProjectId();
    state.currentProjectName = '';
    state.currentProjectCreatedAt = Date.now();
    viewport.setDocumentSize(0, 0, false);
    setActiveView('studio');
    syncAllUI();
    showToast('Novo projeto iniciado (anterior preservado no histórico).');
  });

  /**
   * @param {1 | 2 | 3 | 4 | 5 | 6} [initialStep=1]
   * @param {boolean} [compareMode=false]
   */
  async function loadDemoProject(initialStep = 1, compareMode = false) {
    try {
      const demo = await Ops.generateDemoAssets();
      state.currentProjectId = generateProjectId();
      state.currentProjectName = 'Demonstração Studio';
      state.currentProjectCreatedAt = Date.now();

      state.img1 = demo.img1;
      setStateCanvas('img1Canvas', Ops.sourceToCanvas(demo.img1.img));
      const W = demo.img1.width;
      const H = demo.img1.height;

      const cutPath = [
        { x: 0, y: H * 0.43 },
        { x: W * 0.28, y: H * 0.44 },
        { x: W * 0.5, y: H * 0.47 },
        { x: W * 0.72, y: H * 0.44 },
        { x: W, y: H * 0.43 },
      ];
      const poly = Geo.buildBorderCutPolygon(cutPath, W, H);
      state.selection1 = {
        type: 'border-cut',
        polygon: poly,
        cutPath,
        pIn: cutPath[0],
        pOut: cutPath[cutPath.length - 1],
      };
      state.rawMask1 = Geo.rasterizePolygonMask(poly, W, H);
      state.faceIsOne1 = Geo.guessFaceIsOne(state.rawMask1, W, H);

      state.img2 = demo.img2;
      state.img2Transform = { x: 0, y: -38, scale: 1 };

      state.mergeRegionMode = 'expand';
      state.expandPx = 42;
      state.exportCroppedMode = false;
      state.refinedTargetMode = 'full';
      state.refinedTransform = { x: 0, y: 0, scale: 1 };
      state.finalMerge = {
        mode: 'multiband',
        radiusPx: 26,
        colorMatchStrength: initialStep === 6 ? 0 : 0.75,
        prioritizeSkin: true,
        poissonReach: 0.75,
        protectCoreFace: true,
      };
      state.skinSamplesFace = [];
      state.skinSamplesBody = [];
      state.step6Tool = 'pan';
      state.skinPost = {
        enabled: true,
        method: 'oklab_ot',
        direction: 'face_to_body',
        strength: 1.0,
        lumaMatch: 0.92,
        chromaMatch: 1.0,
        maskSelectivity: 0.72,
        protectFeatures: true,
        seamEqualizePx: 36,
        borderMatchStrength: 0.9,
        borderMutualMeet: true,
        tempOffset: 0,
        tintOffset: 0,
        lightOffset: 0,
        satScale: 1.0,
      };

      recomputeStep1Outputs(true);
      state.imgRefined = await demo.refinedSample(null);
      ensureStepComputed(Math.max(4, initialStep));

      viewport.setDocumentSize(W, H, true);
      state.activeStep = initialStep;
      if (compareMode) {
        state.step5View = 'compare-raw';
        state.step6View = 'compare-pre';
      } else if (urlParams.get('view') === 'mask') {
        state.step6View = 'skin-mask';
      }
      setActiveView('studio');
      syncAllUI();
      viewport._draw();
      scheduleAutoSaveProject();
      showToast('Exemplo completo carregado! Navegue pelas Etapas 1 a 6 ou ajuste o tom de pele.');
    } catch (err) {
      showToast(err.message || 'Erro ao gerar exemplo.', true);
    }
  }

  btnLoadDemo.addEventListener('click', () => loadDemoProject(1, false));

  btnViewStudio?.addEventListener('click', () => setActiveView('studio'));
  btnViewHistory?.addEventListener('click', () => setActiveView('history'));
  btnViewSettings?.addEventListener('click', () => setActiveView('settings'));

  // Flush unsaved project cleanly when leaving/hiding tab
  window.addEventListener('pagehide', () => {
    if (state.appSettings.autoSaveHistory && state.img1Canvas) {
      saveCurrentProjectToDisk(true).catch(() => {});
    }
  });

  // Initial render (and disk-persisted settings bootstrap + optional ?demo=1&step=N deep link)
  const urlParams = new URLSearchParams(window.location.search);
  initMobileSheet();
  initDataFolderControl();
  initAutoSelectModal();
  initEyeCalibrateModal();

  (async () => {
    if (Storage) {
      try {
        state.appSettings = await Storage.loadSettings(DEFAULT_SETTINGS);
      } catch (_) {
        state.appSettings = { ...DEFAULT_SETTINGS };
      }
    }
    applyTheme(state.appSettings.theme, false);
    if (isMobileLayout() && state.appSettings.precisionDefaultMobile) {
      state.precisionCut = true;
    }
    viewport.setPrecisionOptions({
      enabled: state.precisionCut,
      sensitivity: state.appSettings.precisionSensitivity,
      loupeZoom: state.appSettings.loupeZoom,
      loupeSize: state.appSettings.loupeSize,
    });
    syncAllUI();

    if (urlParams.get('demo') === '1') {
      const rawStep = urlParams.get('step');
      const reqStep = Number(rawStep);
      /** @type {1 | 2 | 3 | 4 | 5 | 6} */
      const validStep =
        reqStep >= 1 && reqStep <= 6 ? /** @type {1|2|3|4|5|6} */ (reqStep) : 1;
      loadDemoProject(validStep, urlParams.get('view') === 'compare');
    }
  })();
})();
