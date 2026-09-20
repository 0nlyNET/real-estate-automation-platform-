import { randomUUID } from "crypto";
import { DataSource } from "typeorm";
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { ConversationInboxService } from "./conversation-inbox.service";
import { ConversationReadState1789862400002 } from "../../database/migrations/202609200002-conversation-read-state";

const databaseUrl = process.env.TEST_POSTGRES_URL;
const describePostgres = databaseUrl ? describe : describe.skip;

describePostgres("durable per-user conversation reads on PostgreSQL", () => {
  let source: DataSource;
  let admin: DataSource;
  let service: ConversationInboxService;
  const schema = `conversation_reads_${randomUUID().replace(/-/g, "")}`;
  const tenant = randomUUID();
  const otherTenant = randomUUID();
  const user = randomUUID();
  const peer = randomUUID();
  const outsider = randomUUID();
  const lead = randomUUID();
  const otherLead = randomUUID();
  const first = "00000000-0000-4000-8000-000000000001";
  const second = "00000000-0000-4000-8000-000000000002";
  const third = "00000000-0000-4000-8000-000000000003";
  const migration = new ConversationReadState1789862400002();

  beforeAll(async () => {
    admin = await new DataSource({
      type: "postgres",
      url: databaseUrl,
    }).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    source = await new DataSource({
      type: "postgres",
      url: databaseUrl,
      extra: { max: 4, options: `-c search_path=${schema},public` },
    }).initialize();
    await source.query("CREATE TABLE tenants (id uuid PRIMARY KEY)");
    await source.query(
      'CREATE TABLE users (id uuid PRIMARY KEY, "tenantId" uuid, "isActive" boolean DEFAULT true)',
    );
    await source.query(
      "CREATE TABLE leads (id uuid PRIMARY KEY, tenant_id uuid)",
    );
    await source.query(
      'CREATE TABLE messages (id uuid PRIMARY KEY, "leadId" uuid, created_at timestamp, direction text)',
    );
    await source.query("INSERT INTO tenants VALUES ($1), ($2)", [
      tenant,
      otherTenant,
    ]);
    await source.query(
      'INSERT INTO users (id, "tenantId") VALUES ($1,$4), ($2,$4), ($3,$5)',
      [user, peer, outsider, tenant, otherTenant],
    );
    await source.query("INSERT INTO leads VALUES ($1,$3), ($2,$4)", [
      lead,
      otherLead,
      tenant,
      otherTenant,
    ]);
    const runner = source.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    await migration.up(runner);
    await runner.rollbackTransaction();
    expect(
      (
        await source.query(
          "SELECT to_regclass('conversation_read_states') AS name",
        )
      )[0].name,
    ).toBeNull();
    await migration.up(runner);
    await runner.release();
    service = new ConversationInboxService(source, {} as any);
  });

  afterAll(async () => {
    await source?.destroy();
    await admin?.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin?.destroy();
  });

  beforeEach(async () => {
    await source.query("TRUNCATE conversation_read_states, messages");
    await source.query(
      `INSERT INTO messages VALUES
      ($1,$4,'2026-09-20 12:00:00.123456','inbound'),
      ($2,$4,'2026-09-20 12:00:00.123456','inbound'),
      ($3,$4,'2026-09-20 12:00:01','outbound')`,
      [first, second, third, lead],
    );
  });

  it("persists per-user reads, counts only inbound, and preserves microseconds and tied timestamps", async () => {
    expect(
      (await service.readStates(tenant, user, [lead]))[0].unreadCount,
    ).toBe(2);
    expect(await service.markRead(tenant, user, lead, first, 0)).toMatchObject({
      unreadCount: 1,
      isUnread: true,
    });
    const reloaded = new ConversationInboxService(source, {} as any);
    expect(
      (await reloaded.readStates(tenant, user, [lead]))[0].lastReadMessageId,
    ).toBe(first);
    expect(
      (await reloaded.readStates(tenant, peer, [lead]))[0].unreadCount,
    ).toBe(2);
    expect(await service.markRead(tenant, user, lead, second, 0)).toMatchObject(
      { unreadCount: 0, isUnread: false },
    );
  });

  it("leaves a message that arrives after the page snapshot unread", async () => {
    const displayed = second;
    const arriving = randomUUID();
    await source.query(
      "INSERT INTO messages VALUES ($1,$2,'2026-09-20 12:00:02','inbound')",
      [arriving, lead],
    );
    expect(
      await service.markRead(tenant, user, lead, displayed, 0),
    ).toMatchObject({
      unreadCount: 1,
      isUnread: true,
      lastReadMessageId: displayed,
    });
  });

  it("never moves the watermark backwards under concurrent or delayed writes", async () => {
    await Promise.all([
      service.markRead(tenant, user, lead, second, 0),
      service.markRead(tenant, user, lead, first, 0),
      service.markRead(tenant, user, lead, third, 0),
    ]);
    expect(await service.markRead(tenant, user, lead, first, 0)).toMatchObject({
      lastReadMessageId: second,
      unreadCount: 0,
    });
  });

  it("preserves mark-unread against old page requests without rewinding the watermark", async () => {
    await service.markRead(tenant, user, lead, second, 0);
    expect(await service.markUnread(tenant, user, lead)).toMatchObject({
      isUnread: true,
      unreadVersion: 1,
      lastReadMessageId: second,
    });
    expect(await service.markRead(tenant, user, lead, third, 0)).toMatchObject({
      markedUnread: true,
      lastReadMessageId: second,
    });
    expect(await service.markRead(tenant, user, lead, third, 1)).toMatchObject({
      isUnread: false,
      lastReadMessageId: second,
    });
  });

  it("never reads unseen inbound messages through a later visible outbound reply", async () => {
    await service.markRead(tenant, user, lead, first, 0);
    // The second inbound arrived outside the rendered snapshot, before the
    // outbound reply. Only that reply has now been appended to the browser.
    expect(await service.markRead(tenant, user, lead, third, 0)).toMatchObject({
      lastReadMessageId: first,
      unreadCount: 1,
      isUnread: true,
    });
    await service.markUnread(tenant, user, lead);
    expect(await service.markRead(tenant, user, lead, third, 1)).toMatchObject({
      lastReadMessageId: first,
      markedUnread: false,
      unreadCount: 1,
    });
    // Outbound-only conversations still support manual unread/read toggling.
    await source.query("DELETE FROM messages WHERE direction = 'inbound'");
    await service.markUnread(tenant, peer, lead);
    expect(await service.markRead(tenant, peer, lead, third, 1)).toMatchObject({
      lastReadMessageId: null,
      markedUnread: false,
      isUnread: false,
    });
  });

  it("rejects foreign users, leads, and watermark messages before writing", async () => {
    await source.query("INSERT INTO messages VALUES ($1,$2,now(),'inbound')", [
      randomUUID(),
      otherLead,
    ]);
    await expect(
      service.markUnread(tenant, outsider, lead),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.markUnread(tenant, user, otherLead),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.markRead(otherTenant, outsider, otherLead, second, 0),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.markRead(tenant, user, lead, randomUUID(), 0),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.markRead(tenant, user, lead, first, -1),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.markUnread(tenant, "", lead)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(
      (
        await source.query(
          "SELECT count(*)::int AS count FROM conversation_read_states",
        )
      )[0].count,
    ).toBe(0);
    expect(await service.readStates(tenant, user, [otherLead])).toEqual([]);
  });

  it("supports migration reruns and rollback/reapply without deleting messages", async () => {
    await service.markRead(tenant, user, lead, second, 0);
    const runner = source.createQueryRunner();
    await runner.connect();
    try {
      await migration.up(runner);
      expect(
        (await service.readStates(tenant, user, [lead]))[0].lastReadMessageId,
      ).toBe(second);
      await migration.down(runner);
      expect(
        (await source.query("SELECT count(*)::int AS count FROM messages"))[0]
          .count,
      ).toBe(3);
      await migration.up(runner);
      expect(
        (await service.readStates(tenant, user, [lead]))[0].unreadCount,
      ).toBe(2);
    } finally {
      await runner.release();
    }
  });
});
