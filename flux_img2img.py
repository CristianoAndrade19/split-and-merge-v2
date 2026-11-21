"""
Pipeline local de geração Image-to-Image / Edição Contextual com FLUX.1,
otimizado para GPUs de 16 GB de VRAM (ex.: NVIDIA RTX A4000, arquitetura Ampere).

Uso como módulo:
    from flux_img2img import FluxImageGenerator

    gen = FluxImageGenerator(
        model_id="black-forest-labs/FLUX.1-dev",
        use_8bit_quantization=False,
    )
    img = gen.generate(
        image_path="data/1/imagemMerge.png",
        prompt="...",
        strength=0.65,
        num_inference_steps=28,
        guidance_scale=3.5,
        seed=42,
        output_path="data/1/flux_refined.png",
    )

Uso via CLI (lendo padrões de config.py):
    python flux_img2img.py
    python flux_img2img.py --image data/1/in.png --output data/1/out.png --8bit
"""

from __future__ import annotations

import argparse
import gc
import inspect
import logging
import math
import os
import re
from pathlib import Path
from typing import Any, Optional, Sequence, Tuple, Union

import torch
from dotenv import load_dotenv
from PIL import Image, ImageOps

from config import DEFAULT_CONFIG, FluxPipelineConfig

logger = logging.getLogger("flux_img2img")
if not logger.handlers:
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("[%(levelname)s] %(message)s"))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)


SUPPORTED_MODELS: Tuple[str, ...] = (
    "black-forest-labs/FLUX.1-dev",
    "black-forest-labs/FLUX.1-Kontext-dev",
    "black-forest-labs/FLUX.1-schnell",
)

GATED_MODELS: Tuple[str, ...] = (
    "black-forest-labs/FLUX.1-dev",
    "black-forest-labs/FLUX.1-Kontext-dev",
)


def clear_vram() -> None:
    """Força coleta de lixo Python e libera blocos não utilizados na VRAM CUDA."""
    gc.collect()
    if torch.cuda.is_available():
        torch.cuda.empty_cache()
        torch.cuda.ipc_collect()


def compute_target_dimensions_multiple_of_16(
    orig_w: int,
    orig_h: int,
    target_megapixels: float = 1.0,
    multiple_of: int = 16,
) -> Tuple[int, int]:
    """Calcula dimensões (w, h) mantendo o aspect ratio próximo a `target_megapixels` em múltiplos de 16."""
    if orig_w <= 0 or orig_h <= 0:
        raise ValueError(f"Dimensões inválidas na imagem de entrada: {orig_w}x{orig_h}")

    target_pixels = max(256 * 256, int(round(target_megapixels * 1024 * 1024)))
    aspect = orig_w / orig_h
    ideal_h = math.sqrt(target_pixels / aspect)
    ideal_w = ideal_h * aspect

    new_w = max(multiple_of, int(round(ideal_w / multiple_of)) * multiple_of)
    new_h = max(multiple_of, int(round(ideal_h / multiple_of)) * multiple_of)
    return new_w, new_h


def parse_hex_color(hex_color: str, fallback: Tuple[int, int, int] = (0, 0, 0)) -> Tuple[int, int, int]:
    """Converte string hexadecimal (#RRGGBB) em tupla RGB."""
    s = (hex_color or "").strip().lstrip("#")
    if len(s) == 6:
        try:
            return (int(s[0:2], 16), int(s[2:4], 16), int(s[4:6], 16))
        except ValueError:
            return fallback
    return fallback


def _load_pil_image(image: Union[str, Path, Image.Image]) -> Image.Image:
    if isinstance(image, (str, Path)):
        img_path = Path(image)
        if not img_path.is_file():
            raise FileNotFoundError(f"Imagem de referência não encontrada: {img_path}")
        pil_img = Image.open(img_path)
    elif isinstance(image, Image.Image):
        pil_img = image
    else:
        raise TypeError("`image` deve ser um caminho (str/Path) ou objeto PIL.Image.Image.")
    return ImageOps.exif_transpose(pil_img)


