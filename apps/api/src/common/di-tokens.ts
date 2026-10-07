/**
 * Catálogo de tokens de inyección de NestJS.
 *
 * Los puertos del dominio son `interface`, que no existen en tiempo de
 * ejecución: para inyectarlos por tipo se necesita un token. Se usan
 * constantes de string en vez de las clases concretas de infraestructura para
 * que la capa de aplicación no importe adaptadores
 * (dependency-rules.md §2: Application → Domain, nunca Infrastructure).
 *
 * El binding se hace con `useExisting` sobre el proveedor real, de modo que
 * sigue habiendo una única instancia por puerto.
 */
export const ACCESS_TOKEN_ISSUER = "ACCESS_TOKEN_ISSUER";
export const CONVERSATION_REPOSITORY = "CONVERSATION_REPOSITORY";
export const DEPENDENCY_PROBE = "DEPENDENCY_PROBE";
export const DEPENDENCY_PROBES = "DEPENDENCY_PROBES";
export const EMAIL_SENDER = "EMAIL_SENDER";
export const INVITATION_REPOSITORY = "INVITATION_REPOSITORY";
export const LLM_PROVIDER = "LLM_PROVIDER";
export const MEMBERSHIP_REPOSITORY = "MEMBERSHIP_REPOSITORY";
export const ID_GENERATOR = "ID_GENERATOR";
export const OPAQUE_TOKEN_GENERATOR = "OPAQUE_TOKEN_GENERATOR";
export const PASSWORD_HASHER = "PASSWORD_HASHER";
export const PASSWORD_RESET_TOKEN_REPOSITORY = "PASSWORD_RESET_TOKEN_REPOSITORY";
export const REFRESH_TOKEN_REPOSITORY = "REFRESH_TOKEN_REPOSITORY";
export const TENANT_REPOSITORY = "TENANT_REPOSITORY";
export const TOKEN_HASHER = "TOKEN_HASHER";
export const UNIT_OF_WORK = "UNIT_OF_WORK";
export const USER_REPOSITORY = "USER_REPOSITORY";
export const VERIFICATION_TOKEN_REPOSITORY = "VERIFICATION_TOKEN_REPOSITORY";
export const WHATSAPP_ACCOUNT_REPOSITORY = "WHATSAPP_ACCOUNT_REPOSITORY";
export const WHATSAPP_EVENT_REPOSITORY = "WHATSAPP_EVENT_REPOSITORY";
export const WHATSAPP_PROVIDER = "WHATSAPP_PROVIDER";
export const WHATSAPP_EVENT_QUEUER = "WHATSAPP_EVENT_QUEUER";
export const WHATSAPP_WEBHOOK_LOGGER = "WHATSAPP_WEBHOOK_LOGGER";
export const LLM_JOB_QUEUER = "LLM_JOB_QUEUER";
export const LLM_RUN_REPOSITORY = "LLM_RUN_REPOSITORY";

export const PORT_TOKENS = {
  accessTokenIssuer: ACCESS_TOKEN_ISSUER,
  conversationRepository: CONVERSATION_REPOSITORY,
  dependencyProbe: DEPENDENCY_PROBE,
  dependencyProbes: DEPENDENCY_PROBES,
  emailSender: EMAIL_SENDER,
  invitationRepository: INVITATION_REPOSITORY,
  llmProvider: LLM_PROVIDER,
  llmJobQueuer: LLM_JOB_QUEUER,
  llmRunRepository: LLM_RUN_REPOSITORY,
  membershipRepository: MEMBERSHIP_REPOSITORY,
  idGenerator: ID_GENERATOR,
  opaqueTokenGenerator: OPAQUE_TOKEN_GENERATOR,
  passwordHasher: PASSWORD_HASHER,
  passwordResetTokenRepository: PASSWORD_RESET_TOKEN_REPOSITORY,
  refreshTokenRepository: REFRESH_TOKEN_REPOSITORY,
  tenantRepository: TENANT_REPOSITORY,
  tokenHasher: TOKEN_HASHER,
  unitOfWork: UNIT_OF_WORK,
  userRepository: USER_REPOSITORY,
  verificationTokenRepository: VERIFICATION_TOKEN_REPOSITORY,
  whatsappAccountRepository: WHATSAPP_ACCOUNT_REPOSITORY,
  whatsappEventRepository: WHATSAPP_EVENT_REPOSITORY,
  whatsappEventQueuer: WHATSAPP_EVENT_QUEUER,
  whatsappProvider: WHATSAPP_PROVIDER,
  whatsappWebhookLogger: WHATSAPP_WEBHOOK_LOGGER,
} as const;
