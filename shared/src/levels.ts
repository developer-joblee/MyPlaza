/**
 * Progressão: quanto tempo na plataforma vale quantos sons.
 *
 * Módulo próprio, e não um bloco em `constants.ts`, porque **isto vai crescer**.
 * Hoje a única fonte de progresso é tempo de presença; a intenção declarada é
 * somar outras (conversas, salas visitadas, dias seguidos). Quando isso
 * acontecer, o que muda é a conta que produz `points` — a tabela de marcos e os
 * consumidores dela continuam iguais. Por isso as funções abaixo recebem
 * **segundos** e não olham `sessions` nem banco nenhum: a fonte do número é
 * problema de quem chama.
 *
 * Vive em `shared/` porque os dois lados usam: o servidor **autoriza** o upload
 * e o disparo pelo número de slots, e o cliente mostra a grade e o "faltam N
 * horas para o próximo". Se cada lado tivesse a sua tabela, a tela prometeria um
 * slot que o servidor recusa.
 */

/** Um marco de progressão. `hours` é o tempo acumulado que o libera. */
export interface PresenceLevel {
  level: number;
  label: string;
  hours: number;
  /** Quantos sons a pessoa pode ter ativos ao alcançar este marco. */
  slots: number;
}

/**
 * Marcos fixos em vez de fórmula linear.
 *
 * Linear (1 slot a cada N horas) é menos código, mas some com a sensação de
 * conquista: o próximo slot está sempre à mesma distância, o que lê como grind.
 * Marco tem nome, aparece na tela e dá o "faltam 3h" — e a curva cresce, então o
 * quinto som custa mais que o segundo.
 *
 * A primeira hora dá o primeiro slot de propósito: no dia zero ninguém tem
 * tempo acumulado, e um soundboard vazio sem caminho visível para o primeiro som
 * é a pior primeira impressão possível. Uma hora é uma manhã de trabalho.
 *
 * Ordem crescente por `hours` é **pré-condição** de `levelFor`/`nextLevel`.
 */
export const PRESENCE_LEVELS: readonly PresenceLevel[] = [
  { level: 1, label: 'Chegou', hours: 1, slots: 1 },
  { level: 2, label: 'Habitué', hours: 8, slots: 2 },
  { level: 3, label: 'Da casa', hours: 24, slots: 3 },
  { level: 4, label: 'Veterano', hours: 60, slots: 4 },
  { level: 5, label: 'Fundação', hours: 120, slots: 5 },
] as const;

/** Teto de slots — o último marco. Usado para dimensionar a grade e validar `slot`. */
export const SOUND_MAX_SLOTS = PRESENCE_LEVELS[PRESENCE_LEVELS.length - 1]!.slots;

const HOUR_S = 3600;

/** O marco alcançado com este tempo, ou `null` para quem ainda não chegou no primeiro. */
export function levelFor(seconds: number): PresenceLevel | null {
  let current: PresenceLevel | null = null;
  for (const level of PRESENCE_LEVELS) {
    if (seconds >= level.hours * HOUR_S) current = level;
    else break;
  }
  return current;
}

/**
 * Quantos sons esta pessoa pode ter ativos.
 *
 * É a função que o servidor usa para autorizar upload e disparo. Um número
 * negativo ou `NaN` (banco sem a coluna, leitura que falhou) cai em 0 em vez de
 * liberar tudo: falha de leitura não deve virar slot de graça.
 */
export function slotsFor(seconds: number): number {
  if (!Number.isFinite(seconds) || seconds <= 0) return 0;
  return levelFor(seconds)?.slots ?? 0;
}

/** O próximo marco, ou `null` para quem já está no último. */
export function nextLevel(seconds: number): PresenceLevel | null {
  for (const level of PRESENCE_LEVELS) {
    if (seconds < level.hours * HOUR_S) return level;
  }
  return null;
}

/**
 * Quanto falta, em segundos, para o próximo marco (`0` se já está no último).
 * A tela formata; a conta fica aqui para os dois lados dizerem o mesmo.
 */
export function secondsToNextLevel(seconds: number): number {
  const next = nextLevel(seconds);
  if (!next) return 0;
  return Math.max(0, Math.ceil(next.hours * HOUR_S - seconds));
}
