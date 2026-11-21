# Split & Merge Studio (v2)

Estúdio web local para **corte, alinhamento anatômico, fusão Corpo + Face assistida por IA e igualação perceptual de tom de pele**, sem dependências externas de build ou Node.js.

O fluxo resolve o problema clássico de troca de identidade facial em avatares/personagens por IA: em vez de deixar a IA regenerar a imagem inteira (alterando corpo, pose, roupas ou cabelo), o estúdio isola apenas a região necessária, envia um recorte controlado para a IA externa com prompts de preservação estrita de pixels e recompõe o resultado final com blending de bordas e ajuste de cor no espaço Oklab.

---

## Como Executar

### 1. Executável Standalone (Windows)
- Execute `SplitAndMergeStudio.exe` (compilado a partir de `launcher/Program.cs`).
- Ele sobe um servidor HTTP local em `127.0.0.1` com os assets embutidos, abre o app em janela dedicada (Edge/Chrome `--app`), mantém ícone na bandeja do sistema e garante instância única.
- Flags opcionais: `--headless-server` e `--port=<porta>`.

### 2. Servidor Local via PowerShell (Desenvolvimento)
- Execute `abrir_app.bat` ou rode:
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1
  ```
- O `server.ps1` inicia na porta `8765` (ou próxima livre até `+30`), abre o navegador e serve os arquivos do diretório atual diretamente (ideal para editar `index.html`, `css/` e `js/` sem recompilar o `.exe`).

> **Nota:** Os scripts usam `<script defer>` sem ES modules, permitindo também abrir `index.html` via `file://` (exceto as rotas `/api/*` de salvamento em `data/`).

---

## Pipeline de 6 Etapas

1. **`imagem1 • Corpo`**
   - Carregamento por arquivo, arrastar/soltar, `Ctrl+V` ou projeto de demonstração (`✨ Exemplo`).
   - Recorte interativo no canvas por **linha cruzando 2 bordas** ou **laço fechado**, ou via modal **Auto Selecionar com Rosto Isolado** (separa automaticamente usando um PNG com rosto isolado).
   - Definição explícita e reversível de qual lado é **Face** e qual é **Corpo**.

2. **`IA → imagem2 • Face`**
   - Recebe a face de referência/IA e aplica padding transparente automático para compatibilizar com o canvas de `imagem1`.
   - Ajuste manual (`x`, `y`, `scale`, `rotation`), *onion skin*, guias anatômicas, *flicker* e **Calibrador IPD (Alinhamento por Olhos)** clicando nas pupilas esquerda/direita para calcular escala e rotação anatômicas exatas.

3. **`imagemMerge • Bordas`**
   - Une `corpo1` + `face2` em `imgMergeCanvas` e gera a zona de transição (`mergeFaceMask`) por **expansão via Transformada de Distância Euclidiana (EDT)** (`expandPx`) ou **corte customizado**.
   - Exporta `(face + bordas imprecisas)` (quadro inteiro ou recortado na bounding box) para ser refinada na IA externa usando os prompts prontos (`originalHair` ou `referenceHair`).

4. **`IA → Bordas Precisas`**
   - Recebe a imagem retornada pela IA (`imgRefined`), alinha automaticamente em modo `full` ou `cropbox` e extrai `(face + bordas precisas)` pela mesma máscara.

5. **`imagemFinal`**
   - Reúne `(face + bordas precisas)` com `(corpo sem bordas imprecisas)` via `js/seamMerge.js`:
     - `none`: união exata pixel a pixel.
     - `feather`: suavização progressiva por distância EDT.
     - `multiband`: pirâmide Laplaciana multi-banda com extrapolação *pull-push*.
     - `poisson`: *Screened Poisson Blending* na região da máscara.
     - `lab_skin`, `luma_chroma`, `edge_aware`: transferência de cor no colar em CIE L\*a\*b\* e fusão sensível a bordas/luminância.
   - Inclui comparadores *split-screen* contra a versão sem blend, `imagemMerge` e `imagem1`.

