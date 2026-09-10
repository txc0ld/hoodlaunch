import { useState } from 'react';
import PonsLaunchpad from './components/PonsLaunchpad';
import ProAccess from './components/ProAccess';
export default function Hoodlaunch({ launchEnabled = false, generationEnabled = false }: { launchEnabled?: boolean; generationEnabled?: boolean }) {
 const [pro, setPro] = useState(false);
 const [sessionIdentity, setSessionIdentity] = useState<string | null>(null);
 return <PonsLaunchpad proEnabled={pro} launchEnabled={launchEnabled} generationEnabled={generationEnabled} sessionIdentity={sessionIdentity} proPanel={<ProAccess salesEnabled={launchEnabled} onAccessChange={setPro} onSessionIdentityChange={setSessionIdentity} />} />;
}
