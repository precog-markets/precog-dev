import { Address, erc20Abi } from "viem";
import { usePublicClient } from "wagmi";
import { useQuery, UseQueryOptions } from "@tanstack/react-query";
import { ContractName } from "~~/utils/scaffold-eth/contract";
import { getPrecogMasterContractKey, type PrecogMasterVersion } from "~~/utils/scaffold-eth/contractsData";
import { useScaffoldContract } from "./scaffold-eth";
import { useTargetNetwork } from "./scaffold-eth/useTargetNetwork";

/**
 * Core types for market data structures
 */

/**
 * Represents the basic information of a prediction market (V7 / PrecogMasterV7)
 */
export interface MarketInfo {
  marketId: number;
  name: string;
  description: string;
  category: string;
  outcomes: string[];
  startTimestamp: bigint;
  endTimestamp: bigint;
  creator: Address;
  market: Address;
}

/**
 * V8 market data aligned with PrecogMasterV8 ABI (plus marketId for list key)
 */
export interface MarketInfoV8 {
  marketId: number;
  question: string;
  resolutionCriteria: string;
  imageURL: string;
  category: string;
  outcomes: string[];
  creator: Address;
  operator: Address;
  market: Address;
  startTimestamp: bigint;
  endTimestamp: bigint;
  collateral: Address;
}

/**
 * Represents detailed market information including trading stats and resolution data
 * @property marketInfo - Tuple containing [totalShares, sharesBalances, lockedCollateral, totalBuys, totalSells]
 * @property token - Address of the collateral token used for trading
 * @property tokenSymbol - Symbol of the collateral token (e.g., "DAI")
 * @property marketResultInfo - Tuple containing [outcome, resolutionTime, oracleAddress]
 */
export interface MarketDetails {
  marketInfo: readonly [bigint, readonly bigint[], bigint, bigint, bigint];
  totalRedeemedShares?: bigint;
  token: Address;
  tokenSymbol: string;
  tokenDecimals: number;
  marketResultInfo: readonly [bigint, bigint, Address];
}
type MarketInfoV7Tuple = readonly [bigint, readonly bigint[], bigint, bigint, bigint];
type MarketInfoV8Tuple = readonly [bigint, readonly bigint[], bigint, bigint, bigint, bigint];
type MarketCollateralInfoV8 = readonly [Address, string, string, number];
type MarketResultInfoTuple = readonly [bigint, bigint, Address];
type AccountSharesTuple = readonly [bigint, bigint, bigint, bigint, bigint, readonly bigint[]];

/**
 * Represents the account shares data for a market
 * @property buys - Total buys by the account
 * @property sells - Total sells by the account
 * @property deposited - Total collateral deposited by the account
 * @property withdrew - Total collateral withdrawn by the account
 * @property redeemed - Whether the account has redeemed their winnings
 * @property balances - Array of shares balances for each outcome
 */
export interface AccountSharesData {
  buys: bigint;
  sells: bigint;
  deposited: bigint;
  withdrew: bigint;
  redeemed: bigint;
  balances: readonly bigint[];
}

/** Result type for usePrecogMarkets: v7 returns MarketInfo[], v8 returns MarketInfoV8[] */
export type PrecogMarketsResult =
  | { markets: MarketInfo[]; totalMarkets: bigint }
  | { markets: MarketInfoV8[]; totalMarkets: bigint };

type MulticallResult = readonly { status: "success" | "failure"; result?: unknown }[];

type MarketDataV8Tuple = [
  question: string,
  resolutionCriteria: string,
  imageURL: string,
  category: string,
  outcomes: string,
  creator: Address,
  operator: Address,
  market: Address,
  startTimestamp: bigint,
  endTimestamp: bigint,
  collateral: Address,
];

function parseV8MarketResult(raw: unknown): MarketDataV8Tuple | null {
  if (!raw || !Array.isArray(raw) || raw.length < 11) return null;
  return raw as MarketDataV8Tuple;
}

/**
 * Per-version config: empty result and mapper from multicall to typed markets.
 * Adding a new version = add to PrecogMasterVersion (contractsData) + add entry here (+ list component).
 */
const MARKETS_FETCH_BY_VERSION: Record<
  PrecogMasterVersion,
  {
    emptyResult: () => PrecogMarketsResult;
    mapResults: (marketsData: MulticallResult, marketIds: bigint[]) => MarketInfo[] | MarketInfoV8[];
  }
