// @ts-check
/// <reference path="./types.js" />

(function (global) {
  'use strict';

  /**
   * @param {number} w
   * @param {number} h
   * @returns {HTMLCanvasElement}
   */
  function createCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w));
    c.height = Math.max(1, Math.round(h));
    return c;
  }

  /**
   * @param {HTMLImageElement | HTMLCanvasElement} src
   * @returns {HTMLCanvasElement}
   */
  function sourceToCanvas(src) {
    const w = src instanceof HTMLImageElement ? src.naturalWidth || src.width : src.width;
    const h = src instanceof HTMLImageElement ? src.naturalHeight || src.height : src.height;
    const c = createCanvas(w, h);
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(src, 0, 0, w, h);
    }
    return c;
  }

  /**
   * Extracts raw ArrayBuffer + MIME cleanly from a Blob without allocating any canvas or DataURL.
   * @param {Blob} b
   * @returns {Promise<{ data: ArrayBuffer, type: string } | null>}
   */
  async function blobToBytesFast(b) {
    if (!b || b.size <= 0) return null;
    try {
      if (typeof b.arrayBuffer === 'function') {
        const buf = await b.arrayBuffer();
        if (buf && buf.byteLength > 0) {
          return { data: buf, type: b.type || 'image/png' };
        }
      }
    } catch (_) {}
    return new Promise((resolve) => {
      try {
        const reader = new FileReader();
        reader.onload = () => {
          const buf = /** @type {ArrayBuffer | null} */ (reader.result);
          resolve(
            buf && buf instanceof ArrayBuffer && buf.byteLength > 0
              ? { data: buf, type: b.type || 'image/png' }
              : null
          );
        };
        reader.onerror = () => resolve(null);
        reader.readAsArrayBuffer(b);
      } catch (_) {
        resolve(null);
      }
    });
  }

  /**
   * Decodes a Blob into an HTMLImageElement cleanly using ObjectURL (low RAM) on HTTP/HTTPS,
   * falling back to FileReader DataURL on file:// to keep canvas untainted.
   * @param {Blob} blob
   * @returns {Promise<HTMLImageElement>}
   */
  function decodeBlobToImage(blob) {
    return new Promise((resolve, reject) => {
      const canUseObjectUrl =
        typeof URL !== 'undefined' &&
        typeof URL.createObjectURL === 'function' &&
        typeof window !== 'undefined' &&
        window.location &&
        window.location.protocol !== 'file:';

      if (canUseObjectUrl) {
        let objUrl = '';
        try {
          objUrl = URL.createObjectURL(blob);
          const img = new Image();
          img.onload = () => {
            try {
              URL.revokeObjectURL(objUrl);
            } catch (_) {}
            resolve(img);
          };
          img.onerror = () => {
            try {
              URL.revokeObjectURL(objUrl);
            } catch (_) {}
            reject(new Error('Formato de imagem inválido ou não suportado.'));
          };
          img.src = objUrl;
          return;
        } catch (_) {
          if (objUrl) {
            try {
              URL.revokeObjectURL(objUrl);
            } catch (_) {}
          }
        }
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem.'));
      reader.onload = () => {
        const dataUrl = /** @type {string} */ (reader.result);
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Formato de imagem inválido ou não suportado.'));
        img.src = dataUrl;
      };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Loads an image File/Blob into a clean HTMLImageElement, with optional mobile maxEdge
   * downscaling and cached disk bytes to keep mobile Safari memory low.
   *
   * @param {Blob} blob
   * @param {string} [name]
   * @param {{ maxEdge?: number }} [opts]
   * @returns {Promise<LoadedImage>}
   */
  async function loadImageFromBlob(blob, name = 'imagem.png', opts = {}) {
    if (!blob || !(blob instanceof Blob) || blob.size <= 0) {
      throw new Error('Arquivo de imagem vazio ou corrompido.');
    }

    const img = await decodeBlobToImage(blob);
    const w = img.naturalWidth || img.width;
    const h = img.naturalHeight || img.height;
    const maxEdge = opts && Number(opts.maxEdge) > 0 ? Number(opts.maxEdge) : 0;

    if (maxEdge > 0 && Math.max(w, h) > maxEdge) {
      const scale = maxEdge / Math.max(w, h);
      const tw = Math.max(1, Math.round(w * scale));
      const th = Math.max(1, Math.round(h * scale));
      const c = createCanvas(tw, th);
      const ctx = c.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.clearRect(0, 0, tw, th);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, tw, th);
      }

      // Free the huge decoded bitmap immediately on WebKit/Safari
      try {
        img.src = '';
      } catch (_) {}

      let hasAlpha = false;
      if (ctx && (blob.type === 'image/png' || blob.type === 'image/webp' || !blob.type)) {
        try {
          const data = ctx.getImageData(0, 0, tw, th).data;
          const stride = 64; // sample every 16 pixels (16 * 4 bytes)
          for (let i = 3; i < data.length; i += stride) {
            if (data[i] < 252) {
              hasAlpha = true;
              break;
            }
          }
        } catch (_) {}
      }

      const outType = hasAlpha ? 'image/png' : 'image/jpeg';
      const outQuality = hasAlpha ? undefined : 0.93;
      const smallBlob = await new Promise((resolve) => {
        try {
          c.toBlob((b) => resolve(b || null), outType, outQuality);
        } catch (_) {
          resolve(null);
        }
      });
      releaseCanvas(c);

      if (smallBlob && smallBlob.size > 0) {
        const smallImg = await decodeBlobToImage(smallBlob);
        const _diskBytes = await blobToBytesFast(smallBlob);
        return {
          img: smallImg,
          width: smallImg.naturalWidth || smallImg.width || tw,
          height: smallImg.naturalHeight || smallImg.height || th,
          name,
          _diskBytes,
          _wasDownscaled: true,
          _origWidth: w,
          _origHeight: h,
        };
      }
      // Fallback if toBlob returned null unexpectedly
      const redecoded = await decodeBlobToImage(blob);
      const _diskBytes = await blobToBytesFast(blob);
      return {
        img: redecoded,
        width: w,
        height: h,
        name,
        _diskBytes,
        _wasDownscaled: false,
        _origWidth: w,
        _origHeight: h,
      };
    }

    const _diskBytes = await blobToBytesFast(blob);
    return {
      img,
      width: w,
      height: h,
      name,
      _diskBytes,
      _wasDownscaled: false,
      _origWidth: w,
      _origHeight: h,
    };
  }

  /**
   * Extracts an image Blob from a ClipboardEvent if present.
   * @param {ClipboardEvent} e
   * @param {{ maxEdge?: number }} [opts]
   * @returns {Promise<LoadedImage | null>}
   */
  async function extractImageFromPasteEvent(e, opts = {}) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          return loadImageFromBlob(file, `colado_${Date.now()}.png`, opts);
        }
      }
    }
    return null;
  }

  /**
   * Reads an image directly via the Async Clipboard API (when triggered by a button click).
   * @param {{ maxEdge?: number }} [opts]
   * @returns {Promise<LoadedImage | null>}
   */
  async function readImageFromClipboardAPI(opts = {}) {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      throw new Error('Use Ctrl+V para colar diretamente neste navegador.');
    }
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imgType = item.types.find((t) => t.startsWith('image/'));
      if (imgType) {
        const blob = await item.getType(imgType);
        return loadImageFromBlob(blob, `colado_${Date.now()}.png`, opts);
      }
    }
    return null;
  }

  /**
   * Computes draw geometry for fitting source (srcW x srcH) inside targetBox (within fullW x fullH)
   * with automatic centered transparent padding + manual LayerTransform { x, y, scale }.
   *
   * @param {number} srcW
   * @param {number} srcH
   * @param {RectBox} targetBox
   * @param {LayerTransform} transform
   */
  function computeFittedPlacement(srcW, srcH, targetBox, transform) {
    const fitScale = Math.min(targetBox.w / Math.max(1, srcW), targetBox.h / Math.max(1, srcH));
    const scale = transform ? transform.scale : 1;
    const tx = transform ? transform.x : 0;
    const ty = transform ? transform.y : 0;
    const rotation = transform && Number.isFinite(transform.rotation) ? transform.rotation : 0;

    const drawW = srcW * fitScale * scale;
    const drawH = srcH * fitScale * scale;
    const cx = targetBox.x + targetBox.w * 0.5 + tx;
    const cy = targetBox.y + targetBox.h * 0.5 + ty;

    return {
      fitScale,
      effectiveScale: fitScale * scale,
      cx,
      cy,
      drawX: cx - drawW * 0.5,
      drawY: cy - drawH * 0.5,
      drawW,
      drawH,
      rotation,
    };
  }

  /**
   * Renders sourceImg onto a fullW x fullH transparent canvas, fitted inside targetBox
   * with automatic centering + transparent padding + manual move/scale/rotation adjustment.
   *
   * @param {LoadedImage} source
   * @param {RectBox} targetBox
   * @param {number} fullW
   * @param {number} fullH
   * @param {LayerTransform} transform
   * @returns {{ canvas: HTMLCanvasElement, placement: ReturnType<typeof computeFittedPlacement> }}
   */
  function renderFittedWithPadding(source, targetBox, fullW, fullH, transform) {
    const canvas = createCanvas(fullW, fullH);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const placement = computeFittedPlacement(source.width, source.height, targetBox, transform);

    if (ctx) {
      ctx.clearRect(0, 0, fullW, fullH);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';

      // Progressive 2x mipmap downscaling when shrinking > 1.8x avoids moiré & harsh aliasing
      /** @type {HTMLImageElement | HTMLCanvasElement} */
      let drawSource = source.img;
      let curW = source.width;
      let curH = source.height;
      /** @type {HTMLCanvasElement[]} */
      const mipsToFree = [];

      if (placement.effectiveScale < 0.55 && curW > 120 && curH > 120) {
        while (curW * 0.5 > placement.drawW * 1.15 && curH * 0.5 > placement.drawH * 1.15) {
          const nw = Math.max(2, Math.round(curW * 0.5));
          const nh = Math.max(2, Math.round(curH * 0.5));
          const mip = createCanvas(nw, nh);
          const mctx = mip.getContext('2d');
          if (!mctx) {
            releaseCanvas(mip);
            break;
          }
          mctx.imageSmoothingEnabled = true;
          mctx.imageSmoothingQuality = 'high';
          mctx.drawImage(drawSource, 0, 0, nw, nh);
          if (drawSource !== source.img && drawSource instanceof HTMLCanvasElement) {
            releaseCanvas(drawSource);
          }
          drawSource = mip;
          curW = nw;
          curH = nh;
          mipsToFree.push(mip);
          if (nw <= 64 || nh <= 64) break;
        }
      }

      if (placement.rotation) {
        ctx.save();
        ctx.translate(placement.cx, placement.cy);
        ctx.rotate((placement.rotation * Math.PI) / 180);
        ctx.drawImage(
          drawSource,
          -placement.drawW * 0.5,
          -placement.drawH * 0.5,
          placement.drawW,
          placement.drawH
        );
        ctx.restore();
      } else {
        ctx.drawImage(
          drawSource,
          placement.drawX,
          placement.drawY,
          placement.drawW,
          placement.drawH
        );
      }

      for (const m of mipsToFree) {
        releaseCanvas(m);
      }
    }

    return { canvas, placement };
  }

  /**
   * Analyzes the true effective pixel density (spatial resolution + replicated pixel blocks)
   * of an image/canvas, ignoring transparent padding regions and flat background areas.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {Uint8Array | null} [focusMask=null] Optional binary mask to prefer sampling active region
   * @returns {{
   *   effectivePitch: number,
   *   repFactor: number,
   *   blurPitch: number,
   *   isBlocky: boolean,
   *   effW: number,
   *   effH: number,
   *   nominalW: number,
   *   nominalH: number
   * }}
   */
  function analyzeEffectivePixelDensity(canvas, focusMask = null) {
    const W = canvas.width;
    const H = canvas.height;
    const baseResult = {
      effectivePitch: 1,
      repFactor: 1,
      blurPitch: 1,
      isBlocky: false,
      effW: W,
      effH: H,
      nominalW: W,
      nominalH: H,
    };
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || W < 16 || H < 16) return baseResult;

    // Locate bounding box of opaque pixels (ignoring transparent padding)
    let minX = W, minY = H, maxX = -1, maxY = -1;
    const probeStep = Math.max(1, Math.floor(Math.max(W, H) / 128));
    try {
      const fullData = ctx.getImageData(0, 0, W, H).data;
      for (let y = 0; y < H; y += probeStep) {
        const row = y * W;
        for (let x = 0; x < W; x += probeStep) {
          const i = row + x;
          if (fullData[i * 4 + 3] >= 128 && (!focusMask || focusMask[i] === 1)) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < minX) {
        for (let y = 0; y < H; y += probeStep) {
          const row = y * W;
          for (let x = 0; x < W; x += probeStep) {
            if (fullData[(row + x) * 4 + 3] >= 128) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
      }
      if (maxX < minX) {
        minX = 0; minY = 0; maxX = W - 1; maxY = H - 1;
      }

      const cx = (minX + maxX) >> 1;
      const cy = (minY + maxY) >> 1;
      const sw = Math.min(512, Math.max(16, maxX - minX + 1));
      const sh = Math.min(512, Math.max(16, maxY - minY + 1));
      const sx = Math.max(0, Math.min(W - sw, cx - (sw >> 1)));
      const sy = Math.max(0, Math.min(H - sh, cy - (sh >> 1)));

      const nSub = sw * sh;
      const lum = new Float32Array(nSub);
      const valid = new Uint8Array(nSub);
      for (let y = 0; y < sh; y++) {
        const fRow = (sy + y) * W + sx;
        const sRow = y * sw;
        for (let x = 0; x < sw; x++) {
          const fi = fRow + x;
          const si = sRow + x;
          const p4 = fi * 4;
          if (fullData[p4 + 3] >= 128) {
            valid[si] = 1;
            lum[si] =
              0.299 * fullData[p4] + 0.587 * fullData[p4 + 1] + 0.114 * fullData[p4 + 2];
          }
        }
      }

      // 1. Replicated-pixel detector (nearest-neighbor block grid periods 2, 3, 4 & zero-diff runs)
      let totalPairDiffs = 0;
      let zeroDiffCount = 0;
      const p2 = [0, 0], p2c = [0, 0];
      const p3 = [0, 0, 0], p3c = [0, 0, 0];
      const p4arr = [0, 0, 0, 0], p4c = [0, 0, 0, 0];

      for (let y = 0; y < sh - 1; y++) {
        const row = y * sw;
        for (let x = 0; x < sw - 1; x++) {
          const i = row + x;
          if (!valid[i] || !valid[i + 1] || !valid[i + sw]) continue;
          const dx = Math.abs(lum[i + 1] - lum[i]);
          const dy = Math.abs(lum[i + sw] - lum[i]);
          // Skip dead flat areas
          if (x + 4 < sw && valid[i + 4] && Math.abs(lum[i + 4] - lum[i]) > 6) {
            totalPairDiffs++;
            if (dx <= 1.2) zeroDiffCount++;
            p2[x % 2] += dx; p2c[x % 2]++;
            p3[x % 3] += dx; p3c[x % 3]++;
            p4arr[x % 4] += dx; p4c[x % 4]++;
          }
          if (y + 4 < sh && valid[i + 4 * sw] && Math.abs(lum[i + 4 * sw] - lum[i]) > 6) {
            totalPairDiffs++;
            if (dy <= 1.2) zeroDiffCount++;
            p2[y % 2] += dy; p2c[y % 2]++;
            p3[y % 3] += dy; p3c[y % 3]++;
            p4arr[y % 4] += dy; p4c[y % 4]++;
          }
        }
      }

      let repFactor = 1.0;
      if (totalPairDiffs >= 80) {
        const evalPeriod = (sums, counts) => {
          let maxM = 0;
          let minM = 1e9;
          for (let k = 0; k < sums.length; k++) {
            if (counts[k] < 15) return 1.0;
            const m = sums[k] / counts[k];
            if (m > maxM) maxM = m;
            if (m < minM) minM = m;
          }
          return maxM / Math.max(0.2, minM);
        };
        const r2 = evalPeriod(p2, p2c);
        const r3 = evalPeriod(p3, p3c);
        const r4 = evalPeriod(p4arr, p4c);
        let bestK = 1;
        let bestScore = 2.15;
        if (r4 >= bestScore) { bestK = 4; bestScore = r4; }
        if (r3 >= bestScore && r3 > r4 * 0.92) { bestK = 3; bestScore = r3; }
        if (r2 >= bestScore && r2 > r3 * 1.15 && r2 > r4 * 1.05) { bestK = 2; }

        if (bestK > 1) {
          repFactor = bestK;
        } else {
          const zRatio = zeroDiffCount / totalPairDiffs;
          if (zRatio > 0.44) {
            repFactor = Math.max(1.0, Math.min(5.0, 1 / Math.max(0.2, 1 - Math.max(0, zRatio - 0.18))));
          }
        }
      }

      // 2. Spatial bandwidth / soft-upscaling estimator (Laplacian octave ratio)
      let l1Sum = 0, l2Sum = 0, l4Sum = 0, texCnt = 0;
      for (let y = 4; y < sh - 4; y++) {
        const row = y * sw;
        for (let x = 4; x < sw - 4; x++) {
          const i = row + x;
          if (!valid[i - 4] || !valid[i + 4] || !valid[i - 4 * sw] || !valid[i + 4 * sw]) continue;
          const span = Math.abs(lum[i + 4] - lum[i - 4]) + Math.abs(lum[i + 4 * sw] - lum[i - 4 * sw]);
          if (span < 16) continue;
          const l1 =
            Math.abs(2 * lum[i] - lum[i - 1] - lum[i + 1]) +
            Math.abs(2 * lum[i] - lum[i - sw] - lum[i + sw]);
          const l2 =
            Math.abs(2 * lum[i] - lum[i - 2] - lum[i + 2]) +
            Math.abs(2 * lum[i] - lum[i - 2 * sw] - lum[i + 2 * sw]);
          const l4 =
            Math.abs(2 * lum[i] - lum[i - 4] - lum[i + 4]) +
            Math.abs(2 * lum[i] - lum[i - 4 * sw] - lum[i + 4 * sw]);
          l1Sum += l1;
          l2Sum += l2;
          l4Sum += l4;
          texCnt++;
        }
      }

      let blurPitch = 1.0;
      if (texCnt >= 40 && l2Sum > 1e-3 && l4Sum > 1e-3) {
        const r12 = l1Sum / l2Sum;
        if (r12 < 0.36) {
          blurPitch = Math.max(1.0, Math.min(4.5, 0.36 / Math.max(0.07, r12)));
        }
      }

      const effectivePitch = Math.max(repFactor, blurPitch);
      return {
        effectivePitch,
        repFactor,
        blurPitch,
        isBlocky: repFactor >= 1.32,
        effW: Math.max(1, Math.round(W / effectivePitch)),
        effH: Math.max(1, Math.round(H / effectivePitch)),
        nominalW: W,
        nominalH: H,
      };
    } catch (_) {
      return baseResult;
    }
  }

  /**
   * Matches effective pixel density & replicated-pixel texture of `img2AlignedCanvas` to `img1Canvas`,
   * preserving the exact alpha channel of `img2AlignedCanvas` (no transparent edge halos).
   *
   * @param {HTMLCanvasElement} img2AlignedCanvas
   * @param {HTMLCanvasElement} img1Canvas
   * @param {Uint8Array | null} [faceMask1=null]
   * @param {ReturnType<typeof analyzeEffectivePixelDensity> | null} [cachedD1=null]
   * @returns {{
   *   canvas: HTMLCanvasElement,
   *   adjusted: boolean,
   *   mode: string,
   *   d1: ReturnType<typeof analyzeEffectivePixelDensity>,
   *   d2: ReturnType<typeof analyzeEffectivePixelDensity>
   * }}
   */
  function matchCanvasPixelDensity(
    img2AlignedCanvas,
    img1Canvas,
    faceMask1 = null,
    cachedD1 = null
  ) {
    const W = img2AlignedCanvas.width;
    const H = img2AlignedCanvas.height;
    const d1 = cachedD1 || analyzeEffectivePixelDensity(img1Canvas, faceMask1);
    const d2 = analyzeEffectivePixelDensity(img2AlignedCanvas, faceMask1);

    const ratio = d2.effectivePitch / Math.max(0.1, d1.effectivePitch);
    if (ratio >= 0.88 && ratio <= 1.13) {
      return { canvas: img2AlignedCanvas, adjusted: false, mode: 'matched', d1, d2 };
    }

    const srcCtx = img2AlignedCanvas.getContext('2d', { willReadFrequently: true });
    if (!srcCtx) {
      return { canvas: img2AlignedCanvas, adjusted: false, mode: 'matched', d1, d2 };
    }
    const origAlpha = new Uint8Array(W * H);
    const origData = srcCtx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < origAlpha.length; i++) origAlpha[i] = origData[i * 4 + 3];

    if (d1.effectivePitch > d2.effectivePitch * 1.13) {
      // img1 has lower effective density (soft or replicated pixels) -> bring img2 down to match img1
      const factor = Math.max(1.1, Math.min(5.0, d1.effectivePitch / d2.effectivePitch));
      const tw = Math.max(16, Math.round(W / factor));
      const th = Math.max(16, Math.round(H / factor));
      const low = createCanvas(tw, th);
      const lCtx = low.getContext('2d');
      const out = createCanvas(W, H);
      const oCtx = out.getContext('2d', { willReadFrequently: true });
      if (!lCtx || !oCtx) {
        releaseCanvas(low);
        releaseCanvas(out);
        return { canvas: img2AlignedCanvas, adjusted: false, mode: 'matched', d1, d2 };
      }
      lCtx.imageSmoothingEnabled = true;
      lCtx.imageSmoothingQuality = 'high';
      lCtx.drawImage(img2AlignedCanvas, 0, 0, tw, th);

      oCtx.imageSmoothingEnabled = !d1.isBlocky;
      if (!d1.isBlocky) oCtx.imageSmoothingQuality = 'high';
      oCtx.drawImage(low, 0, 0, W, H);
      releaseCanvas(low);

      // Restore exact original alpha mask cleanly
      const outImg = oCtx.getImageData(0, 0, W, H);
      const od = outImg.data;
      for (let i = 0; i < origAlpha.length; i++) {
        od[i * 4 + 3] = origAlpha[i];
      }
      oCtx.putImageData(outImg, 0, 0);
      return {
        canvas: out,
        adjusted: true,
        mode: d1.isBlocky ? 'match-blocky' : 'match-soft',
        d1,
        d2,
      };
    }

    // img2 has lower effective density (e.g. replicated pixel blocks) than crisp img1 -> de-replicate + micro-sharpen
    const out = createCanvas(W, H);
    const oCtx = out.getContext('2d', { willReadFrequently: true });
    if (!oCtx) {
      releaseCanvas(out);
      return { canvas: img2AlignedCanvas, adjusted: false, mode: 'matched', d1, d2 };
    }

    if (d2.isBlocky && d2.repFactor >= 1.3) {
      const tw = Math.max(16, Math.round(W / d2.repFactor));
      const th = Math.max(16, Math.round(H / d2.repFactor));
      const tmp = createCanvas(tw, th);
      const tCtx = tmp.getContext('2d');
      if (tCtx) {
        tCtx.imageSmoothingEnabled = true;
        tCtx.imageSmoothingQuality = 'high';
        tCtx.drawImage(img2AlignedCanvas, 0, 0, tw, th);
        oCtx.imageSmoothingEnabled = true;
        oCtx.imageSmoothingQuality = 'high';
        oCtx.drawImage(tmp, 0, 0, W, H);
      } else {
        oCtx.drawImage(img2AlignedCanvas, 0, 0, W, H);
      }
      releaseCanvas(tmp);
    } else {
      oCtx.drawImage(img2AlignedCanvas, 0, 0, W, H);
    }

    // Gentle edge-aware luminance micro-sharpen clamped to +/-26 (zero rings/halos)
    const amount = Math.max(0.15, Math.min(0.65, (ratio - 1) * 0.42));
    const outImg = oCtx.getImageData(0, 0, W, H);
    const od = outImg.data;
    const srcCopy = new Uint8ClampedArray(od);
    const rad = d2.isBlocky ? Math.max(1, Math.round(d2.repFactor * 0.6)) : 1;

    for (let y = rad; y < H - rad; y++) {
      const row = y * W;
      for (let x = rad; x < W - rad; x++) {
        const i = row + x;
        const a = origAlpha[i];
        const p4 = i * 4;
        od[p4 + 3] = a;
        if (a < 128) continue;

        const r0 = srcCopy[p4], g0 = srcCopy[p4 + 1], b0 = srcCopy[p4 + 2];
        const y0 = 0.299 * r0 + 0.587 * g0 + 0.114 * b0;
        const pL = (i - rad) * 4, pR = (i + rad) * 4;
        const pU = (i - rad * W) * 4, pD = (i + rad * W) * 4;
        const yAvg =
          0.25 *
          (0.299 * (srcCopy[pL] + srcCopy[pR] + srcCopy[pU] + srcCopy[pD]) +
            0.587 * (srcCopy[pL + 1] + srcCopy[pR + 1] + srcCopy[pU + 1] + srcCopy[pD + 1]) +
            0.114 * (srcCopy[pL + 2] + srcCopy[pR + 2] + srcCopy[pU + 2] + srcCopy[pD + 2]));
        const delta = Math.max(-26, Math.min(26, (y0 - yAvg) * amount));
        od[p4] = Math.max(0, Math.min(255, Math.round(r0 + delta)));
        od[p4 + 1] = Math.max(0, Math.min(255, Math.round(g0 + delta)));
        od[p4 + 2] = Math.max(0, Math.min(255, Math.round(b0 + delta)));
      }
    }

    // Preserve alpha on outer border rows/cols as well
    for (let i = 0; i < origAlpha.length; i++) od[i * 4 + 3] = origAlpha[i];
    oCtx.putImageData(outImg, 0, 0);

    return {
      canvas: out,
      adjusted: true,
      mode: d2.isBlocky ? 'dereplicate-sharpen' : 'sharpen',
      d1,
      d2,
    };
  }

  /**
   * Isolates pixels of sourceCanvas where mask[i] === keepVal (0 or 1),
   * setting all other pixels to 100% transparent (0, 0, 0, 0).
   *
   * @param {HTMLCanvasElement} sourceCanvas
   * @param {Uint8Array} mask
   * @param {number} keepVal 0 or 1
   * @returns {HTMLCanvasElement}
   */
  function isolateByMask(sourceCanvas, mask, keepVal) {
    const W = sourceCanvas.width;
    const H = sourceCanvas.height;
    const out = createCanvas(W, H);
    const srcCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
    const outCtx = out.getContext('2d', { willReadFrequently: true });
    if (!srcCtx || !outCtx) return out;

    const imgData = srcCtx.getImageData(0, 0, W, H);
    const data = imgData.data;
    const total = W * H;

    for (let i = 0; i < total; i++) {
      if (mask[i] !== keepVal) {
        const p = i * 4;
        data[p] = 0;
        data[p + 1] = 0;
        data[p + 2] = 0;
        data[p + 3] = 0;
      }
    }

    outCtx.putImageData(imgData, 0, 0);
    return out;
  }

  /**
   * Unites two canvases seamlessly using an exact complementary binary mask:
   * - Where mask[i] === 1: takes exact RGBA from canvasForOne
   * - Where mask[i] === 0: takes exact RGBA from canvasForZero
   * Guarantees zero 1-pixel alpha gap at cut seams.
   *
   * @param {HTMLCanvasElement} canvasForOne
   * @param {HTMLCanvasElement} canvasForZero
   * @param {Uint8Array} mask
   * @returns {HTMLCanvasElement}
   */
  function uniteByComplementaryMask(canvasForOne, canvasForZero, mask) {
    const W = canvasForZero.width;
    const H = canvasForZero.height;
    const out = createCanvas(W, H);
    const ctx1 = canvasForOne.getContext('2d', { willReadFrequently: true });
    const ctx0 = canvasForZero.getContext('2d', { willReadFrequently: true });
    const outCtx = out.getContext('2d', { willReadFrequently: true });
    if (!ctx1 || !ctx0 || !outCtx) return out;

    const d1 = ctx1.getImageData(0, 0, W, H).data;
    const outImg = ctx0.getImageData(0, 0, W, H);
    const dOut = outImg.data;
    const total = W * H;

    for (let i = 0; i < total; i++) {
      if (mask[i] === 1) {
        const p = i * 4;
        dOut[p] = d1[p];
        dOut[p + 1] = d1[p + 1];
        dOut[p + 2] = d1[p + 2];
        dOut[p + 3] = d1[p + 3];
      }
    }

    outCtx.putImageData(outImg, 0, 0);
    return out;
  }

  /**
   * Unites (face + bordas precisas) + (corpo sem bordas imprecisas) = imagemFinal.
   * When featherPx === 0 (default): strict pixel-exact complementary union.
   * When featherPx > 0: smoothly cross-fades the outer rim of (face + bordas precisas)
   * into the original body inside the border collar without creating any alpha hole.
   *
   * @param {HTMLCanvasElement} facePreciseCanvas
   * @param {HTMLCanvasElement} corpoSemBordasCanvas
   * @param {HTMLCanvasElement | null} fullCorpo1Canvas
   * @param {Uint8Array} mergeFaceMask
   * @param {Uint8Array | null} origFaceMask1
   * @param {Float32Array | null} edtToOutsideSq Squared distance inside mergeFaceMask to its outer edge (mask === 0)
   * @param {number} featherPx
   * @returns {HTMLCanvasElement}
   */
  function buildFinalImage(
    facePreciseCanvas,
    corpoSemBordasCanvas,
    fullCorpo1Canvas,
    mergeFaceMask,
    origFaceMask1,
    edtToOutsideSq,
    featherPx
  ) {
    if (!featherPx || featherPx <= 0 || !edtToOutsideSq || !fullCorpo1Canvas) {
      return uniteByComplementaryMask(facePreciseCanvas, corpoSemBordasCanvas, mergeFaceMask);
    }

    const W = corpoSemBordasCanvas.width;
    const H = corpoSemBordasCanvas.height;
    const out = createCanvas(W, H);

    const fCtx = facePreciseCanvas.getContext('2d', { willReadFrequently: true });
    const cCtx = corpoSemBordasCanvas.getContext('2d', { willReadFrequently: true });
    const bCtx = fullCorpo1Canvas.getContext('2d', { willReadFrequently: true });
    const outCtx = out.getContext('2d', { willReadFrequently: true });
    if (!fCtx || !cCtx || !bCtx || !outCtx) {
      return uniteByComplementaryMask(facePreciseCanvas, corpoSemBordasCanvas, mergeFaceMask);
    }

    const dFace = fCtx.getImageData(0, 0, W, H).data;
    const outImg = cCtx.getImageData(0, 0, W, H);
    const dOut = outImg.data;
    const dBodyFull = bCtx.getImageData(0, 0, W, H).data;

    const total = W * H;
    const fSq = featherPx * featherPx;

    for (let i = 0; i < total; i++) {
      if (mergeFaceMask[i] === 1) {
        const p = i * 4;
        const distSq = edtToOutsideSq[i];
        const inCoreFace = origFaceMask1 ? origFaceMask1[i] === 1 : false;

        if (!inCoreFace && distSq < fSq && dBodyFull[p + 3] > 0) {
          const d = Math.sqrt(distSq);
          const u = Math.max(0, Math.min(1, d / featherPx));
          // Smoothstep blend: 0 right at outer boundary -> 1 inside precise face
          const w = u * u * (3 - 2 * u);
          const inv = 1 - w;
          dOut[p] = Math.round(dFace[p] * w + dBodyFull[p] * inv);
          dOut[p + 1] = Math.round(dFace[p + 1] * w + dBodyFull[p + 1] * inv);
          dOut[p + 2] = Math.round(dFace[p + 2] * w + dBodyFull[p + 2] * inv);
          dOut[p + 3] = Math.round(dFace[p + 3] * w + dBodyFull[p + 3] * inv);
        } else {
          dOut[p] = dFace[p];
          dOut[p + 1] = dFace[p + 1];
          dOut[p + 2] = dFace[p + 2];
          dOut[p + 3] = dFace[p + 3];
        }
      }
    }

    outCtx.putImageData(outImg, 0, 0);
    return out;
  }

  /**
   * Crops a rectangular region from sourceCanvas.
   * @param {HTMLCanvasElement} sourceCanvas
   * @param {RectBox} box
   * @returns {HTMLCanvasElement}
   */
  function cropCanvas(sourceCanvas, box) {
    const out = createCanvas(box.w, box.h);
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.clearRect(0, 0, box.w, box.h);
      ctx.drawImage(sourceCanvas, box.x, box.y, box.w, box.h, 0, 0, box.w, box.h);
    }
    return out;
  }

  /**
   * Builds a cached visualization overlay canvas for a binary mask:
   * - Optional translucent tints for mask === 1 (Face) and mask === 0 (Body)
   * - Crisp bright contour along the seam between 1 and 0
   *
   * @param {Uint8Array} mask
   * @param {number} W
   * @param {number} H
   * @param {{
   *   tintOne?: [number, number, number, number],
   *   tintZero?: [number, number, number, number],
   *   borderColor?: [number, number, number, number],
   *   borderThickness?: number
   * }} opts
   * @returns {HTMLCanvasElement}
   */
  function createMaskOverlayCanvas(mask, W, H, opts = {}) {
    const tint1 = opts.tintOne || [56, 189, 248, 48];     // Sky cyan for Face
    const tint0 = opts.tintZero || [245, 158, 11, 30];    // Warm amber for Body
    const border = opts.borderColor || [56, 189, 248, 245];
    const r = opts.borderThickness || 1;

    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    if (!ctx) return canvas;

    const imgData = ctx.createImageData(W, H);
    const data = imgData.data;

    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const idx = row + x;
        const val = mask[idx];
        let isEdge = false;

        // Check 4-neighborhood inside image bounds (seam only, not outer image frame)
        if (x > 0 && mask[idx - 1] !== val) isEdge = true;
        else if (x < W - 1 && mask[idx + 1] !== val) isEdge = true;
        else if (y > 0 && mask[idx - W] !== val) isEdge = true;
        else if (y < H - 1 && mask[idx + W] !== val) isEdge = true;
        else if (r >= 2) {
          if (x > 1 && mask[idx - 2] !== val) isEdge = true;
          else if (x < W - 2 && mask[idx + 2] !== val) isEdge = true;
          else if (y > 1 && mask[idx - 2 * W] !== val) isEdge = true;
          else if (y < H - 2 && mask[idx + 2 * W] !== val) isEdge = true;
        }

        const p = idx * 4;
        if (isEdge) {
          data[p] = border[0];
          data[p + 1] = border[1];
          data[p + 2] = border[2];
          data[p + 3] = border[3];
        } else if (val === 1) {
          data[p] = tint1[0];
          data[p + 1] = tint1[1];
          data[p + 2] = tint1[2];
          data[p + 3] = tint1[3];
        } else {
          data[p] = tint0[0];
          data[p + 1] = tint0[1];
          data[p + 2] = tint0[2];
          data[p + 3] = tint0[3];
        }
      }
    }

    ctx.putImageData(imgData, 0, 0);
    return canvas;
  }

  /**
   * Copies an HTMLCanvasElement as a PNG image to the system clipboard.
   * @param {HTMLCanvasElement} canvas
   * @returns {Promise<void>}
   */
  function copyCanvasToClipboard(canvas) {
    return new Promise((resolve, reject) => {
      if (!navigator.clipboard || typeof ClipboardItem === 'undefined') {
        reject(
          new Error(
            'A cópia direta requer contexto seguro (abra via abrir_app.bat em localhost ou use Baixar PNG).'
          )
        );
        return;
      }
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Falha ao gerar PNG para a área de transferência.'));
          return;
        }
        navigator.clipboard
          .write([new ClipboardItem({ 'image/png': blob })])
          .then(resolve)
          .catch((err) => {
            reject(
              new Error(
                err && err.message
                  ? `Permissão da área de transferência negada (${err.message}). Use Baixar PNG ou abra via abrir_app.bat.`
                  : 'Não foi possível copiar para a área de transferência.'
              )
            );
          });
      }, 'image/png');
    });
  }

  /**
   * Copies plain text to clipboard, with a fallback for non-secure HTTP LAN contexts (e.g. mobile Wi-Fi).
   * @param {string} text
   * @returns {Promise<void>}
   */
  async function copyTextToClipboard(text) {
    const val = String(text ?? '');
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      try {
        await navigator.clipboard.writeText(val);
        return;
      } catch {
        // Fallback below
      }
    }
    const ta = document.createElement('textarea');
    ta.value = val;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, val.length);
    let ok = false;
    try {
      ok = document.execCommand('copy');
    } finally {
      document.body.removeChild(ta);
    }
    if (!ok) {
      throw new Error('Não foi possível copiar o texto automaticamente neste navegador.');
    }
  }

  /**
   * Releases GPU/backing-store memory held by a temporary or replaced HTMLCanvasElement.
   * @param {HTMLCanvasElement | null | undefined} canvas
   */
  function releaseCanvas(canvas) {
    if (!canvas) return;
    try {
      canvas.width = 0;
      canvas.height = 0;
    } catch (_) {}
  }

  /**
   * Detects Apple iOS / iPadOS devices (where WebKit blocks silent disk downloads without opening tabs).
   * @returns {boolean}
   */
  function isIOSDevice() {
    if (typeof navigator === 'undefined') return false;
    const ua = navigator.userAgent || '';
    if (/iPad|iPhone|iPod/i.test(ua)) return true;
    return /Macintosh/i.test(ua) && Number(navigator.maxTouchPoints || 0) > 1;
  }

  /**
   * Synchronously converts a canvas to a PNG File object inside the user tap gesture.
   * Synchronous conversion prevents iOS Safari from expiring transient user activation before navigator.share().
   * @param {HTMLCanvasElement} canvas
   * @param {string} filename
   * @returns {File | null}
   */
  function canvasToPngFile(canvas, filename) {
    if (typeof File === 'undefined' || !canvas) return null;
    const cleanName = filename.endsWith('.png') ? filename : `${filename}.png`;
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const comma = dataUrl.indexOf(',');
      if (comma < 0) return null;
      const b64 = dataUrl.slice(comma + 1);
      const bin = atob(b64);
      const len = bin.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = bin.charCodeAt(i);
      }
      return new File([bytes], cleanName, { type: 'image/png' });
    } catch (_) {
      return null;
    }
  }

  /**
   * Shares a PNG via native Mobile Web Share API synchronously within tap gesture (iPhone Photos Share Sheet),
   * falling back to browser PNG download on desktop/unsupported browsers.
   * @param {HTMLCanvasElement} canvas
   * @param {string} filename
   * @returns {Promise<'shared' | 'downloaded' | 'cancelled'>}
   */
  async function shareOrDownloadCanvas(canvas, filename) {
    const cleanName = filename.endsWith('.png') ? filename : `${filename}.png`;
    const file = canvasToPngFile(canvas, cleanName);

    if (file && navigator.share && navigator.canShare) {
      let canShareFile = false;
      try {
        canShareFile = navigator.canShare({ files: [file] });
      } catch (_) {
        canShareFile = false;
      }
      if (canShareFile) {
        try {
          await navigator.share({ files: [file], title: cleanName });
          return 'shared';
        } catch (err) {
          if (err && err.name === 'AbortError') {
            return 'cancelled';
          }
          // On iOS, never open an annoying extra tab via <a download> fallback if share sheet failed silently
          if (isIOSDevice()) {
            return 'cancelled';
          }
        }
      }
    }

    downloadCanvasAsPng(canvas, cleanName);
    return 'downloaded';
  }

  /**
   * Downloads an HTMLCanvasElement as a lossless PNG file.
   * @param {HTMLCanvasElement} canvas
   * @param {string} filename
   */
  function downloadCanvasAsPng(canvas, filename) {
    const cleanName = filename.endsWith('.png') ? filename : `${filename}.png`;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = cleanName;
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }, 'image/png');
  }

  /**
   * Saves an HTMLCanvasElement directly into the local /data directory via the server API,
   * with automatic fallback to standard browser download if the local server is not running.
   *
   * @param {HTMLCanvasElement} canvas
   * @param {string} filename
   * @param {string} [folder] e.g. "4" or ""
   * @returns {Promise<{ ok: boolean, path: string, viaApi: boolean }>}
   */
  async function saveCanvasToData(canvas, filename, folder = '') {
    const cleanName = filename.endsWith('.png') ? filename : `${filename}.png`;
    const dataUrl = canvas.toDataURL('image/png');

    try {
      const resp = await fetch('/api/save-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: cleanName, folder, dataUrl }),
      });
      if (resp.ok) {
        const data = await resp.json();
        return {
          ok: true,
          path: data.path || `data/${folder ? folder + '/' : ''}${cleanName}`,
          viaApi: true,
        };
      }
    } catch (e) {
      // Local server API unavailable (e.g. file:// mode), fallback to browser download
    }

    downloadCanvasAsPng(canvas, cleanName);
    return {
      ok: true,
      path: `data/${folder ? folder + '/' : ''}${cleanName}`,
      viaApi: false,
    };
  }

  /**
   * Retrieves available folders inside /data from the local server.
   * @returns {Promise<{ folders: string[], defaultFolder: string }>}
   */
  async function getDataFolders() {
    try {
      const resp = await fetch('/api/data-folders');
      if (resp.ok) {
        return await resp.json();
      }
    } catch (e) {}
    return { folders: ['4', '3', '2', '1'], defaultFolder: '4' };
  }

  /**
   * Instructs the local server to open the target /data folder in Windows Explorer.
   * @param {string} [folder]
   */
  async function openDataFolder(folder = '') {
    try {
      await fetch(`/api/open-data-folder?folder=${encodeURIComponent(folder)}`);
    } catch (e) {}
  }

  /**
   * Checks whether an opaque image has a predominantly solid black or solid white
   * separation background around its borders.
   *
   * @param {CanvasImageSource} source
   * @returns {{ type: 'black' | 'white' | 'none', borderRatio: number }}
   */
  function detectSolidSeparationBg(source) {
    const canvas = sourceToCanvas(source);
    const w = canvas.width;
    const h = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || w < 2 || h < 2) return { type: 'none', borderRatio: 0 };

    const data = ctx.getImageData(0, 0, w, h).data;
    let blackBorder = 0;
    let whiteBorder = 0;
    let totalBorder = 0;

    const checkIdx = (idx) => {
      const p = idx * 4;
      if (data[p + 3] < 200) return;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx - mn <= 24) {
        if (mx <= 34) blackBorder++;
        else if (mn >= 221) whiteBorder++;
      }
      totalBorder++;
    };

    for (let x = 0; x < w; x++) {
      checkIdx(x);
      checkIdx((h - 1) * w + x);
    }
    for (let y = 1; y < h - 1; y++) {
      checkIdx(y * w);
      checkIdx(y * w + (w - 1));
    }

    if (totalBorder === 0) return { type: 'none', borderRatio: 0 };
    const blackRatio = blackBorder / totalBorder;
    const whiteRatio = whiteBorder / totalBorder;
    if (blackRatio >= whiteRatio && blackRatio >= 0.25) {
      return { type: 'black', borderRatio: blackRatio };
    }
    if (whiteRatio > blackRatio && whiteRatio >= 0.25) {
      return { type: 'white', borderRatio: whiteRatio };
    }
    return { type: 'none', borderRatio: 0 };
  }

  /**
   * Computes a binary mask (1 = Face, 0 = Separation Background) for isolatedFaceCanvas.
   * Supports transparent PNGs AND opaque cutouts with black or white separation backgrounds
   * using 4-connected border flood-fill (preserving dark pupils/hair and white teeth/eyes inside the face).
   *
   * @param {Uint8ClampedArray} fData
   * @param {number} faceW
   * @param {number} faceH
   * @param {Uint8ClampedArray | null} cData
   * @param {boolean} sameSize
   * @returns {{ localMask: Uint8Array, hasAlpha: boolean }}
   */
  function extractLocalCutoutMask(fData, faceW, faceH, cData, sameSize) {
    const total = faceW * faceH;
    const localMask = new Uint8Array(total);

    let transparentCount = 0;
    for (let i = 0; i < total; i++) {
      if (fData[i * 4 + 3] < 240) transparentCount++;
    }
    const hasAlpha = transparentCount > total * 0.01;

    if (hasAlpha) {
      for (let i = 0; i < total; i++) {
        localMask[i] = fData[i * 4 + 3] >= 20 ? 1 : 0;
      }
      return { localMask, hasAlpha: true };
    }

    // Opaque image: inspect border pixels for black or white separation background
    let blackBorder = 0;
    let whiteBorder = 0;
    let totalBorder = 0;

    const tallyBorder = (idx) => {
      const p = idx * 4;
      const r = fData[p];
      const g = fData[p + 1];
      const b = fData[p + 2];
      const mx = Math.max(r, g, b);
      const mn = Math.min(r, g, b);
      if (mx - mn <= 24) {
        if (mx <= 34) blackBorder++;
        else if (mn >= 221) whiteBorder++;
      }
      totalBorder++;
    };

    for (let x = 0; x < faceW; x++) {
      tallyBorder(x);
      tallyBorder((faceH - 1) * faceW + x);
    }
    for (let y = 1; y < faceH - 1; y++) {
      tallyBorder(y * faceW);
      tallyBorder(y * faceW + (faceW - 1));
    }

    let bgMode = 'none';
    if (totalBorder > 0) {
      if (blackBorder >= whiteBorder && blackBorder > totalBorder * 0.15) {
        bgMode = 'black';
      } else if (whiteBorder > blackBorder && whiteBorder > totalBorder * 0.15) {
        bgMode = 'white';
      }
    }

    if (bgMode === 'black' || bgMode === 'white') {
      const isBg = new Uint8Array(total);
      const queue = new Int32Array(total);
      let head = 0;
      let tail = 0;

      const isStrictBg = (idx) => {
        const p = idx * 4;
        const r = fData[p];
        const g = fData[p + 1];
        const b = fData[p + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        if (mx - mn > 24) return false;
        return bgMode === 'black' ? mx <= 30 : mn >= 225;
      };

      const isBgPixel = (idx) => {
        const p = idx * 4;
        const r = fData[p];
        const g = fData[p + 1];
        const b = fData[p + 2];
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        if (bgMode === 'black') {
          if (mx <= 30 && mx - mn <= 24) return true;
          if (sameSize && cData && mx <= 48 && mx - mn <= 28) {
            const diff =
              Math.abs(r - cData[p]) + Math.abs(g - cData[p + 1]) + Math.abs(b - cData[p + 2]);
            if (diff > 45) return true;
          }
          return false;
        } else {
          if (mn >= 225 && mx - mn <= 24) return true;
          if (sameSize && cData && mn >= 207 && mx - mn <= 28) {
            const diff =
              Math.abs(r - cData[p]) + Math.abs(g - cData[p + 1]) + Math.abs(b - cData[p + 2]);
            if (diff > 45) return true;
          }
          return false;
        }
      };

      const trySeed = (idx) => {
        if (!isBg[idx] && isBgPixel(idx)) {
          isBg[idx] = 1;
          queue[tail++] = idx;
        }
      };

      for (let x = 0; x < faceW; x++) {
        trySeed(x);
        trySeed((faceH - 1) * faceW + x);
      }
      for (let y = 1; y < faceH - 1; y++) {
        trySeed(y * faceW);
        trySeed(y * faceW + (faceW - 1));
      }

      while (head < tail) {
        const idx = queue[head++];
        const x = idx % faceW;
        const y = (idx - x) / faceW;

        if (x > 0) {
          const nIdx = idx - 1;
          if (!isBg[nIdx] && isBgPixel(nIdx)) {
            isBg[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
        if (x < faceW - 1) {
          const nIdx = idx + 1;
          if (!isBg[nIdx] && isBgPixel(nIdx)) {
            isBg[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
        if (y > 0) {
          const nIdx = idx - faceW;
          if (!isBg[nIdx] && isBgPixel(nIdx)) {
            isBg[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
        if (y < faceH - 1) {
          const nIdx = idx + faceW;
          if (!isBg[nIdx] && isBgPixel(nIdx)) {
            isBg[nIdx] = 1;
            queue[tail++] = nIdx;
          }
        }
      }

      // Also catch enclosed pure-background gaps (e.g. hair loops) when comparing 1:1 with complete image
      if (sameSize && cData) {
        for (let i = 0; i < total; i++) {
          if (!isBg[i]) {
            const p = i * 4;
            const r = fData[p];
            const g = fData[p + 1];
            const b = fData[p + 2];
            const mx = Math.max(r, g, b);
            const mn = Math.min(r, g, b);
            const pureMatch = bgMode === 'black' ? mx <= 3 : mn >= 252;
            if (pureMatch) {
              const diff =
                Math.abs(r - cData[p]) +
                Math.abs(g - cData[p + 1]) +
                Math.abs(b - cData[p + 2]);
              if (diff > 120) {
                isBg[i] = 1;
              }
            }
          }
        }
      }

      for (let i = 0; i < total; i++) {
        localMask[i] = isBg[i] ? 0 : 1;
      }
      return { localMask, hasAlpha: false };
    }

    // Fallback when border is neither black nor white: compare directly against complete image
    if (sameSize && cData) {
      for (let i = 0; i < total; i++) {
        const p = i * 4;
        const diff =
          Math.abs(fData[p] - cData[p]) +
          Math.abs(fData[p + 1] - cData[p + 1]) +
          Math.abs(fData[p + 2] - cData[p + 2]);
        localMask[i] = diff <= 36 ? 1 : 0;
      }
    } else {
      localMask.fill(1);
    }
    return { localMask, hasAlpha: false };
  }

  /**
   * Automatically computes the binary Face mask (1 = Face, 0 = Corpo complement)
   * from an already isolated face image (transparent PNG, or black/white background cutout)
   * compared against the complete image.
   *
   * @param {HTMLCanvasElement} completeCanvas Full original image (imagem1)
   * @param {CanvasImageSource} isolatedFaceSource The image with the already isolated face
   * @returns {{ mask: Uint8Array, facePixelCount: number, bodyPixelCount: number }}
   */
  function createMaskFromIsolatedFace(completeCanvas, isolatedFaceSource) {
    const W = completeCanvas.width;
    const H = completeCanvas.height;
    const n = W * H;
    const mask = new Uint8Array(n);

    let faceCanvas = sourceToCanvas(isolatedFaceSource);
    let faceW = faceCanvas.width;
    let faceH = faceCanvas.height;

    // If isolated face is larger than completeCanvas, scale it down to W x H
    if (faceW > W || faceH > H) {
      const scaled = createCanvas(W, H);
      const sctx = scaled.getContext('2d', { willReadFrequently: true });
      if (sctx) {
        sctx.imageSmoothingEnabled = true;
        sctx.imageSmoothingQuality = 'high';
        sctx.drawImage(faceCanvas, 0, 0, W, H);
        faceCanvas = scaled;
        faceW = W;
        faceH = H;
      }
    }

    const fctx = faceCanvas.getContext('2d', { willReadFrequently: true });
    if (!fctx) return { mask, facePixelCount: 0, bodyPixelCount: n };
    const fData = fctx.getImageData(0, 0, faceW, faceH).data;

    const cctx = completeCanvas.getContext('2d', { willReadFrequently: true });
    const cData = cctx ? cctx.getImageData(0, 0, W, H).data : null;

    const sameSize = faceW === W && faceH === H;
    const { localMask } = extractLocalCutoutMask(fData, faceW, faceH, sameSize ? cData : null, sameSize);

    // Case A: Identical dimensions (1:1)
    if (sameSize) {
      let faceCount = 0;
      for (let i = 0; i < n; i++) {
        mask[i] = localMask[i];
        if (localMask[i] === 1) faceCount++;
      }
      return { mask, facePixelCount: faceCount, bodyPixelCount: n - faceCount };
    }

    // Case B: Cropped isolated face (faceW <= W and faceH <= H)
    // Find best (offsetX, offsetY) where isolated face aligns on completeCanvas
    let bestOx = 0;
    let bestOy = 0;

    if (cData && faceW <= W && faceH <= H) {
      const samples = [];
      const stepY = Math.max(1, Math.floor(faceH / 24));
      const stepX = Math.max(1, Math.floor(faceW / 24));
      for (let y = 0; y < faceH; y += stepY) {
        for (let x = 0; x < faceW; x += stepX) {
          if (localMask[y * faceW + x] === 1) {
            const idx = (y * faceW + x) * 4;
            samples.push({
              x,
              y,
              r: fData[idx],
              g: fData[idx + 1],
              b: fData[idx + 2],
            });
            if (samples.length >= 48) break;
          }
        }
        if (samples.length >= 48) break;
      }

      if (samples.length > 0) {
        let minScore = Infinity;
        const maxRangeX = W - faceW;
        const maxRangeY = H - faceH;
        // Coarse search (stride 4)
        for (let oy = 0; oy <= maxRangeY; oy += 4) {
          for (let ox = 0; ox <= maxRangeX; ox += 4) {
            let score = 0;
            for (let s = 0; s < samples.length; s++) {
              const smp = samples[s];
              const cIdx = ((oy + smp.y) * W + (ox + smp.x)) * 4;
              score +=
                Math.abs(cData[cIdx] - smp.r) +
                Math.abs(cData[cIdx + 1] - smp.g) +
                Math.abs(cData[cIdx + 2] - smp.b);
            }
            if (score < minScore) {
              minScore = score;
              bestOx = ox;
              bestOy = oy;
            }
          }
        }
        // Fine refinement search around bestOx, bestOy (stride 1)
        const fineMinX = Math.max(0, bestOx - 6);
        const fineMaxX = Math.min(maxRangeX, bestOx + 6);
        const fineMinY = Math.max(0, bestOy - 6);
        const fineMaxY = Math.min(maxRangeY, bestOy + 6);
        for (let oy = fineMinY; oy <= fineMaxY; oy++) {
          for (let ox = fineMinX; ox <= fineMaxX; ox++) {
            let score = 0;
            for (let s = 0; s < samples.length; s++) {
              const smp = samples[s];
              const cIdx = ((oy + smp.y) * W + (ox + smp.x)) * 4;
              score +=
                Math.abs(cData[cIdx] - smp.r) +
                Math.abs(cData[cIdx + 1] - smp.g) +
                Math.abs(cData[cIdx + 2] - smp.b);
            }
            if (score < minScore) {
              minScore = score;
              bestOx = ox;
              bestOy = oy;
            }
          }
        }
      }
    }

    // Map isolated face pixels onto W x H mask at (bestOx, bestOy)
    let faceCount = 0;
    for (let fy = 0; fy < faceH; fy++) {
      const cy = bestOy + fy;
      if (cy < 0 || cy >= H) continue;
      const fRow = fy * faceW;
      const cRow = cy * W;
      for (let fx = 0; fx < faceW; fx++) {
        const cx = bestOx + fx;
        if (cx < 0 || cx >= W) continue;
        if (localMask[fRow + fx] === 1) {
          mask[cRow + cx] = 1;
          faceCount++;
        }
      }
    }

    return { mask, facePixelCount: faceCount, bodyPixelCount: n - faceCount };
  }

  /**
   * Generates a built-in synthetic pair of test images (imagem1 portrait + imagem2 square AI variant)
   * so the user can test every stage of Split & Merge in 1 click.
   *
   * @returns {Promise<{ img1: LoadedImage, img2: LoadedImage, refinedSample: (mergeBox: RectBox | null) => Promise<LoadedImage> }>}
   */
  async function generateDemoAssets() {
    const W1 = 720;
    const H1 = 920;

    function drawCharacter(ctx, W, H, opts) {
      // Studio backdrop gradient
      const bg = ctx.createLinearGradient(0, 0, W, H);
      bg.addColorStop(0, opts.bgTop);
      bg.addColorStop(1, opts.bgBottom);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, W, H);

      // Subtle ambient bokeh circles
      ctx.save();
      ctx.globalAlpha = 0.14;
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.arc(W * 0.2, H * 0.22, W * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#f472b6';
      ctx.beginPath();
      ctx.arc(W * 0.82, H * 0.3, W * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      const cx = W * 0.5;
      const headY = H * 0.31;
      const scale = opts.charScale || 1;

      ctx.save();
      ctx.translate(cx, headY);
      ctx.scale(scale, scale);

      // Back hair
      ctx.fillStyle = opts.hairColor;
      ctx.beginPath();
      ctx.ellipse(0, 18, 128, 155, 0, 0, Math.PI * 2);
      ctx.fill();

      // Shoulders & Jacket (Body)
      const jacketGrad = ctx.createLinearGradient(0, 150, 0, 560);
      jacketGrad.addColorStop(0, opts.jacketTop);
      jacketGrad.addColorStop(1, opts.jacketBottom);
      ctx.fillStyle = jacketGrad;
      ctx.beginPath();
      ctx.moveTo(-235, 620);
      ctx.quadraticCurveTo(-225, 235, -110, 185);
      ctx.lineTo(110, 185);
      ctx.quadraticCurveTo(225, 235, 235, 620);
      ctx.closePath();
      ctx.fill();

      // Inner shirt
      ctx.fillStyle = '#e2e8f0';
      ctx.beginPath();
      ctx.moveTo(-58, 186);
      ctx.lineTo(58, 186);
      ctx.lineTo(0, 345);
      ctx.closePath();
      ctx.fill();

      // Open V-neck chest/clavicle skin (visible body skin reference below collar!)
      ctx.fillStyle = opts.skinNeck;
      ctx.beginPath();
      ctx.moveTo(-42, 184);
      ctx.lineTo(42, 184);
      ctx.lineTo(0, 268);
      ctx.closePath();
      ctx.fill();

      // Jacket lapels & badge detail
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-98, 190);
      ctx.lineTo(-22, 355);
      ctx.moveTo(98, 190);
      ctx.lineTo(22, 355);
      ctx.stroke();

      // Neck
      ctx.fillStyle = opts.skinNeck;
      ctx.beginPath();
      ctx.roundRect(-42, 95, 84, 112, 22);
      ctx.fill();

      // Neck shadow under chin
      ctx.fillStyle = 'rgba(15, 23, 42, 0.18)';
      ctx.beginPath();
      ctx.ellipse(0, 122, 42, 18, 0, 0, Math.PI);
      ctx.fill();

      // Face oval
      ctx.fillStyle = opts.skinFace;
      ctx.beginPath();
      ctx.ellipse(0, 0, 96, 118, 0, 0, Math.PI * 2);
      ctx.fill();

      // Cheek blush
      ctx.fillStyle = opts.blush;
      ctx.beginPath();
      ctx.ellipse(-52, 24, 18, 10, 0, 0, Math.PI * 2);
      ctx.ellipse(52, 24, 18, 10, 0, 0, Math.PI * 2);
      ctx.fill();

      // Eyes
      for (const dir of [-1, 1]) {
        const ex = dir * 38;
        const ey = -6;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(ex, ey, 20, 14, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = opts.eyeColor;
        ctx.beginPath();
        ctx.arc(ex, ey + 1, 11, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#0f172a';
        ctx.beginPath();
        ctx.arc(ex, ey + 1, 5.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(ex - 4, ey - 4, 3.2, 0, Math.PI * 2);
        ctx.fill();

        // Eyebrows
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(ex - 18, ey - 22 + (opts.smile ? -2 : 2));
        ctx.quadraticCurveTo(ex, ey - 28, ex + 18, ey - 21);
        ctx.stroke();
      }

      // Nose
      ctx.strokeStyle = 'rgba(120, 70, 50, 0.45)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(0, -2);
      ctx.lineTo(-4, 24);
      ctx.lineTo(3, 27);
      ctx.stroke();

      // Mouth
      ctx.strokeStyle = '#be123c';
      ctx.lineWidth = 4.5;
      ctx.lineCap = 'round';
      ctx.beginPath();
      if (opts.smile) {
        ctx.moveTo(-24, 52);
        ctx.quadraticCurveTo(0, 72, 24, 52);
      } else {
        ctx.moveTo(-18, 58);
        ctx.quadraticCurveTo(0, 54, 18, 58);
      }
      ctx.stroke();

      // Front bangs
      ctx.fillStyle = opts.hairColor;
      ctx.beginPath();
      ctx.moveTo(-104, -18);
      ctx.quadraticCurveTo(-85, -132, 0, -134);
      ctx.quadraticCurveTo(90, -132, 104, -18);
      ctx.quadraticCurveTo(62, -62, 28, -32);
      ctx.quadraticCurveTo(0, -75, -30, -30);
      ctx.quadraticCurveTo(-68, -64, -104, -18);
      ctx.closePath();
      ctx.fill();

      ctx.restore();
    }

    // 1. imagem1 (720 x 920) - Original body + neutral face
    const c1 = createCanvas(W1, H1);
    const ctx1 = c1.getContext('2d');
    if (ctx1) {
      drawCharacter(ctx1, W1, H1, {
        bgTop: '#1e293b',
        bgBottom: '#0f172a',
        hairColor: '#312e81',
        jacketTop: '#1d4ed8',
        jacketBottom: '#1e3a8a',
        skinNeck: '#ecc09c',
        skinFace: '#f2caa8',
        blush: 'rgba(244, 114, 182, 0.15)',
        eyeColor: '#64748b',
        smile: false,
        charScale: 1,
      });
    }

    // 2. imagem2 (860 x 860 square - different aspect ratio to demonstrate auto transparent padding!)
    // With AI-enhanced face (emerald eyes, warm smile, slightly warmer neck lighting causing a subtle seam)
    const W2 = 860;
    const H2 = 860;
    const c2 = createCanvas(W2, H2);
    const ctx2 = c2.getContext('2d');
    if (ctx2) {
      drawCharacter(ctx2, W2, H2, {
        bgTop: '#26354d',
        bgBottom: '#132038',
        hairColor: '#3730a3',
        jacketTop: '#0f766e',
        jacketBottom: '#115e59',
        skinNeck: '#ffd8be',
        skinFace: '#ffe0c8',
        blush: 'rgba(251, 113, 133, 0.34)',
        eyeColor: '#10b981',
        smile: true,
        charScale: 860 / 720,
      });
    }

    const img1 = { img: c1, width: W1, height: H1, name: 'exemplo_imagem1_original.png' };
    const img2 = { img: c2, width: W2, height: H2, name: 'exemplo_imagem2_IA_quadrada.png' };

    // Helper to synthesize a refined "(face + bordas precisas)" matching imagem1 lighting + imagem2 face
    const refinedSample = async (/** @type {RectBox | null} */ cropBox) => {
      const cRef = createCanvas(W1, H1);
      const ctxRef = cRef.getContext('2d');
      if (ctxRef) {
        drawCharacter(ctxRef, W1, H1, {
          bgTop: '#213047',
          bgBottom: '#101a2e',
          hairColor: '#312e81',
          jacketTop: '#1d4ed8',
          jacketBottom: '#1e3a8a',
          skinNeck: '#ffdec4',
          skinFace: '#ffe3cc',
          blush: 'rgba(251, 113, 133, 0.32)',
          eyeColor: '#10b981',
          smile: true,
          charScale: 1,
        });
      }
      const finalC = cropBox ? cropCanvas(cRef, cropBox) : cRef;
      return {
        img: finalC,
        width: finalC.width,
        height: finalC.height,
        name: 'exemplo_face_bordas_precisas_IA.png',
      };
    };

    return { img1, img2, refinedSample };
  }

  global.SplitMergeImageOps = {
    createCanvas,
    releaseCanvas,
    isIOSDevice,
    canvasToPngFile,
    sourceToCanvas,
    loadImageFromBlob,
    loadImageFromFile: loadImageFromBlob,
    extractImageFromPasteEvent,
    readImageFromClipboardAPI,
    computeFittedPlacement,
    renderFittedWithPadding,
    analyzeEffectivePixelDensity,
    matchCanvasPixelDensity,
    isolateByMask,
    uniteByComplementaryMask,
    buildFinalImage,
    cropCanvas,
    createMaskOverlayCanvas,
    copyCanvasToClipboard,
    copyTextToClipboard,
    shareOrDownloadCanvas,
    downloadCanvasAsPng,
    saveCanvasToData,
    getDataFolders,
    openDataFolder,
    detectSolidSeparationBg,
    createMaskFromIsolatedFace,
    generateDemoAssets,
  };
})(window);
