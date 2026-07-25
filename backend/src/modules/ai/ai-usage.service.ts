import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiRun } from './ai-run.entity';
import { ConversationAiState } from './conversation-ai-state.entity';
import { WorkspaceAiSettings } from './workspace-ai-settings.entity';

@Injectable()
export class AiUsageService {
  constructor(
    @InjectRepository(AiRun)
    private readonly runs: Repository<AiRun>,
  ) {}

  async usageForWorkspace(tenantId: string, now = new Date()) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const raw = await this.runs
      .createQueryBuilder('run')
      .select('COALESCE(SUM(run.inputUsage), 0)', 'input')
      .addSelect('COALESCE(SUM(run.outputUsage), 0)', 'output')
      .addSelect('COALESCE(SUM(run.estimatedCostUsd), 0)', 'cost')
      .addSelect('COUNT(run.id)', 'runs')
      .where('run.tenantId = :tenantId', { tenantId })
      .andWhere('run.createdAt >= :monthStart', { monthStart })
      .getRawOne();
    const input = Number(raw?.input || 0);
    const output = Number(raw?.output || 0);
    return {
      monthStart: monthStart.toISOString(),
      input,
      output,
      total: input + output,
      estimatedCostUsd: Number(raw?.cost || 0),
      runs: Number(raw?.runs || 0),
    };
  }

  async evaluateLimits(
    settings: WorkspaceAiSettings,
    state: ConversationAiState,
  ) {
    const workspace = await this.usageForWorkspace(settings.tenantId);
    if (state.usageUnits >= settings.perConversationUsageLimit) {
      return {
        allowed: false,
        code: 'CONVERSATION_USAGE_LIMIT',
        reason: 'This conversation reached its AI usage limit.',
        workspace,
      };
    }
    if (workspace.total >= settings.monthlyWorkspaceUsageLimit) {
      return {
        allowed: false,
        code: 'WORKSPACE_USAGE_LIMIT',
        reason: 'This workspace reached its monthly AI usage limit.',
        workspace,
      };
    }
    return { allowed: true, code: null, reason: null, workspace };
  }

  estimateCost(inputUsage: number, outputUsage: number) {
    const inputRate = Number(process.env.AI_INPUT_COST_PER_MILLION_USD || 0);
    const outputRate = Number(process.env.AI_OUTPUT_COST_PER_MILLION_USD || 0);
    if (
      !Number.isFinite(inputRate) ||
      !Number.isFinite(outputRate) ||
      (inputRate <= 0 && outputRate <= 0)
    ) {
      return null;
    }
    return (
      (Math.max(inputUsage, 0) * Math.max(inputRate, 0) +
        Math.max(outputUsage, 0) * Math.max(outputRate, 0)) /
      1_000_000
    );
  }
}
