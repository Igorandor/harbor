import { resolve } from 'node:path';
export type RuntimeConfiguration = {
  irisUrl: string;
  origin?: string;
  secure: boolean;
  port: number;
  host: string;
  instanceId: string;
  dataDirectory: string;
  mode: 'evaluation' | 'deployment';
};
export function runtimeConfiguration(env: NodeJS.ProcessEnv): RuntimeConfiguration {
  const mode = env.HARBOR_MODE ?? 'evaluation';
  if (!['evaluation', 'deployment'].includes(mode))
    throw new Error('HARBOR_MODE must be evaluation or deployment.');
  const iris = new URL(env.IRIS_URL ?? 'http://127.0.0.1:52773');
  if (
    !['http:', 'https:'].includes(iris.protocol) ||
    iris.username ||
    iris.password ||
    iris.search ||
    iris.hash ||
    !['', '/'].includes(iris.pathname)
  )
    throw new Error(
      'IRIS_URL must be an HTTP(S) origin without credentials, path, query or fragment.',
    );
  const port = Number(env.PORT ?? 3100);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer from 1 to 65535.');
  if (env.COOKIE_SECURE !== undefined && !['true', 'false'].includes(env.COOKIE_SECURE))
    throw new Error('COOKIE_SECURE must be true or false.');
  const secure = env.COOKIE_SECURE === 'true';
  let origin: string | undefined;
  if (env.PUBLIC_ORIGIN) {
    const supplied = new URL(env.PUBLIC_ORIGIN);
    if (
      !['http:', 'https:'].includes(supplied.protocol) ||
      supplied.username ||
      supplied.password ||
      supplied.search ||
      supplied.hash ||
      !['', '/'].includes(supplied.pathname)
    )
      throw new Error('PUBLIC_ORIGIN must be one exact HTTP(S) origin.');
    origin = supplied.origin;
    if (supplied.protocol === 'https:' && !secure)
      throw new Error('HTTPS deployments require COOKIE_SECURE=true.');
    if (supplied.protocol === 'http:' && secure)
      throw new Error('Secure cookies require an HTTPS public origin.');
  }
  if (mode === 'deployment') {
    if (!origin?.startsWith('https:') || !secure)
      throw new Error('Deployment mode requires an HTTPS PUBLIC_ORIGIN and secure cookies.');
    if (iris.protocol !== 'https:' && env.ALLOW_PRIVATE_IRIS_HTTP !== 'true')
      throw new Error(
        'Use HTTPS for IRIS_URL, or explicitly allow a private network with ALLOW_PRIVATE_IRIS_HTTP=true.',
      );
    if (!env.IRIS_INSTANCE_ID?.trim())
      throw new Error('Deployment mode requires a stable IRIS_INSTANCE_ID.');
  }
  const instanceId = env.IRIS_INSTANCE_ID?.trim() || iris.origin;
  if (instanceId.length > 160 || /[\x00-\x1f]/.test(instanceId))
    throw new Error('IRIS_INSTANCE_ID must contain 1–160 printable characters.');
  const host = env.HOST ?? '127.0.0.1';
  if (!host || /[\s/]/.test(host)) throw new Error('HOST must be a bind address.');
  return {
    irisUrl: iris.origin,
    origin,
    secure,
    port,
    host,
    instanceId,
    dataDirectory: resolve(env.HARBOR_DATA_DIR ?? 'data'),
    mode: mode as RuntimeConfiguration['mode'],
  };
}
