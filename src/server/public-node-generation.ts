import type { NextApiRequest, NextApiResponse } from 'next';
import { account, database, getProStatus, takeQuota } from './public-services';
import { digest, fail, jsonBody, readToken, writeGuard } from './public-security';

export async function handleNodeGeneration(req: NextApiRequest, res: NextApiResponse) {
  writeGuard(req);
  if (process.env.NODE_GENERATION_ENABLED !== 'true') fail(503, 'GENERATION_UNAVAILABLE', 'Wallet generation is not enabled yet.');
  const body = await jsonBody(req);
  const allowed = body.action === 'status' ? ['action'] : ['action', 'requestId', 'count'];
  if (Object.keys(body).some(key => !allowed.includes(key)) || (body.action !== 'status' && body.action !== 'reserve')) fail(400, 'REQUEST', 'Invalid generation request.');
  if (body.action === 'reserve' && (typeof body.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.requestId) || !Number.isInteger(body.count) || Number(body.count)<1 || Number(body.count)>50)) fail(400, 'REQUEST', 'Choose a valid wallet count and request.');
  const id = (await account(req))!;
  const token = readToken(req);
  if (!token) fail(401, 'SIGN_IN', 'Sign in before creating a wallet.');
  const session = digest(token);
  await takeQuota(`node-generation:${id}`, 120, 3600);
  const db = database();
  // Capture the holder proof before verification; a later unlink/reverify must not
  // turn an earlier holder result into authority for a new attempt.
  let holderContext: { address?: string; proof_id?: string } | null = null;
  try {
    const result = await db.rpc('hood_holder_context', {p_user:id,p_session:session});
    if (!result.error) holderContext = result.data;
  } catch { /* A verified subscription remains independent of holder lookup failure. */ }
  const status = await getProStatus(id, session);
  const pro = status.pro === true;
  const checkedAt = new Date().toISOString();
  const holderStamp = pro && (status.holder?.eligible === true || status.holder?.granted === true) && typeof holderContext?.proof_id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(holderContext.proof_id) && typeof holderContext.address === 'string' && /^0x[0-9a-f]{40}$/.test(holderContext.address) && status.holder.address?.toLowerCase() === holderContext.address;

  if (body.action === 'status') {
    const { data, error } = await db.rpc('hood_node_generation_status', { p_user:id, p_session:session });
    if (error || !data || typeof data.available !== 'boolean' || !(data.nextEligibleAt === null || validDate(data.nextEligibleAt))) fail(503,'GENERATION_UNAVAILABLE','Wallet allowance could not be checked.');
    res.json({ enabled:true, maxCount:pro?50:1, available:pro || data.available, nextEligibleAt:pro?null:data.nextEligibleAt }); return;
  }
  const {data,error} = await db.rpc('hood_node_generation_reserve', {p_user:id,p_session:session,p_request:body.requestId,p_count:body.count,p_pro:pro,p_holder_proof:holderStamp?holderContext!.proof_id:null,p_holder_address:holderStamp?holderContext!.address:null,p_subscription:pro && status.subscription === true,p_checked_at:checkedAt});
  if (error || !data || typeof data.reserved !== 'boolean') fail(503,'GENERATION_UNAVAILABLE','Generation status is unknown. Retry the same request.');
  if (!data.reserved) {
    if (data.code === 'PRO_REQUIRED') fail(403,'PRO_REQUIRED','Free accounts can create one wallet every 24 hours.');
    if (!validDate(data.nextEligibleAt)) fail(503,'GENERATION_UNAVAILABLE','Wallet allowance could not be checked.');
    res.status(429).json({code:'GENERATION_COOLDOWN',error:'Your free wallet allowance resets 24 hours after your last generation attempt.',nextEligibleAt:data.nextEligibleAt}); return;
  }
  if (data.requestId?.toLowerCase() !== String(body.requestId).toLowerCase() || data.count !== body.count || !validDate(data.reservedAt) || !(data.nextEligibleAt === null || validDate(data.nextEligibleAt))) fail(503,'GENERATION_UNAVAILABLE','Generation status is unknown. Retry the same request.');
  res.json(data);
}
function validDate(value: unknown): value is string { return typeof value === 'string' && value.length<50 && Number.isFinite(Date.parse(value)); }
