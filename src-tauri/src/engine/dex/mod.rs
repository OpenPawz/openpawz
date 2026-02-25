// Paw Agent Engine — DEX Trading Module (Uniswap V3 / EVM)
//
// Split from the monolithic dex.rs into focused submodules:
//   constants      — contract addresses, token list, fee defaults
//   primitives     — keccak256, hex encode/decode, address utils, amount conversion
//   abi            — ABI encoding for all contract calls + encode_transfer
//   rlp            — RLP encoding for EIP-1559 transaction serialisation
//   tx             — EIP-1559 transaction signing
//   rpc            — JSON-RPC helpers (eth_call, eth_sendRawTransaction, etc.)
//   tokens         — token symbol / address resolution
//   wallet         — wallet creation (keygen + vault storage)
//   swap           — quote + swap execution
//   portfolio      — balance / portfolio queries
//   transfer       — ETH and ERC-20 outbound transfers
//   token_analysis — token info + honeypot safety check
//   discovery      — DexScreener search + trending
//   monitoring     — whale scanner, watch-wallet, top-traders

pub(crate) mod abi;
pub(crate) mod constants;
mod discovery;
mod monitoring;
mod portfolio;
pub(crate) mod primitives;
pub(crate) mod rlp;
pub(crate) mod rpc;
mod swap;
mod token_analysis;
pub(crate) mod tokens;
mod transfer;
pub(crate) mod tx;
mod wallet;

// Re-export all public execute functions (called from engine/tools/dex.rs via crate::engine::dex::*)
pub use discovery::{execute_dex_search_token, execute_dex_trending};
pub use monitoring::{
    execute_dex_top_traders, execute_dex_watch_wallet, execute_dex_whale_transfers,
};
pub use portfolio::{execute_dex_balance, execute_dex_portfolio};
pub use swap::{execute_dex_quote, execute_dex_swap};
pub use token_analysis::{execute_dex_check_token, execute_dex_token_info};
pub use transfer::execute_dex_transfer;
pub use wallet::execute_dex_wallet_create;
