import Head from 'next/head';
import styles from '../src/components/Guide.module.css';

const tiers = [
 ['Connected-wallet token launch', 'Included', 'Included'],
 ['Native ETH or validated PONS-approved ERC-20 launch pair', 'Included', 'Included'],
 ['Token Lab: FDV, allocations and fee arithmetic', 'Included', 'Included'],
 ['Token Lab: vesting, 3 scenarios and CSV/JSON export', '—', 'Included'],
 ['Public image URI and website/social inputs', 'Included', 'Included'],
 ['Generated wallets with verified encrypted backups', '—', 'Up to 50'],
 ['Relay bridge and generated-node trading workspace', '—', 'Included for ETH-paired launches'],
 ['Managed raster image uploads', '—', '50 attempts per user per day'],
 ['Keys controlled by the user', 'Yes', 'Yes; generated keys stay in browser memory'],
];

export default function Pro() {
 return <main className={styles.page}>
  <Head><title>HOODLABS Pro · Free and Pro capabilities</title></Head>
  <nav><a href="/">← HOODLABS</a><a href="/guide">How-to guide</a><a href="/security">Security</a></nav>
  <header><p className={styles.eyebrow}>FREE OR PRO</p><h1>Start with one wallet. Add coordination tools when they help.</h1><p>Free includes connected-wallet launching and the core Token Lab. Pro adds local planning comparisons, a generated-wallet workspace and managed services.</p></header>
  <aside className={styles.contents} aria-label="Page contents"><a href="#compare">Compare tiers</a><a href="#start">Get started</a><a href="#holder">Holder access</a><a href="#billing">Billing and costs</a><a href="#limits">Limits</a></aside>
  <section id="compare"><h2>Compare Free and Pro</h2><div className={styles.table}><table><thead><tr><th>Feature</th><th>Free</th><th>Pro</th></tr></thead><tbody>{tiers.map(row=><tr key={row[0]}>{row.map((cell,index)=>index===0?<th key={cell} scope="row">{cell}</th>:<td key={cell+index}>{cell}</td>)}</tr>)}</tbody></table></div><p>Token Lab is a local, generic planning tool. It does not feed values into PONS, deploy a token, allocate supply, change fees or predict returns.</p><p>A custom launch pair must be approved by PONS and pass factory, decimals and economics checks. It is fixed at creation, forces the initial developer buy to zero, and still needs native ETH for launch fees and gas. Later custom-pair trading uses PONS links; generated-node trading remains for ETH pairs.</p></section>
  <section id="start"><h2>Get started in four steps</h2><ol><li>Use the free launch form and Token Lab with a small test plan.</li><li>For Pro, sign in by email code when account services are available.</li><li>Qualify through an active subscription or verify one wallet holding at least 500,000 HOODRICH ($RICH).</li><li>Return to the workspace. Pro appears only after current access is verified by the service.</li></ol></section>
  <section id="holder"><h2>Unlock Pro with HOODRICH</h2><ol><li>Sign in by email.</li><li>Connect the wallet holding $RICH on Robinhood Chain.</li><li>Select <strong>Verify holding wallet</strong> and sign the ownership message.</li></ol><p>The signature moves no tokens, requests no spending approval and costs no gas. Exactly 500,000 $RICH qualifies. Holdings in different wallets are not combined.</p><details><summary>Holder access rules</summary><p>The balance is checked for managed services and about every minute in the workspace. Falling below the threshold ends holder access on the next check unless an active paid subscription qualifies separately. Verify again after a new sign-in. One standard wallet can link to one account; smart contract and delegated wallets are not supported for this proof yet.</p><p>Becoming eligible does not cancel an existing subscription or create a refund. Manage billing separately.</p></details></section>
  <section id="billing"><h2>Subscription and operating costs</h2><p>A subscription pays for the supported hosted workflow and managed services. It adds no application charge to each on-chain trade.</p><ul><li>No subscription price is shown until the business price is configured.</li><li>Stripe Checkout shows the actual recurring price and terms before purchase.</li><li>Network gas, PONS fees, creator tax, exchange withdrawals and Relay costs are separate.</li><li>Cancellation takes effect at the end of the paid period after Stripe confirms it.</li></ul><p>Use <strong>Manage subscription</strong> to review billing, renewal or cancellation. Pro stays unavailable while the service itself is disabled.</p></section>
  <section id="limits"><h2>What Pro does not promise</h2><ul><li>No guarantee of token demand, profit, price, transaction speed or anonymity.</li><li>Multiple wallets create more transactions, fees and recovery work.</li><li>Generated wallets share one encrypted root backup. Losing it or its password can make funds unrecoverable; exposing it can compromise every derived wallet.</li><li>Public client code is inspectable. Managed services check entitlement independently.</li></ul><a href="/">Open HOODLABS →</a></section>
 </main>;
}
export async function getServerSideProps(){return {props:{}};}
