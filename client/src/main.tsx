import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';

// Sem StrictMode: o duplo-mount de dev duplicaria getUserMedia,
// socket e conexões WebRTC.
createRoot(document.getElementById('root')!).render(<App />);
