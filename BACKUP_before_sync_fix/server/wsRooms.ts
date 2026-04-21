/**
 * WebSocket room naming utilities
 * Provides consistent room naming for conversation threads and company-wide broadcasts
 */

export const threadRoom = (companyId: number | string, pairKey: string): string =>
  `company:${companyId}:thread:${pairKey}`;

export const companyRoom = (companyId: number | string): string =>
  `company:${companyId}`;

export const conversationRoom = (conversationId: number): string =>
  `conversation:${conversationId}`;
