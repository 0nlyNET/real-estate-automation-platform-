import { MODULE_METADATA } from '@nestjs/common/constants';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from './common.module';

describe('CommonModule', () => {
  it('exports the tenant repository used by TeamsPlanGuard', () => {
    const exports = Reflect.getMetadata(MODULE_METADATA.EXPORTS, CommonModule);

    expect(exports).toContain(TypeOrmModule);
  });
});
