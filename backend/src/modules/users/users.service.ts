import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User } from './user.entity';
import { Tenant } from '../tenants/tenant.entity';
import { planHasTeamsFeatures, planSeatLimit } from '../../common/plans';
import { UserRole } from '../../common/rbac';
import { Team } from '../teams/team.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User) private readonly repo: Repository<User>,
    @InjectRepository(Team) private readonly teamRepo: Repository<Team>,
  ) {}

  private async requireManageableTarget(
    tenantId: string,
    userId: string,
    actor?: { userId?: string; role?: UserRole },
  ) {
    const user = await this.repo.findOne({ where: { id: userId, tenantId } });
    if (!user) throw new BadRequestException('User not found');
    if (user.role === 'owner' && actor?.role !== 'owner') {
      throw new ForbiddenException('Only an owner can modify another owner');
    }
    return user;
  }

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

    const passwordHash = await bcrypt.hash(params.password, 12);
    const verifyToken = crypto.randomBytes(32).toString('hex');
    const verifyTokenHash = crypto.createHash('sha256').update(verifyToken).digest('hex');
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000);

    const user = this.repo.create({
      email,
      passwordHash,
      isEmailVerified: false,
      emailVerifyToken: verifyTokenHash,
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

    const tokenHash = crypto.createHash('sha256').update(t).digest('hex');
    const user = await this.repo.findOne({
      where: [{ emailVerifyToken: tokenHash }, { emailVerifyToken: t }] as any,
    });
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

    if (params.teamId) {
      const team = await this.teamRepo.findOne({ where: { id: params.teamId, tenantId: params.tenant.id } });
      if (!team) throw new BadRequestException('Team must belong to this tenant');
    }

    return await this.createUser({
      tenant: params.tenant,
      email: params.email,
      password: params.tempPassword,
      role: params.role,
      teamId: params.teamId ?? null,
    });
  }

  async updateRole(tenantId: string, userId: string, role: UserRole, actor?: { userId?: string; role?: UserRole }) {
    const user = await this.requireManageableTarget(tenantId, userId, actor);
    user.role = role;
    return await this.repo.save(user);
  }

  async updateTeam(tenantId: string, userId: string, teamId: string | null, actor?: { userId?: string; role?: UserRole }) {
    const user = await this.requireManageableTarget(tenantId, userId, actor);
    if (teamId) {
      const team = await this.teamRepo.findOne({ where: { id: teamId, tenantId } });
      if (!team) throw new BadRequestException('Team must belong to this tenant');
    }
    user.teamId = teamId;
    return await this.repo.save(user);
  }

  async setActive(tenantId: string, userId: string, isActive: boolean, actor?: { userId?: string; role?: UserRole }) {
    const user = await this.requireManageableTarget(tenantId, userId, actor);
    if (!isActive && actor?.userId === userId) throw new BadRequestException('You cannot deactivate your own account');
    user.isActive = isActive;
    return await this.repo.save(user);
  }
}
