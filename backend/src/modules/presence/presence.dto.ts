import { IsIn } from 'class-validator';
import { PresenceStatus } from './agent-presence.entity';

export class PresenceStatusDto {
  @IsIn(['online', 'offline', 'away'])
  status!: PresenceStatus;
}
