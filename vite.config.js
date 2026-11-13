import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Feed server is optional: when it is down, return 204 so the browser does not log a 500
// and the HUD falls back to demo data.
const api = {
  '/api': {
    target: 'http://127.0.0.1:8788',
    configure: (proxy) => {
      proxy.on('error', (err, req, res) => {
        if (res && !res.headersSent) {
          res.writeHead(204);
          res.end();
        }
      });
    }
  }
};

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173, proxy: api },
  preview: { port: 4173, proxy: api }
});
