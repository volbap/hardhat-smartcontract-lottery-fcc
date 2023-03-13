const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

!developmentChains.includes(network.name)
    ? describe.skip
    : describe("Raffle Unit Tests", () => {
          let raffle, vrfCoordinatorV2Mock, raffleEntranceFee, deployer, interval
          const chainId = network.config.chainId

          beforeEach(async () => {
              deployer = (await getNamedAccounts()).deployer
              await deployments.fixture(["all"]) // deploys raffle and coordinator mock
              raffle = await ethers.getContract("Raffle", deployer)
              interval = await raffle.getInterval()
              vrfCoordinatorV2Mock = await ethers.getContract("VRFCoordinatorV2Mock", deployer)
              raffleEntranceFee = await raffle.getEntranceFee()
          })
          describe("constructor", () => {
              it("initializes the raffle correctly", async () => {
                  const raffleState = await raffle.getRaffleState() // big number
                  assert.equal(raffleState.toString(), "0") // 0 = open
                  assert.equal(interval.toString(), networkConfig[chainId]["interval"])
              })
          })
          describe("enterRaffle", () => {
              it("reverts when you don't pay enough", async () => {
                  await expect(raffle.enterRaffle()).to.be.revertedWith(
                      "Raffle__NotEnoughETHEntered"
                  )
              })
              it("records players when they enter", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  const playerFromContract = await raffle.getPlayer(0)
                  assert.equal(playerFromContract, deployer)
              })
              it("emits event on enter", async () => {
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.emit(
                      raffle,
                      "RaffleEntered"
                  )
              })
              it("doesn't allow entrance when raffle is calculating", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  // Let's manipulate the blockchain so we don't have to wait 30 seconds
                  // More info at https://hardhat.org/hardhat-network/reference
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) // make 30 seconds pass
                  await network.provider.send("evm_mine", []) // mine 1 extra block
                  // At this point `checkUpkeep` should return `true`, so we can call `performUpkeep` to enter
                  // in calculating state...
                  await raffle.performUpkeep([]) // we call it as if we were the chainlink keeper
                  await expect(raffle.enterRaffle({ value: raffleEntranceFee })).to.be.revertedWith(
                      "Raffle__NotOpen"
                  )
              })
          })
          describe("checkUpkeep", () => {
              it("returns false if people haven't sent any ETH", async () => {
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  // `callStatic` simulates the transaction without actually sending it.
                  // This way, we don't alter the blockchain state.
                  // We just need the return value to assert.
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.isFalse(upkeepNeeded)
              })
              it("return false if raffle isn't open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1]) // make 30 seconds pass
                  await network.provider.send("evm_mine", []) // mine 1 extra block
                  await raffle.performUpkeep([])
                  const raffleState = await raffle.getRaffleState()
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.equal(raffleState.toString(), "1") // At this point we should be in calculating state
                  assert.isFalse(upkeepNeeded)
              })
              it("returns false if enough time hasn't passed", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() - 1])
                  await network.provider.send("evm_mine", [])
                  await raffle.performUpkeep([])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.isFalse(upkeepNeeded)
              })
              it("returns true if enough time has passed, has players, eth, and is open", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const { upkeepNeeded } = await raffle.callStatic.checkUpkeep([])
                  assert.isTrue(upkeepNeeded)
              })
          })
          describe("peformUpkeep", () => {
              it("can only run if checkUpkeep is true", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const tx = await raffle.performUpkeep([])
                  assert(tx)
              })
              it("reverts when checkUpkeep is false", async () => {
                  await expect(raffle.performUpkeep([])).to.be.revertedWith(
                      "Raffle__UpkeepNotNeeded"
                  )
              })
              it("updates raffle state, emits event, and calls VRF coordinator", async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
                  const txResponse = await raffle.performUpkeep([])
                  const txReceipt = await txResponse.wait(1)
                  // There will be 2 events:
                  // 0. Emitted by the VRFCoordinator
                  // 1. Emitted by our Raffle.sol <- we want this one, at index 1
                  const requestId = txReceipt.events[1].args.requestId
                  const raffleState = await raffle.getRaffleState()
                  assert(requestId.toNumber() > 0)
                  assert.equal(raffleState.toString(), "1")
              })
          })
          describe("fulfillRandomWords", () => {
              beforeEach(async () => {
                  await raffle.enterRaffle({ value: raffleEntranceFee })
                  await network.provider.send("evm_increaseTime", [interval.toNumber() + 1])
                  await network.provider.send("evm_mine", [])
              })
              it("can only be called after performUpkeep", async () => {
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(0, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
                  await expect(
                      vrfCoordinatorV2Mock.fulfillRandomWords(1, raffle.address)
                  ).to.be.revertedWith("nonexistent request")
              })
              // most interesting test (almost integration test)
              it("picks a winner, resets the lottery and sends money", async () => {
                  /* GIVEN */
                  const accounts = await ethers.getSigners()
                  raffle.connect(accounts[1]).enterRaffle({ value: raffleEntranceFee })
                  raffle.connect(accounts[2]).enterRaffle({ value: raffleEntranceFee })
                  raffle.connect(accounts[3]).enterRaffle({ value: raffleEntranceFee })
                  const startingTimestamp = await raffle.getLatestTimestamp()

                  /* WHEN */

                  // - performUpkeep (mock being chainlink keepers)
                  // - fulfillRandomWords (mock being the Chainlink VRF)
                  // We would have to wait for `fulfillRandomWords` to be called,
                  // but since this is hardhat local we can adjust the blockchain and not wait.

                  // Setting up the listener...
                  // Below, we'll fire the event, and the listener will pick it up and resolve
                  const tx = await raffle.performUpkeep([])
                  const txReceipt = await tx.wait(1)
                  const winnerIndex = 2
                  const winnerStartingBalance = await accounts[winnerIndex].getBalance()
                  await vrfCoordinatorV2Mock.fulfillRandomWordsWithOverride(
                      txReceipt.events[1].args.requestId, // request id
                      raffle.address, // consumer
                      [winnerIndex] // randomWords array
                  )

                  /* THEN */
                  const recentWinner = await raffle.getRecentWinner()
                  console.log(recentWinner)
                  const raffleState = await raffle.getRaffleState()
                  const endingTimestamp = await raffle.getLatestTimestamp()
                  const numPlayers = await raffle.getNumberOfPlayers()
                  const winnerEndingBalance = await accounts[winnerIndex].getBalance()

                  // Make sure state was reset
                  assert.equal(numPlayers.toString(), "0")
                  assert.equal(raffleState.toString(), "0")

                  // Make sure timestamp has been updated
                  assert(endingTimestamp > startingTimestamp)

                  // Make sure money was transfered to winner
                  const raffleBalance = await raffle.getBalance()
                  assert.equal(raffleBalance.toString(), "0")
                  const expectedWinnerBalance = winnerStartingBalance.add(raffleEntranceFee.mul(4))
                  assert.equal(winnerEndingBalance.toString(), expectedWinnerBalance.toString())
              })
          })
      })
