// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./IPermitsMin.sol";
import "./IPrecogMarketV8.sol";
import "./IPrecogToken.sol";

/**
 * @title PrecogMaster: Manager and factory of Precog markets
 * @author Marto (https://github.com/0xMarto)
 * @dev Feel free to leave any code improvements (DMs are open @0xMarto)
 */
contract PrecogMasterV8 is AccessControl {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant CALLER_ROLE = keccak256("CALLER_ROLE");
    bytes32 public constant MARKET_OPERATOR_ROLE = keccak256("MARKET_OPERATOR_ROLE");
    address public constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;

    // State objects
    struct MarketData {
        string question;
        string resolutionCriteria;
        string imageURL;
        string category;
        string outcomes;
        address creator;
        address operator;
        address market;
        uint256 startTimestamp;  // Market reference variable (cached for gas optimization)
        uint256 endTimestamp;  // Market reference variable (cached for gas optimization)
        address collateral;  // Market reference variable (cached for gas optimization)
    }

    struct MarketConfig {
        address oracle;
        uint256 totalOutcomes;
        uint256 liquidity;
        uint256 overround;
        int256 sellFeeFactor;
        uint256 collateralFunding;
        address collateralFunder;
    }

    // Public variables
    uint256 public createdMarkets;  // Total markets created
    mapping(uint256 => MarketData) public markets;  // Market data of created markets
    mapping(address => bool) public allowedOracles;  // Whitelisted market oracles for market operators
    mapping(address => bool) public allowedCollaterals;  // Whitelisted market collaterals for market operators
    mapping(address => bool) public allowedReceivers;  // Allowed receivers of market funding withdrawals
    mapping(address => bool) public ownedCollaterals;  // Special collaterals owned by this contract

    // Private variables
    address private baseMarket; // Market recipe for all created markets by this contract
    uint256 private marketMinOverround;  // Min overround for market operators
    int256 private marketMinSellFeeFactor;  // Max sell fee overround for market operators (negative means disabled)
    uint256 private protocolFeeFactor;  // Used to calculate protocol fee for market operators
    uint8 private unlocked;  // No reentrancy flag

    // Events emitted
    event MarketCreated(address indexed creator, address indexed operator, uint256 id, address market);

    // Modifiers
    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "Only Admin");
        _;
    }

    modifier onlyCaller() {
        require(hasRole(CALLER_ROLE, msg.sender), "Only Caller");
        _;
    }

    modifier onlyMarketOperator() {
        require(hasRole(MARKET_OPERATOR_ROLE, msg.sender), "Only Market Operator");
        _;
    }

    modifier lock() {
        require(unlocked == 1, "Locked");
        unlocked = 2;   // Activate lock! (enter critical section)
        _;
        unlocked = 1;   // Deactivate lock! (exit critical section)
    }

    // Functions
    constructor(address initialAdmin) {
        // Grant DEFAULT_ADMIN_ROLE to the initial admin (this is the admin to the ADMIN_ROLE list)
        _setupRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        // Set ADMIN_ROLE as admin of CALLER_ROLE list
        _setRoleAdmin(CALLER_ROLE, ADMIN_ROLE);
        // Grant ADMIN_ROLE to initial Admin (this enables to call "addAdmin" helper function)
        _setupRole(ADMIN_ROLE, initialAdmin);
    }

    /**
     * @notice Buys shares for the specified outcome in the desired market
     * @param marketId Unique market identifier to trade
     * @param outcome The outcome index of which shares are being bought (e.g.: 1 for YES, 2 for NO)
     * @param sharesAmount Number of outcome shares to buy (as a signed 64.64-bit fixed point number)
     * @param maxAmountIn Max amount of collateral tokens willing to spend (slippage protection)
     * @return amountIn Actual amount of collateral tokens spent on the trade
     */
    function marketBuy(uint256 marketId, uint256 outcome, int128 sharesAmount, uint256 maxAmountIn) external lock
    returns (uint256 amountIn) {
        // Get market and collateral from received market id
        MarketData storage marketData = markets[marketId];
        IERC20 marketCollateral = IERC20(marketData.collateral);

        // Get maxAmountIn of tokens from the buyer to this contract (this reverts if there is no balance or allowance)
        marketCollateral.safeTransferFrom(msg.sender, address(this), maxAmountIn);

        // Send special BUY to market contract (with the sender as `buyer` and this contract as `payer`)
        amountIn = IPrecogMarketV8(marketData.market).buyFor(msg.sender, address(this), outcome, sharesAmount);
        require(amountIn <= maxAmountIn, "Buy cost too high");

        // If there is any leftover, return tokens to sender
        if (amountIn < maxAmountIn) {
            marketCollateral.safeTransfer(msg.sender, maxAmountIn - amountIn);  // SafeMath not needed (validated)
        }
        return amountIn;
    }

    /**
     * @notice Buys shares using EIP-2612 permit signature for gasless approval (advanced, gas-optimized path)
     * @dev The permit signature must approve the Market contract directly (not Master) as the spender.
     * @param marketId Unique market identifier to trade
     * @param outcome The outcome index of which shares are being bought (e.g.: 1 for YES, 2 for NO)
     * @param sharesAmount Number of outcome shares to buy (as a signed 64.64-bit fixed point number)
     * @param maxAmountIn Max amount of collateral tokens willing to spend (slippage protection)
     * @param deadline Unix timestamp after which the permit signature expires
     * @param v Recovery byte of the ECDSA signature
     * @param r First 32 bytes of the ECDSA signature
     * @param s Second 32 bytes of the ECDSA signature
     * @return amountIn Actual amount of collateral tokens spent on the trade
     */
    function marketBuyWithPermit(
        uint256 marketId, uint256 outcome, int128 sharesAmount, uint256 maxAmountIn,
        uint256 deadline, uint8 v, bytes32 r, bytes32 s
    ) external lock returns (uint256 amountIn) {
        // Get market and token addresses from received market id
        address market = markets[marketId].market;
        address token = markets[marketId].collateral;

        // Give allowance from the sender to received market contract with permit (eip-2612) signature
        // Dev Note: The signature should be sign with the Market instance as spender (to avoid extra gas costs)
        IERC20Permit(token).permit(msg.sender, market, maxAmountIn, deadline, v, r, s);

        // Send special BUY to market contract (with the sender as `buyer` and `payer`)
        amountIn = IPrecogMarketV8(market).buyFor(msg.sender, msg.sender, outcome, sharesAmount);
        require(amountIn <= maxAmountIn, "Buy cost too high");

        // Return actual token cost
        return amountIn;
    }

    /**
     * @notice Buys shares using Permit2 signature for gasless approval (single transaction, any token)
     * @dev This function uses Uniswap's Permit2 contract for signature-based token transfers.
     * @param marketId Unique market identifier to trade
     * @param outcome The outcome index of which shares are being bought (e.g.: 1 for YES, 2 for NO)
     * @param sharesAmount Number of outcome shares to buy (as a signed 64.64-bit fixed point number)
     * @param maxAmountIn Max amount of collateral tokens willing to spend (slippage protection)
     * @param nonce Unique value to prevent signature replay (from Permit2 contract)
     * @param deadline Unix timestamp after which the permit signature expires
     * @param sig Permit2 signature authorizing the transfer
     * @return amountIn Actual amount of collateral tokens spent on the trade
     */
    function marketBuyWithPermit2(
        uint256 marketId, uint256 outcome, int128 sharesAmount, uint256 maxAmountIn,
        uint256 nonce, uint256 deadline, bytes calldata sig
    ) external lock returns (uint256 amountIn) {
        // Get market and collateral from received market id
        MarketData storage marketData = markets[marketId];
        address marketCollateral = marketData.collateral;

        // Get maxAmountIn of tokens from the buyer to this contract with Permit2 signature
        _permit2TransferFrom(marketCollateral, msg.sender, address(this), maxAmountIn, nonce, deadline, sig);

        // Send special BUY to market contract (with the sender as `buyer` and this contract as `payer`)
        amountIn = IPrecogMarketV8(marketData.market).buyFor(msg.sender, address(this), outcome, sharesAmount);
        require(amountIn <= maxAmountIn, "Buy cost too high");

        // If there is any leftover, return tokens to sender
        if (amountIn < maxAmountIn) {
            IERC20(marketCollateral).safeTransfer(msg.sender, maxAmountIn - amountIn);  // SafeMath not needed (validated)
        }
        return amountIn;
    }

    function _permit2TransferFrom(
        address token, address owner, address to, uint256 amount, uint256 nonce, uint256 deadline, bytes calldata sig
    ) internal {
        IPermit2(PERMIT2).permitTransferFrom(
            IPermit2.PermitTransferFrom(
                IPermit2.TokenPermissions(token, amount),
                nonce,
                deadline
            ),
            IPermit2.SignatureTransferDetails(to, amount),
            owner,
            sig
        );
    }

    /**
     * @notice Buys shares for the specified outcome in a owned collateralized market (advanced, non-approve path)
     * @param marketId Unique market identifier to trade
     * @param outcome The outcome index of which shares are being bought (e.g.: 1 for YES, 2 for NO)
     * @param sharesAmount Number of outcome shares to buy (as a signed 64.64-bit fixed point number)
     * @param maxAmountIn Max amount of collateral tokens willing to spend (slippage protection)
     * @return amountIn Actual amount of collateral tokens spent on the trade
     */
    function ownedMarketBuy(uint256 marketId, uint256 outcome, int128 sharesAmount, uint256 maxAmountIn) external lock
    returns (uint256 amountIn) {
        // Validate collateral based on received market id
        address marketCollateral = markets[marketId].collateral;
        require(ownedCollaterals[marketCollateral], "Not owned collateral");

        // Move the max amount to this contract (no approve needed)
        IPrecogToken(marketCollateral).move(msg.sender, address(this), maxAmountIn);

        // Send special BUY to market contract (with the sender as `buyer` and this contract as `payer`)
        amountIn = IPrecogMarketV8(markets[marketId].market).buyFor(msg.sender, address(this), outcome, sharesAmount);
        require(amountIn <= maxAmountIn, "Buy cost too high");

        // If there is any leftover, return tokens to sender
        if (amountIn < maxAmountIn) {
            IERC20(marketCollateral).safeTransfer(msg.sender, maxAmountIn.sub(amountIn));
        }
        return amountIn;
    }

    /**
     * @notice Sells shares for the specified outcome in the desired market
     * @param marketId Unique market identifier to trade
     * @param outcome The outcome of which shares are being sold (e.g.: 1 for YES, 2 for NO)
     * @param sharesAmount Number of outcome shares to sell (as a signed 64.64-bit fixed point number)
     * @param minAmountOut Min amount of collateral tokens to obtain (slippage protection)
     * @return amountOut Token amount obtain from selling the specified amount of shares
     */
    function marketSell(uint256 marketId, uint256 outcome, int128 sharesAmount, uint256 minAmountOut) external lock
    returns (uint256 amountOut) {
        // Note: All input validations are enforced at the Market layer

        // Send special SELL to market contract (with the sender as `seller` and `receiver`)
        amountOut = IPrecogMarketV8(markets[marketId].market).sellFor(msg.sender, msg.sender, outcome, sharesAmount);

        // Check that the sell price was equal or higher seller expected
        require(amountOut >= minAmountOut, "Sell return too low");

        return amountOut;
    }

    /**
     * @notice Redeems the total sender shares in the desired market
     * @param marketId Unique market identifier
     * @return shares Number of shares redeemed
     */
    function marketRedeemShares(uint256 marketId) external returns (uint256 shares) {
        return IPrecogMarketV8(markets[marketId].market).redeemFor(msg.sender);
    }

    /**
     * @notice Gets the cost of buying the specified amount of outcome shares in the desired market
     * @param marketId Unique market identifier to trade
     * @param outcome The outcome for which tokens are being bought
     * @param sharesAmount Number of outcome shares to buy (as signed 64.64-bit fixed point number)
     * @return tokenCost The token cost amount (as a signed 64.64-bit fixed point number)
     */
    function marketBuyPrice(uint256 marketId, uint256 outcome, int128 sharesAmount) external view
    returns (int128 tokenCost) {
        return IPrecogMarketV8(markets[marketId].market).buyPrice(outcome, sharesAmount);
    }

    /**
     * @notice Gets the return from selling the specified amount of outcome shares in the desired market
     * @param marketId Unique market identifier to trade
     * @param outcome The outcome for which shares are being sold
     * @param sharesAmount The number of outcome shares to sell (as signed 64.64-bit fixed point number)
     * @return tokenReturn The token return amount (as a signed 64.64-bit fixed point number)
     */
    function marketSellPrice(uint256 marketId, uint256 outcome, int128 sharesAmount) external view
    returns (int128 tokenReturn) {
        return IPrecogMarketV8(markets[marketId].market).sellPrice(outcome, sharesAmount);
    }

    /**
     * @notice Gets market buy and sell prices for all outcomes of the desired market
     * @dev Helper function to fast calculate market prediction and spreads
     * @param marketId unique market identifier to trade
     * @return buyPrices buy price of 1 share for all outcomes (indexed by outcome)
     * @return sellPrices sell price of 1 share for all outcomes (indexed by outcome)
     */
    function marketPrices(uint256 marketId) external view
    returns (uint256[] memory buyPrices, uint256[] memory sellPrices) {
        return IPrecogMarketV8(markets[marketId].market).getPrices();
    }

    /**
     * @notice Gets market result summary of the desired market
     * @dev Helper function to show closed market info
     * @param marketId unique market identifier to trade
     * @return result Reported market result outcome
     * @return closed Timestamp when the market result was reported
     * @return reporter Address of the market result reporter (market oracle)
     */
    function marketResultInfo(uint256 marketId) external view
    returns (uint256 result, uint256 closed, address reporter) {
        IPrecogMarketV8 createdMarket = IPrecogMarketV8(markets[marketId].market);

        // Get market result info
        result = createdMarket.result();
        closed = createdMarket.closeTimestamp();
        reporter = createdMarket.oracle();
        return (result, closed, reporter);
    }

    /**
     * @notice Gets the market setup parameters
     * @dev Helper function to show market setup info
     * @return initialShares The total initial shares minted for each outcome [ qi ]
     * @return alpha The calculated alpha the market [ overround/(n.log(n)) ]
     * @return outcomes Total amount of possible outcomes of the market [ n ]
     * @return sellFeeFactor used to mitigate token leaks and calculate sell fees [ 1/sellFeeFactor ]
     * @return initialCollateral The total initial collateral received on market setup [ funding ]
     */
    function marketSetupInfo(uint256 marketId) external view
    returns (int128 initialShares, int128 alpha, uint256 outcomes, int128 sellFeeFactor, uint256 initialCollateral) {
        IPrecogMarketV8 createdMarket = IPrecogMarketV8(markets[marketId].market);
        (initialShares, alpha, outcomes, sellFeeFactor, initialCollateral) = createdMarket.getMarketSetupInfo();
    }

    /**
     * @notice Gets the current market state info of the desired market
     * @dev Helper function to show general market shares info
     * @param marketId unique market identifier
     * @return totalShares Current total shares minted for all outcomes of the market
     * @return sharesBalances All shares balances (indexed by outcome)
     * @return redeemed Total redeemed shares of the reported outcome
     * @return cost Total redeemed shares of the reported outcome
     * @return buys Buys counter of the market
     * @return sells Sells counter of the market
     */
    function marketSharesInfo(uint256 marketId) external view returns (
        int128 totalShares, int128[] memory sharesBalances, int128 redeemed, int128 cost, uint256 buys, uint256 sells
    ) {
        IPrecogMarketV8 createdMarket = IPrecogMarketV8(markets[marketId].market);
        (totalShares, sharesBalances, redeemed, cost, buys, sells) = createdMarket.getMarketInfo();
    }

    /**
     * @notice Gets market account information for a specific market
     * @dev Returns trading statistics and outcome share balances for an account in the specified market.
     * @param marketId Unique market identifier
     * @param account Address of the account to query
     * @return buys Total number of buy transactions executed by this account
     * @return sells Total number of sell transactions executed by this account
     * @return deposited Total collateral deposited through buy transactions (cumulative)
     * @return withdrawn Total collateral withdrawn through sell transactions (cumulative)
     * @return redeemed Total collateral redeemed after market closure (0 if not redeemed yet)
     * @return balances Share balances for each outcome, indexed by outcome (balances[0] always unused)
     */
    function marketAccountInfo(uint256 marketId, address account) external view returns (
        uint256 buys, uint256 sells, uint256 deposited, uint256 withdrawn, uint256 redeemed, uint256[] memory balances
    ) {
        IPrecogMarketV8 market = IPrecogMarketV8(markets[marketId].market);
        // Get trading stats on received account for selected market
        (buys, sells, deposited, withdrawn, redeemed) = market.getAccountStats(account);
        // Get outcome balances on received account for selected market
        balances = market.getAccountOutcomeBalances(account);
    }

    /**
     * @notice Gets collateral token information for a specific market
     * @dev Returns ERC20 token details (address, name, symbol, decimals) used on the market
     * @param marketId Unique market identifier
     * @return token Collateral token contract address
     * @return name Token name (e.g., "USD Coin")
     * @return symbol Token symbol (e.g., "USDC")
     * @return decimals Token decimals (e.g., 6 for USDC, 18 for DAI)
     */
    function marketCollateralInfo(uint256 marketId) external view
    returns (address token, string memory name, string memory symbol, uint8 decimals) {
        IPrecogToken collateral = IPrecogToken(markets[marketId].collateral);
        return (address(collateral), collateral.name(), collateral.symbol(), collateral.decimals());
    }

    /**
     * @notice Gets the global market creation configuration and protocol parameters
     * @dev Returns parameters used to validate and configure new markets created by operators.
     * @return implementation Address of the base market implementation contract used for cloning
     * @return minOverround Minimum overround (in basis points) required for market creation
     * @return minSellFeeFactor Minimum sell fee factor allowed (negative value disables validation)
     * @return feeFactor Protocol fee factor used to calculate fees on market profits (fee = 1 / feeFactor)
     */
    function getMarketsConfigs() external view
    returns (address implementation, uint256 minOverround, int256 minSellFeeFactor, uint256 feeFactor) {
        return (baseMarket, marketMinOverround, marketMinSellFeeFactor, protocolFeeFactor);
    }

    /*//////////////////////////////////////////////////////////////
                        MARKET OPERATOR FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /**
     * @notice Creates a new prediction market with the specified configuration
     * @dev Deploys a minimal proxy clone of the base market implementation. Only callable by market operators.
     * @param data Market metadata including question, resolution criteria, outcomes, dates, and collateral
     * @param config Market parameters including oracle, liquidity, overround, and fee settings
     * @return newMarketId Unique identifier for the newly created market
     */
    function createMarket(MarketData memory data, MarketConfig memory config) external onlyMarketOperator
    returns (uint256 newMarketId) {
        // Validate market data variables
        require(bytes(data.question).length > 0, "Invalid question");
        require(bytes(data.resolutionCriteria).length > 0, "Invalid resolution criteria");
        require(bytes(data.outcomes).length > 0, "Invalid outcomes");
        require(allowedCollaterals[data.collateral], 'Collateral not allowed');
        require(data.startTimestamp <= data.endTimestamp, "Invalid dates");

        // Validate market config variables
        require(allowedOracles[config.oracle], 'Oracle not allowed');
        require(config.liquidity >= config.collateralFunding, 'Invalid liquidity');
        require(config.overround >= marketMinOverround, 'Invalid overround');
        require(config.sellFeeFactor >= marketMinSellFeeFactor, 'Invalid sell fee factor');
        require(config.collateralFunder == msg.sender, 'Invalid funder');

        // Populate fields controlled by this contract
        data.operator = msg.sender;
        data.market = address(0);

        newMarketId = _createMarket(data, config);
        return newMarketId;
    }

    /**
     * @notice Internal function to deploy and configure a new market contract
     * @dev Clones the base market implementation, transfers collateral and initializes market parameters.
     *      Market Data and Config parameter validation are made on `createMarket` external function
     * @param md Market metadata (question, dates, collateral, etc.)
     * @param mc Market configuration (oracle, liquidity, fees, etc.)
     * @return newMarketId The ID assigned to the newly created market
     *
     * Market Types:
     * - Full Liquidity: liquidity == collateralFunding (all liquidity backed by real collateral)
     * - Virtual Liquidity: liquidity > collateralFunding (liquidity backed by max collateral loss calculation)
     */
    function _createMarket(MarketData memory md, MarketConfig memory mc) internal returns (uint256) {
        // Deploy a new market contract and initialize it with the collateral token
        address newMarketAddress = Clones.clone(baseMarket);
        IPrecogMarketV8 newMarket = IPrecogMarketV8(newMarketAddress);
        newMarket.initialize(md.collateral);

        // Get funding amount from funder to this contract (skipped if the collateralFunder is this contract)
        if (mc.collateralFunder != address(this)) {
            IERC20(md.collateral).safeTransferFrom(mc.collateralFunder, address(this), mc.collateralFunding);
        }
        // Pre approve all trades from this contract to the new Market contract
        IERC20(md.collateral).approve(newMarketAddress, type(uint256).max);

        // Calculate new market id and Setup deployed new market
        uint256 newId = createdMarkets;
        if (mc.liquidity == mc.collateralFunding) {
            // Setup a Full Liquidity market
            newMarket.setup(newId, mc.oracle, mc.totalOutcomes, mc.liquidity, mc.overround);
        } else {
            // Setup a Virtual Liquidity market
            newMarket.setupVL(newId, mc.oracle, mc.totalOutcomes, mc.liquidity, mc.overround, mc.collateralFunding);
        }
        newMarket.updateDates(md.startTimestamp, md.endTimestamp);
        if (mc.sellFeeFactor >= 0) newMarket.updateSellFeeFactor(uint256(mc.sellFeeFactor));

        // Save created market address and save it in local storage (indexed by market id)
        md.market = newMarketAddress;
        markets[newId] = md;

        // Increase created markets counter, emit event and return new market id
        createdMarkets = newId.add(1);
        emit MarketCreated(md.creator, md.operator, newId, newMarketAddress);
        return newId;
    }

    /**
     * @notice Withdraws available collateral from a closed market (initial funding + profits)
     * @dev Only the registered operator for the specific market can withdraw its collateral.
     * @param marketId Unique market identifier
     * @return amount Total collateral withdrawn (after protocol fee deduction, if applicable)
     */
    function withdrawMarketCollateral(uint256 marketId) external onlyMarketOperator returns (uint256 amount) {
        // Verify if the sender is the registered market operator of received market
        require(msg.sender == markets[marketId].operator, 'Not allowed operator');

        // Get amount available to be withdraw after all winning shares redeems (initial collateral + profit)
        IPrecogMarketV8 market = IPrecogMarketV8(markets[marketId].market);
        amount = market.withdrawAvailableCollateral(address(this));

        // Apply protocol fee (only some value was set)
        if (protocolFeeFactor > 0) {
            // Get market initial collateral amount
            (,,,,uint256 initialCollateral) = market.getMarketSetupInfo();

            // Verify if there is some market profit (protocol fee it's only applied on profitable markets)
            if (amount > initialCollateral) {
                uint256 marketProfit = amount.sub(initialCollateral);
                uint256 feeAmount = marketProfit.div(protocolFeeFactor);  // [protocolFee = 1 / protocolFeeFactor]
                // Re-calculate amount to transfer (after subtracting protocol fees)
                amount = amount.sub(feeAmount);
            }
        }

        // Transfer withdrawn collateral to operator
        IERC20(markets[marketId].collateral).safeTransfer(msg.sender, amount);
        return amount;
    }

    /**
     * @notice Buys shares on behalf of another account using Permit2 signature (operator-only)
     * @dev Allows market operators to execute trades for users via gasless Permit2 signatures.
     * @param account Address that will receive the purchased shares
     * @param marketId Unique market identifier
     * @param outcome Outcome index for which shares are being bought (e.g., 1=YES, 2=NO)
     * @param sharesAmount Number of shares to buy (64.64 fixed point)
     * @param maxAmountIn Max amount of collateral tokens willing to spend (slippage protection)
     * @param nonce Permit2 nonce to prevent signature replay
     * @param deadline Unix timestamp after which signature expires
     * @param sig Permit2 signature from the account authorizing the transfer
     * @return amountIn Actual collateral spent on the purchase
     */
    function buyMarketSharesFor(
        address account, uint256 marketId, uint256 outcome, int128 sharesAmount, uint256 maxAmountIn,
        uint256 nonce, uint256 deadline, bytes calldata sig
    ) external onlyMarketOperator returns (uint256 amountIn) {
        // Get market from received market id
        MarketData storage marketData = markets[marketId];

        // Verify if the sender is the registered market operator of received market
        require(msg.sender == marketData.operator, 'Not allowed operator');

        // Get maxAmountIn of tokens from the buyer to this contract with Permit2 signature
        address marketCollateral = marketData.collateral;
        _permit2TransferFrom(marketCollateral, account, address(this), maxAmountIn, nonce, deadline, sig);

        // Execute special BUY to market contract (to be assigned to the `account` and paid by the `operator`)
        amountIn = IPrecogMarketV8(marketData.market).buyFor(account, address(this), outcome, sharesAmount);
        require(amountIn <= maxAmountIn, "Buy cost too high");

        // If there is any leftover, return tokens to sender
        if (amountIn < maxAmountIn) {
            IERC20(marketCollateral).safeTransfer(account, maxAmountIn.sub(amountIn));
        }
        return amountIn;
    }

    /*//////////////////////////////////////////////////////////////
                        CALLER FUNCTIONS
           Privileged functions for whitelisted integrations.
    //////////////////////////////////////////////////////////////*/

    /** @notice Creates market with minimal validations for trusted protocol callers */
    function createCustomMarket(MarketData memory data, MarketConfig memory config) external onlyCaller
    returns (uint256 newMarketId) {
        require(allowedOracles[config.oracle], 'Oracle not allowed');
        require(allowedReceivers[config.collateralFunder], 'Not allowed funder');
        return _createMarket(data, config);
    }

    /** @notice Withdraws market collateral to whitelisted receiver (trusted protocol callers) */
    function withdrawMarketCollateralTo(uint256 marketId, address to) external onlyCaller returns (uint256 amount) {
        require(allowedReceivers[to], 'Not allowed receiver');
        return IPrecogMarketV8(markets[marketId].market).withdrawAvailableCollateral(to);
    }

    /** @notice Buys shares for an account with separate payer (account gets shares, payer pays) */
    function buyMarketSharesForWithPayer(
        address account, address payer, uint256 marketId, uint256 outcome, int128 sharesAmount, uint256 maxAmountIn,
        uint256 nonce, uint256 deadline, bytes calldata sig
    ) external onlyCaller returns (uint256 amountIn) {
        // Get market from received market id
        MarketData storage marketData = markets[marketId];

        // Get maxAmountIn of tokens from the buyer to this contract with Permit2 signature
        address marketCollateral = marketData.collateral;
        _permit2TransferFrom(marketCollateral, payer, address(this), maxAmountIn, nonce, deadline, sig);

        // Execute special BUY to market contract (to be assigned to the `account` and paid by `payer`)
        amountIn = IPrecogMarketV8(marketData.market).buyFor(account, address(this), outcome, sharesAmount);
        require(amountIn <= maxAmountIn, "Buy cost too high");

        // If there is any leftover, return tokens to sender
        if (amountIn < maxAmountIn) {
            IERC20(marketCollateral).safeTransfer(payer, maxAmountIn.sub(amountIn));
        }
        return amountIn;
    }

    /*//////////////////////////////////////////////////////////////
                        ADMIN FUNCTIONS
    //////////////////////////////////////////////////////////////*/

    /** @notice Grants market operator role */
    function addMarketOperator(address account) external onlyAdmin {
        grantRole(MARKET_OPERATOR_ROLE, account);
    }

    /** @notice Revoke market operator role */
    function removeMarketOperator(address account) external onlyAdmin {
        revokeRole(MARKET_OPERATOR_ROLE, account);
    }

    /** @notice Grants caller role to an account */
    function addCaller(address account) external onlyAdmin {
        grantRole(CALLER_ROLE, account);
    }

    /** @notice Revokes caller role from an account */
    function removeCaller(address account) external onlyAdmin {
        revokeRole(CALLER_ROLE, account);
    }

    /** @notice Grants admin role to an account */
    function addAdmin(address account) external onlyAdmin {
        grantRole(ADMIN_ROLE, account);
    }

    /** @notice Revokes admin role from an account */
    function removeAdmin(address account) external onlyAdmin {
        revokeRole(ADMIN_ROLE, account);
    }

    /** @notice Registers a collateral token owned by this contract */
    function addOwnedCollateral(address collateral) external onlyAdmin {
        require(!ownedCollaterals[collateral]);
        require(IPrecogToken(collateral).owner() == address(this));
        ownedCollaterals[collateral] = true;
    }

    /** @notice Unregisters an owned collateral token */
    function removeOwnedCollateral(address collateral) external onlyAdmin {
        require(ownedCollaterals[collateral]);
        ownedCollaterals[collateral] = false;
    }

    /** @notice Whitelists an address to receive market collateral withdrawals */
    function addAllowedReceiver(address receiver) external onlyAdmin {
        require(!allowedReceivers[receiver]);
        allowedReceivers[receiver] = true;
    }

    /** @notice Removes an address from the allowed receivers whitelist */
    function removeAllowedReceiver(address receiver) external onlyAdmin {
        require(allowedReceivers[receiver]);
        allowedReceivers[receiver] = false;
    }

    /** @notice Whitelists an oracle for market creation */
    function addAllowedOracle(address oracle) external onlyAdmin {
        require(!allowedOracles[oracle]);
        allowedOracles[oracle] = true;
    }

    /** @notice Removes an oracle from the whitelist */
    function removeAllowedOracle(address oracle) external onlyAdmin {
        require(allowedOracles[oracle]);
        allowedOracles[oracle] = false;
    }

    /** @notice Whitelists a collateral token for market creation */
    function addAllowedCollateral(address collateral) external onlyAdmin {
        require(!allowedCollaterals[collateral]);
        allowedCollaterals[collateral] = true;
    }

    /** @notice Removes a collateral token from the whitelist */
    function removeAllowedCollateral(address collateral) external onlyAdmin {
        require(allowedCollaterals[collateral]);
        allowedCollaterals[collateral] = false;
    }

    /** @notice Sets the base market implementation for cloning */
    function setBaseMarket(address market) external onlyAdmin {
        baseMarket = market;

        // Initialize all market `lock` functions
        unlocked = 1;
    }

    /** @notice Sets the minimum overround required for market creation */
    function setMarketMinOverround(uint256 overround) external onlyAdmin {
        marketMinOverround = overround;
    }

    /** @notice Sets the minimum sell fee factor allowed for markets */
    function setMarketMinSellFeeFactor(int256 sellFeeFactor) external onlyAdmin {
        marketMinSellFeeFactor = sellFeeFactor;
    }

    /** @notice Sets the protocol fee factor (ProtocolFee = 1 / feeFactor) */
    function setProtocolFeeFactor(uint256 feeFactor) external onlyAdmin {
        protocolFeeFactor = feeFactor;
    }

    /**
     * @notice Updates market metadata and configuration (emergency use only)
     * @dev Pass empty strings or address(0) to skip updating specific fields
     */
    function updateMarket(
        uint256 id,
        string memory question,
        string memory resolutionCriteria,
        string memory imageURL,
        string memory category,
        string memory outcomes,
        address marketCreator,
        uint256 startTimestamp,
        uint256 endTimestamp,
        address marketOracle,
        int256 sellFeeFactor
    ) external onlyAdmin {
        // Get market from received id
        MarketData storage marketData = markets[id];

        // Validate received market implementation
        require(marketData.market != address(0), "Invalid market");

        // Verify and update market parameters on master
        if (bytes(question).length > 0) marketData.question = question;
        if (bytes(resolutionCriteria).length > 0) marketData.resolutionCriteria = resolutionCriteria;
        if (bytes(imageURL).length > 0) marketData.imageURL = imageURL;
        if (bytes(category).length > 0) marketData.category = category;
        if (bytes(outcomes).length > 0) marketData.outcomes = outcomes;
        if (marketCreator != address(0)) marketData.creator = marketCreator;

        // Verify and update market parameters on market instance
        if (marketOracle != address(0)) {
            IPrecogMarketV8(marketData.market).updateOracle(marketOracle);
        }
        if (sellFeeFactor >= 0) {
            IPrecogMarketV8(marketData.market).updateSellFeeFactor(uint256(sellFeeFactor));
        }
        bool updateDates = false;
        if (startTimestamp > 0) {
            marketData.startTimestamp = startTimestamp;
            updateDates = true;
        }
        if (endTimestamp > 0) {
            marketData.endTimestamp = endTimestamp;
            updateDates = true;
        }
        if (updateDates) {
            IPrecogMarketV8(marketData.market).updateDates(marketData.startTimestamp, marketData.endTimestamp);
        }
    }

    /** @notice Withdraws accidentally sent non-collateral tokens from a market contract */
    function marketWithdraw(uint256 marketId, address marketToken) external onlyAdmin {
        IPrecogMarketV8(markets[marketId].market).withdraw(marketToken);
    }

    /** @notice Transfers ownership of a market contract */
    function marketTransferOwnership(uint256 marketId, address newOwner) external onlyAdmin {
        IPrecogMarketV8(markets[marketId].market).transferOwnership(newOwner);
    }

    /** @notice Mints owned collateral tokens */
    function ownedTokenMint(address ownedToken, address to, uint256 amount) external onlyAdmin {
        IPrecogToken(ownedToken).mint(to, amount);
    }

    /** @notice Burns owned collateral tokens */
    function ownedTokenBurn(address ownedToken, address from, uint256 amount) external onlyAdmin {
        IPrecogToken(ownedToken).burn(from, amount);
    }

    /** @notice Moves owned collateral tokens between addresses */
    function ownedTokenMove(address ownedToken, address from, address to, uint256 amount) external onlyAdmin {
        IPrecogToken(ownedToken).move(from, to, amount);
    }

    /** @notice Transfers ownership of an owned collateral token */
    function ownedTokenTransferOwnership(address ownedToken, address newPrecogMaster) external onlyAdmin {
        IPrecogToken(ownedToken).transferOwnership(newPrecogMaster);
    }

    /** @notice Withdraws ETH or tokens from the Master contract */
    function withdraw(address _token) external onlyAdmin lock returns (uint256 amount) {
        if (_token == address(0)) {
            amount = address(this).balance;
            (bool ok,) = msg.sender.call{value: amount}("");
            require(ok);
        } else {
            amount = IERC20(_token).balanceOf(address(this));
            IERC20(_token).safeTransfer(msg.sender, amount);
        }
        return amount;
    }
}
