"use client";

import Link from "next/link";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { ContractName } from "~~/utils/scaffold-eth/contract";
import { getAvailablePrecogMasterVersions, getPrecogMasterContractKey, type PrecogMasterVersion } from "~~/utils/scaffold-eth/contractsData";
import { useScaffoldContract, useScaffoldReadContract, useTransactor } from "~~/hooks/scaffold-eth";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { notification } from "~~/utils/scaffold-eth";
import { useEffect, useState } from "react";
import { displayTxResult } from "~~/app/debug/_components/contract";
import { AddressInput } from "~~/components/scaffold-eth";
import { BaseError } from "viem";
import { normalizeCategoryCsv } from "~~/utils/marketCategories";

// TODO this defaults could have a config shared file with update-market page
const defaultCreator = "0x0000000000000000000000000000000000000000";
const defaultCollateral = "0xC139C86de76DF41c041A30853C3958427fA7CEbD";
const defaultImageURL = "";
const defaultMarketAddress = defaultCreator;
const DEFAULT_SELL_FEE_FACTOR = 100000;
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

type SharedFormFields = {
  category: string;
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  creator: string;
  collateral: string;
  outcomes: string;
  funding: number;
};

type SharedParsedData = {
  startTimestamp: number;
  endTimestamp: number;
  parsedOutcomes: string[];
  overRound: number;
  fundingWei: bigint;
};

type SharedFieldsSectionProps = {
  fields: SharedFormFields;
  setField: <K extends keyof SharedFormFields>(key: K, value: SharedFormFields[K]) => void;
  middleFields?: React.ReactNode;
};

type FlowProps = {
  connectedAddress?: `0x${string}`;
  isPending: boolean;
  submitTx: (functionName: "createMarket" | "createCustomMarket", args: readonly unknown[]) => Promise<boolean>;
};

export default function CreateMarket() {
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient();
  const writeTx = useTransactor();
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
  const { data: selectedCreatedMarkets } = useScaffoldReadContract({
    contractName: selectedContractName,
    functionName: "createdMarkets",
  });
  const { data: selectedMaster, isLoading: isMasterLoading } = useScaffoldContract({ contractName: selectedContractName });

  const submitTx = async (
    functionName: "createMarket" | "createCustomMarket",
    args: readonly unknown[],
    master: { address: `0x${string}`; abi: readonly unknown[] },
  ) => {
    if (!connectedAddress) {
      notification.error("Connect wallet before submitting.");
      return false;
    }
    if (!publicClient) {
      notification.error("Public client not ready. Try again.");
      return false;
    }

    console.log("[CreateMarket] TX data:", { functionName, args, contractAddress: master.address });

    try {
      await publicClient.simulateContract({
        address: master.address,
        abi: master.abi as any,
        functionName: functionName,
        args: args,
        account: connectedAddress,
      } as any);
    } catch (error) {
      const message = error instanceof BaseError ? error.shortMessage || error.message : "Transaction would revert";
      notification.error(`Simulation failed: ${message}`);
      return false;
    }

    await writeTx(
      () =>
        writeContractAsync({
          address: master.address,
          abi: master.abi,
          functionName: functionName,
          args: args,
        } as any),
      { blockConfirmations: 1 },
    );
    return true;
  };

  if (!selectedMaster || isMasterLoading) {
    return (
      <div className="flex flex-row justify-center items-center">
        <div className="flex flex-col gap-3 p-4 mt-3 bg-base-100 rounded-2xl w-1/4 min-w-[400px]">
          <div className="text-xl font-bold">Create Market</div>
          <span className="text-lg">Fetching data...</span>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-row justify-center items-center">
        <div className="flex flex-col gap-2 p-4 mt-3 bg-base-100 rounded-2xl w-1/4 min-w-[400px] overflow-auto">
          <div className="flex flex-row justify-between items-center gap-2 flex-wrap px-2">
            <div className="flex items-center gap-4">
              <div className="text-xl font-bold">Create Market</div>
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
              <span className="text-md font-bold">{displayTxResult(selectedCreatedMarkets)}</span>
              <span className="text-sm">]</span>
            </div>
          </div>
          {selectedVersion === "v7" ? (
            <V7CreateMarketFlow
              connectedAddress={connectedAddress as `0x${string}`}
              isPending={isPending}
              submitTx={(functionName, args) => submitTx(functionName, args, selectedMaster as any)}
            />
          ) : (
            <V8CreateMarketFlow
              connectedAddress={connectedAddress as `0x${string}`}
              isPending={isPending}
              submitTx={(functionName, args) => submitTx(functionName, args, selectedMaster as any)}
            />
          )}
        </div>
      </div>
      <div className="flex justify-center items-center pt-4 pb-2">
        <div className="font-mono text-center text-base flex flex-col sm:flex-row">
          <Link
            href="/update-market"
            className="inline-flex items-center gap-1 hover:underline text-base-content/70 flex-col sm:flex-row font-mono"
          >
             :: Update market ::
          </Link>
        </div>
      </div>
    </>
  );
}

