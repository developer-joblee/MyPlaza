import { useStore } from '../state/store';

/**
 * Moldura azul elétrica na tela toda enquanto VOCÊ compartilha a tela, com uma
 * etiqueta pendurada no topo.
 *
 * Existe porque compartilhar tela é a única ação do app que expõe conteúdo de
 * fora dele: esquecer que está ligado tem consequência real. Por isso o aviso é
 * na borda da janela inteira, e não um ícone aceso na barra — periférico o
 * bastante para não incomodar, impossível de não notar.
 *
 * `sharing` é o estado do próprio usuário, então quem só assiste não vê moldura.
 */
export function SharingIndicator() {
  const sharing = useStore((s) => s.sharing);
  if (!sharing) return null;

  return (
    <>
      {/* decorativa: quem lê tela recebe o aviso pela etiqueta, não pela borda */}
      <div className="sharing-frame" aria-hidden="true" />
      <div className="sharing-badge" role="status">
        <span className="sharing-dot" aria-hidden="true" />
        Compartilhando tela
      </div>
    </>
  );
}
