import { AdminService } from './admin.service';

describe('admin database health request coordination', () => {
  function fixture() {
    let release!: (count: number) => void;
    const pending = new Promise<number>((resolve) => { release = resolve; });
    const getCount = jest.fn().mockReturnValue(pending);
    const builder = { where: jest.fn().mockReturnThis(), andWhere: jest.fn().mockReturnThis(), getCount };
    const messages = { createQueryBuilder: jest.fn().mockReturnValue(builder) };
    const dataSource = { showMigrations: jest.fn().mockResolvedValue(false) };
    const service = new AdminService({} as any, {} as any, {} as any, messages as any, {} as any, dataSource as any, {} as any);
    return { service, messages, dataSource, release, getCount };
  }

  it('starts independent queries together and shares simultaneous health/setup requests', async () => {
    const h = fixture();
    const first = h.service.systemHealth();
    const second = h.service.systemHealth();
    expect(h.getCount).toHaveBeenCalledTimes(2);
    expect(h.dataSource.showMigrations).toHaveBeenCalledTimes(1);
    h.release(3);
    const [a, b] = await Promise.all([first, second]);
    expect(a).toEqual(b);
    expect(a).toMatchObject({ totalMessages24h: 3, failedMessages24h: 3, migrationsPending: false });
    await h.service.systemHealth();
    expect(h.getCount).toHaveBeenCalledTimes(4); // no stale completed-result cache
  });

  it('clears rejected in-flight work so a retry can recover', async () => {
    const h = fixture();
    h.getCount.mockRejectedValueOnce(new Error('Database unavailable'));
    h.release(0);
    await expect(h.service.systemHealth()).rejects.toThrow('Database unavailable');
    await expect(h.service.systemHealth()).resolves.toMatchObject({ dbConnected: true });
  });
});