> = {
  v7: {
    emptyResult: () => ({ markets: [] as MarketInfo[], totalMarkets: 0n }),
    mapResults: (marketsData, marketIds) =>
      marketsData
        .map((result, index) => {
          if (result.status !== "success") return null;
          const m = result.result as [string, string, string, string, bigint, bigint, Address, Address];
          return {
            marketId: Number(marketIds[index]),
            name: m[0],
            description: m[1],
            category: m[2],
            outcomes: m[3].toString().split(","),
            startTimestamp: m[4],
            endTimestamp: m[5],
            creator: m[6],
            market: m[7],
          };
        })
        .filter((market): market is MarketInfo => market !== null),
  },
  v8: {
    emptyResult: () => ({ markets: [] as MarketInfoV8[], totalMarkets: 0n }),
    mapResults: (marketsData, marketIds) =>
      marketsData
        .map((result, index) => {
          if (result.status !== "success") return null;
          const m = parseV8MarketResult(result.result);
          if (!m) return null;
          return {
            marketId: Number(marketIds[index]),
            question: m[0],
            resolutionCriteria: m[1],
            imageURL: m[2],
            category: m[3],
            outcomes: m[4].toString().split(",").map(s => s.trim()).filter(Boolean),
            creator: m[5],
            operator: m[6],
            market: m[7],
            startTimestamp: m[8],
            endTimestamp: m[9],
            collateral: m[10],
          } satisfies MarketInfoV8;
        })
        .filter((market): market is MarketInfoV8 => market !== null),
  },
};

function getPrecogMarketContractKey(version: PrecogMasterVersion): ContractName {
  return (version === "v8" ? "PrecogMarketV8" : "PrecogMarketV7") as ContractName;
}

async function fetchErc20Metadata(publicClient: NonNullable<ReturnType<typeof usePublicClient>>, token: Address) {
  const [tokenSymbol, tokenDecimals] = await Promise.all([
    publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "symbol",
    }) as Promise<string>,
    publicClient.readContract({
      address: token,
      abi: erc20Abi,
      functionName: "decimals",
    }) as Promise<number>,
  ]);
  return { tokenSymbol, tokenDecimals };
}

function normalizeMarketInfoForDetails(version: PrecogMasterVersion, rawMarketInfo: unknown): MarketInfoV7Tuple {
  if (!Array.isArray(rawMarketInfo)) {
    throw new Error("Invalid market info shape");
  }
  if (version === "v8") {
    if (rawMarketInfo.length < 6) throw new Error("Invalid V8 market info shape");
    const v8 = rawMarketInfo as unknown as MarketInfoV8Tuple;
    return [v8[0], v8[1], v8[3], v8[4], v8[5]];
  }
  if (rawMarketInfo.length < 5) throw new Error("Invalid V7 market info shape");
  return rawMarketInfo as unknown as MarketInfoV7Tuple;
}

async function fetchMarketDetailsV7(params: {
  marketId: number;
  marketAddress: Address;
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>;
  marketAbi: unknown;
  masterAddress: Address;
  masterAbi: unknown;
}): Promise<MarketDetails> {
  const { marketId, marketAddress, publicClient, marketAbi, masterAddress, masterAbi } = params;
  const multicallData = await publicClient.multicall({
    contracts: [
      { address: marketAddress, abi: marketAbi as any, functionName: "getMarketInfo", args: [] },
      { address: marketAddress, abi: marketAbi as any, functionName: "token", args: [] },
      { address: masterAddress, abi: masterAbi as any, functionName: "marketResultInfo", args: [BigInt(marketId)] },
    ],
    allowFailure: true,
  });
  const [marketInfoResult, tokenResult, marketResultInfoResult] = multicallData;
  if (marketInfoResult.status !== "success" || tokenResult.status !== "success" || marketResultInfoResult.status !== "success") {
    throw new Error("Failed to fetch V7 market details");
  }
  const token = tokenResult.result as Address;
  const { tokenSymbol, tokenDecimals } = await fetchErc20Metadata(publicClient, token);
  return {
    marketInfo: normalizeMarketInfoForDetails("v7", marketInfoResult.result),
    token,
    tokenSymbol,
    tokenDecimals,
    marketResultInfo: marketResultInfoResult.result as MarketResultInfoTuple,
  };
}

