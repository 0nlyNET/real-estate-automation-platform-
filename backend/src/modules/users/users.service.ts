import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User } from './user.entity';
import { Tenant } from '../tenants/tenant.entity';
import { planHasTeamsFeatures, planSeatLimit } from '../../common/plans';
import { UserRole } from '../../common/rbac';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  async listByTenant(tenantId: string): Promise<User[]> {
    return await this.repo.find({ where: { tenant: { id: tenantId } } as any, order: { email: 'ASC' } });
  }

  async countActiveByTenant(tenantId: string): Promise<number> {
    return await this.repo.count({ where: { tenant: { id: tenantId }, isActive: true } as any });
  }

  async findByEmail(email: string): Promise<User | null> {
    return await this.repo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  async findById(id: string): Promise<User | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async save(user: User): Promise<User> {
    return await this.repo.save(user);
  }

  async createUser(params: { email: string; password: string; tenant: Tenant; role?: UserRole; teamId?: string | null }): Promise<{ user: User; verifyToken: string }> {
    const email = params.email.toLowerCase().trim();
    const existing = await this.findByEmail(email);
    if (existing) throw new BadRequestException('Email already in use');

    const passwordHash = await bcrypt.hash(params.password, 10);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = this.repo.create({
      email,
      passwordHash,
      isEmailVerified: false,
      emailVerifyToken: verifyToken,
      emailVerifyTokenExpiresAt: expires,
      tenant: params.tenant,
      role: params.role || 'owner',
      teamId: params.teamId ?? null,
      isActive: true,
    });

    return { user: await this.repo.save(user), verifyToken };
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return await bcrypt.compare(password, user.passwordHash);
  }

  async verifyEmail(token: string): Promise<User> {
    const t = token.trim();
    if (!t) throw new BadRequestException('Missing token');

    const user = await this.repo.findOne({ where: { emailVerifyToken: t } });
    if (!user) throw new BadRequestException('Invalid token');

    if (user.emailVerifyTokenExpiresAt && user.emailVerifyTokenExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Token expired');
    }

    user.isEmailVerified = true;
    user.emailVerifyToken = null;
    user.emailVerifyTokenExpiresAt = null;

    return await this.repo.save(user);
  }

  async createTeamUser(params: {
    tenant: Tenant;
    email: string;
    tempPassword: string;
    role: UserRole;
    teamId?: string | null;
  }) {
    if (!planHasTeamsFeatures(params.tenant.plan)) {
      throw new BadRequestException('Adding team members requires the Teams plan');
    }

    const activeCount = await this.countActiveByTenant(params.tenant.id);
    const limit = planSeatLimit(params.tenant.plan);
    if (activeCount >= limit) {
      throw new BadRequestException(`Seat limit reached (${limit}). Upgrade your plan to add more users.`);
    }

    return await this.createUser({
      tenant: params.tenant,
      email: params.email,
      password: params.tempPassword,
      role: params.role,
      teamId: params.teamId ?? null,
    });
  }

  async updateRole(tenantId: string, userId: string, role: UserRole) {
    const user = await this.repo.findOne({ where: { id: userId, tenant: { id: tenantId } } as any });
    if (!user) throw new BadRequestException('User not found');
    user.role = role;
    return await this.repo.save(user);
  }

  async updateTeam(tenantId: string, userId: string, teamId: string | null) {
    const user = await this.repo.findOne({ where: { id: userId, tenant: { id: tenantId } } as any });
    if (!user) throw new BadRequestException('User not found');
    user.teamId = teamId;
    return await this.repo.save(user);
  }

  async setActive(tenantId: string, userId: string, isActive: boolean) {
    const user = await this.repo.findOne({ where: { id: userId, tenant: { id: tenantId } } as any });
    if (!user) throw new BadRequestException('User not found');
    user.isActive = isActive;
    return await this.repo.save(user);
  }
}
