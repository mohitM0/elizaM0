import {
    composeContext,
    generateObjectDeprecated,
    ModelClass,
    type IAgentRuntime,
    type Memory,
    type State,
} from "@elizaos/core";
import {
    createConfig,
    executeRoute,
    ExtendedChain,
    getRoutes,
} from "@lifi/sdk";
import { WalletProvider } from "../providers/wallet";
import { swapTemplate } from "../templates";
import type { SwapParams, Transaction } from "../types";
import { formatEther } from "viem";

export { swapTemplate };

export class SwapAction {
    private config;

    constructor(private walletProvider: WalletProvider) {
        this.config = createConfig({
            integrator: "eliza",
            chains: Object.values(this.walletProvider.chains).map((config) => ({
                id: config.id,
                name: config.name,
                key: config.name.toLowerCase(),
                chainType: "EVM" as const,
                nativeToken: {
                    ...config.nativeCurrency,
                    chainId: config.id,
                    address: "0x0000000000000000000000000000000000000000",
                    coinKey: config.nativeCurrency.symbol,
                    priceUSD: "0",
                    logoURI: "",
                    symbol: config.nativeCurrency.symbol,
                    decimals: config.nativeCurrency.decimals,
                    name: config.nativeCurrency.name,
                },
                rpcUrls: {
                    public: { http: [config.rpcUrls.default.http[0]] },
                },
                blockExplorerUrls: [config.blockExplorers.default.url],
                metamask: {
                    chainId: `0x${config.id.toString(16)}`,
                    chainName: config.name,
                    nativeCurrency: config.nativeCurrency,
                    rpcUrls: [config.rpcUrls.default.http[0]],
                    blockExplorerUrls: [config.blockExplorers.default.url],
                },
                coin: config.nativeCurrency.symbol,
                mainnet: true,
                diamondAddress: "0x0000000000000000000000000000000000000000",
            })) as ExtendedChain[],
        });
    }

    async swap(params: SwapParams): Promise<Transaction> {
        const walletClient = this.walletProvider.getWalletClient(params.chain);
        const [fromAddress] = await walletClient.getAddresses();

        const routes = await getRoutes({
            fromChainId: this.walletProvider.getChainConfigs(params.chain).id,
            toChainId: this.walletProvider.getChainConfigs(params.chain).id,
            fromTokenAddress: params.fromToken,
            toTokenAddress: params.toToken,
            fromAmount: params.amount,
            fromAddress: fromAddress,
            options: {
                slippage: params.slippage || 0.5,
                order: "RECOMMENDED",
                fee: 0.02,
                integrator: "elizaM0",
            },
        });

        if (!routes.routes.length) throw new Error("No routes found");

        const execution = await executeRoute(routes.routes[0], this.config);
        const process = execution.steps[0]?.execution?.process[0];

        if (!process?.status || process.status === "FAILED") {
            throw new Error("Transaction failed");
        }

        return {
            hash: process.txHash as `0x${string}`,
            from: fromAddress,
            to: routes.routes[0].steps[0].estimate
                .approvalAddress as `0x${string}`,
            value: BigInt(params.amount),
            data: process.data as `0x${string}`,
            chainId: this.walletProvider.getChainConfigs(params.chain).id,
        };
    }
}

const buildTransferDetails = async (
    state: State,
    runtime: IAgentRuntime,
    wp: WalletProvider
): Promise<SwapParams> => {
    const context = composeContext({
        state,
        template: swapTemplate,
    });

    const chains = Object.keys(wp.chains);

    const contextWithChains = context.replace(
        "SUPPORTED_CHAINS",
        chains.map((item) => `"${item}"`).join("|")
    );

    const transferDetails = (await generateObjectDeprecated({
        runtime,
        context: contextWithChains,
        modelClass: ModelClass.SMALL,
    })) as SwapParams;

    const existingChain = wp.chains[transferDetails.chain];

    if (!existingChain) {
        throw new Error(
            "The chain " +
                transferDetails.chain +
                " not configured yet. Add the chain or choose one from configured: " +
                chains.toString()
        );
    }

    return transferDetails;
};

export const swapAction = {
    name: "swap",
    description: "Swap tokens on the same chain",
    handler: async (
        runtime: IAgentRuntime,
        message: Memory,
        state: State,
        options: any,
        callback?: any
    ) => {
        try {
            const privateKey = runtime.getSetting(
                "EVM_PRIVATE_KEY"
            ) as `0x${string}`;
            console.log("privateKey", privateKey);

            const walletProvider = new WalletProvider(privateKey);
            console.log("walletProvider", walletProvider);

            const action = new SwapAction(walletProvider);
            console.log("action", action);

            const paramOptions = await buildTransferDetails(
                state,
                runtime,
                walletProvider
            );
            console.log("paramOptions", paramOptions);

            try {
                const transferResp = await action.swap(paramOptions);
                if (callback) {
                    callback({
                        text: `Successfully swapped ${paramOptions.amount} tokens \nTransaction Hash: ${transferResp.hash}`,
                        content: {
                            success: true,
                            hash: transferResp.hash,
                            amount: formatEther(transferResp.value),
                            recipient: transferResp.to,
                            chain: paramOptions.chain,
                        },
                    });
                }
                return true;
            } catch (error) {
                console.error("Error during token transfer:", error);
                if (callback) {
                    callback({
                        text: `Error transferring tokens: ${error.message}`,
                        content: { error: error.message },
                    });
                }
                return false;
            }
        } catch (error) {
            console.error("Error in swap handler:", error.message);
            if (callback) {
                callback({ text: `Error: ${error.message}` });
            }
            return false;
        }
    },
    template: swapTemplate,
    validate: async (runtime: IAgentRuntime) => {
        const privateKey = runtime.getSetting("EVM_PRIVATE_KEY");
        return typeof privateKey === "string" && privateKey.startsWith("0x");
    },
    examples: [
        [
            {
                user: "user",
                content: {
                    text: "Swap 1 ETH for USDC on Base",
                    action: "TOKEN_SWAP",
                },
            },
        ],
    ],
    similes: ["TOKEN_SWAP", "EXCHANGE_TOKENS", "TRADE_TOKENS"],
}; // TODO: add more examples
