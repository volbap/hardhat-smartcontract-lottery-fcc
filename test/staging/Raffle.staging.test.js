const { assert, expect } = require("chai")
const { getNamedAccounts, deployments, ethers } = require("hardhat")
const { developmentChains, networkConfig } = require("../../helper-hardhat-config")

if (developmentChains.includes(network.name)) {
    describe.skip
    return
}

// What we need to perform tests in staging:

// 1. Get our subscriptionId for Chainlink VRF (vrf.chain.link -> Add subscription)
// 2. Deploy our contract using the subscriptionId (put subscriptionId in helper-hardhat-config, $ hh deploy --network goerli)
// 3. Register the contract with Chainlink VRF & its subscriptionId (vrf.chain.link -> select subscription -> add consumers -> paste deployed contract address from goerli)
// 4. Register the contract with Chainlink Keepers (automation.chain.link -> register new upkeep)
// 5. Run staging tests

// All these steps can be done programatically, but for now we'll do them using the vrf.chain.link website.

describe("Raffle Staging Tests", () => {
    let raffle, raffleEntranceFee, deployer

    beforeEach(async () => {
        deployer = (await getNamedAccounts()).deployer
        raffle = await ethers.getContract("Raffle", deployer)
        entranceFee = await raffle.getEntranceFee()
    })

    describe("fulfillRandomWords", () => {
        it("works with live Chainlink Keepers and Chainlink VRF, we get a random winner", async () => {
            // enter the raffle
            const startingTimestamp = await raffle.getLatestTimestamp()
            // setup listener before we enter the raffle
            // just in case the blockchain moves too fast

            await new Promise(async (resolve, reject) => {
                raffle.once("WinnerPicked", async () => {
                    console.log("WinnerPicked event fired!")
                    resolve()
                    try {
                        // add our asserts here
                        const recentWinner = await raffle.getRecentWinner()
                        const accounts = await ethers.getSigners()
                        const winnerEndingBalance = await accounts[0].getBalance()
                        const endingTimestamp = await raffle.getLastestTimestamp()

                        // there should be no players
                        await expect(raffle.getPlayer(0)).to.be.reverted
                        // winner should be deployer account
                        assert.equal(recentWinner.toString(), accounts[0].address)
                        // raffle state should be 0 = open
                        assert.equal(raffleState, 0)
                        // money should have been transfered to winner
                        assert.equal(
                            winnerEndingBalance.toString(),
                            winnerStartingBalance.add(entranceFee).toString()
                        )
                        // timestamp should be updated
                        assert(endingTimestamp > startingTimestamp)
                        resolve()
                    } catch (error) {
                        console.log(error)
                        reject(error)
                    }
                })

                // enter the raffle now
                console.log("Entering raffle...")
                const tx = await raffle.enterRaffle({ value: entranceFee })
                await tx.wait(1)
                console.log("Entered raffle, time to wait for the keeper to trigger...")
                const winnerStartingBalance = await accounts[0].getBalance()

                // and this code WON'T complete until our listener has finished listening!
            })
        })
    })
})