def _flatten_to_rgb(
    pil_img: Image.Image,
    bg_color: Tuple[int, int, int] = (0, 0, 0),
) -> Image.Image:
    """Converte para RGB compondo transparência sobre `bg_color`."""
    if pil_img.mode in ("RGBA", "LA") or (pil_img.mode == "P" and "transparency" in pil_img.info):
        rgba = pil_img.convert("RGBA")
        bg = Image.new("RGB", rgba.size, bg_color)
        bg.paste(rgba, mask=rgba.getchannel("A"))
        return bg
    return pil_img.convert("RGB")


def preprocess_reference_image(
    image: Union[str, Path, Image.Image],
    target_megapixels: float = 1.0,
    multiple_of: int = 16,
    bg_color: Tuple[int, int, int] = (0, 0, 0),
) -> Image.Image:
    """
    Pré-processa a imagem de referência para a arquitetura FLUX.1:
    - Carrega do disco (se caminho) ou usa PIL.Image diretamente.
    - Respeita orientação EXIF e converte para RGB.
    - Redimensiona mantendo o Aspect Ratio original próximo a `target_megapixels`
      (~1 MP = 1024x1024), garantindo largura e altura múltiplos exatos de `multiple_of` (16).
    """
    pil_img = _flatten_to_rgb(_load_pil_image(image), bg_color=bg_color)
    orig_w, orig_h = pil_img.size
    new_w, new_h = compute_target_dimensions_multiple_of_16(
        orig_w,
        orig_h,
        target_megapixels=target_megapixels,
        multiple_of=multiple_of,
    )

    if (new_w, new_h) != (orig_w, orig_h):
        logger.info(
            "Redimensionando referência de %dx%d -> %dx%d (múltiplo de %d, ~%.2f MP)",
            orig_w,
            orig_h,
            new_w,
            new_h,
            multiple_of,
            (new_w * new_h) / 1_000_000,
        )
        pil_img = pil_img.resize((new_w, new_h), Image.Resampling.LANCZOS)

    return pil_img


def build_side_by_side_collage(
    left_image: Union[str, Path, Image.Image],
    reference_images: Sequence[Union[str, Path, Image.Image]] = (),
    gap_px: int = 4,
    bg_color: Tuple[int, int, int] = (0, 0, 0),
    max_references: int = 6,
) -> Image.Image:
    """
    Concatena a imagem original (segmento de rosto à esquerda) com até 6 imagens de
    referência lado a lado em um único canvas PIL.Image para contexto espacial no FLUX.1.
    """
    if len(reference_images) > max_references:
        raise ValueError(f"Máximo de {max_references} imagens de referência suportadas (recebido: {len(reference_images)}).")

    left_rgb = _flatten_to_rgb(_load_pil_image(left_image), bg_color=bg_color)
    ref_rgbs = [_flatten_to_rgb(_load_pil_image(r), bg_color=bg_color) for r in reference_images]

    # Normaliza todas as imagens para uma altura comum, preservando a nitidez da esquerda
    panel_h = max(256, min(1024, left_rgb.height))
    panels: list[Image.Image] = []
    for img in [left_rgb, *ref_rgbs]:
        w, h = img.size
        if h != panel_h:
            scaled_w = max(16, int(round(w * (panel_h / max(1, h)))))
            panels.append(img.resize((scaled_w, panel_h), Image.Resampling.LANCZOS))
        else:
            panels.append(img)

    safe_gap = max(0, int(gap_px))
    total_w = sum(p.width for p in panels) + safe_gap * max(0, len(panels) - 1)
    canvas = Image.new("RGB", (total_w, panel_h), bg_color)

    cursor_x = 0
    for p in panels:
        canvas.paste(p, (cursor_x, 0))
        cursor_x += p.width + safe_gap

    return canvas


