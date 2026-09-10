import { handleNodeGeneration } from '../../src/server/public-node-generation';
import { safeHandler } from '../../src/server/public-security';
export const config = { api: { bodyParser: false }, maxDuration: 60 };
export default safeHandler(handleNodeGeneration);
