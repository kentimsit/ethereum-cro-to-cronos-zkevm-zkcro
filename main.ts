import { Provider as ZkProvider, Wallet as ZkWallet } from "zksync-ethers";
import { ethers } from "ethers";

import dotenv from "dotenv";
dotenv.config();

// CRO amount should be greater than 2, because you should conservatively have 2 extra zkCRO to pay for L2 fees during the deposit
const CRO_AMOUNT = 5;
console.log("CRO amount to be converted: " + CRO_AMOUNT.toString());
const ETHEREUM_CRO_ADDRESS = "0xa0b73e1ff0b80914ab6fe0444e65848c4c34450b";
const ETHEREUM_ZKCRO_ADDRESS = "0x28Ff2E4dD1B58efEB0fC138602A28D5aE81e44e2";
const ETHEREUM_MAINNET_URL = process.env.ETHEREUM_MAINNET_URL;
const MY_PRIVATE_KEY = process.env.MY_PRIVATE_KEY;
const MY_WALLET = new ethers.Wallet(MY_PRIVATE_KEY!);
const MY_ADDRESS = MY_WALLET.address;
console.log("The origin and destination address are the same", MY_ADDRESS);

// Careful, CRO has 8 decimals on Ethereum mainnet
const croAmountWei = ethers.parseUnits(CRO_AMOUNT.toString(), 8);

async function approveSpender() {
    console.log("\nApproving zkCRO contract as a CRO spender...");
    const l1Provider = new ethers.JsonRpcProvider(ETHEREUM_MAINNET_URL);
    const l1Signer = new ethers.Wallet(MY_PRIVATE_KEY!, l1Provider);
    const croContract = new ethers.Contract(
        ETHEREUM_CRO_ADDRESS,
        [
            "function approve(address _spender, uint256 _value) external returns (bool)",
        ],
        l1Signer
    );
    const approveTx = await croContract.approve(
        ETHEREUM_ZKCRO_ADDRESS,
        croAmountWei
    );
    let tx_hash = approveTx.hash;
    console.log("Transaction created on Ethereum L1: " + tx_hash);
    let txReceipt = await approveTx.wait();
    if (txReceipt) {
        console.log(
            "Transaction included on L1 in block: " +
                txReceipt.blockNumber.toString()
        );
    }
}

async function stakeCRO() {
    console.log("\nStaking CRO on zkCRO contract...");
    const l1Provider = new ethers.JsonRpcProvider(ETHEREUM_MAINNET_URL);
    const l1Signer = new ethers.Wallet(MY_PRIVATE_KEY!, l1Provider);
    const zkcroContract = new ethers.Contract(
        ETHEREUM_ZKCRO_ADDRESS,
        [
            {
                inputs: [
                    {
                        internalType: "address",
                        name: "_receiver",
                        type: "address",
                    },
                    {
                        internalType: "uint256",
                        name: "_amount",
                        type: "uint256",
                    },
                ],
                name: "stake",
                outputs: [
                    {
                        internalType: "uint256",
                        name: "",
                        type: "uint256",
                    },
                ],
                stateMutability: "nonpayable",
                type: "function",
            },
        ],
        l1Signer
    );
    const stakeTx = await zkcroContract.stake(MY_ADDRESS, croAmountWei);
    let tx_hash = stakeTx.hash;
    console.log("Transaction created on Ethereum L1: " + tx_hash);
    let stakeReceipt = await stakeTx.wait();
    if (stakeReceipt) {
        console.log(
            "Transaction included on L1 in block: " +
                stakeReceipt.blockNumber.toString()
        );
    }
}

