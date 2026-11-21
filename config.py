"""
Arquivo de configuração editável para o pipeline local FLUX.1 Image-to-Image.
Edite os valores abaixo conforme sua necessidade antes de rodar `python flux_img2img.py`.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class FluxPipelineConfig:
    """Configurações principais de modelo, memória e inferência."""

    # -------------------------------------------------------------------------
    # 1. Modelo FLUX.1
    # Opções suportadas:
    #   - "black-forest-labs/FLUX.1-dev"          (Img2Img alta qualidade; exige HF_TOKEN)
    #   - "black-forest-labs/FLUX.1-Kontext-dev"  (Edição contextual; exige HF_TOKEN + diffusers recente)
    #   - "black-forest-labs/FLUX.1-schnell"      (Rápido em 4 passos; Apache 2.0, sem token)
    # -------------------------------------------------------------------------
    model_id: str = "black-forest-labs/FLUX.1-Kontext-dev"

    # -------------------------------------------------------------------------
    # 2. Gerenciamento de VRAM (RTX A4000 - 16 GB)
    # -------------------------------------------------------------------------
    # True: Quantiza o FluxTransformer2DModel via bitsandbytes para caber nos 16 GB
    #       sem paginar na RAM (evita lentidão extrema de ~140s/it do BF16 de 24 GB).
    # False: Carrega tudo em bfloat16 puro (~24 GB -> faz swap pela RAM na 16 GB).
    use_8bit_quantization: bool = True

    # Tipo de quantização quando `use_8bit_quantization = True`:
    #   - "4bit": NF4 (~6.5 GB VRAM) — mais rápido e seguro em 16 GB com colagens grandes
    #   - "8bit": INT8 (~12 GB VRAM) — máxima fidelidade mantendo na VRAM
    quantization_mode: str = "4bit"

    # Dispositivo alvo
    device: str = "cuda"

    # -------------------------------------------------------------------------
    # 3. Entradas e Saídas (Integração com a pasta data/ do Split & Merge Studio)
    # -------------------------------------------------------------------------
    image_path: str = "data/1/imagemMerge.png"
    output_path: str = "data/1/flux_refined.png"

    # Arquivo de prompt opcional (se definido e existir, sobrescreve `prompt` abaixo)
    # Ex.: "prompt_original_hair.txt" ou "prompt_reference_hair.txt"
    prompt_file: Optional[str] = None

    # Prompt de texto usado quando `prompt_file` for None
    prompt: str = "Seamless photorealistic facial integration preserving original body, hair, clothing, lighting, and background pixel-for-pixel."

    # -------------------------------------------------------------------------
    # 4. Parâmetros de Inferência
    # -------------------------------------------------------------------------
    # Força da alteração em relação à imagem de referência (0.0 a 1.0).
    # Valores entre 0.35 e 0.65 preservam melhor a estrutura original.
    # Nota: Ignorado pelo FLUX.1-Kontext-dev (que usa condicionamento contextual).
    strength: float = 0.65

    # Se None, usa automaticamente: 28 para FLUX.1-dev / Kontext, 4 para FLUX.1-schnell
    num_inference_steps: Optional[int] = None

    # Se None, usa automaticamente: 3.5 para FLUX.1-dev / Kontext, 0.0 para FLUX.1-schnell
    guidance_scale: Optional[float] = None

    # Seed para reprodutibilidade (defina um inteiro como 42, ou None para aleatório)
    seed: Optional[int] = 42

    # Resolução alvo aproximada (~1 megapixel = 1024*1024), ajustada em múltiplos de 16
    target_megapixels: float = 1.0

    # -------------------------------------------------------------------------
    # 5. Colagem Contextual (Lado a Lado) para WebApp & FLUX.1-Kontext
    # -------------------------------------------------------------------------
    # Modo de resolução de saída:
    #   - "auto"       : usa proporção da imagem esquerda no Kontext, ou da colagem no Dev/Schnell
    #   - "left_image" : força saída na proporção da imagem mais à esquerda (ideal p/ Kontext)
    #   - "collage"    : mantém proporção da colagem completa
    #   - "square_1024": força 1024x1024
    output_size_mode: str = "left_image"

    # Espaçamento (em px) e cor de fundo da colagem / transparência
    collage_gap_px: int = 4
    collage_bg_color: str = "#000000"#000000"#000000"#000000"#000000"

    def resolve_prompt(self) -> str:
        """Retorna o texto do prompt a partir de `prompt_file` (se válido) ou `prompt`."""
        if self.prompt_file:
            p = Path(self.prompt_file)
            if p.is_file():
                content = p.read_text(encoding="utf-8").strip()
                if content:
                    return content
        return self.prompt


# Instância padrão importada por flux_img2img.py
DEFAULT_CONFIG = FluxPipelineConfig()
