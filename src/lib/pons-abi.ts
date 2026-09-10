// Source: https://docs.ponsfamily.com/v2 (launching, contracts, events).
export const TOKEN_PARAMS = '(string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address creatorFeeRecipient,uint16 creatorTaxBps,bool buybackEnabled,bytes32 expectedEconomics,bytes32 salt)';
export const FACTORY_ABI = [
  'function approvedPairTokens(address pairToken) view returns (bool)',
  'function pairTokenEconomics(address pairToken) view returns (uint256 phantomQuote,uint256 graduationThreshold,uint8 decimals)',
  'function launchConfigCount() view returns (uint256)',
  'function getLaunchConfig(uint256 id) view returns ((uint256 supply,uint256 curveFeeBps,uint256 phantomQuote,uint256 graduationThreshold,uint24 poolFee,int24 tickSpacing,bool enabled))',
  'function launchFee() view returns (uint256)',
  'function maxCreatorTaxBps() view returns (uint16)',
  'function canLaunch(address account) view returns (bool)',
  'function previewLaunchEconomics(uint256 launchConfigId,address pairToken) view returns (bytes32)',
  `function launchToken(${TOKEN_PARAMS} params,uint256 launchConfigId,address pairToken,address[] snipeTaxExemptions) payable returns (address token,address curve)`,
  'event TokenLaunched(address indexed token,address indexed curve,address indexed deployer,address pairToken,uint256 launchConfigId,uint256 graduationThreshold)',
];
export const ROUTER_ABI = [
  `function launchAndBuy(${TOKEN_PARAMS} params,uint256 launchConfigId,address pairToken,uint256 quoteIn,uint256 minTokensOut,address recipient,address[] snipeTaxExemptions) payable returns (address token,address curve,uint256 tokensOut)`,
];
