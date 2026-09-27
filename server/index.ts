import 'dotenv/config';
import { createApp } from './app.js';
import { runtimeConfiguration } from './configuration.js';
const config = runtimeConfiguration(process.env);
const app = createApp(config);
const server = app.listen(config.port, config.host, () =>
  console.log(`Harbor listening on port ${config.port}`),
);
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => server.close(() => process.exit(0)));
