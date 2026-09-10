export type NodeAllowance = { sessionIdentity: string; available: boolean; maxCount: number; nextEligibleAt: string | null };
export class GenerationError extends Error {
  constructor(message: string, public code: string, public nextEligibleAt: string | null = null) { super(message); }
}
const date = (value: unknown): value is string => typeof value === 'string' && value.length < 50 && Number.isFinite(Date.parse(value));
export async function nodeGenerationRequest(sessionIdentity: string, attempt?: { requestId: string; count: number }) {
  const response = await fetch('/api/node-generation', {
    method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: attempt ? 'reserve' : 'status', expectedSessionIdentity: sessionIdentity, ...(attempt ? { requestId: attempt.requestId, count: attempt.count } : {}) }),
    signal: AbortSignal.timeout(25000),
  });
  const body = await response.json();
  if (!response.ok) throw new GenerationError(typeof body.error === 'string' ? body.error : 'Wallet allowance could not be checked.', String(body.code || ''), date(body.nextEligibleAt) ? body.nextEligibleAt : null);
  if (body.sessionIdentity !== sessionIdentity) throw new GenerationError('Your account session changed. Refresh before continuing.', 'SESSION_CHANGED');
  if (attempt) {
    if (body.reserved !== true || body.requestId !== attempt.requestId || body.count !== attempt.count || !date(body.reservedAt) || !(body.nextEligibleAt === null || date(body.nextEligibleAt))) throw new GenerationError('Generation status is unknown. Retry the same request.', 'UNKNOWN');
  } else if (body.enabled !== true || typeof body.available !== 'boolean' || ![1, 50].includes(body.maxCount) || !(body.nextEligibleAt === null || date(body.nextEligibleAt))) {
    throw new GenerationError('Wallet allowance could not be checked.', 'UNKNOWN');
  }
  return body as NodeAllowance;
}
