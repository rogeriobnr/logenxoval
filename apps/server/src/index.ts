import { loadDotenv } from './lib/dotenv';
import { loadEnv } from './env';
import { buildApp } from './app';
import { migrate } from './db/migrate';
import { closePool } from './db/pool';

loadDotenv();

const env = loadEnv();
const isDev = env.NODE_ENV !== 'production';

async function start() {
  if (env.NODE_ENV === 'production' && isDev) {
    throw new Error('NODE_ENV inválido');
  }
  await migrate();
  const app = await buildApp({ jwtSecret: env.JWT_SECRET, logger: isDev });
  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

start().catch((err) => {
  console.error(err);
  closePool().finally(() => process.exit(1));
});