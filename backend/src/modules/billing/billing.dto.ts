import { IsIn } from 'class-validator';

export class CheckoutSessionDto {
  @IsIn(['pro', 'teams']) plan!: 'pro' | 'teams';
  @IsIn(['month', 'year']) interval!: 'month' | 'year';
}
