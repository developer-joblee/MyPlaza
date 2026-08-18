import { useStore } from './state/store';
import { GameView } from './ui/GameView';
import { JoinScreen } from './ui/JoinScreen';

export default function App() {
  const phase = useStore((s) => s.phase);
  return phase === 'join' ? <JoinScreen /> : <GameView />;
}
