"use client";

import React, { useState, useEffect } from "react";
import type { NextPage } from "next";
import { usePublicClient, useWalletClient } from "wagmi";
import { formatEther, isAddress, parseEther, zeroAddress } from "viem";
import type { Address } from "viem";
import { getBlockExplorerAddressLink, notification } from "~~/utils/scaffold-eth";
import {
  getAvailablePrecogRealityOracleVersions,
  getContractsByNetwork,
  getPrecogRealityOracleContractKey,
  type PrecogRealityOracleVersion,
} from "~~/utils/scaffold-eth/contractsData";
import { ArrowTopRightOnSquareIcon, InformationCircleIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { useTargetNetwork } from "~~/hooks/scaffold-eth/useTargetNetwork";
import { toDateString } from "~~/utils/dates";
import { normalizeCategoryCsv } from "~~/utils/marketCategories";

const Oracle: NextPage = () => {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();
  const { targetNetwork } = useTargetNetwork();
  const [oracleVersion, setOracleVersion] = useState<PrecogRealityOracleVersion>("v3");

  // Get oracle info for current network
  const availableOracleVersions = getAvailablePrecogRealityOracleVersions(targetNetwork.id);
  const dropdownOracleVersions = availableOracleVersions.length > 0 ? availableOracleVersions : (["v3"] as PrecogRealityOracleVersion[]);
  const contractsData = getContractsByNetwork(targetNetwork.id);
  const oracleContractKey = getPrecogRealityOracleContractKey(oracleVersion);
  const oracle_address = contractsData[oracleContractKey]?.address;
  const oracle_abi = contractsData[oracleContractKey]?.abi;

  // Form states
  const [marketId, setMarketId] = useState("");
  const [marketAddress, setMarketAddress] = useState("");
  const [reporters, setReporters] = useState("");
  const [question, setQuestion] = useState("");
  const [outcomes, setOutcomes] = useState("");
  const [category, setCategory] = useState("");
  const [bounty, setBounty] = useState("");
  const [bond, setBond] = useState("");
  const [templateId] = useState("2");
  const [timeout] = useState("86400");
  const [answer, setAnswer] = useState("");

  // Market info states
  const [questionInfo, setQuestionInfo] = useState<any>(null);
  const [resultInfo, setResultInfo] = useState<any>(null);
  const [marketState, setMarketState] = useState<any>(null);
  const [realityBalance, setRealityBalance] = useState<bigint | null>(null);
  const [maxAnswerBond, setMaxAnswerBond] = useState<bigint | null>(null);

  // Contract addresses states
  const [precogMasterAddress, setPrecogMasterAddress] = useState<string>("");
  const [realityAddress, setRealityAddress] = useState<string>("");
  const [arbitratorAddress, setArbitratorAddress] = useState<string>("");

  // Claims states
  const [claimQuestionId, setClaimQuestionId] = useState("");
  const [historyHashes, setHistoryHashes] = useState("");
  const [answerers, setAnswerers] = useState("");
  const [bonds, setBonds] = useState("");
  const [answers, setAnswers] = useState("");

  // Withdraw to EOA: token address (empty = ETH)
  const [withdrawTokenAddress, setWithdrawTokenAddress] = useState("");
  const [openTooltip, setOpenTooltip] = useState<string | null>(null);

  useEffect(() => {
    const currentAvailable = getAvailablePrecogRealityOracleVersions(targetNetwork.id);
    const currentDropdown = currentAvailable.length > 0 ? currentAvailable : (["v3"] as PrecogRealityOracleVersion[]);
    const preferred = currentDropdown.includes("v3") ? "v3" : currentDropdown[0];
    setOracleVersion(preferred);
  }, [targetNetwork.id]);

  useEffect(() => {
    setQuestionInfo(null);
    setResultInfo(null);
    setMarketState(null);
    setRealityBalance(null);
    setMaxAnswerBond(null);
    setPrecogMasterAddress("");
    setRealityAddress("");
    setArbitratorAddress("");
  }, [targetNetwork.id, oracleVersion]);

  // Close tooltip when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (openTooltip && !(event.target as Element).closest('.tooltip-container')) {
        setOpenTooltip(null);
      }
    };

    if (openTooltip) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [openTooltip]);

  const handleRegisterMarket = async () => {
    if (!walletClient || !publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      const reporterArray = reporters.trim() === ""
        ? []
        : reporters.split(",").map(addr => addr.trim() as `0x${string}`);

      console.log("Registering market with args:", {
        marketId: BigInt(marketId),
        marketAddress,
        reporterArray
      });

      const { request } = await publicClient.simulateContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "registerMarket",
        args: [BigInt(marketId), marketAddress as `0x${string}`, reporterArray],
        account: walletClient.account,
      });
      await walletClient.writeContract(request);
      notification.success("Market registered successfully!");
    } catch (error: any) {
      console.error("Full error object:", error);
      const errorMessage = error?.shortMessage || error?.message || "Failed to register market";
      notification.error(errorMessage);
    }
  };

  // TODO improve the UI to support a better UX, and add some "default" values for the form that now we are assuming
  const handleOpenQuestion = async () => {
    if (!walletClient || !publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      const outcomeArray = outcomes.split(",").map(o => o.trim());
      const normalizedCategory = normalizeCategoryCsv(category);

      console.log("Opening question with args:", {
        marketId: BigInt(marketId),
        bounty: parseEther(bounty),
        templateId: Number(templateId),
        question,
        outcomeArray,
        category: normalizedCategory,
        timeout: Number(timeout),
        startTime: Math.floor(Date.now() / 1000)
      });

      const { request } = await publicClient.simulateContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "openQuestion",
        args: [
          BigInt(marketId),
          parseEther(bounty),
          Number(templateId),
          question,
          outcomeArray,
          normalizedCategory,
          Number(timeout),
          Math.floor(Date.now() / 1000)
        ],
        account: walletClient.account,
        value: parseEther(bounty),
      });
      await walletClient.writeContract(request);
      notification.success("Question opened successfully!");
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to open question";
      notification.error(errorMessage);
      console.error(error);
    }
  };

  // TODO improve the UI to support a better UX, and add some "default" values for the form that now we are assuming
  const handleAnswerQuestion = async () => {
    if (!walletClient || !publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      console.log("Answering question with args:", {
        marketId: BigInt(marketId),
        answer: answer as `0x${string}`,
        maxPrevious: BigInt(0),
        bond: parseEther(bond)
      });

      const { request } = await publicClient.simulateContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "answerOpenQuestion",
        args: [BigInt(marketId), answer as `0x${string}`, BigInt(0), parseEther(bond)],
        account: walletClient.account,
        value: parseEther(bond),
      });
      await walletClient.writeContract(request);
      notification.success("Answer submitted successfully!");
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to submit answer";
      notification.error(errorMessage);
      console.error(error);
    }
  };

  const handleReportResult = async () => {
    if (!walletClient || !publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      console.log("Reporting result with args:", {
        marketId: BigInt(marketId)
      });

      const { request } = await publicClient.simulateContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "reportResult",
        args: [BigInt(marketId)],
        account: walletClient.account
      });
      await walletClient.writeContract(request);
      notification.success("Result reported successfully!");
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to report result";
      notification.error(errorMessage);
      console.error(error);
    }
  };

  const handleEnableDatesUpdate = async () => {
    if (!walletClient || !publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      console.log("Enabling dates update with args:", {
        marketId: BigInt(marketId)
      });

      const { request } = await publicClient.simulateContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "marketEnableDatesUpdate",
        args: [BigInt(marketId)],
        account: walletClient.account,
      });
      await walletClient.writeContract(request);
      notification.success("Market dates update enabled successfully!");
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to enable market dates update";
      notification.error(errorMessage);
      console.error(error);
    }
  };

  const fetchQuestionInfo = async () => {
    if (!publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      const data = await publicClient.readContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "getRealityQuestionInfo",
        args: [BigInt(marketId)],
      });
      setQuestionInfo(data);
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to fetch question info";
      notification.error(errorMessage);
      console.error("Failed to fetch question info:", error);
    }
  };

  const fetchResultInfo = async () => {
    if (!publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      const data = await publicClient.readContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "getRealityResultInfo",
        args: [BigInt(marketId)],
      });
      setResultInfo(data);
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to fetch result info";
      notification.error(errorMessage);
      console.error("Failed to fetch result info:", error);
    }
  };

  const fetchMarketState = async () => {
    if (!publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      const data = await publicClient.readContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "getMarketState",
        args: [BigInt(marketId)],
      });
      setMarketState(data);
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to fetch market state";
      notification.error(errorMessage);
      console.error("Failed to fetch market state:", error);
    }
  };

  const fetchRealityBalance = async () => {
    if (!publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      const data = await publicClient.readContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "getRealityBalance",
        args: [],
      });
      setRealityBalance(data as bigint);
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to fetch Reality balance";
      notification.error(errorMessage);
      console.error("Failed to fetch Reality balance:", error);
    }
  };

  const fetchMaxAnswerBond = async () => {
    if (!publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      const data = await publicClient.readContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "maxAnswerBond",
        args: [],
      });
      setMaxAnswerBond(data as bigint);
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to fetch max answer bond";
      notification.error(errorMessage);
      console.error("Failed to fetch max answer bond:", error);
    }
  };

  const fetchPrecogMaster = async () => {
    if (!publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      const data = await publicClient.readContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "precogMaster",
        args: [],
      });
      setPrecogMasterAddress(data as string);
      console.log("Precog Master address fetched!", data);
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to fetch Precog Master";
      notification.error(errorMessage);
      console.error("Failed to fetch Precog Master:", error);
    }
  };

  const fetchReality = async () => {
    if (!publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      const data = await publicClient.readContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "reality",
        args: [],
      });
      setRealityAddress(data as string);
      console.log("Reality address fetched!", data);
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to fetch Reality";
      notification.error(errorMessage);
      console.error("Failed to fetch Reality:", error);
    }
  };

  const fetchArbitrator = async () => {
    if (!publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      const data = await publicClient.readContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "arbitrator",
        args: [],
      });
      setArbitratorAddress(data as string);
      console.log("Arbitrator address fetched!", data);
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to fetch Arbitrator";
      notification.error(errorMessage);
      console.error("Failed to fetch Arbitrator:", error);
    }
  };

  const handleClaimWinnings = async () => {
    if (!walletClient || !publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      const historyHashesArray = historyHashes.split(",").map(h => h.trim() as `0x${string}`);
      const answerersArray = answerers.split(",").map(a => a.trim() as `0x${string}`);
      const bondsArray = bonds.split(",").map(b => BigInt(b.trim()));
      const answersArray = answers.split(",").map(a => a.trim() as `0x${string}`);

      // Validate arrays have same length
      if (
        historyHashesArray.length !== answerersArray.length ||
        answerersArray.length !== bondsArray.length ||
        bondsArray.length !== answersArray.length
      ) {
        notification.error("All arrays must have the same length");
        return;
      }

      console.log("Claiming winnings with args:", {
        questionId: claimQuestionId as `0x${string}`,
        historyHashesArray,
        answerersArray,
        bondsArray,
        answersArray
      });

      const { request } = await publicClient.simulateContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "realityClaimWinnings",
        args: [
          claimQuestionId as `0x${string}`,
          historyHashesArray,
          answerersArray,
          bondsArray,
          answersArray
        ],
        account: walletClient.account,
      });
      await walletClient.writeContract(request);
      notification.success("Winnings claimed successfully!");
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to claim winnings";
      notification.error(errorMessage);
      console.error(error);
    }
  };

  const handlePreFillClaimDefaults = () => {
    let didFill = false;
    if (!historyHashes.trim()) {
      setHistoryHashes("0x0000000000000000000000000000000000000000000000000000000000000000");
      didFill = true;
    }
    if (!answerers.trim()) {
      setAnswerers(oracle_address || "");
      didFill = true;
    }
    if (!bonds.trim()) {
      setBonds("1500000000000000");
      didFill = true;
    }
    if (didFill) {
      notification.success("Defaults pre-filled");
    } else {
      notification.info("Values are already filled");
    }
  };

  const handleRealityWithdraw = async () => {
    if (!walletClient || !publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    try {
      console.log("Withdrawing from Reality.eth...");

      const { request } = await publicClient.simulateContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "realityWithdraw",
        args: [],
        account: walletClient.account,
      });
      await walletClient.writeContract(request);
      notification.success("Withdrawal successful!");
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to withdraw";
      notification.error(errorMessage);
      console.error(error);
    }
  };

  const handleWithdrawToEoa = async () => {
    if (!walletClient || !publicClient) {
      notification.error("Please connect your wallet");
      return;
    }

    const trimmed = withdrawTokenAddress.trim();
    if (trimmed && !isAddress(trimmed)) {
      notification.error("Invalid token address");
      return;
    }
    const token: Address = trimmed && isAddress(trimmed) ? (trimmed as Address) : zeroAddress;

    try {
      const { request } = await publicClient.simulateContract({
        address: oracle_address,
        abi: oracle_abi,
        functionName: "withdraw",
        args: [token],
        account: walletClient.account,
      });
      await walletClient.writeContract(request);
      notification.success("Withdrawal to EOA successful!");
    } catch (error: any) {
      const errorMessage = error?.shortMessage || error?.message || "Failed to withdraw to EOA";
      notification.error(errorMessage);
      console.error(error);
    }
  };

  const [activeTab, setActiveTab] = useState("register");

  return (
    <>
      <div className="flex items-center flex-col flex-grow pt-2">
        <div className="w-full px-4 md:px-12 pt-5">
          {/* Oracle Card - Following MarketList styling */}
          <div className="w-full flex flex-col gap-4 font-mono">
            <div className="flex justify-between items-center mb-4 flex-col sm:flex-row">
              <div className="flex items-center gap-4 flex-wrap">
                <h2 className="text-2xl font-bold m-0">Precog Oracles</h2>
                <select
                  className="select select-bordered select-sm font-mono font-bold"
                  value={oracleVersion}
                  onChange={e => setOracleVersion(e.target.value as PrecogRealityOracleVersion)}
                >
                  {dropdownOracleVersions.map(version => (
                    <option key={version} value={version}>
                      {version.toUpperCase()}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Oracle Info Card */}
            <div className="collapse collapse-arrow bg-base-100 transition-colors duration-300 rounded-lg shadow-lg shadow-primary/10">
              <input type="checkbox" className="peer" defaultChecked />
              <div className="collapse-title peer-checked:bg-base-200/10 text-xs">
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <h3 className="text-lg font-bold text-base-content/70 break-words m-0">
                      <span className="text-base-content/70 mr-2">{'>'}</span>
                      PRECOG REALITY ORACLE {oracleVersion.toUpperCase()}
                    </h3>
                    <div className="text-sm">
                      <span className="text-base-content/70">
                        (using reality.eth for market resolution)
                      </span>
                    </div>
                  </div>
                  <div className="font-bold z-10">
                    {oracle_address ? (
                      <a
                        href={getBlockExplorerAddressLink(targetNetwork, oracle_address)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 hover:underline text-accent break-all"
                      >
                        {oracle_address}
                        <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
                      </a>
                    ) : (
                      <span className="text-base-content/70">[Not deployed]</span>
                    )}
                  </div>
                </div>
              </div>

              {/* Oracle Content */}
              <div className="collapse-content bg-base-300/20 text-sm">
                <div className="pt-4 flex flex-col gap-4">
                  {/* Tab Navigation */}
                  <div className="flex justify-start">
                    <div className="flex gap-2 font-mono flex-wrap">
                      {[
                        { id: "register", label: "REGISTER" },
                        { id: "question", label: "QUESTION" },
                        { id: "answer", label: "ANSWER" },
                        { id: "result", label: "RESULT" },
                        { id: "info", label: "INFO" },
                        { id: "claims", label: "CLAIMS" },
                        { id: "contracts", label: "CONTRACTS" }
                      ].map(tab => (
                        <button
                          key={tab.id}
                          className={`btn btn-sm ${activeTab === tab.id ? "btn-accent" : "btn-ghost"}`}
                          onClick={() => setActiveTab(tab.id)}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Tab Content */}
                  <div className="mt-4">
                    <div className="max-w-3xl">
                      {/* Register Tab */}
                      {activeTab === "register" && (
                        <div className="gap-2 flex flex-col">
                          <h4 className="font-bold text-base-content/70 m-0">:: Register Market ::</h4>
                          <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <input
                                type="text"
                                placeholder="MARKET ID"
                                className="input input-bordered input-sm font-mono text-center"
                                value={marketId}
                                onChange={e => setMarketId(e.target.value)}
                              />
                              <input
                                type="text"
                                placeholder="MARKET ADDRESS"
                                className="input input-bordered input-sm font-mono text-center"
                                value={marketAddress}
                                onChange={e => setMarketAddress(e.target.value)}
                              />
                            </div>
                            <input
                              type="text"
                              placeholder="REPORTERS (COMMA-SEPARATED)"
                              className="input input-bordered input-sm font-mono text-center"
                              value={reporters}
                              onChange={e => setReporters(e.target.value)}
                            />
                            <button
                              className="btn btn-accent btn-sm font-mono"
                              onClick={handleRegisterMarket}
                            >
                              REGISTER MARKET
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Question Tab */}
                      {activeTab === "question" && (
                        <div className="gap-2 flex flex-col">
                          <h4 className="font-bold text-base-content/70 m-0">:: Open Question ::</h4>
                          <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <input
                                type="text"
                                placeholder="MARKET ID"
                                className="input input-bordered input-sm font-mono text-center"
                                value={marketId}
                                onChange={e => setMarketId(e.target.value)}
                              />
                              <input
                                type="text"
                                placeholder="BOUNTY (ETH)"
                                className="input input-bordered input-sm font-mono text-center"
                                value={bounty}
                                onChange={e => setBounty(e.target.value)}
                              />
                            </div>
                            <input
                              type="text"
                              placeholder="QUESTION"
                              className="input input-bordered input-sm font-mono text-center"
                              value={question}
                              onChange={e => setQuestion(e.target.value)}
                            />
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <input
                                type="text"
                                placeholder="OUTCOMES (COMMA-SEPARATED)"
                                className="input input-bordered input-sm font-mono text-center"
                                value={outcomes}
                                onChange={e => setOutcomes(e.target.value)}
                              />
                              <input
                                type="text"
                                placeholder="CATEGORY1,CATEGORY2"
                                title="Comma-separated categories"
                                className="input input-bordered input-sm font-mono text-center"
                                value={category}
                                onChange={e => setCategory(e.target.value)}
                              />
                            </div>
                            <button
                              className="btn btn-accent btn-sm font-mono"
                              onClick={handleOpenQuestion}
                            >
                              OPEN QUESTION
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Answer Tab */}
                      {activeTab === "answer" && (
                        <div className="gap-2 flex flex-col">
                          <h4 className="font-bold text-base-content/70 m-0">:: Submit Answer ::</h4>
                          <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-3">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                              <input
                                type="text"
                                placeholder="MARKET ID"
                                className="input input-bordered input-sm font-mono text-center"
                                value={marketId}
                                onChange={e => setMarketId(e.target.value)}
                              />
                              <input
                                type="text"
                                placeholder="BOND (ETH)"
                                className="input input-bordered input-sm font-mono text-center"
                                value={bond}
                                onChange={e => setBond(e.target.value)}
                              />
                            </div>
                            <input
                              type="text"
                              placeholder="ANSWER (BYTES32)"
                              className="input input-bordered input-sm font-mono text-center"
                              value={answer}
                              onChange={e => setAnswer(e.target.value)}
                            />
                            <button
                              className="btn btn-accent btn-sm font-mono"
                              onClick={handleAnswerQuestion}
                            >
                              SUBMIT ANSWER
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Result Tab */}
                      {activeTab === "result" && (
                        <div className="gap-2 flex flex-col">
                          <h4 className="font-bold text-base-content/70 m-0">:: Report Result ::</h4>
                          <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-3">
                            <input
                              type="text"
                              placeholder="MARKET ID"
                              className="input input-bordered input-sm font-mono text-center"
                              value={marketId}
                              onChange={e => setMarketId(e.target.value)}
                            />
                            <button
                              className="btn btn-accent btn-sm font-mono"
                              onClick={handleReportResult}
                            >
                              REPORT RESULT
                            </button>
                            {oracleVersion === "v3" && (
                              <>
                                <div className="divider my-0 text-xs text-base-content/50">V3 MARKET OPS</div>
                                <button
                                  className="btn btn-accent btn-sm font-mono"
                                  onClick={handleEnableDatesUpdate}
                                >
                                  ENABLE DATES UPDATE
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Info Tab */}
                      {activeTab === "info" && (
                        <div className="gap-2 flex flex-col">
                          <h4 className="font-bold text-base-content/70 m-0">:: Market Information ::</h4>
                          <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-3">
                            <input
                              type="text"
                              placeholder="MARKET ID"
                              className="input input-bordered input-sm font-mono text-center"
                              value={marketId}
                              onChange={e => setMarketId(e.target.value)}
                            />
                            <div className="flex gap-2">
                              <button
                                className="btn btn-accent btn-sm font-mono flex-1"
                                onClick={fetchQuestionInfo}
                              >
                                FETCH QUESTION
                              </button>
                              <button
                                className="btn btn-accent btn-sm font-mono flex-1"
                                onClick={fetchResultInfo}
                              >
                                FETCH RESULT
                              </button>
                              <button
                                className="btn btn-accent btn-sm font-mono flex-1"
                                onClick={fetchMarketState}
                              >
                                FETCH STATE
                              </button>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                              <button
                                className="btn btn-accent btn-sm font-mono"
                                onClick={fetchRealityBalance}
                              >
                                FETCH REALITY BALANCE
                              </button>
                              <button
                                className="btn btn-accent btn-sm font-mono"
                                onClick={fetchMaxAnswerBond}
                              >
                                FETCH MAX ANSWER BOND
                              </button>
                            </div>

                            {/* Oracle Info Display */}
                            {(realityBalance !== null || maxAnswerBond !== null) && (
                              <div className="mt-4">
                                <h5 className="font-bold text-base-content/70 mb-2">Oracle Info</h5>
                                <div className="bg-base-200 p-3 rounded text-xs space-y-1">
                                  {realityBalance !== null && (
                                    <p>
                                      <span className="font-bold text-accent">REALITY BALANCE:</span>{" "}
                                      {realityBalance.toString()} WEI ({formatEther(realityBalance)} ETH)
                                    </p>
                                  )}
                                  {maxAnswerBond !== null && (
                                    <p>
                                      <span className="font-bold text-accent">MAX ANSWER BOND:</span>{" "}
                                      {maxAnswerBond.toString()} WEI ({formatEther(maxAnswerBond)} ETH)
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}

                            {/* Market State Display */}
                            {marketState && (
                              <div className="mt-4">
                                <h5 className="font-bold text-base-content/70 mb-2">Market State</h5>
                                <div className="bg-base-200 p-3 rounded text-xs space-y-1">
                                  <p className="m-0">
                                    <span className="font-bold text-accent">REGISTERED:</span>{" "}
                                    {marketState[0] ? "YES" : "NO"}
                                  </p>
                                  <p className="m-0">
                                    <span className="font-bold text-accent">ANSWERED:</span>{" "}
                                    {marketState[1] ? "YES" : "NO"}
                                  </p>
                                  <p className="m-0">
                                    <span className="font-bold text-accent">FINALIZED:</span>{" "}
                                    {marketState[2] ? "YES" : "NO"}
                                  </p>
                                  <p className="m-0">
                                    <span className="font-bold text-accent">REPORTED:</span>{" "}
                                    {marketState[3] ? "YES" : "NO"}
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Question Info Display */}
                            {questionInfo && (
                              <div className="mt-4">
                                <h5 className="font-bold text-base-content/70 mb-2">Question Info</h5>
                                <div className="bg-base-200 p-3 rounded text-xs space-y-1">
                                  <p className="break-all">
                                    <span className="font-bold text-accent">ID:</span> {questionInfo[0]}
                                  </p>
                                  <p>
                                    <span className="font-bold text-accent">OPENED:</span>{" "}
                                    {Number(questionInfo[1]) <= 0 ? '-' : toDateString(Number(questionInfo[1]))}
                                  </p>
                                  <p>
                                    <span className="font-bold text-accent">TIMEOUT:</span> {questionInfo[2].toString()}s
                                  </p>
                                  <p>
                                    <span className="font-bold text-accent">BOUNTY:</span> {questionInfo[3].toString()} WEI
                                  </p>
                                  <p>
                                    <span className="font-bold text-accent">BOND:</span> {questionInfo[4].toString()} WEI
                                  </p>
                                </div>
                              </div>
                            )}

                            {/* Result Info Display */}
                            {resultInfo && (
                              <div className="mt-4">
                                <h5 className="font-bold text-base-content/70 mb-2">Result Info</h5>
                                <div className="bg-base-200 p-3 rounded text-xs space-y-1">
                                  <p className="break-all">
                                    <span className="font-bold text-accent">ID:</span> {resultInfo[0]}
                                  </p>
                                  <p className="break-all">
                                    <span className="font-bold text-accent">ANSWER:</span> {resultInfo[1]}
                                  </p>
                                  <p>
                                    <span className="font-bold text-accent">FINALIZE:</span>{" "}
                                    {Number(resultInfo[2]) <= 0 ? '-' : toDateString(Number(resultInfo[2]))}
                                  </p>
                                  <p className="break-all">
                                    <span className="font-bold text-accent">HASH:</span> {resultInfo[3]}
                                  </p>
                                  <p>
                                    <span className="font-bold text-accent">STATUS:</span>{" "}
                                    {resultInfo[4] ? "FINALIZED" : "PENDING"}
                                  </p>
                                  <p>
                                    <span className="font-bold text-accent">ARBITRATION:</span>{" "}
                                    {resultInfo[5] ? "YES" : "NO"}
                                  </p>
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Claims Tab */}
                      {activeTab === "claims" && (
                        <div className="gap-2 flex flex-col">
                          <h4 className="font-bold text-base-content/70 m-0">:: Claims & Withdrawals ::</h4>

                          {/* Claim Winnings Section */}
                          <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-3">
                            <div className="flex items-center justify-between gap-2">
                              <h5 className="font-bold text-base-content/70 m-0">Claim Winnings</h5>
                              <button
                                type="button"
                                onClick={handlePreFillClaimDefaults}
                                className="text-xs link link-hover text-base-content/60"
                              >
                                Pre-fill defaults
                              </button>
                            </div>

                            {/* Question ID */}
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="QUESTION ID (BYTES32)"
                                className="input input-bordered input-sm font-mono text-center flex-1"
                                value={claimQuestionId}
                                onChange={e => setClaimQuestionId(e.target.value)}
                              />
                              <div className="relative tooltip-container">
                                <button
                                  type="button"
                                  onClick={() => setOpenTooltip(openTooltip === "questionId" ? null : "questionId")}
                                  className="cursor-pointer"
                                >
                                  <InformationCircleIcon className="w-4 h-4 text-base-content/50" />
                                </button>
                                {openTooltip === "questionId" && (
                                  <div className="absolute right-0 top-6 z-50 w-80 bg-base-200 border border-base-content/20 rounded-lg shadow-lg p-3 text-xs">
                                    <div className="flex justify-between items-start mb-2">
                                      <span className="font-bold text-base-content/70">Question ID</span>
                                      <button
                                        type="button"
                                        onClick={() => setOpenTooltip(null)}
                                        className="text-base-content/50 hover:text-base-content"
                                      >
                                        <XMarkIcon className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <p className="text-base-content/80 select-text">
                                      The question ID from Reality.eth. You can get this from the INFO tab by entering the marketId and clicking `FETCH QUESTION`. The question ID is displayed in the Question Info section.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* History Hashes */}
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="HISTORY HASHES (COMMA-SEPARATED BYTES32)"
                                className="input input-bordered input-sm font-mono text-center flex-1"
                                value={historyHashes}
                                onChange={e => setHistoryHashes(e.target.value)}
                              />
                              <div className="relative tooltip-container">
                                <button
                                  type="button"
                                  onClick={() => setOpenTooltip(openTooltip === "historyHashes" ? null : "historyHashes")}
                                  className="cursor-pointer"
                                >
                                  <InformationCircleIcon className="w-4 h-4 text-base-content/50" />
                                </button>
                                {openTooltip === "historyHashes" && (
                                  <div className="absolute right-0 top-6 z-50 w-80 bg-base-200 border border-base-content/20 rounded-lg shadow-lg p-3 text-xs break-words">
                                    <div className="flex justify-between items-start mb-2">
                                      <span className="font-bold text-base-content/70">History Hashes</span>
                                      <button
                                        type="button"
                                        onClick={() => setOpenTooltip(null)}
                                        className="text-base-content/50 hover:text-base-content"
                                      >
                                        <XMarkIcon className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <p className="text-base-content/80 select-text break-words">
                                      Each answer submission creates a history hash. The first history hash always starts with{" "}
                                      <code className="bg-base-300 px-1 rounded break-all">0x0000000000000000000000000000000000000000000000000000000000000000</code>. If the market has only one answer, that will be the history hash. Each subsequent hash is computed from the previous hash, answer, bond, answerer, and a boolean flag.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Answerers */}
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="ANSWERERS (COMMA-SEPARATED ADDRESSES)"
                                className="input input-bordered input-sm font-mono text-center flex-1"
                                value={answerers}
                                onChange={e => setAnswerers(e.target.value)}
                              />
                              <div className="relative tooltip-container">
                                <button
                                  type="button"
                                  onClick={() => setOpenTooltip(openTooltip === "answerers" ? null : "answerers")}
                                  className="cursor-pointer"
                                >
                                  <InformationCircleIcon className="w-4 h-4 text-base-content/50" />
                                </button>
                                {openTooltip === "answerers" && (
                                  <div className="absolute right-0 top-6 z-50 w-80 bg-base-200 border border-base-content/20 rounded-lg shadow-lg p-3 text-xs">
                                    <div className="flex justify-between items-start mb-2">
                                      <span className="font-bold text-base-content/70">Answerers</span>
                                      <button
                                        type="button"
                                        onClick={() => setOpenTooltip(null)}
                                        className="text-base-content/50 hover:text-base-content"
                                      >
                                        <XMarkIcon className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <p className="text-base-content/80 select-text">
                                      The addresses of the users who answered the question. If you used the Reality Oracle to open and answer the question, the address will be the oracle contract address{oracle_address ? (
                                        <> (<code className="bg-base-300 px-1 rounded break-all">{oracle_address}</code>)</>
                                      ) : ""}. Each address corresponds to one answer in the history.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Bonds */}
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="BONDS (COMMA-SEPARATED WEI VALUES)"
                                className="input input-bordered input-sm font-mono text-center flex-1"
                                value={bonds}
                                onChange={e => setBonds(e.target.value)}
                              />
                              <div className="relative tooltip-container">
                                <button
                                  type="button"
                                  onClick={() => setOpenTooltip(openTooltip === "bonds" ? null : "bonds")}
                                  className="cursor-pointer"
                                >
                                  <InformationCircleIcon className="w-4 h-4 text-base-content/50" />
                                </button>
                                {openTooltip === "bonds" && (
                                  <div className="absolute right-0 top-6 z-50 w-80 bg-base-200 border border-base-content/20 rounded-lg shadow-lg p-3 text-xs">
                                    <div className="flex justify-between items-start mb-2">
                                      <span className="font-bold text-base-content/70">Bonds</span>
                                      <button
                                        type="button"
                                        onClick={() => setOpenTooltip(null)}
                                        className="text-base-content/50 hover:text-base-content"
                                      >
                                        <XMarkIcon className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <p className="text-base-content/80 select-text">
                                      The bond amounts (in wei) that were posted with each answer. Bonds are used to incentivize correct answers and penalize incorrect ones. By default, our system uses{" "}
                                      <code className="bg-base-300 px-1 rounded">1500000000000000</code> wei (0.0015 ETH) per answer. Each bond corresponds to one answer in the history.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Answers */}
                            <div className="flex items-center gap-2">
                              <input
                                type="text"
                                placeholder="ANSWERS (COMMA-SEPARATED BYTES32)"
                                className="input input-bordered input-sm font-mono text-center flex-1"
                                value={answers}
                                onChange={e => setAnswers(e.target.value)}
                              />
                              <div className="relative tooltip-container">
                                <button
                                  type="button"
                                  onClick={() => setOpenTooltip(openTooltip === "answers" ? null : "answers")}
                                  className="cursor-pointer"
                                >
                                  <InformationCircleIcon className="w-4 h-4 text-base-content/50" />
                                </button>
                                {openTooltip === "answers" && (
                                  <div className="absolute right-0 top-6 z-50 w-80 bg-base-200 border border-base-content/20 rounded-lg shadow-lg p-3 text-xs break-words">
                                    <div className="flex justify-between items-start mb-2">
                                      <span className="font-bold text-base-content/70">Answers</span>
                                      <button
                                        type="button"
                                        onClick={() => setOpenTooltip(null)}
                                        className="text-base-content/50 hover:text-base-content"
                                      >
                                        <XMarkIcon className="w-4 h-4" />
                                      </button>
                                    </div>
                                    <p className="text-base-content/80 select-text break-words">
                                      The answers in bytes32 format. The first outcome corresponds to{" "}
                                      <code className="bg-base-300 px-1 rounded break-all">0x0000000000000000000000000000000000000000000000000000000000000000</code>, the second to{" "}
                                      <code className="bg-base-300 px-1 rounded break-all">0x0000000000000000000000000000000000000000000000000000000000000001</code>, and so on. Each answer corresponds to one entry in the history.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </div>

                            <button
                              className="btn btn-accent btn-sm font-mono"
                              onClick={handleClaimWinnings}
                            >
                              CLAIM WINNINGS
                            </button>
                          </div>

                          {/* Withdraw Section */}
                          <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-3">
                            <h5 className="font-bold text-base-content/70 m-0">Withdraw from Reality.eth</h5>
                            <p className="text-xs text-base-content/70">
                              Withdraws any available balance from the Reality.eth contract to this oracle contract.
                            </p>
                            <button
                              className="btn btn-accent btn-sm font-mono"
                              onClick={handleRealityWithdraw}
                            >
                              WITHDRAW
                            </button>
                          </div>

                          {/* Withdraw to EOA Section */}
                          <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-3">
                            <h5 className="font-bold text-base-content/70 m-0">Withdraw from Oracle</h5>
                            <p className="text-xs text-base-content/70">
                              Withdraws any available balance from the oracle contract to your EOA.
                            </p>
                            <input
                              type="text"
                              placeholder="Token address (empty = ETH)"
                              className="input input-bordered input-sm w-full font-mono"
                              value={withdrawTokenAddress}
                              onChange={e => setWithdrawTokenAddress(e.target.value)}
                            />
                            <button
                              className="btn btn-accent btn-sm font-mono"
                              onClick={handleWithdrawToEoa}
                            >
                              WITHDRAW
                            </button>
                          </div>

                        </div>
                      )}

                      {/* Contracts Tab */}
                      {activeTab === "contracts" && (
                        <div className="gap-2 flex flex-col">
                          <h4 className="font-bold text-base-content/70 m-0">:: Contract Addresses ::</h4>
                          <div className="p-4 border border-dashed border-base-content/20 rounded-md flex flex-col gap-3">
                            <div className="flex flex-col gap-4">
                              {/* Precog Master */}
                              <div className="bg-base-200 p-3 rounded">
                                <h5 className="font-bold text-accent mb-2 text-center">PRECOG MASTER</h5>
                                <div className="space-y-2">
                                  <p className="break-all text-xs">
                                    {precogMasterAddress ? (
                                      <a
                                        href={getBlockExplorerAddressLink(targetNetwork, precogMasterAddress)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 hover:underline break-all"
                                      >
                                        {precogMasterAddress}
                                        <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
                                      </a>
                                    ) : (
                                      "Not fetched"
                                    )}
                                  </p>
                                  <button
                                    className="btn btn-accent btn-sm font-mono w-full"
                                    onClick={fetchPrecogMaster}
                                  >
                                    FETCH
                                  </button>
                                </div>
                              </div>

                              {/* Reality.ETH */}
                              <div className="bg-base-200 p-3 rounded">
                                <h5 className="font-bold text-accent mb-2 text-center">REALITY.ETH</h5>
                                <div className="space-y-2">
                                  <p className="break-all text-xs">
                                    {realityAddress ? (
                                      <a
                                        href={getBlockExplorerAddressLink(targetNetwork, realityAddress)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 hover:underline break-all"
                                      >
                                        {realityAddress}
                                        <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
                                      </a>
                                    ) : (
                                      "Not fetched"
                                    )}
                                  </p>
                                  <button
                                    className="btn btn-accent btn-sm font-mono w-full"
                                    onClick={fetchReality}
                                  >
                                    FETCH
                                  </button>
                                </div>
                              </div>

                              {/* Arbitrator */}
                              <div className="bg-base-200 p-3 rounded">
                                <h5 className="font-bold text-accent mb-2 text-center">ARBITRATOR</h5>
                                <div className="space-y-2">
                                  <p className="break-all text-xs">
                                    {arbitratorAddress ? (
                                      <a
                                        href={getBlockExplorerAddressLink(targetNetwork, arbitratorAddress)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 hover:underline break-all"
                                      >
                                        {arbitratorAddress}
                                        <ArrowTopRightOnSquareIcon className="w-3 h-3 flex-shrink-0" />
                                      </a>
                                    ) : (
                                      "Not fetched"
                                    )}
                                  </p>
                                  <button
                                    className="btn btn-accent btn-sm font-mono w-full"
                                    onClick={fetchArbitrator}
                                  >
                                    FETCH
                                  </button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Oracle;