async function fetchMarketDetailsV8(params: {
  marketId: number;
  marketAddress: Address;
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>;
  marketAbi: unknown;
  masterAddress: Address;
  masterAbi: unknown;
}): Promise<MarketDetails> {
  const { marketId, marketAddress, publicClient, marketAbi, masterAddress, masterAbi } = params;
  const multicallData = await publicClient.multicall({
    contracts: [
      { address: marketAddress, abi: marketAbi as any, functionName: "getMarketInfo", args: [] },
      { address: masterAddress, abi: masterAbi as any, functionName: "marketCollateralInfo", args: [BigInt(marketId)] },
      { address: masterAddress, abi: masterAbi as any, functionName: "marketResultInfo", args: [BigInt(marketId)] },
    ],
    allowFailure: true,
  });
  const [marketInfoResult, collateralInfoResult, marketResultInfoResult] = multicallData;
  if (marketInfoResult.status !== "success" || collateralInfoResult.status !== "success" || marketResultInfoResult.status !== "success") {
    throw new Error("Failed to fetch V8 market details");
  }
  const [token, , tokenSymbol, tokenDecimals] = collateralInfoResult.result as MarketCollateralInfoV8;
  const rawMarketInfo = marketInfoResult.result as MarketInfoV8Tuple;
  return {
    marketInfo: normalizeMarketInfoForDetails("v8", rawMarketInfo),
    totalRedeemedShares: rawMarketInfo[2],
    token,
    tokenSymbol,
    tokenDecimals,
    marketResultInfo: marketResultInfoResult.result as MarketResultInfoTuple,
  };
}

async function fetchAccountOutcomeBalancesV7(params: {
  marketId: number;
  marketAddress: Address;
  accountAddress: Address;
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>;
  masterAddress: Address;
  masterAbi: unknown;
  marketAbi: unknown;
}): Promise<AccountSharesData & { tokenSymbol: string; tokenDecimals: number }> {
  const { marketId, marketAddress, accountAddress, publicClient, masterAddress, masterAbi, marketAbi } = params;
  const multicallResults = await publicClient.multicall({
    contracts: [
      { address: masterAddress, abi: masterAbi as any, functionName: "marketAccountShares", args: [BigInt(marketId), accountAddress] },
      { address: marketAddress, abi: marketAbi as any, functionName: "token", args: [] },
    ],
    allowFailure: true,
  });
  const [sharesResult, tokenResult] = multicallResults;
  if (sharesResult.status !== "success" || tokenResult.status !== "success") {
    throw new Error("Failed to fetch V7 market account balances");
  }
  const [buys, sells, deposited, withdrew, redeemed, balances] = sharesResult.result as AccountSharesTuple;
  const tokenAddress = tokenResult.result as Address;
  const { tokenSymbol, tokenDecimals } = await fetchErc20Metadata(publicClient, tokenAddress);
  return { balances, buys, sells, deposited, withdrew, redeemed, tokenSymbol, tokenDecimals };
}

async function fetchAccountOutcomeBalancesV8(params: {
  marketId: number;
  accountAddress: Address;
  publicClient: NonNullable<ReturnType<typeof usePublicClient>>;
  masterAddress: Address;
  masterAbi: unknown;
}): Promise<AccountSharesData & { tokenSymbol: string; tokenDecimals: number }> {
  const { marketId, accountAddress, publicClient, masterAddress, masterAbi } = params;
  const multicallResults = await publicClient.multicall({
    contracts: [
      { address: masterAddress, abi: masterAbi as any, functionName: "marketAccountInfo", args: [BigInt(marketId), accountAddress] },
      { address: masterAddress, abi: masterAbi as any, functionName: "marketCollateralInfo", args: [BigInt(marketId)] },
    ],
    allowFailure: true,
  });
  const [sharesResult, collateralResult] = multicallResults;
  if (sharesResult.status !== "success" || collateralResult.status !== "success") {
    throw new Error(
      `Failed to fetch market data: shares=${sharesResult.status} collateral=${collateralResult.status}`,
    );
  }
  const [buys, sells, deposited, withdrew, redeemed, balances] = sharesResult.result as AccountSharesTuple;
  const [, , tokenSymbol, tokenDecimals] = collateralResult.result as MarketCollateralInfoV8;
  return { balances, buys, sells, deposited, withdrew, redeemed, tokenSymbol, tokenDecimals };
}

