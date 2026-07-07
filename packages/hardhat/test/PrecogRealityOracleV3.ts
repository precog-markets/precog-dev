import { expect } from "chai";
import { ethers } from "hardhat";
import {
    PrecogToken,
    PrecogMasterV8,
    PrecogMarketV8,
    PrecogRealityOracleV3,
    FakeRealityETH,
    FakeDai
} from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { fromNumberToInt128, getCurrentBlockTimestamp } from "../libs/helpers"

describe("PrecogRealityOracleV3", function () {
    const detailsEnabled: boolean = process.env.TEST_DETAILS === 'true';
    let pre: PrecogToken;
    let market: PrecogMarketV8;
    let master: PrecogMasterV8;
    let reality: FakeRealityETH;
    let oracle: PrecogRealityOracleV3;
    let dai: FakeDai;
    let admin: HardhatEthersSigner;
    let user: HardhatEthersSigner;
    let globalReporter: HardhatEthersSigner;
    let marketReporter: HardhatEthersSigner;
    let caller: HardhatEthersSigner;

    beforeEach(async function () {
        [admin, user, caller, globalReporter, marketReporter] = await ethers.getSigners();
    });

    describe("Deployment & setup", function () {
        it("Deploy & setup Precog ecosystem", async function () {
            // Deploy Test token: PrecogToken
            const PRE = await ethers.getContractFactory("PrecogToken");
            const precogOwner = admin.address;
            pre = await PRE.deploy(precogOwner);
            // Mint PRE tokens for accounts
            await pre.mint(admin.address, ethers.parseEther('2500'));
            await pre.mint(caller.address, ethers.parseEther('2500'));
            await pre.mint(marketReporter.address, ethers.parseEther('2500'));
            await pre.mint(user.address, ethers.parseEther('1'));

            // Deploy PrecogMaster contract
            const PrecogMaster = await ethers.getContractFactory("PrecogMasterV8");
            master = await PrecogMaster.deploy(admin.address);
            // Deploy Base PrecogMarket contract
            const PrecogMarket = await ethers.getContractFactory("PrecogMarketV8");
            market = await PrecogMarket.deploy();
            await market.initialize(await pre.getAddress());
            // Set base market references on PrecogMaster
            await master.setBaseMarket(await market.getAddress());
            // Add 'ADMIN' account to PrecogMaster access list
            await master.addAdmin(admin.address);
            // Add 'CALLER' account to PrecogMaster access list
            await master.addCaller(caller.address);
            // Add 'MARKET_OPERATOR' role to 'CALLER' account
            await master.addMarketOperator(caller.address);
            // Transfer ownership of PrecogToken to PrecogMaster
            await pre.transferOwnership(await master.getAddress());

            // Deploy FakeDai contract
            const DAI = await ethers.getContractFactory("FakeDai");
            dai = await DAI.deploy(admin.address);
            // Mint tokens to caller
            await dai.mint(caller.address, ethers.parseEther('2000'));

            // Add Market allowed collaterals
            await master.addAllowedCollateral(await pre.getAddress());
            await master.addAllowedCollateral(await dai.getAddress());
        })

        it("Deploy Reality.eth contract", async function () {
            const RealityFactory = await ethers.getContractFactory("FakeRealityETH");
            reality = await RealityFactory.deploy();
        })

        it("Deploy PrecogRealityOracleV3", async function () {
            const OracleFactory = await ethers.getContractFactory("PrecogRealityOracleV3");
            oracle = await OracleFactory.deploy(admin.address);

            // Add oracle reference on PrecogMaster
            await master.addAllowedOracle(await oracle.getAddress());
        })

        it("Set oracle configurations", async function () {
            await oracle.connect(admin).setPrecogMaster(await master.getAddress());
            await oracle.connect(admin).setReality(await reality.getAddress());
            await oracle.connect(admin).setArbitrator(ethers.ZeroAddress);
            await oracle.connect(admin).setMaxAnswerBond(ethers.parseEther('100'));

            // Master configurations
            // Set oracle of the market to PrecogRealityOracleV3
            await market.updateOracle(await oracle.getAddress());
            // Transfer ownership of market to PrecogMaster
            await market.transferOwnership(await master.getAddress());

            expect(await oracle.reality()).to.equal(await reality.getAddress());
            expect(await oracle.precogMaster()).to.equal(await master.getAddress());
            expect(await oracle.arbitrator()).to.equal(ethers.ZeroAddress);
            expect(await oracle.maxAnswerBond()).to.equal(ethers.parseEther('100'));
        })
    })

    describe("Oracle Management functions", function () {
        it("| Admin accounts can add/remove market reporters", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 4;
            // Check initial permissions
            const [isAdmin, isReporter] = await oracle.getAccountPermissions(marketReporter.address);
            const isMarketReporterBefore = await oracle.isMarketReporter(marketId, marketReporter.address);

            if (detailsEnabled) {
                console.log(`\t| Initial permissions: Admin=${isAdmin}, Reporter=${isReporter}`);
                console.log(`\t| Is Market Reporter before: ${isMarketReporterBefore} for market ${marketId}`);
                console.log(`\t| Adding market reporter ${marketReporter.address} for market ${marketId}`);
            }
            await oracle.connect(admin).addMarketReporter(marketId, marketReporter.address);
            const isMarketReporterAfter = await oracle.isMarketReporter(marketId, marketReporter.address);

            if (detailsEnabled) {
                console.log(`\t| Is Market Reporter after: ${isMarketReporterAfter} for market ${marketId}`);
                console.log(`\t| Removing market reporter ${marketReporter.address} for market ${marketId}`);
            }
            await oracle.connect(admin).removeMarketReporter(marketId, marketReporter.address);
            const isMarketReporterRemoved = await oracle.isMarketReporter(marketId, marketReporter.address);

            // Add the Market Reporter for the upcoming tests
            await oracle.connect(admin).addMarketReporter(marketId, marketReporter.address);
            if (detailsEnabled) {
                console.log(`\t| Market Reporter added: ${marketReporter.address}`);
            }

            expect(isMarketReporterBefore).to.equal(false);
            expect(isMarketReporterAfter).to.equal(true);
            expect(isMarketReporterRemoved).to.equal(false);
        })

        it("| Admin accounts can add/remove global reporters", async function () {
            // Check initial permissions
            let [isAdmin, isReporter] = await oracle.getAccountPermissions(user.address);
            const isReporterBefore = await oracle.hasRole(await oracle.REPORTER_ROLE(), user.address);

            if (detailsEnabled) {
                console.log("");
                console.log(`\t| Initial permissions: Admin=${isAdmin}, Reporter=${isReporter}`);
                console.log(`\t| Is Reporter before: ${isReporterBefore} for user ${user.address}`);
                console.log(`\t| Adding global reporter: ${user.address}`);
            }
            await oracle.connect(admin).addReporter(user.address);
            const isReporterAfter = await oracle.hasRole(await oracle.REPORTER_ROLE(), user.address);
            [isAdmin, isReporter] = await oracle.getAccountPermissions(user.address);

            if (detailsEnabled) {
                console.log(`\t| Permissions after adding reporter: Admin=${isAdmin}, Reporter=${isReporter}`);
                console.log(`\t| Is Reporter after: ${isReporterAfter} for user ${user.address}`);
                console.log(`\t| Removing global reporter: ${user.address}`);
            }
            await oracle.connect(admin).removeReporter(user.address);
            const isReporterRemoved = await oracle.hasRole(await oracle.REPORTER_ROLE(), user.address);
            [isAdmin, isReporter] = await oracle.getAccountPermissions(user.address);

            // Add the Global Reporter for the upcoming tests
            await oracle.connect(admin).addReporter(globalReporter.address);
            if (detailsEnabled) {
                console.log(`\t| Global Reporter added: ${globalReporter.address}`);
                console.log(`\t| Final permissions: Admin=${isAdmin}, Reporter=${isReporter}`);
            }

            expect(isReporterBefore).to.equal(false);
            expect(isReporterAfter).to.equal(true);
            expect(isReporterRemoved).to.equal(false);
        })

        it("| Admin accounts can add/remove admins", async function () {
            // Check initial permissions
            let [isAdmin, isReporter] = await oracle.getAccountPermissions(user.address);
            const isAdminBefore = await oracle.hasRole(await oracle.ADMIN_ROLE(), user.address);

            if (detailsEnabled) {
                console.log("");
                console.log(`\t| Initial permissions: Admin=${isAdmin}, Reporter=${isReporter}`);
                console.log(`\t| Is Admin before: ${isAdminBefore} for user ${user.address}`);
                console.log(`\t| Adding admin: ${user.address}`);
            }

            await oracle.connect(admin).addAdmin(user.address);
            const isAdminAfter = await oracle.hasRole(await oracle.ADMIN_ROLE(), user.address);
            [isAdmin, isReporter] = await oracle.getAccountPermissions(user.address);

            if (detailsEnabled) {
                console.log(`\t| Permissions after adding admin: Admin=${isAdmin}, Reporter=${isReporter}`);
                console.log(`\t| Is Admin after: ${isAdminAfter} for user ${user.address}`);
                console.log(`\t| Removing admin: ${user.address}`);
            }

            await oracle.connect(admin).removeAdmin(user.address);
            const isAdminRemoved = await oracle.hasRole(await oracle.ADMIN_ROLE(), user.address);
            [isAdmin, isReporter] = await oracle.getAccountPermissions(user.address);

            if (detailsEnabled) {
                console.log(`\t| Final permissions: Admin=${isAdmin}, Reporter=${isReporter}`);
            }

            expect(isAdminBefore).to.equal(false);
            expect(isAdminAfter).to.equal(true);
            expect(isAdminRemoved).to.equal(false);
        })
    })

    describe("Access functions", function () {
        it("| Admin accounts can't use 'onlyGlobalReporter' functions", async function () {
            const marketId = 0;
            const marketAddress = ethers.ZeroAddress;
            const initialReporters: string[] = [];
            if (detailsEnabled) {
                console.log("");
                console.log(`\t| Admin: ${admin.address}`);
            }
            const call = oracle.connect(admin).registerMarket(marketId, marketAddress, initialReporters);
            await expect(call).to.be.revertedWith("Only Reporter");
        })

        it("| Admin accounts can't use 'onlyMarketReporter' functions", async function () {
            const marketId = 0;
            const answer = ethers.ZeroHash;
            const maxPrevious = ethers.parseEther('0');
            const bond = ethers.parseEther('1');
            if (detailsEnabled) {
                console.log("");
                console.log(`\t| Admin: ${admin.address}`);
            }
            const call = oracle.connect(admin).answerOpenQuestion(marketId, answer, maxPrevious, bond);
            await expect(call).to.be.revertedWith("Only Market Reporter");
        })

        it("| Reporter accounts can't use 'onlyAdmin' functions", async function () {
            if (detailsEnabled) {
                console.log("");
                console.log(`\t| User: ${user.address}`);
            }
            const call = oracle.connect(globalReporter).addAdmin(user);
            await expect(call).to.be.revertedWith("Only Admin");
        })

        it("| Market Reporter accounts can't use 'onlyAdmin' functions", async function () {
            if (detailsEnabled) {
                console.log("");
                console.log(`\t| Reporter: ${globalReporter.address}`);
            }
            const call = oracle.connect(marketReporter).addAdmin(user);
            await expect(call).to.be.revertedWith("Only Admin");
        })

        it("| Market Reporter accounts can't use 'onlyGlobalReporter' functions", async function () {
            const marketId = 4;
            if (detailsEnabled) {
                console.log("");
                console.log(`\t| Market Reporter: ${marketReporter.address}`);
            }
            const call = oracle.connect(marketReporter).reportResult(marketId);
            await expect(call).to.be.revertedWith("Only Reporter");
        })

        it("| Random accounts can't use 'onlyAdmin' functions", async function () {
            if (detailsEnabled) {
                console.log("");
                console.log(`\t| User: ${user.address}`);
            }

            await expect(oracle.connect(globalReporter).addAdmin(user)).to.be.revertedWith("Only Admin");
            await expect(oracle.connect(marketReporter).addAdmin(user)).to.be.revertedWith("Only Admin");
            await expect(oracle.connect(user).addAdmin(user)).to.be.revertedWith("Only Admin");
        })

        it("| Random accounts can't use 'onlyGlobalReporter' functions", async function () {
            const marketId = 0;
            const marketAddress = ethers.ZeroAddress;
            const initialReporters: string[] = [];
            if (detailsEnabled) {
                console.log("");
                console.log(`\t| User: ${user.address}`);
            }

            const registerMarket = (signer: HardhatEthersSigner) => {
                return oracle.connect(signer).registerMarket(marketId, marketAddress, initialReporters);
            }

            await expect(registerMarket(admin)).to.be.revertedWith("Only Reporter");
            await expect(registerMarket(marketReporter)).to.be.revertedWith("Only Reporter");
            await expect(registerMarket(user)).to.be.revertedWith("Only Reporter");
        })

        it("| Random accounts can't use 'onlyMarketReporter' functions", async function () {
            const marketId = 0;
            const answer = ethers.ZeroHash;
            const maxPrevious = ethers.parseEther('0');
            const bond = ethers.parseEther('1');
            if (detailsEnabled) {
                console.log("");
                console.log(`\t| User: ${user.address}`);
            }

            const answerQuestion = (signer: HardhatEthersSigner) => {
                return oracle.connect(signer).answerOpenQuestion(marketId, answer, maxPrevious, bond);
            }

            await expect(answerQuestion(admin)).to.be.revertedWith("Only Market Reporter");
            await expect(answerQuestion(marketReporter)).to.be.revertedWith("Only Market Reporter");
            await expect(answerQuestion(user)).to.be.revertedWith("Only Market Reporter");
        })
    })

    describe("Market Registration functions", function () {
        it("| Reporter accounts can register a Market on the Oracle", async function () {
            if (detailsEnabled) console.log("");

            const marketId: number = 0;
            const question: string = 'What is the capital of France?';
            const resolutionCriteria: string = 'Market to determine the capital city of France';
            const imageURL: string = 'https://ipfs.io/ipfs/test123';
            const category: string = 'CRYPTO';
            const outcomes: string[] = ['Paris', 'London'];
            const startTimestamp: number = await getCurrentBlockTimestamp();
            const endTimestamp: number = startTimestamp + 300;  // 5 min market
            const funding = ethers.parseEther('1000');
            const overround: number = outcomes.length * 100;
            const creator: string = admin.address;
            const collateralToken: string = await pre.getAddress();
            const collateralFunder: string = caller.address;
            const marketOracle: string = await oracle.getAddress();
            const marketSellFeeFactor: number = 100_000; // 0.001% (sellFee=1/sellFeeFactor)
            const initialReporters: string[] = [marketReporter.address];

            // Approve PrecogMaster to use Market operator funding
            await pre.connect(caller).approve(await master.getAddress(), funding);

            // Send market creation tx
            const emptyAddress: string = "0x0000000000000000000000000000000000000000";
            const marketData = {
                question: question, resolutionCriteria: resolutionCriteria, imageURL: imageURL, category: category,
                outcomes: outcomes.join(','), creator: creator, operator: emptyAddress, market: emptyAddress,
                startTimestamp: startTimestamp, endTimestamp: endTimestamp, collateral: collateralToken,
            };
            const marketConfig = {
                oracle: marketOracle, totalOutcomes: outcomes.length, liquidity: funding, overround: overround,
                sellFeeFactor: marketSellFeeFactor, collateralFunding: funding, collateralFunder: collateralFunder
            };
            await master.connect(caller).createMarket(marketData, marketConfig);

            const createdMarket: any[] = await master.markets(marketId);
            const marketAddress = createdMarket[7];

            if (detailsEnabled) {
                console.log(`\t| Registering Market Id: ${marketId}`);
                console.log(`\t| Market Address: ${marketAddress}`);
            }
            await oracle.connect(globalReporter).registerMarket(marketId, marketAddress, initialReporters);

            // Setup for later test:
            // We buy different outcomes for admin, marketReporter and user to test behavior
            // - Admin buys Paris (will be losing outcome, will redeem nothing)
            // - MarketReporter buys London (will be winning outcome, will redeem 1 PRE)
            // - User buys and sells London (will redeem nothing)

            // Get market contract instance
            const PrecogMarket = await ethers.getContractFactory("PrecogMarketV8");
            const marketContract = PrecogMarket.attach(marketAddress) as PrecogMarketV8;

            // Approve market to spend PRE tokens
            await pre.connect(admin).approve(marketAddress, ethers.parseEther('2000'));
            await pre.connect(marketReporter).approve(marketAddress, ethers.parseEther('2000'));
            await pre.connect(user).approve(marketAddress, ethers.parseEther('1'));
            // Define the outcomes and shares
            const losingOutcome = 1; // Paris outcome
            const winningOutcome = 2; // London outcome
            const shares = 1;
            const sharesInt128 = fromNumberToInt128(shares);
            const maxBuyCost = ethers.parseEther(`${shares}`);
            const minSellReturn = 0;

            // Buy shares for admin
            const adminBalanceBefore = await pre.balanceOf(admin.address);
            await marketContract.connect(admin).buy(losingOutcome, sharesInt128, maxBuyCost);
            const adminBalanceAfter = await pre.balanceOf(admin.address);
            const adminCost = ethers.formatEther(adminBalanceBefore - adminBalanceAfter);

            // Buy shares for marketReporter
            const reporterBalanceBefore = await pre.balanceOf(marketReporter.address);
            await marketContract.connect(marketReporter).buy(winningOutcome, sharesInt128, maxBuyCost);
            const reporterBalanceAfter = await pre.balanceOf(marketReporter.address);
            const reporterCost = ethers.formatEther(reporterBalanceBefore - reporterBalanceAfter);

            // Buy and sell shares for user
            await marketContract.connect(user).buy(losingOutcome, sharesInt128, maxBuyCost);
            await marketContract.connect(user).sell(losingOutcome, sharesInt128, minSellReturn);

            if (detailsEnabled) {
                console.log(`\t| Admin bought ${shares} shares for ${losingOutcome}, cost: ${adminCost} PRE`);
                console.log(`\t| Reporter bought ${shares} shares for ${winningOutcome}, cost: ${reporterCost} PRE`);
            }

            // Finally, get the market state
            const [isRegistered, isAnswered, isFinalized, isReported] = await oracle.getMarketState(marketId);
            if (detailsEnabled) {
                const expectedState = isRegistered && !isAnswered && !isFinalized && !isReported;
                console.log(`\t| Market should only be registered: ${expectedState}`);
            }

            const marketInfo = await oracle.markets(marketId);
            const isReporterRegistered = await oracle.marketReporters(marketId, initialReporters[0]);

            // Check the market state, to ensure it is registered, but not answered, finalized or reported
            expect(isRegistered).to.be.equal(true);
            expect(isAnswered).to.be.equal(false);
            expect(isFinalized).to.be.equal(false);
            expect(isReported).to.be.equal(false);
            // Check the market address and reporter registration
            expect(marketInfo.market).to.equal(marketAddress);
            expect(isReporterRegistered).to.be.equal(true);
        })

        it("| Nobody can register an already registered market", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 0;
            const marketAddress = await market.getAddress();
            const initialReporters: string[] = [];
            if (detailsEnabled) {
                console.log(`\t| Attempting to re-register market ${marketId}`);
            }
            const registerMarket = (signer: HardhatEthersSigner) => {
                return oracle.connect(signer).registerMarket(marketId, marketAddress, initialReporters);
            }

            await expect(registerMarket(admin)).to.be.revertedWith("Only Reporter");
            await expect(registerMarket(marketReporter)).to.be.revertedWith("Only Reporter");
            await expect(registerMarket(user)).to.be.revertedWith("Only Reporter");
            await expect(registerMarket(globalReporter)).to.be.revertedWith("Already register market");
        })

        it("| Admin accounts can unregister an already registered market", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 0;
            const marketInfo = await oracle.markets(marketId);
            const marketAddress = marketInfo[0];

            const marketState: boolean[] = await oracle.getMarketState(marketId);
            const isRegistered: boolean = marketState[0];

            if (detailsEnabled) {
                console.log(`\t| Checking state market id: ${marketId}`);
                console.log(`\t|   Market Address: ${marketAddress}`);
                console.log(`\t|   Is registered? ${isRegistered}`);
            }

            // Unregistered market
            await oracle.connect(admin).unregisterMarket(marketId, marketAddress);

            const newMarketState: boolean[] = await oracle.getMarketState(marketId);
            const newIsRegistered: boolean = newMarketState[0];
            expect(newIsRegistered).to.be.equal(false);

            if (detailsEnabled) {
                console.log(`\t|   Was unregistered? ${!newIsRegistered}`);
            }

            // Register again unregistered market
            await oracle.connect(globalReporter).registerMarket(marketId, marketAddress, []);
        })
    })

    describe("Reality.eth Question functions", function () {
        it("| Reporter accounts can open questions on Reality without registering a market", async function () {
            if (detailsEnabled) console.log("");
            const bounty: bigint = ethers.parseEther('1');
            const templateId: number = 2;
            const question: string = "What is the capital of France?";
            const outcomes: string[] = ["Paris", "London"];
            const category: string = "CRYPTO";
            const timeout: number = 10;
            const startTime: number = 1000;
            const nonce: bigint = 0n;
            const minBond: bigint = 0n;
            const tx = await oracle.connect(globalReporter).realityOpenQuestion(
                bounty, templateId, question, outcomes, category, timeout, startTime, nonce, minBond, { value: bounty }
            );
            await tx.wait();
            // Get the questionId of the transaction, only a helper on FakeRealityETH
            const questionId = await reality.lastQuestionId();
            if (detailsEnabled) {
                console.log(`\t| Last Question ID: ${questionId}`);
            }
            expect(questionId).to.not.equal(ethers.ZeroHash);
            expect(await reality.getBounty(questionId)).to.equal(bounty);
            expect(await reality.getTimeout(questionId)).to.equal(timeout);
            expect(await reality.getBestAnswer(questionId)).to.equal(ethers.ZeroHash);
            expect(await reality.isFinalized(questionId)).to.equal(false);
        });

        it("| Reporter accounts can answer questions on Reality in name of another account", async function () {
            if (detailsEnabled) console.log("");
            const answer = '0x0000000000000000000000000000000000000000000000000000000000000001';
            // Get the questionId of the transaction, only a helper on FakeRealityETH (Set on the previous test)
            const questionId = await reality.lastQuestionId();
            const maxPrevious = ethers.parseEther('0');
            const bond = ethers.parseEther('0');
            const answerer = user.address;
            await oracle.connect(globalReporter).realitySubmitAnswerFor(bond, questionId, answer, maxPrevious, answerer);
            if (detailsEnabled) {
                console.log(`\t| Question ID: ${questionId}`);
                console.log(`\t| Answer: ${answer}`);
                console.log(`\t| Best Answer: ${await reality.getBestAnswer(questionId)}`);
                console.log(`\t| Is Finalized: ${await reality.isFinalized(questionId)}`);
            }
            expect(await reality.getBestAnswer(questionId)).to.equal(answer);
            expect(await reality.isFinalized(questionId)).to.equal(false);
        });

        it("| Market Reporter accounts can open questions on Reality", async function () {
            if (detailsEnabled) console.log("");
            const marketId: number = 0;
            const bounty: bigint = ethers.parseEther('100');
            const templateId: number = 2;
            const question: string = "What is the capital of France?";
            const outcomes: string[] = ["Paris", "London"];
            const category: string = "CRYPTO";
            const timeout: number = 10;
            const startTime: number = await getCurrentBlockTimestamp();
            if (detailsEnabled) {
                console.log(`\t| Opening Question for Market Id: ${marketId}`);
                console.log(`\t| Question: "${question}"`);
            }

            await oracle.connect(marketReporter).openQuestion(
                marketId, bounty, templateId, question, outcomes, category, timeout, startTime, { value: bounty }
            );

            const marketInfo = await oracle.markets(marketId);
            const realityInfo = await oracle.getRealityQuestionInfo(marketId);

            if (detailsEnabled) {
                console.log(`\t| Question ID: ${marketInfo.questionId}`);
                console.log(`\t| Outcomes: ${marketInfo.outcomes}`);
                console.log(`\t| Opening Time: ${realityInfo.openingTS}`);
                console.log(`\t| Timeout: ${realityInfo.timeout}`);
                console.log(`\t| Bounty: ${ethers.formatEther(realityInfo.bounty)} ETH`);
            }

            expect(marketInfo.questionId).to.not.equal(ethers.ZeroHash);
            expect(marketInfo.questionId).to.equal(realityInfo.questionId);
            expect(marketInfo.outcomes).to.equal(outcomes.join(","));
            expect(realityInfo.timeout).to.equal(timeout);
            expect(realityInfo.bounty).to.equal(bounty);
        })

        it("| Market Reporter accounts can answer open questions on Reality (sending value)", async function () {
            if (detailsEnabled) console.log("");
            const marketId: number = 0;
            const answer: string = "0x0000000000000000000000000000000000000000000000000000000000000001"
            const maxPrevious: bigint = ethers.parseEther('0');
            const bond: bigint = await oracle.maxAnswerBond();
            if (detailsEnabled) {
                console.log(`\t| Answering Question for Market Id: ${marketId}`);
                console.log(`\t| Answer: ${answer}`);
            }

            await oracle.connect(marketReporter).answerOpenQuestion(
                marketId, answer, maxPrevious, bond, { value: bond }
            );

            const realityInfo = await oracle.getRealityQuestionInfo(marketId);
            const marketInfo = await oracle.markets(marketId);
            const resultInfo = await oracle.getRealityResultInfo(marketId);
            const [isRegistered, isAnswered, isFinalized, isReported] = await oracle.getMarketState(marketId);

            if (detailsEnabled) {
                console.log(`\t| Question ID: ${marketInfo.questionId}`);
                console.log(`\t| Outcomes: ${marketInfo.outcomes}`);
                console.log(`\t| Opening Time: ${realityInfo.openingTS}`);
                console.log(`\t| Timeout: ${realityInfo.timeout}`);
                console.log(`\t| Bounty: ${ethers.formatEther(realityInfo.bounty)} ETH`);
                console.log(`\t| Current Answer: ${resultInfo.answer}`);
                const expectedState = isRegistered && isAnswered && !isFinalized && !isReported;
                console.log(`\t| Market should be registered and answered, not finalized/reported: ${expectedState}`);
            }
            // Check the market info and current answer
            expect(marketInfo.answered).to.be.true;
            expect(resultInfo.answer).to.equal(answer);
            // Check the market state
            expect(isRegistered).to.be.true;
            expect(isAnswered).to.be.true;
            expect(isFinalized).to.be.false;
            expect(isReported).to.be.false;
        })

        it("| Market Reporter accounts can open & answer question (sending value)", async function () {
            if (detailsEnabled) console.log("");
            const marketId: number = 3;
            const bond: bigint = await oracle.maxAnswerBond();
            const templateId: number = 2;
            const question: string = "What is the capital of France?";
            const outcomes: string[] = ["Paris", "London"];
            const category: string = "CRYPTO";
            const timeout: number = 300;
            const answer: string = "0x0000000000000000000000000000000000000000000000000000000000000001"
            const startTime: number = await getCurrentBlockTimestamp();

            // First register the market
            const marketAddress: string = await market.getAddress();
            const initialReporters: string[] = [marketReporter.address];
            await oracle.connect(globalReporter).registerMarket(marketId, marketAddress, initialReporters);

            if (detailsEnabled) {
                console.log(`\t| Submitting Result for Market Id: ${marketId} by Market Reporter`);
                console.log(`\t| Question: "${question}", Answer: ${answer}`);
            }
            // Then submit the result
            await oracle.connect(marketReporter).submitResult(
                marketId, templateId, question, outcomes, category, timeout, startTime, answer, bond, { value: bond }
            );

            const marketInfo = await oracle.markets(marketId);
            const realityInfo = await oracle.getRealityQuestionInfo(marketId);
            const resultInfo = await oracle.getRealityResultInfo(marketId);
            expect(marketInfo.questionId).to.not.equal(ethers.ZeroHash);
            expect(marketInfo.answered).to.be.true;
            expect(realityInfo.timeout).to.equal(timeout);
            expect(realityInfo.bounty).to.equal(0);
            expect(marketInfo.answered).to.be.true;
            expect(resultInfo.answer).to.equal(answer);
        })

        it("| Market Reporter accounts can answer a question (using contract funds)", async function () {
            if (detailsEnabled) console.log("");
            const marketId: number = 5;

            // Register the market and open a question first
            const marketAddress: string = await market.getAddress();
            const initialReporters: string[] = [marketReporter.address];
            // Register the market as a Global Reporter
            await oracle.connect(globalReporter).registerMarket(marketId, marketAddress, initialReporters);

            const bounty: bigint = ethers.parseEther('0');
            const maxPrevious = ethers.parseEther('0');
            const answer: string = "0x0000000000000000000000000000000000000000000000000000000000000001"
            const templateId: number = 2;
            const question: string = "Test question for internal bond?";
            const outcomes: string[] = ["YES", "NO"];
            const category: string = "TEST";
            const timeout: number = 10;
            const startTime: number = await getCurrentBlockTimestamp();
            // Open a question as a Market Reporter
            await oracle.connect(marketReporter).openQuestion(
                marketId, bounty, templateId, question, outcomes, category, timeout, startTime, { value: bounty }
            );

            // Set oracle balance to 100 ETH
            await ethers.provider.send(
                "hardhat_setBalance",
                [await oracle.getAddress(), ethers.toBeHex(ethers.parseEther('100'))]
            );

            // Get initial balances
            const reporterBalanceBefore = await ethers.provider.getBalance(globalReporter.address);
            const oracleBalanceBefore = await ethers.provider.getBalance(await oracle.getAddress());

            // Answer the question with 10 ETH bond
            const bondAmount = ethers.parseEther('10');
            if (detailsEnabled) {
                console.log(`\t| Answering question for market ${marketId}`);
                console.log(`\t| Using internal oracle bond of ${ethers.formatEther(bondAmount)} ETH`);
                console.log(`\t| Oracle balance before: ${ethers.formatEther(oracleBalanceBefore)} ETH`);
                console.log(`\t| Reporter balance before: ${ethers.formatEther(reporterBalanceBefore)} ETH`);
            }
            await oracle.connect(globalReporter).answerOpenQuestion(marketId, answer, maxPrevious, bondAmount);

            // Get final balances
            const reporterBalanceAfter = await ethers.provider.getBalance(globalReporter.address);
            const oracleBalanceAfter = await ethers.provider.getBalance(await oracle.getAddress());
            if (detailsEnabled) {
                console.log(`\t| Oracle balance after: ${ethers.formatEther(oracleBalanceAfter)} ETH`);
                console.log(`\t| Reporter balance after: ${ethers.formatEther(reporterBalanceAfter)} ETH`);
            }

            const marketInfo = await oracle.markets(marketId);
            const resultInfo = await oracle.getRealityResultInfo(marketId);
            expect(reporterBalanceBefore - reporterBalanceAfter).to.be.lt(ethers.parseEther('0.01'));
            expect(oracleBalanceAfter).to.equal(oracleBalanceBefore - bondAmount);
            expect(marketInfo.answered).to.be.true;
            expect(resultInfo.answer).to.equal(answer);
        });

        it("| Market Reporter accounts can open & answer question (using contract funds)", async function () {
            if (detailsEnabled) console.log("");
            const marketId: number = 6;
            const bond: bigint = ethers.parseEther('1');
            const templateId: number = 2;
            const question: string = "What is the capital of France?";
            const outcomes: string[] = ["Paris", "London"];
            const category: string = "CRYPTO";
            const timeout: number = 300;
            const answer: string = "0x0000000000000000000000000000000000000000000000000000000000000001";
            const startTime: number = await getCurrentBlockTimestamp();
            // First register the market
            const marketAddress: string = await market.getAddress();
            const initialReporters: string[] = [marketReporter.address];
            // The global reporter is the one to register the market
            await oracle.connect(globalReporter).registerMarket(marketId, marketAddress, initialReporters);
            const contractFundsBefore = await ethers.provider.getBalance(await oracle.getAddress());
            const reporterFundsBefore = await ethers.provider.getBalance(marketReporter.address);
            // Then submit the result
            await oracle.connect(marketReporter).submitResult(
                marketId, templateId, question, outcomes, category, timeout, startTime, answer, bond
            );
            const contractFundsAfter = await ethers.provider.getBalance(await oracle.getAddress());
            const reporterFundsAfter = await ethers.provider.getBalance(marketReporter.address);
            const marketInfo = await oracle.markets(marketId);
            const realityInfo = await oracle.getRealityQuestionInfo(marketId);
            const resultInfo = await oracle.getRealityResultInfo(marketId);
            const contractFundsDiff = contractFundsBefore - bond;
            if (detailsEnabled) {
                console.log(`\t| Contract funds before: ${ethers.formatEther(contractFundsBefore)} ETH`);
                console.log(`\t| Reporter funds before: ${ethers.formatEther(reporterFundsBefore)} ETH`);
                console.log(`\t| Contract funds after: ${ethers.formatEther(contractFundsAfter)} ETH`);
                console.log(`\t| Reporter funds after: ${ethers.formatEther(reporterFundsAfter)} ETH`);
                console.log(`\t| Question ID: ${marketInfo.questionId}`);
                console.log(`\t| Outcomes: ${marketInfo.outcomes}`);
                console.log(`\t| Current Answer: ${resultInfo.answer}`);
                console.log(`\t| Bond: ${ethers.formatEther(realityInfo.bond)} ETH`);
            }

            expect(contractFundsAfter).to.equal(contractFundsDiff);
            expect(reporterFundsAfter).to.be.lt(reporterFundsBefore);
            expect(marketInfo.questionId).to.not.equal(ethers.ZeroHash);
            expect(marketInfo.outcomes).to.equal(outcomes.join(","));
            expect(realityInfo.timeout).to.equal(timeout);
            expect(realityInfo.questionId).to.equal(marketInfo.questionId);
            expect(marketInfo.answered).to.be.true;
            expect(resultInfo.answer).to.equal(answer);
        })

        it("| Market Reporter accounts can't answer a question with bond higher than max", async function () {
            if (detailsEnabled) console.log("");
            const marketId: number = 4;
            // First register the market
            const marketAddress: string = await market.getAddress();
            const initialReporters: string[] = [marketReporter.address];
            await oracle.connect(globalReporter).registerMarket(marketId, marketAddress, initialReporters);
            // Then open the question
            const bounty: bigint = ethers.parseEther('100');
            const maxPrevious = ethers.parseEther('0');
            const templateId: number = 2;
            const question: string = "What is the capital of France?";
            const answer: string = "0x0000000000000000000000000000000000000000000000000000000000000001";
            const outcomes: string[] = ["Paris", "London"];
            const category: string = "CRYPTO";
            const timeout: number = 10;
            const startTime: number = await getCurrentBlockTimestamp();
            await oracle.connect(marketReporter).openQuestion(
                marketId, bounty, templateId, question, outcomes, category, timeout, startTime, { value: bounty }
            );
            const excessiveBond = ethers.parseEther('101');
            if (detailsEnabled) {
                console.log(`\t| Answering with bond ${ethers.formatEther(excessiveBond)} (too high)`);
            }
            // Then answer the question
            const answerCall = oracle.connect(marketReporter).answerOpenQuestion(
                marketId, answer, maxPrevious, excessiveBond
            );
            await expect(answerCall).to.be.revertedWith("Answer bond too high");
        })

        it("| Random accounts can't answer a question", async function () {
            if (detailsEnabled) console.log("");
            const bounty: bigint = ethers.parseEther('0.1');
            const templateId: number = 2;
            const question: string = "What is the capital of France?";
            const outcomes: string[] = ["Paris", "London"];
            const category: string = "CRYPTO";
            const timeout: number = 10;
            const startTime: number = 1000;
            const nonce: bigint = 0n;
            const minBond: bigint = 0n;

            if (detailsEnabled) {
                console.log(`\t| Attempting to open a question as other than Market Reporter`);
            }
            // Open a question as a random account
            const openRealityQuestion = (signer: HardhatEthersSigner) => {
                return oracle.connect(signer).realityOpenQuestion(
                    bounty, templateId, question, outcomes, category, timeout, startTime, nonce, minBond,
                    { value: bounty }
                );
            }
            // Check that only Market Reporter can open a question
            await expect(openRealityQuestion(admin)).to.be.revertedWith("Only Reporter");
            await expect(openRealityQuestion(marketReporter)).to.be.revertedWith("Only Reporter");
            await expect(openRealityQuestion(user)).to.be.revertedWith("Only Reporter");
        })

        it("| Random accounts can't submit an answer for another account", async function () {
            if (detailsEnabled) console.log("");
            const bond: bigint = ethers.parseEther('0');
            const questionId: string = ethers.ZeroHash; // Using a dummy question ID
            const answer: string = '0x0000000000000000000000000000000000000000000000000000000000000001';
            const maxPrevious: bigint = ethers.parseEther('0');
            const answerer: string = user.address;

            if (detailsEnabled) {
                console.log(`\t| Attempting to submit an answer for another account as other than Market Reporter`);
            }

            const submitAnswerFor = (signer: HardhatEthersSigner) => {
                return oracle.connect(signer).realitySubmitAnswerFor(
                    bond, questionId, answer, maxPrevious, answerer, { value: bond }
                );
            }

            await expect(submitAnswerFor(admin)).to.be.revertedWith("Only Reporter");
            await expect(submitAnswerFor(marketReporter)).to.be.revertedWith("Only Reporter");
            await expect(submitAnswerFor(user)).to.be.revertedWith("Only Reporter");
        })

        it("| Nobody can open a question for unregistered market", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 7;
            const bounty = ethers.parseEther('100');
            const templateId = 2;
            const question = "What is the capital of France?";
            const outcomes = ["Paris", "London"];
            const category = "CRYPTO";
            const timeout = 300;
            const startTime = await getCurrentBlockTimestamp();
            if (detailsEnabled) {
                console.log(`\t| Attempting to open question for unregistered market ${marketId}`);
            }
            const openMarketQuestion = (signer: HardhatEthersSigner) => {
                return oracle.connect(signer).openQuestion(
                    marketId, bounty, templateId, question, outcomes, category, timeout, startTime
                );
            }
            await expect(openMarketQuestion(admin)).to.be.revertedWith("Only Market Reporter");
            await expect(openMarketQuestion(globalReporter)).to.be.revertedWith("Market not registered");
            await expect(openMarketQuestion(marketReporter)).to.be.revertedWith("Only Market Reporter");
            await expect(openMarketQuestion(user)).to.be.revertedWith("Only Market Reporter");
        })

        it("| Nobody can open a question when question already exists", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 0;
            const bounty = ethers.parseEther('100');
            const templateId = 2;
            const question = "What is the capital of France?";
            const outcomes = ["Paris", "London"];
            const category = "CRYPTO";
            const timeout = 300;
            const startTime = 0;
            if (detailsEnabled) {
                console.log(`\t| Attempting to open question for market ${marketId} which already has one`);
            }
            const openMarketQuestion = (signer: HardhatEthersSigner) => {
                return oracle.connect(signer).openQuestion(
                    marketId, bounty, templateId, question, outcomes, category, timeout, startTime
                );
            }

            await expect(openMarketQuestion(admin)).to.be.revertedWith("Only Market Reporter");
            await expect(openMarketQuestion(globalReporter)).to.be.revertedWith("Question already open");
            await expect(openMarketQuestion(marketReporter)).to.be.revertedWith("Question already open");
            await expect(openMarketQuestion(user)).to.be.revertedWith("Only Market Reporter");
        })

        it("| Nobody can answer a question for unregistered market", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 7;
            const answer = ethers.ZeroHash;
            const maxPrevious = ethers.parseEther('0');
            const bond = ethers.parseEther('1');
            if (detailsEnabled) {
                console.log(`\t| Attempting to answer question for unregistered market ${marketId}`);
            }
            const answerQuestion = (signer: HardhatEthersSigner) => {
                return oracle.connect(signer).answerOpenQuestion(marketId, answer, maxPrevious, bond);
            }

            await expect(answerQuestion(admin)).to.be.revertedWith("Only Market Reporter");
            await expect(answerQuestion(globalReporter)).to.be.revertedWith("Market not registered");
            await expect(answerQuestion(marketReporter)).to.be.revertedWith("Only Market Reporter");
            await expect(answerQuestion(user)).to.be.revertedWith("Only Market Reporter");
        })

        it("| Nobody can answer an already answered question", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 0;
            const maxPrevious = ethers.parseEther('0');
            const answer = ethers.ZeroHash;
            const bond = ethers.parseEther('1');
            if (detailsEnabled) {
                console.log(`\t| Attempting to re-answer question for market ${marketId}`);
            }
            const answerQuestion = (signer: HardhatEthersSigner) => {
                return oracle.connect(signer).answerOpenQuestion(marketId, answer, maxPrevious, bond);
            }
            await expect(answerQuestion(admin)).to.be.revertedWith("Only Market Reporter");
            await expect(answerQuestion(globalReporter)).to.be.revertedWith("Market already answered");
            await expect(answerQuestion(marketReporter)).to.be.revertedWith("Market already answered");
            await expect(answerQuestion(user)).to.be.revertedWith("Only Market Reporter");
        })
    })

    describe("Reality.eth Result functions", function () {
        it("| Reporter accounts can report results for finalized questions", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 0;
            const questionInfo = await oracle.getRealityQuestionInfo(marketId);
            const questionId: string = questionInfo.questionId;
            await ethers.provider.send("evm_increaseTime", [400]);

            await reality.connect(globalReporter).setFinalized(questionId, true);
            await oracle.connect(globalReporter).reportResult(marketId);

            const resultInfo = await oracle.getRealityResultInfo(marketId);
            const [isRegistered, isAnswered, isFinalized, isReported] = await oracle.getMarketState(marketId);
            if (detailsEnabled) {
                console.log(`\t| Reporting Result for Market Id: ${marketId}`);
                console.log(`\t| Answer: ${resultInfo.answer}`);
                console.log(`\t| Finalize TS: ${resultInfo.finalizeTS}`);
                console.log(`\t| Last Hash: ${resultInfo.lastHash}`);
                console.log(`\t| Status: Finalized=${resultInfo.isFinalized}`);
                console.log(`\t| Pending Arbitration=${resultInfo.isPendingArbitration}`);
                const expectedState = isRegistered && isAnswered && isFinalized && isReported;
                console.log(`\t| Market should be in final state (all flags true): ${expectedState}`);
            }

            const marketInfo = await oracle.markets(marketId);
            // Check the market info and final result
            expect(marketInfo.resultIndex).to.equal(2);
            expect(marketInfo.resultLabel).to.equal("London");
            expect(resultInfo.isFinalized).to.be.true;
            expect(resultInfo.isPendingArbitration).to.be.false;
            // Check the market state
            expect(isRegistered).to.be.true;
            expect(isAnswered).to.be.true;
            expect(isFinalized).to.be.true;
            expect(isReported).to.be.true;
        })

        it("| Reporter accounts can claim winnings", async function () {
            if (detailsEnabled) console.log("");
            const marketId: number = 0;
            const questionInfo = await oracle.getRealityQuestionInfo(marketId);
            const questionId: string = questionInfo.questionId;
            const historyHashes: string[] = [ethers.ZeroHash];
            const answerers: string[] = [await oracle.getAddress()];
            const bonds: bigint[] = [questionInfo.bond];
            const balanceBefore = await reality.balanceOf(await oracle.getAddress());
            const answers: string[] = [ethers.ZeroHash]; // First option
            await oracle.connect(globalReporter).realityClaimWinnings(questionId, historyHashes, answerers, bonds, answers);
            // Manually set the balance of the oracle
            await reality.setBalance(await oracle.getAddress(), ethers.parseEther('100'));
            // Get the current balance of the oracle
            const balanceAfter = await reality.balanceOf(await oracle.getAddress());

            if (detailsEnabled) {
                console.log(`\t| Oracle Balance in Reality Before: ${ethers.formatEther(balanceBefore)} ETH`);
                console.log(`\t| Oracle Balance in Reality After: ${ethers.formatEther(balanceAfter)} ETH`);
            }

            expect(balanceAfter).to.equal(ethers.parseEther('100'));
        })

        it("| Reporter accounts can withdraw winnings from Reality to Oracle", async function () {
            if (detailsEnabled) console.log("");

            const oracleBalanceBefore = await ethers.provider.getBalance(await oracle.getAddress());
            const realityBalanceBefore = await reality.balanceOf(await oracle.getAddress());
            const reporterBalanceBefore = await ethers.provider.getBalance(globalReporter.address);

            await oracle.connect(globalReporter).realityWithdraw();

            const oracleBalanceAfter = await ethers.provider.getBalance(await oracle.getAddress());
            const realityBalanceAfter = await reality.balanceOf(await oracle.getAddress());
            const reporterBalanceAfter = await ethers.provider.getBalance(globalReporter.address);
            const reporterBalanceChange = reporterBalanceAfter - reporterBalanceBefore;

            if (detailsEnabled) {
                console.log(`\t| Oracle ETH balance before: ${ethers.formatEther(oracleBalanceBefore)} ETH`);
                console.log(`\t| Oracle ETH balance after: ${ethers.formatEther(oracleBalanceAfter)} ETH`);
                console.log(`\t| Reality.eth balance before: ${ethers.formatEther(realityBalanceBefore)} ETH`);
                console.log(`\t| Reality.eth balance after: ${ethers.formatEther(realityBalanceAfter)} ETH`);
                console.log(`\t| Reporter balance before: ${ethers.formatEther(reporterBalanceBefore)} ETH`);
                console.log(`\t| Reporter balance after: ${ethers.formatEther(reporterBalanceAfter)} ETH`);
                console.log(`\t| Reporter balance change: ${ethers.formatEther(reporterBalanceChange)} ETH`);
            }

            expect(realityBalanceAfter).to.equal(0n);
            expect(oracleBalanceAfter).to.be.gt(oracleBalanceBefore);
            expect(reporterBalanceAfter).to.be.lt(reporterBalanceBefore);
        })

        it("| Reporter accounts can't report results for unfinalized questions", async function () {
            if (detailsEnabled) console.log("");
            const marketId: number = 3;
            if (detailsEnabled) {
                console.log(`\t| Attempting to report result for unfinalized Market Id: ${marketId}`);
            }

            await expect(oracle.connect(globalReporter).reportResult(marketId)).to.be.revertedWith("Invalid question");
        })

        it("| Random accounts can't claim winnings", async function () {
            if (detailsEnabled) console.log("");
            const marketId: number = 3;
            const questionInfo = await oracle.getRealityQuestionInfo(marketId);
            const questionId: string = ethers.ZeroHash;
            const historyHashes: string[] = [ethers.ZeroHash];
            const answerers: string[] = [await oracle.getAddress()];
            const bonds: bigint[] = [questionInfo[4]];
            const answers: string[] = [ethers.ZeroHash]; // First option
            if (detailsEnabled) {
                console.log(`\t| Attempting to claim winnings for market: ${marketId}`);
            }

            // Set up reusable arguments and helper function for testing reality claim winnings
            const claimWinnings = (signer: HardhatEthersSigner) => {
                return oracle.connect(signer).realityClaimWinnings(
                    questionId, historyHashes, answerers, bonds, answers
                );
            }

            await expect(claimWinnings(admin)).to.be.revertedWith("Only Reporter");
            await expect(claimWinnings(marketReporter)).to.be.revertedWith("Only Reporter");
            await expect(claimWinnings(user)).to.be.revertedWith("Only Reporter");
        })

        it("| Random accounts can't withdraw winnings from Reality to Oracle", async function () {
            if (detailsEnabled) console.log("");
            if (detailsEnabled) {
                console.log(`\t| Attempting to withdraw winnings from Reality to Oracle`);
            }
            await expect(oracle.connect(admin).realityWithdraw()).to.be.revertedWith("Only Reporter");
            await expect(oracle.connect(marketReporter).realityWithdraw()).to.be.revertedWith("Only Reporter");
            await expect(oracle.connect(user).realityWithdraw()).to.be.revertedWith("Only Reporter");
        })

        it("| Reporter accounts can redeem shares from market", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 0;

            // Get initial balances
            const adminBalanceBefore = await pre.balanceOf(admin.address);
            const reporterBalanceBefore = await pre.balanceOf(marketReporter.address);
            const userBalanceBefore = await pre.balanceOf(user.address);
            if (detailsEnabled) {
                console.log(`\t| Admin balance before: ${ethers.formatEther(adminBalanceBefore)} PRE`);
                console.log(`\t| Reporter balance before: ${ethers.formatEther(reporterBalanceBefore)} PRE`);
                console.log(`\t| User balance before: ${ethers.formatEther(userBalanceBefore)} PRE`);
            }

            // Redeem shares in batch
            const accounts = [admin.address, marketReporter.address, user.address];
            if (detailsEnabled) {
                console.log(`\t| Redeeming in batch for Admin, MarketReporter and User`);
            }
            await expect(oracle.connect(globalReporter).marketRedeemBatch(marketId, accounts)).to.not.be.reverted;

            // Check that accounts received their PRE tokens back
            const adminFinalBalance = await pre.balanceOf(admin.address);
            const reporterFinalBalance = await pre.balanceOf(marketReporter.address);
            const userFinalBalance = await pre.balanceOf(user.address);

            if (detailsEnabled) {
                console.log(`\t| Admin final balance: ${ethers.formatEther(adminFinalBalance)} PRE`);
                console.log(`\t| Reporter final balance: ${ethers.formatEther(reporterFinalBalance)} PRE`);
                console.log(`\t| User final balance: ${ethers.formatEther(userFinalBalance)} PRE`);
            }

            // Admin should get nothing back (had losing shares)
            expect(adminFinalBalance).to.be.equal(adminBalanceBefore);

            // Reporter should get exactly 1 PRE back (had 1 winning share)
            const reporterDelta = reporterFinalBalance - reporterBalanceBefore;
            expect(ethers.formatEther(reporterDelta)).to.equal('1.0');

            // User should get nothing back (bought and sold shares)
            const userDelta = userFinalBalance - userBalanceBefore;
            expect(ethers.formatEther(userDelta)).to.equal('0.0');
            if (detailsEnabled) {
                console.log(`\t| Reporter balance increase: ${ethers.formatEther(reporterDelta)} PRE`);
            }
        })

        it("| Random accounts can't redeem shares from market", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 0;
            const accounts = [admin.address, marketReporter.address, user.address];
            // Set up reusable arguments and helper function for testing reality claim winnings
            const marketRedeemBatch = (signer: HardhatEthersSigner) => {
                return oracle.connect(signer).marketRedeemBatch(marketId, accounts);
            }
            if (detailsEnabled) {
                console.log(`\t| Attempting to redeem shares from market ${marketId}`);
            }
            await expect(marketRedeemBatch(admin)).to.be.revertedWith("Only Reporter");
            await expect(marketRedeemBatch(marketReporter)).to.be.revertedWith("Only Reporter");
            await expect(marketRedeemBatch(user)).to.be.revertedWith("Only Reporter");
        })
    })

    describe("Utility functions", function () {
        it("| Admin accounts can enable date updates on a market", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 0;
            const marketInfo: any[] = await oracle.markets(marketId);
            const marketAddress: string = marketInfo[0];

            const createdMarket: PrecogMarketV8 = await ethers.getContractAt('PrecogMarketV8', marketAddress);
            const createdMarketId: bigint = await createdMarket.id();
            const createdMarketDatesUpdateEnabled: boolean = await createdMarket.datesUpdateEnabled();

            const marketState: boolean[] = await oracle.getMarketState(marketId);
            const isRegistered: boolean = marketState[0];

            if (detailsEnabled) {
                console.log(`\t| Checking market state (id: ${marketId})`);
                console.log(`\t|   Market Address: ${marketAddress} (id: ${createdMarketId})`);
                console.log(`\t|   Is registered? ${isRegistered}`);
                console.log(`\t|   Dates Update Enabled? ${createdMarketDatesUpdateEnabled}`);
            }

            // Try to enable dates updates with any user
            const randomUserCall = oracle.connect(user).marketEnableDatesUpdate(marketId);
            await expect(randomUserCall).to.be.revertedWith("Only Reporter");

            // Try to enable dates with Oracle Admin
            await oracle.connect(globalReporter).marketEnableDatesUpdate(marketId);

            // Check new "dates update enable" state
            const createdMarketNewDatesUpdateEnabled: boolean = await createdMarket.datesUpdateEnabled();

            if (detailsEnabled) {
                console.log(`\t|   New Dates Update Enabled? ${createdMarketNewDatesUpdateEnabled}`);
            }

            expect(createdMarketDatesUpdateEnabled).to.be.equal(false);
            expect(createdMarketNewDatesUpdateEnabled).to.be.equal(true);
        })

        it("| Admin accounts can withdraw ETH from Oracle", async function () {
            if (detailsEnabled) console.log("");
            const oracleBalanceBefore = await ethers.provider.getBalance(await oracle.getAddress());
            const adminBalanceBefore = await ethers.provider.getBalance(admin.address);

            await oracle.connect(admin).withdraw(ethers.ZeroAddress);

            const oracleBalanceAfter = await ethers.provider.getBalance(await oracle.getAddress());
            const adminBalanceAfter = await ethers.provider.getBalance(admin.address);
            const adminBalanceIncrease = adminBalanceAfter - adminBalanceBefore;

            if (detailsEnabled) {
                console.log(`\t| Oracle balance before withdraw: ${ethers.formatEther(oracleBalanceBefore)} ETH`);
                console.log(`\t| Oracle balance after withdraw: ${ethers.formatEther(oracleBalanceAfter)} ETH`);
                console.log(`\t| Admin balance before withdraw: ${ethers.formatEther(adminBalanceBefore)} ETH`);
                console.log(`\t| Admin balance after withdraw: ${ethers.formatEther(adminBalanceAfter)} ETH`);
                console.log(`\t| Admin balance change: ${ethers.formatEther(adminBalanceIncrease)} ETH`);
            }

            expect(oracleBalanceAfter).to.equal(0n);
            expect(adminBalanceAfter).to.be.gt(adminBalanceBefore);
            expect(adminBalanceIncrease).to.be.closeTo(oracleBalanceBefore, ethers.parseEther('0.01'));
        })

        it("| Admin accounts can withdraw ERC20 balance from oracle", async function () {
            if (detailsEnabled) console.log("");

            const testAmount = ethers.parseEther('10');
            await pre.connect(admin).transfer(await oracle.getAddress(), testAmount);

            const oracleBalanceBefore = await pre.balanceOf(await oracle.getAddress());
            const adminBalanceBefore = await pre.balanceOf(admin.address);

            await oracle.connect(admin).withdraw(await pre.getAddress());

            const oracleBalanceAfter = await pre.balanceOf(await oracle.getAddress());
            const adminBalanceAfter = await pre.balanceOf(admin.address);
            const adminBalanceIncrease = adminBalanceAfter - adminBalanceBefore;

            if (detailsEnabled) {
                console.log(`\t| Oracle PRE balance before withdraw: ${ethers.formatEther(oracleBalanceBefore)} PRE`);
                console.log(`\t| Oracle PRE balance after withdraw: ${ethers.formatEther(oracleBalanceAfter)} PRE`);
                console.log(`\t| Admin PRE balance before withdraw: ${ethers.formatEther(adminBalanceBefore)} PRE`);
                console.log(`\t| Admin PRE balance after withdraw: ${ethers.formatEther(adminBalanceAfter)} PRE`);
                console.log(`\t| Admin PRE balance change: ${ethers.formatEther(adminBalanceIncrease)} PRE`);
            }

            expect(oracleBalanceAfter).to.equal(0n);
            expect(adminBalanceAfter).to.be.gt(adminBalanceBefore);
            expect(adminBalanceIncrease).to.equal(oracleBalanceBefore);
        })

        it("| Random accounts can check if market is registered", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 0;
            const isMarketRegistered = await oracle.connect(user).isMarketRegistered(marketId);
            if (detailsEnabled) {
                console.log(`\t| Checking if market ${marketId} is registered: ${isMarketRegistered}`);
            }
            expect(isMarketRegistered).to.equal(true);
        })

        it("| Random accounts can check if account is market reporter", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 0;
            const isMarketReporter = await oracle.connect(user).isMarketReporter(marketId, marketReporter.address);
            const isNotMarketReporter = await oracle.connect(user).isMarketReporter(marketId, user.address);
            if (detailsEnabled) {
                console.log(`\t| Address: ${marketReporter.address}`);
                console.log(`\t| Is reporter for market ${marketId}? ${isMarketReporter}`);
                console.log(`\t| Is not reporter for market ${marketId}? ${isNotMarketReporter}`);
            }
            expect(isMarketReporter).to.equal(true);
            expect(isNotMarketReporter).to.equal(false);
        })

        it("| Random accounts can get Reality balance", async function () {
            if (detailsEnabled) console.log("");
            const realityBalance = await oracle.connect(user).getRealityBalance();
            if (detailsEnabled) {
                console.log(`\t| Oracle balance on Reality: ${ethers.formatEther(realityBalance)}`);
            }
            expect(realityBalance).to.equal(ethers.parseEther('0'));
        })

        it("| Random accounts can get Reality question info", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 0;
            const realityQuestionInfo = await oracle.connect(user).getRealityQuestionInfo(marketId);
            if (detailsEnabled) {
                console.log(`\t| Reality Id for market ${marketId}: ${realityQuestionInfo.questionId}`);
            }
            expect(realityQuestionInfo.questionId).to.not.equal(ethers.ZeroHash);
        });

        it("| Random accounts can get Reality result info", async function () {
            if (detailsEnabled) console.log("");

            const marketId = 0;
            const realityResultInfo = await oracle.connect(user).getRealityResultInfo(marketId);

            if (detailsEnabled) {
                console.log(`\t| Reality final answer for market ${marketId}: ${realityResultInfo.answer}`);
            }

            expect(realityResultInfo.questionId).to.not.equal(ethers.ZeroHash);
        })

        it("| Oracle contract can receive ETH", async function () {
            if (detailsEnabled) console.log("");
            const balanceBefore = await ethers.provider.getBalance(await oracle.getAddress());

            // Admin sends ETH to the contract
            await admin.sendTransaction({
                to: await oracle.getAddress(),
                value: ethers.parseEther('1'),
            });

            const balanceAfter = await ethers.provider.getBalance(await oracle.getAddress());
            if (detailsEnabled) {
                console.log(`\t| Oracle balance before receive ETH: ${ethers.formatEther(balanceBefore)}`);
                console.log(`\t| Oracle balance after receive ETH: ${ethers.formatEther(balanceAfter)}`);
            }

            expect(balanceAfter).to.equal(balanceBefore + ethers.parseEther('1'));
        })
    })

    describe("Precog Basic Flow with custom collateral", function () {
        it("| Oracle registers the market in the Oracle contract", async function () {
            if (detailsEnabled) console.log("");
            const question: string = 'Which AI model will rank as the top performer this month?';
            const resolutionCriteria: string = 'Market will resolve based on the leaderboard rankings at lmarena.ai.';
            const imageURL: string = 'https://ipfs.io/ipfs/test123';
            const category: string = 'AI';
            const outcomes: string[] = ['Gemini', 'ChatGPT', 'Grok', 'Claude', 'DeepSeek', 'Other'];
            const startTimestamp: number = await getCurrentBlockTimestamp();
            const endTimestamp: number = startTimestamp + 300;  // 5 min market
            const funding = ethers.parseEther('1000');
            const overround: number = outcomes.length * 100;
            const creator: string = admin.address;
            const collateralToken: string = await dai.getAddress();
            const collateralFunder: string = caller.address;
            const marketOracle: string = await oracle.getAddress();
            const marketSellFeeFactor: number = 100_000; // 0.001% (sellFee=1/sellFeeFactor)

            // Approve PrecogMaster to use Market operator DAIs
            await dai.connect(caller).approve(await master.getAddress(), funding);

            // Send market creation tx
            const emptyAddress: string = "0x0000000000000000000000000000000000000000";
            const marketData = {
                question: question, resolutionCriteria: resolutionCriteria, imageURL: imageURL, category: category,
                outcomes: outcomes.join(','), creator: creator, operator: emptyAddress, market: emptyAddress,
                startTimestamp: startTimestamp, endTimestamp: endTimestamp, collateral: collateralToken,
            };
            const marketConfig = {
                oracle: marketOracle, totalOutcomes: outcomes.length, liquidity: funding, overround: overround,
                sellFeeFactor: marketSellFeeFactor, collateralFunding: funding, collateralFunder: collateralFunder
            };
            await master.connect(caller).createMarket(marketData, marketConfig);

            const marketId = 1;
            const marketInfo = await master.markets(marketId);
            const marketAddress = marketInfo.market;
            const initialReporters = [marketReporter.address];

            await oracle.connect(globalReporter).registerMarket(marketId, marketAddress, initialReporters);

            if (detailsEnabled) {
                console.log(`\t| Registering Market Id: ${marketId}`);
                console.log(`\t| Market Address: ${marketAddress}`);
                console.log(`\t| Initial Reporters: ${initialReporters}`);
            }

            // Get market registration info from oracle
            const isMarketRegistered = await oracle.isMarketRegistered(marketId);
            const oracleMarketInfo = await oracle.markets(marketId);
            const isReporterRegistered = await oracle.marketReporters(marketId, initialReporters[0]);

            if (detailsEnabled) {
                console.log(`\t| Is Market Registered: ${isMarketRegistered}`);
                console.log(`\t| Is Reporter Registered: ${isReporterRegistered}`);
                console.log(`\t| Market Address in Oracle: ${oracleMarketInfo.market}`);
                console.log(`\t| Question ID: ${oracleMarketInfo.questionId}`);
                console.log(`\t| Answered: ${oracleMarketInfo.answered}`);
                console.log(`\t| Result Index: ${oracleMarketInfo.resultIndex}`);
                console.log(`\t| Result Label: ${oracleMarketInfo.resultLabel}`);
            }

            expect(isMarketRegistered).to.be.true;
            expect(oracleMarketInfo.market).to.equal(marketAddress);
            expect(isReporterRegistered).to.be.true;
            expect(oracleMarketInfo.questionId).to.equal(ethers.ZeroHash);
            expect(oracleMarketInfo.answered).to.be.false;
            expect(oracleMarketInfo.resultIndex).to.equal(0n);
            expect(oracleMarketInfo.resultLabel).to.equal("");
        })

        it("| Reporter accounts can open the question on Reality.eth", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 1;
            const bounty = 0;
            const templateId = 2;
            const question = 'Which AI model will rank as the top performer this month?';
            const outcomes: string[] = ['Gemini', 'ChatGPT', 'Grok', 'Claude', 'DeepSeek', 'Other'];
            const category = 'AI';
            const timeout = 300;
            const startTime = await getCurrentBlockTimestamp();

            await oracle.connect(globalReporter).openQuestion(
                marketId, bounty, templateId, question, outcomes, category, timeout, startTime
            );

            if (detailsEnabled) {
                console.log(`\t| Opening Question for Market Id: ${marketId}`);
                console.log(`\t| Question: "${question}"`);
                console.log(`\t| Outcomes: ${outcomes}`);
                console.log(`\t| Category: ${category}`);
                console.log(`\t| Timeout: ${timeout}, Start Time: ${startTime}`);
            }

            const marketInfo = await oracle.markets(marketId);
            expect(marketInfo.questionId).to.not.equal(ethers.ZeroHash);
            expect(marketInfo.outcomes).to.equal(outcomes.join(','));
            expect(marketInfo.answered).to.be.false;
            expect(marketInfo.resultIndex).to.equal(0n);
            expect(marketInfo.resultLabel).to.equal("");
        })

        it("| Reporter accounts can answer the question on Reality.eth", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 1;
            const answer = '0x0000000000000000000000000000000000000000000000000000000000000002';  // 'Grok' index
            const maxPrevious = ethers.parseEther('0');
            const bond = ethers.parseEther('1');

            await oracle.connect(globalReporter).answerOpenQuestion(marketId, answer, maxPrevious, bond);

            const marketInfo = await oracle.markets(marketId);
            const resultInfo = await oracle.getRealityResultInfo(marketId);

            if (detailsEnabled) {
                console.log(`\t| Answering Question for Market Id: ${marketId}`);
                console.log(`\t| Submitted Answer: ${answer}`);
                console.log(`\t| Current Answer: ${resultInfo.answer}`);
                console.log(`\t| Outcomes: ${marketInfo.outcomes}`);
                console.log(`\t| Answered: ${marketInfo.answered}`);
                console.log(`\t| Result Index: ${marketInfo.resultIndex}`);
                console.log(`\t| Result Label: ${marketInfo.resultLabel}`);
                console.log(`\t| Max Previous: ${maxPrevious}`);
                console.log(`\t| Bond: ${ethers.formatEther(bond)} ETH`);
            }

            expect(marketInfo.answered).to.be.true;
            expect(marketInfo.resultIndex).to.equal(0n);
            expect(marketInfo.resultLabel).to.equal("");
            expect(resultInfo.answer).to.equal(answer);
            expect(resultInfo.isFinalized).to.be.false;
        })

        it("| Reporter accounts can report the result on Reality.eth", async function () {
            if (detailsEnabled) console.log("");
            const marketId = 1;
            const questionInfo = await oracle.getRealityQuestionInfo(marketId);
            const questionId: string = questionInfo.questionId;
            await ethers.provider.send('evm_increaseTime', [400]);
            await reality.connect(globalReporter).setFinalized(questionId, true);

            await oracle.connect(globalReporter).reportResult(marketId);

            const resultInfo = await oracle.getRealityResultInfo(marketId);
            if (detailsEnabled) {
                console.log(`\t| Reporting Result for Market Id: ${marketId}`);
                console.log(`\t| Answer: ${resultInfo.answer}`);
                console.log(`\t| Finalize TS: ${resultInfo.finalizeTS}`);
                console.log(`\t| Last Hash: ${resultInfo.lastHash}`);
                console.log(`\t| Status: Finalized=${resultInfo.isFinalized}`);
                console.log(`\t| Pending Arbitration=${resultInfo.isPendingArbitration}`);
            }

            const marketInfo = await oracle.markets(marketId);
            expect(marketInfo.resultIndex).to.equal(3);
            expect(marketInfo.resultLabel).to.equal('Grok');  // Answer sent on previous testcase
            expect(resultInfo.isFinalized).to.be.true;
            expect(resultInfo.isPendingArbitration).to.be.false;
        })

        it("| Reporter accounts can claim winnings on Reality.eth", async function () {
            if (detailsEnabled) console.log("");
            await ethers.provider.send('evm_increaseTime', [400]);
            const marketId: number = 1;
            const questionInfo = await oracle.getRealityQuestionInfo(marketId);
            const questionId: string = questionInfo.questionId;
            const historyHashes: string[] = [ethers.ZeroHash];
            const answerers: string[] = [await oracle.getAddress()];
            const bonds: bigint[] = [questionInfo.bond];
            const answers: string[] = ["0x0000000000000000000000000000000000000000000000000000000000000002"];
            const balanceBefore = await reality.balanceOf(await oracle.getAddress());

            await oracle.connect(globalReporter).realityClaimWinnings(questionId, historyHashes, answerers, bonds, answers);

            // Manually set the balance of the oracle
            await reality.setBalance(await oracle.getAddress(), ethers.parseEther('100'));
            const balanceAfter = await reality.balanceOf(await oracle.getAddress());
            if (detailsEnabled) {
                console.log(`\t| Oracle Balance in Reality Before: ${ethers.formatEther(balanceBefore)} ETH`);
                console.log(`\t| Oracle Balance in Reality After: ${ethers.formatEther(balanceAfter)} ETH`);
            }

            expect(balanceAfter).to.equal(ethers.parseEther('100'));
        })

        it("| Reporter accounts can withdraw winnings on Reality.eth", async function () {
            if (detailsEnabled) console.log("");

            const oracleBalanceBefore = await ethers.provider.getBalance(await oracle.getAddress());
            const realityBalanceBefore = await reality.balanceOf(await oracle.getAddress());
            const reporterBalanceBefore = await ethers.provider.getBalance(globalReporter.address);

            await oracle.connect(globalReporter).realityWithdraw();

            const oracleBalanceAfter = await ethers.provider.getBalance(await oracle.getAddress());
            const realityBalanceAfter = await reality.balanceOf(await oracle.getAddress());
            const reporterBalanceAfter = await ethers.provider.getBalance(globalReporter.address);
            const reporterBalanceChange = reporterBalanceAfter - reporterBalanceBefore;

            if (detailsEnabled) {
                console.log(`\t| Oracle ETH balance before: ${ethers.formatEther(oracleBalanceBefore)} ETH`);
                console.log(`\t| Oracle ETH balance after: ${ethers.formatEther(oracleBalanceAfter)} ETH`);
                console.log(`\t| Reality.eth balance before: ${ethers.formatEther(realityBalanceBefore)} ETH`);
                console.log(`\t| Reality.eth balance after: ${ethers.formatEther(realityBalanceAfter)} ETH`);
                console.log(`\t| Reporter balance before: ${ethers.formatEther(reporterBalanceBefore)} ETH`);
                console.log(`\t| Reporter balance after: ${ethers.formatEther(reporterBalanceAfter)} ETH`);
                console.log(`\t| Reporter balance change: ${ethers.formatEther(reporterBalanceChange)} ETH`);
            }

            expect(realityBalanceAfter).to.equal(0n);
            expect(oracleBalanceAfter).to.be.gt(oracleBalanceBefore);
            expect(reporterBalanceAfter).to.be.lt(reporterBalanceBefore);
        })

        it("| Admin accounts can withdraw all ETH balance from the oracle", async function () {
            if (detailsEnabled) console.log("");
            const oracleBalanceBefore = await ethers.provider.getBalance(await oracle.getAddress());
            const adminBalanceBefore = await ethers.provider.getBalance(admin.address);

            await oracle.connect(admin).withdraw(ethers.ZeroAddress);

            const adminBalanceAfter = await ethers.provider.getBalance(admin.address);
            const oracleBalanceAfter = await ethers.provider.getBalance(await oracle.getAddress());
            const adminBalanceIncrease = adminBalanceAfter - adminBalanceBefore;

            if (detailsEnabled) {
                console.log(`\t| Oracle ETH Balance Before: ${ethers.formatEther(oracleBalanceBefore)} ETH`);
                console.log(`\t| Oracle ETH Balance After: ${ethers.formatEther(oracleBalanceAfter)} ETH`);
                console.log(`\t| Withdrawing ETH Balance from Oracle`);
                console.log(`\t| Admin ETH Balance Before: ${ethers.formatEther(adminBalanceBefore)} ETH`);
                console.log(`\t| Admin ETH Balance After: ${ethers.formatEther(adminBalanceAfter)} ETH`);
            }
            expect(oracleBalanceAfter).to.equal(0n);
            expect(adminBalanceAfter).to.be.gt(adminBalanceBefore);
            expect(adminBalanceIncrease).to.be.closeTo(oracleBalanceBefore, ethers.parseEther('0.01'));
        })
    })
})
