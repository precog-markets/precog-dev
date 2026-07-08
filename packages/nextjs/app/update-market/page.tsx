"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { useScaffoldContract, useScaffoldReadContract, useTransactor } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { getBlockExplorerAddressLink } from "~~/utils/scaffold-eth";
import { notification } from "~~/utils/scaffold-eth";
import { AddressInput } from "~~/components/scaffold-eth";
import { ArrowRightIcon, ArrowTopRightOnSquareIcon } from "@heroicons/react/24/outline";
import { BaseError } from "viem";
import { ContractName } from "~~/utils/scaffold-eth/contract";
import { getAvailablePrecogMasterVersions, getPrecogMasterContractKey, type PrecogMasterVersion } from "~~/utils/scaffold-eth/contractsData";
import { normalizeCategoryCsv } from "~~/utils/marketCategories";
import { fromInt128toNumber } from "~~/utils/numbers";

// TODO this defaults could have a config shared file with update-market page
const DEFAULT_CREATOR = "0x0000000000000000000000000000000000000000";
const DEFAULT_ORACLE = "0x9475A4C1BF5Fc80aE079303f14B523da19619c16";
const DEFAULT_V8_SELL_FEE_FACTOR = 100000;
const SELL_FEE_OPTIONS: { label: string; factor: number }[] = [
  { label: "25%", factor: 4 },
  { label: "20%", factor: 5 },
  { label: "10%", factor: 10 },
  { label: "5%", factor: 20 },
  { label: "4%", factor: 25 },
  { label: "2%", factor: 50 },
  { label: "1%", factor: 100 },
  { label: "0.5%", factor: 200 },
  { label: "0.2%", factor: 500 },
  { label: "0.1%", factor: 1000 },
  { label: "No sell fee", factor: 100000 },
];


const ZERO_ADDRESS = DEFAULT_CREATOR;
const SKIP_ADDRESS = ZERO_ADDRESS;
const SKIP_UINT = BigInt(0);
const SKIP_V8_SELL_FEE_FACTOR = BigInt(-1);

type OriginalMarketData = {
    name: string;
    description: string;
    category: string;
    outcomes: string;
    startTimestamp: number;
    endTimestamp: number;
    creator: string;
    oracle: string;
    sellFeeFactor?: number;
    marketAddress: string;
    imageURL?: string;
  };