const V7CreateMarketFlow = ({ connectedAddress, isPending, submitTx }: FlowProps) => {
  const [name, setName] = useState<string>("");
  const [description, setDescription] = useState<string>("");
  const { fields, setField, reset } = useSharedFormFields(connectedAddress);

  const handleSubmit = async () => {
    const parsed = buildSharedParsedData(fields);
    const normalizedCategory = normalizeCategoryCsv(fields.category);

    if (!name || !description || !hasValidSharedFields(normalizedCategory, parsed)) {
      notification.error("Invalid/empty V7 market parameters");
      return;
    }

    // createMarket args: name, description, category, outcomes, startTimestamp, endTimestamp, creator, fundingWei, overRound
    const baseArgs = [
      name,
      description,
      normalizedCategory,
      parsed.parsedOutcomes,
      BigInt(parsed.startTimestamp),
      BigInt(parsed.endTimestamp),
      fields.creator as `0x${string}`,
      parsed.fundingWei,
      BigInt(parsed.overRound),
    ] as const;

    if (fields.collateral === defaultCollateral) {
      const sent = await submitTx("createMarket", baseArgs);
      if (!sent) return;
    } else {
      const customArgs = [
        ...baseArgs,
        fields.collateral as `0x${string}`,
        fields.creator as `0x${string}`,
        fields.creator as `0x${string}`,
      ] as const;
      const sent = await submitTx("createCustomMarket", customArgs);
      if (!sent) return;
    }

    setName("");
    setDescription("");
    reset();
  };

  return (
    <>
      <div className="flex flex-col items-start px-2">
        <span className="text-sm font-bold">Name</span>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Will Argentina beat Colombia in the Copa America?"
          className="input border border-primary rounded-xl w-full"
        />
        <span className="text-xs italic pl-3">
          Note: The first letter should be uppercase and should end with a question mark.
        </span>
      </div>
      <div className="flex flex-col items-start px-2">
        <span className="text-sm font-bold">Description</span>
        <textarea
          value={description}
          onChange={e => setDescription(e.target.value)}
          placeholder="Winner at match conclusion (regular, extra-time and penalty shoot-out)."
          className="input border border-primary rounded-xl px-4 py-2 min-h-24 w-full"
        />
        <span className="text-xs italic pl-3">Note: should specify market resolve conditions.</span>
      </div>
      <SharedFieldsSection fields={fields} setField={setField} />
      <div className="flex flex-col items-center p-3 w-full">
        <button className="btn btn-primary rounded-xl" onClick={handleSubmit} disabled={isPending}>
          {isPending ? <span className="loading loading-spinner loading-sm"></span> : "Create Market"}
        </button>
      </div>
    </>
  );
};

