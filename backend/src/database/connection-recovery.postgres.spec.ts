import { createServer, Server, Socket } from 'net';
import { DataSource } from 'typeorm';
import { buildDatabaseOptions } from './database-options';

const testUrl = process.env.TEST_POSTGRES_URL;
const postgres = testUrl ? describe : describe.skip;

postgres('PostgreSQL pool connection recovery', () => {
  let proxy: Server;
  let source: DataSource;
  let blackhole = false;
  const sockets = new Set<Socket>();
  const track = (socket: Socket) => {
    sockets.add(socket);
    socket.on('error', () => undefined);
    socket.on('close', () => sockets.delete(socket));
    return socket;
  };
  const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  const bounded = <T>(promise: Promise<T>, ms: number) => {
    let timer: NodeJS.Timeout;
    return Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('Regression deadline exceeded')), ms);
      }),
    ]).finally(() => clearTimeout(timer));
  };
  const pool = () => (source.driver as any).master;
  jest.setTimeout(30_000);

  beforeEach(async () => {
    const target = new URL(testUrl!);
    if (!['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
      throw new Error('Connection recovery tests require local disposable PostgreSQL');
    }
    blackhole = false;
    proxy = createServer(client => {
      track(client);
      // Accept TCP but never answer PostgreSQL startup. This reproduces the
      // old-address socket remaining ESTABLISHED without a database session.
      if (blackhole) return;
      const upstream = track(new Socket());
      upstream.connect(Number(target.port || 5432), target.hostname);
      client.pipe(upstream).pipe(client);
      client.on('close', () => upstream.destroy());
      upstream.on('close', () => client.destroy());
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address() as { port: number };
    target.hostname = '127.0.0.1';
    target.port = String(address.port);
    const options = buildDatabaseOptions(target.toString());
    if (options.type !== 'postgres') throw new Error('Expected PostgreSQL options');
    source = new DataSource({
      ...options,
      type: 'postgres', entities: [], migrations: [], migrationsRun: false,
      synchronize: false, ssl: false, poolSize: 1,
    });
    await source.initialize();
  });

  afterEach(async () => {
    for (const socket of sockets) socket.destroy();
    if (source?.isInitialized) await bounded(source.destroy(), 3_000);
    if (proxy) await new Promise<void>(resolve => proxy.close(() => resolve()));
  });

  it('reclaims a slot stuck in startup and reconnects after the route recovers', async () => {
    blackhole = true;
    for (const socket of sockets) socket.destroy();
    for (let i = 0; i < 100 && pool().totalCount; i++) await pause(10);
    expect(pool().totalCount).toBe(0);

    const startedAt = Date.now();
    // Install rejection handling immediately: the driver must reject the
    // actual connection attempt, rather than merely race a caller timeout.
    const stalled = source.query('SELECT 1').then(
      () => ({ error: '' }),
      error => ({ error: String(error.message) }),
    );
    await pause(50);
    expect(pool().totalCount).toBe(1);
    blackhole = false; // Only future TCP connections reach PostgreSQL now.
    const result = await bounded(stalled, 6_000);
    expect(result.error).toMatch(/timeout|terminated/i);
    expect(Date.now() - startedAt).toBeLessThan(6_000);
    expect(pool().totalCount).toBe(0);

    const recoveredAt = Date.now();
    expect(await bounded(source.query('SELECT 42 AS answer'), 2_000))
      .toEqual([{ answer: 42 }]);
    expect(Date.now() - recoveredAt).toBeLessThan(2_000);
  });

  it('bounds pool acquisition waits and leaves the pool usable after release', async () => {
    const runner = source.createQueryRunner();
    await runner.connect();
    try {
      const startedAt = Date.now();
      await expect(bounded(source.query('SELECT 1'), 6_000))
        .rejects.toThrow(/timeout exceeded when trying to connect/);
      expect(Date.now() - startedAt).toBeLessThan(6_000);
      expect(pool().waitingCount).toBe(0);
    } finally {
      await runner.release();
    }
    expect(await bounded(source.query('SELECT 42 AS answer'), 2_000))
      .toEqual([{ answer: 42 }]);
  });
});
