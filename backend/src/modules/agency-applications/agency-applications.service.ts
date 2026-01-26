import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyApplication } from './agency-application.entity';
import { CreateAgencyApplicationDto } from './dto/create-agency-application.dto';

@Injectable()
export class AgencyApplicationsService {
  constructor(
    @InjectRepository(AgencyApplication)
    private readonly applicationsRepository: Repository<AgencyApplication>,
  ) {}

  private normalizeString(value?: string) {
    if (value === undefined || value === null) return undefined;
    const normalized = String(value).trim();
    return normalized || undefined;
  }

  private normalizeEmail(value?: string) {
    const normalized = this.normalizeString(value)?.toLowerCase();
    return normalized || undefined;
  }

  async create(payload: CreateAgencyApplicationDto, userAgent?: string) {
    const fullName = this.normalizeString(payload.fullName);
    const email = this.normalizeEmail(payload.email);

    if (!fullName) throw new Error('fullName is required');
    if (!email) throw new Error('email is required');

    const application = this.applicationsRepository.create({
      fullName,
      email,
      phone: this.normalizeString(payload.phone),
      company: this.normalizeString(payload.company),
      teamSize: this.normalizeString(payload.teamSize),
      leadSources: this.normalizeString(payload.leadSources),
      notes: this.normalizeString(payload.notes),
      sourcePage: this.normalizeString(payload.sourcePage),
      userAgent: this.normalizeString(userAgent),
      status: 'new',
    });

    const saved = await this.applicationsRepository.save(application);

    return { id: saved.id, status: 'ok' };
  }
}
