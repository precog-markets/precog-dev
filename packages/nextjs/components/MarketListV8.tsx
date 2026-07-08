import { useState } from "react";
import { formatUnits, parseUnits, erc20Abi } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { Pie, PieChart, Sector } from "recharts";
import { PieSectorDataItem } from "recharts/types/polar/Pie";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useScaffoldContract } from "~~/hooks/scaffold-eth";
import { useAccountOutcomeBalances, usePrecogMarketDetails, usePrecogMarketPrices, type MarketInfoV8 } from "~~/hooks/usePrecogMarketData";
import { useMarketBuyCalculations, useMarketSellCalculations, useMarketSetupInfoV8, type MarketSetupInfoV8 as MarketSetupInfoV8Data } from "~~/hooks/useMarketCalculations";
import { useMarketActions } from "~~/hooks/useMarketActions";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-eth/networks";
import { formatCategoryCsv } from "~~/utils/marketCategories";
import { fromInt128toNumber } from "~~/utils/numbers";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./Charts";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";

export function MarketListV8({
  markets,
  searchFilter,
  statusFilter,
}: {
  markets: MarketInfoV8[];
  searchFilter: string;
  statusFilter: string;
}) {
  const { targetNetwork } = useTargetNetwork();

  if (markets.length === 0) {
    return (
      <div className="flex flex-wrap justify-center py-40 font-mono">
        <p className="text-2xl text-accent">-- NO MARKETS DETECTED --</p>
      </div>
    );
  }

  const filteredMarkets = markets.filter(market => {
    const text = `${market.question} ${market.category} ${market.outcomes.join(" ")}`.toLowerCase();
    const nameMatches = text.includes(searchFilter.toLowerCase());
    const status = getMarketStatus(market.startTimestamp, market.endTimestamp).status.toLowerCase();
    const statusMatches = statusFilter === "all" || status === statusFilter;
    return nameMatches && statusMatches;
  });

  return (
    <div className="w-full flex flex-col gap-4 font-mono">
      {filteredMarkets.length > 0 ? (
        filteredMarkets.map(market => (
          <MarketItemV8 key={`${market.marketId}-${market.market}`} market={market} targetNetwork={targetNetwork} />
        ))
      ) : (
        <div className="flex flex-wrap justify-center py-10">
          <p className="font-mono text-lg text-accent">-- NO MARKETS FOUND --</p>
        </div>
      )}
    </div>
  );
}

