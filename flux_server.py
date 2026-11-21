"""
Servidor HTTP local para o Split & Merge Studio + API do pipeline FLUX.1.

Modos de execução:
  1. Servidor completo (WebApp + APIs /api/* + APIs /api/flux/*):
       python flux_server.py
  2. Somente API FLUX em segundo plano (usado como ponte pelo server.ps1):
       python flux_server.py --api-only --port=8766 --no-browser
"""

from __future__ import annotations

import argparse
import base64
import dataclasses
import importlib
import importlib.util
import io
import json
import mimetypes
import os
import re
import socket
import sys
import threading
import traceback
import webbrowser
from datetime import datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import parse_qs, unquote, urlparse

import torch
from dotenv import load_dotenv
from PIL import Image

import config as config_mod
from flux_img2img import (
    FluxImageGenerator,
    adapt_prompt_for_collage,
    build_side_by_side_collage,
    clear_vram,
    parse_hex_color,
)

ROOT = Path(__file__).resolve().parent

_GEN_LOCK = threading.Lock()
_CACHED_GENERATOR: Optional[FluxImageGenerator] = None
_CACHED_KEY: Optional[Tuple[str, bool, str, str]] = None
_STATUS: Dict[str, Any] = {
    "is_generating": False,
    "message": "Pronto",
}


def _decode_data_url_to_pil(data_url: str) -> Image.Image:
    if not data_url:
        raise ValueError("DataURL de imagem vazia.")
    b64 = data_url.split(",", 1)[1] if "," in data_url else data_url
    raw = base64.b64decode(b64)
    return Image.open(io.BytesIO(raw))


def _pil_to_png_data_url(img: Image.Image) -> Tuple[str, bytes]:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    png_bytes = buf.getvalue()
    b64 = base64.b64encode(png_bytes).decode("ascii")
    return f"data:image/png;base64,{b64}", png_bytes


def _read_config_dict() -> Dict[str, Any]:
    importlib.reload(config_mod)
    return dataclasses.asdict(config_mod.DEFAULT_CONFIG)


def _format_py_literal(val: Any) -> str:
    if val is None:
        return "None"
    if isinstance(val, bool):
        return "True" if val else "False"
    if isinstance(val, (int, float)):
        return repr(val)
    return json.dumps(str(val), ensure_ascii=False)


def _update_config_py(updates: Dict[str, Any]) -> Dict[str, Any]:
    """Atualiza campos de FluxPipelineConfig em config.py preservando comentários."""
    cfg_path = ROOT / "config.py"
    text = cfg_path.read_text(encoding="utf-8")

    current = _read_config_dict()
    valid_fields = set(current.keys())

    for key, val in updates.items():
        if key not in valid_fields:
            continue
        # Normaliza tipos numéricos / opcionais
        if key in ("use_8bit_quantization",):
            val = bool(val)
        elif key in ("strength", "target_megapixels"):
            val = float(val)
        elif key in ("collage_gap_px",):
            val = max(0, int(val))
        elif key in ("num_inference_steps", "seed"):
            val = None if (val is None or val == "") else int(val)
        elif key in ("guidance_scale",):
            val = None if (val is None or val == "") else float(val)
        elif key in ("prompt_file",):
            val = None if (val is None or str(val).strip() == "") else str(val).strip()
        else:
            val = str(val)

        literal = _format_py_literal(val)
        # 1) Trata atribuição multi-linha com parênteses: `    field: Type = (\n ... \n    )`
        multiline_pat = re.compile(
            rf"^(\s*{re.escape(key)}\s*:\s*[^=\n]+?=\s*)\([^\S\n]*\r?\n(?:[^\n]*\r?\n)*?[^\S\n]*\)([^\S\n]*(?:#.*)?)$",
            re.MULTILINE,
        )
        if multiline_pat.search(text):
            text = multiline_pat.sub(lambda m: f"{m.group(1)}{literal}{m.group(2)}", text, count=1)
        else:
            # 2) Trata linha simples: `    field: Type = value`
            single_pat = re.compile(
                rf"^(\s*{re.escape(key)}\s*:\s*[^=\n]+?=\s*)(.+?)(\s*(?:#.*)?)$",
                re.MULTILINE,
            )
            if single_pat.search(text):
                text = single_pat.sub(lambda m: f"{m.group(1)}{literal}{m.group(3)}", text, count=1)

    compile(text, str(cfg_path), "exec")
    cfg_path.write_text(text, encoding="utf-8")
    return _read_config_dict()


