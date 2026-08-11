import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DurableJob } from './durable-job.entity';
import { DurableJobsService } from './durable-jobs.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([DurableJob])],
  providers: [DurableJobsService],
  exports: [DurableJobsService],
})
export class DurableJobsModule {}
