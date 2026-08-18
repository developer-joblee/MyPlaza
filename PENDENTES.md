# Pendências de verificação — cenário Ruínas

O que **não foi verificado** (ou foi verificado só parcialmente) na montagem do
cenário Ruínas, e itens herdados das mudanças anteriores. Atualizado em 2026-08-18.

## Já verificado (para referência)

- ✅ Typecheck (server + client) limpo.
- ✅ Servidor: join no cenário `ruins` ecoa o id correto, spawn na praça
  central (400, 592), clamp de movimento em 928x1120 (teste de socket real).
- ✅ Grade de colisão: 35 linhas x 29 colunas exatas, flood fill a partir do
  spawn alcança 396/401 células livres — as 5 restantes são bolsões
  decorativos de grama ao redor do altar, inalcançáveis também na cena
  original.
- ✅ Correções já aplicadas após o debug visual: canto sudoeste (cols 1-2,
  linhas 24-30) e célula (22,6) marcados como sólidos (eram fundo cinza);
  tronco da árvore nordeste reduzido a 1 tile para não selar a área atrás dela.
- ✅ Posições dos overlays: 17 de 20 instâncias localizadas por template
  matching (erro médio < 12/canal); estátua, estela RESH e tumba extraídas
  por chroma-key com retângulo conferido visualmente.

## Falta verificar (em ordem de importância)

### 1. Visual in-game do cenário Ruínas
Nunca foi aberto no navegador. Conferir:
- Se o chão (`ground.png`) renderiza nítido (scale mode nearest) e alinhado
  com a grade de colisão.
- Se os 20 props sobrepostos (árvores, estátua, pilares, lanternas, lápides,
  altar, tumba) estão **pixel-perfeitos** sobre a arte do chão — qualquer
  desalinhamento aparece como "fantasma"/borda dupla no sprite.
- Se o y-sort funciona: player deve passar **por trás** de árvores, estátua e
  monumentos e **na frente** deles quando estiver ao sul.

### 2. Colisão fina nas bordas (transcrição manual)
A grade foi transcrita visualmente da imagem — pode haver célula errada em ±1
nas bordas. Conferir andando no jogo, com atenção a:
- **Escadas**: terraço oeste → pátio (cols 3-6, linhas 15-17), plaza da
  estátua (7,11-12), altar (16,4-6), sala leste → cemitério (25-26,16-18),
  corredor sudeste (20-22,20-22), sala sul (5-6,27-30).
- **Lado da árvore nordeste** (21,7): liberado para dar passagem — conferir se
  não permite "pisar" no tronco.
- **Vaso do canto da sala sul** (~4.5, 28.5): pode sobrepor o pé da escada.
- **Coluna vertical (9,4)-(9,8)** entre o terraço nordeste e a plaza da
  estátua: marcada como parede, mas pode ser uma escada na cena original
  (passagem bloqueada que talvez devesse existir).
- **Beiral da fonte/poço** (célula (5,23)): arco noroeste do poço invade um
  pixel a célula livre.
- Usar o mapa de debug: `docs/ruins-colisao-debug.png` (vermelho = sólido,
  verde = livre, azul = spawn).

### 3. Multiplayer no cenário Ruínas
A arquitetura é a mesma dos outros mundos (testada via socket), mas não foi
testado com 2+ navegadores dentro do `ruins`: voz por proximidade, chat,
isolamento em relação a Praça/Escritório.

### 4. Cenário Escritório — visual in-game
Herdado da tarefa anterior: o renderer procedural foi restaurado do git e o
typecheck passou, mas ninguém abriu o Escritório no navegador desde a
restauração (colisão, spawn no lounge, visual).

### 5. Zoom sobre o bitmap grande
O zoom da câmera (0.5x-2.5x) nunca foi testado sobre o chão de imagem única
das Ruínas (928x1120). Conferir nitidez ao aproximar e desempenho ao afastar.

## Observações menores (não bloqueiam)

- `client/public/tiles/paths.png` existe mas nunca é carregado (sobra da
  Praça, pré-existente).
- Os 5 props altos que o matcher não encontrou individualmente (2ª lanterna
  sobre muro, pilares encostados em paredes) ficaram **sem overlay** — o
  player pode cobrir o topo deles ao passar por trás; todos ficam em locais de
  difícil sobreposição (adjacentes a paredes sólidas).
- Licença: Ruínas usa o pack CC0 do Cainos (sem restrição); a Praça continua
  com a restrição **não-comercial** do Sprout Lands (documentado no README).
- As mudanças do cenário Ruínas ainda **não foram commitadas** (17+ arquivos
  modificados/novos no working tree, incluindo os cenários da tarefa
  anterior... conferir `git status`).
