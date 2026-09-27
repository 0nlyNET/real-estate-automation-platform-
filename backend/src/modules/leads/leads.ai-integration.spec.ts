import { MODULE_METADATA } from '@nestjs/common/constants';
import { LeadsModule } from './leads.module';
import { AiModule } from '../ai/ai.module';

/**
 * Regression test for the AI first-response launch blocker (2026-09-27).
 *
 * Root cause: LeadsModule did not import AiModule, so the @Optional()
 * AiConversationService in LeadsService was injected as `undefined`.
 * leads.intake() called `this.aiConversation?.acceptLead()` which silently
 * evaluated to `undefined` — no AI run was ever created, no first-response
 * email was ever sent, and the controlled test runs stayed stuck at
 * `outbound: "awaiting_provider_callbacks"`.
 *
 * This test ensures LeadsModule imports AiModule (via forwardRef) so the
 * AiConversationService is available for lead intake.
 */
describe('LeadsModule AI integration', () => {
  it('imports AiModule so AiConversationService is injectable', () => {
    const imports: unknown[] = Reflect.getMetadata(MODULE_METADATA.IMPORTS, LeadsModule) || [];

    // The import uses forwardRef(() => AiModule) to avoid circular dependency
    // issues. Resolve forward refs to their target for the assertion.
    const resolved = imports.map((imp: any) => {
      // forwardRef() returns { forwardRef: () => Target }
      if (imp && typeof imp.forwardRef === 'function') {
        return imp.forwardRef();
      }
      return imp;
    });

    expect(resolved).toContain(AiModule);
  });
});
