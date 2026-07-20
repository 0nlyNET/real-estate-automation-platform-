import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { User } from '../modules/users/user.entity';
import { platformAdminEmails, platformStaffEmails, resolvePlatformRole } from './env';

@Injectable()
export class PlatformOperatorsService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  private configuredEmails() {
    return [...new Set([...platformAdminEmails(), ...platformStaffEmails()])];
  }

  async listActive() {
    const emails = this.configuredEmails();
    const users = await this.users.find({
      where: [
        ...(emails.length ? [{ email: In(emails), isActive: true, isEmailVerified: true }] : []),
        { platformRole: 'staff', isActive: true, isEmailVerified: true },
      ],
      order: { email: 'ASC' },
    });
    return users
      .map((user) => ({
        id: user.id,
        email: user.email,
        platformRole: resolvePlatformRole(user.email, user.platformRole),
      }))
      .filter((user) => user.platformRole !== null);
  }

  async requireAssignable(id?: string | null) {
    if (id === null || id === undefined || id === '') return null;
    const user = await this.users.findOne({ where: { id } });
    if (
      !user ||
      !user.isActive ||
      !user.isEmailVerified ||
      !resolvePlatformRole(user.email, user.platformRole)
    ) {
      throw new BadRequestException('Assigned operator is not an active platform user');
    }
    return user;
  }
}
