# Tarefa: Implementar Pipeline Local de Geração Image-to-Image com FLUX.1 (Otimizado para 16GB VRAM)

## 1. Contexto e Hardware
Preciso de um módulo/script em Python modular e pronto para produção que realize geração de imagens guiada por imagem de referência + prompt de texto (Image-to-Image / Edição contextual) rodando 100% localmente.
- **GPU Alvo:** NVIDIA RTX A4000 (16 GB de VRAM, arquitetura Ampere, suporte nativo a `bfloat16`).
- **Restrição Crítica:** Os modelos da família FLUX.1 possuem ~12 bilhões de parâmetros (~24 GB em BF16 puro). O código DEVE implementar gerenciamento estrito de VRAM para evitar erros de `CUDA Out of Memory (OOM)`.

## 2. Stack Tecnológica e Dependências
Crie um arquivo `requirements.txt` (ou configuração de ambiente) e instruções de instalação contendo:
- `torch` e `torchvision` (com suporte a CUDA).
- `diffusers>=0.30.0`, `transformers`, `accelerate`, `sentencepiece`, `protobuf`, `peft`, `pillow`, `python-dotenv`.
- Opcional/Recomendado para caber com folga na VRAM: `bitsandbytes` ou `optimum-quanto` (para quantização NF4/INT8 do Transformer e T5).

## 3. Requisitos de Arquitetura do Código
Estruture uma classe `FluxImageGenerator` em Python com os seguintes recursos:

1. **Suporte aos Modelos FLUX:**
   - Deve permitir alternar facilmente via parâmetro entre:
     - `black-forest-labs/FLUX.1-dev` ou `black-forest-labs/FLUX.1-Kontext-dev` (usando `FluxImg2ImgPipeline` ou `FluxKontextPipeline` do `diffusers`).
     - `black-forest-labs/FLUX.1-schnell` (fallback rápido que não exige token/aprovação e roda em 4 passos).
   - Autenticação automática via variável de ambiente `HF_TOKEN` (usando `.env`).

2. **Otimizações Obrigatórias de Memória (16GB VRAM):**
   - Carregar os pesos em `torch.bfloat16`.
   - Ativar `pipe.enable_model_cpu_offload()` (para mover T5, CLIP, Transformer e VAE entre RAM e VRAM sob demanda).
   - Ativar `pipe.vae.enable_slicing()` e `pipe.vae.enable_tiling()` para evitar picos de VRAM na decodificação de imagens em alta resolução (1024x1024+).
   - Implementar uma flag opcional `use_8bit_quantization: bool = False` que usa `BitsAndBytesConfig` (ou `diffusers` TorchAO/Quanto) para carregar o `FluxTransformer2DModel` em 8-bit/4-bit caso eu queira manter o modelo inteiro residente na VRAM sem offload lento.
   - Limpeza explícita de cache (`gc.collect()` e `torch.cuda.empty_cache()`) quando necessário.

3. **Pré-processamento Inteligente da Imagem de Referência:**
   - Criar uma função utilitária que receba o caminho da imagem (ou objeto `PIL.Image`), converta para RGB e redimensione mantendo o Aspect Ratio original, garantindo que tanto a largura quanto a altura sejam **múltiplos exatos de 16** (requisito da arquitetura FLUX), próximo à resolução de 1 megapixel (ex: 1024x1024, 1280x768, 768x1280).

4. **Método de Inferência Parametrizado (`generate`):**
   - Parâmetros aceitos:
     - `image_path` (caminho da imagem de referência)
     - `prompt` (string detalhada)
     - `strength` (float entre 0.0 e 1.0, padrão `0.65`)
     - `num_inference_steps` (int, padrão `28` para dev / `4` para schnell)
     - `guidance_scale` (float, padrão `3.5`)
     - `seed` (int opcional para reprodutibilidade via `torch.Generator("cpu").manual_seed(seed)`)
     - `output_path` (caminho para salvar o PNG gerado)


## 4. Entregáveis Esperados
2. O código completo, tipado (Type Hints) e comentado em `flux_img2img.py`.
3. arquivo de config que o usuario edita o necessário.

reestruture o projeto deacordo
solicite o que for necessário do usuário
use todo seu conhecimento, não erre