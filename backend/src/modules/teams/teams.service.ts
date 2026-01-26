import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Team } from './team.entity';

@Injectable()
export class TeamsService {
  constructor(@InjectRepository(Team) private readonly repo: Repository<Team>) {}

  async list(tenantId: string) {
    return await this.repo.find({ where: { tenantId }, order: { name: 'ASC' } });
  }

  async create(tenantId: string, name: string) {
    const cleaned = (name || '').trim();
    if (!cleaned) throw new BadRequestException('Team name is required');

    const existing = await this.repo.findOne({ where: { tenantId, name: cleaned } });
    if (existing) throw new BadRequestException('A team with that name already exists');

    const team = this.repo.create({ tenantId, name: cleaned });
    return await this.repo.save(team);
  }

  async rename(tenantId: string, teamId: string, name: string) {
    const cleaned = (name || '').trim();
    if (!cleaned) throw new BadRequestException('Team name is required');

    const team = await this.repo.findOne({ where: { id: teamId, tenantId } });
    if (!team) throw new BadRequestException('Team not found');

    team.name = cleaned;
    return await this.repo.save(team);
  }

  async remove(tenantId: string, teamId: string) {
    const team = await this.repo.findOne({ where: { id: teamId, tenantId } });
    if (!team) throw new BadRequestException('Team not found');
    await this.repo.remove(team);
    return { ok: true };
  }
}
