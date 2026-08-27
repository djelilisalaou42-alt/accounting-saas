import { Module } from '@nestjs/common';
import { LetteringController } from './lettering.controller';
import { LetteringService } from './lettering.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [LetteringController],
  providers: [LetteringService, PermissionsGuard],
  exports: [LetteringService],
})
export class LetteringModule {}
