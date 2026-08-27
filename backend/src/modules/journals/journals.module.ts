import { Module } from '@nestjs/common';
import { JournalsController } from './journals.controller';
import { JournalsService } from './journals.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [JournalsController],
  providers: [JournalsService, PermissionsGuard],
  exports: [JournalsService],
})
export class JournalsModule {}
