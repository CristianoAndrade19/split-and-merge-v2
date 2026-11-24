// @ts-check
/// <reference path="./types.js" />

(function (global) {
  'use strict';

  // ===========================================================================
  // Fast sRGB <-> Linear <-> Oklab & CIE L*a*b* Conversions + CIEDE2000
  // ===========================================================================
  const SRGB_TO_LIN = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    SRGB_TO_LIN[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }

  const LIN_LUT_SIZE = 4096;
  const LIN_TO_SRGB = new Uint8Array(LIN_LUT_SIZE + 1);
  for (let i = 0; i <= LIN_LUT_SIZE; i++) {
    const c = i / LIN_LUT_SIZE;
    const s = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    LIN_TO_SRGB[i] = Math.max(0, Math.min(255, Math.round(s * 255)));
  }

  /**
   * Converts 8-bit sRGB to perceptual Oklab (Björn Ottosson, 2020).
   * @param {number} r 0..255
   * @param {number} g 0..255
   * @param {number} b 0..255
   * @param {Float32Array} out3
   * @param {number} off
   */
  function rgbToOklabInto(r, g, b, out3, off) {
    const rl = SRGB_TO_LIN[r];
    const gl = SRGB_TO_LIN[g];
    const bl = SRGB_TO_LIN[b];

    const l = Math.cbrt(0.4122214708 * rl + 0.5363325363 * gl + 0.0514459929 * bl);
    const m = Math.cbrt(0.2119034982 * rl + 0.6806995451 * gl + 0.1073969566 * bl);
    const s = Math.cbrt(0.0883024619 * rl + 0.2817188376 * gl + 0.6299787005 * bl);

    out3[off] = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
    out3[off + 1] = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
    out3[off + 2] = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  }

  /**
   * Converts Oklab (L, a, b) to 8-bit sRGB [0..255].
   * @param {number} L
   * @param {number} a
   * @param {number} b
   * @returns {[number, number, number]}
   */
  function oklabToRgbTuple(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;

    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;

    const rl = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    const gl = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    const bl = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s;

    const ri = rl <= 0 ? 0 : rl >= 1 ? LIN_LUT_SIZE : (rl * LIN_LUT_SIZE + 0.5) | 0;
    const gi = gl <= 0 ? 0 : gl >= 1 ? LIN_LUT_SIZE : (gl * LIN_LUT_SIZE + 0.5) | 0;
    const bi = bl <= 0 ? 0 : bl >= 1 ? LIN_LUT_SIZE : (bl * LIN_LUT_SIZE + 0.5) | 0;

    return [LIN_TO_SRGB[ri], LIN_TO_SRGB[gi], LIN_TO_SRGB[bi]];
  }

  /**
   * Converts 8-bit sRGB to CIE L*a*b* (D65) for standard CIEDE2000 calculation.
   * @param {[number, number, number]} rgb
   * @returns {[number, number, number]}
   */
  function rgbToCieLab(rgb) {
    const rl = SRGB_TO_LIN[Math.max(0, Math.min(255, Math.round(rgb[0])))];
    const gl = SRGB_TO_LIN[Math.max(0, Math.min(255, Math.round(rgb[1])))];
    const bl = SRGB_TO_LIN[Math.max(0, Math.min(255, Math.round(rgb[2])))];

    const x = (0.4124564 * rl + 0.3575761 * gl + 0.1804375 * bl) / 0.95047;
    const y = 0.2126729 * rl + 0.7151522 * gl + 0.0721750 * bl;
    const z = (0.0193339 * rl + 0.1191920 * gl + 0.9503041 * bl) / 1.08883;

    const d = 6 / 29;
    const d3 = d * d * d;
    const f = (t) => (t > d3 ? Math.cbrt(t) : t / (3 * d * d) + 4 / 29);
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
  }

  /**
   * Exact ISO/CIE CIEDE2000 perceptual color difference (ΔE00).
   * ΔE00 < 1.0 is imperceptible to human observers.
   * @param {[number, number, number]} rgb1
   * @param {[number, number, number]} rgb2
   */
  function computeDeltaE2000(rgb1, rgb2) {
    const [L1, a1, b1] = rgbToCieLab(rgb1);
    const [L2, a2, b2] = rgbToCieLab(rgb2);

    const avgL = (L1 + L2) * 0.5;
    const C1 = Math.hypot(a1, b1);
    const C2 = Math.hypot(a2, b2);
    const avgC = (C1 + C2) * 0.5;

    const c7 = Math.pow(avgC, 7);
    const G = 0.5 * (1 - Math.sqrt(c7 / (c7 + 6103515625))); // 25^7
    const a1p = (1 + G) * a1;
    const a2p = (1 + G) * a2;

    const C1p = Math.hypot(a1p, b1);
    const C2p = Math.hypot(a2p, b2);
    const avgCp = (C1p + C2p) * 0.5;

    const rad2deg = 180 / Math.PI;
    const deg2rad = Math.PI / 180;
    const h1p = C1p < 1e-6 ? 0 : ((Math.atan2(b1, a1p) * rad2deg) + 360) % 360;
    const h2p = C2p < 1e-6 ? 0 : ((Math.atan2(b2, a2p) * rad2deg) + 360) % 360;

    let dhp = 0;
    if (C1p * C2p >= 1e-6) {
      if (Math.abs(h2p - h1p) <= 180) dhp = h2p - h1p;
      else if (h2p - h1p > 180) dhp = h2p - h1p - 360;
      else dhp = h2p - h1p + 360;
    }

    const dLp = L2 - L1;
    const dCp = C2p - C1p;
    const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(dhp * 0.5 * deg2rad);

    let avgHp = h1p + h2p;
    if (C1p * C2p < 1e-6) avgHp = h1p + h2p;
    else if (Math.abs(h1p - h2p) <= 180) avgHp = (h1p + h2p) * 0.5;
    else if (h1p + h2p < 360) avgHp = (h1p + h2p + 360) * 0.5;
    else avgHp = (h1p + h2p - 360) * 0.5;

    const T =
      1 -
      0.17 * Math.cos((avgHp - 30) * deg2rad) +
      0.24 * Math.cos(2 * avgHp * deg2rad) +
      0.32 * Math.cos((3 * avgHp + 6) * deg2rad) -
      0.20 * Math.cos((4 * avgHp - 63) * deg2rad);

    const dTheta = 30 * Math.exp(-Math.pow((avgHp - 275) / 25, 2));
    const cp7 = Math.pow(avgCp, 7);
    const RC = 2 * Math.sqrt(cp7 / (cp7 + 6103515625));
    const l50Sq = (avgL - 50) * (avgL - 50);
    const SL = 1 + (0.015 * l50Sq) / Math.sqrt(20 + l50Sq);
    const SC = 1 + 0.045 * avgCp;
    const SH = 1 + 0.015 * avgCp * T;
    const RT = -Math.sin(2 * dTheta * deg2rad) * RC;

    const nL = dLp / SL;
    const nC = dCp / SC;
    const nH = dHp / SH;
    return Math.sqrt(nL * nL + nC * nC + nH * nH + RT * nC * nH);
  }

  function smoothstep(e0, e1, x) {
    if (e1 <= e0) return x >= e1 ? 1 : 0;
    const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
    return t * t * (3 - 2 * t);
  }

  // ===========================================================================
  // 3x3 Symmetric Matrix Math for Monge-Kantorovich Optimal Transport
  // ===========================================================================

  /**
   * Multiplies two 3x3 row-major matrices A * B.
   * @param {number[]} A
   * @param {number[]} B
   */
  function matMul3(A, B) {
    const C = new Array(9).fill(0);
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        C[r * 3 + c] =
          A[r * 3] * B[c] +
          A[r * 3 + 1] * B[3 + c] +
          A[r * 3 + 2] * B[6 + c];
      }
    }
    return C;
  }

  /**
   * Exact Jacobi eigendecomposition of a 3x3 real symmetric matrix S = V * diag(d) * V^T.
   * @param {number[]} S 9-element symmetric matrix
   */
  function symEigen3x3(S) {
    const A = S.slice();
    const V = [1, 0, 0, 0, 1, 0, 0, 0, 1];

    for (let sweep = 0; sweep < 18; sweep++) {
      // Find largest off-diagonal |A[p,q]|
      const a01 = Math.abs(A[1]);
      const a02 = Math.abs(A[2]);
      const a12 = Math.abs(A[5]);
      let p = 0, q = 1, maxOff = a01;
      if (a02 > maxOff) { p = 0; q = 2; maxOff = a02; }
      if (a12 > maxOff) { p = 1; q = 2; maxOff = a12; }
      if (maxOff < 1e-13) break;

      const app = A[p * 3 + p];
      const aqq = A[q * 3 + q];
      const apq = A[p * 3 + q];

      const tau = (aqq - app) / (2 * apq);
      const t = tau >= 0 ? 1 / (tau + Math.sqrt(1 + tau * tau)) : -1 / (-tau + Math.sqrt(1 + tau * tau));
      const c = 1 / Math.sqrt(1 + t * t);
      const s = t * c;

      A[p * 3 + p] = app - t * apq;
      A[q * 3 + q] = aqq + t * apq;
      A[p * 3 + q] = 0;
      A[q * 3 + p] = 0;

      const r = 3 - p - q;
      const arp = A[r * 3 + p];
      const arq = A[r * 3 + q];
      A[r * 3 + p] = A[p * 3 + r] = c * arp - s * arq;
      A[r * 3 + q] = A[q * 3 + r] = s * arp + c * arq;

      for (let i = 0; i < 3; i++) {
        const vip = V[i * 3 + p];
        const viq = V[i * 3 + q];
        V[i * 3 + p] = c * vip - s * viq;
        V[i * 3 + q] = s * vip + c * viq;
      }
    }

    return {
      vals: [A[0], A[4], A[8]],
      vecs: V,
    };
  }

  /**
   * Builds S^(power) from symmetric matrix S with eigenvalue clamping for stability.
   * @param {number[]} S
   * @param {number} power e.g. 0.5 or -0.5
   * @param {number} minEig
   */
  function symMatPow3(S, power, minEig = 1e-4) {
    const { vals, vecs: V } = symEigen3x3(S);
    const d = vals.map((v) => Math.pow(Math.max(minEig, v), power));
    // V * diag(d) * V^T
    const out = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        out[i * 3 + j] =
          V[i * 3 + 0] * d[0] * V[j * 3 + 0] +
          V[i * 3 + 1] * d[1] * V[j * 3 + 1] +
          V[i * 3 + 2] * d[2] * V[j * 3 + 2];
      }
    }
    return out;
  }

  /**
   * Computes closed-form Monge-Kantorovich 3x3 Optimal Transport matrix M:
   * M = Sigma_s^(-1/2) * (Sigma_s^(1/2) * Sigma_t * Sigma_s^(1/2))^(1/2) * Sigma_s^(-1/2)
   * with gentle singular-value damping so flat/low-variance patches never clip.
   *
   * @param {number[]} covS 9-element source covariance
   * @param {number[]} covT 9-element target covariance
   */
  function computeMongeKantorovichMatrix(covS, covT) {
    const reg = 2.5e-4;
    const Cs = covS.slice();
    const Ct = covT.slice();
    Cs[0] += reg; Cs[4] += reg * 0.5; Cs[8] += reg * 0.5;
    Ct[0] += reg; Ct[4] += reg * 0.5; Ct[8] += reg * 0.5;

    const CsHalf = symMatPow3(Cs, 0.5, 1e-5);
    const CsInvHalf = symMatPow3(Cs, -0.5, 1e-5);
    const inner = matMul3(matMul3(CsHalf, Ct), CsHalf);
    // Symmetrize numerical rounding before sqrt
    inner[1] = inner[3] = 0.5 * (inner[1] + inner[3]);
    inner[2] = inner[6] = 0.5 * (inner[2] + inner[6]);
    inner[5] = inner[7] = 0.5 * (inner[5] + inner[7]);

    const innerHalf = symMatPow3(inner, 0.5, 1e-8);
    const M = matMul3(matMul3(CsInvHalf, innerHalf), CsInvHalf);
    M[1] = M[3] = 0.5 * (M[1] + M[3]);
    M[2] = M[6] = 0.5 * (M[2] + M[6]);
    M[5] = M[7] = 0.5 * (M[5] + M[7]);

    // Clamp extreme eigenvalues of M to [0.68, 1.38] for natural skin contrast preservation
    const { vals, vecs: V } = symEigen3x3(M);
    const clamped = vals.map((v) => Math.max(0.68, Math.min(1.38, v)));
    const safeM = new Array(9).fill(0);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        safeM[i * 3 + j] =
          V[i * 3 + 0] * clamped[0] * V[j * 3 + 0] +
          V[i * 3 + 1] * clamped[1] * V[j * 3 + 1] +
          V[i * 3 + 2] * clamped[2] * V[j * 3 + 2];
      }
    }
    return safeM;
  }

  // ===========================================================================
  // Multi-Cue Skin Probability Detector & Selective Feature Protection
  // ===========================================================================

  /**
   * Prior skin probability in [0, 1] combining YCbCr covariance bounds & Oklab skin locus.
   * Inclusive of pale, olive, warm anime/illustration, tan, and deep brown skin tones.
   *
   * @param {number} r 0..255
   * @param {number} g 0..255
   * @param {number} b 0..255
   * @param {number} okL
   * @param {number} okA
   * @param {number} okB
   */
  function priorSkinScore(r, g, b, okL, okA, okB) {
    if (okL < 0.20 || okL > 0.965) return 0;

    // Oklab skin locus: positive warm chroma (red + yellow)
    if (okA < 0.002 || okB < 0.005) return 0;
    const chroma = Math.hypot(okA, okB);
    if (chroma < 0.011 || chroma > 0.175) return 0;

    const hueDeg = (Math.atan2(okB, okA) * 180) / Math.PI;
    if (hueDeg < 11 || hueDeg > 85) return 0;

    // YCbCr check (ITU-R BT.601)
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    if (cr < 129 || cr > 182 || cb < 72 || cb > 134) return 0;

    // Attenuate strong vermilion/magenta lipstick so lips don't pollute skin reference!
    if (okA > 0.072 && hueDeg < 34) return 0.1;

    // Peak confidence inside core human/illustrated skin hue [24°..74°]
    const hueWeight =
      hueDeg < 24
        ? smoothstep(11, 24, hueDeg)
        : hueDeg > 74
        ? 1 - smoothstep(74, 85, hueDeg)
        : 1.0;

    return hueWeight;
  }

  /**
   * Computes Oklab mean, 3x3 covariance, and mean RGB from either:
   *  - User-clicked sample points (9x9 patches), OR
   *  - Stratified subsampled skin pixels in the region (up to ~45k samples, zero full-image Oklab buffer!).
   *
   * @param {Uint8ClampedArray} rgba
   * @param {Uint8Array} regionMask (W*H, 1 = belongs to this region)
   * @param {Point[]} manualPoints
   * @param {number} W
   * @param {number} H
   */
  function extractSkinDistribution(rgba, regionMask, manualPoints, W, H) {
    const MAX_SAMPLES = 65536;
    const rawIndices = new Int32Array(MAX_SAMPLES);
    const rawWeights = new Float32Array(MAX_SAMPLES);
    const tmpOk = new Float32Array(3);
    let sampleLen = 0;
    let strideUsed = 1;

    if (manualPoints && manualPoints.length > 0) {
      const patchR = 4;
      for (const pt of manualPoints) {
        const cx = Math.round(pt.x);
        const cy = Math.round(pt.y);
        for (let dy = -patchR; dy <= patchR; dy++) {
          const y = cy + dy;
          if (y < 0 || y >= H) continue;
          for (let dx = -patchR; dx <= patchR; dx++) {
            const x = cx + dx;
            if (x < 0 || x >= W) continue;
            const idx = y * W + x;
            if (rgba[idx * 4 + 3] < 128) continue;
            if (sampleLen < MAX_SAMPLES) {
              rawIndices[sampleLen] = idx;
              rawWeights[sampleLen] = 1.0;
              sampleLen++;
            }
          }
        }
      }
    }

    // Automatic stratified skin detection if no manual points
    if (sampleLen === 0) {
      const n = W * H;
      strideUsed = Math.max(1, Math.floor(Math.sqrt(n / 45000)));
      for (let y = 0; y < H; y += strideUsed) {
        const row = y * W;
        for (let x = 0; x < W; x += strideUsed) {
          const i = row + x;
          if (regionMask[i] !== 1) continue;
          const p4 = i * 4;
          if (rgba[p4 + 3] < 128) continue;
          const r = rgba[p4];
          const g = rgba[p4 + 1];
          const b = rgba[p4 + 2];
          rgbToOklabInto(r, g, b, tmpOk, 0);
          const s = priorSkinScore(r, g, b, tmpOk[0], tmpOk[1], tmpOk[2]);
          if (s > 0.25) {
            rawIndices[sampleLen] = i;
            rawWeights[sampleLen] = s;
            sampleLen++;
            if (sampleLen >= MAX_SAMPLES) break;
          }
        }
        if (sampleLen >= MAX_SAMPLES) break;
      }
    }

    const indices = rawIndices.subarray(0, sampleLen);
    const weights = rawWeights.subarray(0, sampleLen);
    const estimatedCount = sampleLen * strideUsed * strideUsed;

    if (sampleLen < 8) {
      return {
        valid: false,
        count: 0,
        meanOk: [0.7, 0.03, 0.06],
        covOk: [0.004, 0, 0, 0, 0.0004, 0, 0, 0, 0.0004],
        stdOk: [0.06, 0.02, 0.02],
        meanRgb: /** @type {[number, number, number]} */ ([220, 185, 160]),
        indices,
        weights,
        rgbaBuf: rgba,
      };
    }

    let wSum = 0;
    let mL = 0, mA = 0, mB = 0;
    let mR = 0, mG = 0, mBl = 0;

    for (let k = 0; k < sampleLen; k++) {
      const idx = indices[k];
      const w = weights[k];
      const p4 = idx * 4;
      const r = rgba[p4];
      const g = rgba[p4 + 1];
      const b = rgba[p4 + 2];
      rgbToOklabInto(r, g, b, tmpOk, 0);
      wSum += w;
      mL += w * tmpOk[0];
      mA += w * tmpOk[1];
      mB += w * tmpOk[2];
      mR += w * r;
      mG += w * g;
      mBl += w * b;
    }

    mL /= wSum; mA /= wSum; mB /= wSum;
    mR /= wSum; mG /= wSum; mBl /= wSum;

    const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let k = 0; k < sampleLen; k++) {
      const idx = indices[k];
      const w = weights[k];
      const p4 = idx * 4;
      rgbToOklabInto(rgba[p4], rgba[p4 + 1], rgba[p4 + 2], tmpOk, 0);
      const d0 = tmpOk[0] - mL;
      const d1 = tmpOk[1] - mA;
      const d2 = tmpOk[2] - mB;
      cov[0] += w * d0 * d0;
      cov[1] += w * d0 * d1;
      cov[2] += w * d0 * d2;
      cov[4] += w * d1 * d1;
      cov[5] += w * d1 * d2;
      cov[8] += w * d2 * d2;
    }
    cov[0] /= wSum; cov[1] /= wSum; cov[2] /= wSum;
    cov[4] /= wSum; cov[5] /= wSum; cov[8] /= wSum;
    cov[3] = cov[1];
    cov[6] = cov[2];
    cov[7] = cov[5];

    return {
      valid: true,
      count: estimatedCount,
      meanOk: [mL, mA, mB],
      covOk: cov,
      stdOk: [
        Math.sqrt(Math.max(1e-5, cov[0])),
        Math.sqrt(Math.max(1e-5, cov[4])),
        Math.sqrt(Math.max(1e-5, cov[8])),
      ],
      meanRgb: /** @type {[number, number, number]} */ ([
        Math.round(mR),
        Math.round(mG),
        Math.round(mBl),
      ]),
      indices,
      weights,
      rgbaBuf: rgba,
    };
  }

  /**
   * Builds a compact Uint8Array [0..255] skin-selectivity mask for pixels in targetMask,
   * protecting sclera/teeth, irises, lipstick, dark hair, and clothes.
   *
   * @param {Uint8ClampedArray} rgba
   * @param {Uint8Array} targetMask
   * @param {ReturnType<typeof extractSkinDistribution>} srcDist
   * @param {number} selectivity01 0 = affect entire piece, 1 = strict skin only
   * @param {boolean} protectFeatures Protect eyes, sclera, lips, dark hair
   * @param {number} W
   * @param {number} H
   * @param {Uint8Array | null} [scratchTmp]
   * @returns {Uint8Array}
   */
  function buildSelectiveSkinMask(
    rgba,
    targetMask,
    srcDist,
    selectivity01,
    protectFeatures,
    W,
    H,
    scratchTmp = null
  ) {
    const n = W * H;
    const mask = new Uint8Array(n);

    if (selectivity01 <= 0.01 && !protectFeatures) {
      for (let i = 0; i < n; i++) mask[i] = targetMask[i] === 1 ? 255 : 0;
      return mask;
    }

    const [mL, mA, mB] = srcDist.meanOk;
    const [sL, sA, sB] = srcDist.stdOk;
    const meanChroma = Math.hypot(mA, mB);

    const scaleTol = 3.6 - selectivity01 * 2.1; // [1.5 .. 3.6]
    const denomL = Math.max(0.14, sL * 2.6 * scaleTol);
    const denomA = Math.max(0.022, sA * 2.2 * scaleTol);
    const denomB = Math.max(0.026, sB * 2.2 * scaleTol);
    const tmpOk = new Float32Array(3);

    for (let i = 0; i < n; i++) {
      if (targetMask[i] !== 1) continue;
      const p4 = i * 4;
      if (rgba[p4 + 3] < 32) continue;

      const r = rgba[p4];
      const g = rgba[p4 + 1];
      const b = rgba[p4 + 2];
      rgbToOklabInto(r, g, b, tmpOk, 0);
      const L = tmpOk[0];
      const A = tmpOk[1];
      const B = tmpOk[2];

      let w = 1.0;

      if (selectivity01 > 0.01) {
        const dMah = Math.hypot((L - mL) / denomL, (A - mA) / denomA, (B - mB) / denomB);
        const wCluster = 1 - smoothstep(0.85, 1.85, dMah);
        const wPrior = priorSkinScore(r, g, b, L, A, B);
        const combined = Math.max(wCluster * 0.9, Math.min(1, wCluster * 0.55 + wPrior * 0.65));
        w = 1 - selectivity01 + selectivity01 * combined;
      }

      if (protectFeatures) {
        const c = Math.hypot(A, B);
        if (meanChroma > 0.022 && c < 0.016 && L > 0.76) {
          w *= smoothstep(0.016, 0.005, 0.016 - c) * 0.1;
        }
        if (A - mA > 0.036 && A > 0.058) {
          w *= 1 - smoothstep(0.036, 0.065, A - mA);
        }
        if (L < 0.24) {
          w *= smoothstep(0.14, 0.24, L);
        }
        if (B < 0.002 || A < -0.004) {
          const coolDist = Math.max(0.002 - B, -0.004 - A);
          w *= 1 - smoothstep(0, 0.025, coolDist);
        }
      }

      mask[i] = Math.max(0, Math.min(255, Math.round(w * 255)));
    }

    // Separable 5-tap box/tent feather [1,2,3,2,1]/9 using compact Uint8Array scratch buffer
    const tmp = scratchTmp && scratchTmp.length === n ? scratchTmp : new Uint8Array(n);
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        const xm2 = Math.max(0, x - 2), xm1 = Math.max(0, x - 1);
        const xp1 = Math.min(W - 1, x + 1), xp2 = Math.min(W - 1, x + 2);
        tmp[row + x] = Math.round(
          (mask[row + xm2] +
            2 * mask[row + xm1] +
            3 * mask[row + x] +
            2 * mask[row + xp1] +
            mask[row + xp2]) /
            9
        );
      }
    }
    for (let y = 0; y < H; y++) {
      const ym2 = Math.max(0, y - 2) * W, ym1 = Math.max(0, y - 1) * W;
      const y0 = y * W;
      const yp1 = Math.min(H - 1, y + 1) * W, yp2 = Math.min(H - 1, y + 2) * W;
      for (let x = 0; x < W; x++) {
        if (targetMask[y0 + x] !== 1) {
          mask[y0 + x] = 0;
        } else {
          mask[y0 + x] = Math.round(
            (tmp[ym2 + x] + 2 * tmp[ym1 + x] + 3 * tmp[y0 + x] + 2 * tmp[yp1 + x] + tmp[yp2 + x]) /
              9
          );
        }
      }
    }

    return mask;
  }

  // ===========================================================================
  // Helper Builders for Advanced Transfer Methods (CDF LUT, Biophysical, 3-Zone)
  // ===========================================================================

  /**
   * Builds a 256-entry monotone CDF / Quantile transfer LUT mapping source values in [minV, maxV]
   * onto target distribution quantiles, computing Oklab inline from RGBA buffers.
   *
   * @param {Uint8ClampedArray} srcRgba
   * @param {Uint8ClampedArray} tgtRgba
   * @param {number} chan 0, 1, or 2
   * @param {Int32Array} srcIndices
   * @param {Int32Array} tgtIndices
   * @param {number} minV
   * @param {number} maxV
   */
  function buildChannelQuantileLUT(srcRgba, tgtRgba, chan, srcIndices, tgtIndices, minV, maxV) {
    const bins = 256;
    const rawS = new Float64Array(bins);
    const rawT = new Float64Array(bins);
    const scale = (bins - 1) / (maxV - minV);
    const stepV = (maxV - minV) / (bins - 1);
    const tmpOk = new Float32Array(3);

    let minBinS = bins - 1, maxBinS = 0;
    let minBinT = bins - 1, maxBinT = 0;

    for (let i = 0; i < srcIndices.length; i++) {
      const p4 = srcIndices[i] * 4;
      rgbToOklabInto(srcRgba[p4], srcRgba[p4 + 1], srcRgba[p4 + 2], tmpOk, 0);
      const v = tmpOk[chan];
      const b = Math.max(0, Math.min(bins - 1, Math.round((v - minV) * scale)));
      rawS[b] += 1;
      if (b < minBinS) minBinS = b;
      if (b > maxBinS) maxBinS = b;
    }
    for (let i = 0; i < tgtIndices.length; i++) {
      const p4 = tgtIndices[i] * 4;
      rgbToOklabInto(tgtRgba[p4], tgtRgba[p4 + 1], tgtRgba[p4 + 2], tmpOk, 0);
      const v = tmpOk[chan];
      const b = Math.max(0, Math.min(bins - 1, Math.round((v - minV) * scale)));
      rawT[b] += 1;
      if (b < minBinT) minBinT = b;
      if (b > maxBinT) maxBinT = b;
    }

    // Gentle [1, 2, 1]/4 kernel on histograms to remove 8-bit quantization comb without polluting empty tails
    const smoothHist = (arr) => {
      const out = new Float64Array(bins);
      for (let b = 0; b < bins; b++) {
        const l = arr[Math.max(0, b - 1)];
        const c = arr[b];
        const r = arr[Math.min(bins - 1, b + 1)];
        out[b] = 0.25 * l + 0.5 * c + 0.25 * r;
      }
      return out;
    };
    const histS = smoothHist(rawS);
    const histT = smoothHist(rawT);

    minBinS = Math.max(0, minBinS - 1);
    maxBinS = Math.min(bins - 1, maxBinS + 1);
    minBinT = Math.max(0, minBinT - 1);
    maxBinT = Math.min(bins - 1, maxBinT + 1);

    let totalS = 0, totalT = 0;
    const cdfT = new Float64Array(bins);
    for (let b = 0; b < bins; b++) {
      totalS += histS[b];
      totalT += histT[b];
      cdfT[b] = totalT;
    }
    if (totalS <= 0 || totalT <= 0) {
      const idLut = new Float32Array(bins);
      for (let b = 0; b < bins; b++) idLut[b] = minV + b * stepV;
      return { lut: idLut, minV, maxV };
    }
    for (let b = 0; b < bins; b++) cdfT[b] /= totalT;

    // Map active source support [minBinS..maxBinS] via midpoint empirical quantiles
    const rawLut = new Float64Array(bins);
    let cumS = 0;
    let tPtr = minBinT;
    for (let b = 0; b < bins; b++) {
      const h = histS[b];
      const qMid = (cumS + 0.5 * h) / totalS;
      cumS += h;

      if (b >= minBinS && b <= maxBinS) {
        while (tPtr < maxBinT && cdfT[tPtr] < qMid) tPtr++;
        if (tPtr <= minBinT) {
          const c1 = cdfT[minBinT];
          const frac = c1 > 1e-12 ? qMid / c1 : 0.5;
          rawLut[b] = minV + (minBinT - 0.5 + frac) * stepV;
        } else {
          const c0 = cdfT[tPtr - 1];
          const c1 = cdfT[tPtr];
          const frac = c1 > c0 + 1e-12 ? (qMid - c0) / (c1 - c0) : 0.5;
          rawLut[b] = minV + (tPtr - 0.5 + frac) * stepV;
        }
      }
    }

    // Extrapolate smoothly with unit slope outside [minBinS..maxBinS] so boundary smoothing has zero cliff!
    for (let b = minBinS - 1; b >= 0; b--) {
      rawLut[b] = rawLut[minBinS] + (b - minBinS) * stepV;
    }
    for (let b = maxBinS + 1; b < bins; b++) {
      rawLut[b] = rawLut[maxBinS] + (b - maxBinS) * stepV;
    }

    // Smooth LUT gently across 5 taps
    const lut = new Float32Array(bins);
    for (let b = 0; b < bins; b++) {
      let acc = 0, cnt = 0;
      for (let k = -2; k <= 2; k++) {
        const nb = Math.max(0, Math.min(bins - 1, b + k));
        acc += rawLut[nb];
        cnt++;
      }
      const mapped = acc / cnt;
      const origV = minV + b * stepV;
      lut[b] = origV + Math.max(-0.25, Math.min(0.25, mapped - origV));
    }
    return { lut, minV, maxV };
  }

  function evalLut(lutObj, val) {
    const { lut, minV, maxV } = lutObj;
    const t = ((val - minV) / (maxV - minV)) * 255;
    if (t <= 0) return lut[0] + (val - minV);
    if (t >= 255) return lut[255] + (val - maxV);
    const i0 = t | 0;
    const f = t - i0;
    return lut[i0] + (lut[Math.min(255, i0 + 1)] - lut[i0]) * f;
  }

  /**
   * Biophysical Melanin-Hemoglobin-Shading optical density decomposition (Tsumura et al.):
   * Converts linear RGB to 3 orthogonal optical density components:
   *  - Shading (overall log intensity)
   *  - Melanin (golden/tan/brown pigment axis)
   *  - Hemoglobin (erythema / rosy pink-red flush axis)
   * @param {number} r 0..255
   * @param {number} g 0..255
   * @param {number} b 0..255
   * @returns {[number, number, number]}
   */
  function rgbToMelaninHemo(r, g, b) {
    const eps = 0.004;
    const dr = -Math.log(SRGB_TO_LIN[r] + eps);
    const dg = -Math.log(SRGB_TO_LIN[g] + eps);
    const db = -Math.log(SRGB_TO_LIN[b] + eps);

    // Exact 3x3 orthonormal basis Q (Q^T * Q = I) in log-optical-density space:
    // u0 = [1, 1, 1]/√3 (Shading / log-illumination)
    // u1 = [-1, 0, 1]/√2 (Melanin blue-minus-red pigment slope)
    // u2 = [-1, 2, -1]/√6 (Hemoglobin green-band vascular absorption)
    const shading = 0.5773502692 * (dr + dg + db);
    const melanin = 0.7071067812 * (db - dr);
    const hemo = 0.4082482905 * (2 * dg - dr - db);
    return [shading, melanin, hemo];
  }

  function melaninHemoToRgb(shading, melanin, hemo) {
    const eps = 0.004;
    // Exact transpose inverse Q^T of the orthonormal optical density basis Q
    const s0 = 0.5773502692 * shading;
    const dr = s0 - 0.7071067812 * melanin - 0.4082482905 * hemo;
    const dg = s0 + 0.8164965809 * hemo;
    const db = s0 + 0.7071067812 * melanin - 0.4082482905 * hemo;

    const rl = Math.max(0, Math.min(1, Math.exp(-dr) - eps));
    const gl = Math.max(0, Math.min(1, Math.exp(-dg) - eps));
    const bl = Math.max(0, Math.min(1, Math.exp(-db) - eps));

    const ri = (rl * LIN_LUT_SIZE + 0.5) | 0;
    const gi = (gl * LIN_LUT_SIZE + 0.5) | 0;
    const bi = (bl * LIN_LUT_SIZE + 0.5) | 0;
    return [LIN_TO_SRGB[ri], LIN_TO_SRGB[gi], LIN_TO_SRGB[bi]];
  }

  /**
   * Computes 3-Zone (Shadows / Midtones / Highlights) Oklab means for Lift/Gamma/Gain transfer.
   * @param {Uint8ClampedArray} rgbaBuf
   * @param {Int32Array} indices
   * @param {number} medianL
   */
  function computeThreeZoneStats(rgbaBuf, indices, medianL) {
    const zones = [
      { sum: [0, 0, 0], w: 0 }, // Shadows
      { sum: [0, 0, 0], w: 0 }, // Midtones
      { sum: [0, 0, 0], w: 0 }, // Highlights
    ];
    const tmpOk = new Float32Array(3);

    for (let k = 0; k < indices.length; k++) {
      const p4 = indices[k] * 4;
      rgbToOklabInto(rgbaBuf[p4], rgbaBuf[p4 + 1], rgbaBuf[p4 + 2], tmpOk, 0);
      const L = tmpOk[0], A = tmpOk[1], B = tmpOk[2];
      const wShad = 1 - smoothstep(medianL - 0.12, medianL + 0.02, L);
      const wHigh = smoothstep(medianL - 0.02, medianL + 0.12, L);
      const wMid = Math.max(0.05, 1 - Math.abs(L - medianL) / 0.14);

      const ws = [wShad + 1e-3, wMid + 1e-3, wHigh + 1e-3];
      for (let z = 0; z < 3; z++) {
        zones[z].sum[0] += ws[z] * L;
        zones[z].sum[1] += ws[z] * A;
        zones[z].sum[2] += ws[z] * B;
        zones[z].w += ws[z];
      }
    }

    return zones.map((z) => [z.sum[0] / z.w, z.sum[1] / z.w, z.sum[2] / z.w]);
  }

  // ===========================================================================
  // Master Post-Processing Entry Point
  // ===========================================================================

  /**
   * Applies Stage 6 Skin Color Post-Processing to imagemFinalCanvas so the skin color
   * of the two versions (Face vs Body) matches seamlessly, with minimal peak RAM for iOS Safari.
   *
   * @param {{
   *   inputFinalCanvas: HTMLCanvasElement,
   *   origImg1Canvas: HTMLCanvasElement,
   *   mergeFaceMask: Uint8Array,
   *   origFaceMask1: Uint8Array | null,
   *   edtToOutsideSq: Float32Array | null,
   *   faceSamples: Point[],
   *   bodySamples: Point[],
   *   options: SkinPostOptions,
   *   generateMaskPreview?: boolean
   * }} params
   * @returns {{
   *   canvas: HTMLCanvasElement,
   *   maskPreviewCanvas: HTMLCanvasElement | null,
   *   diagnostics: SkinDiagnostics
   * }}
   */
  function applySkinPostProcess(params) {
    const {
      inputFinalCanvas,
      origImg1Canvas,
      mergeFaceMask,
      origFaceMask1,
      edtToOutsideSq,
      faceSamples,
      bodySamples,
      options,
      generateMaskPreview = true,
    } = params;

    const Ops = global.SplitMergeImageOps;
    const W = inputFinalCanvas.width;
    const H = inputFinalCanvas.height;
    const n = W * H;

    const outCanvas = Ops.createCanvas(W, H);
    const maskPreviewCanvas = generateMaskPreview ? Ops.createCanvas(W, H) : null;
    const inCtx = inputFinalCanvas.getContext('2d', { willReadFrequently: true });
    const origCtx = origImg1Canvas.getContext('2d', { willReadFrequently: true });
    const outCtx = outCanvas.getContext('2d', { willReadFrequently: true });
    const maskCtx = maskPreviewCanvas ? maskPreviewCanvas.getContext('2d') : null;

    if (!inCtx || !origCtx || !outCtx || (maskPreviewCanvas && !maskCtx)) {
      return {
        canvas: inputFinalCanvas,
        maskPreviewCanvas,
        diagnostics: {
          valid: false,
          faceRgbBefore: [0, 0, 0],
          bodyRgbBefore: [0, 0, 0],
          faceRgbAfter: [0, 0, 0],
          bodyRgbAfter: [0, 0, 0],
          deltaEBefore: 0,
          deltaEAfter: 0,
          faceSkinPixels: 0,
          bodySkinPixels: 0,
        },
      };
    }

    const srcImgData = inCtx.getImageData(0, 0, W, H);
    const rgba = srcImgData.data;

    /** @type {Uint8ClampedArray | null} */
    let origRgbaCache = null;
    const getOrigRgba = () => {
      if (!origRgbaCache) {
        origRgbaCache = origCtx.getImageData(0, 0, W, H).data;
      }
      return origRgbaCache;
    };

    // Visible body mask in final image (mergeFaceMask === 0)
    const bodyRegionMask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      bodyRegionMask[i] = mergeFaceMask[i] === 0 ? 1 : 0;
    }

    const faceDist = extractSkinDistribution(rgba, mergeFaceMask, faceSamples, W, H);
    // Extract Body skin from visible body first; if outfit hides body skin below collar (few pixels) and no manual samples,
    // use full original body+neck from imagem1 (origFaceMask1 === 0) so neck skin is always captured!
    let bodyDist = extractSkinDistribution(rgba, bodyRegionMask, bodySamples, W, H);
    if ((!bodySamples || bodySamples.length === 0) && bodyDist.count < 120) {
      const origBodyFullMask = new Uint8Array(n);
      for (let i = 0; i < n; i++) {
        origBodyFullMask[i] = origFaceMask1 ? (origFaceMask1[i] === 0 ? 1 : 0) : bodyRegionMask[i];
      }
      const fallbackBody = extractSkinDistribution(getOrigRgba(), origBodyFullMask, [], W, H);
      if (fallbackBody.count > bodyDist.count) {
        bodyDist = fallbackBody;
      }
    }

    const deltaEBefore =
      faceDist.valid && bodyDist.valid
        ? computeDeltaE2000(faceDist.meanRgb, bodyDist.meanRgb)
        : 0;

    // Build compact Uint8Array selective skin weights reusing one feather scratch buffer
    const scratchFeather = new Uint8Array(n);
    const faceSkinWeights = faceDist.valid
      ? buildSelectiveSkinMask(
          rgba,
          mergeFaceMask,
          faceDist,
          options.maskSelectivity,
          options.protectFeatures,
          W,
          H,
          scratchFeather
        )
      : new Uint8Array(n);

    const bodySkinWeights = bodyDist.valid
      ? buildSelectiveSkinMask(
          rgba,
          bodyRegionMask,
          bodyDist,
          options.maskSelectivity,
          options.protectFeatures,
          W,
          H,
          scratchFeather
        )
      : new Uint8Array(n);

    // Render informative Skin Detection Heatmap ONLY when requested
    if (maskCtx) {
      const maskImgData = maskCtx.createImageData(W, H);
      const mData = maskImgData.data;
      const inv255 = 1 / 255;
      for (let i = 0; i < n; i++) {
        const p4 = i * 4;
        const fw = faceSkinWeights[i] * inv255;
        const bw = bodySkinWeights[i] * inv255;
        const lum = Math.round((0.299 * rgba[p4] + 0.587 * rgba[p4 + 1] + 0.114 * rgba[p4 + 2]) * 0.35);
        if (fw > 0.02) {
          mData[p4] = Math.round(lum * (1 - fw) + 34 * fw);
          mData[p4 + 1] = Math.round(lum * (1 - fw) + 211 * fw);
          mData[p4 + 2] = Math.round(lum * (1 - fw) + 238 * fw);
        } else if (bw > 0.02) {
          mData[p4] = Math.round(lum * (1 - bw) + 245 * bw);
          mData[p4 + 1] = Math.round(lum * (1 - bw) + 158 * bw);
          mData[p4 + 2] = Math.round(lum * (1 - bw) + 11 * bw);
        } else {
          mData[p4] = lum;
          mData[p4 + 1] = lum;
          mData[p4 + 2] = lum;
        }
        mData[p4 + 3] = rgba[p4 + 3];
      }
      maskCtx.putImageData(maskImgData, 0, 0);
    }

    // Check if post-processing is bypassed or skin regions missing
    const hasFineTune =
      Math.abs(options.tempOffset) > 0.1 ||
      Math.abs(options.tintOffset) > 0.1 ||
      Math.abs(options.lightOffset) > 0.1 ||
      Math.abs(options.satScale - 1) > 0.005;
    const borderStrength = Math.max(0, Math.min(1, Number(options.borderMatchStrength ?? 0.9)));
    const hasBorderHarm = Number(options.seamEqualizePx || 0) > 0 && borderStrength > 0.01;

    if (
      !options.enabled ||
      (!faceDist.valid && !bodyDist.valid) ||
      (options.strength <= 0.001 && !hasFineTune && !hasBorderHarm)
    ) {
      outCtx.putImageData(srcImgData, 0, 0);
      return {
        canvas: outCanvas,
        maskPreviewCanvas,
        diagnostics: {
          valid: faceDist.valid && bodyDist.valid,
          faceRgbBefore: faceDist.meanRgb,
          bodyRgbBefore: bodyDist.meanRgb,
          faceRgbAfter: faceDist.meanRgb,
          bodyRgbAfter: bodyDist.meanRgb,
          deltaEBefore,
          deltaEAfter: deltaEBefore,
          faceSkinPixels: faceDist.count,
          bodySkinPixels: bodyDist.count,
        },
      };
    }

    /**
     * Applies the chosen skin transfer from distSrc -> distTgt onto pixels with skinWeight > 0.
     * @param {ReturnType<typeof extractSkinDistribution>} distSrc
     * @param {ReturnType<typeof extractSkinDistribution>} distTgt
     * @param {Uint8Array} skinWeights
     * @param {number} dirFactor 1.0 for full transfer, 0.5 for mutual midpoint
     * @param {boolean} applyManualGrade
     */
    const applyRegionTransfer = (distSrc, distTgt, skinWeights, dirFactor, applyManualGrade) => {
      if (!distSrc.valid || !distTgt.valid) return;

      const method = options.method;
      const effStrength = options.strength * dirFactor;
      const lumaMix = options.lumaMatch;
      const chromaMix = options.chromaMatch;

      /** @type {number[] | null} */
      let mkMat = null;
      if (method === 'oklab_ot' || method === 'spatial_oklab') {
        mkMat = computeMongeKantorovichMatrix(distSrc.covOk, distTgt.covOk);
      }

      /** @type {any} */
      let cdfLuts = null;
      if (method === 'cdf_curves') {
        cdfLuts = [
          buildChannelQuantileLUT(distSrc.rgbaBuf, distTgt.rgbaBuf, 0, distSrc.indices, distTgt.indices, 0.15, 0.98),
          buildChannelQuantileLUT(distSrc.rgbaBuf, distTgt.rgbaBuf, 1, distSrc.indices, distTgt.indices, -0.05, 0.18),
          buildChannelQuantileLUT(distSrc.rgbaBuf, distTgt.rgbaBuf, 2, distSrc.indices, distTgt.indices, -0.05, 0.20),
        ];
      }

      let mhStats = null;
      if (method === 'melanin_hemo') {
        const calcMH = (indices, baseRgba) => {
          let s0 = 0, s1 = 0, s2 = 0;
          let q0 = 0, q1 = 0, q2 = 0;
          const len = indices.length;
          for (let k = 0; k < len; k++) {
            const p4 = indices[k] * 4;
            const [sh, mel, hem] = rgbToMelaninHemo(baseRgba[p4], baseRgba[p4 + 1], baseRgba[p4 + 2]);
            s0 += sh; s1 += mel; s2 += hem;
            q0 += sh * sh; q1 += mel * mel; q2 += hem * hem;
          }
          const m = [s0 / len, s1 / len, s2 / len];
          const sd = [
            Math.sqrt(Math.max(1e-4, q0 / len - m[0] * m[0])),
            Math.sqrt(Math.max(1e-4, q1 / len - m[1] * m[1])),
            Math.sqrt(Math.max(1e-4, q2 / len - m[2] * m[2])),
          ];
          return { m, sd };
        };
        const mhS = calcMH(distSrc.indices, distSrc.rgbaBuf);
        const mhT = calcMH(distTgt.indices, distTgt.rgbaBuf);
        mhStats = {
          mS: mhS.m,
          mT: mhT.m,
          r: [
            Math.max(0.75, Math.min(1.28, mhT.sd[0] / mhS.sd[0])),
            Math.max(0.72, Math.min(1.32, mhT.sd[1] / mhS.sd[1])),
            Math.max(0.72, Math.min(1.32, mhT.sd[2] / mhS.sd[2])),
          ],
        };
      }

      /** @type {{ srcZ: number[][], tgtZ: number[][] } | null} */
      let zoneStats = null;
      if (method === 'zones_lgg') {
        zoneStats = {
          srcZ: computeThreeZoneStats(distSrc.rgbaBuf, distSrc.indices, distSrc.meanOk[0]),
          tgtZ: computeThreeZoneStats(distTgt.rgbaBuf, distTgt.indices, distTgt.meanOk[0]),
        };
      }

      const [msL, msA, msB] = distSrc.meanOk;
      const [mtL, mtA, mtB] = distTgt.meanOk;

      const dLight = applyManualGrade ? options.lightOffset * 0.0025 : 0;
      const dTint = applyManualGrade ? options.tintOffset * 0.0009 : 0;
      const dTemp = applyManualGrade ? options.tempOffset * 0.0011 : 0;
      const satMul = applyManualGrade ? options.satScale : 1.0;
      const tmpOk = new Float32Array(3);
      const origBuf =
        method === 'spatial_oklab' && effStrength > 0.001 && edtToOutsideSq
          ? getOrigRgba()
          : null;
      const inv255 = 1 / 255;

      for (let i = 0; i < n; i++) {
        const wByte = skinWeights[i];
        if (wByte === 0) continue;
        const wSkin = wByte * inv255;

        const p4 = i * 4;
        rgbToOklabInto(rgba[p4], rgba[p4 + 1], rgba[p4 + 2], tmpOk, 0);
        const L0 = tmpOk[0];
        const A0 = tmpOk[1];
        const B0 = tmpOk[2];

        let Lm = L0;
        let Am = A0;
        let Bm = B0;

        if (effStrength > 0.001) {
          if ((method === 'oklab_ot' || method === 'spatial_oklab') && mkMat) {
            const dL = L0 - msL;
            const dA = A0 - msA;
            const dB = B0 - msB;
            Lm = mtL + mkMat[0] * dL + mkMat[1] * dA + mkMat[2] * dB;
            Am = mtA + mkMat[3] * dL + mkMat[4] * dA + mkMat[5] * dB;
            Bm = mtB + mkMat[6] * dL + mkMat[7] * dA + mkMat[8] * dB;

            if (origBuf && edtToOutsideSq && mergeFaceMask[i] === 1) {
              const distSeam = Math.sqrt(edtToOutsideSq[i]);
              const seamPull = 1 - smoothstep(0, Math.max(24, options.seamEqualizePx * 2.2), distSeam);
              if (seamPull > 0.01) {
                rgbToOklabInto(origBuf[p4], origBuf[p4 + 1], origBuf[p4 + 2], tmpOk, 0);
                if (Math.abs(tmpOk[0] - Lm) < 0.16) {
                  Lm = Lm + (tmpOk[0] - Lm) * seamPull * 0.65;
                  Am = Am + (tmpOk[1] - Am) * seamPull * 0.75;
                  Bm = Bm + (tmpOk[2] - Bm) * seamPull * 0.75;
                }
              }
            }
          } else if (method === 'cdf_curves' && cdfLuts) {
            Lm = evalLut(cdfLuts[0], L0);
            Am = evalLut(cdfLuts[1], A0);
            Bm = evalLut(cdfLuts[2], B0);
          } else if (method === 'melanin_hemo' && mhStats) {
            const [sh0, mel0, hem0] = rgbToMelaninHemo(rgba[p4], rgba[p4 + 1], rgba[p4 + 2]);
            const sh1 = (sh0 - mhStats.mS[0]) * mhStats.r[0] + mhStats.mT[0];
            const mel1 = (mel0 - mhStats.mS[1]) * mhStats.r[1] + mhStats.mT[1];
            const hem1 = (hem0 - mhStats.mS[2]) * mhStats.r[2] + mhStats.mT[2];
            const [tr, tg, tb] = melaninHemoToRgb(sh1, mel1, hem1);
            rgbToOklabInto(tr, tg, tb, tmpOk, 0);
            Lm = tmpOk[0];
            Am = tmpOk[1];
            Bm = tmpOk[2];
          } else if (method === 'zones_lgg' && zoneStats) {
            const med = msL;
            const wShad = 1 - smoothstep(med - 0.12, med + 0.02, L0);
            const wHigh = smoothstep(med - 0.02, med + 0.12, L0);
            const wMid = Math.max(0.05, 1 - Math.abs(L0 - med) / 0.14);
            const wTot = wShad + wMid + wHigh;

            const dZone = [0, 0, 0];
            const weightsZ = [wShad / wTot, wMid / wTot, wHigh / wTot];
            for (let z = 0; z < 3; z++) {
              dZone[0] += weightsZ[z] * (zoneStats.tgtZ[z][0] - zoneStats.srcZ[z][0]);
              dZone[1] += weightsZ[z] * (zoneStats.tgtZ[z][1] - zoneStats.srcZ[z][1]);
              dZone[2] += weightsZ[z] * (zoneStats.tgtZ[z][2] - zoneStats.srcZ[z][2]);
            }
            Lm = L0 + dZone[0];
            Am = A0 + dZone[1];
            Bm = B0 + dZone[2];
          }
        }

        const wL = Math.min(1.5, effStrength * lumaMix) * wSkin;
        const wC = Math.min(1.5, effStrength * chromaMix) * wSkin;

        let Lf = L0 + (Lm - L0) * wL;
        let Af = A0 + (Am - A0) * wC;
        let Bf = B0 + (Bm - B0) * wC;

        if (applyManualGrade && hasFineTune) {
          Lf += dLight * wSkin;
          Af = Af * (1 + (satMul - 1) * wSkin) + dTint * wSkin;
          Bf = Bf * (1 + (satMul - 1) * wSkin) + dTemp * wSkin;
        }

        Lf = Math.max(0, Math.min(1, Lf));
        const [nr, ng, nb] = oklabToRgbTuple(Lf, Af, Bf);
        rgba[p4] = nr;
        rgba[p4 + 1] = ng;
        rgba[p4 + 2] = nb;
      }
    };

    if (options.direction === 'face_to_body') {
      applyRegionTransfer(faceDist, bodyDist, faceSkinWeights, 1.0, true);
    } else if (options.direction === 'body_to_face') {
      applyRegionTransfer(bodyDist, faceDist, bodySkinWeights, 1.0, true);
    } else {
      applyRegionTransfer(faceDist, bodyDist, faceSkinWeights, 0.5, true);
      applyRegionTransfer(bodyDist, faceDist, bodySkinWeights, 0.5, false);
    }

    // Spatially-varying frequency-separated Oklab border skin harmonization (box-scoped!)
    if (hasBorderHarm && faceDist.valid && bodyDist.valid) {
      harmonizeBorderSkinOklab(
        rgba,
        W,
        H,
        mergeFaceMask,
        edtToOutsideSq,
        faceSkinWeights,
        bodySkinWeights,
        options
      );
    }

    outCtx.putImageData(srcImgData, 0, 0);

    // Measure post-processed skin diagnostics & ΔE00!
    const computeMeanRgbOnIndices = (indices, baseBuf) => {
      if (!indices || indices.length === 0) return /** @type {[number, number, number]} */ ([0, 0, 0]);
      let sr = 0, sg = 0, sb = 0;
      for (let k = 0; k < indices.length; k++) {
        const p4 = indices[k] * 4;
        sr += baseBuf[p4];
        sg += baseBuf[p4 + 1];
        sb += baseBuf[p4 + 2];
      }
      const len = indices.length;
      return [Math.round(sr / len), Math.round(sg / len), Math.round(sb / len)];
    };

    const faceRgbAfter = computeMeanRgbOnIndices(faceDist.indices, rgba);
    const bodyRgbAfter =
      bodyDist.indices.length > 0 && mergeFaceMask[bodyDist.indices[0]] === 0
        ? computeMeanRgbOnIndices(bodyDist.indices, rgba)
        : bodyDist.meanRgb;

    const deltaEAfter =
      faceDist.valid && bodyDist.valid ? computeDeltaE2000(faceRgbAfter, bodyRgbAfter) : 0;

    return {
      canvas: outCanvas,
      maskPreviewCanvas,
      diagnostics: {
        valid: faceDist.valid && bodyDist.valid,
        faceRgbBefore: faceDist.meanRgb,
        bodyRgbBefore: bodyDist.meanRgb,
        faceRgbAfter,
        bodyRgbAfter,
        deltaEBefore,
        deltaEAfter,
        faceSkinPixels: faceDist.count,
        bodySkinPixels: bodyDist.count,
      },
    };
  }

  /**
   * Ensures skin color & luminance are spatially consistent across both sides of the seam border
   * using spatially-varying directional Oklab collar profiling scoped to the tight padded seam box
   * and bilateral texture preservation (pores/micro-detail remain 100% intact).
   *
   * @param {Uint8ClampedArray} rgba
   * @param {number} W
   * @param {number} H
   * @param {Uint8Array} mergeFaceMask
   * @param {Float32Array | null} edtToOutsideSq
   * @param {Uint8Array} faceSkinWeights
   * @param {Uint8Array} bodySkinWeights
   * @param {SkinPostOptions} options
   */
  function harmonizeBorderSkinOklab(
    rgba,
    W,
    H,
    mergeFaceMask,
    edtToOutsideSq,
    faceSkinWeights,
    bodySkinWeights,
    options
  ) {
    const Geo = global.SplitMergeGeometry;
    if (!Geo || typeof Geo.computeEDT2DSq !== 'function') return;

    const borderStrength = Math.max(0, Math.min(1, Number(options.borderMatchStrength ?? 0.9)));
    const radius = Math.max(4, Math.min(90, Math.round(options.seamEqualizePx || 36)));
    if (borderStrength <= 0.01 || radius <= 2) return;

    // Compute tight bounding box of mergeFaceMask === 1 padded by radius + 4 so EDT stays small
    let minX = W, minY = H, maxX = -1, maxY = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W;
      for (let x = 0; x < W; x++) {
        if (mergeFaceMask[row + x] === 1) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (maxX < minX || maxY < minY) return;

    const pad = radius + 4;
    const bx = Math.max(0, minX - pad);
    const by = Math.max(0, minY - pad);
    const bw = Math.min(W - bx, maxX - minX + 1 + pad * 2);
    const bh = Math.min(H - by, maxY - minY + 1 + pad * 2);
    if (bw <= 0 || bh <= 0) return;

    const subMask = new Uint8Array(bw * bh);
    for (let y = 0; y < bh; y++) {
      const fullRow = (by + y) * W + bx;
      const subRow = y * bw;
      for (let x = 0; x < bw; x++) {
        subMask[subRow + x] = mergeFaceMask[fullRow + x];
      }
    }

    const subFaceEdtSq = edtToOutsideSq ? null : Geo.computeEDT2DSq(subMask, 0, bw, bh);
    const subBodyEdtSq = Geo.computeEDT2DSq(subMask, 1, bw, bh);

    const collarW = Math.max(10, Math.min(28, Math.round(radius * 0.55)));
    const collarWSq = collarW * collarW;
    const cellSize = Math.max(24, Math.round(collarW * 1.25));
    const gw = Math.max(1, Math.ceil(bw / cellSize));
    const gh = Math.max(1, Math.ceil(bh / cellSize));
    const numCells = gw * gh;

    const faceSum = new Float32Array(numCells * 3);
    const faceW = new Float32Array(numCells);
    const bodySum = new Float32Array(numCells * 3);
    const bodyW = new Float32Array(numCells);
    const tmpOk = new Float32Array(3);
    const inv255 = 1 / 255;

    let gFaceL = 0, gFaceA = 0, gFaceB = 0, gFaceWt = 0;
    let gBodyL = 0, gBodyA = 0, gBodyB = 0, gBodyWt = 0;

    // 1. Sample skin collar pixels on both sides of the boundary into sub-box spatial cells
    for (let y = 0; y < bh; y++) {
      const fy = by + y;
      const fullRow = fy * W + bx;
      const subRow = y * bw;
      const cy = Math.min(gh - 1, (y / cellSize) | 0);
      const cRow = cy * gw;

      for (let x = 0; x < bw; x++) {
        const si = subRow + x;
        const fi = fullRow + x;
        const isFace = subMask[si] === 1;
        const w = (isFace ? faceSkinWeights[fi] : bodySkinWeights[fi]) * inv255;
        if (w <= 0.15) continue;

        const d2 = isFace
          ? edtToOutsideSq
            ? edtToOutsideSq[fi]
            : /** @type {Float32Array} */ (subFaceEdtSq)[si]
          : subBodyEdtSq[si];
        if (d2 <= 0 || d2 > collarWSq) continue;

        const p4 = fi * 4;
        rgbToOklabInto(rgba[p4], rgba[p4 + 1], rgba[p4 + 2], tmpOk, 0);
        const L = tmpOk[0], a = tmpOk[1], b = tmpOk[2];

        const cx = Math.min(gw - 1, (x / cellSize) | 0);
        const ci3 = (cRow + cx) * 3;
        const ci = cRow + cx;

        if (isFace) {
          faceSum[ci3] += L * w;
          faceSum[ci3 + 1] += a * w;
          faceSum[ci3 + 2] += b * w;
          faceW[ci] += w;
          gFaceL += L * w;
          gFaceA += a * w;
          gFaceB += b * w;
          gFaceWt += w;
        } else {
          bodySum[ci3] += L * w;
          bodySum[ci3 + 1] += a * w;
          bodySum[ci3 + 2] += b * w;
          bodyW[ci] += w;
          gBodyL += L * w;
          gBodyA += a * w;
          gBodyB += b * w;
          gBodyWt += w;
        }
      }
    }

    if (gFaceWt < 4 || gBodyWt < 4) return;
    gFaceL /= gFaceWt; gFaceA /= gFaceWt; gFaceB /= gFaceWt;
    gBodyL /= gBodyWt; gBodyA /= gBodyWt; gBodyB /= gBodyWt;
    const gDeltaL = gBodyL - gFaceL;
    const gDeltaA = gBodyA - gFaceA;
    const gDeltaB = gBodyB - gFaceB;

    // 2. Smooth grid cell averages with 3x3 Gaussian weights & blend sparse cells to global delta
    const smoothGrid = (sumArr, wArr, gL, gA, gB) => {
      const out = new Float32Array(numCells * 3);
      for (let cy = 0; cy < gh; cy++) {
        for (let cx = 0; cx < gw; cx++) {
          let sL = 0, sA = 0, sB = 0, sW = 0;
          for (let dy = -1; dy <= 1; dy++) {
            const ny = cy + dy;
            if (ny < 0 || ny >= gh) continue;
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx + dx;
              if (nx < 0 || nx >= gw) continue;
              const ni = ny * gw + nx;
              const nw = wArr[ni];
              if (nw <= 0) continue;
              const kern = (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
              const wt = nw * kern;
              const ni3 = ni * 3;
              sL += (sumArr[ni3] / nw) * wt;
              sA += (sumArr[ni3 + 1] / nw) * wt;
              sB += (sumArr[ni3 + 2] / nw) * wt;
              sW += wt;
            }
          }
          const idx3 = (cy * gw + cx) * 3;
          const conf = Math.min(1, sW / 32);
          if (sW > 1e-4) {
            const mL = sL / sW, mA = sA / sW, mB = sB / sW;
            out[idx3] = gL * (1 - conf) + mL * conf;
            out[idx3 + 1] = gA * (1 - conf) + mA * conf;
            out[idx3 + 2] = gB * (1 - conf) + mB * conf;
          } else {
            out[idx3] = gL;
            out[idx3 + 1] = gA;
            out[idx3 + 2] = gB;
          }
        }
      }
      return out;
    };

    const faceGrid = smoothGrid(faceSum, faceW, gFaceL, gFaceA, gFaceB);
    const bodyGrid = smoothGrid(bodySum, bodyW, gBodyL, gBodyA, gBodyB);

    // 3. Determine bidirectional meeting ratio at d = 0
    const mutualMeet = options.borderMutualMeet !== false;
    let bodyShare = 0.5;
    if (!mutualMeet) {
      bodyShare = options.direction === 'body_to_face' ? 1.0 : 0.0;
    } else if (options.direction === 'face_to_body') {
      bodyShare = 0.28;
    } else if (options.direction === 'body_to_face') {
      bodyShare = 0.78;
    }
    const faceShare = 1 - bodyShare;

    const sampleGrid3 = (grid, sx, sy) => {
      const gx = Math.max(0, Math.min(gw - 1, sx / cellSize - 0.5));
      const gy = Math.max(0, Math.min(gh - 1, sy / cellSize - 0.5));
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const x1 = Math.min(gw - 1, x0 + 1);
      const y1 = Math.min(gh - 1, y0 + 1);
      const fx = gx - x0;
      const fy = gy - y0;
      const w00 = (1 - fx) * (1 - fy);
      const w10 = fx * (1 - fy);
      const w01 = (1 - fx) * fy;
      const w11 = fx * fy;
      const i00 = (y0 * gw + x0) * 3;
      const i10 = (y0 * gw + x1) * 3;
      const i01 = (y1 * gw + x0) * 3;
      const i11 = (y1 * gw + x1) * 3;
      return [
        grid[i00] * w00 + grid[i10] * w10 + grid[i01] * w01 + grid[i11] * w11,
        grid[i00 + 1] * w00 + grid[i10 + 1] * w10 + grid[i01 + 1] * w01 + grid[i11 + 1] * w11,
        grid[i00 + 2] * w00 + grid[i10 + 2] * w10 + grid[i01 + 2] * w01 + grid[i11 + 2] * w11,
      ];
    };

    const rSq = radius * radius;
    const twoSigmaSq = 2 * 0.018;

    // 4. Apply frequency-separated bilateral Oklab offset within boundary band inside sub-box
    for (let y = 0; y < bh; y++) {
      const fullRow = (by + y) * W + bx;
      const subRow = y * bw;
      for (let x = 0; x < bw; x++) {
        const si = subRow + x;
        const fi = fullRow + x;
        const isFace = subMask[si] === 1;
        const wSkin = (isFace ? faceSkinWeights[fi] : bodySkinWeights[fi]) * inv255;
        if (wSkin <= 0.02) continue;

        const d2 = isFace
          ? edtToOutsideSq
            ? edtToOutsideSq[fi]
            : /** @type {Float32Array} */ (subFaceEdtSq)[si]
          : subBodyEdtSq[si];
        if (d2 >= rSq) continue;

        const share = isFace ? faceShare : bodyShare;
        if (share <= 0.001) continue;

        const d = Math.sqrt(d2);
        const t = 1 - smoothstep(0, radius, d);
        if (t <= 0.001) continue;
        const falloff = Math.pow(t, 1.35);

        const [fL, fA, fB] = sampleGrid3(faceGrid, x, y);
        const [bL, bA, bB] = sampleGrid3(bodyGrid, x, y);

        const dL = (bL - fL) * 0.72 + gDeltaL * 0.28;
        const dA = (bA - fA) * 0.72 + gDeltaA * 0.28;
        const dB = (bB - fB) * 0.72 + gDeltaB * 0.28;

        const p4 = fi * 4;
        rgbToOklabInto(rgba[p4], rgba[p4 + 1], rgba[p4 + 2], tmpOk, 0);
        const L0 = tmpOk[0];
        const A0 = tmpOk[1];
        const B0 = tmpOk[2];

        const refL = isFace ? fL : bL;
        const refA = isFace ? fA : bA;
        const refB = isFace ? fB : bB;
        const distOkSq =
          (L0 - refL) * (L0 - refL) + (A0 - refA) * (A0 - refA) * 4 + (B0 - refB) * (B0 - refB) * 4;
        const bilat = Math.exp(-distOkSq / twoSigmaSq);
        if (bilat <= 0.02) continue;

        const sign = isFace ? 1 : -1;
        const gain = borderStrength * share * falloff * wSkin * bilat * sign;
        const Lf = Math.max(0, Math.min(1, L0 + dL * gain));
        const Af = A0 + dA * gain;
        const Bf = B0 + dB * gain;

        const [nr, ng, nb] = oklabToRgbTuple(Lf, Af, Bf);
        rgba[p4] = nr;
        rgba[p4 + 1] = ng;
        rgba[p4 + 2] = nb;
      }
    }
  }

  global.SplitMergeSkinPost = {
    applySkinPostProcess,
    harmonizeBorderSkinOklab,
    computeDeltaE2000,
    symEigen3x3,
    computeMongeKantorovichMatrix,
  };
})(window);
