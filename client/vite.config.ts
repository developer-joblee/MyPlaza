import { defineConfig, type PluginOption } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

const plugins: PluginOption[] = [react()];
if (process.env.HTTPS === '1') {
  // HTTPS é necessário para getUserMedia/getDisplayMedia fora de localhost
  plugins.push(basicSsl());
}

export default defineConfig({
  plugins,
  /**
   * O `.env` vive na RAIZ do repo, um nível acima. Sem isto o Vite procuraria em
   * `client/` (o default é a pasta do projeto) e as variáveis `VITE_*` seriam
   * silenciosamente ignoradas — o client acharia que não há login configurado
   * enquanto o servidor exige token, e todo mundo levaria `auth-required`.
   *
   * O servidor lê o mesmo arquivo via `--env-file-if-exists=../.env`; um `.env`
   * só, para os dois lados.
   */
  envDir: '..',
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3001',
        ws: true,
      },
    },
  },
});
