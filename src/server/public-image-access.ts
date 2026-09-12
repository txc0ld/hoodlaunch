import type { NextApiRequest } from 'next';
import { account, getProStatus, takeQuota } from './public-services';
import { digest, fail, readToken } from './public-security';

export type PublicImageAccess = { userId: string; pro: boolean };

export async function resolvePublicImageAccess(req: NextApiRequest): Promise<PublicImageAccess> {
  const userId = (await account(req))!;
  const token = readToken(req);
  if (!token) fail(401, 'SIGN_IN', 'Sign in to upload an image.');

  // Entitlement reads are separately bounded because denied upload attempts have not
  // reached the daily admission buckets yet. Failure never promotes a Free account.
  await takeQuota(`pro-check:${userId}`, 120, 3600);
  let pro = false;
  try {
    pro = (await getProStatus(userId, digest(token))).pro === true;
  } catch {
    // Free uploads do not depend on healthy billing or holder providers.
  }
  return { userId, pro };
}

export async function reservePublicImageUpload(access: PublicImageAccess): Promise<void> {
  await takeQuota(`upload:${access.userId}`, access.pro ? 50 : 5, 86400);
  await takeQuota('upload-burst-global', 30, 60);
  await takeQuota('upload-global', 1000, 86400);
}
