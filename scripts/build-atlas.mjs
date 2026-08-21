/**
 * Gera o atlas de tiles do jogo a partir das sheets master do pack pago.
 *
 * Rodar da raiz: `npm run atlas` (ou `node scripts/build-atlas.mjs`). Exige
 * `assets_temp/moderninteriors-win/` no disco (o pack comprado, gitignored).
 * Noutra máquina sem o pack, os arquivos gerados já commitados continuam
 * valendo; este script só é necessário para mudar a curadoria.
 *
 * Entrada:  scripts/atlas.manifest.json — nome semântico -> {src, x, y, w, h}
 *           nas sheets master. Adicionar um móvel novo = uma linha ali.
 * Saída:    client/public/tiles/modern/furniture.png + furniture.json
 *           (formato Spritesheet do PixiJS v8: `Assets.load` do JSON carrega o
 *           PNG junto e devolve as texturas por nome).
 *
 * Por que um atlas, e não a sheet inteira nem PNGs soltos: a Interiors_32x32
 * master tem 512x34048 px — mais alta que o MAX_TEXTURE_SIZE de muitas GPUs
 * (8192/16384), então ela nem PODE virar textura; e um PNG por móvel viraria
 * dezenas de requests e quebraria o batching do renderer. O empacotamento é
 * shelf (prateleiras por altura), determinístico (ordena por altura e nome)
 * para o diff dos gerados ficar estável entre execuções.
 *
 * Fonte: Modern Interiors FULL, by LimeZu (https://limezu.itch.io/moderninteriors).
 * Licença: uso comercial permitido, crédito obrigatório (README, "Créditos de
 * assets"), PROIBIDO redistribuir o asset — só o subconjunto usado entra no
 * repo, e o repo é privado.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'client', 'public', 'tiles', 'modern');
const ATLAS_W = 512;
/** respiro entre frames: evita sangria de vizinho em qualquer filtro/zoom */
const PAD = 2;

// o replace tira um eventual BOM (editor do Windows) antes do parse
const manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'scripts', 'atlas.manifest.json'), 'utf8').replace(/^﻿/, ''),
);

const sources = {};
for (const [key, rel] of Object.entries(manifest.sources)) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.error(`fonte "${key}" não encontrada: ${abs} — este script precisa do pack comprado no disco.`);
    process.exit(1);
  }
  sources[key] = PNG.sync.read(fs.readFileSync(abs));
}

// ---- validação e ordenação determinística (altura desc, depois nome) ----
const entries = Object.entries(manifest.frames).map(([name, f]) => {
  const src = sources[f.src];
  if (!src) throw new Error(`${name}: src "${f.src}" não existe em sources`);
  if (f.x + f.w > src.width || f.y + f.h > src.height) {
    throw new Error(`${name}: recorte ${f.x},${f.y} ${f.w}x${f.h} fora da sheet (${src.width}x${src.height})`);
  }
  return { name, ...f };
});
entries.sort((a, b) => b.h - a.h || a.name.localeCompare(b.name));

// ---- shelf packing ----
let shelfY = PAD;
let shelfH = 0;
let cursorX = PAD;
const placed = [];
for (const e of entries) {
  if (cursorX + e.w + PAD > ATLAS_W) {
    shelfY += shelfH + PAD;
    cursorX = PAD;
    shelfH = 0;
  }
  placed.push({ ...e, ax: cursorX, ay: shelfY });
  cursorX += e.w + PAD;
  shelfH = Math.max(shelfH, e.h);
}
const atlasH = shelfY + shelfH + PAD;

// ---- blit ----
const atlas = new PNG({ width: ATLAS_W, height: atlasH });
for (const p of placed) {
  const src = sources[p.src];
  for (let dy = 0; dy < p.h; dy++) {
    const from = ((p.y + dy) * src.width + p.x) * 4;
    const to = ((p.ay + dy) * ATLAS_W + p.ax) * 4;
    src.data.copy(atlas.data, to, from, from + p.w * 4);
  }
}

// ---- JSON no formato Spritesheet do Pixi ----
const frames = {};
for (const p of placed.sort((a, b) => a.name.localeCompare(b.name))) {
  frames[p.name] = {
    frame: { x: p.ax, y: p.ay, w: p.w, h: p.h },
    spriteSourceSize: { x: 0, y: 0, w: p.w, h: p.h },
    sourceSize: { w: p.w, h: p.h },
  };
}
const sheetJson = {
  frames,
  meta: {
    image: 'furniture.png',
    format: 'RGBA8888',
    size: { w: ATLAS_W, h: atlasH },
    scale: 1,
  },
};

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'furniture.png'), PNG.sync.write(atlas));
fs.writeFileSync(path.join(OUT_DIR, 'furniture.json'), JSON.stringify(sheetJson, null, 2) + '\n');
const kb = (fs.statSync(path.join(OUT_DIR, 'furniture.png')).size / 1024).toFixed(0);
console.log(`atlas: ${placed.length} frames em ${ATLAS_W}x${atlasH} (${kb} KB) -> client/public/tiles/modern/furniture.{png,json}`);

// ---- tiras de animação: copiadas inteiras (o recorte em frames é do client,
// que conhece frameW/frameH/fps em scenarioThemes.ts) ----
const animDir = path.join(OUT_DIR, 'anim');
fs.mkdirSync(animDir, { recursive: true });
for (const [name, rel] of Object.entries(manifest.animations ?? {})) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) {
    console.error(`animação "${name}" não encontrada: ${abs}`);
    process.exit(1);
  }
  fs.copyFileSync(abs, path.join(animDir, `${name}.png`));
  const akb = (fs.statSync(abs).size / 1024).toFixed(0);
  console.log(`anim: ${name}.png (${akb} KB)`);
}
