import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PlatformOperatorGuard } from '../../common/guards/platform-operator.guard';
import { OperationsService } from './operations.service';
import { UpdateOperationsTaskDto } from './operations.dto';

@Controller('admin/operations')
@UseGuards(JwtAuthGuard, PlatformOperatorGuard)
export class OperationsController {
  constructor(private readonly operations: OperationsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('category') category?: string,
    @Query('tenantId') tenantId?: string,
    @Query('priority') priority?: string,
    @Query('overdue') overdue?: string,
    @Query('take') take?: string,
    @Query('skip') skip?: string,
  ) {
    return this.operations.list({
      status,
      category,
      tenantId,
      priority,
      overdue: overdue === 'true',
      take: Number(take || 50),
      skip: Number(skip || 0),
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateOperationsTaskDto) {
    return this.operations.updateTask(id, {
      ...dto,
      dueAt:
        dto.dueAt === undefined
          ? undefined
          : dto.dueAt
            ? new Date(dto.dueAt)
            : null,
    });
  }
}
