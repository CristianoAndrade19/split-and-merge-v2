# Split & Merge Studio (v2)

Estúdio web, desktop e mobile leve para **corte de precisão com lupa, alinhamento anatômico, fusão Corpo + Face e harmonização perceptual de pele**, sem dependências de build, Node.js ou backend Python.

O fluxo resolve o problema clássico de troca facial: isola a área necessária mantendo o corpo, roupas e enquadramento intactos, permite ajustar manualmente ou por calibrador de pupilas (IPD), realiza a união com blending multi-banda / Poisson / CIE L\*a\*b\* e iguala automaticamente o tom de pele ao redor das bordas em espaço **Oklab**.

---

## Como Executar

### 1. Servidor Local via PowerShell (PC + Rede Wi-Fi Local para Celular)
- Execute `abrir_app.bat` ou rode:
  ```powershell
  powershell -NoProfile -ExecutionPolicy Bypass -File .\server.ps1
  ```
- O `server.ps1` sobe na porta `8765` (ou próxima livre até `+30`), exibe a URL local (`http://127.0.0.1:8765/`) e a URL na rede Wi-Fi para testar diretamente no celular (iPhone / Android), além de disponibilizar a API `/api/*` de salvamento na pasta `data/`.

### 2. Executável Standalone (Windows)
- `SplitAndMergeStudio.exe` (compilado via `build_exe.ps1` a partir de `launcher/Program.cs`).
- Mantém ícone na bandeja e abre em janela dedicada. *(Recompile via `powershell -File .\build_exe.ps1` caso altere `index.html`, `css/` ou `js/` e queira atualizar o `.exe`.)*

### 3. Web Estática (GitHub Pages)
- Funciona 100% no navegador via `<script defer>` (sem módulos ES obrigatórios e sem servidor backend).

---

## Recursos & Pipeline de 6 Etapas

1. **`imagem1 • Corpo`**
   - Importação via arquivo, arrastar/soltar, `Ctrl+V` ou projeto de demonstração (`✨ Exemplo`).
   - Recorte por **linha cruzando 2 bordas**, **laço fechado** ou modal **Auto Selecionar com Rosto Isolado**.
   - **Modo Alta Precisão com Lupa (`🔍 Precisão Lupa`)**: amplia o ponto de corte em lupa circular com sensibilidade reduzida, permite **soltar o dedo, dar zoom/pan com 2 dedos e continuar exatamente de onde parou**, e inclui **`↩ Desfazer`** por segmento ou seleção anterior.

2. **`imagem2 • Face`**
   - Padding transparente automático para compatibilizar com a base de `imagem1`.
   - Controles manuais livres de digitação numérica (`Escala`, `Rotação`, `Posição X/Y`), *onion skin*, guias anatômicas, *flicker* A/B e **Calibrador IPD (Olhos)**.

3. **`imagemMerge • Bordas`**
   - Une `corpo1` + `face2` e define a região de transição por **expansão EDT** ou **corte customizado** (também compatível com Lupa de Precisão + Desfazer).

4. **`IA → Bordas Precisas`**
   - Recebe o retorno refinado (`full` ou `cropbox`) e isola a face refinada com ajuste fino.

5. **`imagemFinal`**
   - Combina face refinada + corpo usando `js/seamMerge.js` (`none`, `feather`, `multiband`, `poisson`, `lab_skin`, `luma_chroma`, `edge_aware`) com comparadores *split-screen*.

6. **`Pós • Tom de Pele & Bordas Consistentes`**
   - Motor Oklab / CIE L\*a\*b\* (`js/skinMatch.js`) com transporte ótimo, curvas CDF, melanina × hemoglobina, zonas LGG e **Harmonização Espacial Bilateral nas Bordas (`harmonizeBorderSkinOklab`)**, garantindo transição natural sem degraus de cor entre face e corpo preservando textura/poros.
   - Exportação otimizada no **iPhone / iOS** via *Web Share Sheet* nativo inline (`navigator.share` síncrono no toque) para guardar com 1 toque em **"Salvar Imagem"** direto na Fototeca sem abrir nova aba.

---

## Abas **Histórico**, **Configurações** & Temas

- **7 Temas Preto + Cor Principal**: `Preto + Ciano`, `Preto + Esmeralda`, `Preto + Violeta`, `Preto + Carmesim`, `Preto + Âmbar`, `Preto + Magenta` e `Preto + Prata`.
- **Histórico em Disco (`IndexedDB`)**: salva automaticamente projetos **em andamento** e **finalizados** com miniaturas leves; as imagens completas só são lidas do disco sob demanda ao reabrir ou exportar.
- **Lazy Pipeline & Limpeza GPU**: evita recomputar etapas posteriores durante arrastes ao vivo e libera canvas substituídos (`width = height = 0`) para uso contínuo sem travamentos.

---

## Estrutura do Projeto

```text
split-and-merge-v2/
├── index.html                  # Shell do Estúdio, abas Histórico/Config e modais
├── jsconfig.json               # Configuração checkJs para JSDoc
├── abrir_app.bat               # Atalho Windows para iniciar server.ps1
├── server.ps1                  # Servidor HTTP local + API para pasta /data
├── build_exe.ps1               # Compilador do SplitAndMergeStudio.exe
├── prompt_original_hair.txt    # Prompt (cabelo original)
├── prompt_reference_hair.txt   # Prompt (cabelo referência)
├── css/
│   └── styles.css              # Temas Preto+Cor, anti-seleção iOS e layout responsivo
├── js/
│   ├── types.js                # Definições JSDoc compartilhadas
│   ├── geometry.js             # Cortes, laço, EDT 2D e alinhamento IPD
│   ├── imageOps.js             # Carga/exportação, iOS share síncrono e releaseCanvas
│   ├── seamMerge.js            # Blending avançado (Feather, Multiband, Poisson, LAB)
│   ├── skinMatch.js            # Pós-processamento Oklab, CIEDE2000 e harmonia de bordas
│   ├── viewport.js             # Canvas interativo, pattern cache, Lupa de Precisão e Undo
│   ├── prompts.js              # Prompts embutidos
│   ├── storage.js              # Persistência em disco via IndexedDB (Config e Histórico)
│   └── app.js                  # Orquestração lazy, abas Estúdio/Histórico/Config
├── launcher/
│   └── Program.cs              # Launcher WinForms opcional
└── data/                       # Pasta padrão para salvar imagens via API local
```
