// SPDX-License-Identifier: MIT
pragma solidity 0.7.6;

/**
 * @title FakeRealityETH
 * @dev Mock implementation of the RealityETH oracle
 * @notice This contract simulates the behavior of the Reality.eth oracle but does not
 * include the full logic for all methods. It is intended for use in test environments only.
 */

import "./IRealityETH.sol";

contract FakeRealityETH is IRealityETH {
    mapping(bytes32 => bytes32) public bestAnswers;
    mapping(bytes32 => bool) public finalizedStatus;
    mapping(address => uint256) public balances;
    mapping(bytes32 => uint256) public bounties;
    mapping(bytes32 => uint32) public timeouts;
    mapping(bytes32 => address) public arbitrators;
    mapping(bytes32 => uint256) public minBonds;
    mapping(bytes32 => string) public questions;  // Store question text by questionId
    mapping(bytes32 => bool) public pendingArbitration;  // Track pending arbitration status
    mapping(bytes32 => uint32) public finalizeTimestamps;  // Track finalize timestamps
    address payable public lastWithdrawalRecipient;
    uint256 public questionFee;
    bytes32 public lastQuestionId;

    function askQuestion(
        uint256 template_id,
        string calldata question,
        address arbitrator,
        uint32 timeout,
        uint32 opening_ts,
        uint256 nonce
    ) external payable override returns (bytes32 question_id) {
        require(template_id != 0, "Empty template");
        require(timeout != 0, "Empty timeout");
        require(opening_ts != 0, "Empty opening ts");
        question_id = keccak256(abi.encodePacked(question, nonce, block.timestamp));
        bounties[question_id] = msg.value;
        timeouts[question_id] = timeout;
        arbitrators[question_id] = arbitrator;
        questions[question_id] = question;
        // Set initial finalize timestamp: current block time + timeout
        finalizeTimestamps[question_id] = uint32(block.timestamp + timeout);
        lastQuestionId = question_id;
        return question_id;
    }
    
    function submitAnswerFor(
        bytes32 question_id,
        bytes32 answer,
        uint256 max_previous,
        address answerer
    ) external payable override {
        require(max_previous >= 0, "Empty max previous");
        require(answerer != address(0), "Empty answerer");
        bestAnswers[question_id] = answer;
        // Update finalize timestamp: current time + timeout
        finalizeTimestamps[question_id] = uint32(block.timestamp + timeouts[question_id]);
    }

    function isFinalized(bytes32 question_id) external view override returns (bool) {
        return finalizedStatus[question_id];
    }

    function getBestAnswer(bytes32 question_id) external view override returns (bytes32) {
        return bestAnswers[question_id];
    }
    
    function balanceOf(address account) external view override returns (uint256) {
        return balances[account];
    }

    function getBounty(bytes32 question_id) external view override returns (uint256) {
        return bounties[question_id];
    }
    
    function getBond(bytes32) external pure override returns (uint256) {
        return 0; // for simplicity
    }

    function getTimeout(bytes32 question_id) external view override returns (uint32) {
        return timeouts[question_id];
    }

    function getOpeningTS(bytes32) external view override returns (uint32) {
        return uint32(block.timestamp);
    }
    
    function getFinalizeTS(bytes32 question_id) external view override returns (uint32) {
        return finalizeTimestamps[question_id];
    }

    function getHistoryHash(bytes32) external pure override returns (bytes32) {
        return bytes32(0);
    }
    
    function isPendingArbitration(bytes32 question_id) external view override returns (bool) {
        return pendingArbitration[question_id];
    }

    function withdraw() external override {
        uint256 amount = balances[msg.sender];
        require(amount > 0, "No balance to withdraw");
        balances[msg.sender] = 0;
        lastWithdrawalRecipient = payable(msg.sender);
        payable(msg.sender).transfer(amount);
    }

    function claimWinnings(
        bytes32 question_id,
        bytes32[] calldata history_hashes,
        address[] calldata addrs,
        uint256[] calldata bonds,
        bytes32[] calldata answers
    ) external override {
        require(history_hashes.length != 0, "Empty history");
        require(
            addrs.length == bonds.length && 
            bonds.length == answers.length,
            "Arrays length mismatch"
        );

        uint256 totalClaim = bounties[question_id];
        for (uint256 i = 0; i < bonds.length; i++) {
            if (answers[i] == bestAnswers[question_id]) {
                totalClaim += bonds[i];
                balances[addrs[i]] += bonds[i];
            }
        }
    }

    // Required interface implementations with minimal mock behavior
    function askQuestionWithMinBond(
        uint256 template_id,
        string calldata question,
        address arbitrator,
        uint32 timeout,
        uint32 opening_ts,
        uint256 nonce,
        uint256 min_bond
    ) external payable override returns (bytes32 question_id) {
        require(template_id != 0, "Empty template");
        require(timeout != 0, "Empty timeout");
        require(opening_ts != 0, "Empty opening ts");
        question_id = keccak256(abi.encodePacked(question, nonce, block.timestamp));
        minBonds[question_id] = min_bond;
        bounties[question_id] = msg.value;
        timeouts[question_id] = timeout;
        arbitrators[question_id] = arbitrator;
        questions[question_id] = question;
        // Set initial finalize timestamp: current block time + timeout
        finalizeTimestamps[question_id] = uint32(block.timestamp + timeout);
        lastQuestionId = question_id;
        return question_id;
    }

    function submitAnswer(bytes32 question_id, bytes32 answer, uint256) external payable override {
        bestAnswers[question_id] = answer;
        // Update finalize timestamp: current time + timeout
        finalizeTimestamps[question_id] = uint32(block.timestamp + timeouts[question_id]);
    }

    function getFinalAnswer(bytes32 question_id) external view override returns (bytes32) {
        require(finalizedStatus[question_id], "Question not finalized");
        return bestAnswers[question_id];
    }

    function resultFor(bytes32 question_id) external view override returns (bytes32) {
        return bestAnswers[question_id];
    }

    function getArbitrator(bytes32 question_id) external view override returns (address) {
        return arbitrators[question_id];
    }

    function getContentHash(bytes32) external pure override returns (bytes32) {
        return bytes32(0);
    }

    function getMinBond(bytes32 question_id) external view override returns (uint256) {
        return minBonds[question_id];
    }

    function isSettledTooSoon(bytes32) external pure override returns (bool) {
        return false;
    }

    function fundAnswerBounty(bytes32 question_id) external payable override {
        bounties[question_id] += msg.value;
    }

    function createTemplate(string calldata) external pure override returns (uint256) {
        return 0;
    }

    function createTemplateAndAskQuestion(
        string calldata content,
        string calldata question,
        address arbitrator,
        uint32 timeout,
        uint32 opening_ts,
        uint256 nonce
    ) external payable override returns (bytes32) {
        require(bytes(content).length != 0, "Empty content");
        return this.askQuestion(0, question, arbitrator, timeout, opening_ts, nonce);
    }

    function reopenQuestion(
        uint256,
        string calldata,
        address,
        uint32,
        uint32,
        uint256,
        uint256,
        bytes32
    ) external payable override returns (bytes32) {
        return bytes32(0);
    }

    function submitAnswerByArbitrator(
        bytes32 question_id,
        bytes32 answer,
        address
    ) external override {
        bestAnswers[question_id] = answer;
        finalizedStatus[question_id] = true;
    }

    function assignWinnerAndSubmitAnswerByArbitrator(
        bytes32 question_id,
        bytes32 answer,
        address,
        bytes32,
        bytes32,
        address
    ) external override {
        bestAnswers[question_id] = answer;
        finalizedStatus[question_id] = true;
    }

    function submitAnswerCommitment(
        bytes32,
        bytes32,
        uint256,
        address
    ) external payable override {}

    function submitAnswerReveal(
        bytes32,
        bytes32,
        uint256,
        uint256
    ) external override {}

    function claimMultipleAndWithdrawBalance(
        bytes32[] calldata,
        uint256[] calldata,
        bytes32[] calldata,
        address[] calldata,
        uint256[] calldata,
        bytes32[] calldata
    ) external override {}

    function setQuestionFee(uint256 fee_) external override {
        questionFee = fee_;
    }

    function notifyOfArbitrationRequest(
        bytes32,
        address,
        uint256
    ) external override {}

    function cancelArbitration(bytes32) external override {}

    function getFinalAnswerIfMatches(
        bytes32 question_id,
        bytes32,
        address,
        uint32,
        uint256
    ) external view override returns (bytes32) {
        if (finalizedStatus[question_id]) {
            return bestAnswers[question_id];
        }
        return bytes32(0);
    }

    function resultForOnceSettled(bytes32 question_id) external view override returns (bytes32) {
        return bestAnswers[question_id];
    }

    // Helper functions for testing
    function setBestAnswer(bytes32 questionId, bytes32 answer) external {
        bestAnswers[questionId] = answer;
    }

    function setFinalized(bytes32 questionId, bool _isFinalized) external {
        finalizedStatus[questionId] = _isFinalized;
    }

    function setBalance(address account, uint256 amount) external {
        balances[account] = amount;
    }

    // New setter for pending arbitration status
    function setPendingArbitration(bytes32 questionId, bool _isPending) external {
        pendingArbitration[questionId] = _isPending;
    }

    // New setter for finalize timestamp
    function setFinalizeTimestamp(bytes32 questionId, uint32 timestamp) external {
        finalizeTimestamps[questionId] = timestamp;
    }

    // fallback to receive ether
    receive() external payable {}
}