def adapt_prompt_for_collage(
    base_prompt: str,
    num_references: int,
    is_reference_hair: bool = False,
    max_chars_for_flux: int = 1800,
) -> str:
    """
    Adapta um prompt .txt da raiz do projeto (`prompt_original_hair.txt` ou
    `prompt_reference_hair.txt`) para o formato de colagem horizontal lado a lado:
    painel mais à esquerda = imagem original; painéis à direita = referências.

    Nota: O encoder T5-XXL do FLUX.1 trunca prompts acima de 512 tokens. Quando
    `base_prompt` excede `max_chars_for_flux`, gera uma versão concisa (< 512 tokens)
    preservando todas as regras críticas sem truncar o final.
    """
    total_panels = 1 + max(0, int(num_references))
    hair_rule = (
        "Replace BOTH facial identity AND hairstyle using the reference panel(s) to the right; "
        "do NOT keep the original hairstyle."
        if is_reference_hair
        else "Replace ONLY the facial identity using the reference panel(s) to the right; "
        "STRICTLY PRESERVE the exact original hairstyle, hairline, length, volume, and color from the leftmost panel."
    )

    if num_references <= 0:
        layout_header = (
            "EDITING TASK: Refine the isolated AI avatar face segment in this image.\n"
        )
    elif num_references == 1:
        layout_header = (
            "SPATIAL LAYOUT (2-PANEL HORIZONTAL IMAGE): "
            "Left panel = ORIGINAL AI avatar (immutable source). "
            "Right panel = REFERENCE AI avatar.\n"
        )
    else:
        layout_header = (
            f"SPATIAL LAYOUT ({total_panels}-PANEL HORIZONTAL IMAGE): "
            "Leftmost panel (Panel 1) = ORIGINAL AI avatar (immutable source). "
            f"Panels 2..{total_panels} to the right = {num_references} REFERENCE AI avatar views.\n"
        )

    raw = (base_prompt or "").strip()
    if len(raw) > max_chars_for_flux:
        return (
            f"{layout_header}\n"
            f"1. IDENTITY & HAIR: {hair_rule} "
            "Reproduce the reference avatar's face shape, eyes, eyebrows, nose, lips, jawline, and skin tone accurately, "
            "naturally adapted to the leftmost panel's head pose, expression, perspective, lighting, and rendering style.\n"
            "2. STRICT PRESERVATION: Keep everything else in the leftmost panel pixel-identical — "
            "neck, shoulders, body, clothing, background, lighting, shadows, and exact cut-off silhouettes. "
            "Black or transparent cut-off regions must remain solid black/untouched; never invent or complete missing areas.\n"
            "3. OUTPUT FORMAT: Generate ONLY the single final edited portrait corresponding to the LEFTMOST PANEL. "
            "Do NOT output a side-by-side grid, split panels, or include the reference panels in the output."
        )

    adapted = raw
    replacements = [
        (r"\bin the \*\*first image\*\*", "in the **leftmost panel (original image)**"),
        (r"\bin the first image\b", "in the leftmost panel (original image)"),
        (r"\bfrom the original/first image\b", "from the leftmost panel (original image)"),
        (r"\bthe original/first image\b", "the leftmost panel (original image)"),
        (r"\bThe \*\*first image\*\*", "The **leftmost panel (original image)**"),
        (r"\bto the first image\b", "to the leftmost panel (original image)"),
        (r"\bfrom the first image\b", "from the leftmost panel (original image)"),
        (r"\bthe first image\b", lambda m: ("The" if m.group(0)[0].isupper() else "the") + " leftmost panel (original image)"),
        (r"\bprovided reference images\b", "reference panel(s) placed to the right of the leftmost panel"),
        (r"\ball provided reference images\b", "all reference panels placed to the right of the leftmost panel"),
        (r"\bfrom the reference images\b", "from the reference panels to the right"),
        (r"\bthe reference images\b", lambda m: ("The" if m.group(0)[0].isupper() else "the") + " reference panels to the right"),
    ]
    for pattern, repl in replacements:
        adapted = re.sub(pattern, repl, adapted, flags=re.IGNORECASE)

    output_footer = (
        "\n\nCRITICAL OUTPUT FORMAT FOR CONCATENATED CANVAS:\n"
        "- Generate ONLY the single final edited result corresponding to the LEFTMOST PANEL.\n"
        "- Do NOT output a side-by-side grid, split panels, or concatenate the reference panels into the final output.\n"
        "- Maintain the exact framing, scale, pose, cut-off boundaries, and black/transparent background regions of the leftmost panel."
    )
    return f"{layout_header}\n{adapted}{output_footer}"


