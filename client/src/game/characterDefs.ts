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

/** De onde recortar uma animação: linha de quadros, colunas e espelhamento. */
export interface SheetSlice {
  row: number;
  cols: readonly number[];
  /** a sheet não tem esse lado desenhado; usar o oposto espelhado */
  mirror?: boolean;
}

export interface CharacterDef {
  /** sheet da caminhada (no LimeZu, a sheet mestre com tudo) */
  sheet: string;
  /** sheet do idle, quando está num arquivo separado (caso do Protótipo) */
  idleSheet?: string;
  shadowSheet?: string;
  frameW: number;
  frameH: number;
  scale: number;
  /** fração da altura do quadro onde ficam os pés (ponto de ancoragem) */
  anchorY: number;
  /** y do nome, em px de tela, relativo ao centro lógico do avatar */
  labelY: number;
  idleFrameS: number;
  walkFrameS: number;
  idle: Record<Facing, SheetSlice>;
  walk: Record<Facing, SheetSlice>;
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
 * (respiração), 2 = corrida, 3 a 5 = sentar, 6 = telefone. Só 1 e 2 são usadas
 * hoje; as de sentar ficam para um eventual "sentar na cadeira".
 *
 * A ordem das direções dentro de cada linha foi MEDIDA, não suposta: varredura
 * de pixels de pele quadro a quadro, olhando quantidade e centro de massa
 * horizontal. O de frente tem 67 px de pele centrados, o de costas só 6, e os
 * perfis têm 45 deslocados para o lado em que o personagem olha (centro em 8,6
 * à direita contra 6,4 à esquerda). Resultado abaixo. A medição foi feita de
 * propósito: foi supor a ordem que gerou o bug de lado invertido no Protótipo.
 */
const LIMEZU_COL: Record<Facing, number> = { right: 0, up: 6, left: 12, down: 18 };
const LIMEZU_FRAMES = 6;

function limezuDef(id: string): CharacterDef {
  const sheet = `/characters/${id}.png`;
  const dirs = (row: number) =>
    byFacing<SheetSlice>((f) => ({ row, cols: seq(LIMEZU_COL[f], LIMEZU_FRAMES) }));

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
    idle: dirs(1),
    walk: dirs(2),
    // miniatura: quadro de frente (coluna 18) da linha do idle animado,
    // cortando o vazio acima da cabeça
    preview: { sheet, x: LIMEZU_COL.down * 16, y: 32 + 8, w: 16, h: 24, zoom: 3 },
  };
}

/**
 * Prototype_Character — quadros de 32x32 em 3 linhas (baixo, lado, cima), com
 * 2 quadros de idle e 4 de caminhada, em PNGs separados. A linha "lado" olha
 * para a DIREITA, então a esquerda é ela espelhada: era o que a antiga
 * constante SHEET_SIDE_FACES_LEFT dizia, e agora é dado.
 */
const PROTO_ROW: Record<Facing, { row: number; mirror?: boolean }> = {
  down: { row: 0 },
  right: { row: 1 },
  left: { row: 1, mirror: true },
  up: { row: 2 },
};

const protoSlices = (count: number) =>
  byFacing<SheetSlice>((f) => ({ ...PROTO_ROW[f], cols: seq(0, count) }));

const PROTO_DEF: CharacterDef = {
  sheet: '/characters/default/walk.png',
  idleSheet: '/characters/default/idle.png',
  shadowSheet: '/characters/default/shadow.png',
  frameW: 32,
  frameH: 32,
  scale: 1.5,
  anchorY: 30 / 32,
  labelY: FEET_Y - 32 * 1.5 - 4,
  idleFrameS: 0.45,
  walkFrameS: 0.12,
  idle: protoSlices(2),
  walk: protoSlices(4),
  // a arte dele ocupa só 12x14 no meio do quadro de 32x32, então o recorte é
  // colado nela e a ampliação é maior, para o cartão não ficar menor que os outros
  preview: { sheet: '/characters/default/idle.png', x: 10, y: 9, w: 12, h: 14, zoom: 5 },
};

export const CHARACTER_DEFS: Record<CharacterId, CharacterDef> = {
  adam: limezuDef('adam'),
  alex: limezuDef('alex'),
  amelia: limezuDef('amelia'),
  bob: limezuDef('bob'),
  proto: PROTO_DEF,
};

/** Recorte da miniatura, para a tela de entrada não saber de layout de PNG. */
export function characterPreview(id: CharacterId): CharacterDef['preview'] {
  return CHARACTER_DEFS[id].preview;
}
