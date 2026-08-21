import { useState } from 'react';
import { signIn, signUp, type AuthResult } from '../auth/supabase';
import { useStore } from '../state/store';

/**
 * Entrar na conta. Reaproveita as classes `.join-*` da tela de entrada — é o
 * mesmo cartão, o mesmo logo e o mesmo botão, então não há estilo novo.
 *
 * Duas ações num formulário só (entrar / criar conta) em vez de duas telas: a
 * pessoa não sabe de antemão se já tem conta, e obrigá-la a escolher a aba certa
 * antes de digitar só gera erro.
 *
 * **Não há passo de confirmação.** Enquanto não houver domínio para enviar
 * e-mail, nada é enviado: cria a conta e entra. O e-mail é só identificador de
 * login. Quem dá acesso a um mundo é quem o administra, pelo **ID** da conta —
 * que a pessoa encontra no lobby depois de entrar.
 */
export function LoginScreen() {
  const setAuthEmail = useStore((s) => s.setAuthEmail);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const canSubmit = email.includes('@') && password.length >= 6 && !busy;

  const run = async (action: 'in' | 'up') => {
    setBusy(true);
    setError(null);
    const mail = email.trim();
    const res: AuthResult = action === 'in' ? await signIn(mail, password) : await signUp(mail, password);
    setBusy(false);
    if (res.signedIn) {
      setAuthEmail(mail);
      return;
    }
    setError(res.error ?? 'Não foi possível concluir.');
  };

  return (
    <div className="join-screen">
      <form
        className="join-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) void run('in');
        }}
      >
        <h1 className="join-logo">
          t<span className="accent">o</span>Gether
        </h1>
        <p className="join-tagline">entre com sua conta da equipe</p>

        <div className="join-fields">
          <label className="join-label" htmlFor="email">
            E-mail
          </label>
          <input
            id="email"
            className="join-input"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="voce@empresa.com"
            autoComplete="email"
            autoFocus
          />
        </div>

        <div className="join-fields">
          <label className="join-label" htmlFor="password">
            Senha
          </label>
          <input
            id="password"
            className="join-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="mínimo 6 caracteres"
            autoComplete="current-password"
          />
        </div>

        {error && (
          <p className="join-hint" role="alert">
            {error}
          </p>
        )}

        <button className="join-button" type="submit" disabled={!canSubmit}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>

        <button
          className="join-secondary"
          type="button"
          disabled={!canSubmit}
          onClick={() => void run('up')}
        >
          Criar conta
        </button>

        <p className="join-hint">
          Criar conta entra <strong>na hora</strong>: não há e-mail de confirmação. Guarde a
          senha — sem envio de e-mail, não há como recuperá-la sozinho.
        </p>

        <p className="join-hint">
          Para entrar num escritório da equipe, quem administra precisa te adicionar pelo
          seu <strong>ID</strong> — ele aparece no lobby depois que você entrar. Mundos
          próprios você cria sozinho.
        </p>
      </form>
    </div>
  );
}
