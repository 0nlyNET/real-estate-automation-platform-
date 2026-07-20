import { IsIn, IsOptional } from 'class-validator';

export class CheckoutSessionDto {
  // Accepted only for compatibility with older clients. The server always uses
  // the single RealtyTechAI monthly service configured for this release.
  @IsOptional() @IsIn(['pro', 'teams']) plan?: 'pro' | 'teams';
  @IsOptional() @IsIn(['month', 'year']) interval?: 'month' | 'year';
}