6. **`Pós • Tom de Pele`**
   - Igualação perceptual de tom de pele entre Face e Corpo (`js/skinMatch.js`) no espaço **Oklab** com métricas **CIEDE2000** ($\Delta E_{00}$ antes/depois):
     - Métodos: `oklab_ot` (Transporte Ótimo / Monge-Kantorovich), `cdf_curves` (curvas quantílicas por canal), `melanin_hemo` (decomposição melanina/hemoglobina), `zones_lgg` (Lift/Gamma/Gain em 3 zonas) e `spatial_oklab`.
     - Direções: `face_to_body`, `body_to_face` e `mutual`.
     - Proteção de traços (olhos/lábios), equalização de costura (`seamEqualizePx`), ajuste fino (temperatura, matiz, luminosidade, saturação), seletor manual de amostras de pele e mapa de calor da máscara detectada.

---

## Estrutura do Projeto

```text
split-and-merge-v2/
├── index.html                  # Shell da aplicação, toolbar, canvas, sidebar e modais
├── jsconfig.json               # Configuração TypeScript checkJs para JSDoc
├── abrir_app.bat               # Atalho Windows para iniciar server.ps1
├── server.ps1                  # Servidor HTTP local + API para pasta /data
├── SplitAndMergeStudio.exe     # Executável standalone gerado do launcher C#
├── prompt_original_hair.txt    # Prompt de IA (troca facial preservando cabelo original)
├── prompt_reference_hair.txt   # Prompt de IA (troca facial + cabelo da referência)
├── css/
│   └── styles.css              # Tema escuro e layout do estúdio
├── js/
│   ├── types.js                # Definições JSDoc compartilhadas (State, Options, Diagnostics)
│   ├── geometry.js             # Cortes em borda, laço, rasterização, EDT 2D e alinhamento IPD
│   ├── imageOps.js             # Carga/colagem/exportação de imagens, máscaras e demo sintética
│   ├── seamMerge.js            # Blending avançado (Feather, Multiband, Poisson, CIE L*a*b*)
│   ├── skinMatch.js            # Pós-processamento de pele em Oklab e cálculo CIEDE2000
│   ├── viewport.js             # Canvas interativo (pan, zoom, desenho de corte, transformações)
│   ├── prompts.js              # Textos dos prompts embutidos para cópia rápida na UI
│   └── app.js                  # Estado global, orquestração das 6 etapas e renderização da UI
├── launcher/
│   ├── Program.cs              # Launcher WinForms + servidor HTTP + tray icon + heartbeat
│   └── app.ico                 # Ícone do executável
├── flux_img2img.py             # Pipeline local FLUX.1 Image-to-Image / Kontext (16GB VRAM)
├── flux_server.py              # Servidor HTTP unificado do WebApp + API FLUX.1 (/api/flux/*)
├── config.py                   # Configurações editáveis do pipeline FLUX.1
├── requirements.txt            # Dependências Python (PyTorch CUDA, Diffusers, BitsAndBytes)
├── .env.example                # Modelo de variáveis de ambiente (HF_TOKEN)
└── data/                       # Pasta padrão para salvar imagens exportadas via API local
```

---

## Nova Seção no WebApp: `⚡ Colagem FLUX`