const V8CreateMarketFlow = ({ connectedAddress, isPending, submitTx }: FlowProps) => {
  const [question, setQuestion] = useState<string>("");
  const [resolutionCriteria, setResolutionCriteria] = useState<string>("");
  const [imageURL, setImageURL] = useState<string>("");
  const [oracle, setOracle] = useState<string>(connectedAddress || defaultCreator);
  const [sellFeeFactor, setSellFeeFactor] = useState<number>(DEFAULT_SELL_FEE_FACTOR);
  const [liquidity, setLiquidity] = useState<number>(2000);
  const [overroundPercent, setOverroundPercent] = useState<string>("2");
  const { fields, setField, reset } = useSharedFormFields(connectedAddress);

  useEffect(() => {
    if (oracle === defaultCreator && connectedAddress && connectedAddress !== defaultCreator) {
      setOracle(connectedAddress);
    }
  }, [connectedAddress, oracle]);

  const handleSubmit = async () => {
    const parsed = buildSharedParsedData(fields);
    const normalizedCategory = normalizeCategoryCsv(fields.category);
    const liquidityWei = BigInt(liquidity * 10 ** 18);
    const collateralFunder = connectedAddress || fields.creator;
    const overroundPercentNumber = Number(overroundPercent) || 0;

    if (!question || !resolutionCriteria || !hasValidSharedFields(normalizedCategory, parsed)) {
      notification.error("Invalid/empty V8 market parameters");
      return;
    }

    const args = [
      {
        question: question,
        resolutionCriteria: resolutionCriteria,
        imageURL: imageURL || defaultImageURL,
        category: normalizedCategory,
        outcomes: parsed.parsedOutcomes.join(","),
        creator: fields.creator as `0x${string}`,
        operator: defaultCreator as `0x${string}`,
        market: defaultMarketAddress as `0x${string}`,
        startTimestamp: BigInt(parsed.startTimestamp),
        endTimestamp: BigInt(parsed.endTimestamp),
        collateral: fields.collateral as `0x${string}`,
      },
      {
        oracle: oracle as `0x${string}`,
        totalOutcomes: BigInt(parsed.parsedOutcomes.length),
        liquidity: liquidityWei,
        overround: BigInt(Math.round(overroundPercentNumber * 100)),
        sellFeeFactor: BigInt(sellFeeFactor),
        collateralFunding: parsed.fundingWei,
        collateralFunder: collateralFunder as `0x${string}`,
      },
    ] as const;

    const sent = await submitTx("createMarket", args);
    if (!sent) return;

    setQuestion("");
    setResolutionCriteria("");
    setImageURL("");
    setOracle(connectedAddress || defaultCreator);
    setSellFeeFactor(DEFAULT_SELL_FEE_FACTOR);
    setLiquidity(2000);
    setOverroundPercent("2");
    reset();
  };

  return (
    <>
      <div className="flex flex-col items-start px-2">
        <span className="text-sm font-bold">Question</span>
        <input
          type="text"
          value={question}
          onChange={e => setQuestion(e.target.value)}
          placeholder="Will Argentina beat Colombia in the Copa America?"
          className="input border border-primary rounded-xl w-full"
        />
        <span className="text-xs italic pl-3">
          Note: The first letter should be uppercase and should end with a question mark.
        </span>
      </div>
      <div className="flex flex-col items-start px-2">
        <span className="text-sm font-bold">Resolution Criteria</span>
        <textarea
          value={resolutionCriteria}
          onChange={e => setResolutionCriteria(e.target.value)}
          placeholder="Winner at match conclusion (regular, extra-time and penalty shoot-out)."
          className="input border border-primary rounded-xl px-4 py-2 min-h-24 w-full"
        />
        <span className="text-xs italic pl-3">Note: should specify market resolve conditions.</span>
      </div>
      <div className="flex flex-col items-start px-2">
        <span className="text-sm font-bold">Image URL</span>
        <input
          type="text"
          value={imageURL}
          onChange={e => setImageURL(e.target.value)}
          placeholder="https://example.com/market-image.jpg"
          className="input border border-primary rounded-xl w-full"
        />
        <span className="text-xs italic pl-3">
          Note: Optional image URL for market.
        </span>
      </div>
      <SharedFieldsSection
        fields={fields}
        setField={setField}
        middleFields={
          <div className="flex flex-col items-start px-2">
            <span className="text-sm font-bold">Oracle</span>
            <div className="w-full py-1">
              <AddressInput value={oracle} onChange={setOracle} disableAutofocus />
            </div>
          </div>
        }
      />
      <div className="flex flex-row items-start px-2 gap-4">
        <div className="flex flex-col w-3/4">
          <span className="text-sm font-bold">Liquidity (amount)</span>
          <input
            type="number"
            min="2"
            value={liquidity}
            onChange={e => setLiquidity(Number(e.target.value))}
            className="input border border-primary rounded-xl w-full"
          />
          <span className="text-xs italic pl-3">
            Note: Can be higher than funding for virtual liquidity.
          </span>
        </div>
        <div className="flex flex-col w-1/4">
          <span className="text-sm font-bold">Overround (%)</span>
          <input
            type="number"
            min="0"
            step="0.1"
          value={overroundPercent}
          onChange={e => setOverroundPercent(e.target.value)}
            className="input border border-primary rounded-xl w-full"
          />
        </div>
      </div>
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
          </select>
          <div className="input border border-primary rounded-xl w-1/4 bg-base-200 flex items-center justify-center font-mono text-sm">
            {sellFeeFactor}
          </div>
        </div>
        <span className="text-xs italic pl-3">
          Note: Sell fee = 1/sell fee factor
        </span>
      </div>
      <div className="flex flex-col items-center p-3 w-full">
        <button className="btn btn-primary rounded-xl" onClick={handleSubmit} disabled={isPending}>
          {isPending ? <span className="loading loading-spinner loading-sm"></span> : "Create Market"}
        </button>
      </div>
    </>
  );
};

const parseUtcTimestamp = (date?: string, time?: string): number => {
  if (!date || !time) return 0;
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return Math.round(new Date(Date.UTC(year, month - 1, day, hours, minutes)).getTime() / 1000);
};

const parseOutcomes = (outcomes: string): string[] => outcomes.split(",").map(value => value.trim()).filter(Boolean);

const hasValidSharedFields = (category: string, parsed: SharedParsedData) =>
  Boolean(normalizeCategoryCsv(category)) &&
  parsed.parsedOutcomes.length >= 2 &&
  parsed.startTimestamp > 0 &&
  parsed.endTimestamp > parsed.startTimestamp;

