/**
 * Copia as spritesheets de personagem CURADAS do pack pago (assets_temp/, que é
 * gitignored e não sai desta máquina) para `client/public/characters/v2/`.
 *
 * Rodar da raiz: `npm run assets:characters` (ou `node scripts/build-character-assets.mjs`).
 * Exige `assets_temp/moderninteriors-win/` no disco — o pack comprado. Noutra
 * máquina sem o pack, os PNGs já commitados continuam valendo; este script só é
 * necessário para trocar a curadoria.
 *
 * Fonte: Modern Interiors FULL, by LimeZu (https://limezu.itch.io/moderninteriors).
 * Licença do pack completo: uso comercial permitido, crédito obrigatório
 * (seção "Créditos de assets" do README), PROIBIDO redistribuir o asset — por
 * isso só o subconjunto usado entra no repo, e o repo é privado.
 *
 * Usamos a versão 16x16 (quadros de 16x32): a "32x32" do pack é a mesma arte
 * dobrada por vizinho-mais-próximo (verificado pixel a pixel em 2026-08-21),
 * então não há definição extra — só peso. O client desenha a 2x, como sempre.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const PACK = path.join(ROOT, 'assets_temp', 'moderninteriors-win', '2_Characters', 'Character_Generator');
const OUT = path.join(ROOT, 'client', 'public', 'characters', 'v2');

/** Dimensão esperada das sheets 16x16 do gerador (56 colunas × 20 linhas + sobra). */
const SHEET_W = 896;
const SHEET_H = 656;

/**
 * Curadoria do gerador por camadas. Os ids resultantes
 * (`hair_09_05`, `outfit_06_01`...) são PROTOCOLO — vivem em
 * `shared/src/appearance.ts` e no banco (coluna `appearance`). Mudar a
 * curadoria pode ADICIONAR ids; remover um id exige migração de dados.
 * Estilo e cor vêm do nome do arquivo do pack: `Hairstyle_{estilo}_{cor}.png`.
 */
const HAIR_STYLES = ['01', '02', '04', '05', '09', '10', '13', '17', '21', '25'];
const HAIR_COLORS = ['01', '05'];
const OUTFIT_PICKS = [
  ['01', '01'], ['02', '01'], ['03', '01'], ['04', '01'], ['06', '01'],
  ['08', '01'], ['10', '01'], ['13', '01'], ['16', '01'], ['18', '01'],
  ['20', '01'], ['22', '01'], ['24', '01'], ['27', '01'], ['30', '01'],
];

/**
 * Emotes: tiras de 8 quadros de 32x32 (256x32) montadas da
 * `UI_thinking_emotes_animation_32x32.png` do pack — intro de bolha crescendo
 * (linha 1, células 0-5, medida por varredura de alpha em 2026-08-21) + o par
 * do ícone (célula e célula+1). Os ids são os de `EMOTES` no shared.
 * O par de cada ícone está em [linha, coluna] da grade de 32px da sheet.
 */
const EMOTE_SHEET = '4_User_Interface_Elements/UI_thinking_emotes_animation_32x32.png';
const EMOTE_INTRO = { row: 1, cols: [0, 1, 2, 3, 4, 5] };
const EMOTE_ICONS = {
  exclamacao: [5, 0],
  duvida: [5, 2],
  sono: [5, 6],
  musica: [6, 6],
  pensando: [9, 2],
  coracao: [9, 4],
};

function copyChecked(src, dst) {
  const png = PNG.sync.read(fs.readFileSync(src));
  // Os Bodies têm 927px de largura: ~600px de paleta de referência na borda
  // direita (x>=896), fora das colunas usadas (0..23). Largura MAIOR é ok — a
  // composição em canvas de 896px ignora o excesso; menor ou altura diferente
  // é sheet errada.
  if (png.width < SHEET_W || png.height !== SHEET_H) {
    throw new Error(`${path.basename(src)}: ${png.width}x${png.height} — esperado ${SHEET_W}x${SHEET_H} (largura pode exceder)`);
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
  const kb = (fs.statSync(dst).size / 1024).toFixed(0);
  console.log(`  ${path.relative(ROOT, dst)} <- ${path.basename(src)} (${kb} KB)`);
}

if (!fs.existsSync(PACK)) {
  console.error(`assets_temp não encontrado em ${PACK} — este script precisa do pack comprado no disco.`);
  process.exit(1);
}

console.log('camadas do gerador:');
for (let i = 1; i <= 9; i++) {
  const n = String(i).padStart(2, '0');
  copyChecked(path.join(PACK, 'Bodies', '16x16', `Body_${n}.png`), path.join(OUT, 'body', `body_${n}.png`));
}
for (let i = 1; i <= 7; i++) {
  const n = String(i).padStart(2, '0');
  copyChecked(path.join(PACK, 'Eyes', '16x16', `Eyes_${n}.png`), path.join(OUT, 'eyes', `eyes_${n}.png`));
}
for (const style of HAIR_STYLES) {
  for (const color of HAIR_COLORS) {
    copyChecked(
      path.join(PACK, 'Hairstyles', '16x16', `Hairstyle_${style}_${color}.png`),
      path.join(OUT, 'hair', `hair_${style}_${color}.png`),
    );
  }
}
for (const [style, color] of OUTFIT_PICKS) {
  copyChecked(
    path.join(PACK, 'Outfits', '16x16', `Outfit_${style}_${color}.png`),
    path.join(OUT, 'outfit', `outfit_${style}_${color}.png`),
  );
}

console.log('emotes:');
{
  const sheet = PNG.sync.read(
    fs.readFileSync(path.join(ROOT, 'assets_temp', 'moderninteriors-win', EMOTE_SHEET)),
  );
  const emoteDir = path.join(ROOT, 'client', 'public', 'emotes');
  fs.mkdirSync(emoteDir, { recursive: true });
  const blitCell = (out, frame, row, col) => {
    for (let y = 0; y < 32; y++) {
      const from = ((row * 32 + y) * sheet.width + col * 32) * 4;
      const to = ((y * out.width + frame * 32)) * 4;
      sheet.data.copy(out.data, to, from, from + 32 * 4);
    }
  };
  for (const [id, [row, col]] of Object.entries(EMOTE_ICONS)) {
    const out = new PNG({ width: 8 * 32, height: 32 });
    EMOTE_INTRO.cols.forEach((c, i) => blitCell(out, i, EMOTE_INTRO.row, c));
    blitCell(out, 6, row, col);
    blitCell(out, 7, row, col + 1);
    fs.writeFileSync(path.join(emoteDir, `${id}.png`), PNG.sync.write(out));
    console.log(`  client/public/emotes/${id}.png (intro 0-5 + ícone [${row},${col}])`);
  }
}
console.log('ok.');