export default function UpdateMarket() {
  const { address: connectedAddress } = useAccount();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending } = useWriteContract();
  const writeTx = useTransactor();
  const { targetNetwork } = useTargetNetwork();

  const [selectedVersion, setSelectedVersion] = useState<PrecogMasterVersion>("v8");
  const availableVersions = getAvailablePrecogMasterVersions(targetNetwork.id);
  const dropdownVersions = availableVersions.length > 0 ? availableVersions : (["v7"] as PrecogMasterVersion[]);

  useEffect(() => {
    const currentAvailable = getAvailablePrecogMasterVersions(targetNetwork.id);
    const currentDropdown = currentAvailable.length > 0 ? currentAvailable : (["v7"] as PrecogMasterVersion[]);
    const preferred = currentDropdown.includes("v8") ? "v8" : currentDropdown[0];
    setSelectedVersion(preferred);
  }, [targetNetwork.id]);

  const selectedContractName = getPrecogMasterContractKey(selectedVersion) as ContractName;
  const marketContractName = (selectedVersion === "v8" ? "PrecogMarketV8" : "PrecogMarketV7") as ContractName;

  const { data: master, isLoading: isMasterLoading } = useScaffoldContract({ contractName: selectedContractName });
  const { data: marketContract } = useScaffoldContract({ contractName: marketContractName });

  // Market id input and loading states
  const [inputMarketId, setInputMarketId] = useState<string>("");
  const [isValidId, setIsValidId] = useState<boolean>(true);
  const [marketId, setMarketId] = useState<string>("");
  const [isLoadingMarket, setIsLoadingMarket] = useState(false);
  const [marketAddress, setMarketAddress] = useState<string>("");

  // Form states (shared labels, version-specific meaning)
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const [category, setCategory] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [startTime, setStartTime] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [endTime, setEndTime] = useState<string>("");
  const [creator, setCreator] = useState<string>(connectedAddress || DEFAULT_CREATOR);
  const [oracle, setOracle] = useState<string>(connectedAddress || DEFAULT_ORACLE);
  const [outcomes, setOutcomes] = useState<string>("YES,NO");
  const [sellFeeFactor, setSellFeeFactor] = useState<number>(DEFAULT_V8_SELL_FEE_FACTOR);
  const [imageURL, setImageURL] = useState<string>("");
  const [originalMarketData, setOriginalMarketData] = useState<OriginalMarketData | null>(null);
  // Only populate form when we first get data for this market+version; avoid overwriting user edits on refetch
  const lastPopulatedKeyRef = useRef<string>("");

  const {
    data: marketData,
    isLoading: isMarketDataLoading,
    isFetching: isMarketDataFetching,
    refetch: refetchMarketData,
  } = useScaffoldReadContract({
    contractName: selectedContractName,
    functionName: "markets",
    args: marketId ? [BigInt(marketId)] : [undefined],
    query: { enabled: !!marketId },
    watch: false,
  });

  const clearForm = useCallback(() => {
    lastPopulatedKeyRef.current = "";
    setOriginalMarketData(null);
    setMarketId("");
    setName("");
    setDescription("");
    setCategory("");
    setOutcomes("YES,NO");
    setStartDate("");
    setStartTime("");
    setEndDate("");
    setEndTime("");
    setCreator(connectedAddress || DEFAULT_CREATOR);
    setOracle(connectedAddress || DEFAULT_ORACLE);
    setSellFeeFactor(DEFAULT_V8_SELL_FEE_FACTOR);
    setImageURL("");
    setMarketAddress("");
  }, [connectedAddress]);

  const setDateTimeFromTimestamps = useCallback((startTimestamp: number, endTimestamp: number) => {
    const start = timestampToDateTime(startTimestamp);
    const end = timestampToDateTime(endTimestamp);
    setStartDate(start.date);
    setStartTime(start.time);
    setEndDate(end.date);
    setEndTime(end.time);
  }, []);

  const loadV7MarketForm = useCallback(async (data: readonly unknown[]) => {
    // V7 markets(id): [name, description, category, outcomes, startTs, endTs, creator, marketAddress]
    const loadedMarketAddress = String(data[7] ?? "");
    if (!loadedMarketAddress || loadedMarketAddress === ZERO_ADDRESS) {
      notification.error("Market not found");
      clearForm();
      return;
    }

    const startTimestamp = Number(data[4] ?? 0);
    const endTimestamp = Number(data[5] ?? 0);
    const nameVal = String(data[0] ?? "");
    const descriptionVal = String(data[1] ?? "");
    const categoryVal = String(data[2] ?? "");
    const rawOutcomes = data[3];
    const outcomesVal = Array.isArray(rawOutcomes) ? rawOutcomes.join(",") : rawOutcomes != null ? String(rawOutcomes) : "YES,NO";
    const creatorVal = String(data[6] ?? connectedAddress ?? DEFAULT_CREATOR);

    let oracleVal: string = connectedAddress || DEFAULT_ORACLE;
    if (publicClient && marketContract?.abi) {
      try {
        const oracleResult = await publicClient.readContract({
          address: loadedMarketAddress as `0x${string}`,
          abi: marketContract.abi as any,
          functionName: "oracle",
          args: [],
        });
        oracleVal = String(oracleResult ?? oracleVal);
      } catch {
        // keep fallback oracle
      }
    }

    setName(nameVal);
    setDescription(descriptionVal);
    setCategory(categoryVal);
    setOutcomes(outcomesVal);
    setCreator(creatorVal);
    setOracle(oracleVal);
    setMarketAddress(loadedMarketAddress);
    setDateTimeFromTimestamps(startTimestamp, endTimestamp);
    setOriginalMarketData({
      name: nameVal,
      description: descriptionVal,
      category: categoryVal,
      outcomes: outcomesVal,
      startTimestamp: startTimestamp,
      endTimestamp: endTimestamp,
      creator: creatorVal,
      oracle: oracleVal,
      marketAddress: loadedMarketAddress,
    });
  }, [connectedAddress, publicClient, marketContract, clearForm, setDateTimeFromTimestamps]);

  const loadV8MarketForm = useCallback(async (data: readonly unknown[]) => {
    // V8 markets(id): [question, resolutionCriteria, imageURL, category, outcomes, creator, operator, market, startTs, endTs, collateral]
    const loadedMarketAddress = String(data[7] ?? "");
    if (!loadedMarketAddress || loadedMarketAddress === ZERO_ADDRESS) {
      notification.error("Market not found");
      clearForm();
      return;
    }

    const startTimestamp = Number(data[8] ?? 0);
    const endTimestamp = Number(data[9] ?? 0);
    const questionVal = String(data[0] ?? "");
    const resolutionCriteriaVal = String(data[1] ?? "");
    const imageURLVal = String(data[2] ?? "");
    const categoryVal = String(data[3] ?? "");
    const outcomesVal = String(data[4] ?? "YES,NO");
    const creatorVal = String(data[5] ?? connectedAddress ?? DEFAULT_CREATOR);

    let oracleVal: string = connectedAddress || DEFAULT_ORACLE;
    let sellFeeFactorVal = DEFAULT_V8_SELL_FEE_FACTOR;
    if (publicClient && marketContract?.abi) {
      try {
        const [oracleResult, setupResult] = await publicClient.multicall({
          allowFailure: true,
          contracts: [
            {
              address: loadedMarketAddress as `0x${string}`,
              abi: marketContract.abi as any,
              functionName: "oracle",
              args: [],
            },
            {
              address: loadedMarketAddress as `0x${string}`,
              abi: marketContract.abi as any,
              functionName: "getMarketSetupInfo",
              args: [],
            },
          ],
        });

        if (oracleResult?.status === "success") {
          oracleVal = String(oracleResult.result ?? oracleVal);
        }
        if (setupResult?.status === "success" && Array.isArray(setupResult.result)) {
          const rawSellFeeFactor = setupResult.result[3];
          if (typeof rawSellFeeFactor === "bigint") {
            sellFeeFactorVal = fromInt128toNumber(rawSellFeeFactor);
          }
        }
      } catch {
        // keep fallback setup values
      }
    }

    setName(questionVal);
    setDescription(resolutionCriteriaVal);
    setImageURL(imageURLVal);
    setCategory(categoryVal);
    setOutcomes(outcomesVal);
    setCreator(creatorVal);
    setOracle(oracleVal);
    setSellFeeFactor(sellFeeFactorVal);
    setMarketAddress(loadedMarketAddress);
    setDateTimeFromTimestamps(startTimestamp, endTimestamp);
    setOriginalMarketData({
      name: questionVal,
      description: resolutionCriteriaVal,
      category: categoryVal,
      outcomes: outcomesVal,
      startTimestamp,
      endTimestamp,
      creator: creatorVal,
      oracle: oracleVal,
      sellFeeFactor: sellFeeFactorVal,
      marketAddress: loadedMarketAddress,
      imageURL: imageURLVal,
    });
  }, [connectedAddress, publicClient, marketContract, clearForm, setDateTimeFromTimestamps]);

  // Handle loading market data
  const handleLoadMarket = async () => {
    if (!inputMarketId) {
      notification.error("Please enter a market ID");
      return;
    }

    if (marketId === inputMarketId) {
      lastPopulatedKeyRef.current = "";
      refetchMarketData();
      notification.info("Market data refetched");
    } else {
      setMarketId(inputMarketId);
    }
  };

  // Handle market id input change
  const handleMarketIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInputMarketId(value);
    setIsValidId(validateMarketId(value));
  };

  // Version-specific market mapping: populate form only when we have new data for this market+version
  useEffect(() => {
    const isLoading = isMarketDataLoading || isMarketDataFetching;
    setIsLoadingMarket(isLoading);
    if (isLoading || !marketData || !marketId) return;

    const key = `${marketId}-${selectedVersion}`;
    if (lastPopulatedKeyRef.current === key) {
      return; // Already populated for this market+version; don't overwrite user edits
    }

    let cancelled = false;
    lastPopulatedKeyRef.current = key;

    const run = async () => {
      const data = marketData as readonly unknown[];
      if (selectedVersion === "v8") {
        await loadV8MarketForm(data);
      } else {
        await loadV7MarketForm(data);
      }
    };

    run().catch(() => {
      if (!cancelled) {
        lastPopulatedKeyRef.current = "";
        notification.error("Failed to load market data");
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    marketData,
    marketId,
    isMarketDataLoading,
    isMarketDataFetching,
    selectedVersion,
    connectedAddress,
    publicClient,
    marketContract,
    loadV7MarketForm,
    loadV8MarketForm,
  ]);

  const buildV7UpdateArgs = (startTimestamp: number, endTimestamp: number, parsedOutcomes: string[], originalData: OriginalMarketData) => {
    const normalizedCategory = normalizeCategoryCsv(category);
    const normalizedOriginalCategory = normalizeCategoryCsv(originalData.category);
    const startChanged = Math.abs(startTimestamp - originalData.startTimestamp) > 60;
    const endChanged = Math.abs(endTimestamp - originalData.endTimestamp) > 60;
    const nameChanged = name !== originalData.name;
    const descriptionChanged = description !== originalData.description;
    const categoryChanged = normalizedCategory !== normalizedOriginalCategory;
    const outcomesChanged = outcomes !== originalData.outcomes;
    const creatorChanged = creator !== originalData.creator;
    const oracleChanged = oracle !== originalData.oracle;

    return [
      BigInt(marketId),
      nameChanged ? name : "",
      descriptionChanged ? description : "",
      categoryChanged ? normalizedCategory : "",
      outcomesChanged ? parsedOutcomes : [],
      startChanged ? BigInt(startTimestamp) : SKIP_UINT,
      endChanged ? BigInt(endTimestamp) : SKIP_UINT,
      (creatorChanged ? creator : SKIP_ADDRESS) as `0x${string}`,
      (oracleChanged ? oracle : SKIP_ADDRESS) as `0x${string}`,
    ] as const;
  };

  const buildV8UpdateArgs = (startTimestamp: number, endTimestamp: number, parsedOutcomes: string[], originalData: OriginalMarketData) => {
    const normalizedCategory = normalizeCategoryCsv(category);
    const normalizedOriginalCategory = normalizeCategoryCsv(originalData.category);
    const startChanged = Math.abs(startTimestamp - originalData.startTimestamp) > 60;
    const endChanged = Math.abs(endTimestamp - originalData.endTimestamp) > 60;
    const questionChanged = name !== originalData.name;
    const resolutionCriteriaChanged = description !== originalData.description;
    const imageURLChanged = imageURL !== originalData.imageURL;
    const categoryChanged = normalizedCategory !== normalizedOriginalCategory;
    const outcomesChanged = outcomes !== originalData.outcomes;
    const creatorChanged = creator !== originalData.creator;
    const oracleChanged = oracle !== originalData.oracle;
    const sellFeeChanged = Number.isFinite(originalData.sellFeeFactor) ? sellFeeFactor !== originalData.sellFeeFactor : true;

    return [
      BigInt(marketId),
      questionChanged ? name : "",
      resolutionCriteriaChanged ? description : "",
      imageURLChanged ? imageURL : "",
      categoryChanged ? normalizedCategory : "",
      outcomesChanged ? parsedOutcomes.join(",") : "",
      (creatorChanged ? creator : SKIP_ADDRESS) as `0x${string}`,
      startChanged ? BigInt(startTimestamp) : SKIP_UINT,
      endChanged ? BigInt(endTimestamp) : SKIP_UINT,
      (oracleChanged ? oracle : SKIP_ADDRESS) as `0x${string}`,
      sellFeeChanged ? BigInt(Math.round(sellFeeFactor)) : SKIP_V8_SELL_FEE_FACTOR,
    ] as const;
  };

  const handleWriteAction = async () => {
    if (!master) {
      notification.error("Contract not loaded");
      return;
    }
    if (!originalMarketData) {
      notification.error("Load a market before submitting.");
      return;
    }

    try {
      const startTimestamp = calculateTimestamp(startDate, startTime);
      const endTimestamp = calculateTimestamp(endDate, endTime);
      const parsedOutcomes = outcomes.split(",").map(value => value.trim()).filter(Boolean);
      const normalizedCategory = normalizeCategoryCsv(category);
      const normalizedOriginalCategory = normalizeCategoryCsv(originalMarketData.category);

      console.log(`Updating market ${marketId}...`);
      console.log("> Name/Question:", name);
      console.log("> Description/Resolution:", description);
      console.log("> Category:", normalizedCategory);
      console.log("> Outcomes:", parsedOutcomes);
      console.log("> Start:", new Date(startTimestamp * 1000).toUTCString(), `(${startTimestamp})`);
      console.log("> End:", new Date(endTimestamp * 1000).toUTCString(), `(${endTimestamp})`);
      console.log("> Creator:", creator);
      console.log("> Oracle:", oracle);
      if (selectedVersion === "v8") {
        console.log("> Sell fee factor:", sellFeeFactor);
      }

      // Compute sell fee factor change only for V8 when we have a valid original value
      let sellFeeFactorChange: { from: number; to: number } | null = null;
      const origSellFeeFactor = originalMarketData.sellFeeFactor;
      if (selectedVersion === "v8" && origSellFeeFactor !== undefined && Number.isFinite(origSellFeeFactor)) {
        if (sellFeeFactor !== origSellFeeFactor) {
          sellFeeFactorChange = { from: origSellFeeFactor, to: sellFeeFactor };
        }
      }

      const changes = {
        name: name !== originalMarketData.name ? { from: originalMarketData.name, to: name } : null,
        description: description !== originalMarketData.description ? { from: originalMarketData.description, to: description } : null,
        category: normalizedCategory !== normalizedOriginalCategory ? { from: normalizedOriginalCategory, to: normalizedCategory } : null,
        outcomes: outcomes !== originalMarketData.outcomes ? { from: originalMarketData.outcomes, to: outcomes } : null,
        startTimestamp: Math.abs(startTimestamp - originalMarketData.startTimestamp) > 60 ? { from: originalMarketData.startTimestamp, to: startTimestamp } : null,
        endTimestamp: Math.abs(endTimestamp - originalMarketData.endTimestamp) > 60 ? { from: originalMarketData.endTimestamp, to: endTimestamp } : null,
        creator: creator !== originalMarketData.creator ? { from: originalMarketData.creator, to: creator } : null,
        oracle: oracle !== originalMarketData.oracle ? { from: originalMarketData.oracle, to: oracle } : null,
        sellFeeFactor: sellFeeFactorChange,
      };

      const actualChanges = Object.fromEntries(Object.entries(changes).filter(([, value]) => value !== null));
      if (Object.keys(actualChanges).length > 0) {
        console.log("Changes detected:", actualChanges);
      } else {
        console.log("No changes detected");
        notification.warning("Attention - No changes detected");
      }

      if (
        marketId &&
        name &&
        description &&
        normalizedCategory &&
        parsedOutcomes.length >= 2 &&
        startTimestamp > 0 &&
        endTimestamp > startTimestamp
      ) {
        if (!connectedAddress) {
          notification.error("Connect wallet before submitting.");
          return;
        }
        if (!publicClient) {
          notification.error("Public client not ready. Try again.");
          return;
        }

        let contractTx: any;
        if (selectedVersion === "v8") {
          // Build contract tx for PrecogMasterV8 market update
          contractTx = {
            address: master.address,
            abi: master.abi as any,
            functionName: "updateMarket",
            args: buildV8UpdateArgs(startTimestamp, endTimestamp, parsedOutcomes, originalMarketData),
            account: connectedAddress,
          }
        } else {
          // Build contract tx for PrecogMasterV7 market update
          contractTx = {
            address: master.address,
            abi: master.abi as any,
            functionName: "updateMarket",
            args: buildV7UpdateArgs(startTimestamp, endTimestamp, parsedOutcomes, originalMarketData),
            account: connectedAddress,
          }
        }
        const txInfo = { contract: master.address, function: "updateMarket", args: contractTx.args};
        console.log("[UpdateMarket] TX Info:", txInfo);

        // Simulate contract Tx (show error if reverted)
        try {
          await publicClient.simulateContract(contractTx);
        } catch (error) {
          const message = error instanceof BaseError ? error.shortMessage || error.message : "Transaction would revert";
          notification.error(`Simulation failed: ${message}`);
          return;
        }

        // Send already simulated contract tx
        await writeTx(() => writeContractAsync(contractTx), { blockConfirmations: 1 });
        console.log("Market updated!");
      } else {
        notification.error("Invalid/empty market parameters");
      }
    } catch (e) {
      console.log("Unexpected error in writeTx", e);
      notification.error("Failed to update market");
    }
  };

  if (!master || isMasterLoading) {
    return (
      <div className="flex flex-row justify-center items-center">
        <div className="flex flex-col gap-3 p-4 mt-3 bg-base-100 rounded-2xl w-1/4 min-w-[400px]">
          <div className="text-xl font-bold">Update Market</div>
          <span className="text-lg">Fetching data...</span>
        </div>
      </div>
    );
  }

  const isFormDisabled = !marketId || isLoadingMarket;

  return (
    <>
      <div className="flex flex-row justify-center items-center">
        <div className="flex flex-col gap-2 p-4 mt-3 bg-base-100 rounded-2xl w-1/4 min-w-[400px] overflow-auto">
          <div className="flex flex-row justify-between items-center gap-2 flex-wrap px-2">
            <div className="flex items-center gap-2">
              <div className="text-xl font-bold">Update Market</div>
              <select
                className="select select-bordered select-sm font-mono font-bold"
                value={selectedVersion}
                onChange={e => setSelectedVersion(e.target.value as PrecogMasterVersion)}
              >
                {dropdownVersions.map(version => (
                  <option key={version} value={version}>
                    {version.toUpperCase()}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-row items-center gap-1">
              <span className="text-sm">[ Id:</span>
              <input
                type="text"
                value={inputMarketId}
                onChange={handleMarketIdChange}
                onKeyDown={e => {
                  if (e.key === "Enter" && inputMarketId && isValidId && !isLoadingMarket) {
                    handleLoadMarket();
                  }
                }}
                placeholder="#"
                title={!isValidId && inputMarketId ? "Market ID must be a non-negative integer" : "Enter market ID"}
                className={`input input-sm w-16 text-md font-bold px-1 h-6 border rounded-lg ${
                  inputMarketId && !isValidId ? "border-error text-error" : "border-primary"
                }`}
              />
              <button
                className="btn btn-xs btn-ghost px-1 hover:bg-primary/10"
                onClick={handleLoadMarket}
                disabled={!inputMarketId || !isValidId || isLoadingMarket}
              >
                {isLoadingMarket ? <span className="loading loading-spinner loading-xs"></span> : <ArrowRightIcon className="h-4 w-4" />}
              </button>
              <span className="text-sm">]</span>
            </div>
          </div>

          <div className={`flex flex-col gap-2 transition-opacity duration-200 ${isFormDisabled ? "opacity-50 pointer-events-none" : ""}`}>
            <div className="flex flex-col items-start px-2">
              <span className="text-sm font-bold">{selectedVersion === "v8" ? "Question" : "Name"}</span>
              <input
                type="text"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Will Argentina beat Colombia in the Copa America?"
                className="input border border-primary rounded-xl w-full"
              />
              <span className="text-xs italic pl-3">Note: The first letter should be uppercase and should end with a question mark.</span>
            </div>
            <div className="flex flex-col items-start px-2">
              <span className="text-sm font-bold">{selectedVersion === "v8" ? "Resolution Criteria" : "Description"}</span>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Winner at match conclusion (regular, extra-time and penalty shoot-out)."
                className="input border border-primary rounded-xl px-4 py-2 min-h-24 w-full"
              />
              <span className="text-xs italic pl-3">Note: should specify market resolve conditions.</span>
            </div>
            {selectedVersion === "v8" && (
              <div className="flex flex-col items-start px-2">
                <span className="text-sm font-bold">Image URL</span>
                <input
                  type="text"
                  value={imageURL}
                  onChange={e => setImageURL(e.target.value)}
                  placeholder="https://example.com/market-image.jpg"
                  className="input border border-primary rounded-xl w-full"
                />
                <span className="text-xs italic pl-3">Note: Optional image URL for market.</span>
              </div>
            )}
            <div className="flex flex-col items-start px-2">
              <span className="text-sm font-bold">Category</span>
              <input
                type="text"
                placeholder="SPORTS,POLITICS"
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="input border border-primary rounded-xl w-full"
              />
              <span className="text-xs italic pl-3">Note: Comma-separated categories.</span>
            </div>
            <div className="flex flex-col items-start px-2">
              <span className="text-sm font-bold">Outcomes</span>
              <input
                type="text"
                value={outcomes}
                onChange={e => setOutcomes(e.target.value)}
                className="input border border-primary rounded-xl w-full"
              />
              <span className="text-xs italic pl-3">Note: Possible outcomes CSV (eg: YES, NO, MAYBE).</span>
            </div>
            <div className="flex flex-col items-start px-2">
              <span className="text-sm font-bold">Start Date (GMT)</span>
              <div className="flex flex-row gap-4 w-full">
                <input
                  type="date"
                  className="input border border-primary rounded-xl w-1/2"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                />
                <input
                  type="time"
                  className="input border border-primary rounded-xl w-1/2"
                  value={startTime}
                  onChange={e => setStartTime(e.target.value)}
                />
              </div>
              <span className="text-xs italic pl-3">Note: when users can start buying shares.</span>
            </div>
            <div className="flex flex-col items-start px-2">
              <span className="text-sm font-bold">End Date (GMT)</span>
              <div className="flex flex-row gap-4 w-full">
                <input
                  type="date"
                  className="input border border-primary rounded-xl w-1/2"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                />
                <input
                  type="time"
                  className="input border border-primary rounded-xl w-1/2"
                  value={endTime}
                  onChange={e => setEndTime(e.target.value)}
                />
              </div>
              <span className="text-xs italic pl-3">Note: when share trading stops (waiting for result).</span>
            </div>
            <div className="flex flex-col items-start px-2">
              <span className="text-sm font-bold">Creator</span>
              <div className="w-full py-1">
                <AddressInput value={creator} onChange={setCreator} disableAutofocus />
              </div>
              <span className="text-xs italic pl-3">Note: External or internal Market creator wallet.</span>
            </div>
            <div className="flex flex-col items-start px-2">
              <span className="text-sm font-bold">Oracle</span>
              <div className="w-full py-1">
                <AddressInput value={oracle} onChange={setOracle} disableAutofocus />
              </div>
              <span className="text-xs italic pl-3">Note: Address that will report the market result.</span>
            </div>
            {selectedVersion === "v8" && (
              <div className="flex flex-col items-start px-2 w-full">
                <div className="flex flex-row gap-4 w-full">
                  <span className="text-sm font-bold w-3/4">Sell fee</span>
                  <span className="text-sm font-bold w-1/4">Sell fee factor</span>
                </div>
                <div className="flex flex-row gap-4 w-full">
                  <select
                    value={sellFeeFactor}
                    onChange={e => setSellFeeFactor(Number(e.target.value))}
                    className="select select-bordered rounded-xl w-3/4"
                  >
                    {SELL_FEE_OPTIONS.map(({ label, factor }) => (
                      <option key={factor} value={factor}>
                        {label}
                      </option>
                    ))}
                    {!SELL_FEE_OPTIONS.some(o => o.factor === sellFeeFactor) && (
                      <option value={sellFeeFactor}>Custom ({sellFeeFactor})</option>
                    )}
                  </select>
                  <div className="input border border-primary rounded-xl w-1/4 bg-base-200 flex items-center justify-center font-mono text-sm">
                    {sellFeeFactor}
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-col items-center p-3 w-full">
              <button className="btn btn-primary rounded-xl" onClick={handleWriteAction} disabled={isPending || isFormDisabled}>
                {isPending ? <span className="loading loading-spinner loading-sm"></span> : "Update Market"}
              </button>
            </div>
          </div>
        </div>
      </div>
      {marketAddress && (
        <div className="flex justify-center items-center pt-4 pb-2">
          <div className="font-mono text-center text-base flex flex-col sm:flex-row">
            <span className="font-bold text-base-content/70 mr-2">:: PrecogMarket ::</span>
            <a
              href={getBlockExplorerAddressLink(targetNetwork, marketAddress)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 hover:underline text-accent flex-col sm:flex-row break-all font-mono"
            >
              {marketAddress}
              <ArrowTopRightOnSquareIcon className="w-3 h-3" />
            </a>
          </div>
        </div>
      )}
    </>
  );
}

const timestampToDateTime = (timestamp: number): { date: string; time: string } => {
  if (!timestamp) return { date: "", time: "" };
  const dateUtc = new Date(timestamp * 1000);
  const yyyy = dateUtc.getUTCFullYear();
  const mm = String(dateUtc.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dateUtc.getUTCDate()).padStart(2, "0");
  const hh = String(dateUtc.getUTCHours()).padStart(2, "0");
  const min = String(dateUtc.getUTCMinutes()).padStart(2, "0");
  return { date: `${yyyy}-${mm}-${dd}`, time: `${hh}:${min}` };
};

const calculateTimestamp = (date: string | undefined, time: string | undefined): number => {
  if (!date || !time) return 0;
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return Math.floor(Date.UTC(year, month - 1, day, hours, minutes) / 1000);
};

// Validates that the market ID is a non-negative integer without decimals
const validateMarketId = (value: string): boolean => {
  if (value === "") return false;
  const num = Number(value);
  return Number.isInteger(num) && num >= 0 && !value.includes(".");
};
