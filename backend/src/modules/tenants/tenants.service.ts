import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenants } from './tenant.entity';

@Injectable()
export class TenantsService {
  constructor(
    @InjectRepository(Tenants)
    private readonly tenantsRepository: Repository<Tenants>,
  ) {}

  async findById(id: string) {
  return this.tenantsRepository.findOne({
    where: { id },
  });
}
  async findBySlug(slug: string): Promise<Tenants | null> {
    return this.tenantsRepository.findOne({ where: { slug } });
  }

  async create(payload: Partial<Tenants>): Promise<Tenants> {
    const tenant = this.tenantsRepository.create(payload);
    return this.tenantsRepository.save(tenant);
  }
}
