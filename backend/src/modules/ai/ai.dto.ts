import {
  IsArray,
  ArrayMinSize,
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsPhoneNumber,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { AiResponseMode } from './workspace-ai-settings.entity';

export class UpdateAiSettingsDto {
  @IsOptional()
  @IsBoolean()
  aiEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  aiFirstResponderEnabled?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['sms', 'email'], { each: true })
  allowedChannels?: Array<'sms' | 'email'>;

  @IsOptional()
  @IsIn(['professional_warm', 'concise', 'friendly'])
  tone?: 'professional_warm' | 'concise' | 'friendly';

  @IsOptional()
  @IsIn(['verified_link_only', 'handoff', 'disabled'])
  bookingBehavior?: 'verified_link_only' | 'handoff' | 'disabled';

  @IsOptional()
  @IsIn(['human_only', 'draft', 'controlled_autopilot'])
  responseMode?: AiResponseMode;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  identityLabel?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(25)
  maximumAutomaticTurns?: number;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(1)
  minimumConfidenceThreshold?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  allowedTopics?: string[];

  @IsOptional()
  @IsObject()
  escalationRules?: Record<string, unknown>;

  @IsOptional()
  @IsInt()
  @Min(1_000)
  @Max(1_000_000)
  perConversationUsageLimit?: number;

  @IsOptional()
  @IsInt()
  @Min(10_000)
  @Max(100_000_000)
  monthlyWorkspaceUsageLimit?: number;

  @IsOptional()
  @IsBoolean()
  confirmControlledAutopilot?: boolean;
}

export class ApprovedFaqDto {
  @IsString()
  @MaxLength(300)
  question!: string;

  @IsString()
  @MaxLength(2_000)
  answer!: string;
}

export class ApprovedAgentDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  id?: string;

  @IsString()
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  title?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceAreas?: string[];
}

export class UpdateBrokerageKnowledgeDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  publicName?: string;

  @IsOptional()
  @IsEmail()
  @MaxLength(255)
  officeEmail?: string;

  @IsOptional()
  @IsPhoneNumber()
  officePhone?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  serviceAreas?: string[];

  @IsOptional()
  @IsObject()
  businessHours?: Record<string, string>;

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  schedulingInstructions?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovedFaqDto)
  approvedFaqs?: ApprovedFaqDto[];

  @IsOptional()
  @IsString()
  @MaxLength(4_000)
  escalationInstructions?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  qualificationQuestions?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  prohibitedTopics?: string[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovedAgentDto)
  agentRoster?: ApprovedAgentDto[];

  @IsOptional()
  @IsObject()
  routingRules?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(2_000)
  requiredDisclaimer?: string;
}

export class ConfirmAiActionDto {
  @IsBoolean()
  confirmed!: boolean;
}

export class PauseAiDto {
  @IsBoolean()
  paused!: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  reason?: string;
}

export class TakeOverConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  reason?: string;
}

export class EditAiDraftDto {
  @IsString()
  @MaxLength(5_000)
  body!: string;
}
