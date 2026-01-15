import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import * as crypto from 'crypto';
import { User } from './user.entity';
import { Tenant } from '../tenants/tenant.entity';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly repo: Repository<User>) {}

  async findByEmail(email: string): Promise<User | null> {
    return await this.repo.findOne({ where: { email: email.toLowerCase().trim() } });
  }

  async findById(id: string): Promise<User | null> {
    return await this.repo.findOne({ where: { id } });
  }

  async createUser(params: { email: string; password: string; tenant: Tenant }): Promise<{ user: User; verifyToken: string }> {
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
    });

    return { user: await this.repo.save(user), verifyToken };
  }

  async validatePassword(user: User, password: string): Promise<boolean> {
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
}
