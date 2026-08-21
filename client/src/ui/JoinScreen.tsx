import { useState } from 'react';
import {
  AVATAR_COLORS,
  CHARACTERS,
  DEFAULT_SCENARIO,
  NAME_MAX_LENGTH,
  type CharacterId,
  type ScenarioId,
} from '@together/shared';
import { MULTIPLE_SCENARIOS, SCENARIO_EMOJI, SCENARIO_LIST } from './scenarioEmoji';
import type { JoinDeniedReason } from '@together/shared';
import { authConfigured, signOut } from '../auth/supabase';
import { characterPreview } from '../game/characterDefs';
import { useStore } from '../state/store';
import { colorToCss } from './util';

/**
 * Motivos de recusa em português. O servidor manda só o código, nunca texto
 * livre: mensagem detalhada vazaria informação (por exemplo, distinguir "essa
 * empresa não existe" de "você não é membro dela").
 */
const DENIED_TEXT: Record<JoinDeniedReason, string> = {
  'auth-required': 'Este servidor exige login. Entre com sua conta.',
  // ver `deniedText()`: esta mensagem só serve quando existe tela de login
  'invalid-token': 'Sua sessão expirou. Entre de novo.',
  'no-invite': 'Sua conta não tem convite para nenhuma empresa. Peça a quem administra.',
  'no-membership': 'Seu acesso está pendente ou suspenso. Fale com quem administra.',
  'place-restricted': 'Este local é restrito e você não está na lista.',
  'place-full': 'Este local está cheio. Tente de novo em instantes.',
  'no-world': 'Escolha um mundo no lobby antes de entrar.',
  'no-place': 'Este mundo não existe mais. Volte ao lobby.',
  error: 'Algo falhou do nosso lado. Tente de novo.',
};

/**
 * Miniatura do personagem, recortada direto da spritesheet. É CSS puro em vez
 * de canvas para não depender de o PixiJS ter carregado: um div do tamanho do
 * quadro, posicionado no recorte certo, ampliado com `transform: scale`.
 */
function CharacterSprite({ id }: { id: CharacterId }) {
  const { sheet, x, y, w, h, zoom } = characterPreview(id);
  return (
    // a altura da caixa é fixa no CSS, para os cinco cartões ficarem alinhados
    // mesmo com os personagens tendo alturas de arte diferentes
    <span className="char-frame" style={{ width: w * zoom }}>
      <span
        className="char-sprite"
        style={{
          width: w,
          height: h,
          backgroundImage: `url(${sheet})`,
          backgroundPosition: `-${x}px -${y}px`,
          transform: `scale(${zoom})`,
        }}
      />
    </span>
  );
}

/**
 * Texto da recusa, com uma exceção que evita um beco sem saída.
 *
 * `auth-required` significa "o servidor quer um token". Se o client não tem
 * Supabase configurado, ele **não tem tela de login** para oferecer — mandar
 * "entre com sua conta" apontaria para uma tela que não existe. Nesse caso o
 * problema é de configuração do deploy, não da pessoa, e a mensagem diz isso.
 */
function deniedText(reason: JoinDeniedReason): string {
  if (reason === 'auth-required' && !authConfigured) {
    return 'Este servidor exige login, mas este app foi publicado sem as variáveis VITE_SUPABASE_* — quem cuida do deploy precisa configurá-las.';
  }
  return DENIED_TEXT[reason];
}

