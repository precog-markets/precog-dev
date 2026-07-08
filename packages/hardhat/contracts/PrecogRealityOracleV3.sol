// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;
pragma abicoder v2;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./IPrecogMarketV8.sol";
import "./IRealityETH.sol";

/**
 * @title PrecogOracleRealityV3: An smart oracle implementation to report results on Precog Markets using Reality.eth
 * @author Marto (https://github.com/0xMarto) & Mati (https://github.com/0xAstraea)
 * @dev Feel free to make any adjustments to the code (DMs are open @0xMarto)
 */
contract PrecogRealityOracleV3 is AccessControl {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Constants
    bytes32 public constant ADMIN_ROLE = keccak256("ADMIN_ROLE");
    bytes32 public constant REPORTER_ROLE = keccak256("REPORTER_ROLE");

    // State objects
    struct MarketInfo {
        address market;       // Market contract address
        bytes32 questionId;   // Question Identifier on Reality.eth contract
        string outcomes;      // CSV of valid outcomes labels
        bool answered;        // Flag that signal that a answer was submitted to Reality.eth
        uint256 resultIndex;  // Market final result index (calculated computing all reported results)
        string resultLabel;   // Market final result label (calculated computing all reported results)
    }

    // Public variables
    address public precogMaster;
    address public reality;
    address public arbitrator;
    uint256 public maxAnswerBond;
    mapping(uint256 => MarketInfo) public markets;
    mapping(uint256 => mapping(address => bool)) public marketReporters;

    // Modifiers
    modifier onlyAdmin() {
        require(hasRole(ADMIN_ROLE, msg.sender), "Only Admin");
        _;
    }

    modifier onlyGlobalReporter() {
        require(hasRole(REPORTER_ROLE, msg.sender), "Only Reporter");
        _;
    }

    modifier onlyMarketReporter(uint256 marketId) {
        require(isMarketReporter(marketId, msg.sender), "Only Market Reporter");
        _;
    }

    /**
     * @notice Initializes the PrecogRealityOracleV1 contract
	 * @param initialAdmin Address that will be granted the first Admin account
	 */
    constructor(address initialAdmin) {
        // Grant DEFAULT_ADMIN_ROLE to the initial admin (this is the admin to the ADMIN_ROLE list)
        _setupRole(DEFAULT_ADMIN_ROLE, initialAdmin);

        // Set ADMIN_ROLE as admin of REPORTER_ROLE list
        _setRoleAdmin(REPORTER_ROLE, ADMIN_ROLE);

        // Grant ADMIN_ROLE to initial Admin (this enables to call "addAdmin" helper function)
        _setupRole(ADMIN_ROLE, initialAdmin);
    }

    /**
     * @notice Registers a new market with this oracle
	 * @dev Validates market ownership and oracle assignment before registration
	 *      Requirements:
	 *      - Caller must have REPORTER_ROLE
	 *      - Market must be owned by precogMaster
	 *      - Market must have this contract set as its oracle
	 *      - Market ID must not be already registered
	 * @param id Unique identifier for the market
	 * @param market Address of the PrecogMarket contract
	 * @param initialReporters Optional array of addresses that can report for this specific market
	 */
    function registerMarket(
        uint256 id,
        address market,
        address[] calldata initialReporters
    ) external onlyGlobalReporter {
        // Verify that the current was created by the current Precog Master
        require(IPrecogMarketV8(market).owner() == precogMaster, "Invalid master");

        // Verify that the current oracle of the Market is this contract (to be able to report results)
        require(IPrecogMarketV8(market).oracle() == address(this), "Invalid market");

        // Verify that the received market id is not already registered
        require(markets[id].market == address(0), "Already register market");

        // Allocate storage slot for the market
        markets[id] = MarketInfo(
            market,
            bytes32(0),
            "",
            false,
            0,
            ""
        );

        // Register specific reporters for this market (only if the list is provided)
        if (initialReporters.length > 0) {
            for (uint256 i = 0; i < initialReporters.length; i++) {
                marketReporters[id][initialReporters[i]] = true;
            }
        }
    }

    /**
     * @notice Opens a new question in Reality.eth for a specific market
	 * @dev This function require that the sender `isMarketReporter`
	 * @param marketId The market this question belongs to
	 * @param bounty Amount of ETH to offer as question bounty
	 * @param templateId Reality.eth template ID defining question structure
	 * @param question The actual question text
	 * @param outcomes Array of possible answer options
	 * @param category Question category for organization
	 * @param timeout Duration in seconds before question can be answered
	 * @param startTime Timestamp when question becomes answerable
	 * @return questionId Unique identifier of the created question in Reality.eth
	 */
    function openQuestion(
        uint256 marketId,
        uint256 bounty,
        uint32 templateId,
        string calldata question,
        string[] calldata outcomes,
        string calldata category,
        uint32 timeout,
        uint32 startTime
    ) public payable onlyMarketReporter(marketId) returns (bytes32 questionId) {
        // Verify that the market is already registered
        require(isMarketRegistered(marketId), "Market not registered");

        // Verify market is already registered
        require(markets[marketId].questionId == bytes32(0), "Question already open");

        // Open a question in Reality.eth
        questionId = IRealityETH(reality).askQuestion{value: bounty}(
            templateId,
            _formatQuestion(question, outcomes, category),
            arbitrator,
            timeout,
            startTime,
            0 // Fixed nonce (as is not needed as unique identifier)
        );

        // Save the questionId and outcomes to the market
        markets[marketId].questionId = questionId;
        markets[marketId].outcomes = _arrayToCSV(outcomes);

        // Return new question id
        return questionId;
    }

    /**
     * @notice Submits an answer to an open Reality.eth question for a market
	 * @dev This function require that the sender `isMarketReporter`
	 * @param marketId The market whose question is being answered
	 * @param answer The answer being submitted (as bytes32)
	 * @param maxPrevious Maximum previous bond to calculate minimum new bond
	 * @param bond Amount of ETH to bond with this answer
	 */
    function answerOpenQuestion(
        uint256 marketId,
        bytes32 answer,
        uint256 maxPrevious,
        uint256 bond
    ) public payable onlyMarketReporter(marketId) {
        // Verify that the market is already registered
        require(isMarketRegistered(marketId), "Market not registered");

        // Get and check question id for received market
        bytes32 questionId = markets[marketId].questionId;
        require(questionId != bytes32(0), "Market Id not found");

        // Verify that this market do not have an answer
        require(!markets[marketId].answered, "Market already answered");

        // Verify than received bond is not higher than expected
        require(bond <= maxAnswerBond, "Answer bond too high");

        // Submit an answer in name of another address in Reality.eth
        IRealityETH(reality).submitAnswer{value: bond}(
            questionId,
            answer,
            maxPrevious
        );

        // Register answer on Market
        markets[marketId].answered = true;
    }

    /**
     * @notice Submit a Market result by opening question and answering it (to be disputed or validate it)
	 * @dev This function require that the sender `isMarketReporter`
	 * @return questionId The unique identifier for the question
	 */
    function submitResult(
        uint256 marketId,
        uint32 templateId,
        string calldata question,
        string[] calldata outcomes,
        string calldata category,
        uint32 timeout,
        uint32 startTime,
        bytes32 answer,
        uint256 bond
    ) external payable onlyMarketReporter(marketId) returns (bytes32 questionId) {
        // Open a question in Reality.eth with custom question text
        questionId = openQuestion(
            marketId,
            0,  // Question Bounty = 0, fixed because we send `bond` in the first answer
            templateId,
            question,
            outcomes,
            category,
            timeout,
            startTime
        );

        // Submit answer with the remaining value (after bounty is spent)
        answerOpenQuestion(
            marketId,
            answer,
            0, // MaxPrevious Bond = 0, fixed because it is the first answer
            bond // Answer Bond (the remainder of the tx value)
        );

        return questionId;
    }

    /**
     * @notice Report result validated by Reality.eth to corresponding Market
     * @dev Also store validated result in local storage to be audited
	 */
    function reportResult(uint256 marketId) external onlyGlobalReporter {
        bytes32 questionId = markets[marketId].questionId;
        require(questionId != bytes32(0), "Market Id not found");

        // Verify that the question for the received market is finalized on Reality.eth
        require(IRealityETH(reality).isFinalized(questionId), "Invalid question");

        // Verify that the market is not already being reported
        require(markets[marketId].resultIndex == 0, "Market already reported");

        bytes32 answer = IRealityETH(reality).getBestAnswer(questionId);
        uint256 answerIndex = uint256(answer); // This is the Reality.eth 0-based index result

        // Get the label for this index from the outcomes
        string[] memory outcomes = _csvToArray(markets[marketId].outcomes);

        require(answerIndex < outcomes.length, "Invalid answer");
        string memory resultLabel = outcomes[answerIndex];

        // The PrecogMarket contract expects a 1-based index for the result
        uint256 resultIndex = answerIndex + 1;

        // Set market result on PrecogMarket external contract
        IPrecogMarketV8(markets[marketId].market).reportResult(marketId, resultIndex);

        // Set result index and label on local Market
        markets[marketId].resultIndex = resultIndex;
        markets[marketId].resultLabel = resultLabel;
    }

    /**
     * @notice Open a question in Reality.eth without a local register market
	 * @return questionId The unique identifier for the question
	 */
    function realityOpenQuestion(
        uint256 bounty,
        uint32 templateId,
        string calldata question,
        string[] calldata outcomes,
        string calldata category,
        uint32 timeout,
        uint32 startTime,
        uint256 nonce,
        uint256 minBond
    ) public payable onlyGlobalReporter returns (bytes32 questionId) {
        // Build the formatted question (internal helper will allocate memory)
        string memory formattedQuestion = _formatQuestion(question, outcomes, category);

        questionId = IRealityETH(reality).askQuestionWithMinBond{value: bounty}(
            templateId,
            formattedQuestion,
            arbitrator,
            timeout,
            startTime,
            nonce,
            minBond
        );

        return questionId;
    }

    /**
     * @notice Submit an answer in name of another address in Reality.eth
	 * @param questionId The question Id to answer
	 * @param answer The answer to submit
	 * @param maxPrevious Maximum number of previous answers to consider
	 * @param answerer The address submitting the answer for
	 */
    function realitySubmitAnswerFor(
        uint256 bond,
        bytes32 questionId,
        bytes32 answer,
        uint256 maxPrevious,
        address answerer
    ) public payable onlyGlobalReporter {
        IRealityETH(reality).submitAnswerFor{value: bond}(
            questionId,
            answer,
            maxPrevious,
            answerer
        );
    }

    /**
     * @notice Assign winnings in Reality.eth of a question, to later claim them by the answerer
	 * @param questionId The question Id to claim winnings for
	 * @param historyHashes The history hashes for the claim
	 * @param answerers The addresses involved in the claim
	 * @param bonds The bonds for the claim
	 * @param answers The answers for the claim
	 */
    function realityClaimWinnings(
        bytes32 questionId,
        bytes32[] calldata historyHashes,
        address[] calldata answerers,
        uint256[] calldata bonds,
        bytes32[] calldata answers
    ) external onlyGlobalReporter {
        IRealityETH(reality).claimWinnings(
            questionId,
            historyHashes,
            answerers,
            bonds,
            answers
        );
    }

    /**
     * @notice Executes a withdraw on Reality.eth contract
	 */
    function realityWithdraw() external onlyGlobalReporter {
        IRealityETH(reality).withdraw();
    }

    function marketRedeemBatch(
        uint256 marketId,
        address[] calldata accounts
    ) external onlyGlobalReporter returns (uint256) {
        return IPrecogMarketV8(markets[marketId].market).redeemBatch(accounts);
    }

    function marketEnableDatesUpdate(uint256 marketId) external onlyGlobalReporter {
        IPrecogMarketV8(markets[marketId].market).enableDatesUpdate(marketId);
    }

    /**
     * @notice Check if a market is already registered on this oracle
	 */
    function isMarketRegistered(uint256 marketId) public view returns (bool) {
        return markets[marketId].market != address(0);
    }

    /**
     * @notice Check if an account is allowed to summit/report result for a specific Market
	 */
    function isMarketReporter(
        uint256 marketId,
        address account
    ) public view returns (bool) {
        // Test the account is reporter for this specific market or is a global reporter
        return marketReporters[marketId][account] || hasRole(REPORTER_ROLE, account);
    }

    /**
     * @notice Returns the permissions status of a given account.
     * @param account The address of the account to check.
     * @return isAdmin Indicates whether the account has the admin role.
     * @return isGlobalReporter Indicates whether the account has the reporter role.
     */
    function getAccountPermissions(address account) external view returns (bool isAdmin, bool isGlobalReporter) {
        isAdmin = hasRole(ADMIN_ROLE, account);
        isGlobalReporter = hasRole(REPORTER_ROLE, account);
        return (isAdmin, isGlobalReporter);
    }

    /**
     * @notice Returns the current state of a given market.
     * @param marketId The market Id to get the current state parameters
     * @return isRegistered Indicates whether the market is registered in the system.
     * @return isAnswered Indicates whether the market has been answered by a reporter.
     * @return isFinalized Indicates whether the market answer is final and the result can be reported.
     * @return isReported Indicates whether the market's result has been reported.
     */
    function getMarketState(uint256 marketId) external view returns (
        bool isRegistered,
        bool isAnswered,
        bool isFinalized,
        bool isReported
    ) {
        // Calculate market states for the received market id
        isRegistered = markets[marketId].market != address(0);
        isAnswered = markets[marketId].answered;
        isFinalized = IRealityETH(reality).isFinalized(markets[marketId].questionId);
        isReported = markets[marketId].resultIndex > 0;
        return (isRegistered, isAnswered, isFinalized, isReported);
    }

    /**
     * @notice Get the Reality.eth balance of this contract
	 */
    function getRealityBalance() external view returns (uint256) {
        return IRealityETH(reality).balanceOf(address(this));
    }

    /**
     * @notice Get comprehensive information about a Reality Question starting settings
	 * @param marketId The market Id to get information for
	 */
    function getRealityQuestionInfo(uint256 marketId) external view returns (
        bytes32 questionId, uint32 openingTS, uint32 timeout, uint256 bounty, uint256 bond
    ) {
        // Get Reality question id for received market
        questionId = markets[marketId].questionId;

        // Validate existence of received market
        require(questionId != bytes32(0), "Market Id not found");

        // Instance Reality contract and get all needed info
        IRealityETH realityEth = IRealityETH(reality);
        openingTS = realityEth.getOpeningTS(questionId);
        timeout = realityEth.getTimeout(questionId);
        bounty = realityEth.getBounty(questionId);
        bond = realityEth.getBond(questionId);

        // Return Reality info about received market id
        return (questionId, openingTS, timeout, bounty, bond);
    }

    /**
     * @notice Get information about a Question resolution status
	 * @param marketId The Market Id  to get Reality result info
	 * @return questionId question identifier
	 * @return answer the current last or final answer value (as bytes32 index)
	 * @return finalizeTS The pending time to reach the answer timeout
	 * @return lastHash The history hash of the last answer
	 * @return isFinalized Whether the question is finalized
	 * @return isPendingArbitration Whether the question is pending arbitration
	 */
    function getRealityResultInfo(uint256 marketId) external view returns (
        bytes32 questionId,
        bytes32 answer,
        uint32 finalizeTS,
        bytes32 lastHash,
        bool isFinalized,
        bool isPendingArbitration
    ) {
        // Get Reality question id for received market
        questionId = markets[marketId].questionId;

        // Validate existence of received market
        require(questionId != bytes32(0), "Market Id not found");

        IRealityETH realityEth = IRealityETH(reality);
        answer = realityEth.getBestAnswer(questionId);
        finalizeTS = realityEth.getFinalizeTS(questionId);
        lastHash = realityEth.getHistoryHash(questionId);
        isFinalized = realityEth.isFinalized(questionId);
        isPendingArbitration = realityEth.isPendingArbitration(questionId);

        return (questionId, answer, finalizeTS, lastHash, isFinalized, isPendingArbitration);
    }

    /**
     * @notice Internal helper function that formats a question string according to Reality.eth specifications
	 * @dev Combines question text, outcomes, and category using the Reality.eth separator '␟'
	 * @param question The main question text to be asked
	 * @param outcomes Array of possible answer options that will be presented to users
	 * @param category The classification category for the question
	 * @return formatedQuestion A output string in the format: "question␟['outcome1','outcome2',...]␟category␟"
	 */
    function _formatQuestion(
        string calldata question,
        string[] calldata outcomes,
        string calldata category
    ) internal pure returns (string memory formatedQuestion) {
        // Build outcome CSV string
        bytes memory outcomesBytes = bytes("");
        if (outcomes.length > 0) {
            outcomesBytes = abi.encodePacked('"', outcomes[0], '"');
            for (uint256 i = 1; i < outcomes.length; i++) {
                outcomesBytes = abi.encodePacked(outcomesBytes, ',"', outcomes[i], '"');
            }
        }
        // Build question string based on Reality custom format
        formatedQuestion = string(
            abi.encodePacked(question, unicode"␟", string(outcomesBytes), unicode"␟", category, unicode"␟")
        );
        return formatedQuestion;
    }

    /**
     * @notice Converts an array of strings into a comma-separated string
	 * @dev Example: ["Yes", "No", "Maybe"] => "Yes,No,Maybe"
	 * @param array The array of strings to join
	 * @return A single string with all elements joined by commas, or empty string if array is empty
	 */
    function _arrayToCSV(string[] memory array) internal pure returns (string memory) {
        if (array.length == 0) {
            return "";
        }

        bytes memory csvBytes = bytes(array[0]);
        for (uint i = 1; i < array.length; i++) {
            csvBytes = abi.encodePacked(csvBytes, ",", array[i]);
        }
        return string(csvBytes);
    }

    /**
     * @notice Splits a comma-separated string into an array of individual strings
	 * @dev Example: "Yes,No,Maybe" => ["Yes", "No", "Maybe"]
	 * @param csv The comma-separated string to split
	 * @return An array of individual strings, or empty array if input is empty
	 */
    function _csvToArray(string memory csv) internal pure returns (string[] memory) {
        bytes memory csvBytes = bytes(csv);
        if (csvBytes.length == 0) {
            return new string[](0);
        }

        // 1. Count how many elements we have
        uint256 count = 1;
        for (uint256 i = 0; i < csvBytes.length; i++) {
            if (csvBytes[i] == ",") {
                count++;
            }
        }

        // 2. Create the array and populate it
        string[] memory result = new string[](count);
        uint256 resultIndex = 0;
        uint256 startIndex = 0;

        for (uint256 i = 0; i < csvBytes.length; i++) {
            if (csvBytes[i] == ",") {
                result[resultIndex] = _substring(csvBytes, startIndex, i);
                resultIndex++;
                startIndex = i + 1;
            }
        }

        // Add the last element
        result[resultIndex] = _substring(csvBytes, startIndex, csvBytes.length);

        return result;
    }

    /**
     * @notice Extracts a portion of a bytes array into a new string
	 * @dev Helper function for _csvToArray to extract individual elements
	 * @param source The source bytes array to extract from
	 * @param start The starting index (inclusive) in the source array
	 * @param end The ending index (exclusive) in the source array
	 * @return A new string containing the extracted bytes
	 */
    function _substring(bytes memory source, uint256 start, uint256 end) internal pure returns (string memory) {
        uint256 len = end - start;
        bytes memory dest = new bytes(len);
        for (uint256 i = 0; i < len; i++) {
            dest[i] = source[start + i];
        }
        return string(dest);
    }

    /**
     * @notice Accept ETH for from any Transfer, Send or Call with value
	 */
    receive() external payable {}

    // Whitelisted functions: Only admin
    function setPrecogMaster(address master) external onlyAdmin {
        precogMaster = master;
    }

    function setReality(address realityProxy) external onlyAdmin {
        reality = realityProxy;
    }

    function setArbitrator(address arbitratorProxy) external onlyAdmin {
        arbitrator = arbitratorProxy;
    }

    function setMaxAnswerBond(uint256 maxBond) external onlyAdmin {
        maxAnswerBond = maxBond;
    }

    function unregisterMarket(uint256 id, address market) external onlyAdmin {
        require(markets[id].market == market, "Invalid market");
        delete markets[id];
    }

    function addMarketReporter(
        uint256 marketId,
        address account
    ) external onlyAdmin {
        // Verify that the account is not already registered (to avoid reset 'submitted' flag)
        require(!marketReporters[marketId][account], "Invalid reporter");

        // Register account as reporter for the received market id
        marketReporters[marketId][account] = true;
    }

    function removeMarketReporter(
        uint256 marketId,
        address account
    ) external onlyAdmin {
        // Verify that the account is already registered as reporter
        require(marketReporters[marketId][account], "Invalid reporter");

        // Disable account as allowed reporter for the received market id
        marketReporters[marketId][account] = false;
    }

    function addReporter(address account) external onlyAdmin {
        grantRole(REPORTER_ROLE, account);
    }

    function removeReporter(address account) external onlyAdmin {
        revokeRole(REPORTER_ROLE, account);
    }

    function addAdmin(address account) external onlyAdmin {
        grantRole(ADMIN_ROLE, account);
    }

    function removeAdmin(address account) external onlyAdmin {
        revokeRole(ADMIN_ROLE, account);
    }

    function withdraw(address _token) public onlyAdmin {
        if (_token == address(0)) {
            payable(msg.sender).transfer(address(this).balance);
        } else {
            IERC20(_token).safeTransfer(
                msg.sender,
                IERC20(_token).balanceOf(address(this))
            );
        }
    }
}
