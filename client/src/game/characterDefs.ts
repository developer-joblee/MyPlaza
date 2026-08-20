import type { CharacterId } from '@together/shared';

/**
 * Onde mora todo o conhecimento de layout das spritesheets de personagem.
 *
 * É só dado — nada de PixiJS aqui — para que a tela de entrada possa desenhar
 * as miniaturas sem arrastar o renderizador. Quem transforma isto em texturas é
 * `sprites.ts`.
 *
 * Para adicionar um personagem novo: uma entrada em DEFS e um id em CHARACTERS
 * (no shared). Nenhum outro arquivo muda.
 */

export type Facing = 'down' | 'left' | 'right' | 'up';

/** Direções em que existe arte de sentar (o pack só tem perfil). */
export type SitFacing = 'left' | 'right';

/**
 * De onde recortar uma animação. `cols` são índices de célula, multiplicados
 * por `stride` (que por padrão é a largura do quadro). `offsetX` desloca a
 * figura dentro da célula — existe por causa das poses de sentar, desenhadas
 * fora do canto da célula (ver SIT_* abaixo).
 */
export interface SheetSlice {
  row: number;
  cols: readonly number[];
  stride?: number;
  offsetX?: number;
}

export interface CharacterDef {
  sheet: string;
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
  /** celular: uma direção só (de frente) — ver PHONE_* abaixo */
  phone: SheetSlice;
  /** recorte da miniatura da tela de entrada, em px da PNG original */
  preview: { sheet: string; x: number; y: number; w: number; h: number; zoom: number };
}

const seq = (start: number, count: number) => Array.from({ length: count }, (_, i) => start + i);

/** Monta um registro com as quatro direções, sem cast. */
export function byFacing<T>(make: (f: Facing) => T): Record<Facing, T> {
  return { down: make('down'), left: make('left'), right: make('right'), up: make('up') };
}

/** Deslocamento dos pés em relação ao centro lógico; espelha o Avatar. */
const FEET_Y = 14;

/**
 * LimeZu (Modern Interiors) — quadros de 16x32 numa grade de 24 colunas por 7
 * linhas. As linhas: 0 = idle parado (1 quadro por direção), 1 = idle animado
 * (respiração), 2 = corrida, 3 a 5 = sentar (três variantes), 6 = telefone.
 *
 * A ordem das direções dentro das linhas de andar foi MEDIDA, não suposta:
 * varredura de pixels de pele quadro a quadro, olhando quantidade e centro de
 * massa horizontal. O de frente tem 67 px de pele centrados, o de costas só 6,
 * e os perfis têm 45 deslocados para o lado em que o personagem olha (centro em
 * 8,6 à direita contra 6,4 à esquerda). Resultado abaixo. A medição foi feita de
 * propósito: foi supor a ordem que gerou o bug de lado invertido no antigo
 * Protótipo.
 */
const LIMEZU_COL: Record<Facing, number> = { right: 0, up: 6, left: 12, down: 18 };
const LIMEZU_FRAMES = 6;

/**
 * Sentar (linha 3) — a única linha das três que serve, e ela tem um layout
 * próprio, também medido:
 *
 * - O passo é de **32px**, não 16: o conteúdo se repete a cada duas colunas, o
 *   que dá 12 poses na linha em vez de 24.
 * - A figura tem 16px de largura e fica deslocada dentro da célula: **6px** nos
 *   quadros virados para a direita e **10px** nos virados para a esquerda. Por
 *   isso o recorte é de 16x32 como o resto, em vez de 32x32 — assim a
 *   ancoragem e a escala do Avatar valem sem exceção.
 * - Só existem **duas direções**, e uma é o espelho exato da outra (a figura
 *   ocupa x6..20 numa e x11..25 na outra). Não há sentar de frente nem de
 *   costas em nenhuma das três variantes do pack gratuito, e é por isso que só
 *   cadeira de perfil é sentável.
 * - A direção veio da posição da pele (o rosto): no grupo 1 ela cai na metade
 *   direita da figura, no grupo 2 na esquerda — o mesmo critério que validou a
 *   corrida.
 *
 * O tronco é, pixel a pixel, o mesmo da corrida; muda a parte de baixo, com as
 * pernas juntas. A verticalidade também bate (a figura vai até y30 contra y31
 * da corrida), então os pés continuam na borda de baixo.
 */
const SIT_ROW = 3;
const SIT_STRIDE = 32;
const SIT_OFFSET: Record<SitFacing, number> = { right: 6, left: 10 };
const SIT_CELL: Record<SitFacing, number> = { right: 0, left: 6 };

/**
 * Celular (linha 6) — usado como pose de "ausente". Ao contrário do sentar,
 * esta linha segue a grade normal de 16px e tem **9 quadros** (do 0 ao 8; o
 * resto da linha é vazio), numa **direção só**: de frente. A medição bate com o
 * quadro de frente da caminhada — 64 a 68 px de pele com centro em 7,7, contra
 * 67 e 7,6 do andar para baixo — e o footprint é idêntico (x0..15, y9..31),
 * então o recorte e a ancoragem valem sem ajuste.
 *
 * Como só existe de frente, quem fica ausente aparece virado para a câmera,
 * independentemente de para onde estava olhando. Isso é proposital: ausente é
 * um estado, não uma direção.
 */
const PHONE_ROW = 6;
const PHONE_FRAMES = 9;

function limezuDef(id: string): CharacterDef {
  const sheet = `/characters/${id}.png`;
  const dirs = (row: number) =>
    byFacing<SheetSlice>((f) => ({ row, cols: seq(LIMEZU_COL[f], LIMEZU_FRAMES) }));

  const sitDir = (f: SitFacing): SheetSlice => ({
    row: SIT_ROW,
    cols: seq(SIT_CELL[f], LIMEZU_FRAMES),
    stride: SIT_STRIDE,
    offsetX: SIT_OFFSET[f],
  });

  return {
    sheet,
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
    sit: { left: sitDir('left'), right: sitDir('right') },
    phone: { row: PHONE_ROW, cols: seq(0, PHONE_FRAMES) },
    // miniatura: quadro de frente (coluna 18) da linha do idle animado,
    // cortando o vazio acima da cabeça
    preview: { sheet, x: LIMEZU_COL.down * 16, y: 32 + 8, w: 16, h: 24, zoom: 3 },
  };
}

export const CHARACTER_DEFS: Record<CharacterId, CharacterDef> = {
  adam: limezuDef('adam'),
  alex: limezuDef('alex'),
  amelia: limezuDef('amelia'),
  bob: limezuDef('bob'),
};

/** Recorte da miniatura, para a tela de entrada não saber de layout de PNG. */
export function characterPreview(id: CharacterId): CharacterDef['preview'] {
  return CHARACTER_DEFS[id].preview;
}
