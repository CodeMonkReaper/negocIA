import { type BadgeTone } from "@/components/ui";

export function accountStatusTone(status: string): BadgeTone {
  switch (status) {
    case "ACTIVE":
      return "green";
    case "TOKEN_EXPIRED":
      return "red";
    case "DISABLED":
      return "gray";
    default:
      return "gray";
  }
}

export function accountStatusLabel(status: string): string {
  switch (status) {
    case "ACTIVE":
      return "Activa";
    case "TOKEN_EXPIRED":
      return "Token vencido";
    case "DISABLED":
      return "Desactivada";
    default:
      return status;
  }
}

export function conversationStatusTone(status: string): BadgeTone {
  switch (status) {
    case "BOT_ACTIVE":
      return "green";
    case "HUMAN_ACTIVE":
      return "blue";
    case "HUMAN_REQUESTED":
      return "amber";
    case "CLOSED":
      return "gray";
    default:
      return "gray";
  }
}

export function conversationStatusLabel(status: string): string {
  switch (status) {
    case "BOT_ACTIVE":
      return "Bot activo";
    case "HUMAN_ACTIVE":
      return "Humano activo";
    case "HUMAN_REQUESTED":
      return "Reclama humano";
    case "CLOSED":
      return "Cerrada";
    default:
      return status;
  }
}

export function runStatusTone(status: string): BadgeTone {
  switch (status) {
    case "SUCCEEDED":
      return "green";
    case "FAILED":
      return "red";
    case "RUNNING":
      return "amber";
    case "SKIPPED":
      return "gray";
    default:
      return "gray";
  }
}