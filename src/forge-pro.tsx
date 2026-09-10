import { useState } from 'react';
import PonsLaunchpad from './components/PonsLaunchpad';
import ProAccess from './components/ProAccess';
export default function ForgePro({ launchEnabled = false }: { launchEnabled?: boolean }) {
 const [pro, setPro] = useState(false);
 return <PonsLaunchpad proEnabled={pro} launchEnabled={launchEnabled} proPanel={<ProAccess onAccessChange={setPro} />} />;
}
