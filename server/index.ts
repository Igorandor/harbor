import 'dotenv/config';
import { createApp } from './app.js';
const irisUrl = process.env.IRIS_URL ?? 'http://127.0.0.1:52773';
if (!['http:', 'https:'].includes(new URL(irisUrl).protocol))
  throw new Error('IRIS_URL must use HTTP or HTTPS.');
const app = createApp({
  irisUrl,
  origin: process.env.PUBLIC_ORIGIN,
  secure: process.env.COOKIE_SECURE === 'true',
});
const server = app.listen(Number(process.env.PORT ?? 3100), process.env.HOST ?? '127.0.0.1', () =>
  console.log(`Harbor listening on port ${process.env.PORT ?? 3100}`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