export function JoinScreen() {
  const join = useStore((s) => s.join);
  const authEmail = useStore((s) => s.authEmail);
  const joinDenied = useStore((s) => s.joinDenied);
  const selfWorldName = useStore((s) => s.selfWorldName);
  const backToLobby = useStore((s) => s.backToLobby);
  // quem acabou de sair volta com nome, cor e cenário já preenchidos
  const [name, setName] = useState(() => useStore.getState().selfName);
  const [color, setColor] = useState<number>(
    () =>
      useStore.getState().selfName
        ? useStore.getState().selfColor
        : AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  );
  const [scenario, setScenario] = useState<ScenarioId>(
    () => useStore.getState().selfScenario ?? DEFAULT_SCENARIO,
  );
  const [character, setCharacter] = useState<CharacterId>(
    () => useStore.getState().selfCharacter,
  );

  const canJoin = name.trim().length > 0;
  const showScenarios = MULTIPLE_SCENARIOS && !selfWorldName;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (canJoin) join(name.trim(), color, scenario, character);
  };

  return (
    <div className="join-screen">
      <form className="join-card" onSubmit={submit}>
        <h1 className="join-logo">
          t<span className="accent">o</span>Gether
        </h1>
        <p className="join-tagline">
          {selfWorldName ?? (authEmail ? authEmail : 'o espaço virtual da equipe')}
        </p>

        {joinDenied && (
          <p className="join-denied" role="alert">
            {deniedText(joinDenied)}
          </p>
        )}

        <div className="join-fields">
          <label className="join-label" htmlFor="name">
            Seu nome
          </label>
          <input
            id="name"
            className="join-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={NAME_MAX_LENGTH}
            placeholder="Como a equipe te chama?"
            autoFocus
            autoComplete="off"
          />
        </div>

        <span className="join-label">Personagem</span>
        <div className="character-row">
          {CHARACTERS.map((c) => (
            <button
              key={c.id}
              type="button"
              className={`character-card${c.id === character ? ' selected' : ''}`}
              onClick={() => setCharacter(c.id)}
              aria-pressed={c.id === character}
            >
              <CharacterSprite id={c.id} />
              <span className="character-name">{c.label}</span>
            </button>
          ))}
        </div>

        <span className="join-label">Sua cor (nome e lista)</span>
        <div className="color-row">
          {AVATAR_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`color-swatch${c === color ? ' selected' : ''}`}
              style={{ background: colorToCss(c) }}
              onClick={() => setColor(c)}
              aria-label={`Cor ${colorToCss(c)}`}
            />
          ))}
        </div>

        {/* Com mundo escolhido no lobby, o cenário é DELE — escolher aqui daria
            a impressão de trocar de mapa dentro do mesmo mundo. Com um cenário
            só (o caso de hoje), escolher também não é escolha: o seletor sai
            inteiro e o `scenario` fica no `DEFAULT_SCENARIO`. */}
        {showScenarios && (
          <>
            <span className="join-label">Cenário</span>
            <div className="scenario-row">
              {SCENARIO_LIST.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`scenario-card${s.id === scenario ? ' selected' : ''}`}
                  onClick={() => setScenario(s.id)}
                >
                  <span className="scenario-emoji">{SCENARIO_EMOJI[s.id]}</span>
                  <span className="scenario-name">{s.label}</span>
                  <span className="scenario-desc">{s.description}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <button className="join-button" type="submit" disabled={!canJoin}>
          Entrar
        </button>

        <p className="join-hint">
          Ande com <strong>WASD</strong> ou setas. Chegue perto de alguém para conversar por voz.
        </p>

        {/*
          Sem login configurado o app entra direto aqui, anônimo. Sem este aviso o
          estado é invisível: a pessoa procura o botão de entrar com a conta, não
          encontra, e conclui que a tela de login não existe — foi exatamente o
          que aconteceu na primeira vez que alguém subiu o app.
        */}
        {!authConfigured && (
          <p className="join-hint">
            Modo anônimo: este app está sem <code>VITE_SUPABASE_URL</code> e{' '}
            <code>VITE_SUPABASE_ANON_KEY</code>, então não há conta, convite nem lobby — e
            nada é salvo. Defina as duas no <code>.env</code> da raiz e reinicie o servidor
            de desenvolvimento para ter login.
          </p>
        )}

        {selfWorldName && (
          <button className="join-secondary" type="button" onClick={backToLobby}>
            Voltar ao lobby
          </button>
        )}

        {authConfigured && authEmail && !selfWorldName && (
          <button className="join-secondary" type="button" onClick={() => void signOut()}>
            Sair da conta
          </button>
        )}
      </form>
    </div>
  );
}
