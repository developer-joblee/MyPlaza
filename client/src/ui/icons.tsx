/**
 * Ícones inline, 24×24 com traço de 2px — o mesmo desenho dos dois originais
 * do MediaControls. Formas grandes e sem detalhe fino, porque o CSS força
 * 22px (`.media-btn svg`) e teto de gordura vira mancha nesse tamanho.
 */
type IconProps = { off?: boolean };

const base = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: '2',
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

/** Risco de "desligado", compartilhado entre mic e fone para virar um idioma só. */
function Slash() {
  return <line x1="3" y1="3" x2="21" y2="21" stroke="currentColor" strokeWidth="2.5" />;
}

export function MicIcon({ off }: IconProps) {
  return (
    <svg {...base}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10v1a7 7 0 0 0 14 0v-1" />
      <line x1="12" y1="18" x2="12" y2="22" />
      {off && <Slash />}
    </svg>
  );
}

export function HeadphonesIcon({ off }: IconProps) {
  return (
    <svg {...base}>
      <path d="M4 15v-3a8 8 0 0 1 16 0v3" />
      <rect x="2" y="14" width="5" height="7" rx="2.5" />
      <rect x="17" y="14" width="5" height="7" rx="2.5" />
      {off && <Slash />}
    </svg>
  );
}

/**
 * Celular — a mesma ideia da pose de ausente do avatar, para o botão e o que
 * aparece no mundo contarem a mesma história.
 */
export function AwayIcon() {
  return (
    <svg {...base}>
      <rect x="7" y="2" width="10" height="20" rx="2.5" />
      <line x1="10.5" y1="18.5" x2="13.5" y2="18.5" />
    </svg>
  );
}

/**
 * Campainha — o chamado de quem está ausente. Sino e não mão levantada: no
 * tamanho em que isto é desenhado, dedo vira mancha, e sino já significa
 * "alguém quer sua atenção" sem legenda.
 */
export function BellIcon() {
  return (
    <svg {...base}>
      <path d="M18 16V11a6 6 0 0 0-12 0v5l-1.5 2.5h15L18 16Z" />
      <path d="M10 21h4" />
    </svg>
  );
}

export function ScreenIcon() {
  return (
    <svg {...base}>
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
      <path d="M9 11l3-3 3 3" />
      <line x1="12" y1="8.5" x2="12" y2="14" />
    </svg>
  );
}

/** Faders: lê como "níveis de áudio" a 22px, o que uma engrenagem não faz. */
export function SlidersIcon() {
  return (
    <svg {...base}>
      <line x1="4" y1="8" x2="20" y2="8" />
      <line x1="4" y1="16" x2="20" y2="16" />
      <circle cx="9" cy="8" r="2.4" />
      <circle cx="15" cy="16" r="2.4" />
    </svg>
  );
}

export function CheckIcon() {
  return (
    <svg {...base}>
      <path d="M4 12.5l5 5L20 6.5" />
    </svg>
  );
}

export function CloseIcon() {
  return (
    <svg {...base}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

export function SpeakerIcon() {
  return (
    <svg {...base}>
      <path d="M4 9h3l4.5-3.5v13L7 15H4z" />
      <path d="M15.5 9.5a4 4 0 0 1 0 5" />
      <path d="M18.5 7a8 8 0 0 1 0 10" />
    </svg>
  );
}

/**
 * Fone virado para baixo — o gesto universal de "encerrar". O traço fino do
 * handset clássico some a 22px, então é uma silhueta cheia, inclinada.
 */
export function HangupIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <g transform="rotate(135 12 12)">
        <path d="M6.6 10.8c1.2 2.4 3.2 4.4 5.6 5.6l1.9-1.9c.3-.3.7-.4 1.1-.2 1.1.4 2.3.6 3.5.6.6 0 1 .4 1 1v3c0 .6-.4 1-1 1C10.4 19.9 4.1 13.6 4.1 5.8c0-.6.4-1 1-1h3c.6 0 1 .4 1 1 0 1.2.2 2.4.6 3.5.1.4 0 .8-.2 1.1l-1.9 1.9z" />
      </g>
    </svg>
  );
}

export function WarningIcon() {
  return (
    <svg {...base}>
      <path d="M12 3.5l8.5 15h-17z" />
      <line x1="12" y1="9.5" x2="12" y2="13.5" />
      <line x1="12" y1="16.4" x2="12" y2="16.5" />
    </svg>
  );
}
