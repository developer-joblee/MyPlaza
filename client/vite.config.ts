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