def _read_prompt_templates() -> Dict[str, str]:
    orig_p = ROOT / "prompt_original_hair.txt"
    ref_p = ROOT / "prompt_reference_hair.txt"
    return {
        "original_hair": orig_p.read_text(encoding="utf-8") if orig_p.is_file() else "",
        "reference_hair": ref_p.read_text(encoding="utf-8") if ref_p.is_file() else "",
    }


def _check_packages() -> Tuple[Dict[str, bool], List[str]]:
    importlib.invalidate_caches()
    required = [
        "torch",
        "PIL",
        "dotenv",
        "diffusers",
        "transformers",
        "accelerate",
        "sentencepiece",
        "peft",
        "bitsandbytes",
    ]
    status: Dict[str, bool] = {}
    missing: List[str] = []
    for pkg in required:
        ok = importlib.util.find_spec(pkg) is not None
        status[pkg] = ok
        if not ok and pkg != "bitsandbytes":
            missing.append(pkg)
    return status, missing


def _get_status_payload() -> Dict[str, Any]:
    load_dotenv(ROOT / ".env", override=True)
    pkgs, missing = _check_packages()
    cuda_ok = torch.cuda.is_available()
    gpu_name = None
    vram_total_mb = None
    vram_free_mb = None
    if cuda_ok:
        try:
            gpu_name = torch.cuda.get_device_name(0)
            free_b, total_b = torch.cuda.mem_get_info(0)
            vram_free_mb = round(free_b / (1024 * 1024))
            vram_total_mb = round(total_b / (1024 * 1024))
        except Exception:
            pass

    return {
        "ok": True,
        "cuda_available": cuda_ok,
        "gpu_name": gpu_name,
        "vram_total_mb": vram_total_mb,
        "vram_free_mb": vram_free_mb,
        "packages": pkgs,
        "missing_packages": missing,
        "hf_token_configured": bool(os.getenv("HF_TOKEN", "").strip()),
        "loaded_model": _CACHED_KEY[0] if _CACHED_KEY else None,
        "loaded_8bit": _CACHED_KEY[1] if _CACHED_KEY else False,
        "is_generating": _STATUS["is_generating"],
        "status_message": _STATUS["message"],
    }


def _get_or_load_generator(
    model_id: str,
    use_8bit: bool,
    device: str,
    quantization_mode: str = "4bit",
) -> FluxImageGenerator:
    global _CACHED_GENERATOR, _CACHED_KEY

    load_dotenv(ROOT / ".env", override=True)
    qmode = (quantization_mode or "4bit").lower()
    desired_key = (model_id, bool(use_8bit), device, qmode)

    if _CACHED_GENERATOR is not None and _CACHED_KEY == desired_key:
        return _CACHED_GENERATOR

    if _CACHED_GENERATOR is not None:
        _STATUS["message"] = "Descarregando modelo anterior da VRAM..."
        _CACHED_GENERATOR.unload()
        _CACHED_GENERATOR = None
        _CACHED_KEY = None

    _STATUS["message"] = f"Carregando {model_id} ({qmode if use_8bit else 'bf16'})..."
    gen = FluxImageGenerator(
        model_id=model_id,
        use_8bit_quantization=bool(use_8bit),
        device=device,
        quantization_mode=qmode,
    )
    _CACHED_GENERATOR = gen
    _CACHED_KEY = desired_key
    return gen


def _save_png_bytes(png_bytes: bytes, folder: str, filename: str) -> str:
    clean_name = Path(filename).name or f"imagem_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png"
    if not clean_name.lower().endswith(".png"):
        clean_name += ".png"
    clean_folder = (folder or "").strip("\\/")
    target_dir = (ROOT / "data" / clean_folder) if clean_folder else (ROOT / "data")
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / clean_name
    target_path.write_bytes(png_bytes)
    rel = f"data/{clean_folder}/{clean_name}" if clean_folder else f"data/{clean_name}"
    return rel


