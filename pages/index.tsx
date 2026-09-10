import Head from 'next/head';
import HOODLABS from '../src/hoodlaunch';
export default function Home({ launchEnabled }: { launchEnabled: boolean }) {
 return <><Head><title>HOODLABS · PONS token launchpad</title><meta name="description" content="Create your token on Robinhood Chain. Free launching with a connected wallet and optional Pro wallet tools." /></Head><HOODLABS launchEnabled={launchEnabled} /></>;
}
export async function getServerSideProps() { return { props: { launchEnabled: process.env.LIVE_LAUNCH_ENABLED === 'true' } }; }
