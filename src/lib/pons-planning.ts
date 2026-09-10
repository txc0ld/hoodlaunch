import { BigNumber, constants, utils } from 'ethers';
import type { LaunchDraft, PairAsset, ProtocolState } from './pons-types';

export interface PonsPlanContext {
  protocol: ProtocolState | null;
  configId: string;
  pairToken?: string;
  pairAsset: PairAsset | null;
}
export interface PonsPlanningSnapshot {
  key: string;
  supply: string;
  curveFeePercent: string;
  launchFeeEth: string;
  maxCreatorTaxPercent: string;
  customPair: boolean;
}
export interface PonsPlanInput { snapshotKey: string; creatorTaxPercent: string; developerBuyEth: string; }

function uint(value: string) {
  if (!/^(0|[1-9]\d{0,77})$/.test(value)) throw new Error('Invalid protocol amount.');
  const amount = BigNumber.from(value);
  if (amount.gt(constants.MaxUint256)) throw new Error('Invalid protocol amount.');
  return amount;
}

// A display snapshot is context for a draft, never a quote or transaction authority.
export function getPonsPlanningSnapshot(context: PonsPlanContext): PonsPlanningSnapshot | null {
  try {
    const { protocol, configId, pairAsset } = context;
    if (!protocol || protocol.chainId !== 4663 || !utils.isAddress(protocol.factory) || !utils.isAddress(protocol.router)) return null;
    if (!Number.isInteger(protocol.maxCreatorTaxBps) || protocol.maxCreatorTaxBps < 0 || protocol.maxCreatorTaxBps > 10000) return null;
    const config = protocol.configs.find(value => value.id === configId);
    if (!config?.enabled || !Number.isInteger(config.curveFeeBps) || config.curveFeeBps < 0 || config.curveFeeBps > 10000) return null;
    const pairToken = utils.getAddress(context.pairToken ?? constants.AddressZero);
    const customPair = pairToken !== constants.AddressZero;
    if (customPair && (!pairAsset || utils.getAddress(pairAsset.address) !== pairToken || !Number.isInteger(pairAsset.decimals) || pairAsset.decimals < 0 || pairAsset.decimals > 36)) return null;
    const supply = uint(config.supplyWei);
    if (supply.isZero()) return null;
    const fee = uint(protocol.launchFeeWei);
    return {
      key: JSON.stringify([protocol.chainId, protocol.factory.toLowerCase(), protocol.router.toLowerCase(), protocol.maxCreatorTaxBps, protocol.launchFeeWei, config, pairToken, customPair ? pairAsset : null]),
      supply: utils.formatUnits(supply, 18),
      curveFeePercent: utils.formatUnits(config.curveFeeBps, 2),
      launchFeeEth: utils.formatEther(fee),
      maxCreatorTaxPercent: utils.formatUnits(protocol.maxCreatorTaxBps, 2),
      customPair,
    };
  } catch { return null; }
}

export function applyPonsPlan(draft: LaunchDraft, input: PonsPlanInput, context: PonsPlanContext, unavailable: boolean): LaunchDraft {
  if (unavailable) throw new Error('Wait until the current launch operation or protocol refresh finishes.');
  const current = getPonsPlanningSnapshot(context);
  if (!current || current.key !== input.snapshotKey || context.configId !== draft.configId || (context.pairToken ?? constants.AddressZero) !== (draft.pairToken ?? constants.AddressZero)) throw new Error('PONS settings changed. Review the current launch plan and try again.');
  if (typeof input.creatorTaxPercent !== 'string' || !/^(0|[1-9]\d{0,2})(?:\.\d{1,2})?$/.test(input.creatorTaxPercent)) throw new Error('Creator tax must be a plain percentage with at most two decimal places.');
  const tax = utils.parseUnits(input.creatorTaxPercent, 2);
  if (tax.gt(context.protocol!.maxCreatorTaxBps)) throw new Error(`Creator tax cannot exceed ${current.maxCreatorTaxPercent}%.`);
  if (typeof input.developerBuyEth !== 'string' || input.developerBuyEth.length > 100 || !/^(0|[1-9]\d*)(?:\.\d{1,18})?$/.test(input.developerBuyEth)) throw new Error('Initial buy must be a plain ETH amount with at most 18 decimal places.');
  const buy = utils.parseEther(input.developerBuyEth);
  if (buy.gt(constants.MaxUint256)) throw new Error('Initial buy is too large.');
  if (current.customPair && !buy.isZero()) throw new Error('Custom pairs require a zero initial buy. Buy separately on PONS after launch.');
  return { ...draft, creatorTaxBps: tax.toNumber(), developerBuyEth: utils.formatEther(buy) };
}
