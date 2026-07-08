// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/proxy/Clones.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./IPrecogToken.sol";
import "./IPrecogMarket.sol";

/**
 * @title PrecogMaster: Manager of prediction markets and Precog token claims
 * @author Marto (https://github.com/0xMarto)
 * @dev Feel free to make any adjustments to the code (DMs are open @0xMarto)
 */
contract PrecogMasterV7 is AccessControl {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant CALLER_ROLE = keccak256("CALLER_ROLE");
    bytes32 public constant MARKET_CREATOR_ROLE = keccak256("MARKET_CREATOR_ROLE");

    // State objects
    struct TokenClaim {
        address account;
        uint256 user;
        uint256 claimedAmount;
        uint256 claimedTimestamp;
    }

    struct MiningSeason {
        uint256 startTimestamp;
        uint256 endTimestamp;
        uint256 maxUserClaim;
        uint256 maxTotalClaim;
        uint256 maxTotalMint;
        uint256 claimedAmount;
        uint256 mintedAmount;
    }

    struct MarketInfo {
        string name;
        string description;
        string category;
        string outcomes;
        uint256 startTimestamp;
        uint256 endTimestamp;
        address creator;
        address market;
    }

    struct MarketConfig {
        uint256 totalOutcomes;
        uint256 funding;
        uint256 overround;
        address collateralToken;
        address collateralFunder;
        address marketOracle;
    }

    // Public variables
    address public token;  // Claim token and default collateral for non custom markets
    address private oracle; // default oracle for all non custom markets
    address private market; // base market recipe for all created markets
    uint256 public createdMarkets;  // Total markets created
    uint256 public currentSeason;  // Current claiming season number
    mapping(address => TokenClaim) public accountTokenClaims;
    mapping(uint256 => TokenClaim) public userTokenClaims;
    mapping(uint256 => MiningSeason) public miningSeasons;
    mapping(uint256 => MarketInfo) public markets;

    // Events emitted
    event TokensClaimed(address indexed account, uint256 indexed user, uint256 amount, uint256 timestamp);
    event TokensMinted(address indexed account, uint256 amount, uint256 timestamp);
    event MarketCreated(address indexed creator, uint256 id, address market);

    // Modifiers
    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "Only Admin");
        _;
    }

    modifier onlyCaller() {
        require(hasRole(CALLER_ROLE, msg.sender), "Only Caller");
        _;
    }

    modifier onlyMarketCreator() {
        require(hasRole(MARKET_CREATOR_ROLE, msg.sender), "Only Market Creator");
        _;
    }

    // Functions
    constructor(address precogToken, address initialAdmin) {
        // Grant DEFAULT_ADMIN_ROLE to the initial admin (this is the admin to the ADMIN_ROLE list)
        _setupRole(DEFAULT_ADMIN_ROLE, initialAdmin);
        // Set ADMIN_ROLE as admin of CALLER_ROLE list
        _setRoleAdmin(CALLER_ROLE, ADMIN_ROLE);
        // Set already deployed precogToken as claimable token and collateral token for all Markets
        token = precogToken;
        // Grant ADMIN_ROLE to initial Admin (this enables to call "addAdmin" helper function)
        _setupRole(ADMIN_ROLE, initialAdmin);
    }

    /**
     * @notice Buys shares for the specified outcome in the desired market
     * @param marketId unique market identifier to trade
     * @param outcome The outcome of which shares are being bought (e.g.: 1 for YES, 2 for NO)
     * @param sharesAmount Number of outcome shares to buy (as a signed 64.64-bit fixed point number)
     * @param maxAmountIn Max amount of tokens able to spend in this trade (front-run mitigation)
     * @return amountIn Token amount used for buying the specified amount of shares
     */
    function marketBuy(
        uint256 marketId,
        uint256 outcome,
        int128 sharesAmount,
        uint256 maxAmountIn
    ) external returns (uint256 amountIn) {
        require(block.timestamp >= markets[marketId].startTimestamp, 'Market not started');
        require(block.timestamp <= markets[marketId].endTimestamp, 'Market already ended');

        // Get maxAmountIn of tokens from the buyer to Master (this reverts if there is no balance on buyer)
        address marketCollateral = IPrecogMarket(markets[marketId].market).token();
        if (marketCollateral == token) {
            // Case PrecogToken market: just move the max amount to this contract (no approve needed)
            IPrecogToken(token).move(msg.sender, address(this), maxAmountIn);
        } else {
            // Case custom token market: try to transfer from sender (this reverts is there is no allowance)
            IERC20(marketCollateral).safeTransferFrom(msg.sender, address(this), maxAmountIn);
        }

        // Send remote BUY to market contract (to be assigned to the sender)
        amountIn = IPrecogMarket(markets[marketId].market)._buy(outcome, sharesAmount, msg.sender);
        require(amountIn <= maxAmountIn, "Max amount reach!");  // Just in case there is some balance on this contract

        // If there is any leftover, return tokens to sender
        if (amountIn < maxAmountIn) {
            IERC20(marketCollateral).safeTransfer(msg.sender, maxAmountIn.sub(amountIn));
        }
        return amountIn;
    }

    /**
     * @notice Sells shares for the specified outcome in the desired market
     * @param marketId unique market identifier to trade
     * @param outcome The outcome of which shares are being sold (e.g.: 1 for YES, 2 for NO)
     * @param sharesAmount Number of outcome shares to sell (as a signed 64.64-bit fixed point number)
     * @param minAmountOut Min amount of tokens to obtain in this trade (front-run mitigation)
     * @return amountOut Token amount obtain from selling the specified amount of shares
     */
    function marketSell(
        uint256 marketId,
        uint256 outcome,
        int128 sharesAmount,
        uint256 minAmountOut
    ) external returns (uint256 amountOut) {
        require(block.timestamp >= markets[marketId].startTimestamp, "Market not started");
        require(block.timestamp <= markets[marketId].endTimestamp, "Market already ended");

        // Send remote SELL to market contract (to be assigned to the sender)
        amountOut = IPrecogMarket(markets[marketId].market)._sell(outcome, sharesAmount, msg.sender);

        // Check that the sell price was equal or higher seller expected
        require(amountOut >= minAmountOut, "Min amount reach!");

        return amountOut;
    }

    /**
     * @notice Redeems the total sender shares in the desired market
     * @param marketId unique market identifier to trade
     * @return shares Number of shares redeemed
     */
    function marketRedeemShares(uint256 marketId) external returns (uint256 shares) {
        return IPrecogMarket(markets[marketId].market)._redeem(msg.sender);
    }

    /**
     * @notice Gets the cost of buying the specified amount of outcome shares in the desired market
     * @param marketId unique market identifier to trade
     * @param outcome The outcome for which tokens are being bought
     * @param sharesAmount Number of outcome shares to buy (as signed 64.64-bit fixed point number)
     * @return tokenCost The token cost amount (as a signed 64.64-bit fixed point number)
     */
    function marketBuyPrice(uint256 marketId, uint256 outcome, int128 sharesAmount) external view
    returns (int128 tokenCost) {
        return IPrecogMarket(markets[marketId].market).buyPrice(outcome, sharesAmount);
    }

    /**
     * @notice Gets the return from selling the specified amount of outcome shares in the desired market
     * @param marketId unique market identifier to trade
     * @param outcome The outcome for which shares are being sold
     * @param sharesAmount The number of outcome shares to sell (as signed 64.64-bit fixed point number)
     * @return tokenReturn The token return amount (as a signed 64.64-bit fixed point number)
     */
    function marketSellPrice(uint256 marketId, uint256 outcome, int128 sharesAmount) external view
    returns (int128 tokenReturn) {
        return IPrecogMarket(markets[marketId].market).sellPrice(outcome, sharesAmount);
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
        return IPrecogMarket(markets[marketId].market).getPrices();
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
        IPrecogMarket createdMarket = IPrecogMarket(markets[marketId].market);

        // Get market result info
        result = createdMarket.result();
        closed = createdMarket.closeTimestamp();
        reporter = createdMarket.oracle();
        return (result, closed, reporter);
    }

    /**
     * @notice Gets market account shares summary of the desired market
     * @dev Helper function to show market info about an specific account
     * @param marketId unique market identifier to trade
     * @param account The address of the account with shares of the market
     * @return buys Total amount of Buys in the market
     * @return sells Total amount of Sells in the market
     * @return deposited Total amount of collateral deposited in the market
     * @return withdrew Total amount of collateral withdrew from the market
     * @return redeemed Total amount of collateral redeemed from the market
     * @return balances Account shares balances by outcome
     */
    function marketAccountShares(uint256 marketId, address account) external view
    returns (uint256 buys, uint256 sells, uint256 deposited, uint256 withdrew, uint256 redeemed,
        uint256[] memory balances) {
        IPrecogMarket createdMarket = IPrecogMarket(markets[marketId].market);
        // Get sharesInfo on received account for selected market
        (buys, sells, deposited, withdrew, redeemed) = createdMarket.accountShares(account);
        // Get outcome balances on received account for selected market
        balances = createdMarket.getAccountOutcomeBalances(account);
    }

    /**
     * @notice Gets the current market state info of the desired market
     * @dev Helper function to show general market shares info
     * @param marketId unique market identifier to trade
     * @return totalShares Current total shares minted for all outcomes of the market
     * @return sharesBalances All shares balances (indexed by outcome)
     * @return cost Current liquidity of the market
     * @return totalBuys Buys counter of the market
     * @return totalSells Sells counter of the market
     */
    function marketSharesInfo(uint256 marketId) external view
    returns (int128 totalShares, int128[] memory sharesBalances, int128 cost, uint256 totalBuys, uint256 totalSells) {
        IPrecogMarket createdMarket = IPrecogMarket(markets[marketId].market);
        (totalShares, sharesBalances, cost, totalBuys, totalSells) = createdMarket.getMarketInfo();
    }

    /**
     * @notice Gets the collateral info of the desired market
     * @dev Helper function to show data of a collateral of a market
     * @param marketId unique market identifier to trade
     * @return collateral Contract address of the market
     * @return name Token name of the market
     * @return symbol Token symbol of the market
     * @return decimals Token decimals of the market
     */
    function marketCollateralInfo(uint256 marketId) external view
    returns (address collateral, string memory name, string memory symbol, uint8 decimals) {
        IPrecogMarket createdMarket = IPrecogMarket(markets[marketId].market);
        IPrecogToken _collateral = IPrecogToken(createdMarket.token());
        return (address(_collateral), _collateral.name(), _collateral.symbol(), _collateral.decimals());
    }

    /**
     * @notice Helper function to check market close state
     */
    function isClosedMarket(uint256 marketId) external view returns (bool) {
        return IPrecogMarket(markets[marketId].market).closeTimestamp() > block.timestamp;
    }

    /**
     * @notice Helper function to check if some account has already redeemed market shares
     */
    function hasRedeemedShares(uint256 marketId, address account) external view returns (bool) {
        (,,,,uint256 redeemed) = IPrecogMarket(markets[marketId].market).accountShares(account);
        return redeemed > 0;
    }

    /**
     * @notice Helper function to check if some account has already claim current season tokens
     */
    function hasClaimed(address account, uint256 user) external view returns (bool) {
        return accountTokenClaims[account].claimedTimestamp != 0 || userTokenClaims[user].claimedTimestamp != 0;
    }

    // Whitelisted functions: Only caller & Only market creator
    function claimToken(address account, uint256 user, uint256 amount) external onlyCaller returns (bool) {
        // Validate token claim
        require(accountTokenClaims[account].claimedTimestamp == 0, "Account already claimed");
        require(userTokenClaims[user].claimedTimestamp == 0, "User already claimed");
        MiningSeason storage season = miningSeasons[currentSeason];
        if (season.startTimestamp > 0) {
            require(block.timestamp >= season.startTimestamp, "Season not started");
            require(block.timestamp < season.endTimestamp, "Season already ended");
            require(amount <= season.maxUserClaim, "Invalid user claim amount");
            require(amount.add(season.claimedAmount) <= season.maxTotalClaim, "Season max token claims");
            require(amount.add(season.mintedAmount) <= season.maxTotalMint, "Season max token mints");
        }

        // Register current token claim
        TokenClaim memory claim = TokenClaim({
            account: account,
            user: user,
            claimedAmount: amount,
            claimedTimestamp: block.timestamp
        });
        accountTokenClaims[account] = claim;
        userTokenClaims[user] = claim;
        season.claimedAmount = season.claimedAmount.add(amount);
        season.mintedAmount = season.mintedAmount.add(amount);

        // Mint tokens to received account
        IPrecogToken(token).mint(account, amount);

        emit TokensClaimed(account, user, amount, block.timestamp);
        return true;
    }

    function createMarket(
        string memory name,
        string memory description,
        string memory category,
        string[] memory outcomes,
        uint256 startTimestamp,
        uint256 endTimestamp,
        address creator,
        uint256 funding,
        uint256 overround
    ) external onlyCaller returns (uint256 newMarketId) {
        // Mint tokens to seed the new market
        IPrecogToken(token).mint(address(this), funding);

        // Pack all received information (with defaults), create new market and return new market id
        MarketInfo memory marketInfo = MarketInfo(
            name, description, category, arrayToCSV(outcomes), startTimestamp, endTimestamp, creator, address(0)
        );
        MarketConfig memory marketConfig = MarketConfig(
            outcomes.length, // Total number of outcomes
            funding,         // Initial supply of the market
            overround,       // AMM profit margin
            token,           // collateralToken: Precog Token
            address(this),   // collateralFunder: This contract
            oracle           // marketOracle: Preset oracle
        );
        return _createMarket(marketInfo, marketConfig);
    }

    function createCustomMarket(
        string memory name,
        string memory description,
        string memory category,
        string[] memory outcomes,
        uint256 startTimestamp,
        uint256 endTimestamp,
        address creator,
        uint256 funding,
        uint256 overround,
        address collateralToken,
        address collateralFunder,
        address marketOracle
    ) public onlyMarketCreator returns (uint256 newMarketId) {
        // Pack all received information, create new market and return new market id
        MarketInfo memory marketInfo = MarketInfo(
            name, description, category, arrayToCSV(outcomes), startTimestamp, endTimestamp, creator, address(0)
        );
        MarketConfig memory marketConfig = MarketConfig(
            outcomes.length, funding, overround, collateralToken, collateralFunder, marketOracle
        );
        return _createMarket(marketInfo, marketConfig);
    }

    function _createMarket(MarketInfo memory info, MarketConfig memory config) internal returns (uint256 newMarketId) {
        // Deploy a new market contract and initialize it with the collateral token
        address newMarketAddress = Clones.clone(market);
        IPrecogMarket newMarket = IPrecogMarket(newMarketAddress);
        newMarket.initialize(config.collateralToken);

        // Get funding amount to seed the new market (optimization: except in a self-funder usecase)
        if (config.collateralFunder != address(this)) {
            IERC20(config.collateralToken).safeTransferFrom(config.collateralFunder, address(this), config.funding);
        }
        // Pre approve all trades with
        IERC20(config.collateralToken).approve(newMarketAddress, type(uint256).max);

        // Get new Id and Setup deployed new market
        newMarketId = createdMarkets;
        newMarket.setup(newMarketId, config.marketOracle, config.totalOutcomes, config.funding, config.overround);
        newMarket.updateDates(info.startTimestamp, info.endTimestamp);

        // Save created market address in received info and save it in local storage (indexed by id)
        info.market = newMarketAddress;
        markets[newMarketId] = info;

        // Increase created markets counter and return new market id
        createdMarkets = createdMarkets.add(1);

        emit MarketCreated(info.creator, newMarketId, newMarketAddress);
        return newMarketId;
    }

    function arrayToCSV(string[] memory array) internal pure returns (string memory) {
        bytes memory csvBytes;
        for (uint i = 0; i < array.length; i++) {
            csvBytes = abi.encodePacked(csvBytes, array[i]);
            if (i < array.length - 1) {
                csvBytes = abi.encodePacked(csvBytes, ",");
            }
        }
        return string(csvBytes);
    }

    // Whitelisted functions: Only admin
    function addMarketCreator(address account) external onlyAdmin {
        grantRole(MARKET_CREATOR_ROLE, account);
    }

    function removeMarketCreator(address account) external onlyAdmin {
        revokeRole(MARKET_CREATOR_ROLE, account);
    }

    function addCaller(address account) external onlyAdmin {
        grantRole(CALLER_ROLE, account);
    }

    function removeCaller(address account) external onlyAdmin {
        revokeRole(CALLER_ROLE, account);
    }

    function addAdmin(address account) external onlyAdmin {
        grantRole(ADMIN_ROLE, account);
    }

    function removeAdmin(address account) external onlyAdmin {
        revokeRole(ADMIN_ROLE, account);
    }

    function updateCurrentSeason(uint256 seasonIndex) external onlyAdmin {
        currentSeason = seasonIndex;
    }

    function setMiningSeason(
        uint256 seasonIndex,
        uint256 startTimestamp,
        uint256 endTimestamp,
        uint256 maxUserClaim,
        uint256 maxTotalClaim,
        uint256 maxTotalMint,
        uint256 claimedAmount,
        uint256 mintedAmount
    ) external onlyAdmin {
        miningSeasons[seasonIndex] = MiningSeason({
            startTimestamp: startTimestamp,
            endTimestamp: endTimestamp,
            maxUserClaim: maxUserClaim,
            maxTotalClaim: maxTotalClaim,
            maxTotalMint: maxTotalMint,
            claimedAmount: claimedAmount,
            mintedAmount: mintedAmount
        });
    }

    function setBaseOracle(address _oracle) external onlyAdmin {
        oracle = _oracle;
    }

    function setBaseMarket(address _market) external onlyAdmin {
        market = _market;
    }

    function updateMarket(
        uint256 id,
        string memory name,
        string memory description,
        string memory category,
        string[] memory outcomes,
        uint256 startTimestamp,
        uint256 endTimestamp,
        address marketCreator,
        address marketOracle
    ) external onlyAdmin {
        if (bytes(name).length > 0) {
            markets[id].name = name;
        }
        if (bytes(description).length > 0) {
            markets[id].description = description;
        }
        if (bytes(category).length > 0) {
            markets[id].category = category;
        }
        if (outcomes.length > 0) {
            // Only updates outcome labels (not total possible outcomes)
            markets[id].outcomes = arrayToCSV(outcomes);
        }
        if (marketCreator != address(0)) {
            markets[id].creator = marketCreator;
        }
        if (marketOracle != address(0)) {
            IPrecogMarket(markets[id].market).updateOracle(marketOracle);
        }
        bool updateDates = false;
        if (startTimestamp > 0) {
            markets[id].startTimestamp = startTimestamp;
            updateDates = true;
        }
        if (endTimestamp > 0) {
            markets[id].endTimestamp = endTimestamp;
            updateDates = true;
        }
        if (updateDates) {
            IPrecogMarket(markets[id].market).updateDates(markets[id].startTimestamp, markets[id].endTimestamp);
        }
    }

    function marketWithdraw(uint256 marketId, address marketToken) external onlyAdmin {
        IPrecogMarket(markets[marketId].market).withdraw(marketToken);
    }

    function marketTransferOwnership(uint256 marketId, address newOwner) external onlyAdmin {
        IPrecogMarket(markets[marketId].market).transferOwnership(newOwner);
    }

    function updateTokenClaim(address account, uint256 amount, uint256 timestamp) external onlyAdmin {
        // Used to reset token claims
        accountTokenClaims[account].claimedAmount = amount;
        accountTokenClaims[account].claimedTimestamp = timestamp;
        uint256 user = accountTokenClaims[account].user;
        userTokenClaims[user].claimedAmount = amount;
        userTokenClaims[user].claimedTimestamp = timestamp;
    }

    function precogMint(address to, uint256 amount) external onlyAdmin {
        // Validate token mint
        MiningSeason storage season = miningSeasons[currentSeason];
        if (season.startTimestamp > 0) {
            require(amount.add(season.mintedAmount) <= season.maxTotalMint, "Season max token mints");
        }

        // Register token mint
        season.mintedAmount = season.mintedAmount.add(amount);

        // Mint tokens to received account
        IPrecogToken(token).mint(to, amount);

        emit TokensMinted(to, amount, block.timestamp);
    }

    function precogBurn(address from, uint256 amount) external onlyAdmin {
        IPrecogToken(token).burn(from, amount);
    }

    function precogTransferOwnership(address newPrecogMaster) external onlyAdmin {
        IPrecogToken(token).transferOwnership(newPrecogMaster);
    }

    function withdraw(address _token) public onlyAdmin {
        if (_token == address(0)) {
            payable(msg.sender).transfer(address(this).balance);
        } else {
            IERC20(_token).safeTransfer(msg.sender, IERC20(_token).balanceOf(address(this)));
        }
    }
}
