import {
  Controller,
  Req,
  Sse,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from "@nestjs/swagger";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { Roles } from "../../common/guards/roles.decorator";
import type { Principal } from "../../domain/tenant-context";
import { RealtimeServer } from "./realtime-server";

/**
 * Stream Server-Sent Events del canal `negocia:realtime`. El cliente abre un
 * `GET /api/v1/events/stream` con el Bearer en el header (nativo `EventSource`
 * no puede mandar headers, así que el panel usa fetch + ReadableStream con
 * reconexión). Los guards globales corren por esta ruta, y el stream se filtra
 * por el `tenantId` del `Principal`: un evento de otro tenant nunca llega.
 *
 * Heartbeat cada 25s (`: keep-alive`) para que proxies y navegadores no maten
 * la conexión ociosa.
 */
@ApiTags("realtime")
@ApiBearerAuth()
@Roles("OWNER", "ADMIN", "AGENT")
@Controller("events")
export class RealtimeEventsController {
  constructor(private readonly server: RealtimeServer) {}

  @Sse("stream")
  @ApiOperation({
    summary: "Stream SSE de eventos del tenant",
    description:
      "El servidor emite `conversation.changed` (con `conversationId` cuando aplica) cada vez " +
      "que el canal o el motor de IA persisten algo nuevo; el cliente refresca su vista.",
  })
  @ApiResponse({ status: 200, description: "text/event-stream con heartbeat." })
  stream(@Req() request: Request): Observable<unknown> {
    const principal = request.principal as Principal;
    void this.server.connect();
    return this.server.stream(principal.tenantId);
  }
}