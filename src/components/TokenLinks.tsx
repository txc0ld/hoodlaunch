import { utils } from 'ethers';
export default function TokenLinks({ address }: { address: string }) {
  if (!utils.isAddress(address)) return null;
  const token = utils.getAddress(address);
  return <section aria-label="Your launched token" style={{padding:'16px 24px',margin:'16px auto',maxWidth:1180,border:'1px solid #35432b',borderRadius:12,fontSize:14,lineHeight:1.7}}>
    <strong>Your launched token</strong><p style={{overflowWrap:'anywhere'}}>{token}</p>
    <div style={{display:'flex',gap:20,flexWrap:'wrap'}}><a href={`https://www.ponsfamily.com/launchpad/${token}`} target="_blank" rel="noopener noreferrer">View on PONS ↗</a><a href={`https://dexscreener.com/search?q=${encodeURIComponent(token)}`} target="_blank" rel="noopener noreferrer">Find on Dexscreener ↗</a></div>
    <p>Dexscreener may not show a new token until it indexes a trading pair. Check the contract address and Robinhood network before trading.</p>
  </section>;
}
