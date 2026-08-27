import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Request, Response } from 'express';
import { AttachmentsService } from './attachments.service';
import { CreateAttachmentDto, ListAttachmentsDto } from './dto/attachment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId/attachments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AttachmentsController {
  constructor(private readonly service: AttachmentsService) {}

  @RequirePermissions('ATTACHMENT.READ')
  @Get()
  async list(@Param('companyId') companyId: string, @Query() query: ListAttachmentsDto) {
    return this.service.list(companyId, query);
  }

  @RequirePermissions('ATTACHMENT.READ')
  @Get(':id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('ATTACHMENT.READ')
  @Get(':id/download')
  async download(@Param('companyId') companyId: string, @Param('id') id: string, @Res() res: Response) {
    const { buffer, fileName, mimeType } = await this.service.download(companyId, id);
    res.setHeader('Content-Type', mimeType);
    // encodeURIComponent : le nom original peut contenir des
    // caractères non-ASCII, jamais interpolé tel quel dans un en-tête.
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(fileName)}"`);
    res.send(buffer);
  }

  @RequirePermissions('ATTACHMENT.CREATE')
  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      // Mémoire, jamais disque temporaire non contrôlé : le service
      // valide MIME/taille/liens AVANT toute écriture, avec un nom de
      // fichier interne généré (jamais celui du client).
      storage: memoryStorage(),
      limits: { fileSize: Number(process.env.ATTACHMENTS_MAX_SIZE_BYTES ?? 10 * 1024 * 1024) },
    }),
  )
  async upload(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File,
    @Body() dto: CreateAttachmentDto,
    @Req() req: Request,
  ) {
    return this.service.upload(companyId, user.id, dto, file, extractMetadata(req));
  }

  @RequirePermissions('ATTACHMENT.DELETE')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Delete(':id')
  async remove(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    await this.service.remove(companyId, id, user.id, extractMetadata(req));
  }
}
