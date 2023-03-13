// Raffle

// Enter the lottery (paying some amount)

// Pick a random winner (Chainlink VRF)

// Winner to be selected every X minutes -> completely automated (Chainlink Keepers)

// SPDX-License-Identifier: MIT

pragma solidity ^0.8.7;

import "@chainlink/contracts/src/v0.8/interfaces/VRFCoordinatorV2Interface.sol";
import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AutomationCompatibleInterface.sol";
import "hardhat/console.sol";

error Raffle__NotEnoughETHEntered();
error Raffle__TransferFailed();
error Raffle__NotOpen();
error Raffle__UpkeepNotNeeded(uint256 currentBalance, uint256 numPlayers, uint256 raffleState);

/** @title A sample Raffle Contract
 * @author Pablo Villar
 * @notice This contract is for creating an untamperable decentralized smart contract
 * @dev This implements Chainlink VRF v2 and Chainlink Keepers
 */
contract Raffle is VRFConsumerBaseV2, AutomationCompatibleInterface {
    /* Types */
    enum RaffleState {
        OPEN, // 0
        CALCULATING // 1
    }

    /* State Variables */
    uint256 private immutable i_entranceFee;
    address payable[] private s_players;

    /* Lottery variables */
    address payable private s_recentWinner;
    RaffleState private s_raffleState;
    uint256 private s_lastTimestamp;

    // Chainlink-related parameters
    VRFCoordinatorV2Interface private immutable i_vrfCoordinator;
    bytes32 private immutable i_gasLane; // see https://docs.chain.link/vrf/v2/subscription/supported-networks#goerli-testnet)
    uint64 private immutable i_subscriptionId; // chainlink's VRF subscription ID
    uint16 private constant REQUEST_CONFIRMATIONS = 3;
    uint32 private immutable i_callbackGasLimit;
    uint32 private constant NUM_WORDS = 1;
    uint256 private immutable i_interval;

    /* Events */
    event RaffleEntered(address indexed player);
    event RequestedRaffleWinner(uint256 indexed requestId);
    event WinnerPicked(address indexed winner);

    /* Functions */
    constructor(
        address vrfCoordinator,
        uint256 _entranceFee,
        bytes32 _gasLane,
        uint64 _subscriptionId,
        uint32 _callbackGasLimit,
        uint256 _interval
    ) VRFConsumerBaseV2(vrfCoordinator) {
        i_vrfCoordinator = VRFCoordinatorV2Interface(vrfCoordinator);
        i_entranceFee = _entranceFee;
        i_gasLane = _gasLane;
        i_subscriptionId = _subscriptionId;
        i_callbackGasLimit = _callbackGasLimit;
        s_raffleState = RaffleState.OPEN;
        s_lastTimestamp = block.timestamp;
        i_interval = _interval;
    }

    function enterRaffle() public payable {
        if (msg.value < i_entranceFee) {
            revert Raffle__NotEnoughETHEntered();
        }
        if (s_raffleState != RaffleState.OPEN) {
            revert Raffle__NotOpen();
        }
        s_players.push(payable(msg.sender));
        emit RaffleEntered(msg.sender);
    }

    /**
     * @dev This is the function that the Chainlink Keeper nodes call
     * they look for the `upkeepNeeeded` to return true.
     * The following should be true in order to return true:
     * 1. Our time interval should have passed,
     * 2. The lottery should have at least 1 player and have some ETH,
     * 3. Our subscription is funded with LINK,
     * 4. The lottery should be in an "open" state.
     */
    function checkUpkeep(
        bytes memory /* checkData */
    ) public view override returns (bool upkeepNeeded, bytes memory /* performData */) {
        bool isOpen = (RaffleState.OPEN == s_raffleState);
        bool timePassed = ((block.timestamp - s_lastTimestamp) > i_interval);
        bool hasPlayers = (s_players.length > 0);
        bool hasBalance = address(this).balance > 0;
        upkeepNeeded = (isOpen && timePassed && hasPlayers && hasBalance);
        return (upkeepNeeded, "0x0"); // can we comment this out?
    }

    // This function will be called by the Chainlink Keepers network
    // `external` = only external calls; this contract can't call it
    function performUpkeep(bytes calldata /* performData */) external override {
        (bool upkeepNeeded, ) = checkUpkeep("");
        if (!upkeepNeeded) {
            revert Raffle__UpkeepNotNeeded(
                address(this).balance,
                s_players.length,
                uint256(s_raffleState)
            );
        }
        // Pick a random winner
        s_raffleState = RaffleState.CALCULATING;
        uint256 requestId = i_vrfCoordinator.requestRandomWords(
            i_gasLane, // keyHash
            i_subscriptionId,
            REQUEST_CONFIRMATIONS,
            i_callbackGasLimit,
            NUM_WORDS
        );
        emit RequestedRaffleWinner(requestId);
    }

    // `internal override` = we're overriding from `VRFConsumerBaseV2`
    function fulfillRandomWords(
        uint256, // requestId (we're not using it)
        uint256[] memory _randomWords
    ) internal override {
        console.log("fulfillRandomWords called");
        // Convert the huge `randomWords` into a meaningful random number to us
        // Let's use modulo (remainder)
        uint256 indexOfWinner = _randomWords[0] % s_players.length;
        s_recentWinner = s_players[indexOfWinner];
        s_raffleState = RaffleState.OPEN;
        s_players = new address payable[](0);
        s_lastTimestamp = block.timestamp;
        (bool success, ) = s_recentWinner.call{value: address(this).balance}("");
        if (!success) {
            revert Raffle__TransferFailed();
        }
        emit WinnerPicked(s_recentWinner);
    }

    /* View / Pure functions */

    function getEntranceFee() public view returns (uint256) {
        return i_entranceFee;
    }

    function getPlayer(uint256 _index) public view returns (address) {
        return s_players[_index];
    }

    function getRecentWinner() public view returns (address) {
        return s_recentWinner;
    }

    function getRaffleState() public view returns (RaffleState) {
        return s_raffleState;
    }

    function getNumWords() public pure returns (uint256) {
        return NUM_WORDS;
    }

    function getNumberOfPlayers() public view returns (uint256) {
        return s_players.length;
    }

    function getLatestTimestamp() public view returns (uint256) {
        return s_lastTimestamp;
    }

    function getRequestConfirmations() public pure returns (uint256) {
        return REQUEST_CONFIRMATIONS;
    }

    function getInterval() public view returns (uint256) {
        return i_interval;
    }

    function getBalance() public view returns (uint256) {
        return address(this).balance;
    }
}
