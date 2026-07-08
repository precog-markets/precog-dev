import {expect} from "chai";
import {ethers} from "hardhat";
import {PrecogToken, PrecogMarketV7} from "../typechain-types";
import {HardhatEthersSigner} from "@nomicfoundation/hardhat-ethers/signers";
import {fromInt128toNumber, fromNumberToInt128, getMarketV7Alpha} from "../libs/helpers"
import {LSLMSR} from "../libs/markets";

describe("Precog Market V7", function () {
    const detailsEnabled: boolean = process.env.TEST_DETAILS === 'true';
    let pre: PrecogToken;
    let preAddress: string;
    let market: PrecogMarketV7;
    let marketAddress: string;
    let owner: HardhatEthersSigner;
    let caller: HardhatEthersSigner;
    let user: HardhatEthersSigner;
    let quadMarket: PrecogMarketV7;
    let quadMarketAddress: string;
    let localMarket: LSLMSR;

    beforeEach(async function () {
        [owner, caller, user] = await ethers.getSigners();
    })

    describe("Deployment", function () {
        it("PrecogToken contract deployed", async function () {
            const PRE = await ethers.getContractFactory("PrecogToken");
            const precogMaster: string = owner.address;
            pre = await PRE.deploy(precogMaster);
            preAddress = await pre.getAddress();
        })

        it("Mint PRE tokens for users", async function () {
            const initialSupply: bigint = ethers.parseEther('10000');
            await pre.mint(owner.address, initialSupply);
            await pre.mint(caller.address, initialSupply);
            await pre.mint(user.address, initialSupply);
            expect(await pre.balanceOf(owner.address)).to.equal(initialSupply);
            expect(await pre.balanceOf(caller.address)).to.equal(initialSupply);
            expect(await pre.balanceOf(user.address)).to.equal(initialSupply);
        })

        it("PrecogMarket contract deployed", async function () {
            const PrecogMarket = await ethers.getContractFactory("PrecogMarketV7");
            market = await PrecogMarket.deploy();
            marketAddress = await market.getAddress();
            await market.initialize(preAddress);
        })

        it("Approve PrecogMarket to spend users PRE tokens", async function () {
            const ownerBalance: bigint = await pre.balanceOf(owner.address);
            await pre.approve(marketAddress, ownerBalance);

            const callerBalance: bigint = await pre.balanceOf(caller.address);
            await pre.connect(caller).approve(marketAddress, callerBalance);

            const userBalance: bigint = await pre.balanceOf(user.address);
            await pre.connect(user).approve(marketAddress, userBalance);

            expect(await pre.allowance(owner.address, marketAddress)).to.equal(ownerBalance);
            expect(await pre.allowance(caller.address, marketAddress)).to.equal(callerBalance);
            expect(await pre.allowance(user.address, marketAddress)).to.equal(userBalance);
        })

        it("Setup a BINARY outcome Market", async function () {
            const ownerInitialBalance: bigint = await pre.balanceOf(owner.address);

            const marketId: number = 1;
            const totalOutcomes: number = 2;
            const initialShares = 2000;
            const subsidy: bigint = ethers.parseEther(initialShares.toString());
            const overround: number = 200;
            await market.setup(marketId, owner.address, totalOutcomes, subsidy, overround);

            // Checks about market initialization final costs and the initial supply needed
            const ownerFinalBalance: bigint = await pre.balanceOf(owner.address);
            expect(await pre.balanceOf(marketAddress)).to.equal(subsidy);
            expect(ownerFinalBalance).to.equal(ownerInitialBalance - subsidy);

            // Calculate initial Alpha
            const calculatedAlpha = (overround / 10000) / (totalOutcomes * Math.log(totalOutcomes));
            const calculatedBeta = (2000 * totalOutcomes) * calculatedAlpha;

            // Only for testing (making `alpha` & `beta` public variables)
            // const alphaInt128 = await market.alpha();
            // const alphaNumber = fromInt128toNumber(alphaInt128);
            // console.log('alphaPublic', alphaNumber);
            // const betaInt128 = await market.beta();
            // const betaNumber = fromInt128toNumber(betaInt128);
            // console.log('betaPublic', betaNumber);

            // Get initial Alpha & Beta from deployed Market
            // Dev Note: [slot 11: alpha and beta] earlier number variable get the last bytes when packing
            const alphaBetaSlot = 11;
            const rawValue = await ethers.provider.getStorage(marketAddress, alphaBetaSlot);
            const slotHex = rawValue.slice(2);  // Remove 0x prefix
            // console.log('slotHex', slotHex);

            const alphaHex = slotHex.slice(0, 32);
            const betaHex = slotHex.slice(32, 64);
            // console.log('alphaHex', alphaHex);
            // console.log('betaHex', betaHex);

            const betaBigInt = BigInt(`0x${betaHex}`);
            const alphaBigInt = BigInt(`0x${alphaHex}`);
            // console.log('alphaBigInt', alphaBigInt);
            // console.log('betaBigInt', betaBigInt);

            const marketBeta = fromInt128toNumber(betaBigInt);  // Convert to fixed-point 64.64 representation
            const marketAlpha = fromInt128toNumber(alphaBigInt);  // Convert to fixed-point 64.64 representation
            // console.log('alphaFixedPoint', marketAlpha);
            // console.log('betaFixedPoint', marketBeta);

            // Checks about initial Math calculation to ensure EVM floating point accuracy
            expect(calculatedAlpha).to.equal(marketAlpha);
            expect(calculatedBeta).to.equal(marketBeta);

            // Register local market (to make verification against local calculations)
            localMarket = new LSLMSR(['A', 'B'], marketAlpha, initialShares);
        })
    })

    describe("Check base market info and price functions", function () {
        it("| Checking initial market info", async function () {
            if (detailsEnabled) console.log("");
            const marketInfo: any[] = await market.getMarketInfo();
            const totalShares: number = fromInt128toNumber(marketInfo[0]);
            const outcomeOne: number = fromInt128toNumber(marketInfo[1][1]);
            const outcomeTwo: number = fromInt128toNumber(marketInfo[1][2]);
            const cost: number = fromInt128toNumber(marketInfo[2]);
            const totalBuys: bigint = marketInfo[3];
            const totalSells: number = marketInfo[4];
            if (detailsEnabled) {
                console.log(`\t| TotalShares: ${totalShares}, OutcomeOne: ${outcomeOne}, OutcomeTwo: ${outcomeTwo}`);
                console.log(`\t| TotalDeposited: ${cost}, totalBuys: ${totalBuys}, totalSells: ${totalSells}`);
            }
            expect(cost).to.equal(2040); // 2000 subsidy with 2% overround (aka market maker margin)
            expect(totalShares).to.equal(4000) // 2000 subsidy with 2 outcomes
        })

        it("| Checking buy prices math calculation", async function () {
            if (detailsEnabled) console.log("");
            const marketInfo: any[] = await market.getMarketInfo();
            const totalShares: number = fromInt128toNumber(marketInfo[0]);
            const outcomeOne: number = fromInt128toNumber(marketInfo[1][1]);
            const outcomeTwo: number = fromInt128toNumber(marketInfo[1][2]);
            const cost: number = fromInt128toNumber(marketInfo[2]);
            const shares: number[] = [0, outcomeOne, outcomeTwo];
            const alpha: number = await getMarketV7Alpha(marketAddress);

            if (detailsEnabled) {
                console.log(`\t| TotalShares: ${totalShares}, Shares: [${shares}]`);
                console.log(`\t| Current Cost: ${cost}, Alpha: ${alpha}`);
                console.log(`\t| Market Prices (on chain):`);
            }

            // Get all Buy prices from Market on-chain
            const buyPrices: any[] = [null, [], []];  // the first item is added just for simplicity
            const possibleOutcomes: number[] = [1, 2];
            const sharesAmounts: number[] = [1, 10, 100, 1000];
            for (const outcome of possibleOutcomes) {
                for (const amount of sharesAmounts) {
                    const sharesInt128: bigint = fromNumberToInt128(amount);
                    const priceInt128: bigint = await market.buyPrice(outcome, sharesInt128);
                    const price = fromInt128toNumber(priceInt128) / amount;
                    if (detailsEnabled) {
                        console.log(`\t|  Buy: outcome=${outcome}, amount=${amount} => ${price} collateral/share`);
                    }
                    buyPrices[outcome].push(price);
                }
            }

            if (detailsEnabled) {
                console.log(`\t| Market Prices (calculated locally):`);
            }

            // Calculate all Buy prices based on local calculation (with chain Shares balances and Alpha)
            const calculatedBuyPrices: any[] = [null, [], []];  // the first item is added just for simplicity
            for (const outcome of possibleOutcomes) {
                for (const amount of sharesAmounts) {
                    // Calculated price
                    // const cost = marketTradeCost(shares, alpha, outcome, amount);
                    // const price = cost / amount;
                    const outcomeLabel = localMarket.getOutcome(outcome);
                    const cost = localMarket.tradeCost(outcomeLabel, amount);
                    const price = cost / amount;
                    if (detailsEnabled) {
                        console.log(`\t|  Buy: outcome=${outcome}, amount=${amount} => ${price} collateral/share`);
                    }
                    calculatedBuyPrices[outcome].push(price);
                }
            }

            // Check that all calculated prices are in tolerance
            const priceTolerance = 0.0000000001;  // at lease 9 digits
            sharesAmounts.forEach((_, index) => {
                expect(buyPrices[1][index]).to.be.closeTo(calculatedBuyPrices[1][index], priceTolerance);
                expect(buyPrices[2][index]).to.be.closeTo(calculatedBuyPrices[2][index], priceTolerance);
            });
        })

        it("| Checking initial prices consistency at baseline", async function () {
            if (detailsEnabled) console.log("");
            const buyPrices: any[] = [null, [], []];  // the first item is added just for simplicity
            const sellPrices: any[] = [null, [], []];  // the first item is added just for simplicity
            const possibleOutcomes: number[] = [1, 2];
            const sharesAmounts: number[] = [1, 10, 100];
            for (const outcome of possibleOutcomes) {
                for (const shares of sharesAmounts) {
                    const sharesInt128: bigint = fromNumberToInt128(shares);
                    const priceInt128: bigint = await market.buyPrice(outcome, sharesInt128);
                    const price = fromInt128toNumber(priceInt128);
                    if (detailsEnabled) {
                        console.log(`\t|  Buy: outcome=${outcome}, amount=${shares} => ${price} [${priceInt128}]`);
                    }
                    buyPrices[outcome].push(price);
                }
            }
            for (const outcome of possibleOutcomes) {
                for (const shares of sharesAmounts) {
                    const sharesInt128: bigint = fromNumberToInt128(shares);
                    const priceInt128: bigint = await market.sellPrice(outcome, sharesInt128);
                    const price = fromInt128toNumber(priceInt128);
                    if (detailsEnabled) {
                        console.log(`\t| Sell: outcome=${outcome}, amount=${shares} => ${price} [${priceInt128}]`);
                    }
                    sellPrices[outcome].push(price);
                }
            }
            expect(buyPrices[1].toString()).to.equal(buyPrices[2].toString());
            expect(sellPrices[1].toString()).to.equal(sellPrices[2].toString());

            // Test prices using new V7 getter function
            const marketPrices: bigint[][] = await market.getPrices();
            const marketBuyPrices = marketPrices[0].map(value => Number(ethers.formatEther(value)));
            const marketSellPrices = marketPrices[1].map(value => Number(ethers.formatEther(value)));
            if (detailsEnabled) {
                console.log(`\t|  Fast Buy Prices: YES (${marketBuyPrices[1]}) - NO (${marketBuyPrices[2]})`);
                console.log(`\t| Fast Sell Prices: YES (${marketSellPrices[1]}) - NO (${marketSellPrices[2]})`);
            }
            expect(marketBuyPrices[1]).to.be.equal(buyPrices[1][0]);
            expect(marketBuyPrices[2]).to.be.equal(buyPrices[2][0]);
            expect(marketSellPrices[1]).to.be.equal(sellPrices[1][0]);
            expect(marketSellPrices[2]).to.be.equal(sellPrices[2][0]);
        })
    })

    describe("Test buy and sell shares functions", function () {
        it("| Trying to buy one YES share [outcome=1]", async function () {
            if (detailsEnabled) console.log("");
            const balanceBefore = await pre.balanceOf(owner.address);
            const outcome: number = 1;
            const shares: number = 1;
            const sharesInt128: bigint = fromNumberToInt128(shares);
            if (detailsEnabled) {
                console.log(`\t| Buying: outcome=${outcome}, shares=${shares} [${sharesInt128}]`);
            }
            const priceInt128: bigint = await market.buyPrice(outcome, sharesInt128);
            const price: number = fromInt128toNumber(priceInt128);
            await market.buy(outcome, sharesInt128);

            const balanceAfter = await pre.balanceOf(owner.address);
            const preCost = ethers.formatEther(balanceBefore - balanceAfter);
            if (detailsEnabled) {
                console.log(`\t| PRE: ${ethers.formatEther(balanceBefore)} -> ${ethers.formatEther(balanceAfter)}`);
                console.log(`\t| Buy cost: ${preCost}, Calculated Price: ${price}`);
            }
            expect(preCost.includes(price.toString()), "Cost do not match price");
            const ownerShares: any[] = await market.accountShares(owner.address);
            const outcomeBalances: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const outcomeOneShares: string = ethers.formatEther(outcomeBalances[1]);
            const outcomeTwoShares: string = ethers.formatEther(outcomeBalances[2]);
            const buys: bigint = ownerShares[0];
            const sells: bigint = ownerShares[1];
            const deposited: string = ethers.formatEther(ownerShares[2]);
            const withdrew: string = ethers.formatEther(ownerShares[3]);
            const redeemed: string = ethers.formatEther(ownerShares[4]);
            if (detailsEnabled) {
                console.log(`\t| Buys: ${buys}, Sells: ${sells}`);
                console.log(`\t| Deposited: ${deposited}, Withdrew: ${withdrew}, 'Redeemed': ${redeemed}`);
                console.log(`\t| Share balances: YES: ${outcomeOneShares}, NO: ${outcomeTwoShares}`);
            }
            expect(Number(buys)).be.equal(1);
            expect(Number(sells)).be.equal(0);
            expect(Number(outcomeOneShares)).be.equal(1);
            expect(Number(outcomeTwoShares)).be.equal(0);
        })

        it("| Checking current market info (after one buy)", async function () {
            if (detailsEnabled) console.log("");
            const marketInfo: any[] = await market.getMarketInfo();
            const totalShares: number = fromInt128toNumber(marketInfo[0]);
            const outcomeOne: number = fromInt128toNumber(marketInfo[1][1]);
            const outcomeTwo: number = fromInt128toNumber(marketInfo[1][2]);
            const cost: number = fromInt128toNumber(marketInfo[2]);
            const totalBuys: bigint = marketInfo[3];
            const totalSells: bigint = marketInfo[4];
            if (detailsEnabled) {
                console.log(`\t| TotalShares: ${totalShares}, YES: ${outcomeOne}, NO: ${outcomeTwo}`);
                console.log(`\t| TotalDeposited: ${cost}, totalBuys: ${totalBuys}, totalSells: ${totalSells}`);
            }
            expect(totalBuys).be.equal(1);
            expect(totalSells).be.equal(0);
        })

        it("| Trying to buy one NO share [outcome=2]", async function () {
            if (detailsEnabled) console.log("");
            const balanceBefore = await pre.balanceOf(owner.address);

            const outcome: number = 2;
            const shares: number = 1;
            const sharesInt128: bigint = fromNumberToInt128(shares);
            if (detailsEnabled) {
                console.log(`\t| Buying: outcome=${outcome}, amount=${shares} [${sharesInt128}]`);
            }
            const priceInt128: bigint = await market.buyPrice(outcome, sharesInt128);
            const price = fromInt128toNumber(priceInt128);
            await market.buy(outcome, sharesInt128);

            const balanceAfter = await pre.balanceOf(owner.address);
            const preCost = ethers.formatEther(balanceBefore - balanceAfter);
            if (detailsEnabled) {
                console.log(`\t| PRE: ${ethers.formatEther(balanceBefore)} -> ${ethers.formatEther(balanceAfter)}`);
                console.log(`\t| Buy cost: ${preCost}, Calculated Price: ${price}`);
            }
            expect(preCost.includes(price.toString()), "Cost do not match price");
            const ownerShares: bigint[] = await market.accountShares(owner.address);
            const outcomeBalances: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const outcomeOneShares: string = ethers.formatEther(outcomeBalances[1]);
            const outcomeTwoShares: string = ethers.formatEther(outcomeBalances[2]);
            const buys: bigint = ownerShares[0];
            const sells: bigint = ownerShares[1];
            const deposited: string = ethers.formatEther(ownerShares[2]);
            const withdrew: string = ethers.formatEther(ownerShares[3]);
            const redeemed: string = ethers.formatEther(ownerShares[4]);
            if (detailsEnabled) {
                console.log(`\t| Buys: ${buys}, Sells: ${sells}`);
                console.log(`\t| Deposited: ${deposited}, Withdrew: ${withdrew}, Redeemed: ${redeemed}`);
                console.log(`\t| Share balances: YES: ${outcomeOneShares}, NO: ${outcomeTwoShares}`);
            }
            expect(Number(buys)).be.equal(2);
            expect(Number(sells)).be.equal(0);
            expect(Number(outcomeOneShares)).be.equal(1);  // From a prior test
            expect(Number(outcomeTwoShares)).be.equal(1);  // From this test
        })

        it("| Checking current market info (after 2 buys)", async function () {
            if (detailsEnabled) console.log("");
            const marketInfo: any[] = await market.getMarketInfo();
            const totalShares: number = fromInt128toNumber(marketInfo[0]);
            const outcomeOne: number = fromInt128toNumber(marketInfo[1][1]);
            const outcomeTwo: number = fromInt128toNumber(marketInfo[1][2]);
            const cost: number = fromInt128toNumber(marketInfo[2]);
            const totalBuys = marketInfo[3];
            const totalSells = marketInfo[4];
            if (detailsEnabled) {
                console.log(`\t| TotalShares: ${totalShares}, YES: ${outcomeOne}, NO: ${outcomeTwo}`);
                console.log(`\t| TotalDeposited: ${cost}, totalBuys: ${totalBuys}, totalSells: ${totalSells}`);
            }
            expect(Number(totalBuys)).be.equal(2);
            expect(Number(totalSells)).be.equal(0);
        })

        it("| Buying 200 YES & NO shares from many sizes", async function () {
            if (detailsEnabled) console.log("");
            const initialCost: number = fromInt128toNumber(await market.cost());
            const initialPre: bigint = await pre.balanceOf(owner.address);

            const outcomeYes: number = 1;
            const outcomeNo: number = 2;
            const oneSharesInt128: bigint = fromNumberToInt128(1);
            const fiveSharesInt128: bigint = fromNumberToInt128(5);
            const tenSharesInt128: bigint = fromNumberToInt128(10);
            const fiftySharesInt128: bigint = fromNumberToInt128(50);
            const hundredSharesInt128: bigint = fromNumberToInt128(100);

            // Buying 199 shares of YES (note: 1 share it is already bought by the previous test case)
            await market.buy(outcomeYes, oneSharesInt128);
            await market.buy(outcomeYes, oneSharesInt128);
            await market.buy(outcomeYes, oneSharesInt128);
            await market.buy(outcomeYes, oneSharesInt128);
            await market.buy(outcomeYes, fiveSharesInt128);
            await market.buy(outcomeYes, tenSharesInt128);
            await market.buy(outcomeYes, tenSharesInt128);
            await market.buy(outcomeYes, tenSharesInt128);
            await market.buy(outcomeYes, tenSharesInt128);
            await market.buy(outcomeYes, fiftySharesInt128);
            await market.buy(outcomeYes, hundredSharesInt128);

            // Buying 199 shares of NO (note: 1 share it is already bought by the previous test case)
            await market.buy(outcomeNo, oneSharesInt128);
            await market.buy(outcomeNo, oneSharesInt128);
            await market.buy(outcomeNo, oneSharesInt128);
            await market.buy(outcomeNo, oneSharesInt128);
            await market.buy(outcomeNo, fiveSharesInt128);
            await market.buy(outcomeNo, tenSharesInt128);
            await market.buy(outcomeNo, tenSharesInt128);
            await market.buy(outcomeNo, tenSharesInt128);
            await market.buy(outcomeNo, tenSharesInt128);
            await market.buy(outcomeNo, fiftySharesInt128);
            await market.buy(outcomeNo, hundredSharesInt128);

            const finalCost: number = fromInt128toNumber(await market.cost());
            const finalPre: bigint = await pre.balanceOf(owner.address);
            if (detailsEnabled) {
                console.log(`\t| Cost: ${initialCost} -> ${finalCost}`);
                console.log(`\t| PRE: ${ethers.formatEther(initialPre)} -> ${ethers.formatEther(finalPre)}`);
            }
            const ownerShares: bigint[] = await market.accountShares(owner.address);
            const outcomeBalances: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const outcomeOneShares: string = ethers.formatEther(outcomeBalances[1]);
            const outcomeTwoShares: string = ethers.formatEther(outcomeBalances[2]);
            const buys: bigint = ownerShares[0];
            const sells: bigint = ownerShares[1];
            const deposited: string = ethers.formatEther(ownerShares[2]);
            const withdrew: string = ethers.formatEther(ownerShares[3]);
            const redeemed: string = ethers.formatEther(ownerShares[4]);
            if (detailsEnabled) {
                console.log(`\t| Buys: ${buys}, Sells: ${sells}`);
                console.log(`\t| Deposited: ${deposited}, Withdrew: ${withdrew}, Redeemed: ${redeemed}`);
                console.log(`\t| Share balances: YES: ${outcomeOneShares}, NO: ${outcomeTwoShares}`);
            }

            expect(Number(buys)).be.greaterThan(2);
            expect(Number(sells)).be.equal(0);
            expect(Number(outcomeOneShares)).be.equal(200);
            expect(Number(outcomeTwoShares)).be.equal(200);
        })

        it("| Trying to sell one YES share [outcome=1]", async function () {
            if (detailsEnabled) console.log("");
            const outcomeBalancesBefore: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const outcomeOneSharesBefore: string = ethers.formatEther(outcomeBalancesBefore[1]);
            const outcomeTwoSharesBefore: string = ethers.formatEther(outcomeBalancesBefore[2]);
            const balanceBefore = await pre.balanceOf(owner.address);

            const outcome: number = 1;
            const shares: number = 1;
            const sharesInt128: bigint = fromNumberToInt128(shares);
            const priceInt128: bigint = await market.sellPrice(outcome, sharesInt128);
            const expectedReturn: number = fromInt128toNumber(priceInt128);
            if (detailsEnabled) {
                console.log(`\t| Shares : 1-YES=${outcomeOneSharesBefore}, 2-NO=${outcomeTwoSharesBefore}`);
                console.log(`\t| Selling: outcome=${outcome}, shares=${shares} [${sharesInt128}]`);
                console.log(`\t|   Expected return: ${expectedReturn} PRE`);
            }
            await market.sell(outcome, sharesInt128);

            const ownerSharesAfter: bigint[] = await market.accountShares(owner.address);
            const outcomeBalancesAfter: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const balanceAfter: bigint = await pre.balanceOf(owner.address);
            const preReturn: string = ethers.formatEther(balanceAfter - balanceBefore);
            if (detailsEnabled) {
                console.log(`\t| After Sold return: ${preReturn} PRE`);
            }

            const outcomeOneSharesAfter: string = ethers.formatEther(outcomeBalancesAfter[1]);
            const outcomeTwoSharesAfter: string = ethers.formatEther(outcomeBalancesAfter[2]);
            const buys: bigint = ownerSharesAfter[0];
            const sells: bigint = ownerSharesAfter[1];
            const deposited: string = ethers.formatEther(ownerSharesAfter[2]);
            const withdrew: string = ethers.formatEther(ownerSharesAfter[3]);
            const redeemed: string = ethers.formatEther(ownerSharesAfter[4]);
            if (detailsEnabled) {
                console.log(`\t| Shares : 1-YES=${outcomeOneSharesAfter}, 2-NO=${outcomeTwoSharesAfter}`);
                console.log(`\t| Buys: ${buys}, Sells: ${sells}`);
                console.log(`\t| Deposited: ${deposited}, Withdrew: ${withdrew}, Redeemed: ${redeemed}`);
            }

            expect(preReturn.includes(expectedReturn.toString()), "Return do not match price");
            expect(Number(sells)).be.equal(1);
            expect(Number(outcomeOneSharesAfter)).be.equal(Number(outcomeOneSharesBefore) - 1);
            expect(Number(outcomeTwoSharesAfter)).be.equal(Number(outcomeTwoSharesBefore));
        })

        it("| Trying to sell one NO share [outcome=2]", async function () {
            if (detailsEnabled) console.log("");
            const outcomeBalancesBefore: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const outcomeOneSharesBefore: string = ethers.formatEther(outcomeBalancesBefore[1]);
            const outcomeTwoSharesBefore: string = ethers.formatEther(outcomeBalancesBefore[2]);
            const balanceBefore = await pre.balanceOf(owner.address);

            const outcome: number = 2;
            const shares: number = 1;
            const sharesInt128: bigint = fromNumberToInt128(shares);
            const priceInt128: bigint = await market.sellPrice(outcome, sharesInt128);
            const expectedReturn: number = fromInt128toNumber(priceInt128);
            if (detailsEnabled) {
                console.log(`\t| Shares : 1-YES=${outcomeOneSharesBefore}, 2-NO=${outcomeTwoSharesBefore}`);
                console.log(`\t| Selling: outcome=${outcome}, shares=${shares} [${sharesInt128}]`);
                console.log(`\t|   Expected return: ${expectedReturn} PRE`);
            }
            await market.sell(outcome, sharesInt128);

            const ownerSharesAfter: bigint[] = await market.accountShares(owner.address);
            const outcomeBalancesAfter: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const balanceAfter: bigint = await pre.balanceOf(owner.address);
            const preReturn: string = ethers.formatEther(balanceAfter - balanceBefore);
            if (detailsEnabled) {
                console.log(`\t| After Sold return: ${preReturn} PRE`);
            }

            const outcomeOneSharesAfter = ethers.formatEther(outcomeBalancesAfter[1]);
            const outcomeTwoSharesAfter = ethers.formatEther(outcomeBalancesAfter[2]);
            const buys: bigint = ownerSharesAfter[0];
            const sells: bigint = ownerSharesAfter[1];
            const deposited: string = ethers.formatEther(ownerSharesAfter[2]);
            const withdrew: string = ethers.formatEther(ownerSharesAfter[3]);
            const redeemed: string = ethers.formatEther(ownerSharesAfter[4]);
            if (detailsEnabled) {
                console.log(`\t| Shares : 1-YES=${outcomeOneSharesAfter}, 2-NO=${outcomeTwoSharesAfter}`);
                console.log(`\t| Buys: ${buys}, Sells: ${sells}`);
                console.log(`\t| Deposited: ${deposited}, Withdrew: ${withdrew}, Redeemed: ${redeemed}`);
            }

            expect(preReturn.includes(expectedReturn.toString()), "Return do not match price");
            expect(Number(sells)).be.equal(2);
            expect(Number(outcomeTwoSharesAfter)).be.equal(Number(outcomeTwoSharesBefore) - 1);
            expect(Number(outcomeOneSharesAfter)).be.equal(Number(outcomeOneSharesBefore));
        })

        it("| Trying many small Buys & 1 big Sell from users", async function () {
            if (detailsEnabled) console.log("");
            const userSharesBefore: bigint[] = await market.accountShares(user.address);
            const buysBefore: bigint = userSharesBefore[0];
            const sellsBefore: bigint = userSharesBefore[1];
            const outcomeBalancesBefore: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const outcomeOneSharesBefore: string = ethers.formatEther(outcomeBalancesBefore[1]);
            const outcomeTwoSharesBefore: string = ethers.formatEther(outcomeBalancesBefore[2]);
            if (detailsEnabled) {
                console.log(`\t| User Shares: 1-YES=${outcomeOneSharesBefore}, 2-NO=${outcomeTwoSharesBefore}`);
                console.log(`\t| User Actions: BUYs=${buysBefore}, SELLs= ${sellsBefore}`);
            }

            const balanceBefore = await pre.balanceOf(user.address);
            const yesOutcome: number = 1;

            // CASE 1: Small buys, big sell
            const buys: number = 100;
            if (detailsEnabled) console.log(`\t| Buying (1 share, ${buys} times)...`);
            for (let i: number = 0; i < buys; i++) {
                await market.connect(user).buy(yesOutcome, fromNumberToInt128(1));
            }
            if (detailsEnabled) console.log(`\t| Selling (${buys} shares)...`);
            await market.connect(user).sell(yesOutcome, fromNumberToInt128(buys));

            const balanceAfter: bigint = await pre.balanceOf(user.address);
            const deltaBalance: string = ethers.formatEther(balanceAfter - balanceBefore);
            if (detailsEnabled) {
                console.log(`\t| Balance: ${balanceBefore} -> ${balanceAfter} PRE`);
                console.log(`\t| Delta balance: ${deltaBalance} PRE`);
            }
            expect(balanceAfter).be.lessThanOrEqual(balanceBefore);

            const ownerSharesAfter: bigint[] = await market.accountShares(user.address);
            const buysAfter: bigint = ownerSharesAfter[0];
            const sellsAfter: bigint = ownerSharesAfter[1];
            const outcomeBalancesAfter: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const outcomeOneSharesAfter: string = ethers.formatEther(outcomeBalancesAfter[1]);
            const outcomeTwoSharesAfter: string = ethers.formatEther(outcomeBalancesBefore[2]);
            if (detailsEnabled) {
                console.log(`\t| User Shares (after): 1-YES=${outcomeOneSharesAfter}, 2-NO=${outcomeTwoSharesAfter}`);
                console.log(`\t| User Actions (after): BUYs=${buysAfter}, SELLs= ${sellsAfter}`);
            }

            expect(Number(outcomeOneSharesAfter)).be.equal(Number(outcomeOneSharesBefore));
            expect(Number(outcomeTwoSharesAfter)).be.equal(Number(outcomeTwoSharesBefore));
        })

        it("| Trying 1 big Buy & many small Sells from users", async function () {
            if (detailsEnabled) console.log("");
            const userSharesBefore: bigint[] = await market.accountShares(user.address);
            const buysBefore = userSharesBefore[0];
            const sellsBefore = userSharesBefore[1];
            const outcomeBalancesBefore: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const outcomeOneSharesBefore: string = ethers.formatEther(outcomeBalancesBefore[1]);
            const outcomeTwoSharesBefore: string = ethers.formatEther(outcomeBalancesBefore[2]);
            if (detailsEnabled) {
                console.log(`\t| User Shares: 1-YES=${outcomeOneSharesBefore}, 2-NO=${outcomeTwoSharesBefore}`);
                console.log(`\t| User Actions: BUYs=${buysBefore}, SELLs= ${sellsBefore}`);
            }

            const balanceBefore = await pre.balanceOf(user.address);
            const yesOutcome: number = 1;

            // CASE 2: Big buy, small sells
            const sells: number = 100;
            if (detailsEnabled) console.log(`\t| Buying (${sells} shares)...`);
            await market.connect(user).buy(yesOutcome, fromNumberToInt128(sells));
            if (detailsEnabled) console.log(`\t| Selling (1 share, ${sells} times)...`);
            for (let i: number = 0; i < sells; i++) {
                await market.connect(user).sell(yesOutcome, fromNumberToInt128(1));
            }

            const balanceAfter: bigint = await pre.balanceOf(user.address);
            const deltaBalance: string = ethers.formatEther(balanceAfter - balanceBefore);
            if (detailsEnabled) {
                console.log(`\t| Balance: ${balanceBefore} -> ${balanceAfter} PRE`);
                console.log(`\t| Delta balance: ${deltaBalance} PRE`);
            }
            expect(balanceAfter).be.lessThanOrEqual(balanceBefore);

            const ownerSharesAfter: bigint[] = await market.accountShares(user.address);
            const buysAfter: bigint = ownerSharesAfter[0];
            const sellsAfter: bigint = ownerSharesAfter[1];
            const outcomeBalancesAfter: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const outcomeOneSharesAfter: string = ethers.formatEther(outcomeBalancesAfter[1]);
            const outcomeTwoSharesAfter: string = ethers.formatEther(outcomeBalancesAfter[2]);
            if (detailsEnabled) {
                console.log(`\t| User Shares (after): 1-YES=${outcomeOneSharesAfter}, 2-NO=${outcomeTwoSharesAfter}`);
                console.log(`\t| User Actions (after): BUYs=${buysAfter}, SELLs= ${sellsAfter}`);
            }

            expect(Number(outcomeOneSharesAfter)).be.equal(Number(outcomeOneSharesBefore));
            expect(Number(outcomeTwoSharesAfter)).be.equal(Number(outcomeTwoSharesBefore));
        })

        it("| Trying to make some profit buying low and selling high", async function () {
            if (detailsEnabled) console.log("");

            const userSharesBefore: bigint[] = await market.accountShares(user.address);
            const buysBefore: bigint = userSharesBefore[0];
            const sellsBefore: bigint = userSharesBefore[1];
            const outcomeBalancesBefore: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const outcomeOneSharesBefore: string = ethers.formatEther(outcomeBalancesBefore[1]);
            const outcomeTwoSharesBefore: string = ethers.formatEther(outcomeBalancesBefore[2]);
            if (detailsEnabled) {
                console.log(`\t| User Shares: 1-YES=${outcomeOneSharesBefore}, 2-NO=${outcomeTwoSharesBefore}`);
                console.log(`\t| User Actions: BUYs=${buysBefore}, SELLs= ${sellsBefore}`);
            }

            // Dev Note: There is a lib limit of 1545 shares YES/NO delta on 200 overround.
            const balanceBefore: bigint = await pre.balanceOf(user.address);

            const YesOutcome: number = 1;

            // User BUY 1 share of YES at some initial low price
            await market.connect(user).buy(YesOutcome, fromNumberToInt128(1));

            // Another user BUY 1 share of YES
            await market.connect(caller).buy(YesOutcome, fromNumberToInt128(1));

            // User SELL 1 share of YES at a higher price
            await market.connect(user).sell(YesOutcome, fromNumberToInt128(1));

            // Another user SELLs 1 share of YES (to keep equality, this user will operate at a loss)
            await market.connect(caller).sell(YesOutcome, fromNumberToInt128(1));

            const balanceAfter: bigint = await pre.balanceOf(user.address);
            const deltaBalance: string = ethers.formatEther(balanceAfter - balanceBefore);
            if (detailsEnabled) {
                console.log(`\t| Shares Bought!, Total Cost: ${deltaBalance} PRE\``);
            }

            const ownerSharesAfter: bigint[] = await market.accountShares(user.address);
            const buysAfter: bigint = ownerSharesAfter[0];
            const sellsAfter: bigint = ownerSharesAfter[1];
            const outcomeBalancesAfter: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const outcomeOneSharesAfter: string = ethers.formatEther(outcomeBalancesAfter[1]);
            const outcomeTwoSharesAfter: string = ethers.formatEther(outcomeBalancesAfter[2]);
            if (detailsEnabled) {
                console.log(`\t| User Shares (after): 1-YES=${outcomeOneSharesAfter}, 2-NO=${outcomeTwoSharesAfter}`);
                console.log(`\t| User Actions (after): BUYs=${buysAfter}, SELLs= ${sellsAfter}`);
            }

            expect(Number(balanceAfter)).be.greaterThan(Number(balanceBefore));
            expect(Number(outcomeOneSharesAfter)).be.equal(Number(outcomeOneSharesBefore));
            expect(Number(outcomeTwoSharesAfter)).be.equal(Number(outcomeTwoSharesBefore));
        })

        it("| Checking final market info (equal YES/NO quantities)", async function () {
            if (detailsEnabled) console.log("");
            const marketInfo: any[] = await market.getMarketInfo();
            const totalShares: number = fromInt128toNumber(marketInfo[0]);
            const outcomeOne: number = fromInt128toNumber(marketInfo[1][1]);
            const outcomeTwo: number = fromInt128toNumber(marketInfo[1][2]);
            const cost: number = fromInt128toNumber(marketInfo[2]);
            const totalBuys = marketInfo[3];
            const totalSells = marketInfo[4];
            const marketPreBalance: bigint = await pre.balanceOf(marketAddress);
            if (detailsEnabled) {
                console.log(`\t| TotalShares: ${totalShares}, OutcomeOne: ${outcomeOne}, OutcomeTwo: ${outcomeTwo}`);
                console.log(`\t| TotalDeposited: ${cost}, totalBuys: ${totalBuys}, totalSells: ${totalSells}`);
                console.log(`\t| Market balance: ${ethers.formatEther(marketPreBalance)}`);
            }
            expect(outcomeOne).be.equal(outcomeTwo);
        })

        it("| Checking final prices (equal YES/NO quantities)", async function () {
            if (detailsEnabled) console.log("");
            const buyPrices: any[] = [null, [], []];  // the first item is added just for simplicity
            const sellPrices: any[] = [null, [], []];  // the first item is added just for simplicity
            const possibleOutcomes: number[] = [1, 2];
            const sharesAmounts: number[] = [1, 10, 100];
            for (const outcome of possibleOutcomes) {
                for (const shares of sharesAmounts) {
                    const sharesInt128: bigint = fromNumberToInt128(shares);
                    const priceInt128: bigint = await market.buyPrice(outcome, sharesInt128);
                    const price = fromInt128toNumber(priceInt128);
                    if (detailsEnabled) {
                        console.log(`\t|  Buy: outcome=${outcome}, amount=${shares} => ${price} [${priceInt128}]`);
                    }
                    buyPrices[outcome].push(price);
                }
            }
            for (const outcome of possibleOutcomes) {
                for (const shares of sharesAmounts) {
                    const sharesInt128: bigint = fromNumberToInt128(shares);
                    const priceInt128: bigint = await market.sellPrice(outcome, sharesInt128);
                    const price = fromInt128toNumber(priceInt128);
                    if (detailsEnabled) {
                        console.log(`\t| Sell: outcome=${outcome}, amount=${shares} => ${price} [${priceInt128}]`);
                    }
                    sellPrices[outcome].push(price);
                }
            }
            expect(buyPrices[1].toString()).to.equal(buyPrices[2].toString());
            expect(sellPrices[1].toString()).to.equal(sellPrices[2].toString());

            // Test prices using new V7 getter function
            const marketPrices: bigint[][] = await market.getPrices();
            const marketBuyPrices = marketPrices[0].map(value => Number(ethers.formatEther(value)));
            const marketSellPrices = marketPrices[1].map(value => Number(ethers.formatEther(value)));
            if (detailsEnabled) {
                console.log(`\t|  Fast Buy Prices: YES (${marketBuyPrices[1]}) - NO (${marketBuyPrices[2]})`);
                console.log(`\t| Fast Sell Prices: YES (${marketSellPrices[1]}) - NO (${marketSellPrices[2]})`);
            }
            expect(marketBuyPrices[1]).to.be.equal(buyPrices[1][0]);
            expect(marketBuyPrices[2]).to.be.equal(buyPrices[2][0]);
            expect(marketSellPrices[1]).to.be.equal(sellPrices[1][0]);
            expect(marketSellPrices[2]).to.be.equal(sellPrices[2][0]);
        })
    })

    describe("Test report result and redeem shares functions", function () {
        it("| Buying one NO share [outcome=2] from a User account", async function () {
            if (detailsEnabled) console.log("");
            const balanceBefore = await pre.balanceOf(user.address);

            const outcome: number = 2;
            const shares: number = 1;
            const sharesInt128: bigint = fromNumberToInt128(shares);
            if (detailsEnabled) {
                console.log(`\t| Buying: outcome=${outcome}, amount=${shares} [${sharesInt128}]`);
            }
            const priceInt128: bigint = await market.buyPrice(outcome, sharesInt128);
            const price = fromInt128toNumber(priceInt128);
            await market.connect(user).buy(outcome, sharesInt128);

            const balanceAfter = await pre.balanceOf(user.address);
            const preCost = ethers.formatEther(balanceBefore - balanceAfter);
            if (detailsEnabled) {
                console.log(`\t| PRE: ${ethers.formatEther(balanceBefore)} -> ${ethers.formatEther(balanceAfter)}`);
                console.log(`\t| Buy cost: ${preCost}, Calculated Price: ${price}`);
            }
            expect(preCost.includes(price.toString()), "Cost do not match price");
            const ownerShares: bigint[] = await market.accountShares(user.address);
            const outcomeBalances: bigint[] = await market.getAccountOutcomeBalances(user.address);
            const outcomeOneShares: string = ethers.formatEther(outcomeBalances[1]);
            const outcomeTwoShares: string = ethers.formatEther(outcomeBalances[2]);
            const buys: bigint = ownerShares[0];
            const sells: bigint = ownerShares[1];
            const deposited: string = ethers.formatEther(ownerShares[2]);
            const withdrew: string = ethers.formatEther(ownerShares[3]);
            const redeemed: string = ethers.formatEther(ownerShares[4]);
            if (detailsEnabled) {
                console.log(`\t| Buys: ${buys}, Sells: ${sells}`);
                console.log(`\t| Deposited: ${deposited}, Withdrew: ${withdrew}, Redeemed: ${redeemed}`);
                console.log(`\t| Share balances: YES: ${outcomeOneShares}, NO: ${outcomeTwoShares}`);
            }
            expect(Number(outcomeOneShares)).be.equal(0);
            expect(Number(outcomeTwoShares)).be.equal(1);
        })

        it("| Buying one NO share [outcome=2] from a Caller account", async function () {
            if (detailsEnabled) console.log("");
            const balanceBefore = await pre.balanceOf(caller.address);

            const outcome: number = 2;
            const shares: number = 1;
            const sharesInt128: bigint = fromNumberToInt128(shares);
            if (detailsEnabled) {
                console.log(`\t| Buying: outcome=${outcome}, amount=${shares} [${sharesInt128}]`);
            }
            const priceInt128: bigint = await market.buyPrice(outcome, sharesInt128);
            const price = fromInt128toNumber(priceInt128);
            await market.connect(caller).buy(outcome, sharesInt128);

            const balanceAfter = await pre.balanceOf(caller.address);
            const preCost = ethers.formatEther(balanceBefore - balanceAfter);
            if (detailsEnabled) {
                console.log(`\t| PRE: ${ethers.formatEther(balanceBefore)} -> ${ethers.formatEther(balanceAfter)}`);
                console.log(`\t| Buy cost: ${preCost}, Calculated Price: ${price}`);
            }
            expect(preCost.includes(price.toString()), "Cost do not match price");
            const ownerShares: bigint[] = await market.accountShares(caller.address);
            const outcomeBalances: bigint[] = await market.getAccountOutcomeBalances(caller.address);
            const outcomeOneShares: string = ethers.formatEther(outcomeBalances[1]);
            const outcomeTwoShares: string = ethers.formatEther(outcomeBalances[2]);
            const buys: bigint = ownerShares[0];
            const sells: bigint = ownerShares[1];
            const deposited: string = ethers.formatEther(ownerShares[2]);
            const withdrew: string = ethers.formatEther(ownerShares[3]);
            const redeemed: string = ethers.formatEther(ownerShares[4]);
            if (detailsEnabled) {
                console.log(`\t| Buys: ${buys}, Sells: ${sells}`);
                console.log(`\t| Deposited: ${deposited}, Withdrew: ${withdrew}, Redeemed: ${redeemed}`);
                console.log(`\t| Share balances: YES: ${outcomeOneShares}, NO: ${outcomeTwoShares}`);
            }
            expect(Number(outcomeOneShares)).be.equal(0);
            expect(Number(outcomeTwoShares)).be.equal(1);
        })

        it("| Reporting result NO[outcome=2] from the Oracle account", async function () {
            if (detailsEnabled) console.log("");
            const oracle: string = await market.oracle();
            const startTimestamp: bigint = await market.startTimestamp();
            const endTimestamp: bigint = await market.endTimestamp();
            const initialCloseTimestamp: bigint = await market.closeTimestamp();
            const initialResult: bigint = await market.result();
            if (detailsEnabled) {
                console.log(`\t| Oracle: ${oracle}`);
                console.log(`\t| StartTimestamp: ${startTimestamp}, EndTimestamp=${endTimestamp}`);
                console.log(`\t| Initial -> CloseTimestamp: ${initialCloseTimestamp}, Result=${initialResult}`);
            }

            const marketId: number = 1;
            const resultOutcome: number = 2;
            await market.reportResult(marketId, resultOutcome);

            const finalCloseTimestamp: bigint = await market.closeTimestamp();
            const finalResult: bigint = await market.result();
            if (detailsEnabled) {
                console.log(`\t|   Final -> CloseTimestamp: ${finalCloseTimestamp}, Result=${finalResult}`);
            }

            expect(initialResult).be.equal(0);
            expect(initialCloseTimestamp).be.equal(0);
            expect(finalResult).be.equal(resultOutcome);
            expect(finalCloseTimestamp).be.greaterThan(0);
        })

        it("| Buying after Market result reported (not allowed)", async function () {
            if (detailsEnabled) console.log("");
            const shares: number = 10;
            const sharesInt128: bigint = fromNumberToInt128(shares);
            if (detailsEnabled) {
                console.log(`\t| Buying: condition=1, amount=${shares} [${sharesInt128}]`);
            }

            await expect(market.buy(1, sharesInt128)).to.be.revertedWith("Market already closed");

            const finalCloseTimestamp: bigint = await market.closeTimestamp();
            const finalResult: bigint = await market.result();
            if (detailsEnabled) {
                console.log(`\t|  CloseTimestamp: ${finalCloseTimestamp}, Result=${finalResult}`);
            }
        })

        it("| Redeeming shares from Market", async function () {
            if (detailsEnabled) console.log("");
            const initialPre: bigint = await pre.balanceOf(owner.address);
            const initialOwnerShares: bigint[] = await market.accountShares(owner.address);
            const initialOutcomeBalances: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const initialOutcomeOneShares: string = ethers.formatEther(initialOutcomeBalances[1]);
            const initialOutcomeTwoShares: string = ethers.formatEther(initialOutcomeBalances[2]);
            const buys: bigint = initialOwnerShares[0];
            const sells: bigint = initialOwnerShares[1];
            const deposited: string = ethers.formatEther(initialOwnerShares[2]);
            const withdrew: string = ethers.formatEther(initialOwnerShares[3]);
            const initialRedeemed: string = ethers.formatEther(initialOwnerShares[4]);
            if (detailsEnabled) {
                console.log(`\t| Initial balance: ${ethers.formatEther(initialPre)} PRE`);
                console.log(`\t| Buys: ${buys}, Sells: ${sells}`);
                console.log(`\t| Deposited: ${deposited}, Withdrew: ${withdrew}, Redeemed: ${initialRedeemed}`);
                console.log(`\t| Share balances: YES: ${initialOutcomeOneShares}, NO: ${initialOutcomeTwoShares}`);
            }
            const sharesToRedeem: bigint = initialOutcomeBalances[2]; // balance of outcome 2 shares

            await market.redeemShares();

            const finalOwnerShares: bigint[] = await market.accountShares(owner.address);
            const finalOutcomeBalances: bigint[] = await market.getAccountOutcomeBalances(owner.address);
            const finalOutcomeOneShares: string = ethers.formatEther(finalOutcomeBalances[1]);
            const finalOutcomeTwoShares: string = ethers.formatEther(finalOutcomeBalances[2]);
            const finalPre: bigint = await pre.balanceOf(owner.address);
            const finalRedeemed: string = ethers.formatEther(finalOwnerShares[4]);
            const redeemedBalance: bigint = finalPre - initialPre;
            const deltaPre: string = ethers.formatEther(finalPre - initialPre);
            if (detailsEnabled) {
                console.log(`\t| Final balance: ${ethers.formatEther(finalPre)} PRE (delta: ${deltaPre})`);
                console.log(`\t| Final Redeemed: ${finalRedeemed}`);
            }

            expect(redeemedBalance).be.equal(sharesToRedeem);
            expect(finalOutcomeOneShares).be.equal(initialOutcomeOneShares);
            expect(finalOutcomeTwoShares).be.equal(initialOutcomeTwoShares);
        })

        it("| Redeem shares for a list of accounts from Oracle account", async function () {
            if (detailsEnabled) console.log("");
            const oracle: string = await market.oracle();
            const startTimestamp: bigint = await market.startTimestamp();
            const endTimestamp: bigint = await market.endTimestamp();
            const initialCloseTimestamp: bigint = await market.closeTimestamp();
            const initialResult: bigint = await market.result();
            if (detailsEnabled) {
                console.log(`\t| Oracle: ${oracle}`);
                console.log(`\t| StartTimestamp: ${startTimestamp}, EndTimestamp=${endTimestamp}`);
                console.log(`\t| Initial -> CloseTimestamp: ${initialCloseTimestamp}, Result=${initialResult}`);
            }

            // Note: do not matter if the 'owner' already redeemed. This should work with NO revert
            const accounts: string[] = [owner.address, caller.address, user.address];
            await market.connect(owner).redeemBatch(accounts);

            const ownerSharesInfo: bigint[] = await market.accountShares(owner.address);
            const ownerHasRedeemed: boolean = ownerSharesInfo[4] > 0;

            const callerSharesInfo: bigint[] = await market.accountShares(caller.address);
            const callerHasRedeemed: boolean = callerSharesInfo[4] > 0;

            const userSharesInfo: bigint[] = await market.accountShares(user.address);
            const userHasRedeemed: boolean = userSharesInfo[4] > 0;

            if (detailsEnabled) {
                console.log(`\t| owner - HasRedeemed: ${ownerHasRedeemed}`);
                console.log(`\t| caller - HasRedeemed: ${callerHasRedeemed}`);
                console.log(`\t| user - HasRedeemed: ${userHasRedeemed}`);
            }

            expect(ownerHasRedeemed).be.equal(true);
            expect(callerHasRedeemed).be.equal(true);
            expect(userHasRedeemed).be.equal(true);
        })

        it("| Withdrawing liquidity (initial + dust) from Market", async function () {
            if (detailsEnabled) console.log("");
            const initialPre: bigint = await pre.balanceOf(marketAddress);
            const initialCost: number = fromInt128toNumber(await market.cost());
            if (detailsEnabled) {
                console.log(`\t| Initial market balance: ${ethers.formatEther(initialPre)} PRE`);
                console.log(`\t| Initial market cost: ${initialCost} PRE`);
            }

            await market.withdraw(preAddress);

            const finalPre: bigint = await pre.balanceOf(marketAddress);
            const finalCost: number = fromInt128toNumber(await market.cost());
            if (detailsEnabled) {
                console.log(`\t| Final market balance: ${ethers.formatEther(finalPre)} PRE`);
                console.log(`\t| Final market cost: ${finalCost} PRE`);
            }

            expect(finalPre).be.equal(0);
            expect(finalCost).be.equal(initialCost);
        })
    })

    describe("Test quaternary outcome Market", function () {
        it("| Deploy and setup a quaternary Market", async function () {
            if (detailsEnabled) console.log("");
            const PrecogMarket = await ethers.getContractFactory("PrecogMarketV7");
            quadMarket = await PrecogMarket.deploy();
            await quadMarket.initialize(preAddress);
            quadMarketAddress = await quadMarket.getAddress();
            if (detailsEnabled) {
                console.log(`\t|  Quad Market: ${quadMarketAddress}`);
                console.log(`\t|    Pre Token: ${preAddress}`);
            }
            expect(!quadMarketAddress);
            expect(quadMarketAddress).not.equal(marketAddress);

            // Approve quad market to use PRE tokens from users
            await pre.approve(quadMarketAddress, ethers.parseEther('10000'));
            await pre.connect(caller).approve(quadMarketAddress, ethers.parseEther('10000'));
            await pre.connect(user).approve(quadMarketAddress, ethers.parseEther('10000'));

            // Initialize a new quaternary market
            const ownerInitialBalance: bigint = await pre.balanceOf(owner.address);
            const marketId: number = 2;
            const totalOutcomes: number = 4;
            const initialShares = 500;
            const subsidy: bigint = ethers.parseEther(initialShares.toString());
            const overround: number = 400;  // General rule: 100x totalOutcomes
            await quadMarket.setup(marketId, owner.address, totalOutcomes, subsidy, overround);
            const ownerFinalBalance: bigint = await pre.balanceOf(owner.address);
            expect(await pre.balanceOf(quadMarketAddress)).to.equal(subsidy);
            expect(ownerFinalBalance).to.equal(ownerInitialBalance - subsidy);

            const marketInfo: any[] = await quadMarket.getMarketInfo();
            const totalShares: number = fromInt128toNumber(marketInfo[0]);
            const oneShares: number = fromInt128toNumber(marketInfo[1][1]);
            const twoShares: number = fromInt128toNumber(marketInfo[1][2]);
            const threeShares: number = fromInt128toNumber(marketInfo[1][3]);
            const fourShares: number = fromInt128toNumber(marketInfo[1][4]);
            const initialLiquidity: number = fromInt128toNumber(marketInfo[2]);
            if (detailsEnabled) {
                console.log(`\t| Total shares: ${totalShares}`);
                console.log(`\t|  By Outcomes: 1=${oneShares}, 2=${twoShares}, 3=${threeShares}, 4=${fourShares}`);
                console.log(`\t|    Liquidity: ${initialLiquidity}`);
            }
            expect(totalShares).be.equal(oneShares + twoShares + threeShares + fourShares);
            expect(initialLiquidity).be.equal(520);  // 500 (Subsidy) + 4% (overround)

            // Register local market (to make verification against local calculations)
            const marketAlpha: number = await getMarketV7Alpha(quadMarketAddress)
            localMarket = new LSLMSR(['A', 'B'], marketAlpha, initialShares);
        })

        it("| Check base quaternary Market prices", async function () {
            if (detailsEnabled) console.log("");
            const buyPrices: any[] = [null, [], [], [], []];  // the first item is added just for simplicity
            const sellPrices: any[] = [null, [], [], [], []];  // the first item is added just for simplicity
            const possibleOutcomes: number[] = [1, 2, 3, 4];
            for (const outcome of possibleOutcomes) {
                const sharesInt128: bigint = fromNumberToInt128(1);
                const priceInt128: bigint = await quadMarket.buyPrice(outcome, sharesInt128);
                const price: number = fromInt128toNumber(priceInt128);
                if (detailsEnabled) {
                    console.log(`\t|  Buy: outcome=${outcome}, amount=${1} => ${price}`);
                }
                buyPrices[outcome].push(price);
            }
            for (const outcome of possibleOutcomes) {
                const sharesInt128: bigint = fromNumberToInt128(1);
                const priceInt128: bigint = await quadMarket.sellPrice(outcome, sharesInt128);
                const price: number = fromInt128toNumber(priceInt128);
                if (detailsEnabled) {
                    console.log(`\t| Sell: outcome=${outcome}, amount=${1} => ${price}`);
                }
                sellPrices[outcome].push(price);
            }
            expect(buyPrices[1].toString()).to.equal(buyPrices[2].toString());
            expect(buyPrices[3].toString()).to.equal(buyPrices[4].toString());
            expect(buyPrices[1].toString()).to.equal(buyPrices[4].toString());
            expect(sellPrices[1].toString()).to.equal(sellPrices[2].toString());
            expect(sellPrices[3].toString()).to.equal(sellPrices[4].toString());
            expect(sellPrices[1].toString()).to.equal(sellPrices[4].toString());

            // Test prices using new V7 getter function
            const quadMarketPrices: bigint[][] = await quadMarket.getPrices();
            const fBuyPrices = quadMarketPrices[0].map(value => Number(ethers.formatEther(value)));
            const fSellPrices = quadMarketPrices[1].map(value => Number(ethers.formatEther(value)));
            if (detailsEnabled) {
                console.log(`\t|  Fast Buy Prices: Outcome 1(${fBuyPrices[1]}) - Outcome 2(${fBuyPrices[2]})`);
                console.log(`\t|                   Outcome 3(${fBuyPrices[3]}) - Outcome 4(${fBuyPrices[4]})`);
                console.log(`\t| Fast Sell Prices: Outcome 1(${fSellPrices[1]}) - Outcome 2(${fSellPrices[2]})`);
                console.log(`\t|                   Outcome 3(${fSellPrices[3]}) - Outcome 4(${fSellPrices[4]})`);
            }
            expect(fBuyPrices[1]).to.be.equal(buyPrices[1][0]);
            expect(fBuyPrices[2]).to.be.equal(buyPrices[2][0]);
            expect(fBuyPrices[3]).to.be.equal(buyPrices[3][0]);
            expect(fBuyPrices[4]).to.be.equal(buyPrices[4][0]);
            expect(fSellPrices[1]).to.be.equal(sellPrices[1][0]);
            expect(fSellPrices[2]).to.be.equal(sellPrices[2][0]);
            expect(fSellPrices[3]).to.be.equal(sellPrices[3][0]);
            expect(fSellPrices[4]).to.be.equal(sellPrices[4][0]);
        })

        it("| Buy 10 shares of outcome=4", async function () {
            if (detailsEnabled) console.log("");
            const balanceBefore = await pre.balanceOf(owner.address);
            const outcome: number = 4;
            const shares: number = 10;
            const sharesInt128: bigint = fromNumberToInt128(shares);
            if (detailsEnabled) {
                console.log(`\t| Buying: outcome=${outcome}, shares=${shares} [${sharesInt128}]`);
            }
            const priceInt128: bigint = await quadMarket.buyPrice(outcome, sharesInt128);
            const price: number = fromInt128toNumber(priceInt128);

            // Pre-calculate buy price (after trade is made) from Chain
            const priceInt128OneMoreShare: bigint = await quadMarket.buyPrice(outcome, fromNumberToInt128(shares + 1));
            const futureBuyPrice: number = fromInt128toNumber(priceInt128OneMoreShare) - price;

            // Execute buy trade
            await quadMarket.buy(outcome, sharesInt128);

            const balanceAfter: bigint = await pre.balanceOf(owner.address);
            const preCost: string = ethers.formatEther(balanceBefore - balanceAfter);
            if (detailsEnabled) {
                console.log(`\t| Buy cost: ${preCost}, Calculated Price: ${price}`);
            }
            expect(preCost.includes(price.toString()), "Cost do not match price");

            const priceInt128BeforeBuy: bigint = await quadMarket.buyPrice(outcome, fromNumberToInt128(1));
            const actualBuyPrice: number = fromInt128toNumber(priceInt128BeforeBuy);
            if (detailsEnabled) {
                console.log(`\t| Future Buy price (before buy): ${futureBuyPrice} [chain]`);
                console.log(`\t| Actual Buy price (after buy) : ${actualBuyPrice} [chain]`);
            }

            const ownerShares: any[] = await quadMarket.accountShares(owner.address);
            const outcomeBalances: bigint[] = await quadMarket.getAccountOutcomeBalances(owner.address);
            const oneShares: string = ethers.formatEther(outcomeBalances[1]);
            const twoShares: string = ethers.formatEther(outcomeBalances[2]);
            const threeShares: string = ethers.formatEther(outcomeBalances[3]);
            const fourShares: string = ethers.formatEther(outcomeBalances[4]);
            const buys: bigint = ownerShares[0];
            const sells: bigint = ownerShares[1];
            const deposited: string = ethers.formatEther(ownerShares[2]);
            const withdrew: string = ethers.formatEther(ownerShares[3]);
            const redeemed: string = ethers.formatEther(ownerShares[4]);
            if (detailsEnabled) {
                console.log(`\t| Buys: ${buys}, Sells: ${sells}`);
                console.log(`\t| Deposited: ${deposited}, Withdrew: ${withdrew}, 'Redeemed': ${redeemed}`);
                console.log(`\t| Shares by outcome: 1=${oneShares}, 2=${twoShares}, 3=${threeShares}, 4=${fourShares}`);
            }
            expect(Number(buys)).be.equal(1);
            expect(Number(sells)).be.equal(0);
            expect(Number(oneShares)).be.equal(0);
            expect(Number(twoShares)).be.equal(0);
            expect(Number(twoShares)).be.equal(0);
            expect(Number(fourShares)).be.equal(shares);
        })

        it("| Check quaternary Market prices (after buy)", async function () {
            if (detailsEnabled) console.log("");
            const buyPrices: any[] = [null, [], [], [], []];  // the first item is added just for simplicity
            const sellPrices: any[] = [null, [], [], [], []];  // the first item is added just for simplicity
            const possibleOutcomes: number[] = [1, 2, 3, 4];
            for (const outcome of possibleOutcomes) {
                const sharesInt128: bigint = fromNumberToInt128(1);
                const priceInt128: bigint = await quadMarket.buyPrice(outcome, sharesInt128);
                const price: number = fromInt128toNumber(priceInt128);
                if (detailsEnabled) {
                    console.log(`\t|  Buy: outcome=${outcome}, amount=${1} => ${price}`);
                }
                buyPrices[outcome].push(price);
            }
            for (const outcome of possibleOutcomes) {
                const sharesInt128: bigint = fromNumberToInt128(1);
                const priceInt128: bigint = await quadMarket.sellPrice(outcome, sharesInt128);
                const price: number = fromInt128toNumber(priceInt128);
                if (detailsEnabled) {
                    console.log(`\t| Sell: outcome=${outcome}, amount=${1} => ${price}`);
                }
                sellPrices[outcome].push(price);
            }

            // All prices of outcomes 1, 2 and 3 should be equal
            expect(buyPrices[1].toString()).to.equal(buyPrices[2].toString());
            expect(buyPrices[2].toString()).to.equal(buyPrices[3].toString());
            expect(sellPrices[1].toString()).to.equal(sellPrices[2].toString());
            expect(sellPrices[2].toString()).to.equal(sellPrices[3].toString());
            // Any price of outcome 4 should be higher than any price of all other outcomes
            expect(buyPrices[4][0]).be.greaterThan(buyPrices[1][0]);
            expect(sellPrices[4][0]).be.greaterThan(sellPrices[1][0]);

            // Test prices using new V7 getter function
            const quadMarketPrices: bigint[][] = await quadMarket.getPrices();
            const fBuyPrices = quadMarketPrices[0].map(value => Number(ethers.formatEther(value)));
            const fSellPrices = quadMarketPrices[1].map(value => Number(ethers.formatEther(value)));
            if (detailsEnabled) {
                console.log(`\t|  Fast Buy Prices: Outcome 1(${fBuyPrices[1]}) - Outcome 2(${fBuyPrices[2]})`);
                console.log(`\t|                   Outcome 3(${fBuyPrices[3]}) - Outcome 4(${fBuyPrices[4]})`);
                console.log(`\t| Fast Sell Prices: Outcome 1(${fSellPrices[1]}) - Outcome 2(${fSellPrices[2]})`);
                console.log(`\t|                   Outcome 3(${fSellPrices[3]}) - Outcome 4(${fSellPrices[4]})`);
            }
            expect(fBuyPrices[1]).to.be.equal(buyPrices[1][0]);
            expect(fBuyPrices[2]).to.be.equal(buyPrices[2][0]);
            expect(fBuyPrices[3]).to.be.equal(buyPrices[3][0]);
            expect(fBuyPrices[4]).to.be.equal(buyPrices[4][0]);
            expect(fSellPrices[1]).to.be.equal(sellPrices[1][0]);
            expect(fSellPrices[2]).to.be.equal(sellPrices[2][0]);
            expect(fSellPrices[3]).to.be.equal(sellPrices[3][0]);
            expect(fSellPrices[4]).to.be.equal(sellPrices[4][0]);
        })

        it("| Report outcome=4 as result for quaternary Market", async function () {
            if (detailsEnabled) console.log("");
            const oracle: string = await quadMarket.oracle();
            const startTimestamp: bigint = await quadMarket.startTimestamp();
            const endTimestamp: bigint = await quadMarket.endTimestamp();
            const initialCloseTimestamp: bigint = await quadMarket.closeTimestamp();
            const initialResult: bigint = await quadMarket.result();
            if (detailsEnabled) {
                console.log(`\t| Oracle: ${oracle}`);
                console.log(`\t| StartTimestamp: ${startTimestamp}, EndTimestamp=${endTimestamp}`);
                console.log(`\t| Initial -> CloseTimestamp: ${initialCloseTimestamp}, Result=${initialResult}`);
            }

            const marketId: number = 2;
            const resultOutcome: number = 4;
            await quadMarket.reportResult(marketId, resultOutcome);

            const finalCloseTimestamp: bigint = await quadMarket.closeTimestamp();
            const finalResult: bigint = await quadMarket.result();
            if (detailsEnabled) {
                console.log(`\t|   Final -> CloseTimestamp: ${finalCloseTimestamp}, Result=${finalResult}`);
            }

            expect(initialResult).be.equal(0);
            expect(initialCloseTimestamp).be.equal(0);
            expect(finalResult).be.equal(resultOutcome);
            expect(finalCloseTimestamp).be.greaterThan(0);
        })

        it("| Redeeming shares from quaternary Market", async function () {
            if (detailsEnabled) console.log("");
            const initialPre: bigint = await pre.balanceOf(owner.address);
            const initialOwnerShares: bigint[] = await quadMarket.accountShares(owner.address);
            const outcomeBalances: bigint[] = await quadMarket.getAccountOutcomeBalances(owner.address);
            const oneShares: string = ethers.formatEther(outcomeBalances[1]);
            const twoShares: string = ethers.formatEther(outcomeBalances[2]);
            const threeShares: string = ethers.formatEther(outcomeBalances[3]);
            const fourShares: string = ethers.formatEther(outcomeBalances[4]);
            const buys: bigint = initialOwnerShares[0];
            const sells: bigint = initialOwnerShares[1];
            const deposited: string = ethers.formatEther(initialOwnerShares[2]);
            const withdrew: string = ethers.formatEther(initialOwnerShares[3]);
            const initialRedeemed: string = ethers.formatEther(initialOwnerShares[4]);
            if (detailsEnabled) {
                console.log(`\t| Initial balance: ${ethers.formatEther(initialPre)} PRE`);
                console.log(`\t| Buys: ${buys}, Sells: ${sells}`);
                console.log(`\t| Deposited: ${deposited}, Withdrew: ${withdrew}, Redeemed: ${initialRedeemed}`);
                console.log(`\t| Shares by outcome: 1=${oneShares}, 2=${twoShares}, 3=${threeShares}, 4=${fourShares}`);
            }
            const sharesToRedeem: bigint = outcomeBalances[4]; // balance of outcome 2 shares

            await quadMarket.redeemShares();

            const finalOwnerShares: bigint[] = await quadMarket.accountShares(owner.address);
            const finalPre: bigint = await pre.balanceOf(owner.address);
            const finalRedeemed: string = ethers.formatEther(finalOwnerShares[4]);
            const redeemedBalance: bigint = finalPre - initialPre;
            const deltaPre: string = ethers.formatEther(finalPre - initialPre);
            if (detailsEnabled) {
                console.log(`\t| Final balance: ${ethers.formatEther(finalPre)} PRE (delta: ${deltaPre})`);
                console.log(`\t| Final Redeemed: ${finalRedeemed}`);
            }

            expect(redeemedBalance).be.equal(sharesToRedeem);
        })
    })
})

// References for OVERROUND in Solidity
// Outcomes 	Min Overround
// 2           	174 (0.0174%)
// 3	        275
// 4	        347
// 5	        403
// 6	        448
// 7	        487
// 8	        520
// 9	        550
// 10	        576
// 11	        600
// 12	        622
// 13	        642
// 14	        660
// 15	        678
// 16	        694
// 17	        709
// 18	        723
// 19	        737
// 20	        749
// 30       	851
// 40           923
// 50           979
