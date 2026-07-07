# Precog Dev
This repository contains all smart contracts for the Precog forecasting protocol ([**Precog Markets**](https://precog.markets/)).
> Precog App Site: [**Precog Core**](https://core.precog.markets/)
<hr/>

#### Prediction Markets and LMSR & LS-LMSR theory:
- [Cultivate Labs: Types of Prediction Markets](https://www.cultivatelabs.com/crowdsourced-forecasting-guide/what-are-the-different-types-of-prediction-markets)
- [Precog: Interactive LS-LMSR Simulator](https://core.precog.markets/simulator)
- [Research Corner: Gates Building Prediction Market](https://www.cs.utexas.edu/news/2012/research-corner-gates-building-prediction-market)
- [Augur: LMSR and LS-LMSR](https://augur.mystrikingly.com/blog/augur-s-automated-market-maker-the-ls-lmsr)
- [Precog: Liquidity Sensitive LMSR](./LS-LMSR.md)
- [Precog: LS-LMSR Max loss proof](./packages/hardhat/logs/Precog_LS-LMSR_Max-Loss.pdf)

## Repository Structure
- [Contracts Implementations](/packages/hardhat/contracts)
- [Test Implementations](/packages/hardhat/test)
- [Deploy and Helpers](/packages/hardhat/scripts)
> Precog Dev Site: [**Precog Dev**](https://dev.precog.markets/) (here the deployed version of this repo)
<hr/>

## Mainnet Latest Deployments

### BASE (`chain: 8453`)
- **PrecogMaster**: [0x00000000000c109080dfa976923384b97165a57a](https://basescan.org/address/0x00000000000c109080dfa976923384b97165a57a)
- **PrecogMarket**: [0x44769bE6853918e939281b2f669f9a58608Cb55B](https://basescan.org/address/0x44769bE6853918e939281b2f669f9a58608Cb55B) (Recipe for all markets)
- **PrecogRealityOracle**: [0xbb49B9c5B73b2eBAecee8272d2B8B3bEBe16F073](https://basescan.org/address/0xbb49B9c5B73b2eBAecee8272d2B8B3bEBe16F073) 

### ARBITRUM (`chain: 42161`)
- **PrecogMaster**: [0x0000000000990400E12543B7f400136e8672E2F0](https://arbiscan.io/address/0x0000000000990400e12543b7f400136e8672e2f0)
- **PrecogMarket**: [0x44769bE6853918e939281b2f669f9a58608Cb55B](https://arbiscan.io/address/0x44769be6853918e939281b2f669f9a58608cb55b) (Recipe for all markets)
- **PrecogRealityOracle**: [0x87Ae8A07529363309a0eFcD2ce83c1a7f2B7ccB5](https://arbiscan.io/address/0x87ae8a07529363309a0efcd2ce83c1a7f2b7ccb5) 
<hr/>

## Testnet Latest Deployments (Base Sepolia)
- **PrecogMasterV8**: [0x61ec71F1Fd37ecc20d695E83F3D68e82bEfe8443](https://sepolia.basescan.org/address/0x61ec71F1Fd37ecc20d695E83F3D68e82bEfe8443)
- **PrecogMarketV8**: [0xfB4CD4779980896893B1855ad5A89E3ACCA7fc87](https://sepolia.basescan.org/address/0xfB4CD4779980896893B1855ad5A89E3ACCA7fc87) (Recipe for all markets)
- **PrecogRealityOracleV3**: [0xcA96BBDC3e45614c6F49CcF8cb913C0965Dca2E5](https://sepolia.basescan.org/address/0xcA96BBDC3e45614c6F49CcF8cb913C0965Dca2E5)
> Precog app site: [**Precog Core Staging**](https://staging-core.precog.markets/) 
<hr/>

## Utility commands
`yarn test`: Run all tests on latest contract implementations (useful to check all requirements and dependencies).

`yarn test-details`: Run tests on latest implementations with verbose details (useful on developing new features).

`yarn test-gas`: Run all tests with the gas profiler enabled to check/optimize gas costs.

`yarn chain`: Starts a local hardhat chain with configured accounts (useful to test initial deploys).

`yarn fork`: Starts a local hardhat fork chain with configured accounts (useful to test new version deploys).

`yarn deploy`: Runs deploy script. It's recommended to test it over a fork network before live chain run.

`yarn start`: Runs GUI server (useful to test new releases or features).

`yarn lint`: Runs Hardhat and NextJs linters to ensure best practices.

> Note: all available commands could be found on the `package.json` file
<hr/>

## Develop/Contribute
#### Requirements
- [Node (>= v18.17)](https://nodejs.org/en/download/)
- Yarn ([v1](https://classic.yarnpkg.com/en/docs/install/) or [v2+](https://yarnpkg.com/getting-started/install))
- [Git](https://git-scm.com/downloads)

#### Installing dependencies
`yarn install`: 
<hr/>

## Base project Documentation
This project used the Scaffold-ETH-2 project as template. 
Visit the [Docs](https://docs.scaffoldeth.io) to find useful scripts and guides:
- ️ Built using NextJS, RainbowKit, Hardhat, Wagmi and Viem.
<hr/>

## License
Precog Dev is licensed under the Business Source License 1.1 (BUSL-1.1), see [BUSL_LICENSE](./licences/BUSL_LICENSE), and the MIT License (MIT), see [MIT_LICENSE](./licences/MIT_LICENSE).

Each file in the Precog Dev repository states the applicable license type in the header.
<hr/>