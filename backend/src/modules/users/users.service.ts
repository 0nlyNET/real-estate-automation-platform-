import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import * as crypto from "crypto";
import { User } from "./user.entity";
import { UserRole } from "../../common/rbac";
import { Team } from "../teams/team.entity";
import { operationalEvent } from '../../common/operational-log';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

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
    if (!user) throw new BadRequestException("User not found");
    if (user.role === "owner" && actor?.role !== "owner") {
      throw new ForbiddenException("Only an owner can modify another owner");
    }
    return user;
  }

  async listByTenant(tenantId: string): Promise<User[]> {
    return await this.repo.find({
      where: { tenant: { id: tenantId } } as any,
      order: { email: "ASC" },
    });
  }

  async countActiveByTenant(tenantId: string): Promise<number> {
    return await this.repo.count({
      where: { tenant: { id: tenantId }, isActive: true } as any,
    });
  }

  async findByEmail(email: string): Promise<User | null> {
    try {
      return await this.repo.findOne({
        where: { email: email.toLowerCase().trim() },
      });
    } catch (error: any) {
      this.logger.error(
        operationalEvent('authentication_user_lookup_failed', {
          error: error?.message || error,
        }),
      );
      throw error;
    }
  }

  async findById(id: string): Promise<User | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async save(user: User): Promise<User> {
    return await this.repo.save(user);
  }

  async claimWelcomeEmail(userId: string) {
    const claimedAt = new Date();
    const result = await this.repo
      .createQueryBuilder()
      .update(User)
      .set({ welcomeEmailSentAt: claimedAt })
      .where('id = :userId', { userId })
      .andWhere('welcome_email_sent_at IS NULL')
      .execute();
    return result.affected === 1 ? claimedAt : null;
  }

  async releaseWelcomeEmail(userId: string, claimedAt: Date) {
    await this.repo
      .createQueryBuilder()
      .update(User)
      .set({ welcomeEmailSentAt: null })
      .where('id = :userId', { userId })
      .andWhere('welcome_email_sent_at = :claimedAt', { claimedAt })
      .execute();
  }

  async verifyEmail(token: string): Promise<User> {
    const t = token.trim();
    if (!t) throw new BadRequestException("Missing token");

    const tokenHash = crypto.createHash("sha256").update(t).digest("hex");
    const user = await this.repo.findOne({
      where: { emailVerifyToken: tokenHash },
    });
    if (!user) throw new BadRequestException("Invalid token");

    if (
      user.emailVerifyTokenExpiresAt &&
      user.emailVerifyTokenExpiresAt.getTime() < Date.now()
    ) {
      throw new BadRequestException("Token expired");
    }

    user.isEmailVerified = true;
    user.emailVerifyToken = null;
    user.emailVerifyTokenExpiresAt = null;

    return await this.repo.save(user);
  }

  async updateRole(
    tenantId: string,
    userId: string,
    role: UserRole,
    actor?: { userId?: string; role?: UserRole },
  ) {
    const user = await this.requireManageableTarget(tenantId, userId, actor);
    user.role = role;
    return await this.repo.save(user);
  }

  async updateTeam(
    tenantId: string,
    userId: string,
    teamId: string | null,
    actor?: { userId?: string; role?: UserRole },
  ) {
    const user = await this.requireManageableTarget(tenantId, userId, actor);
    if (teamId) {
      const team = await this.teamRepo.findOne({
        where: { id: teamId, tenantId },
      });
      if (!team)
        throw new BadRequestException("Team must belong to this tenant");
    }
    user.teamId = teamId;
    return await this.repo.save(user);
  }

  async setActive(
    tenantId: string,
    userId: string,
    isActive: boolean,
    actor?: { userId?: string; role?: UserRole },
  ) {
    const user = await this.requireManageableTarget(tenantId, userId, actor);
    if (!isActive && actor?.userId === userId)
      throw new BadRequestException("You cannot deactivate your own account");
    user.isActive = isActive;
    return await this.repo.save(user);
  }
}
