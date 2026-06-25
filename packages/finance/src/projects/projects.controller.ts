import { Controller, Get, Param, Query } from '@nestjs/common';
import { ProjectsService } from './projects.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  list(@Query('status') status?: string, @Query('limit') limit?: string) {
    return this.service.list({ status, limit: limit ? Number(limit) : 100 });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }
}
