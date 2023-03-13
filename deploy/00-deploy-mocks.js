const { developmentChains } = require("../helper-hardhat-config")
const { network, ethers } = require("hardhat")

const BASE_FEE = ethers.utils.parseEther("0.25") // aka Premium (oracle gas per request)
const GAS_PRICE_LINK = 1e9 // (link per gas) calculated value based on the gas price of the chain.

module.exports = async function ({ getNamedAccounts, deployments }) {
    const { deploy, log } = deployments
    const { deployer } = await getNamedAccounts()
    const args = [BASE_FEE, GAS_PRICE_LINK]

    if (developmentChains.includes(network.name)) {
        log("Local network detected! 📦 Deploying mocks...")
        // Deploy a mock VRFCoordinator
        await deploy("VRFCoordinatorV2Mock", {
            from: deployer,
            log: true,
            args: args,
        })
        log("Mocks deployed!")
    }
}

module.exports.tags = ["all", "mocks"]
