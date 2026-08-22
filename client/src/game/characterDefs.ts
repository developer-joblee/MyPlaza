/**
 * Onde mora todo o conhecimento de layout da grade de personagem do LimeZu
 * (Modern Interiors FULL, Character Generator).
 *
 * É só dado — nada de PixiJS aqui — para que a tela de entrada possa desenhar
 * o preview (canvas 2D) sem arrastar o renderizador. Quem transforma isto em
 * texturas é `sprites.ts`; quem monta a spritesheet de uma aparência é
 * `composeCharacter.ts`. Desde o gerador por camadas há UMA geometria só:
 * todas as camadas (e as sheets premade) compartilham a mesma grade.
 */

export type Facing = 'down' | 'left' | 'right' | 'up';

/** Direções em que existe arte de sentar (o pack só tem perfil). */
export type SitFacing = 'left' | 'right';

/** De onde recortar uma animação: linha da grade e índices de coluna. */
export interface SheetSlice {
  row: number;
  cols: readonly number[];
}

export interface CharacterDef {
  frameW: number;
  frameH: number;
  scale: number;
  /** fração da altura do quadro onde ficam os pés (ponto de ancoragem) */
  anchorY: number;
  /** y do nome, em px de tela, relativo ao centro lógico do avatar */
  labelY: number;
  idleFrameS: number;
  walkFrameS: number;
  sitFrameS: number;
  phoneFrameS: number;
  idle: Record<Facing, SheetSlice>;
  walk: Record<Facing, SheetSlice>;
  sit: Record<SitFacing, SheetSlice>;
  /**
   * Celular (pose de "ausente"), uma direção só (de frente): `phoneIntro` toca
   * uma vez (tirar o celular do bolso) e `phone` fica em loop. A sheet ainda
   * tem dois quadros de "guardar o celular" (colunas 10-11) que NÃO são usados:
   * a saída do ausente é imediata, e uma animação de saída seguraria a pose
   * depois de a pessoa já ter voltado.
   */
  phoneIntro: SheetSlice;
  phone: SheetSlice;
}

const seq = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i);

/** Monta um registro com as quatro direções, sem cast. */
export function byFacing<T>(make: (f: Facing) => T): Record<Facing, T> {
  return { down: make('down'), left: make('left'), right: make('right'), up: make('up') };
}

/** Deslocamento dos pés em relação ao centro lógico; espelha o Avatar. */
const FEET_Y = 14;

/**
 * A grade: quadros de 16x32 em 56 colunas por 20 linhas (sheets de 896x656;
 * os 16px de sobra embaixo são vazios). As linhas, na ordem do guia do pack:
 * 0 idle parado (1 quadro por direção) · 1 idle (respiração) · 2 andar ·
 * 3 dormir · 4 e 5 sentar (duas variantes) · 6 e 7 celular (duas) · 8 carrinho ·
 * 9 pegar · 10 presente · 11 levantar peso · 12 arremessar · 13 e 14 golpes ·
 * 15 esfaquear · 16 a 18 arma · 19 machucado.
 *
 * Tudo abaixo foi MEDIDO (varredura de alpha e de pixels de pele, 2026-08-21),
 * não herdado do pack free — ainda que muito tenha coincidido:
 *
 * - A grade é estrita: linha k começa em y = 32k, quadro em x = 16·col. O passo
 *   irregular do sentar do pack free (32px com figura deslocada) NÃO existe
 *   mais — sentar segue a grade como todo o resto.
 * - A ordem das direções nas linhas de 24 quadros é a mesma do free, medida de
 *   novo pelo critério de pele: de frente tem ~192px de pele centrados, de
 *   costas ~24, e os perfis ~104 com centro de massa deslocado para o lado do
 *   olhar (cx 19,2 à direita contra 11,8 à esquerda).
 * - A arte ocupa y9..31 do quadro (pés na borda de baixo), como no free — por
 *   isso âncora, escala e label não mudaram.
 * - A versão "32x32" do pack é esta mesma arte dobrada por vizinho-mais-próximo
 *   (conferido pixel a pixel): não há definição extra, então usamos a 16x16 com
 *   `scale: 2`, como sempre.
 */
const LIMEZU_COL: Record<Facing, number> = { right: 0, up: 6, left: 12, down: 18 };
const LIMEZU_FRAMES = 6;

/**
 * Sentar: linha 4 (a 5 é outra pose; ficou de fora por escolha, não por
 * limitação). Doze quadros na grade normal — colunas 0-5 virado para a
 * DIREITA, 6-11 para a ESQUERDA, medido pela posição do rosto dentro da
 * figura (o mesmo critério das linhas de andar). Continua não existindo
 * sentar de frente nem de costas, e é por isso que só cadeira de perfil é
 * sentável.
 */
const SIT_ROW = 4;
const SIT_COL: Record<SitFacing, number> = { right: 0, left: 6 };

/**
 * Celular: linha 6, de frente, 12 quadros — 0-3 tira o celular do bolso
 * (intro, uma vez), 4-9 mexe nele (loop, é o "4-9 loop" do guia do pack),
 * 10-11 guarda (não usamos; ver `phoneIntro` acima).
 */
const PHONE_ROW = 6;

const dirs = (row: number) =>
  byFacing<SheetSlice>((f) => ({ row, cols: seq(LIMEZU_COL[f], LIMEZU_FRAMES) }));

/** A geometria única de todo avatar (as camadas compartilham a grade). */
export const GENERATOR_DEF: CharacterDef = {
  frameW: 16,
  frameH: 32,
  // 16x32 a 2x = 32x64 na tela: 1 tile de largura e 2 de altura, que é a
  // proporção que a arte pressupõe num mundo de 32px
  scale: 2,
  // a arte ocupa y 9..31 do quadro, ou seja os pés ficam na borda de baixo
  anchorY: 1,
  // topo da cabeça em y=9 => (32-9)*2 = 46px acima dos pés, mais 4 de respiro
  labelY: FEET_Y - 46 - 4,
  idleFrameS: 0.18,
  walkFrameS: 0.1,
  // sentado respira mais devagar que parado de pé
  sitFrameS: 0.24,
  phoneFrameS: 0.16,
  idle: dirs(1),
  walk: dirs(2),
  sit: {
    right: { row: SIT_ROW, cols: seq(SIT_COL.right, LIMEZU_FRAMES) },
    left: { row: SIT_ROW, cols: seq(SIT_COL.left, LIMEZU_FRAMES) },
  },
  phoneIntro: { row: PHONE_ROW, cols: seq(0, 4) },
  phone: { row: PHONE_ROW, cols: seq(4, 6) },
};