class FluxImageGenerator:
    """
    Gerador local Image-to-Image / Edição Contextual para modelos FLUX.1,
    projetado para operar dentro do limite de 16 GB de VRAM (RTX A4000).
    """

    def __init__(
        self,
        model_id: str = "black-forest-labs/FLUX.1-dev",
        use_8bit_quantization: bool = False,
        device: str = "cuda",
        dtype: torch.dtype = torch.bfloat16,
        hf_token: Optional[str] = None,
        quantization_mode: str = "4bit",
    ) -> None:
        load_dotenv()

        self.model_id = model_id
        self.use_8bit_quantization = use_8bit_quantization
        self.quantization_mode = (quantization_mode or "4bit").lower()
        self.device = device if (device == "cpu" or torch.cuda.is_available()) else "cpu"
        self.dtype = dtype if self.device == "cuda" else torch.float32
        self.hf_token = hf_token or os.getenv("HF_TOKEN") or None
        self.pipe: Optional[Any] = None

        if self.device == "cpu":
            logger.warning("CUDA não disponível; executando em CPU (muito lento).")
        elif self.use_8bit_quantization and self.device == "cuda":
            logger.info("Modo quantização %s (bitsandbytes) ativado para o Transformer.", self.quantization_mode)

        self._validate_auth()
        self._load_pipeline()

    @property
    def is_kontext(self) -> bool:
        """Indica se o modelo selecionado usa a arquitetura FLUX.1-Kontext."""
        return "kontext" in self.model_id.lower()

    @property
    def is_schnell(self) -> bool:
        """Indica se o modelo selecionado é a variante destilada FLUX.1-schnell."""
        return "schnell" in self.model_id.lower()

    def _validate_auth(self) -> None:
        """Verifica se há token Hugging Face quando o modelo selecionado é gated."""
        if any(g.lower() == self.model_id.lower() for g in GATED_MODELS) and not self.hf_token:
            raise EnvironmentError(
                f"O modelo '{self.model_id}' exige autenticação no Hugging Face.\n"
                "1. Crie um arquivo '.env' na raiz do projeto (veja '.env.example').\n"
                "2. Defina HF_TOKEN=hf_...\n"
                "3. Aceite a licença na página do modelo no Hugging Face.\n"
                "Alternativamente, use 'black-forest-labs/FLUX.1-schnell' sem token."
            )

    def _load_pipeline(self) -> None:
        """Carrega o pipeline Diffusers aplicando todas as otimizações de VRAM."""
        from diffusers import FluxImg2ImgPipeline, FluxTransformer2DModel

        clear_vram()
        logger.info("Carregando modelo '%s' em %s...", self.model_id, self.dtype)

        pipeline_cls: Any = FluxImg2ImgPipeline
        if self.is_kontext:
            try:
                from diffusers import FluxKontextPipeline

                pipeline_cls = FluxKontextPipeline
            except ImportError as exc:
                raise ImportError(
                    "FluxKontextPipeline não encontrado nesta versão do `diffusers`. "
                    "Atualize com: pip install -U diffusers>=0.34.0"
                ) from exc

        load_kwargs: dict[str, Any] = {
            "torch_dtype": self.dtype,
        }
        if self.hf_token:
            load_kwargs["token"] = self.hf_token

        if self.use_8bit_quantization:
            if self.device != "cuda":
                raise RuntimeError("Quantização 8-bit via bitsandbytes requer GPU CUDA.")
            try:
                from diffusers import BitsAndBytesConfig as DiffusersBitsAndBytesConfig
            except ImportError as exc:
                raise ImportError(
                    "BitsAndBytesConfig do diffusers não disponível. "
                    "Instale `bitsandbytes` e atualize `diffusers>=0.32.1`."
                ) from exc

            if self.quantization_mode == "4bit":
                bnb_config = DiffusersBitsAndBytesConfig(
                    load_in_4bit=True,
                    bnb_4bit_quant_type="nf4",
                    bnb_4bit_compute_dtype=self.dtype,
                )
            else:
                bnb_config = DiffusersBitsAndBytesConfig(load_in_8bit=True)
            transformer = FluxTransformer2DModel.from_pretrained(
                self.model_id,
                subfolder="transformer",
                quantization_config=bnb_config,
                torch_dtype=self.dtype,
                token=self.hf_token,
            )
            load_kwargs["transformer"] = transformer

        self.pipe = pipeline_cls.from_pretrained(self.model_id, **load_kwargs)

        # Otimizações obrigatórias para 16 GB VRAM (RTX A4000):
        # Mesmo com Transformer em 8-bit (~12 GB), T5-XXL em BF16 ocupa ~9.5 GB;
        # enable_model_cpu_offload() evita OOM mantendo apenas o módulo ativo na VRAM.
        if self.device == "cuda":
            self.pipe.enable_model_cpu_offload()
        else:
            self.pipe.to("cpu")

        if hasattr(self.pipe, "vae") and self.pipe.vae is not None:
            self.pipe.vae.enable_slicing()
            self.pipe.vae.enable_tiling()

        clear_vram()
        logger.info("Pipeline carregado e otimizado com sucesso.")

    def unload(self) -> None:
        """Libera completamente o pipeline da RAM e VRAM."""
        if self.pipe is not None:
            del self.pipe
            self.pipe = None
        clear_vram()

    def generate(
        self,
        image_path: Union[str, Path, Image.Image],
        prompt: str,
        strength: float = 0.65,
        num_inference_steps: Optional[int] = None,
        guidance_scale: Optional[float] = None,
        seed: Optional[int] = None,
        output_path: Optional[Union[str, Path]] = None,
        target_megapixels: float = 1.0,
        output_width: Optional[int] = None,
        output_height: Optional[int] = None,
    ) -> Image.Image:
        """
        Executa inferência Image-to-Image (ou edição contextual no Kontext).

        Args:
            image_path: Caminho da imagem de referência ou objeto PIL.Image.
            prompt: Prompt textual detalhado guiando a edição.
            strength: Força de alteração [0.0, 1.0] (padrão 0.65; ignorado no Kontext).
            num_inference_steps: Passos de denoising (padrão: 28 para dev/Kontext, 4 para schnell).
            guidance_scale: Escala de orientação (padrão: 3.5 para dev/Kontext, 0.0 para schnell).
            seed: Semente opcional para reprodutibilidade determinística em CPU Generator.
            output_path: Caminho opcional para salvar o PNG resultante.
            target_megapixels: Resolução alvo aproximada antes de alinhar a múltiplos de 16.
            output_width: Largura explícita de saída (múltiplo de 16; usada no Kontext).
            output_height: Altura explícita de saída (múltiplo de 16; usada no Kontext).

        Returns:
            PIL.Image.Image gerada.
        """
        if self.pipe is None:
            raise RuntimeError("Pipeline não está carregado. Instancie FluxImageGenerator novamente.")

        if not (0.0 <= strength <= 1.0):
            raise ValueError(f"`strength` deve estar entre 0.0 e 1.0 (recebido: {strength}).")

        steps = num_inference_steps if num_inference_steps is not None else (4 if self.is_schnell else 28)
        guidance = guidance_scale if guidance_scale is not None else (0.0 if self.is_schnell else 3.5)

        ref_image = preprocess_reference_image(
            image_path,
            target_megapixels=target_megapixels,
            multiple_of=16,
        )
        in_w, in_h = ref_image.size

        if self.is_kontext and output_width and output_height:
            width = max(16, int(round(output_width / 16)) * 16)
            height = max(16, int(round(output_height / 16)) * 16)
        else:
            width, height = in_w, in_h

        generator: Optional[torch.Generator] = None
        if seed is not None:
            generator = torch.Generator("cpu").manual_seed(int(seed))

        clear_vram()
        logger.info(
            "Gerando imagem (entrada=%dx%d, saída=%dx%d) | modelo=%s | steps=%d | guidance=%.2f | seed=%s",
            in_w,
            in_h,
            width,
            height,
            self.model_id,
            steps,
            guidance,
            seed if seed is not None else "aleatória",
        )

        call_kwargs: dict[str, Any] = {
            "image": ref_image,
            "prompt": prompt,
            "width": width,
            "height": height,
            "num_inference_steps": steps,
            "guidance_scale": guidance,
            "generator": generator,
        }

        if self.is_kontext:
            if strength != 0.65:
                logger.info("FLUX.1-Kontext ignora `strength`; usando condicionamento contextual.")
        else:
            call_kwargs["strength"] = float(strength)

        # Filtra argumentos suportados pela assinatura exata do pipeline instalado
        sig = inspect.signature(self.pipe.__call__)
        if not any(p.kind == inspect.Parameter.VAR_KEYWORD for p in sig.parameters.values()):
            call_kwargs = {k: v for k, v in call_kwargs.items() if k in sig.parameters}

        with torch.inference_mode():
            result = self.pipe(**call_kwargs)
            output_image: Image.Image = result.images[0]

        if output_path is not None:
            out_file = Path(output_path)
            out_file.parent.mkdir(parents=True, exist_ok=True)
            output_image.save(out_file, format="PNG")
            logger.info("Imagem salva em: %s", out_file)

        clear_vram()
        return output_image

    def generate_collage(
        self,
        left_image: Union[str, Path, Image.Image],
        reference_images: Sequence[Union[str, Path, Image.Image]],
        prompt: str,
        strength: float = 0.65,
        num_inference_steps: Optional[int] = None,
        guidance_scale: Optional[float] = None,
        seed: Optional[int] = None,
        output_path: Optional[Union[str, Path]] = None,
        target_megapixels: float = 1.0,
        output_size_mode: str = "auto",
        gap_px: int = 4,
        bg_color: str = "#000000",
    ) -> Tuple[Image.Image, Image.Image]:
        """
        Concatena `left_image` (à esquerda) + até 6 `reference_images` (à direita) em
        um canvas PIL e executa `generate()`. Retorna `(output_image, collage_image)`.
        """
        left_pil = _load_pil_image(left_image)
        bg_rgb = parse_hex_color(bg_color)
        collage = build_side_by_side_collage(
            left_pil,
            reference_images=reference_images,
            gap_px=gap_px,
            bg_color=bg_rgb,
        )

        out_w: Optional[int] = None
        out_h: Optional[int] = None
        mode = (output_size_mode or "auto").lower()
        if mode == "auto":
            mode = "left_image" if self.is_kontext else "collage"

        if mode == "left_image":
            out_w, out_h = compute_target_dimensions_multiple_of_16(
                left_pil.width,
                left_pil.height,
                target_megapixels=target_megapixels,
                multiple_of=16,
            )
        elif mode == "square_1024":
            out_w, out_h = 1024, 1024

        result = self.generate(
            image_path=collage,
            prompt=prompt,
            strength=strength,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            seed=seed,
            output_path=output_path,
            target_megapixels=target_megapixels,
            output_width=out_w,
            output_height=out_h,
        )
        return result, collage