class StudioRequestHandler(BaseHTTPRequestHandler):
    api_only: bool = False

    def log_message(self, format: str, *args: Any) -> None:
        # Mantém log limpo no console
        pass

    def _send_json(self, payload: Dict[str, Any], status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self) -> Dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0") or 0)
        if length <= 0:
            return {}
        raw = self.rfile.read(length)
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        clean_path = unquote(parsed.path)
        query = parse_qs(parsed.query)

        if clean_path == "/api/flux/status":
            self._send_json(_get_status_payload())
            return

        if clean_path == "/api/flux/config":
            try:
                self._send_json({"ok": True, "config": _read_config_dict()})
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=500)
            return

        if clean_path == "/api/flux/prompts":
            try:
                raw_prompts = _read_prompt_templates()
                refs = int(query.get("refs", ["1"])[0] or 1)
                self._send_json(
                    {
                        "ok": True,
                        "raw": raw_prompts,
                        "adapted": {
                            "original_hair": adapt_prompt_for_collage(
                                raw_prompts["original_hair"], refs, is_reference_hair=False
                            ),
                            "reference_hair": adapt_prompt_for_collage(
                                raw_prompts["reference_hair"], refs, is_reference_hair=True
                            ),
                        },
                    }
                )
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=500)
            return

        if clean_path == "/api/data-folders":
            data_dir = ROOT / "data"
            data_dir.mkdir(parents=True, exist_ok=True)
            dirs = [d.name for d in data_dir.iterdir() if d.is_dir()]

            def _sort_key(name: str) -> Tuple[int, str]:
                return (int(name), "") if name.isdigit() else (-1, name)

            dirs.sort(key=_sort_key, reverse=True)
            self._send_json({"folders": dirs, "defaultFolder": dirs[0] if dirs else ""})
            return

        if clean_path == "/api/open-data-folder":
            folder = (query.get("folder", [""])[0] or "").strip("\\/")
            target_dir = (ROOT / "data" / folder) if folder else (ROOT / "data")
            target_dir.mkdir(parents=True, exist_ok=True)
            if sys.platform.startswith("win"):
                os.startfile(str(target_dir))  # type: ignore[attr-defined]
            self._send_json({"ok": True})
            return

        if self.api_only:
            self._send_json({"ok": False, "error": "Rota não encontrada."}, status=404)
            return

        # Arquivos estáticos do WebApp
        rel = "index.html" if clean_path == "/" else clean_path.lstrip("/")
        full_path = (ROOT / rel).resolve()
        if not str(full_path).startswith(str(ROOT.resolve())) or not full_path.is_file():
            self.send_error(404, "404 Not Found")
            return

        ctype, _ = mimetypes.guess_type(str(full_path))
        if full_path.suffix.lower() == ".js":
            ctype = "application/javascript; charset=utf-8"
        elif full_path.suffix.lower() == ".css":
            ctype = "text/css; charset=utf-8"
        elif full_path.suffix.lower() == ".html":
            ctype = "text/html; charset=utf-8"
        data = full_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype or "application/octet-stream")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        clean_path = unquote(parsed.path)

        if clean_path == "/api/save-image":
            try:
                body = self._read_json_body()
                data_url = body.get("dataUrl", "")
                b64 = data_url.split(",", 1)[1] if "," in data_url else data_url
                raw = base64.b64decode(b64)
                folder = str(body.get("folder", "") or "")
                filename = str(body.get("filename", "") or "")
                rel = _save_png_bytes(raw, folder, filename)
                self._send_json(
                    {
                        "ok": True,
                        "path": rel,
                        "fullPath": str(ROOT / rel),
                        "bytes": len(raw),
                    }
                )
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=400)
            return

        if clean_path == "/api/flux/config":
            try:
                body = self._read_json_body()
                updates = body.get("config", body)
                saved = _update_config_py(updates)
                self._send_json({"ok": True, "config": saved})
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=400)
            return

        if clean_path == "/api/flux/adapt-prompt":
            try:
                body = self._read_json_body()
                template = str(body.get("template", "original_hair"))
                num_refs = int(body.get("num_references", 1))
                raw_prompts = _read_prompt_templates()
                base = body.get("custom_base") or raw_prompts.get(template) or ""
                adapted = adapt_prompt_for_collage(
                    base,
                    num_references=num_refs,
                    is_reference_hair=(template == "reference_hair"),
                )
                self._send_json({"ok": True, "adapted_prompt": adapted})
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=400)
            return

        if clean_path == "/api/flux/collage":
            try:
                body = self._read_json_body()
                left_pil = _decode_data_url_to_pil(body["left_image_data_url"])
                ref_pils = [
                    _decode_data_url_to_pil(u) for u in (body.get("reference_data_urls") or [])
                ]
                gap_px = int(body.get("gap_px", 4))
                bg_rgb = parse_hex_color(str(body.get("bg_color", "#000000")))

                collage = build_side_by_side_collage(
                    left_pil,
                    reference_images=ref_pils,
                    gap_px=gap_px,
                    bg_color=bg_rgb,
                )
                data_url, png_bytes = _pil_to_png_data_url(collage)

                saved_path = None
                if body.get("save_to_folder") is not None:
                    saved_path = _save_png_bytes(
                        png_bytes,
                        str(body.get("save_to_folder") or ""),
                        str(body.get("filename") or "flux_collage_input.png"),
                    )

                self._send_json(
                    {
                        "ok": True,
                        "data_url": data_url,
                        "width": collage.width,
                        "height": collage.height,
                        "panel_count": 1 + len(ref_pils),
                        "saved_path": saved_path,
                    }
                )
            except Exception as exc:
                self._send_json({"ok": False, "error": str(exc)}, status=400)
            return

        if clean_path == "/api/flux/unload":
            global _CACHED_GENERATOR, _CACHED_KEY
            if _GEN_LOCK.locked():
                self._send_json(
                    {"ok": False, "error": "Geração em andamento; aguarde terminar."},
                    status=409,
                )
                return
            with _GEN_LOCK:
                if _CACHED_GENERATOR is not None:
                    _CACHED_GENERATOR.unload()
                    _CACHED_GENERATOR = None
                    _CACHED_KEY = None
                clear_vram()
                _STATUS["message"] = "VRAM liberada"
            self._send_json({"ok": True})
            return

        if clean_path == "/api/flux/generate":
            if not _GEN_LOCK.acquire(blocking=False):
                self._send_json(
                    {"ok": False, "error": "Já existe uma geração FLUX.1 em execução."},
                    status=409,
                )
                return

            try:
                _STATUS["is_generating"] = True
                _STATUS["message"] = "Preparando colagem PIL..."
                body = self._read_json_body()

                cfg = _read_config_dict()
                req_cfg = body.get("config") or {}
                for k, v in req_cfg.items():
                    if k in cfg:
                        cfg[k] = v

                if body.get("save_config"):
                    cfg = _update_config_py(cfg)

                left_pil = _decode_data_url_to_pil(body["left_image_data_url"])
                ref_pils = [
                    _decode_data_url_to_pil(u) for u in (body.get("reference_data_urls") or [])
                ]
                prompt_text = str(body.get("prompt") or cfg.get("prompt") or "").strip()
                if not prompt_text:
                    raise ValueError("O prompt não pode estar vazio.")

                model_id = str(cfg["model_id"])
                use_8bit = bool(cfg.get("use_8bit_quantization", True))
                quant_mode = str(cfg.get("quantization_mode", "4bit"))
                device = str(cfg.get("device", "cuda"))
                strength = float(cfg.get("strength", 0.65))
                steps = cfg.get("num_inference_steps")
                steps = int(steps) if steps not in (None, "") else None
                guidance = cfg.get("guidance_scale")
                guidance = float(guidance) if guidance not in (None, "") else None
                seed = cfg.get("seed")
                seed = int(seed) if seed not in (None, "") else None
                target_mp = float(cfg.get("target_megapixels", 1.0))
                output_size_mode = str(cfg.get("output_size_mode", "auto"))
                gap_px = int(cfg.get("collage_gap_px", 4))
                bg_color = str(cfg.get("collage_bg_color", "#000000"))

                save_folder = str(body.get("save_folder") or "")
                output_path_cfg = str(cfg.get("output_path") or "").strip()
                resolved_out: Optional[Path] = None
                if output_path_cfg:
                    p = Path(output_path_cfg)
                    resolved_out = p if p.is_absolute() else (ROOT / p)

                gen = _get_or_load_generator(model_id, use_8bit, device, quant_mode)
                _STATUS["message"] = f"Executando inferência ({model_id})..."

                result_img, collage_img = gen.generate_collage(
                    left_image=left_pil,
                    reference_images=ref_pils,
                    prompt=prompt_text,
                    strength=strength,
                    num_inference_steps=steps,
                    guidance_scale=guidance,
                    seed=seed,
                    output_path=resolved_out,
                    target_megapixels=target_mp,
                    output_size_mode=output_size_mode,
                    gap_px=gap_px,
                    bg_color=bg_color,
                )

                result_url, result_bytes = _pil_to_png_data_url(result_img)
                collage_url, collage_bytes = _pil_to_png_data_url(collage_img)

                saved_collage_path = _save_png_bytes(
                    collage_bytes, save_folder, "flux_collage_input.png"
                )
                saved_result_path = _save_png_bytes(
                    result_bytes, save_folder, "flux_kontext_output.png"
                )

                _STATUS["message"] = "Concluído"
                self._send_json(
                    {
                        "ok": True,
                        "result_data_url": result_url,
                        "collage_data_url": collage_url,
                        "result_width": result_img.width,
                        "result_height": result_img.height,
                        "collage_width": collage_img.width,
                        "collage_height": collage_img.height,
                        "saved_collage_path": saved_collage_path,
                        "saved_result_path": saved_result_path,
                    }
                )
            except Exception as exc:
                traceback.print_exc()
                clear_vram()
                _STATUS["message"] = f"Erro: {exc}"
                self._send_json({"ok": False, "error": str(exc)}, status=500)
            finally:
                _STATUS["is_generating"] = False
                _GEN_LOCK.release()
            return

        self._send_json({"ok": False, "error": "Endpoint não encontrado."}, status=404)


