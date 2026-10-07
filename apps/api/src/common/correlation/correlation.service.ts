import { Injectable } from "@nestjs/common";
import { getCorrelationId } from "./async-context";

@Injectable()
export class CorrelationService {
  getId(): string | undefined {
    return getCorrelationId();
  }
}