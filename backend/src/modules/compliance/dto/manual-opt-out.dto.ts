import { IsIn, IsOptional, IsString } from 'class-validator';

export class ManualOptOutDto {
  @IsIn(['sms', 'email'])
  channel: 'sms' | 'email';

  @IsString()
  target: string;

  @IsOptional()
  @IsString()
  source?: string;
}