def _find_free_port(start_port: int, host: str = "0.0.0.0") -> int:
    for p in range(start_port, start_port + 30):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((host, p))
                return p
            except OSError:
                continue
    raise RuntimeError("Nenhuma porta disponível encontrada.")


def _detect_lan_ip() -> Optional[str]:
    try:
        with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as s:
            s.connect(("8.8.8.8", 80))
            ip = s.getsockname()[0]
            if ip and not ip.startswith("127."):
                return ip
    except OSError:
        pass
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description="Servidor WebApp + API FLUX.1")
    parser.add_argument("--host", default=None, help="Host bind (padrão: 0.0.0.0 no WebApp, 127.0.0.1 em --api-only)")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--api-only", action="store_true")
    parser.add_argument("--no-browser", action="store_true")
    args = parser.parse_args()

    bind_host = args.host if args.host else ("127.0.0.1" if args.api_only else "0.0.0.0")
    port = args.port if args.api_only else _find_free_port(args.port, bind_host)
    StudioRequestHandler.api_only = args.api_only
    server = ThreadingHTTPServer((bind_host, port), StudioRequestHandler)
    local_url = f"http://127.0.0.1:{port}/"
    lan_ip = _detect_lan_ip() if bind_host in ("0.0.0.0", "") else None

    print("=====================================================")
    print(f"  Split & Merge Studio + FLUX.1 API")
    print(f"  Local (PC):      {local_url}")
    if lan_ip:
        print(f"  Mobile (Wi-Fi):  http://{lan_ip}:{port}/")
    print(f"  Modo: {'API-Only' if args.api_only else 'WebApp Completo'} (bind {bind_host})")
    print("  Pressione Ctrl+C para encerrar.")
    print("=====================================================")

    if not args.api_only and not args.no_browser:
        webbrowser.open(local_url)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrando servidor...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
