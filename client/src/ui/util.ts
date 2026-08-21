export function colorToCss(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * "Ana" · "Ana e Bruno" · "Ana, Bruno e +2".
 *
 * Vive aqui porque **dois** avisos da mesma pilha listam nomes — o chamado de
 * quem está ausente e a booble — e a regra do "+N" tem de ser a mesma nos dois.
 * A primeira versão tinha isso embutido no `Notices`, e o segundo aviso teria
 * copiado a função em vez de reusá-la.
 *
 * `max` é o teto de nomes mostrados; o resto vira "+N". Lista vazia devolve
 * string vazia, e quem chama decide se isso deve virar aviso nenhum.
 */
export function joinNames(names: string[], max: number): string {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} e +${rest}`;
  if (shown.length > 1) return `${shown.slice(0, -1).join(', ')} e ${shown[shown.length - 1]}`;
  return shown[0] ?? '';
}

/**
 * Duração humana e curta, para o progresso do soundboard: "3h 20min", "12min".
 *
 * Arredonda para minuto: o progresso de nível é medido em horas, e mostrar
 * segundos ali dá a impressão de um contador que precisa ser vigiado — o que é
 * exatamente o oposto de uma recompensa por tempo de presença.
 */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  if (hours === 0) return `${minutes}min`;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes}min`;
}
