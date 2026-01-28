/**
 * FDC utilities for the POLYFLUX keeper
 * Based on Flare's official FDC patterns
 */

import { ethers } from "ethers";
import { toUtf8HexString, sleep } from "./core";
import { Config } from "../types";

// ============ ABIs ============

export const REGISTRY_ABI = ["function getContractAddressByName(string name) view returns (address)"];

export const FDC_HUB_ABI = ["function requestAttestation(bytes calldata data) external payable returns (bool)"];

export const FEE_CONFIG_ABI = ["function getRequestFee(bytes calldata data) view returns (uint256)"];

export const RELAY_ABI = ["function isFinalized(uint256 protocolId, uint256 votingRoundId) view returns (bool)"];

export const SYSTEMS_MANAGER_ABI = [
    "function firstVotingRoundStartTs() view returns (uint64)",
    "function votingEpochDurationSeconds() view returns (uint64)",
];

export const FDC_VERIFICATION_ABI = ["function fdcProtocolId() view returns (uint256)"];

// Contract Registry address (same on all Flare networks)
export const CONTRACT_REGISTRY = "0xaD67FE66660Fb8dFE9d6b1b4240d8650e30F6019";

// ============ FDC FUNCTIONS ============

export async function prepareAttestationRequestBase(
    url: string,
    apiKey: string,
    attestationTypeBase: string,
    sourceIdBase: string,
    requestBody: any
): Promise<{ abiEncodedRequest: string }> {
    console.log("Url:", url, "\n");
    const attestationType = toUtf8HexString(attestationTypeBase);
    const sourceId = toUtf8HexString(sourceIdBase);

    const request = {
        attestationType: attestationType,
        sourceId: sourceId,
        requestBody: requestBody,
    };
    console.log("Prepared request:\n", request, "\n");

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "X-API-KEY": apiKey,
            "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
    });
    if (response.status !== 200) {
        const text = await response.text();
        throw new Error(`Response status is not OK, status ${response.status} ${response.statusText}: ${text}\n`);
    }
    console.log("Response status is OK\n");

    return (await response.json()) as { abiEncodedRequest: string };
}

export async function calculateRoundId(
    provider: ethers.JsonRpcProvider,
    systemsManager: ethers.Contract,
    blockNumber: number
): Promise<number> {
    const block = await provider.getBlock(blockNumber);
    if (!block) throw new Error("Block not found");

    const blockTimestamp = BigInt(block.timestamp);

    const firstVotingRoundStartTs = BigInt(await systemsManager.firstVotingRoundStartTs());
    const votingEpochDurationSeconds = BigInt(await systemsManager.votingEpochDurationSeconds());

    console.log("Block timestamp:", blockTimestamp, "\n");
    console.log("First voting round start ts:", firstVotingRoundStartTs, "\n");
    console.log("Voting epoch duration seconds:", votingEpochDurationSeconds, "\n");

    const roundId = Number((blockTimestamp - firstVotingRoundStartTs) / votingEpochDurationSeconds);
    console.log("Calculated round id:", roundId, "\n");

    return roundId;
}

export async function submitAttestationRequest(
    fdcHub: ethers.Contract,
    feeConfig: ethers.Contract,
    abiEncodedRequest: string
): Promise<{ txHash: string; receipt: ethers.TransactionReceipt }> {
    // Get fee
    const fee = await feeConfig.getRequestFee(abiEncodedRequest);
    console.log(`Fee: ${ethers.formatEther(fee)} FLR\n`);

    // Submit
    const tx = await fdcHub.requestAttestation(abiEncodedRequest, { value: fee });
    console.log("Submitted request:", tx.hash, "\n");

    const receipt = await tx.wait();
    if (!receipt) throw new Error("Transaction failed");

    return { txHash: tx.hash, receipt };
}

export async function waitForRoundFinalization(
    relay: ethers.Contract,
    protocolId: number,
    roundId: number
): Promise<void> {
    console.log(`Waiting for round ${roundId} to finalize...`);
    while (!(await relay.isFinalized(protocolId, roundId))) {
        process.stdout.write(".");
        await sleep(30000);
    }
    console.log("\nRound finalized!\n");
}

export async function retrieveProofFromDALayer(
    daLayerUrl: string,
    abiEncodedRequest: string,
    roundId: number
): Promise<{ proof: string[]; response_hex: string }> {
    const url = `${daLayerUrl}api/v1/fdc/proof-by-request-round-raw`;
    console.log("DA Layer URL:", url, "\n");

    const request = {
        votingRoundId: roundId,
        requestBytes: abiEncodedRequest,
    };

    await sleep(10000); // Wait for DA layer to generate proof

    const maxAttempts = 20;

    for (let attempts = 0; attempts < maxAttempts; attempts++) {
        const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(request),
        });

        if (response.ok) {
            const data = (await response.json()) as { proof: string[]; response_hex: string };
            if (data.response_hex) {
                console.log("Proof retrieved!\n");
                return data;
            }
        }

        await sleep(5000);
    }

    throw new Error("Failed to retrieve proof from DA layer");
}

export async function getContractAddressByName(registry: ethers.Contract, name: string): Promise<string> {
    return await registry.getContractAddressByName(name);
}