async function depositZkCRO() {
    console.log("\nPreparing to deposit zkCRO from L1 to L2...");
    const l1Provider = new ethers.JsonRpcProvider(ETHEREUM_MAINNET_URL);
    const l2Provider = new ZkProvider("https://mainnet.zkevm.cronos.org");
    const l1Wallet = new ethers.Wallet(MY_PRIVATE_KEY!, l1Provider);
    const l2Wallet = new ZkWallet(MY_PRIVATE_KEY!, l2Provider, l1Provider);
    console.log("From wallet:", MY_ADDRESS);

    // Get the zkCRO balance
    const zkcroContract = new ethers.Contract(
        ETHEREUM_ZKCRO_ADDRESS,
        [
            {
                inputs: [
                    {
                        internalType: "address",
                        name: "account",
                        type: "address",
                    },
                ],
                name: "balanceOf",
                outputs: [
                    {
                        internalType: "uint256",
                        name: "",
                        type: "uint256",
                    },
                ],
                stateMutability: "view",
                type: "function",
            },
        ],
        l1Provider
    );

    const zkCROBalanceWei = await zkcroContract.balanceOf(MY_ADDRESS);
    // Careful, zkCRO has 18 decimals on Ethereum
    const zkCROBalance = ethers.formatUnits(zkCROBalanceWei, 18);
    console.log("zkCRO balance:", zkCROBalance);
    const zkCroSetAsideForFees = 2;
    console.log(
        "To be set aside for Cronos zkEVM fees:",
        zkCroSetAsideForFees,
        "zkCRO"
    );
    console.log(
        "zkCRO balance to be deposited to Cronos zkEVM:",
        parseFloat(zkCROBalance) - zkCroSetAsideForFees
    );
    const depositAmountWei = ethers.parseUnits(
        (parseFloat(zkCROBalance) - zkCroSetAsideForFees).toString(),
        18
    );

    const tx = await l2Wallet.deposit({
        token: ETHEREUM_ZKCRO_ADDRESS,
        amount: depositAmountWei,
        to: MY_ADDRESS,
        approveERC20: true,
        approveBaseERC20: true,
    });
    const txHash = tx.hash;
    console.log("Transaction created on Ethereum L1:", txHash);
    const txReceipt = await tx.wait();
    if (tx && txReceipt) {
        const l1TxReceipt = await l1Provider.getTransactionReceipt(txHash);
        if (l1TxReceipt) {
            console.log(
                "Transaction included on L1 in block:",
                l1TxReceipt.blockNumber
            );
            const l1GasUsed = l1TxReceipt.gasUsed;
            const l1GasPrice = l1TxReceipt.gasPrice;
            const l1TxFeeWei = l1GasUsed * l1GasPrice;
            const l1TxFee = ethers.formatUnits(l1TxFeeWei, "ether");
            console.log("Transaction fee:", l1TxFee, "ETH");
            console.log(
                "Transaction included on L2 in block:",
                txReceipt.blockNumber
            );
            const l2GasUsed = txReceipt.gasUsed;
            const l2GasPrice = txReceipt.gasPrice;
            const l2TxFeeWei = l2GasUsed * l2GasPrice;
            const l2TxFee = ethers.formatUnits(l2TxFeeWei, "ether");
            console.log("Transaction fee:", l2TxFee, "zkCRO");
            console.log("Retrieving the corresponding L2 transaction...");
            let keepWaiting = true;
            while (keepWaiting) {
                try {
                    await new Promise((resolve) => setTimeout(resolve, 15000));
                    // Finding the corresponding L2 transaction
                    const updatedL1Tx = await l1Provider.getTransaction(txHash);
                    if (updatedL1Tx) {
                        const l2TxResponse =
                            await l2Provider.getL2TransactionFromPriorityOp(
                                updatedL1Tx
                            );
                        if (l2TxResponse) {
                            console.log(
                                "l2TxResponse hash: ",
                                l2TxResponse.hash
                            );
                            keepWaiting = false;
                        }
                        keepWaiting = false;
                    }
                } catch (e) {
                    // console.error(e);
                    console.log(
                        "Could not retrieve the L2 transaction yet... will keep trying ..."
                    );
                }
            }
        }
    }
}

async function main() {
    // console.log(
    //     "WARNING: After CRO conversion into zkCRO, almost all the entire zkCRO balance of",
    //     MY_ADDRESS,
    //     "will be deposited to Cronos zkEVM mainnet."
    // );
    // // Wait 10 seconds
    // console.log(
    //     "Waiting 10 seconds, type CTRL/CMD-C if you change your mind..."
    // );
    // await new Promise((resolve) => setTimeout(resolve, 10000));
    // await approveSpender();
    // // Wait 5 seconds
    // console.log("Waiting 10 seconds...");
    // await new Promise((resolve) => setTimeout(resolve, 10000));
    // await stakeCRO();
    // // Wait 5 seconds
    // console.log("Waiting 10 seconds...");
    // await new Promise((resolve) => setTimeout(resolve, 10000));
    await depositZkCRO();
    console.log("Done\n\n");
}

// Call main function and catch errors
main().catch(console.error);
