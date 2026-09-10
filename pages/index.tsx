import Head from 'next/head';
import ForgePro from '../src/forge-pro';
export default function Home({ launchEnabled }: { launchEnabled: boolean }) {
 return <><Head><title>Hoodrich Launch · PONS token launchpad</title><meta name="description" content="Create your token on Robinhood Chain. Free launching with a connected wallet and optional Pro wallet tools." /></Head><ForgePro launchEnabled={launchEnabled} /></>;
}
export async function getServerSideProps() { return { props: { launchEnabled: process.env.LIVE_LAUNCH_ENABLED === 'true' } }; }
