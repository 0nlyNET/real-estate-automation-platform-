import { ConversationInboxPagination1788220800001 } from './202609010001-conversation-inbox-pagination';

describe('ConversationInboxPagination migration', () => {
  it('adds indexes for latest-thread, older-history, and incremental-change reads', async () => {
    const queryRunner = { query: jest.fn().mockResolvedValue(undefined) };
    const migration = new ConversationInboxPagination1788220800001();

    await migration.up(queryRunner as any);

    const sql = queryRunner.query.mock.calls.map(([value]) => value).join('\n');
    expect(sql).toContain('IDX_messages_lead_created_id');
    expect(sql).toContain('"leadId", "created_at" DESC, "id" DESC');
    expect(sql).toContain('IDX_messages_lead_updated_id');
    expect(sql).toContain('"leadId", "updated_at" ASC, "id" ASC');
  });
});