const buildSharedParsedData = (fields: SharedFormFields): SharedParsedData => {
  const startTimestamp = parseUtcTimestamp(fields.startDate, fields.startTime);
  const endTimestamp = parseUtcTimestamp(fields.endDate, fields.endTime);
  const parsedOutcomes = parseOutcomes(fields.outcomes);
  const overRound = parsedOutcomes.length * 100;
  const fundingWei = BigInt(fields.funding * 10 ** 18); // Wei is always 18 decimals

  return {
    startTimestamp,
    endTimestamp,
    parsedOutcomes,
    overRound,
    fundingWei,
  };
};

const getDefaultDateTimeFields = () => {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, "0");
  const dd = String(today.getDate()).padStart(2, "0");
  const hh = String(today.getHours()).padStart(2, "0");

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowYyyy = tomorrow.getFullYear();
  const tomorrowMm = String(tomorrow.getMonth() + 1).padStart(2, "0");
  const tomorrowDd = String(tomorrow.getDate()).padStart(2, "0");

  return {
    startDate: `${yyyy}-${mm}-${dd}`,
    startTime: `${hh}:00`,
    endDate: `${tomorrowYyyy}-${tomorrowMm}-${tomorrowDd}`,
    endTime: `${hh}:00`,
  };
};

const getDefaultSharedFormFields = (connectedAddress?: `0x${string}`): SharedFormFields => ({
  category: "",
  ...getDefaultDateTimeFields(),
  creator: connectedAddress || defaultCreator,
  collateral: defaultCollateral,
  outcomes: "YES,NO",
  funding: 2000,
});

const useSharedFormFields = (connectedAddress?: `0x${string}`) => {
  const [fields, setFields] = useState<SharedFormFields>(() => getDefaultSharedFormFields(connectedAddress));

  useEffect(() => {
    if (fields.creator === defaultCreator && connectedAddress && connectedAddress !== defaultCreator) {
      setFields(prev => ({ ...prev, creator: connectedAddress }));
    }
  }, [connectedAddress, fields.creator]);

  const setField = <K extends keyof SharedFormFields>(key: K, value: SharedFormFields[K]) => {
    setFields(prev => ({ ...prev, [key]: value }));
  };

  const reset = () => {
    setFields(getDefaultSharedFormFields(connectedAddress));
  };

  return { fields, setField, reset };
};

const SharedFieldsSection = ({ fields, setField, middleFields }: SharedFieldsSectionProps) => {
  return (
    <>
      <div className="flex flex-col items-start px-2">
        <span className="text-sm font-bold">Category</span>
        <input
          type="text"
          placeholder="SPORTS,POLITICS"
          value={fields.category}
          onChange={e => setField("category", e.target.value)}
          className="input border border-primary rounded-xl w-full"
        />
        <span className="text-xs italic pl-3">Note: Comma-separated categories.</span>
      </div>
      <div className="flex flex-col items-start px-2">
        <span className="text-sm font-bold">Outcomes</span>
        <input
          type="text"
          value={fields.outcomes}
          onChange={e => setField("outcomes", e.target.value)}
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
            value={fields.startDate}
            onChange={e => setField("startDate", e.target.value)}
          />
          <input
            type="time"
            className="input border border-primary rounded-xl w-1/2"
            value={fields.startTime}
            onChange={e => setField("startTime", e.target.value)}
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
            value={fields.endDate}
            onChange={e => setField("endDate", e.target.value)}
          />
          <input
            type="time"
            className="input border border-primary rounded-xl w-1/2"
            value={fields.endTime}
            onChange={e => setField("endTime", e.target.value)}
          />
        </div>
        <span className="text-xs italic pl-3">Note: when share trading stops (waiting for result).</span>
      </div>
      <div className="flex flex-col items-start px-2">
        <span className="text-sm font-bold">Creator</span>
        <div className="w-full py-1">
          <AddressInput value={fields.creator} onChange={value => setField("creator", value)} disableAutofocus />
        </div>
        <span className="text-xs italic pl-3">Note: External or internal Market creator wallet.</span>
      </div>
      {middleFields}
      <div className="flex flex-col items-start px-2">
        <span className="text-sm font-bold">Collateral Token</span>
        <div className="w-full py-1">
          <AddressInput value={fields.collateral} onChange={value => setField("collateral", value)} disableAutofocus />
        </div>
        <span className="text-xs italic pl-3">Note: Address of ERC20 Token</span>
      </div>
      <div className="flex flex-col items-start px-2">
        <span className="text-sm font-bold">Funding Collateral (amount)</span>
        <input
          type="number"
          min="2"
          value={fields.funding}
          onChange={e => setField("funding", Number(e.target.value))}
          className="input border border-primary rounded-xl w-full"
        />
        <span className="text-xs italic pl-3">Note: Tokens to mint or TransferFrom creator (need approve)</span>
      </div>
    </>
  );
};
