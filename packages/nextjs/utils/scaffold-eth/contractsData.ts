import scaffoldConfig from "~~/scaffold.config";
import { contracts } from "~~/utils/scaffold-eth/contract";

// This list set the contracts to show on debug page (also the ordering)
const LATEST_CONTRACTS_NAMES = [
    "PrecogMasterV7", "PrecogMasterV8", "PrecogRealityOracleV3", "MateToken", "FakeRealityETH",  // Latest contracts
    // "PrecogRealityOracleV1", "PrecogRealityOracleV2" // Deprecated Contracts
];

/** Supported PrecogMaster contract versions (single source of truth for version literals). */
export type PrecogMasterVersion = "v7" | "v8";
export type PrecogRealityOracleVersion = "v2" | "v3";

const PRECOG_MASTER_VERSION_CONTRACT: Record<PrecogMasterVersion, string> = {
  v7: "PrecogMasterV7",
  v8: "PrecogMasterV8",
};

const PRECOG_REALITY_ORACLE_VERSION_CONTRACT: Record<PrecogRealityOracleVersion, string> = {
  v2: "PrecogRealityOracleV2",
  v3: "PrecogRealityOracleV3",
};

export function getPrecogMasterContractKey(version: PrecogMasterVersion): string {
  return PRECOG_MASTER_VERSION_CONTRACT[version];
}

export function getPrecogRealityOracleContractKey(version: PrecogRealityOracleVersion): string {
  return PRECOG_REALITY_ORACLE_VERSION_CONTRACT[version];
}

export function isPrecogMasterVersionDeployed(networkId: number, version: PrecogMasterVersion): boolean {
  const contractsData = getContractsByNetwork(networkId);
  const key = getPrecogMasterContractKey(version);
  return Boolean(contractsData?.[key]?.address);
}

export function isPrecogRealityOracleVersionDeployed(networkId: number, version: PrecogRealityOracleVersion): boolean {
  const contractsData = getContractsByNetwork(networkId);
  const key = getPrecogRealityOracleContractKey(version);
  return Boolean(contractsData?.[key]?.address);
}

export function getAvailablePrecogMasterVersions(networkId: number): PrecogMasterVersion[] {
  const versions: PrecogMasterVersion[] = [];
  if (isPrecogMasterVersionDeployed(networkId, "v7")) versions.push("v7");
  if (isPrecogMasterVersionDeployed(networkId, "v8")) versions.push("v8");
  return versions;
}

export function getAvailablePrecogRealityOracleVersions(networkId: number): PrecogRealityOracleVersion[] {
  const versions: PrecogRealityOracleVersion[] = [];
  if (isPrecogRealityOracleVersionDeployed(networkId, "v2")) versions.push("v2");
  if (isPrecogRealityOracleVersionDeployed(networkId, "v3")) versions.push("v3");
  return versions;
}

export function getLatestContractsNames() {
  // Note: an optional `networkId` parameter could be added to this function in the future
  return LATEST_CONTRACTS_NAMES;
}

export function getLatestContracts(networkId?: number) {
  // Set a list of the latest contract versions to support on the frontend (to avoid showing deprecated versions)
  const latestContractsNames = getLatestContractsNames();

  // If no network id was received, use the network id of the first target network on Scafold Config file
  if (!networkId) {
      networkId = scaffoldConfig.targetNetworks[0].id;
  }

  // Filter contracts data of the selected chain by the latest contracts list
  let contractsData: Record<string, any> | undefined = contracts?.[networkId];
  contractsData = contractsData ? filterProperties(contractsData, latestContractsNames): {};
  return contractsData;
}

export function getContractsByNetwork(networkId: number) {
  const contractsData = contracts?.[networkId];
  return contractsData ? contractsData : {};
}

function filterProperties(obj: any, keysToFilter: string[]): Record<string, unknown> {
  return Object.keys(obj)
    .filter(key => keysToFilter.includes(key))
    .reduce((acc: any, key: string) => {
      acc[key] = obj[key];
      return acc;
    }, {});
}
