import { randomUUID } from "node:crypto";
import { Injectable, type NestMiddleware } from "@nestjs/common";
import type { NextFunction, Request, Response } from "express";
import { correlationContext } from "./async-context";

const REQUEST_ID_HEADER = "x-request-id";

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header(REQUEST_ID_HEADER);
    const requestId =
      typeof incoming === "string" && incoming.trim().length > 0
        ? incoming
        : randomUUID();

    res.setHeader(REQUEST_ID_HEADER, requestId);

    correlationContext.run({ id: requestId }, () => {
      next();
    });
  }
}