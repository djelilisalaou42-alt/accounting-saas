import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { LetteringService } from './lettering.service';
import { CreateLetteringDto } from './dto/create-lettering.dto';
import { ListLetteringDto } from './dto/list-lettering.dto';
import { UnletteredLinesQueryDto } from './dto/unlettered-lines-query.dto';
import { LetteringSuggestionsDto } from './dto/lettering-suggestions.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/require-permissions.decorator';
import { CurrentUser, AuthenticatedUser } from '../auth/decorators/current-user.decorator';

function extractMetadata(req: Request) {
  return { userAgent: req.headers['user-agent'], ipAddress: req.ips?.length ? req.ips[0] : req.ip };
}

@Controller('companies/:companyId')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class LetteringController {
  constructor(private readonly service: LetteringService) {}

  @RequirePermissions('LETTERING.READ')
  @Get('accounts/:accountId/unlettered-lines')
  async unletteredLines(
    @Param('companyId') companyId: string,
    @Param('accountId') accountId: string,
    @Query() query: UnletteredLinesQueryDto,
  ) {
    return this.service.listUnletteredLines(companyId, accountId, query);
  }

  @RequirePermissions('LETTERING.READ')
  @Get('lettering')
  async list(@Param('companyId') companyId: string, @Query() query: ListLetteringDto) {
    return this.service.list(companyId, query);
  }

  @RequirePermissions('LETTERING.READ')
  @Get('lettering/:id')
  async get(@Param('companyId') companyId: string, @Param('id') id: string) {
    return this.service.get(companyId, id);
  }

  @RequirePermissions('LETTERING.CREATE')
  @Post('lettering')
  async create(
    @Param('companyId') companyId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateLetteringDto,
    @Req() req: Request,
  ) {
    return this.service.create(companyId, user.id, dto, extractMetadata(req));
  }

  @RequirePermissions('LETTERING.CLOSE')
  @HttpCode(HttpStatus.OK)
  @Post('lettering/:id/close')
  async close(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.close(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('LETTERING.UNLETTER')
  @HttpCode(HttpStatus.OK)
  @Post('lettering/:id/unletter')
  async unletter(@Param('companyId') companyId: string, @Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Req() req: Request) {
    return this.service.unletter(companyId, id, user.id, extractMetadata(req));
  }

  @RequirePermissions('LETTERING.AUTO')
  @HttpCode(HttpStatus.OK)
  @Post('lettering/suggestions')
  async suggestions(@Param('companyId') companyId: string, @Body() dto: LetteringSuggestionsDto) {
    return this.service.suggestions(companyId, dto.accountId);
  }
}
