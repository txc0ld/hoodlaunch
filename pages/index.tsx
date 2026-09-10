import Head from 'next/head';
import HOODLABS from '../src/hoodlaunch';
export default function Home({ launchEnabled, generationEnabled }: { launchEnabled: boolean; generationEnabled: boolean }) {
 return <><Head><title>HOODLABS · Plan, review and launch on PONS</title><meta name="description" content="Plan tokenomics, check current PONS terms, and prepare a token launch on Robinhood Chain from one clear workspace." /><meta property="og:title" content="HOODLABS · Built by HOODRICH" /><meta property="og:description" content="Plan the token. Check the terms. Prepare a launch on Robinhood Chain." /><meta property="og:image" content="https://labs.hoodrich.rip/images/hoodlabs-specimen.webp" /><meta property="og:url" content="https://labs.hoodrich.rip" /><meta name="twitter:card" content="summary_large_image" /><link rel="icon" type="image/svg+xml" href="/favicon.svg" /></Head><HOODLABS generationEnabled={generationEnabled} launchEnabled={launchEnabled} /></>;
}
export async function getServerSideProps() { return { props: { launchEnabled: process.env.LIVE_LAUNCH_ENABLED === 'true', generationEnabled: process.env.NODE_GENERATION_ENABLED === 'true' } }; }
