import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from './user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {}

  findByEmail(email: string) {
    return this.usersRepository.findOne({ where: { email } });
  }

  async createAdminIfMissing(email: string, password: string) {
    const existing = await this.findByEmail(email);
    if (existing) return existing;

    const passwordHash = await bcrypt.hash(password, 12);
    const user = this.usersRepository.create({
      email,
      passwordHash,
      role: 'admin',
    });
    return this.usersRepository.save(user);
  }

  async createUser(params: { email: string; password: string; role?: 'admin' | 'agent'; tenantId?: string }) {
    const existing = await this.findByEmail(params.email);
    if (existing) return existing;

    const passwordHash = await bcrypt.hash(params.password, 12);
    const user = this.usersRepository.create({
      email: params.email,
      passwordHash,
      role: params.role ?? 'agent',
      tenantId: params.tenantId,
    });
    return this.usersRepository.save(user);
  }


  async setPassword(user: User, newPassword: string) {
    const passwordHash = await bcrypt.hash(newPassword, 12);
    (user as any).passwordHash = passwordHash;
    return this.usersRepository.save(user);
  }

  async validatePassword(user: User, password: string) {
    return bcrypt.compare(password, user.passwordHash);
  }
}