def _parse_args(cfg: FluxPipelineConfig) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Pipeline Local Image-to-Image com FLUX.1 (Otimizado para 16GB VRAM)."
    )
    parser.add_argument("--model", default=cfg.model_id, help="ID do modelo no Hugging Face.")
    parser.add_argument("--image", default=cfg.image_path, help="Caminho da imagem de referência.")
    parser.add_argument("--output", default=cfg.output_path, help="Caminho do PNG de saída.")
    parser.add_argument("--prompt", default=None, help="Prompt de texto (sobrescreve config.py).")
    parser.add_argument("--strength", type=float, default=cfg.strength, help="Força [0.0 - 1.0].")
    parser.add_argument("--steps", type=int, default=cfg.num_inference_steps, help="Passos de inferência.")
    parser.add_argument("--guidance", type=float, default=cfg.guidance_scale, help="Guidance scale.")
    parser.add_argument("--seed", type=int, default=cfg.seed, help="Seed de reprodutibilidade.")
    parser.add_argument(
        "--8bit",
        dest="use_8bit",
        action="store_true",
        default=cfg.use_8bit_quantization,
        help="Carrega o Transformer em 8-bit via bitsandbytes.",
    )
    return parser.parse_args()


def main() -> None:
    cfg = DEFAULT_CONFIG
    args = _parse_args(cfg)
    prompt_text = args.prompt if args.prompt is not None else cfg.resolve_prompt()

    generator = FluxImageGenerator(
        model_id=args.model,
        use_8bit_quantization=args.use_8bit,
        device=cfg.device,
    )
    try:
        generator.generate(
            image_path=args.image,
            prompt=prompt_text,
            strength=args.strength,
            num_inference_steps=args.steps,
            guidance_scale=args.guidance,
            seed=args.seed,
            output_path=args.output,
            target_megapixels=cfg.target_megapixels,
        )
    finally:
        generator.unload()


if __name__ == "__main__":
    main()