Entre a Etapa 1 (`imagem1 • Corpo`) e a Etapa 2 (`IA → imagem2 • Face`), o estúdio agora inclui a seção **Colagem FLUX** voltada para colagem espacial lado a lado (ideal para `FLUX.1-Kontext-dev`, também compatível com `FLUX.1-dev` / `FLUX.1-schnell`):
- **Painel mais à esquerda**: usa automaticamente o **segmento de rosto dividido** na Etapa 1 (`face1Canvas`, com recorte opcional ao bounding box e preenchimento de transparência configurável).
- **Até 6 referências concatenadas à direita**: upload múltiplo, colar com `Ctrl+V` ou arrastar/soltar no canvas, com reordenação (`←`/`→`) e remoção individual.
- **Prompts `.txt` adaptados automaticamente**: carrega `prompt_original_hair.txt` ou `prompt_reference_hair.txt` e adapta o texto para referenciar o painel mais à esquerda como original e os painéis à direita como referências.
- **Editor completo de `config.py` na tela**: subaba **⚙ Config (`config.py`)** permite editar, salvar e recarregar modelo (`FLUX.1-dev`, `FLUX.1-Kontext-dev`, `FLUX.1-schnell`), quantização 8-bit, `strength`, `steps`, `guidance_scale`, `seed`, `target_megapixels`, `output_size_mode`, espaçamento e fundo da colagem.
- **Execução integrada**: `abrir_app.bat` inicia `flux_server.py` (ou `server.ps1` sobe a API Python auxiliar na porta `8766`), e o botão **Gerar com FLUX.1** cria a colagem via `PIL.Image`, executa a inferência na GPU e pode enviar o resultado direto para a Etapa 2 (`imagem2`).

---

## Pipeline Local de IA com FLUX.1 (`flux_img2img.py`)

Módulo Python otimizado para **NVIDIA RTX A4000 (16 GB VRAM, Ampere)**, preparado para gerar/refinar imagens localmente a partir de uma referência e prompt (integrando-se diretamente com as etapas 3 e 4 do Studio via `data/`).

### Instalação
1. Crie e ative um ambiente virtual Python:
   ```powershell
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1
   ```
2. Instale o PyTorch com CUDA (caso ainda não tenha `cu118`/`cu124` no venv) e as dependências:
   ```powershell
   pip install -r requirements.txt
   ```
3. Copie `.env.example` para `.env` e informe seu `HF_TOKEN` (necessário para `FLUX.1-dev` e `FLUX.1-Kontext-dev`; opcional para `FLUX.1-schnell`).

### Configuração e Execução
- Edite `config.py` (`model_id`, `use_8bit_quantization`, `image_path`, `output_path`, `prompt`/`prompt_file`, `strength`, `seed`, etc.).
- Execute via CLI:
  ```powershell
  python flux_img2img.py
  ```
- Ou importe `FluxImageGenerator` e `preprocess_reference_image` em outro script Python.

### Otimizações de 16 GB VRAM Implementadas
- Pesos em `torch.bfloat16` + `pipe.enable_model_cpu_offload()`.
- `pipe.vae.enable_slicing()` e `pipe.vae.enable_tiling()`.
- Flag `use_8bit_quantization` usando `BitsAndBytesConfig` no `FluxTransformer2DModel`.
- Redimensionamento automático mantendo Aspect Ratio em **múltiplos exatos de 16** (~1 MP).
- Limpeza explícita de cache (`gc.collect()` + `torch.cuda.empty_cache()`).

---

## API Local (`/api/*`)

Disponível quando servido por `server.ps1` ou `SplitAndMergeStudio.exe`:
- `GET /api/data-folders` — lista subpastas dentro de `data/` para o seletor **Salvar em** no topo.
- `POST /api/save-image` — grava PNG (enviado em base64 DataURL) em `data/<folder>/<filename>.png`.
- `GET /api/open-data-folder?folder=...` — abre a pasta de destino no Windows Explorer.
- *(Apenas no `SplitAndMergeStudio.exe`)* `/api/ping`, `/api/open`, `/api/heartbeat`, `/api/closed`, `/api/shutdown` para controle de ciclo de vida da janela.

---

## Notas para Próximas Iterações

- **Alterações no frontend (`index.html`, `css/`, `js/`)**: teste imediatamente via `abrir_app.bat` / `server.ps1`. O `SplitAndMergeStudio.exe` embute os assets na compilação — se alterar arquivos web, o `.exe` só refletirá as mudanças após ser recompilado com os novos recursos embutidos.
- **Checagem estática**: o projeto usa `// @ts-check` com `jsconfig.json` (`ES2022`, `checkJs: true`).
- **Diretório auxiliar**: `chrome_test_profile_step2/` é apenas um perfil de navegador usado para testes locais e não faz parte do código da aplicação.
