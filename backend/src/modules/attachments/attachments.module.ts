import { Module } from '@nestjs/common';
import { AttachmentsController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';
import { PermissionsGuard } from '../../common/guards/permissions.guard';

@Module({
  controllers: [AttachmentsController],
  providers: [AttachmentsService, PermissionsGuard],
  exports: [AttachmentsService],
})
export class AttachmentsModule {}
