import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ChatbotService } from './chatbot.service';

@Controller('chatbot')
export class ChatbotController {
  constructor(private readonly service: ChatbotService) {}

  @Get('tools')
  tools() {
    return this.service.listTools();
  }

  @Post('chat')
  chat(@Body() body: { message: string; history?: { role: string; content: string }[] }) {
    return this.service.chat(body?.message ?? '', body?.history);
  }

  @Post('sessions')
  create(@Body() body: { title?: string }) {
    return this.service.createSession(body?.title);
  }

  @Get('sessions')
  list() {
    return this.service.listSessions();
  }

  @Get('sessions/:id/messages')
  messages(@Param('id') id: string) {
    return this.service.getMessages(id);
  }

  @Post('sessions/:id/messages')
  send(@Param('id') id: string, @Body() body: { content: string }) {
    return this.service.sendMessage(id, body?.content ?? '');
  }
}
