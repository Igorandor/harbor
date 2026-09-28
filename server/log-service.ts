import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError, IrisClient } from './upstream.js';
import type { LogCatalog, LogWindow } from '../shared/log-window.js';
const cursorSchema = z
  .object({
    file: z.string().max(80),
    offset: z.number().int().nonnegative(),
    snapshot: z.number().int().nonnegative(),
    identity: z.string().regex(/^[a-f0-9]{64}$/),
    owner: z.string().max(128),
    expires: z.number().int().positive(),
  })
  .strict();
const filePattern =
  /^(?:(messages|alerts)\.log(?:[._-][0-9][0-9._-]{0,39})?|(messages)\.old_[0-9][0-9._-]{0,39})$/;
export class LogService {
  private key = randomBytes(32);
  constructor(
    private client: IrisClient,
    private now = Date.now,
  ) {}
  private sign(value: z.infer<typeof cursorSchema>) {
    const data = Buffer.from(JSON.stringify(value)).toString('base64url');
    return data + '.' + createHmac('sha256', this.key).update(data).digest('base64url');
  }
  private decode(token: string, owner: string) {
    if (token.length > 2048) throw new ApiError(400, 'Invalid log cursor.');
    const [data, signature, ...extra] = token.split('.');
    if (!data || !signature || extra.length) throw new ApiError(400, 'Invalid log cursor.');
    const supplied = Buffer.from(signature, 'base64url'),
      expected = createHmac('sha256', this.key).update(data).digest();
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected))
      throw new ApiError(
        409,
        'The log cursor is invalid or the gateway restarted. Start a new view.',
      );
    let value: z.infer<typeof cursorSchema>;
    try {
      value = cursorSchema.parse(JSON.parse(Buffer.from(data, 'base64url').toString('utf8')));
    } catch {
      throw new ApiError(400, 'Invalid log cursor.');
    }
    if (value.owner !== owner) throw new ApiError(403, 'This cursor belongs to another account.');
    if (value.expires < this.now())
      throw new ApiError(409, 'This log view expired. Start a new view.');
    return value;
  }
  async catalog(auth: string): Promise<LogCatalog> {
    const response = await this.client.request(auth, {
      path: '/extension/log-catalog',
      method: 'GET',
    });
    const parsed = z
      .object({
        files: z
          .array(
            z.object({
              id: z.string().regex(filePattern),
              source: z.enum(['messages', 'alerts']),
              bytes: z.number().nonnegative(),
              modifiedAt: z.number(),
              active: z.boolean(),
            }),
          )
          .max(100),
        limited: z.boolean(),
        notice: z.string().max(1000),
      })
      .safeParse(response.data);
    if (!parsed.success)
      throw new ApiError(
        502,
        'The native log catalog returned an invalid response. Update the Harbor extension.',
      );
    return parsed.data;
  }
  async page(
    auth: string,
    owner: string,
    input: { file?: string; cursor?: string; limit?: number },
  ): Promise<LogWindow> {
    if (input.cursor && input.file) throw new ApiError(400, 'Choose a file or a cursor, not both.');
    const previous = input.cursor ? this.decode(input.cursor, owner) : undefined;
    const file = previous?.file ?? input.file ?? 'messages.log';
    if (!filePattern.test(file)) throw new ApiError(400, 'Choose a supported log file.');
    const limit = input.limit ?? 200;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
      throw new ApiError(400, 'Choose 1–500 lines per page.');
    const query: Record<string, string> = { file, limit: String(limit) };
    if (previous)
      Object.assign(query, {
        offset: String(previous.offset),
        snapshot: String(previous.snapshot),
        identity: previous.identity,
      });
    const result = await this.client.request(auth, {
      path: '/extension/log-window',
      method: 'GET',
      query,
    });
    const parsed = z
      .object({
        file: z.string().regex(filePattern),
        identity: z.string().regex(/^[a-f0-9]{64}$/),
        snapshotBytes: z.number().int().nonnegative(),
        currentBytes: z.number().int().nonnegative(),
        start: z.number().int().nonnegative(),
        end: z.number().int().nonnegative(),
        scannedBytes: z.number().int().min(0).max(262144),
        lines: z
          .array(
            z.object({
              offset: z.number().int().nonnegative(),
              text: z.string().max(16400),
              clipped: z.boolean(),
            }),
          )
          .max(500),
        olderOffset: z.number().int().nonnegative().nullable(),
        notice: z.string().max(1000),
      })
      .safeParse(result.data);
    if (!parsed.success)
      throw new ApiError(502, 'The native log page is invalid. Update the Harbor extension.');
    const page = parsed.data;
    if (
      page.file !== file ||
      page.end > page.snapshotBytes ||
      page.start > page.end ||
      (previous && page.identity !== previous.identity)
    )
      throw new ApiError(502, 'The native log page does not match the requested window.');
    return {
      ...page,
      observedAt: new Date(this.now()).toISOString(),
      ...(page.olderOffset !== null
        ? {
            olderCursor: this.sign({
              file,
              offset: page.olderOffset,
              snapshot: page.snapshotBytes,
              identity: page.identity,
              owner,
              expires: this.now() + 30 * 60_000,
            }),
          }
        : {}),
    };
  }
}