function MarketItemV8({
  market,
  targetNetwork,
}: {
  market: MarketInfoV8;
  targetNetwork: ReturnType<typeof useTargetNetwork>["targetNetwork"];
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showPrices, setShowPrices] = useState(false);
  const [showTrading, setShowTrading] = useState(false);
  const { status, className } = getMarketStatus(market.startTimestamp, market.endTimestamp);

  return (
    <div className="collapse collapse-arrow bg-base-100 transition-colors duration-300 rounded-lg shadow-lg shadow-primary/10">
      <input type="checkbox" className="peer" checked={isOpen} onChange={e => setIsOpen(e.target.checked)} />

      <div className="collapse-title peer-checked:bg-base-200/10 text-xs">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <h3 className="text-lg font-bold text-base-content/70 break-words m-0" title={market.question}>
              <span className="text-base-content/70 mr-2">[{market.marketId}]</span>
              {market.question}
            </h3>
            <div className="text-sm">
              <span>
                <span className="text-success">{formatDate(market.startTimestamp)}</span> →{" "}
                <span className="text-error">{formatDate(market.endTimestamp)}</span>
              </span>
            </div>
          </div>
          <div className="font-bold">
            <span className={className}>[{status}]</span>
          </div>
        </div>
      </div>

      <div className="collapse-content bg-base-300/20 text-sm">
        <div className="pt-4 flex flex-col gap-4">
          <div className="gap-2 flex flex-col">
            <h4 className="font-bold text-base-content/70 m-0">:: Market Basic Info ::</h4>
            <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1">
              <div className="break-words">
                <span className="font-bold text-base-content/70 inline-block">Resolution Criteria: </span>
                <span className="inline-block">{market.resolutionCriteria || "N/A"}</span>
              </div>
              {market.imageURL && (
                <div className="break-all">
                  <span className="font-bold text-base-content/70 inline-block">Image URL:</span>{" "}
                  <a
                    href={
                      market.imageURL?.startsWith('ipfs://')
                        ? `https://ipfs.io/ipfs/${market.imageURL.slice(7)}`
                        : market.imageURL
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:underline break-all"
                  >
                    <span className="inline-block break-all">{market.imageURL}</span>
                    <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
                  </a>
                </div>
              )}
              <div>
                <span className="font-bold text-base-content/70">Category: </span>
                {formatCategoryCsv(market.category) || "N/A"}
              </div>
              <div className="break-words">
                <span className="font-bold text-base-content/70">Outcomes: </span>
                {market.outcomes.length > 0 ? market.outcomes.join(", ") : "N/A"}
              </div>
              <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:gap-x-6">
                <div className="break-all">
                  <span className="font-bold text-base-content/70 inline-block">Creator:</span>{" "}
                  <a
                    href={getBlockExplorerAddressLink(targetNetwork, market.creator)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:underline break-all"
                  >
                    {market.creator}
                    <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
                  </a>
                </div>
              </div>
              <div className="break-all">
                  <span className="font-bold text-base-content/70 inline-block">Operator:</span>{" "}
                  <a
                    href={getBlockExplorerAddressLink(targetNetwork, market.operator)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 hover:underline break-all"
                  >
                    {market.operator}
                    <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
                  </a>
                </div>
              <div className="break-all">
                <span className="font-bold text-base-content/70 inline-block">Market Contract:</span>{" "}
                <a
                  href={getBlockExplorerAddressLink(targetNetwork, market.market)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:underline break-all"
                >
                  {market.market}
                  <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
                </a>
              </div>
              <div className="break-all">
                <span className="font-bold text-base-content/70 inline-block">Collateral Token:</span>{" "}
                <a
                  href={getBlockExplorerAddressLink(targetNetwork, market.collateral)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 hover:underline break-all"
                >
                  {market.collateral}
                  <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
                </a>
              </div>
            </div>
          </div>

          <div className="flex gap-4 pt-4 flex-wrap">
            <button className="btn btn-sm btn-primary" onClick={() => setShowDetails(!showDetails)}>
              {showDetails ? "Hide" : "Show"} Market Info
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => setShowPrices(!showPrices)}>
              {showPrices ? "Hide" : "Show"} Prices
            </button>
            <button className="btn btn-sm btn-primary" onClick={() => setShowTrading(!showTrading)}>
              {showTrading ? "Hide" : "Start"} Trading
            </button>
          </div>

          {showDetails && <MarketDetailedInfoV8 market={market} />}
          {showPrices && <MarketPricesV8 market={market} />}
          {showTrading && <MarketTradingPanelV8 market={market} targetNetwork={targetNetwork} />}
        </div>
      </div>
    </div>
  );
}

function MarketDetailedInfoV8({ market }: { market: MarketInfoV8 }) {
  const { address: connectedAddress } = useAccount();
  const { executeReport, isPending: isReporting } = useMarketActions("v8");
  const [selectedOutcome, setSelectedOutcome] = useState("");
  const { targetNetwork } = useTargetNetwork();
  const { data: setup, isLoading: isSetupLoading, isError: isSetupError } = useMarketSetupInfoV8(market.marketId, true, targetNetwork.id);
  const {
    data: details,
    isLoading,
    isError,
    refetch: refetchDetails,
  } = usePrecogMarketDetails(market.marketId, market.market, true, "v8");

  if (isLoading) {
    return (
      <div className="flex justify-center items-center pt-4">
        <span className="loading loading-spinner loading-md"></span>
      </div>
    );
  }

  if (isError || !details) {
    return (
      <div className="flex justify-center items-center pt-4 flex-col">
        <p className="text-error">--! ERROR: COULD NOT LOAD MARKET TRADING INFO !--</p>
      </div>
    );
  }

  const { marketInfo, token, tokenSymbol, marketResultInfo, totalRedeemedShares } = details;
  const status = getDetailedMarketStatus(market.startTimestamp, market.endTimestamp, marketResultInfo[0]);
  const isPendingResolution = status === "WAITING FOR THE RESULT";
  const isOracle = connectedAddress === marketResultInfo[2];
  let totalRedeemsDisplay = "0%";
  if (marketResultInfo[0] !== 0n && setup && typeof totalRedeemedShares !== "undefined") {
    const winningIndex = Number(marketResultInfo[0]);
    const winningSharesRaw = marketInfo[1]?.[winningIndex];
    if (typeof winningSharesRaw !== "undefined") {
      const winningShares = fromInt128toNumber(winningSharesRaw);
      const redeemableWinningShares = Math.max(winningShares - setup.initialShares, 0);
      const redeemedShares = fromInt128toNumber(totalRedeemedShares);
      const redeemedPct = redeemableWinningShares > 0 ? (redeemedShares / redeemableWinningShares) * 100 : 0;
      const clampedRedeemedPct = Math.min(100, Math.max(0, redeemedPct));
      totalRedeemsDisplay = `${clampedRedeemedPct.toFixed(2)}%`;
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-4">
        <h4 className="font-bold text-base-content/70 m-0">:: Market Resolution Info ::</h4>
        <div className="p-2 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1">
          <p className="m-0">
            <span className="font-bold text-base-content/70">Market Status:</span> {status}
          </p>
          <div className="break-all">
            <span className="font-bold text-base-content/70 inline-block">Oracle:</span>{" "}
            <a
              href={getBlockExplorerAddressLink(targetNetwork, marketResultInfo[2])}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:underline break-all"
            >
              {marketResultInfo[2]}
              <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
            </a>
          </div>
          <p className="m-0">
            <span className="font-bold text-base-content/70">Reported Outcome:</span>{" "}
            {marketResultInfo[0] === 0n ? "Pending Resolution" : market.outcomes[Number(marketResultInfo[0]) - 1]}
          </p>
          <p className="m-0">
            <span className="font-bold text-base-content/70">Resolution Date:</span>{" "}
            {marketResultInfo[0] === 0n ? "Pending Resolution" : formatDate(marketResultInfo[1], true)}
          </p>
          {isPendingResolution && isOracle && (
            <div className="flex items-center gap-2 mt-2">
              <span className="font-bold text-base-content/70">Report Result:</span>
              <select
                className="select select-bordered select-xs"
                value={selectedOutcome}
                onChange={e => setSelectedOutcome(e.target.value)}
              >
                <option value="" disabled>
                  Select outcome
                </option>
                {market.outcomes.map(outcome => (
                  <option key={outcome} value={outcome}>
                    {outcome}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-xs btn-primary"
                disabled={!selectedOutcome || isReporting}
                onClick={async () => {
                  const outcomeIndex = market.outcomes.indexOf(selectedOutcome) + 1;
                  await executeReport(market.marketId, outcomeIndex, market.market);
                  refetchDetails();
                }}
              >
                {isReporting ? <span className="loading loading-spinner loading-xs"></span> : "Report"}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        <h4 className="font-bold text-base-content/70 m-0">:: Market Trading Info ::</h4>
        <div className="p-2 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1">
          <p className="m-0">
            <span className="font-bold text-base-content/70">Trading Starts:</span> {formatDate(market.startTimestamp, true)}
          </p>
          <p className="m-0">
            <span className="font-bold text-base-content/70">Trading Ends:</span> {formatDate(market.endTimestamp, true)}
          </p>
          <div className="break-all">
            <span className="font-bold text-base-content/70 inline-block">Collateral Token:</span>{" "}
            <a
              href={getBlockExplorerAddressLink(targetNetwork, token)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:underline break-all"
            >
              {token}
              <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
            </a>{" "}
            ({tokenSymbol})
          </div>
          <p className="m-0">
            <span className="font-bold text-base-content/70">Cost:</span>{" "}
            {formatMarketValue(marketInfo[2], v => fromInt128toNumber(v).toFixed())} ({tokenSymbol})
          </p>
          <p className="m-0">
            <span className="font-bold text-base-content/70">Total Buys:</span> {formatMarketValue(marketInfo[3])}
            <span className="px-2">|</span>
            <span className="font-bold text-base-content/70">Total Sells:</span> {formatMarketValue(marketInfo[4])}
          </p>
          <p className="m-0">
            <span className="font-bold text-base-content/70">Total Shares:</span>{" "}
            {formatMarketValue(marketInfo[0], fromInt128toNumber)}
            <span className="px-2">|</span>
            <span className="font-bold text-base-content/70">Total Redeems:</span> {totalRedeemsDisplay}
          </p>
          <div className="m-0">
            <div className="flex items-center gap-4">
              <span className="font-bold text-base-content/70">Shares Balances:</span>{" "}
              {formatSharesBalances(marketInfo[1], market.outcomes)}
            </div>
            <SharesBalanceChart sharesArray={marketInfo[1]} outcomes={market.outcomes} />
          </div>
        </div>
      </div>

      <MarketSetupInfoV8 setup={setup} tokenDecimals={details.tokenDecimals} tokenSymbol={tokenSymbol} isLoading={isSetupLoading} isError={isSetupError} />
    </div>
  );
}

function MarketPricesV8({ market }: { market: MarketInfoV8 }) {
  const { data: details } = usePrecogMarketDetails(market.marketId, market.market, true, "v8");
  const { outcomeData, isLoading, isError } = usePrecogMarketPrices(market.market, market.outcomes, true, "v8");

  if (isLoading) {
    return (
      <div className="flex justify-center items-center pt-4">
        <span className="loading loading-spinner loading-md"></span>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex justify-center items-center pt-4 flex-col">
        <p className="text-error">--! ERROR: COULD NOT LOAD PRICES !--</p>
      </div>
    );
  }

  const outcomesWithPrices = outcomeData.filter(o => typeof o.buyPrice !== "undefined");
  const winningOutcome =
    outcomesWithPrices.length > 0
      ? outcomesWithPrices.reduce((prev, current) =>
          (prev.buyPrice || 0n) > (current.buyPrice || 0n) ? prev : current,
        )
      : null;

  const tokenDecimals = details?.tokenDecimals ?? 18;
  let winningProbability = 0;
  if (winningOutcome?.buyPrice && tokenDecimals) {
    const buyPriceStr = formatUnits(winningOutcome.buyPrice, tokenDecimals);
    winningProbability = Number(buyPriceStr) * 100;
  }

  return (
    <div className="flex flex-col gap-4">
      <h4 className="font-bold text-base-content/70 m-0">:: Outcome Prices ::</h4>
      <div className="p-2 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1 font-mono text-xs">
        {winningOutcome && <div className="text-xs">PREDICTION: {winningOutcome.name} ({winningProbability.toFixed(2)}%)</div>}
        <div className="overflow-x-auto">
          {outcomeData.map((outcome, i) => (
            <div key={i} className="whitespace-nowrap">
              <span className="font-semibold text-base-content/80">{`> ${outcome.name}`}</span>
              <span className="pl-2">
                - BUY: {outcome.buyPrice ? Number(formatUnits(outcome.buyPrice, tokenDecimals)).toFixed(4) : "N/A"}
                <span className="px-2">|</span>
                SELL: {outcome.sellPrice ? Number(formatUnits(outcome.sellPrice, tokenDecimals)).toFixed(4) : "N/A"}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function MarketTradingPanelV8({
  market,
  targetNetwork,
}: {
  market: MarketInfoV8;
  targetNetwork: ReturnType<typeof useTargetNetwork>["targetNetwork"];
}) {
  const { address: connectedAddress } = useAccount();
  const [tradeType, setTradeType] = useState("BUY");
  const [selectedOutcome, setSelectedOutcome] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [costToQuote, setCostToQuote] = useState<number | null>(null);
  const [sharesToQuote, setSharesToQuote] = useState<number | null>(null);
  const { executeBuy, executeOwnedBuy, executePermit2Buy, executeSell, executeRedeem, isPending } = useMarketActions("v8");

  const { data: masterContract } = useScaffoldContract({ contractName: "PrecogMasterV8" });
  const { data: permit2Address, isLoading: isLoadingPermit2Address } = useReadContract({
    chainId: targetNetwork.id,
    address: masterContract?.address,
    abi: masterContract?.abi,
    functionName: "PERMIT2",
    query: { enabled: !!masterContract },
  });
  const { data: isOwnedCollateral, isLoading: isLoadingOwnedCollateral } = useReadContract({
    chainId: targetNetwork.id,
    address: masterContract?.address,
    abi: masterContract?.abi,
    functionName: "ownedCollaterals",
    args: [market.collateral],
    query: { enabled: !!masterContract },
  });

  const { data: permit2Allowance, isLoading: isLoadingPermit2Allowance, refetch: refetchPermit2Allowance } = useReadContract({
    chainId: targetNetwork.id,
    address: market.collateral as `0x${string}`,
    abi: erc20Abi,
    functionName: "allowance",
    args: [connectedAddress as `0x${string}`, permit2Address as `0x${string}`],
    query: { enabled: !!connectedAddress && !!permit2Address },
  });

  const handleGetQuote = () => {
    const amount = Number(inputValue);
    if (amount > 0) {
      if (tradeType === "BUY") {
        setCostToQuote(amount);
        if (permit2Address) {
          refetchPermit2Allowance();
        }
      } else {
        setSharesToQuote(amount);
      }
    }
  };

  const isReadyToFetch = !!connectedAddress && !!targetNetwork?.id;

  const {
    data: accountShares,
    isLoading: isLoadingAccountShares,
    isError: isErrorAccountShares,
    refetch: refetchAccountShares,
  } = useAccountOutcomeBalances(market.marketId, market.market, connectedAddress, targetNetwork.id, isReadyToFetch, undefined, "v8");

  const resetTradingForm = () => {
    setSelectedOutcome("");
    setInputValue("");
    setCostToQuote(null);
    setSharesToQuote(null);
  };

  const now = BigInt(Math.floor(Date.now() / 1000));
  const isMarketClosed = now > market.endTimestamp;

  const outcomeIndex = selectedOutcome ? market.outcomes.indexOf(selectedOutcome) + 1 : 0;
  const { data: buyCalculations, isLoading: isLoadingBuy } = useMarketBuyCalculations(
    targetNetwork.id,
    market.marketId,
    market.market,
    outcomeIndex,
    costToQuote ?? 0,
    isReadyToFetch && tradeType === "BUY" && costToQuote !== null && costToQuote > 0 && outcomeIndex > 0,
    "v8",
  );
  const { data: sellCalculations, isLoading: isLoadingSell } = useMarketSellCalculations(
    targetNetwork.id,
    market.marketId,
    market.market,
    outcomeIndex,
    sharesToQuote ?? 0,
    isReadyToFetch && tradeType === "SELL" && sharesToQuote !== null && sharesToQuote > 0 && outcomeIndex > 0,
    "v8",
  );
  const isLoadingCalculations = isLoadingBuy || isLoadingSell;

  if (!connectedAddress) {
    return (
      <div className="flex justify-center items-center pt-4">
        <p>Please connect wallet to trade.</p>
      </div>
    );
  }

  if (isLoadingAccountShares) {
    return (
      <div className="flex justify-center items-center pt-4">
        <span className="loading loading-spinner loading-md"></span>
      </div>
    );
  }

  if (isErrorAccountShares || !accountShares) {
    return (
      <div className="flex justify-center items-center pt-4 flex-col">
        <p className="text-error">--! ERROR: COULD NOT LOAD YOUR TRADING DATA !--</p>
      </div>
    );
  }

  // Convert the quoted spend amount to wei for comparison against the Permit2 allowance.
  // Falls back to 0n when no quote has been requested yet (disables the button).
  let quotedSpendWei: bigint;
  if (costToQuote !== null && accountShares) {
    // User has requested a quote , convert the input amount to wei using the collateral token decimals
    quotedSpendWei = parseUnits(costToQuote.toString(), accountShares.tokenDecimals);
  } else {
    // No quote yet, treat as zero so the Permit2 allowance check always fails
    quotedSpendWei = 0n;
  }
  const hasInsufficientPermit2Allowance = !permit2Address || !permit2Allowance || permit2Allowance < quotedSpendWei;

  let quoteDisplay = null;
  if (tradeType === "BUY" && buyCalculations && !buyCalculations.hasError && buyCalculations.actualShares > 0) {
    const { actualPrice, actualShares, futurePrice } = buyCalculations;
    const tokenReturnValue = actualShares - actualPrice;
    const returnPercentage = (actualShares / actualPrice - 1) * 100;
    const tokenReturnPercentage = Math.round(returnPercentage);

    quoteDisplay = (
      <div>
        <p className="m-0">
          &gt; <span className="font-bold text-base-content/70">Trade:</span> BUY {actualShares} shares of {selectedOutcome}
        </p>
        <p className="m-0">
          &gt; <span className="font-bold text-base-content/70">Cost:</span> {actualPrice.toFixed(4)} {accountShares.tokenSymbol} (Price per share:{" "}
          {(actualPrice / actualShares).toFixed(4)})
        </p>
        <p className="m-0">
          &gt; <span className="font-bold text-base-content/70">New Price (after trade):</span> {futurePrice.toFixed(4)}{" "}
          {accountShares.tokenSymbol}
        </p>
        <p className="m-0">
          &gt; <span className="font-bold text-base-content/70">Max Potential Return:</span> {tokenReturnValue.toFixed(4)}{" "}
          {accountShares.tokenSymbol} ({tokenReturnPercentage}%)
        </p>
      </div>
    );
  } else if (tradeType === "SELL" && sellCalculations && !sellCalculations.hasError) {
    const { collateralToReceive, pricePerShare, futurePrice, sellFeeRate, sellFeeAmount } = sellCalculations;
    quoteDisplay = (
      <>
        <p className="m-0">
          &gt; <span className="font-bold text-base-content/70">Trade:</span> SELL {sharesToQuote} shares of {selectedOutcome}
        </p>
        <p className="m-0">
          &gt; <span className="font-bold text-base-content/70">Receive:</span> {collateralToReceive.toFixed(4)}{" "}
          {accountShares.tokenSymbol} (Price per share: {pricePerShare.toFixed(4)})
        </p>
        <p className="m-0">
          &gt; <span className="font-bold text-base-content/70">New Price (after trade):</span> {futurePrice.toFixed(4)}{" "}
          {accountShares.tokenSymbol}
        </p>
        {sellFeeRate > 0 && sellFeeAmount > 0 && (
          <p className="m-0">
            &gt; <span className="font-bold text-base-content/70">Sell Fee:</span> {(sellFeeRate * 100).toFixed(4)}% (
            {sellFeeAmount.toFixed(4)} {accountShares.tokenSymbol})
          </p>
        )}
      </>
    );
  }

  const deposited = Number(formatUnits(accountShares.deposited, accountShares.tokenDecimals));
  const withdrew = Number(formatUnits(accountShares.withdrew, accountShares.tokenDecimals));

  return (
    <div className="flex flex-col gap-4">
      <h4 className="font-bold text-base-content/70 m-0">:: Your Info ::</h4>
      <div className="p-2 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1">
        <p className="m-0 break-all ">
          <span className="font-bold text-base-content/70">Account:</span> {connectedAddress}
        </p>
        <p className="m-0">
          <span className="font-bold text-base-content/70">Shares: </span>
          <span>{formatOutcomeShareBalances(accountShares.balances, market.outcomes, accountShares.tokenDecimals)}</span>
        </p>
        <p className="m-0">
          <span className="font-bold text-base-content/70">Buys:</span> {String(accountShares.buys)},{" "}
          <span className="font-bold text-base-content/70">Sells:</span> {String(accountShares.sells)}
        </p>
        <p className="m-0">
          <span className="font-bold text-base-content/70">Deposited: </span>
          <span>
            {deposited.toFixed(4)} {accountShares.tokenSymbol},{" "}
          </span>
          <span className="font-bold text-base-content/70">Withdrew: </span>
          <span>
            {withdrew.toFixed(4)} {accountShares.tokenSymbol}
          </span>
        </p>
        {accountShares.redeemed > 0n && (
          <p className="m-0">
            <span className="font-bold text-base-content/70">Redeemed: </span>
            <span>{Number(formatUnits(accountShares.redeemed, accountShares.tokenDecimals)).toFixed(4)} </span>
            <span>{accountShares.tokenSymbol}</span>
          </p>
        )}
      </div>

      {isMarketClosed ? (
        <div className="flex flex-col gap-2">
          <h4 className="font-bold text-base-content/70 m-0">:: Redeem Winnings ::</h4>
          <div className="p-2 border border-dashed border-base-content/20 rounded-md flex flex-col gap-2">
            <button
              className="btn btn-primary btn-sm w-32"
              disabled={accountShares.redeemed > 0n || isPending}
              onClick={async () => {
                try {
                  await executeRedeem(market.marketId);
                  await refetchAccountShares();
                } catch (error) {
                  console.error("Failed to redeem shares:", error);
                }
              }}
            >
              {isPending ? <span className="loading loading-spinner loading-xs"></span> : "REDEEM"}
            </button>
          </div>
        </div>
      ) : (
        <>
          <h4 className="font-bold text-base-content/70 m-0">:: Trade in the Market ::</h4>
          <div className="p-2 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                className="select select-bordered select-xs min-w-[80px]"
                value={tradeType}
                onChange={e => {
                  setTradeType(e.target.value);
                  setInputValue("");
                  setCostToQuote(null);
                  setSharesToQuote(null);
                }}
              >
                <option>BUY</option>
                <option>SELL</option>
              </select>

              <select
                className="select select-bordered select-xs min-w-[150px]"
                value={selectedOutcome}
                onChange={e => {
                  setSelectedOutcome(e.target.value);
                  setInputValue("");
                  setCostToQuote(null);
                  setSharesToQuote(null);
                }}
              >
                <option value="" disabled>
                  Please select an outcome
                </option>
                {market.outcomes.map(outcome => (
                  <option key={outcome}>{outcome}</option>
                ))}
              </select>

              <input
                type="number"
                min={0}
                placeholder="Shares Amount"
                className="input input-bordered input-xs w-full max-w-[120px] text-center"
                value={inputValue}
                onChange={e => {
                  setInputValue(e.target.value);
                  if (costToQuote !== null) setCostToQuote(null);
                  if (sharesToQuote !== null) setSharesToQuote(null);
                }}
                onKeyDown={e => {
                  if (e.key === "Enter") {
                    handleGetQuote();
                  }
                }}
              />
              <button
                className="btn btn-xs btn-secondary"
                onClick={handleGetQuote}
                disabled={isLoadingCalculations || !inputValue || Number(inputValue) <= 0 || !selectedOutcome}
              >
                QUOTE
              </button>
            </div>

            {isLoadingCalculations && (
              <div className="flex justify-center items-center py-2">
                <span className="loading loading-spinner loading-xs"></span>
              </div>
            )}

            <div className="overflow-x-auto">{quoteDisplay && <div className="whitespace-nowrap">{quoteDisplay}</div>}</div>

            {(buyCalculations?.hasError || sellCalculations?.hasError) && (
              <div className="text-xs text-error">Error: {buyCalculations?.error || sellCalculations?.error}</div>
            )}

            <div className="flex gap-2 mt-2 flex-wrap">
              {tradeType === "BUY" ? (
                <>
                  <button
                    className="btn btn-primary btn-sm w-32"
                    disabled={!quoteDisplay || isLoadingCalculations || isPending}
                    onClick={async () => {
                      if (buyCalculations?.actualShares && buyCalculations.actualPrice) {
                        try {
                          const maxTokenIn = Number(inputValue);
                          await executeBuy(market.marketId, outcomeIndex, buyCalculations.actualShares, market.market, maxTokenIn);
                          resetTradingForm();
                          await refetchAccountShares();
                        } catch (error) {
                          console.error("Buy execution failed:", error);
                        }
                      }
                    }}
                  >
                    {isPending ? <span className="loading loading-spinner loading-xs"></span> : "BUY"}
                  </button>
                  <button
                    className="btn btn-primary btn-sm w-32"
                    disabled={!quoteDisplay || isLoadingCalculations || isPending || !isOwnedCollateral || isLoadingOwnedCollateral}
                    onClick={async () => {
                      if (buyCalculations?.actualShares && buyCalculations.actualPrice) {
                        try {
                          const maxTokenIn = Number(inputValue);
                          await executeOwnedBuy(market.marketId, outcomeIndex, buyCalculations.actualShares, market.market, maxTokenIn);
                          resetTradingForm();
                          await refetchAccountShares();
                        } catch (error) {
                          console.error("Owned buy execution failed:", error);
                        }
                      }
                    }}
                  >
                    {isPending ? <span className="loading loading-spinner loading-xs"></span> : "OWNED BUY"}
                  </button>
                  <button
                    className="btn btn-primary btn-sm w-36"
                    disabled={!quoteDisplay || isLoadingCalculations || isPending || hasInsufficientPermit2Allowance || isLoadingPermit2Address || isLoadingPermit2Allowance}
                    onClick={async () => {
                      if (buyCalculations?.actualShares && buyCalculations.actualPrice && permit2Address) {
                        try {
                          const maxTokenIn = Number(inputValue);
                          await executePermit2Buy(
                            market.marketId,
                            outcomeIndex,
                            buyCalculations.actualShares,
                            market.market,
                            maxTokenIn,
                            permit2Address as `0x${string}`,
                          );
                          resetTradingForm();
                          await refetchAccountShares();
                          await refetchPermit2Allowance();
                        } catch (error) {
                          console.error("Permit2 buy execution failed:", error);
                        }
                      }
                    }}
                  >
                    {isPending ? <span className="loading loading-spinner loading-xs"></span> : "PERMIT2 BUY"}
                  </button>
                </>
              ) : (
                <button
                  className="btn btn-primary btn-sm w-32"
                  disabled={!quoteDisplay || isLoadingCalculations || isPending}
                  onClick={async () => {
                    if (sellCalculations && !sellCalculations.hasError && sharesToQuote) {
                      try {
                        await executeSell(market.marketId, outcomeIndex, sharesToQuote, market.market);
                        resetTradingForm();
                        await refetchAccountShares();
                      } catch (error) {
                        console.error("Sell execution failed:", error);
                      }
                    }
                  }}
                >
                  {isPending ? <span className="loading loading-spinner loading-xs"></span> : "SELL"}
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function MarketSetupInfoV8({
  setup,
  tokenDecimals,
  tokenSymbol,
  isLoading,
  isError,
}: {
  setup: MarketSetupInfoV8Data | undefined;
  tokenDecimals: number;
  tokenSymbol: string;
  isLoading: boolean;
  isError: boolean;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <h4 className="font-bold text-base-content/70 m-0">:: Market Setup Info ::</h4>
        <div className="p-4 border border-dashed border-base-content/20 rounded-md flex items-center gap-2">
          <span className="loading loading-spinner loading-sm"></span>
          <span>Loading setup info…</span>
        </div>
      </div>
    );
  }

  if (isError || !setup) {
    return (
      <div className="flex flex-col gap-2">
        <h4 className="font-bold text-base-content/70 m-0">:: Market Setup Info ::</h4>
        <div className="p-4 border border-dashed border-base-content/20 rounded-md text-error text-sm">
          Failed to load market setup info.
        </div>
      </div>
    );
  }

  const initialCollateralHuman = Number(formatUnits(setup.initialCollateral, tokenDecimals));
  const overround = setup.alpha * setup.totalOutcomes * Math.log(setup.totalOutcomes);
  const efficiency = initialCollateralHuman > 0 ? setup.initialShares / initialCollateralHuman : 0;
  const minCollateral = setup.initialShares * overround;

  return (
    <div className="flex flex-col gap-2">
      <h4 className="font-bold text-base-content/70 m-0">:: Market Setup Info ::</h4>
      <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1 text-sm">
        <div>
          <span className="font-bold text-base-content/70">Initial Shares:</span> {setup.initialShares} <span className="text-base-content/70">(Per outcome)</span>
        </div>
        <div>
          <span className="font-bold text-base-content/70">Alpha:</span> {setup.alpha}
          <span className="ml-2 text-base-content/70">(Overround {overround.toFixed(2)})</span>
        </div>
        <div>
          <span className="font-bold text-base-content/70">Total Outcomes:</span> {setup.totalOutcomes}
        </div>
        <div>
          <span className="font-bold text-base-content/70">Sell Fee Factor:</span> {setup.sellFeeFactor}
          {setup.sellFeeRate > 0 && (
            <span className="ml-2 text-base-content/70">
              (Sell fee: {(setup.sellFeeRate * 100).toFixed(1)}%)
            </span>
          )}
        </div>
        <div>
          <span className="font-bold text-base-content/70">Initial Collateral:</span>{" "}
          {initialCollateralHuman.toFixed(4)}
          {tokenSymbol ? ` ${tokenSymbol}` : ""}
          {" "}
          {initialCollateralHuman > 0 && (
            <>
              <span className="text-base-content/70">(Efficiency {efficiency.toFixed(1)}x | Min collateral {minCollateral.toFixed(4)})</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function getMarketStatus(startTimestamp: bigint, endTimestamp: bigint): { status: string; className: string } {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < startTimestamp) {
    return { status: "CREATED", className: "text-warning" };
  }
  if (now >= startTimestamp && now < endTimestamp) {
    return { status: "OPEN", className: "text-success animate-pulse" };
  }
  return { status: "CLOSED", className: "text-error" };
}

function getDetailedMarketStatus(startTimestamp: bigint, endTimestamp: bigint, result: bigint): string {
  const now = BigInt(Math.floor(Date.now() / 1000));
  if (now < startTimestamp) return "COMING SOON";
  if (now >= startTimestamp && now <= endTimestamp) return "OPEN";
  if (now > endTimestamp && result === 0n) return "WAITING FOR THE RESULT";
  if (result !== 0n) return "CLOSED";
  return "ENDED";
}

function formatSharesBalances(sharesArray: readonly bigint[] | undefined, outcomes: readonly string[] | undefined): string {
  if (!sharesArray || !outcomes) return "N/A";
  const balances = Array.from(sharesArray.slice(1)).map(fromInt128toNumber);
  return balances.map((balance, index) => `${balance.toFixed()} (${outcomes[index]})`).join(" | ");
}

function formatMarketValue(value: bigint | undefined, formatter: (val: bigint) => string | number = String): string {
  return value !== undefined ? formatter(value).toString() : "N/A";
}

function formatOutcomeShareBalances(
  sharesArray: readonly bigint[] | undefined,
  outcomes: readonly string[] | undefined,
  decimals: number | undefined,
): string {
  if (!sharesArray || !outcomes || !decimals) return "N/A";
  const balances = Array.from(sharesArray.slice(1)).map(amount => Number(formatUnits(amount, decimals)));
  return balances.map((balance, index) => `${balance} (${outcomes[index]})`).join(" | ");
}

function SharesBalanceChart({
  sharesArray,
  outcomes,
}: {
  sharesArray: readonly bigint[] | undefined;
  outcomes: readonly string[] | undefined;
}) {
  if (!sharesArray || !outcomes) return null;

  const generateColor = (index: number): string => {
    const hue = 205;
    const s = 0.5;
    const goldenRatio = 0.618033988749895;
    const normalizedIndex = (index * goldenRatio) % 1;
    const l = 0.5 + normalizedIndex * 0.35;
    return `hsl(${hue}, ${s * 100}%, ${l * 100}%)`;
  };

  const balances = Array.from(sharesArray.slice(1)).map(fromInt128toNumber);
  const chartData = balances.map((balance, index) => ({
    name: outcomes[index],
    value: balance,
    fill: generateColor(index),
  }));
  const winningIndex = balances.reduce((maxIndex, current, index, arr) => (current > arr[maxIndex] ? index : maxIndex), 0);

  const chartConfig = outcomes.reduce(
    (acc, outcome, index) => ({
      ...acc,
      [outcome]: {
        label: outcome,
        color: generateColor(index),
      },
    }),
    {
      value: { label: "Shares: " },
    },
  );

  return (
    <div className="w-full max-w-[200px]">
      <ChartContainer config={chartConfig} className="mx-auto aspect-square">
        <PieChart>
          <ChartTooltip cursor={false} content={<ChartTooltipContent />} />
          <Pie
            data={chartData}
            dataKey="value"
            nameKey="name"
            innerRadius={45}
            outerRadius={90}
            strokeWidth={2}
            activeIndex={winningIndex}
            activeShape={(props: PieSectorDataItem) => {
              const { cx, cy, innerRadius, outerRadius = 0, startAngle, endAngle, fill } = props;
              return (
                <Sector
                  cx={cx}
                  cy={cy}
                  innerRadius={innerRadius}
                  outerRadius={Number(outerRadius) + 10}
                  startAngle={startAngle}
                  endAngle={endAngle}
                  fill={fill}
                />
              );
            }}
          />
        </PieChart>
      </ChartContainer>
    </div>
  );
}

function formatDate(timestamp: bigint, includeTime = false): string {
  const date = new Date(Number(timestamp) * 1000);
  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const year = date.getUTCFullYear();
  let dateString = `${day}/${month}/${year}`;
  if (includeTime) {
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    dateString += ` ${hours}:${minutes}`;
  }
  return `${dateString} UTC`;
}
