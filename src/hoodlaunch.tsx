import { useState } from 'react';
import PonsLaunchpad from './components/PonsLaunchpad';
import ProAccess from './components/ProAccess';
export default function Hoodlaunch({ launchEnabled = false, generationEnabled = false, nodeTradingEnabled = false, salesEnabled = false, financeEnabled = false }: { launchEnabled?: boolean; generationEnabled?: boolean; nodeTradingEnabled?: boolean; salesEnabled?: boolean; financeEnabled?: boolean }) {
 const [pro, setPro] = useState(false);
 const [sessionIdentity, setSessionIdentity] = useState<string | null>(null);
 return <PonsLaunchpad financeEnabled={financeEnabled} nodeTradingEnabled={nodeTradingEnabled} proEnabled={pro} launchEnabled={launchEnabled} generationEnabled={generationEnabled} sessionIdentity={sessionIdentity} proPanel={<ProAccess salesEnabled={salesEnabled} onAccessChange={setPro} onSessionIdentityChange={setSessionIdentity} />} />;
}