/**
 * Hook to fetch all prediction markets from the master contract
 * @param version - PrecogMaster version (see contractsData PrecogMasterVersion)
 * @returns Version-dependent { markets, totalMarkets }. Use PrecogMarketsList to render the correct list.
 */
export const usePrecogMarkets = (version: PrecogMasterVersion = "v8") => {
  const { targetNetwork } = useTargetNetwork();
  const { data: masterContract } = useScaffoldContract({
    contractName: getPrecogMasterContractKey(version) as ContractName,
  });
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const config = MARKETS_FETCH_BY_VERSION[version];

  return useQuery<PrecogMarketsResult>({
    queryKey: ["markets", targetNetwork.id, version],
    queryFn: async (): Promise<PrecogMarketsResult> => {
      if (!masterContract?.address || !publicClient) return config.emptyResult();

      const totalMarkets = (await publicClient.readContract({
        address: masterContract.address,
        abi: masterContract.abi,
        functionName: "createdMarkets",
      })) as bigint;

      if (totalMarkets === 0n) return config.emptyResult();

      const marketIds = Array.from({ length: Number(totalMarkets) }, (_, i) => totalMarkets - 1n - BigInt(i));
      const marketRequests = marketIds.map(
        marketId =>
          ({
            address: masterContract.address,
            abi: masterContract.abi,
            functionName: "markets",
            args: [marketId],
          } as const),
      );

      const marketsData = await publicClient.multicall({
        contracts: marketRequests,
        allowFailure: true,
      });

      const markets = config.mapResults(marketsData, marketIds);
      return { markets, totalMarkets } as PrecogMarketsResult;
    },
    enabled: !!masterContract?.address && !!publicClient,
    refetchOnWindowFocus: false,
    refetchInterval: 300000,
  });
};

/**
 * Hook to fetch detailed information about a specific market
 * @param marketId - Unique identifier of the market
 * @param marketAddress - Contract address of the market
 * @param enabled - Whether to enable the query
 * @returns Detailed market information including trading stats and resolution data
 */
export const usePrecogMarketDetails = (
  marketId: number,
  marketAddress: Address,
  enabled: boolean,
  version: PrecogMasterVersion = "v8",
) => {
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const marketContractName = getPrecogMarketContractKey(version);
  const masterContractName = getPrecogMasterContractKey(version) as ContractName;
  const { data: marketContract } = useScaffoldContract({
    contractName: marketContractName,
  });
  const { data: masterContract } = useScaffoldContract({
    contractName: masterContractName,
  });

  return useQuery({
    queryKey: ["marketDetails", version, targetNetwork.id, marketAddress, marketId],
    queryFn: async () => {
      if (!publicClient || !marketContract?.abi || !masterContract?.abi || !masterContract?.address) {
        throw new Error("Public client or contract ABIs not available");
      }

      return version === "v8"
        ? fetchMarketDetailsV8({
            marketId,
            marketAddress,
            publicClient,
            marketAbi: marketContract.abi,
            masterAddress: masterContract.address,
            masterAbi: masterContract.abi,
          })
        : fetchMarketDetailsV7({
            marketId,
            marketAddress,
            publicClient,
            marketAbi: marketContract.abi,
            masterAddress: masterContract.address,
            masterAbi: masterContract.abi,
          });
    },
    enabled: enabled && !!publicClient && !!marketContract?.abi && !!masterContract?.abi,
    refetchOnWindowFocus: false,
  });
};

/**
 * Hook to fetch current market prices and shares for all outcomes
 * @param marketAddress - Contract address of the market
 * @param outcomes - Array of outcome names
 * @param enabled - Whether to enable the query
 * @returns Current prices and shares for each outcome
 */
