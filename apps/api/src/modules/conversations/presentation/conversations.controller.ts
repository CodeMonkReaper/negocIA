import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { ListResponse } from "@negocia/contracts";
import type { Request } from "express";
import { Roles } from "../../../common/guards/roles.decorator";
import type { Principal } from "../../../domain/tenant-context";
import { ConversationsService } from "../application/conversations.service";
import {
  toConversationResponseDto,
  toMessageResponseDto,
  type ConversationResponseDto,
  type MessageResponseDto,
} from "./conversation.mapper";
import { ListConversationsQueryDto } from "./dto/list-conversations-query.dto";
import {
  ConversationIdParamDto,
  ListMessagesQueryDto,
} from "./dto/conversation-param.dto";
import { SendMessageDto } from "./dto/send-message.dto";

/**
 * Lectura de conversaciones y mensajes del canal (F2-4, docs/api/conversations.md).
 *
 * Roles: cualquier miembro activo del tenant (AGENT, ADMIN u OWNER) — el Agente
 * de Atención es el consumidor natural del inbox. El id de la URL siempre se
 * filtra por el tenant del `Principal`: un id ajeno cae en 404 "no existe", nunca
 * en 403.
 *
 * Las transiciones de la máquina de estados no tienen endpoints en este hito
 * (llegan en F6-3 con el traspaso a humano): aquí solo se persiste y se lee.
 */
@ApiTags("conversations")
@ApiBearerAuth()
@Roles("OWNER", "ADMIN", "AGENT")
@Controller("conversations")
export class ConversationsController {
  constructor(private readonly conversations: ConversationsService) {}

  @Get()
  @ApiOperation({
    summary: "Conversaciones del tenant",
    description:
      "Lista paginada ordenada por último mensaje. `status` filtra por estado de la conversación.",
  })
  @ApiResponse({ status: 200, description: "Página de conversaciones." })
  async list(
    @Query() query: ListConversationsQueryDto,
    @Req() request: Request,
  ): Promise<ListResponse<ConversationResponseDto>> {
    const principal = request.principal as Principal;
    const page = await this.conversations.listByTenant(principal.tenantId, {
      limit: query.limit ?? 20,
      offset: query.offset ?? 0,
      status: query.status,
    });
    return {
      items: page.items.map(toConversationResponseDto),
      total: page.total,
    };
  }

  @Get(":id/messages")
  @ApiOperation({
    summary: "Mensajes de una conversación",
    description:
      "Página de mensajes en orden cronológico (asc). 404 si la conversación no existe en el tenant.",
  })
  @ApiResponse({ status: 200, description: "Página de mensajes." })
  @ApiResponse({ status: 404, description: "La conversación no existe en este tenant." })
  async listMessages(
    @Param() params: ConversationIdParamDto,
    @Query() query: ListMessagesQueryDto,
    @Req() request: Request,
  ): Promise<ListResponse<MessageResponseDto>> {
    const principal = request.principal as Principal;
    const page = await this.conversations.listMessages(
      principal.tenantId,
      params.id,
      {
        limit: query.limit ?? 20,
        offset: query.offset ?? 0,
      },
    );
    return {
      items: page.items.map(toMessageResponseDto),
      total: page.total,
    };
  }

  @Post(":id/messages")
  @ApiOperation({
    summary: "Enviar un mensaje de texto al cliente",
    description:
      "Envía el texto vía el proveedor de WhatsApp y persiste el OUTBOUND. " +
      "404 si la conversación no existe en el tenant o su cuenta dejó de estar activa; " +
      "502 si Meta rechaza el envío.",
  })
  @ApiResponse({ status: 201, description: "Mensaje enviado y persistido (OUTBOUND)." })
  @ApiResponse({ status: 400, description: "`text` vacío o superior a 4096 caracteres; `:id` no es uuid." })
  @ApiResponse({ status: 404, description: "La conversación no existe en este tenant." })
  @ApiResponse({ status: 502, description: "El proveedor de Meta rechazó el envío." })
  async sendMessage(
    @Param() params: ConversationIdParamDto,
    @Body() body: SendMessageDto,
    @Req() request: Request,
  ): Promise<MessageResponseDto> {
    const principal = request.principal as Principal;
    const message = await this.conversations.sendMessage({
      tenantId: principal.tenantId,
      conversationId: params.id,
      text: body.text,
    });
    return toMessageResponseDto(message);
  }
}