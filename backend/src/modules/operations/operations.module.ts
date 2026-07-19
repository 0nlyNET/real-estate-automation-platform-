import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CommonModule } from '../../common/common.module';
import { OperationsTask } from './operations-task.entity';
import { OperationsController } from './operations.controller';
import { OperationsService } from './operations.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([OperationsTask]), CommonModule],
  controllers: [OperationsController],
  providers: [OperationsService],
  exports: [OperationsService],
})
export class OperationsModule {}
