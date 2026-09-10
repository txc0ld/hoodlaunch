import Head from 'next/head';
import HOODLABS from '../src/hoodlaunch';
export default function Home({ launchEnabled }: { launchEnabled: boolean }) {
 return <><Head><title>HOODLABS · The token laboratory</title><meta name="description" content="Your token laboratory on Robinhood Chain. Design tokenomics, research approved quote assets, and prepare a PONS launch in one workspace." /><meta property="og:title" content="HOODLABS · The token laboratory" /><meta property="og:description" content="Experiment. Create. Launch. A new laboratory for tokens on Robinhood Chain." /><meta property="og:image" content="https://labs.hoodrich.rip/images/hoodlabs-specimen.webp" /><meta property="og:url" content="https://labs.hoodrich.rip" /><meta name="twitter:card" content="summary_large_image" /><link rel="icon" type="image/svg+xml" href="/favicon.svg" /></Head><HOODLABS launchEnabled={launchEnabled} /></>;
}
export async function getServerSideProps() { return { props: { launchEnabled: process.env.LIVE_LAUNCH_ENABLED === 'true' } }; }
