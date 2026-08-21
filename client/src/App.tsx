import { useEffect } from 'react';
import { authConfigured, currentSession, supabase } from './auth/supabase';
import { useStore } from './state/store';
import { GameView } from './ui/GameView';
import { JoinScreen } from './ui/JoinScreen';
import { LobbyScreen } from './ui/LobbyScreen';
import { LoginScreen } from './ui/LoginScreen';

export default function App() {
  const phase = useStore((s) => s.phase);

  useEffect(() => {
    const store = useStore.getState();

    // sem Supabase no client, o fluxo é o anônimo de sempre
    if (!authConfigured) {
      store.setPhase('join');
      return;
    }

    /**
     * Restaurar a sessão é assíncrono — é por isso que a fase inicial é `boot`.
     *
     * O `catch` não é decoração: sem ele, uma rejeição aqui deixava a fase presa
     * em `boot` para sempre, e `boot` renderiza uma tela vazia. O sintoma era
     * página em branco sem nenhuma pista — o pior modo de falhar que existe.
     * Falhar em ler a sessão significa "não está logado", e o lugar disso é a
     * tela de login.
     */
    void currentSession()
      .then((session) => session?.user.email ?? null)
      .catch((err: unknown) => {
        console.error('[auth] não deu para ler a sessão:', err);
        return null;
      })
      .then((email) => {
        const store = useStore.getState();
        store.setAuthEmail(email);
        // com conta, a porta de entrada é o lobby (escolher o mundo); sem conta,
        // o login
        store.setPhase(email ? 'lobby' : 'login');
      });

    /**
     * O SDK também avisa quando o token é renovado ou a sessão morre (senha
     * trocada em outra aba, conta desativada). Sem escutar isto, a pessoa
     * continuaria na tela do jogo com uma sessão que o servidor já recusa.
     */
    const { data } = supabase!.auth.onAuthStateChange((_event, session) => {
      useStore.getState().setAuthEmail(session?.user.email ?? null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  // `boot` mostra o logo, e não um div vazio: tela em branco é indistinguível
  // de app quebrado, e foi exatamente essa confusão que apareceu na prática.
  if (phase === 'boot') {
    return (
      <div className="join-screen">
        <div className="join-card">
          <h1 className="join-logo">
            t<span className="accent">o</span>Gether
          </h1>
          <p className="join-tagline">carregando…</p>
        </div>
      </div>
    );
  }
  if (phase === 'login') return <LoginScreen />;
  if (phase === 'lobby') return <LobbyScreen />;
  return phase === 'join' ? <JoinScreen /> : <GameView />;
}
