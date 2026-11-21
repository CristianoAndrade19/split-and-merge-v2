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
   * Loads an image File/Blob into a clean HTMLImageElement via FileReader DataURL
   * (never taints Canvas even when index.html is opened directly over file://).
   *
   * @param {Blob} blob
   * @param {string} [name]
   * @returns {Promise<LoadedImage>}
   */
  function loadImageFromBlob(blob, name = 'imagem.png') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('Falha ao ler arquivo de imagem.'));
      reader.onload = () => {
        const dataUrl = /** @type {string} */ (reader.result);
        const img = new Image();
        img.onload = () => {
          resolve({
            img,
            width: img.naturalWidth || img.width,
            height: img.naturalHeight || img.height,
            name,
          });
        };
        img.onerror = () => reject(new Error('Formato de imagem inválido ou não suportado.'));
        img.src = dataUrl;
      };
      reader.readAsDataURL(blob);
    });
  }

  /**
   * Extracts an image Blob from a ClipboardEvent if present.
   * @param {ClipboardEvent} e
   * @returns {Promise<LoadedImage | null>}
   */
  async function extractImageFromPasteEvent(e) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return null;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          return loadImageFromBlob(file, `colado_${Date.now()}.png`);
        }
      }
    }
    return null;
  }

  /**
   * Reads an image directly via the Async Clipboard API (when triggered by a button click).
   * @returns {Promise<LoadedImage | null>}
   */
  async function readImageFromClipboardAPI() {
    if (!navigator.clipboard || !navigator.clipboard.read) {
      throw new Error('Use Ctrl+V para colar diretamente neste navegador.');
    }
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imgType = item.types.find((t) => t.startsWith('image/'));
      if (imgType) {
        const blob = await item.getType(imgType);
        return loadImageFromBlob(blob, `colado_${Date.now()}.png`);
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
      if (placement.rotation) {
        ctx.save();
        ctx.translate(placement.cx, placement.cy);
        ctx.rotate((placement.rotation * Math.PI) / 180);
        ctx.drawImage(
          source.img,
          -placement.drawW * 0.5,
          -placement.drawH * 0.5,
          placement.drawW,
          placement.drawH
        );
        ctx.restore();
      } else {
        ctx.drawImage(
          source.img,
          placement.drawX,
          placement.drawY,
          placement.drawW,
          placement.drawH
        );
      }
    }

    return { canvas, placement };
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
   * Shares a PNG via native Mobile Web Share API if supported, falling back to browser PNG download.
   * @param {HTMLCanvasElement} canvas
   * @param {string} filename
   * @returns {Promise<'shared' | 'downloaded' | 'cancelled'>}
   */
  function shareOrDownloadCanvas(canvas, filename) {
    const cleanName = filename.endsWith('.png') ? filename : `${filename}.png`;
    return new Promise((resolve) => {
      canvas.toBlob(async (blob) => {
        if (!blob) {
          resolve('cancelled');
          return;
        }
        try {
          if (typeof File !== 'undefined' && navigator.share && navigator.canShare) {
            const file = new File([blob], cleanName, { type: 'image/png' });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({ files: [file], title: cleanName });
              resolve('shared');
              return;
            }
          }
        } catch (err) {
          if (err && err.name === 'AbortError') {
            resolve('cancelled');
            return;
          }
        }
        downloadCanvasAsPng(canvas, cleanName);
        resolve('downloaded');
      }, 'image/png');
    });
  }

  /**
   * Downloads an HTMLCanvasElement as a lossless PNG file.
   * @param {HTMLCanvasElement} canvas
   * @param {string} filename
   */
  function downloadCanvasAsPng(canvas, filename) {
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename.endsWith('.png') ? filename : `${filename}.png`;
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

  /**
   * Computes tight bounding box of non-transparent pixels in a canvas.
   * @param {HTMLCanvasElement} canvas
   * @param {number} [padPx=12]
   * @returns {RectBox | null}
   */
  function extractBoundingBoxOfAlpha(canvas, padPx = 12) {
    const W = canvas.width;
    const H = canvas.height;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    const data = ctx.getImageData(0, 0, W, H).data;
    let minX = W;
    let minY = H;
    let maxX = -1;
    let maxY = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (data[(row + x) * 4 + 3] > 8) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return null;
    const x0 = Math.max(0, minX - padPx);
    const y0 = Math.max(0, minY - padPx);
    const x1 = Math.min(W - 1, maxX + padPx);
    const y1 = Math.min(H - 1, maxY + padPx);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }

  /**
   * Composites a canvas (or cropped sub-region) over a solid background color.
   * @param {HTMLCanvasElement} sourceCanvas
   * @param {string} [bgColor='#000000']
   * @param {RectBox | null} [cropBox=null]
   * @returns {HTMLCanvasElement}
   */
  function flattenCanvasWithBg(sourceCanvas, bgColor = '#000000', cropBox = null) {
    const box = cropBox || { x: 0, y: 0, w: sourceCanvas.width, h: sourceCanvas.height };
    const out = createCanvas(box.w, box.h);
    const ctx = out.getContext('2d');
    if (ctx) {
      ctx.fillStyle = bgColor || '#000000';
      ctx.fillRect(0, 0, out.width, out.height);
      ctx.drawImage(sourceCanvas, box.x, box.y, box.w, box.h, 0, 0, out.width, out.height);
    }
    return out;
  }

  /**
   * Concatenates `leftCanvas` (leftmost) and up to 6 reference images side-by-side.
   * Mirrors `build_side_by_side_collage` in flux_img2img.py for instant live preview.
   *
   * @param {HTMLCanvasElement} leftCanvas
   * @param {(HTMLImageElement | HTMLCanvasElement)[]} refSources
   * @param {{ gapPx?: number, bgColor?: string }} [opts]
   * @returns {HTMLCanvasElement}
   */
  function composeSideBySideCollageCanvas(leftCanvas, refSources = [], opts = {}) {
    const gapPx = Math.max(0, Math.round(opts.gapPx ?? 4));
    const bgColor = opts.bgColor || '#000000';
    const panelH = Math.max(256, Math.min(1024, leftCanvas.height));

    /** @type {{ src: HTMLImageElement | HTMLCanvasElement, w: number, h: number }[]} */
    const panels = [];
    const pushPanel = (src, sw, sh) => {
      const scaledW =
        sh !== panelH ? Math.max(16, Math.round(sw * (panelH / Math.max(1, sh)))) : sw;
      panels.push({ src, w: scaledW, h: panelH });
    };

    pushPanel(leftCanvas, leftCanvas.width, leftCanvas.height);
    refSources.slice(0, 6).forEach((src) => {
      const sw = src instanceof HTMLImageElement ? src.naturalWidth || src.width : src.width;
      const sh = src instanceof HTMLImageElement ? src.naturalHeight || src.height : src.height;
      pushPanel(src, sw, sh);
    });

    const totalW =
      panels.reduce((acc, p) => acc + p.w, 0) + gapPx * Math.max(0, panels.length - 1);
    const canvas = createCanvas(totalW, panelH);
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, totalW, panelH);
      let cursorX = 0;
      for (const p of panels) {
        ctx.drawImage(p.src, cursorX, 0, p.w, p.h);
        cursorX += p.w + gapPx;
      }
    }
    return canvas;
  }

  global.SplitMergeImageOps = {
    createCanvas,
    sourceToCanvas,
    loadImageFromBlob,
    loadImageFromFile: loadImageFromBlob,
    extractImageFromPasteEvent,
    readImageFromClipboardAPI,
    computeFittedPlacement,
    renderFittedWithPadding,
    isolateByMask,
    uniteByComplementaryMask,
    buildFinalImage,
    cropCanvas,
    extractBoundingBoxOfAlpha,
    flattenCanvasWithBg,
    composeSideBySideCollageCanvas,
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
