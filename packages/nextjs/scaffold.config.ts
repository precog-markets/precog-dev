import * as chains from "viem/chains";

export type ScaffoldConfig = {
    targetNetworks: readonly chains.Chain[];
    pollingInterval: number;
    alchemyApiKey: string;
    nodeProviderUrl: string;
    walletConnectProjectId: string;
    onlyLocalBurnerWallet: boolean;
    marketSharesToTrade: number;
    precogTrackerApiKey: string
};

const scaffoldConfig = {
    // The networks on which your DApp is live
    targetNetworks: [chains.base, chains.baseSepolia, chains.arbitrum],
    // targetNetworks: [chains.hardhat],

    // The interval at which your front-end polls the RPC servers for new data
    // it has no effect if you only target the local network (default is 4000)
    pollingInterval: 20000,

    // This is ours Alchemy's default API key.
    // You can get your own at https://dashboard.alchemyapi.io
    // It's recommended to store it in an env variable:
    // .env.local for local testing, and in the Vercel/system env config for live apps.
    alchemyApiKey: process.env.NEXT_PUBLIC_ALCHEMY_API_KEY || "IZYEU2cWBgnFmgiTAgpWD",

    nodeProviderUrl: process.env.NEXT_PUBLIC_NODE_PROVIDER_URL || "http://localhost:8545",

    // This is ours WalletConnect's default project ID.
    // You can get your own at https://cloud.walletconnect.com
    // It's recommended to store it in an env variable:
    // .env.local for local testing, and in the Vercel/system env config for live apps.
    walletConnectProjectId: process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID || "3a8170812b534d0ff9d794f19a901d64",

    // Only show the Burner Wallet when running on hardhat network
    onlyLocalBurnerWallet: false,

    // # Amount of shares to be used as default in BUY and SELL trades
    marketSharesToTrade: 1,

    precogTrackerApiKey: process.env.NEXT_PRECOG_TRACKER_API_KEY || "8ab1b34a-8bf1-7bcd-9fa8-4f0b785b03f9",

} as const satisfies ScaffoldConfig;

export default scaffoldConfig;
