import { useState } from "react";
import { formatUnits } from "viem";
import { useAccount } from "wagmi";
import { Pie, PieChart, Sector } from "recharts";
import { PieSectorDataItem } from "recharts/types/polar/Pie";
import { ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { MarketInfo, useAccountOutcomeBalances, usePrecogMarketDetails, usePrecogMarketPrices } from "~~/hooks/usePrecogMarketData";
import { useMarketBuyCalculations, useMarketSellCalculations } from "~~/hooks/useMarketCalculations";
import { useMarketActions } from "~~/hooks/useMarketActions";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-eth/networks";
import { ChainWithAttributes } from "~~/utils/scaffold-eth/networks";
import { formatCategoryCsv } from "~~/utils/marketCategories";
import { fromInt128toNumber } from "~~/utils/numbers";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "./Charts";

/**
 * Main component that renders a list of prediction markets
 */
export const MarketListV7 = ({
  markets,
  searchFilter,
  statusFilter,
}: {
  markets: MarketInfo[];
  searchFilter: string;
  statusFilter: string;
}) => {
  const { targetNetwork } = useTargetNetwork();

  if (markets.length === 0) {
    return (
      <div className="flex flex-wrap justify-center py-40">
        <p className="font-mono text-2xl text-accent">-- NO MARKETS DETECTED --</p>
      </div>
    );
  }

  const filteredMarkets = markets.filter(market => {
    const text = `${market.name} ${market.category} ${market.outcomes.join(" ")}`.toLowerCase();
    const nameMatches = text.includes(searchFilter.toLowerCase());
    const status = getMarketStatus(market.startTimestamp, market.endTimestamp).status.toLowerCase();
    const statusMatches = statusFilter === "all" || status === statusFilter;
    return nameMatches && statusMatches;
  });

  return (
    <div className="w-full flex flex-col gap-4 font-mono">
      {filteredMarkets.length > 0 ? (
        filteredMarkets.map(market => <MarketItem key={market.market} market={market} targetNetwork={targetNetwork} />)
      ) : (
        <div className="flex flex-wrap justify-center py-10">
          <p className="font-mono text-lg text-accent">-- NO MARKETS FOUND --</p>
        </div>
      )}
    </div>
  );
};

/**
 * Individual market item component with collapsible details
 */
const MarketItem = ({ market, targetNetwork }: { market: MarketInfo; targetNetwork: ChainWithAttributes }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [showPrices, setShowPrices] = useState(false);
  const [showTrading, setShowTrading] = useState(false);

  const { status, className } = getMarketStatus(market.startTimestamp, market.endTimestamp);

  return (
    <div className="collapse collapse-arrow bg-base-100 transition-colors duration-300 rounded-lg shadow-lg shadow-primary/10">
      <input type="checkbox" className="peer" checked={isOpen} onChange={e => setIsOpen(e.target.checked)} />
      {/* Market Header */}
      <div className="collapse-title peer-checked:bg-base-200/10 text-xs">
        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
          <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
            <h3 className="text-lg font-bold text-base-content/70 break-words m-0" title={market.name}>
              <span className="text-base-content/70 mr-2">[{market.marketId}]</span>
              {market.name}
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

      {/* Market Content */}
      <div className="collapse-content bg-base-300/20 text-sm">
        <div className="pt-4 flex flex-col gap-4">
          {/* Basic Market Info */}
          <div className="gap-2 flex flex-col">
            <h4 className="font-bold text-base-content/70 m-0">:: Market Basic Info ::</h4>
            <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1">
              <div className="break-words">
                <span className="font-bold text-base-content/70 inline-block mb-1">Market Description: </span>
                <span className="inline-block">{market.description}</span>
              </div>
              <div>
                <span className="font-bold text-base-content/70">Category: </span>
                {formatCategoryCsv(market.category) || "N/A"}
              </div>
              <div className="break-words">
                <span className="font-bold text-base-content/70">Outcomes: </span>
                {market.outcomes.join(", ")}
              </div>
              <div className="break-all">
                <span className="font-bold text-base-content/70 inline-block mb-1">Creator: </span>
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
              <div className="break-all">
                <span className="font-bold text-base-content/70 inline-block mb-1">Market Contract: </span>
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
            </div>
          </div>

          {/* Action Buttons */}
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

          {/* Conditional Renders so that we don't have to fetch the data if the user doesn't want to see it */}
          {showDetails && <MarketDetailedInfo market={market} />}
          {showPrices && <MarketPrices market={market} />}
          {showTrading && <MarketTradingPanel market={market} targetNetwork={targetNetwork} />}
        </div>
      </div>
    </div>
  );
};

/**
 * Displays more market information including resolution and trading data
 */
const MarketDetailedInfo = ({ market }: { market: MarketInfo }) => {
  const { address: connectedAddress } = useAccount();
  const { executeReport, isPending: isReporting } = useMarketActions("v7");
  const [selectedOutcome, setSelectedOutcome] = useState("");

  const {
    data: details,
    isLoading: isLoading,
    isError: isError,
    refetch: refetchDetails,
  } = usePrecogMarketDetails(market.marketId, market.market, true, "v7");
  const { targetNetwork } = useTargetNetwork();

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

  const { marketInfo, token, tokenSymbol, marketResultInfo } = details;
  const status = getDetailedMarketStatus(market.startTimestamp, market.endTimestamp, marketResultInfo[0]);
  const isPendingResolution = status === "WAITING FOR THE RESULT";
  const isOracle = connectedAddress === marketResultInfo[2];

  return (
    <div className="flex flex-col gap-4">
      {/* Market Resolution Section */}
      <div className="flex flex-col gap-4">
        <h4 className="font-bold text-base-content/70 m-0">:: Market Resolution Info ::</h4>
        <div className="p-2 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1">
          <p className="m-0">
            <span className="font-bold text-base-content/70">Market Status:</span> {status}
          </p>
          <div className="break-all">
            <span className="font-bold text-base-content/70 inline-block mb-1">Oracle:</span>{" "}
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
                  const outcomeIndex = market.outcomes.indexOf(selectedOutcome) + 1; // +1 because 0 is a reserved value for empty result
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

      {/* Market Trading Section */}
      <div className="flex flex-col gap-4">
        <h4 className="font-bold text-base-content/70 m-0">:: Market Trading Info ::</h4>
        <div className="p-2 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1">
          <p className="m-0">
            <span className="font-bold text-base-content/70">Trading Starts:</span>{" "}
            {formatDate(market.startTimestamp, true)}
          </p>
          <p className="m-0">
            <span className="font-bold text-base-content/70">Trading Ends:</span> {formatDate(market.endTimestamp, true)}
          </p>
          <div className="break-all">
            <span className="font-bold text-base-content/70 inline-block mb-1">Collateral Token:</span>{" "}
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
          </p>
          <p className="m-0">
            <span className="font-bold text-base-content/70">Total Sells:</span> {formatMarketValue(marketInfo[4])}
          </p>
          <p className="m-0">
            <span className="font-bold text-base-content/70">Total Shares:</span>{" "}
            {formatMarketValue(marketInfo[0], fromInt128toNumber)}
          </p>
          <div className="m-0">
            <div className="flex items-center gap-4">
              <span className="font-bold text-base-content/70">Shares Balances:</span>{" "}
              {formatSharesBalances(marketInfo[1], market.outcomes)}
            </div>
            <SharesBalanceChart
              sharesArray={marketInfo[1]}
              outcomes={market.outcomes}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Displays current market prices and outcome probabilities
 */
const MarketPrices = ({ market }: { market: MarketInfo }) => {
  // Make all request needed
  const { data: details } = usePrecogMarketDetails(market.marketId, market.market, true, "v7");
  const { outcomeData, isLoading, isError } = usePrecogMarketPrices(market.market, market.outcomes, true, "v7");

  // Waiting only for the 2nd request (assuming than the first one is completed)
  if (isLoading) {
    return (
      <div className="flex justify-center items-center pt-4">
        <span className="loading loading-spinner loading-md"></span>
      </div>
    );
  }

  // Checking only the 2nd request for errors
  if (isError) {
    return (
      <div className="flex justify-center items-center pt-4 flex-col">
        <p className="text-error">--! ERROR: COULD NOT LOAD PRICES !--</p>
      </div>
    );
  }

  // Find the outcome with the highest buy price (most likely to win)
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
    const buyPriceStr = formatUnits(winningOutcome?.buyPrice, tokenDecimals);
    winningProbability = Number(buyPriceStr) * 100;
  }

  return (
    <div className="flex flex-col gap-4">
      <h4 className="font-bold text-base-content/70 m-0">:: Outcome Prices ::</h4>
      <div className="p-2 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1 font-mono text-xs">
      {winningOutcome && (
        <div className="text-xs">
        PREDICTION: {winningOutcome.name} ({winningProbability.toFixed(2)}%)
        </div>
      )}
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
};

/**
 * Displays a trading panel for a market
 */
const MarketTradingPanel = ({
  market,
  targetNetwork,
}: {
  market: MarketInfo;
  targetNetwork: ChainWithAttributes;
}) => {
  const { address: connectedAddress } = useAccount();
  const [tradeType, setTradeType] = useState("BUY");
  const [selectedOutcome, setSelectedOutcome] = useState("");
  const [inputValue, setInputValue] = useState("");
  const [costToQuote, setCostToQuote] = useState<number | null>(null);
  const [sharesToQuote, setSharesToQuote] = useState<number | null>(null);

  const handleGetQuote = () => {
    const amount = Number(inputValue);
    if (amount > 0) {
      if (tradeType === "BUY") {
        setCostToQuote(amount);
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
  } = useAccountOutcomeBalances(market.marketId, market.market, connectedAddress, targetNetwork.id, isReadyToFetch, undefined, "v7");

  // Function to reset the trading form
  const resetTradingForm = () => {
    setSelectedOutcome("");
    setInputValue("");
    setCostToQuote(null);
    setSharesToQuote(null);
  };

  // Check if market is closed (based on end timestamp)
  const now = BigInt(Math.floor(Date.now() / 1000));
  const isMarketClosed = now > market.endTimestamp;

  // Calculate buy/sell data when a quote is requested (based on selected outcome)
  const outcomeIndex = selectedOutcome ? market.outcomes.indexOf(selectedOutcome) + 1 : 0;
  const { data: buyCalculations, isLoading: isLoadingBuy } = useMarketBuyCalculations(
    targetNetwork.id,
    market.marketId,
    market.market,
    outcomeIndex,
    costToQuote ?? 0,
    isReadyToFetch && tradeType === "BUY" && costToQuote !== null && costToQuote > 0 && outcomeIndex > 0,
    "v7",
  );
  const { data: sellCalculations, isLoading: isLoadingSell } = useMarketSellCalculations(
    targetNetwork.id,
    market.marketId,
    market.market,
    outcomeIndex,
    sharesToQuote ?? 0,
    isReadyToFetch && tradeType === "SELL" && sharesToQuote !== null && sharesToQuote > 0 && outcomeIndex > 0,
    "v7",
  );
  const isLoadingCalculations = isLoadingBuy || isLoadingSell;

  const { executeBuy, executeSell, executeRedeem, isPending } = useMarketActions("v7");

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

  // Determine what data to show in the quote based on the trade type
  let quoteDisplay = null;
  if (tradeType === "BUY" && buyCalculations && !buyCalculations.hasError && buyCalculations.actualShares > 0) {
    const { actualPrice, actualShares, futurePrice } = buyCalculations;

    // Calculate potential returns
    const tokenReturnValue = actualShares - actualPrice;
    const returnPercentage = ((actualShares / actualPrice - 1) * 100);
    const tokenReturnPercentage = Math.round(returnPercentage);

    quoteDisplay = (
      <div>
        <p className="m-0">&gt; <span className="font-bold text-base-content/70">Trade:</span> BUY {actualShares} shares of {selectedOutcome}</p>
        <p className="m-0">&gt; <span className="font-bold text-base-content/70">Cost:</span> {actualPrice.toFixed(4)} {accountShares.tokenSymbol} (Price per share: {(actualPrice / actualShares).toFixed(4)})</p>
        <p className="m-0">&gt; <span className="font-bold text-base-content/70">New Price (after trade):</span> {futurePrice.toFixed(4)} {accountShares.tokenSymbol}</p>
        <p className="m-0">&gt; <span className="font-bold text-base-content/70">Max Potential Return:</span> {tokenReturnValue.toFixed(4)} {accountShares.tokenSymbol} ({tokenReturnPercentage}%)</p>
      </div>
    );
  } else if (tradeType === "SELL" && sellCalculations && !sellCalculations.hasError) {
    const { collateralToReceive, pricePerShare, futurePrice } = sellCalculations;
    quoteDisplay = (
      <>
        <p className="m-0">&gt; <span className="font-bold text-base-content/70">Trade:</span> SELL {sharesToQuote} shares of {selectedOutcome}</p>
        <p className="m-0">&gt; <span className="font-bold text-base-content/70">Receive:</span> {collateralToReceive.toFixed(4)} {accountShares.tokenSymbol} (Price per share: {pricePerShare.toFixed(4)})</p>
        <p className="m-0">&gt; <span className="font-bold text-base-content/70">New Price (after trade):</span> {futurePrice.toFixed(4)} {accountShares.tokenSymbol}</p>
      </>
    );
  }

  // Calculate always displayed amounts
  const deposited = Number(formatUnits(accountShares.deposited, accountShares.tokenDecimals));
  const withdrew = Number(formatUnits(accountShares.withdrew, accountShares.tokenDecimals));

  return (
    <div className="flex flex-col gap-4">
      <h4 className="font-bold text-base-content/70 m-0">:: Your Info ::</h4>
      {/* User Info */}
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
          <span>{deposited.toFixed(4)} {accountShares.tokenSymbol},{" "}</span>
          <span className="font-bold text-base-content/70">Withdrew: </span>
          <span>{withdrew.toFixed(4)} {accountShares.tokenSymbol}</span>
        </p>
        {accountShares.redeemed > 0n && (
          <p className="m-0">
            <span className="font-bold text-base-content/70">Redeemed: </span>
            <span>{Number(formatUnits(accountShares.redeemed, accountShares.tokenDecimals)).toFixed(4)} </span>
            <span>{accountShares.tokenSymbol}</span>
          </p>
        )}
      </div>

      {/* Show either Trading Panel or Redeem Button based on market status */}
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
              {isPending ? (
                <span className="loading loading-spinner loading-xs"></span>
              ) : (
                "REDEEM"
              )}
            </button>
          </div>
        </div>
      ) : (
        <>
          <h4 className="font-bold text-base-content/70 m-0">:: Trade in the Market ::</h4>
          <div className="p-2 border border-dashed border-base-content/20 rounded-md flex flex-col gap-1">

            <div className="flex items-center gap-2 flex-wrap">
              {/* BUY/SELL Selector */}
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

              {/* Outcome selector */}
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

              {/* Total Cost input */}
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

            <div className="overflow-x-auto">
              {quoteDisplay && (
                <div className="whitespace-nowrap">
                  {quoteDisplay}
                </div>
              )}
            </div>

            {(buyCalculations?.hasError || sellCalculations?.hasError) && (
              <div className="text-xs text-error">
                Error: {buyCalculations?.error || sellCalculations?.error}
              </div>
            )}

            <button
              className="btn btn-primary btn-sm w-32 mt-2"
              disabled={!quoteDisplay || isLoadingCalculations || isPending}
              onClick={async () => {
                if (tradeType === "BUY" && buyCalculations?.actualShares && buyCalculations.actualPrice) {
                  try {
                    // Transform user input into decimal number
                    const maxTokenIn = Number(inputValue);
                    await executeBuy(
                      market.marketId,
                      outcomeIndex,
                      buyCalculations.actualShares,
                      market.market,
                      maxTokenIn,
                    );
                    // Reset form and refetch data after successful trade
                    resetTradingForm();
                    await refetchAccountShares();
                  } catch (error) {
                    console.error("Buy execution failed:", error);
                  }
                } else if (tradeType === "SELL" && sellCalculations && !sellCalculations.hasError && sharesToQuote) {
                  try {
                    await executeSell(
                      market.marketId,
                      outcomeIndex,
                      sharesToQuote,
                      market.market
                    );
                    // Reset form and refetch data after successful trade
                    resetTradingForm();
                    await refetchAccountShares();
                  } catch (error) {
                    console.error("Sell execution failed:", error);
                  }
                }
              }}
            >
              {isPending ? (
                <span className="loading loading-spinner loading-xs"></span>
              ) : (
                tradeType
              )}
            </button>
          </div>
        </>
      )}
    </div>
  );
};


/**
 * Displays shares balances as a pie chart
 */
const SharesBalanceChart = ({
  sharesArray,
  outcomes
}: {
  sharesArray: readonly bigint[] | undefined,
  outcomes: readonly string[] | undefined
}) => {
  if (!sharesArray || !outcomes) return null;

  // Generate different shades of sky blue based on index
  const generateColor = (index: number): string => {
    // Use sky blue hue (around 200-210 degrees)
    const hue = 205;

    // Keep saturation moderate-high for vibrant but soft blues (40-60%)
    const s = 0.5; // 50% saturation

    // Vary the lightness based on index using golden ratio for even distribution
    const goldenRatio = 0.618033988749895;
    const normalizedIndex = (index * goldenRatio) % 1;

    // Lightness between 50% and 85% for soft sky blue appearance
    const l = 0.5 + (normalizedIndex * 0.35);

    return `hsl(${hue}, ${s * 100}%, ${l * 100}%)`;
  };

  // Skip the first element (0-index based) and convert the rest to numbers
  const balances = Array.from(sharesArray.slice(1)).map(fromInt128toNumber);

  // Create chart data with generated colors
  const chartData = balances.map((balance, index) => ({
    name: outcomes[index],
    value: balance,
    fill: generateColor(index)
  }));

  // Find the index of the outcome with highest shares
  const winningIndex = balances.reduce((maxIndex, current, index, arr) =>
    current > arr[maxIndex] ? index : maxIndex
  , 0);

  // Create chart config with generated colors
  const chartConfig = outcomes.reduce((acc, outcome, index) => ({
    ...acc,
    [outcome]: {
      label: outcome,
      color: generateColor(index)
    }
  }), {
    value: { label: "Shares: " }
  });

  return (
    <div className="w-full max-w-[200px]">
      <ChartContainer
        config={chartConfig}
        className="mx-auto aspect-square"
      >
        <PieChart>
          <ChartTooltip
            cursor={false}
            content={<ChartTooltipContent />}
          />
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
};


// =================================================================================================
// Helper Functions
// =================================================================================================

/**
 * Returns the current market status and associated styling class
 */
const getMarketStatus = (startTimestamp: bigint, endTimestamp: bigint): { status: string; className: string } => {
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (now < startTimestamp) {
    return { status: "CREATED", className: "text-warning" };
  } else if (now >= startTimestamp && now < endTimestamp) {
    return { status: "OPEN", className: "text-success animate-pulse" };
  } else {
    return { status: "CLOSED", className: "text-error" };
  }
};

/**
 * Returns a detailed market status string based on timing and result
 */
const getDetailedMarketStatus = (startTimestamp: bigint, endTimestamp: bigint, result: bigint): string => {
  const now = BigInt(Math.floor(Date.now() / 1000));

  if (now < startTimestamp) {
    return "COMING SOON";
  } else if (now >= startTimestamp && now <= endTimestamp) {
    return "OPEN";
  } else if (now > endTimestamp && result === 0n) {
    return "WAITING FOR THE RESULT";
  } else if (result !== 0n) {
    return "CLOSED";
  }

  return "ENDED";
};

/**
 * Formats the shares balances of a market
 * @param sharesArray array of shares balances (index 0 is skipped as it's a 0-index based)
 * @param outcomes The outcomes of the market
 * @returns Comma-separated string of share balances
 */
const formatSharesBalances = (
  sharesArray: readonly bigint[] | undefined,
  outcomes: readonly string[] | undefined,
): string => {
  if (!sharesArray || !outcomes) return "N/A";

  // Skip the first element (0-index based) and convert the rest to numbers
  const balances = Array.from(sharesArray.slice(1)).map(fromInt128toNumber);

  return balances.map((balance, index) => `${balance.toFixed()} (${outcomes[index]})`).join(" | ");
};

/**
 * Formats a market value using a formatter function
 * @param value The bigint value to format
 * @param formatter Optional function to format the value (defaults to String)
 * @returns Formatted string representation of the value
 */
const formatMarketValue = (value: bigint | undefined, formatter: (val: bigint) => string | number = String): string => {
  return value !== undefined ? formatter(value).toString() : "N/A";
};

/**
 * Formats a Unix timestamp into a human-readable date string
 * @param timestamp Unix timestamp in seconds
 * @param includeTime Whether to include hours and minutes
 * @returns Formatted date string in UTC
 */
const formatDate = (timestamp: bigint, includeTime = false) => {
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
};

/**
 * Formats outcome shares balances [eg.: ""]
 * @param sharesArray array of token balances in wei (index 0 is skipped as it's a 0-index based)
 * @param outcomes The outcomes of the market
 * @param decimals The number of decimals of the token
 * @returns Comma-separated string of token balances
 */
const formatOutcomeShareBalances = (
  sharesArray: readonly bigint[] | undefined,
  outcomes: readonly string[] | undefined,
  decimals: number | undefined,
): string => {
  if (!sharesArray || !outcomes || !decimals) return "N/A";

  // Skip the first element (0-index based) and convert the rest to balances
  const balances = Array.from(sharesArray.slice(1)).map(amount => Number(formatUnits(amount, decimals)));

  return balances.map((balance, index) => `${balance} (${outcomes[index]})`).join(" | ");
};
