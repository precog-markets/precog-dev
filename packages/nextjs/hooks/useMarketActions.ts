// TODO Using 2 block confirmations for now, need to change to 1. With 2 we assure that the refetch works.

import { useState } from "react";
import { usePublicClient, useAccount, useWriteContract, useSignTypedData } from "wagmi";
import {erc20Abi, parseUnits, formatUnits} from "viem";
import { useScaffoldContract } from "./scaffold-eth";
import { ContractName } from "~~/utils/scaffold-eth/contract";
import { getPrecogMasterContractKey, type PrecogMasterVersion } from "~~/utils/scaffold-eth/contractsData";
import { useTransactor } from "./scaffold-eth/useTransactor";
import { useTargetNetwork } from "./scaffold-eth/useTargetNetwork";
import { fromNumberToInt128, fromInt128toNumber } from "~~/utils/numbers";
import { notification } from "~~/utils/scaffold-eth";

type AccountSharesTuple = readonly [bigint, bigint, bigint, bigint, bigint, readonly bigint[]];

export function useMarketActions(version: PrecogMasterVersion = "v8") {
  const [isPending, setIsPending] = useState(false);
  const { address: connectedAddress } = useAccount();
  const { targetNetwork } = useTargetNetwork();
  const publicClient = usePublicClient({ chainId: targetNetwork.id });
  const writeTx = useTransactor();
  const { writeContractAsync } = useWriteContract();
  const marketContractName = (version === "v8" ? "PrecogMarketV8" : "PrecogMarketV7") as ContractName;
  const masterContractName = getPrecogMasterContractKey(version) as ContractName;

  const { data: marketContract } = useScaffoldContract({
    contractName: marketContractName,
  });

  const { data: masterContract } = useScaffoldContract({
    contractName: masterContractName,
  });

  const { signTypedDataAsync } = useSignTypedData();

  const getCollateralAddressV7 = async (marketAddress: string): Promise<`0x${string}`> => {
    if (!publicClient || !marketContract) throw new Error("Missing dependencies for collateral lookup (v7)");
    const collateral = (await publicClient.readContract({
      address: marketAddress as `0x${string}`,
      abi: marketContract.abi,
      functionName: "token",
    })) as `0x${string}`;
    return collateral;
  };

  const getCollateralAddressV8 = async (marketId: number): Promise<`0x${string}`> => {
    if (!publicClient || !masterContract) throw new Error("Missing dependencies for collateral lookup (v8)");
    const collateralInfo = (await publicClient.readContract({
      address: masterContract.address,
      abi: masterContract.abi,
      functionName: "marketCollateralInfo",
      args: [BigInt(marketId)],
    })) as [`0x${string}`, string, string, number];
    return collateralInfo[0];
  };

  const getCollateralAddress = async (marketId: number, marketAddress: string): Promise<`0x${string}`> => {
    if (!publicClient || !masterContract || !marketContract) {
      throw new Error("Missing dependencies for collateral lookup");
    }
    return version === "v8" ? getCollateralAddressV8(marketId) : getCollateralAddressV7(marketAddress);
  };

  const getAccountInfoV7 = async (marketId: number): Promise<AccountSharesTuple> => {
    if (!publicClient || !masterContract || !connectedAddress) {
      throw new Error("Missing dependencies for account info (v7)");
    }
    return (await publicClient.readContract({
      address: masterContract.address,
      abi: masterContract.abi,
      functionName: "marketAccountShares",
      args: [BigInt(marketId), connectedAddress],
    })) as AccountSharesTuple;
  };

  const getAccountInfoV8 = async (marketId: number): Promise<AccountSharesTuple> => {
    if (!publicClient || !masterContract || !connectedAddress) {
      throw new Error("Missing dependencies for account info (v8)");
    }
    return (await publicClient.readContract({
      address: masterContract.address,
      abi: masterContract.abi,
      functionName: "marketAccountInfo",
      args: [BigInt(marketId), connectedAddress],
    } as any)) as unknown as AccountSharesTuple;
  };

  const getPermit2Address = async (): Promise<`0x${string}`> => {
    if (version !== "v8" || !publicClient || !masterContract) {
      throw new Error("Missing dependencies for Permit2 lookup (v8)");
    }
    return (await publicClient.readContract({
      address: masterContract.address,
      abi: masterContract.abi,
      functionName: "PERMIT2",
    } as any)) as `0x${string}`;
  };


  /**
   * Executes a buy transaction for market shares
   * @param marketId - ID of the market to buy shares in
   * @param marketOutcome - Outcome ID to buy
   * @param sharesToTrade - Number of shares to buy (number, not int128)
   * @param marketAddress - Address of the market contract
   * @param maxTokenIn - Maximum amount of tokens to spend (number, not wei)
   */
  const executeBuy = async (
    marketId: number,
    marketOutcome: number,
    sharesToTrade: number,
    marketAddress: string,
    maxTokenIn: number
  ) => {
    if (!connectedAddress || !masterContract || !marketContract || !publicClient) {
      notification.error("Missing dependencies for trade execution");
      return;
    }

    setIsPending(true);

    try {
      // V8 reads collateral from master.marketCollateralInfo; V7 keeps market.token.
      const collateral = await getCollateralAddress(marketId, marketAddress);

      // Check user's token balance
      const balance = await publicClient.readContract({
        address: collateral,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [connectedAddress],
      }) as bigint;

      // Check user's token balance
      const tokenDecimals = await publicClient.readContract({
        address: collateral,
        abi: erc20Abi,
        functionName: "decimals",
        args: [],
      }) as number;

      const maxTokenWei = parseUnits(maxTokenIn.toString(), tokenDecimals);

      if (balance < maxTokenWei) {
        notification.error("Insufficient token balance");
        return;
      }

      // Check if approval is needed
      const allowance = await publicClient.readContract({
        address: collateral,
        abi: erc20Abi,
        functionName: "allowance",
        args: [connectedAddress, masterContract.address],
      }) as bigint;

      if (allowance < maxTokenWei) {
        const writeApproveAsync = () =>
          writeContractAsync({
            chainId: targetNetwork.id,
            address: collateral,
            abi: erc20Abi,
            functionName: "approve",
            args: [masterContract.address, maxTokenWei],
          });

        await writeTx(writeApproveAsync, { blockConfirmations: 2 });
      }

      // Execute buy transaction
      const writeBuyAsync = () =>
        writeContractAsync({
          chainId: targetNetwork.id,
          address: masterContract.address,
          abi: masterContract.abi,
          functionName: "marketBuy",
          args: [BigInt(marketId), BigInt(marketOutcome), fromNumberToInt128(sharesToTrade), maxTokenWei],
        });

      const txHash = await writeTx(writeBuyAsync, { blockConfirmations: 2 });
      return txHash;
    } catch (error) {
      console.error("Trade execution failed:", error);
      notification.error("Trade execution failed");
    } finally {
      setIsPending(false);
    }
  };

  /**
   * Executes a buy transaction using ownedMarketBuy (no ERC20 approval needed)
   * @param marketId - ID of the market to buy shares in
   * @param marketOutcome - Outcome ID to buy
   * @param sharesToTrade - Number of shares to buy (number, not int128)
   * @param marketAddress - Address of the market contract
   * @param maxTokenIn - Maximum amount of tokens to spend (number, not wei)
   */
  const executeOwnedBuy = async (
    marketId: number,
    marketOutcome: number,
    sharesToTrade: number,
    marketAddress: string,
    maxTokenIn: number
  ) => {
    if (!connectedAddress || !masterContract || !marketContract || !publicClient) {
      notification.error("Missing dependencies for trade execution");
      return;
    }

    setIsPending(true);

    try {
      const collateral = await getCollateralAddress(marketId, marketAddress);

      const balance = await publicClient.readContract({
        address: collateral,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [connectedAddress],
      }) as bigint;

      const tokenDecimals = await publicClient.readContract({
        address: collateral,
        abi: erc20Abi,
        functionName: "decimals",
        args: [],
      }) as number;

      const maxTokenWei = parseUnits(maxTokenIn.toString(), tokenDecimals);

      if (balance < maxTokenWei) {
        notification.error("Insufficient token balance");
        return;
      }

      const writeOwnedBuyAsync = () =>
        writeContractAsync({
          chainId: targetNetwork.id,
          address: masterContract.address,
          abi: masterContract.abi,
          functionName: "ownedMarketBuy",
          args: [BigInt(marketId), BigInt(marketOutcome), fromNumberToInt128(sharesToTrade), maxTokenWei],
        });

      const txHash = await writeTx(writeOwnedBuyAsync, { blockConfirmations: 2 });
      return txHash;
    } catch (error) {
      console.error("Owned buy execution failed:", error);
      notification.error("Owned buy execution failed");
    } finally {
      setIsPending(false);
    }
  };

  /**
   * Executes a sell transaction for market shares
   * @param marketId - ID of the market to sell shares from
   * @param marketOutcome - Outcome ID to sell
   * @param sharesToTrade - Number of shares to sell
   * @param marketAddress - Address of the market contract
   */
  const executeSell = async (
    marketId: number,
    marketOutcome: number,
    sharesToTrade: number,
    marketAddress: string
  ) => {
    if (!connectedAddress || !masterContract || !marketContract || !publicClient) {
      notification.error("Missing dependencies for trade execution");
      return;
    }

    setIsPending(true);

    try {
      // Check user's shares balance
      const accountShares = version === "v8" ? await getAccountInfoV8(marketId) : await getAccountInfoV7(marketId);

      // Get the sell price and calculate minimum tokens to receive
      const priceResult = await publicClient.readContract({
        address: masterContract.address,
        abi: masterContract.abi,
        functionName: "marketSellPrice",
        args: [BigInt(marketId), BigInt(marketOutcome), fromNumberToInt128(sharesToTrade)],
      }) as bigint;

      const collateral = await getCollateralAddress(marketId, marketAddress);

      // Check user's token balance
      const tokenDecimals = await publicClient.readContract({
        address: collateral,
        abi: erc20Abi,
        functionName: "decimals",
        args: [],
      }) as number;

      // Calculate max amount of shares available to sell
      const outcomeBalances = accountShares[5];
      const maxSellAmount = Number(formatUnits(outcomeBalances[marketOutcome], tokenDecimals));

      // Check that the selling amount is less than max amount available
      if (sharesToTrade > maxSellAmount) {
        notification.error("Insufficient shares balance");
        return;
      }

      // Calculate min out of tokens to receive for this sell
      const price = fromInt128toNumber(priceResult);
      const minTokenOut = price * 0.999; // Add 0.1% slippage
      const minOut = parseUnits(minTokenOut.toString(), tokenDecimals);

      // Execute sell transaction
      const writeSellAsync = () =>
        writeContractAsync({
          chainId: targetNetwork.id,
          address: masterContract.address,
          abi: masterContract.abi,
          functionName: "marketSell",
          args: [BigInt(marketId), BigInt(marketOutcome), fromNumberToInt128(sharesToTrade), minOut],
        });

      const txHash = await writeTx(writeSellAsync, { blockConfirmations: 2 });
      return txHash;
    } catch (error) {
      console.error("Sell execution failed:", error);
      notification.error("Sell execution failed");
    } finally {
      setIsPending(false);
    }
  };

    /**
   * Executes a report transaction to set the market outcome
   * @param marketId - The unique identifier of the market
   * @param outcomeId - The outcome to report
   * @param marketAddress - The address of the market contract
   */
    const executeReport = async (marketId: number, outcomeId: number, marketAddress: string) => {
      if (!connectedAddress || !marketContract) {
        notification.error("Missing dependencies for report execution");
        return;
      }
  
      setIsPending(true);
  
      try {
        const writeReportAsync = () =>
          writeContractAsync({
            chainId: targetNetwork.id,
            address: marketAddress as `0x${string}`,
            abi: marketContract.abi,
            functionName: "reportResult",
            args: [BigInt(marketId), BigInt(outcomeId)],
          });
  
        const txHash = await writeTx(writeReportAsync, { blockConfirmations: 2 });
        return txHash;
      } catch (error) {
        console.error("Report execution failed:", error);
        notification.error("Report execution failed");
      } finally {
        setIsPending(false);
      }
    };


  /**
   * Executes a redeem transaction for market shares
   * @param marketId - ID of the market to redeem shares from
   */
  const executeRedeem = async (marketId: number) => {
    if (!connectedAddress || !masterContract || !publicClient) {
      notification.error("Missing dependencies for redeem execution");
      return;
    }

    setIsPending(true);

    try {
      // Execute redeem transaction
      const writeRedeemAsync = () =>
        writeContractAsync({
          chainId: targetNetwork.id,
          address: masterContract.address,
          abi: masterContract.abi,
          functionName: "marketRedeemShares",
          args: [BigInt(marketId)],
        });

      const txHash = await writeTx(writeRedeemAsync, { blockConfirmations: 2 });
      return txHash;
    } catch (error) {
      console.error("Redeem execution failed:", error);
      throw error; // Let useTransactor handle the error notification
    } finally {
      setIsPending(false);
    }
  };

  const executePermit2Buy = async (
    marketId: number,
    marketOutcome: number,
    sharesToTrade: number,
    marketAddress: string,
    maxTokenIn: number,
    permit2Address?: `0x${string}`,
  ) => {
    if (!connectedAddress || !masterContract || !marketContract || !publicClient) {
      notification.error("Missing dependencies for trade execution");
      return;
    }
    setIsPending(true);
    try {
      const collateral = await getCollateralAddress(marketId, marketAddress);

      const [balance, tokenDecimals] = await Promise.all([
        publicClient.readContract({ address: collateral, abi: erc20Abi, functionName: "balanceOf", args: [connectedAddress] }) as Promise<bigint>,
        publicClient.readContract({ address: collateral, abi: erc20Abi, functionName: "decimals", args: [] }) as Promise<number>,
      ]);

      const maxTokenWei = parseUnits(maxTokenIn.toString(), tokenDecimals);

      if (balance < maxTokenWei) {
        notification.error("Insufficient token balance");
        return;
      }

      const chainId = publicClient.chain.id;
      const resolvedPermit2Address = permit2Address ?? await getPermit2Address();
      const nonce = BigInt(Date.now());
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 3600);

      const signature = await signTypedDataAsync({
        domain: { name: "Permit2", chainId, verifyingContract: resolvedPermit2Address },
        types: {
          PermitTransferFrom: [
            { name: "permitted", type: "TokenPermissions" },
            { name: "spender", type: "address" },
            { name: "nonce", type: "uint256" },
            { name: "deadline", type: "uint256" },
          ],
          TokenPermissions: [
            { name: "token", type: "address" },
            { name: "amount", type: "uint256" },
          ],
        },
        primaryType: "PermitTransferFrom",
        message: {
          permitted: { token: collateral, amount: maxTokenWei },
          spender: masterContract.address,
          nonce: nonce,
          deadline: deadline,
        },
      });

      const writePermit2BuyAsync = () =>
        writeContractAsync({
          chainId: targetNetwork.id,
          address: masterContract.address,
          abi: masterContract.abi,
          functionName: "marketBuyWithPermit2",
          args: [BigInt(marketId), BigInt(marketOutcome), fromNumberToInt128(sharesToTrade), maxTokenWei, nonce, deadline, signature],
        });

      return await writeTx(writePermit2BuyAsync, { blockConfirmations: 2 });
    } catch (error) {
      console.error("Permit2 buy execution failed:", error);
      notification.error("Permit2 buy execution failed");
    } finally {
      setIsPending(false);
    }
  };

  return {
    executeBuy: executeBuy,
    executeOwnedBuy: executeOwnedBuy,
    executePermit2Buy: executePermit2Buy,
    executeSell: executeSell,
    executeReport: executeReport,
    executeRedeem: executeRedeem,
    isPending: isPending,
    isLoading: !marketContract || !masterContract,
  };
}
