import Head from 'next/head';
import styles from '../src/components/Guide.module.css';
import { HOODRICH_MINIMUM_FORMATTED } from '../src/lib/pro-access';

const inputs = [
 ['Name / ticker', 'Public display values. Tickers are not unique; verify the contract address.'],
 ['Image', 'Signed-in Free and Pro accounts can upload a still PNG, JPEG or WebP up to 4MB. An existing public IPFS or HTTPS URI works without an account.'],
 ['Description / links', 'A public description up to 280 characters, website, and optional social links.'],
 ['Pair', 'Native ETH or a PONS-approved ERC-20 that passes factory, decimals, and economics checks.'],
 ['Configuration', 'An enabled PONS configuration. Review supply, graduation threshold, and current fees.'],
 ['Developer buy', 'Optional ETH for an ETH pair. Custom pairs force this to zero.'],
 ['Advanced', 'Supported PONS plan, fee recipient, creator tax, 0–2% slippage, buyback, socials, and tax exemptions.'],
];

export default function Guide() {
 return <main className={styles.page}>
  <Head><title>How to use HOODLABS · Account, token, wallets</title><meta name="description" content="Sign in, create a PONS token, and manage verified wallets and trades from HOODLABS." /></Head>
  <nav><a href="/">← HOODLABS</a><a href="/pro">Free vs Pro</a><a href="/security">Security</a></nav>
  <header><p className={styles.eyebrow}>THE HOODLABS GUIDE</p><h1>Account. Token. Wallets.</h1><p>Start with account access, configure the token using live PONS terms, then add verified wallets when needed.</p></header>
  <aside className={styles.contents} aria-label="Guide contents"><a href="#account">1. Account</a><a href="#create">2. Create</a><a href="#wallets">3. Wallets</a><a href="#trade">Trading</a><a href="#recovery">Recovery</a></aside>

  <section id="account"><h2>1. Connect your account</h2><p>Sign in with a wallet message or your existing email account. Account sign-in and HOODRICH holder proof use separate messages. Neither sends a transaction or token approval.</p><p>Signed-in Free accounts receive five managed image-upload attempts per day and one wallet creation every 24 hours when available. Pro raises these to 50 daily uploads and up to 50 wallets per attempt. Pro still requires server-verified subscription access or a current proof for one wallet holding at least {HOODRICH_MINIMUM_FORMATTED} $RICH.</p></section>

  <section id="create"><h2>2. Create the token</h2><div className={styles.table}><table><thead><tr><th>Input</th><th>Meaning</th></tr></thead><tbody>{inputs.map(([name, meaning]) => <tr key={name}><th scope="row">{name}</th><td>{meaning}</td></tr>)}</tbody></table></div><ol><li>Connect the creating wallet on Robinhood Chain and keep native ETH for the launch fee and gas.</li><li>Complete the essentials, choose the pair and an enabled configuration.</li><li>Open advanced settings only when you need supported PONS plan or fee controls.</li><li>Review the simulation and exact values before approving the wallet transaction.</li></ol><details><summary>Custom-pair rules</summary><p>The asset must be approved by PONS and pass factory, decimals, and economics checks. A custom pair is fixed at creation, forces developer buy to zero, and still needs native ETH for fees and gas. Later trading uses PONS; generated-node trading supports ETH pairs.</p></details></section>

  <section id="wallets"><h2>3. Prepare wallets</h2><ol><li>Choose a count and a 12–128 character backup password.</li><li>Generate wallets and save the encrypted root backup.</li><li>Restore that file to verify the addresses before funding or trading.</li><li>Use Import for existing encrypted HOODLABS or original-app keystores. Import and restore do not consume generation allowance.</li></ol><p>Keys stay in this tab and lock after 15 minutes without activity. Keep backups offline and passwords separate. Multiple wallets create more gas, records, and recovery work.</p><details><summary>Funding and bridging</summary><p>Fund Ethereum ETH, then use a reviewed Relay quote from Ethereum chain 1 to Robinhood Chain 4663. Check the full recipient, native assets, minimum received, and costs. Keep ETH for gas on both chains. Recover an unknown submitted bridge instead of sending again.</p></details></section>

  <section id="trade"><h2>Trade an ETH-paired token</h2><ol><li>Enter and verify the full PONS token address, or use the address from a verified launch receipt.</li><li>Use one node’s 5%, 10%, 25%, 50%, Max, or custom action, or the overall Max All controls.</li><li>Each node submits separately. Exact approvals may require a fresh Sell action after confirmation.</li><li>Pending and unknown statuses update automatically while this page is visible. Use Refresh all transactions &amp; nodes to check them and update balances manually.</li></ol><p>Buy percentages use spendable ETH after gas. Max Buy also retains an ETH buffer for later approvals and selling. Sell percentages use token holdings. The 2% slippage cap does not remove price impact, fees, gas, or partial-fill risk.</p></section>

  <section id="recovery"><h2>Stop and recover when status is unclear</h2><ul><li><strong>Pending or unknown:</strong> preserve the transaction hash and refresh its recorded status. Do not resubmit.</li><li><strong>Expired quote:</strong> request a fresh quote only when nothing was submitted.</li><li><strong>Wallets locked:</strong> restore the verified encrypted backup. Submitted transactions continue onchain.</li><li><strong>Image rejected:</strong> use a still PNG, JPEG, or WebP under 4MB, or an existing public image URI.</li><li><strong>Account verification paused:</strong> retry account verification. A temporary outage keeps loaded wallets visible and stops financial actions. After recovery, start a new action for any nodes that were not submitted.</li><li><strong>Pro unavailable:</strong> refresh account access and repeat holder proof after a new sign-in.</li></ul><p><a href="/security">Read the full security and recovery limits before using significant funds.</a></p></section>
 </main>;
}

export async function getServerSideProps() { return { props: {} }; }
