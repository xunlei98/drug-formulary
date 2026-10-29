import { loadConfig } from './config.js';
import { openDb } from './db.js';
import { createApp } from './app.js';

const config = loadConfig();
const db = openDb(config.dbPath);
const { server, build } = createApp({ db, config });
server.listen(config.port, config.host, () => {
  console.log(`Formulary running at http://${config.host}:${config.port} (build ${build})`);
  if (config.secureCookies) console.log('Secure cookies are on. Sign-in needs HTTPS or http://localhost.');
});
const stop = () => { server.close(); db.close(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