export const usePrecogMarketPrices = (
  marketAddress: Address,
  outcomes: string[],
  enabled: boolean,
  version: PrecogMasterVersion = "v8",
) => {
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const marketContractName = getPrecogMarketContractKey(version);
  const { data: marketContract } = useScaffoldContract({
    contractName: marketContractName,
  });

  const query = useQuery({
    queryKey: ["marketPrices", version, targetNetwork.id, marketAddress],
    queryFn: async () => {
      if (!publicClient || !marketContract?.abi) {
        throw new Error("Public client or market contract ABI not available");
      }

      // Fetch prices and market info in a single multicall
      const multicallData = await publicClient.multicall({
        contracts: [
          {
            address: marketAddress,
            abi: marketContract.abi,
            functionName: "getPrices",
          },
          {
            address: marketAddress,
            abi: marketContract.abi,
            functionName: "getMarketInfo",
          },
        ],
        allowFailure: true,
      });

      const [pricesResult, marketInfoResult] = multicallData;

      // Combine prices and shares data for each outcome
      const outcomeData: {
        name: string;
        buyPrice?: bigint;
        sellPrice?: bigint;
        shares?: bigint;
      }[] = [];

      if (outcomes && pricesResult?.status === "success") {
        const prices = pricesResult.result as [bigint[], bigint[]];
        const marketInfo =
          marketInfoResult?.status === "success"
            ? (marketInfoResult.result as readonly [bigint, readonly bigint[], bigint, bigint, bigint])
            : undefined;
        const shares = marketInfo?.[1];

        // Map outcome data with corresponding prices and shares
        for (let i = 0; i < outcomes.length; i++) {
          outcomeData.push({
            name: outcomes[i],
            buyPrice: prices[0]?.[i + 1],
            sellPrice: prices[1]?.[i + 1],
            shares: shares?.[i + 1],
          });
        }
      }

      const isAnyError = multicallData.some(d => d.status === "failure");

      return {
        outcomeData: outcomeData,
        isError: isAnyError,
        errors: {
          prices: pricesResult?.error,
          marketInfo: marketInfoResult?.error,
        },
      };
    },
    enabled: enabled && !!publicClient && !!marketContract?.abi,
    refetchOnWindowFocus: false,
    refetchInterval: 300000, // Refresh every 5 minutes
  });

  return {
    outcomeData: query.data?.outcomeData ?? [],
    isLoading: query.isLoading,
    isError: query.isError || !!query.data?.isError,
    errors: {
      multicall: query.error,
      prices: query.data?.errors?.prices,
      marketInfo: query.data?.errors?.marketInfo,
    },
  };
};

/**
 * Hook to fetch the account outcome balances for a given market, on demand
 * @param marketId - The ID of the market
 * @param marketAddress - The address of the market, for query key purposes
 * @param accountAddress - The address of the account to fetch balances for
 * @param chainId - The ID of the chain to fetch data from
 * @param enabled - Whether to enable the query
 * @param options - Additional options for the useQuery hook
 * @returns The account outcome balances for the given market
 */
export const useAccountOutcomeBalances = (
  marketId: number,
  marketAddress: Address,
  accountAddress: Address | undefined,
  chainId: number | undefined,
  enabled: boolean,
  options?: Omit<Omit<UseQueryOptions<AccountSharesData & { tokenSymbol: string; tokenDecimals: number; }>, "queryKey" | "queryFn" | "enabled">, "enabled">,
  version: PrecogMasterVersion = "v8",
) => {
  const marketContractName = getPrecogMarketContractKey(version);
  const masterContractName = getPrecogMasterContractKey(version) as ContractName;
  const { data: masterContract } = useScaffoldContract({
    contractName: masterContractName,
  });
  const { data: marketContract } = useScaffoldContract({
    contractName: marketContractName,
  });
  const publicClient = usePublicClient({ chainId });

  const isReady = !!publicClient && !!masterContract?.abi && !!marketContract?.abi && !!accountAddress && !!chainId;

  return useQuery<AccountSharesData & { tokenSymbol: string; tokenDecimals: number; }>({
    queryKey: ["marketAccountBalances", version, marketAddress, marketId, accountAddress, chainId],
    queryFn: async () => {
      if (!isReady) {
        throw new Error("Required dependencies not met for fetching account balances.");
      }

      return version === "v8"
        ? fetchAccountOutcomeBalancesV8({
            marketId,
            accountAddress: accountAddress as Address,
            publicClient,
            masterAddress: masterContract.address,
            masterAbi: masterContract.abi,
          })
        : fetchAccountOutcomeBalancesV7({
            marketId,
            marketAddress,
            accountAddress: accountAddress as Address,
            publicClient,
            masterAddress: masterContract.address,
            masterAbi: masterContract.abi,
            marketAbi: marketContract.abi,
          });
    },
    enabled: enabled && isReady,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    ...options,
  });
};
