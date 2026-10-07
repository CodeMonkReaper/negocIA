import { Inject, Injectable } from "@nestjs/common";
import { WHATSAPP_ACCOUNT_REPOSITORY } from "../../../common/di-tokens";
import type { WhatsappAccountRepository } from "../../../domain/ports/whatsapp-account-repository";
import type { WhatsappAccountRecord } from "../../../domain/whatsapp/entities";

export interface ConnectWhatsappAccountInput {
  tenantId: string;
  wabaId: string;
  phoneNumberId: string;
  displayPhone?: string | null;
  accessToken: string;
}

/**
 * Alta manual de una cuenta de WhatsApp (F2-3, M7).
 *
 * Sin magia en esta versión: persiste la cuenta que el OWNER registró en Meta
 * Developer. El 409 por duplicado (mismo WABA o mismo número en el tenant)
 * lo lanza el repositorio traduciendo el conflicto de unicidad.
 */
@Injectable()
export class WhatsappAccountsService {
  constructor(
    @Inject(WHATSAPP_ACCOUNT_REPOSITORY)
    private readonly accounts: WhatsappAccountRepository,
  ) {}

  async connect(
    input: ConnectWhatsappAccountInput,
  ): Promise<WhatsappAccountRecord> {
    return this.accounts.create({
      tenantId: input.tenantId,
      wabaId: input.wabaId,
      phoneNumberId: input.phoneNumberId,
      displayPhone: input.displayPhone ?? null,
      accessToken: input.accessToken,
    });
  }

  async listByTenant(tenantId: string): Promise<WhatsappAccountRecord[]> {
    return this.accounts.listByTenant(tenantId);
  }
}