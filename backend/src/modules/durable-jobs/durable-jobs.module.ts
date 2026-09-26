import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DurableJob } from './durable-job.entity';
import { DurableJobsService } from './durable-jobs.service';
import { DurableJobSupervisorService } from './durable-job-supervisor.service';
import { WorkerHeartbeat } from './worker-heartbeat.entity';
import { WorkerHeartbeatService } from './worker-heartbeat.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([DurableJob, WorkerHeartbeat])],
  providers: [
    DurableJobsService,
    WorkerHeartbeatService,
    DurableJobSupervisorService,
  ],
  exports: [DurableJobsService, WorkerHeartbeatService, DurableJobSupervisorService],
})
export class DurableJobsModule {}
