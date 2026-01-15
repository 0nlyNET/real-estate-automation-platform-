import { IsIn, IsOptional, IsString } from 'class-validator';

export class CheckoutSessionDto {
  @IsIn(['pro', 'teams'])
  plan!: 'pro' | 'teams';

  @IsIn(['month', 'year'])
  interval!: 'month' | 'year';
}

export class PortalSessionDto {
  @IsString()
  @IsOptional()
  returnUrl?: string;
}
