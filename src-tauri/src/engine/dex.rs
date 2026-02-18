// Paw Agent Engine — DEX Trading (Uniswap / EVM)
// Self-custody Ethereum wallet with on-chain swap execution.
//
// Architecture:
// - Private key stored encrypted in the Skill Vault (OS keychain + SQLite)
// - Key is decrypted ONLY in this Rust module for transaction signing
// - The agent never sees the private key — only tool parameters and tx hashes
// - All swaps go through the Human-in-the-Loop approval modal
// - Trading policy limits (max trade, daily cap) enforced server-side
//
// Supported operations:
// - dex_wallet_create: Generate secp256k1 keypair, store in vault, return address
// - dex_balance: Check ETH + ERC-20 balances via JSON-RPC
// - dex_quote: Get swap quote from Uniswap V3 Quoter
// - dex_swap: Execute swap: quote → approve → build tx → sign → broadcast
// - dex_portfolio: Multi-token balance check

use log::info;
use std::collections::HashMap;
use std::time::Duration;
use tauri::Manager;

// ── Constants ──────────────────────────────────────────────────────────

/// Well-known ERC-20 tokens on Ethereum mainnet
const KNOWN_TOKENS: &[(&str, &str, u8)] = &[
    ("ETH",  "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", 18),
    ("WETH", "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", 18),
    ("USDC", "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", 6),
    ("USDT", "0xdAC17F958D2ee523a2206206994597C13D831ec7", 6),
    ("DAI",  "0x6B175474E89094C44Da98b954EedeAC495271d0F", 18),
    ("WBTC", "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", 8),
    ("UNI",  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", 18),
    ("LINK", "0x514910771AF9Ca656af840dff83E8264EcF986CA", 18),
    ("PEPE", "0x6982508145454Ce325dDbE47a25d4ec3d2311933", 18),
    ("SHIB", "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", 18),
    ("ARB",  "0xB50721BCf8d664c30412Cfbc6cf7a15145234ad1", 18),
    ("AAVE", "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", 18),
];

/// Uniswap V3 contract addresses (Ethereum mainnet)
const UNISWAP_QUOTER_V2: &str = "0x61fFE014bA17989E743c5F6cB21bF9697530B21e";
const UNISWAP_SWAP_ROUTER_02: &str = "0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45";
const WETH_ADDRESS: &str = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";

/// Default slippage tolerance (0.5%)
const DEFAULT_SLIPPAGE_BPS: u64 = 50;
/// Maximum allowed slippage (5%)
const MAX_SLIPPAGE_BPS: u64 = 500;
/// Default fee tier for Uniswap V3 (0.3%)
const DEFAULT_FEE_TIER: u64 = 3000;

// ── Ethereum Primitives ────────────────────────────────────────────────

/// Keccak-256 hash (Ethereum's hash function)
fn keccak256(data: &[u8]) -> [u8; 32] {
    use tiny_keccak::{Hasher, Keccak};
    let mut hasher = Keccak::v256();
    let mut output = [0u8; 32];
    hasher.update(data);
    hasher.finalize(&mut output);
    output
}

/// Hex-encode bytes with 0x prefix
fn hex_encode(data: &[u8]) -> String {
    format!("0x{}", data.iter().map(|b| format!("{:02x}", b)).collect::<String>())
}

/// Hex-decode a 0x-prefixed string
fn hex_decode(s: &str) -> Result<Vec<u8>, String> {
    let s = s.strip_prefix("0x").unwrap_or(s);
    if s.len() % 2 != 0 {
        return Err("Odd-length hex string".into());
    }
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).map_err(|e| format!("Hex decode: {}", e)))
        .collect()
}

/// Derive Ethereum address from secp256k1 public key
fn address_from_pubkey(pubkey_uncompressed: &[u8]) -> String {
    // Skip the 0x04 prefix (uncompressed key marker), hash the 64-byte x||y
    let hash = keccak256(&pubkey_uncompressed[1..]);
    // Address is last 20 bytes
    let addr = &hash[12..];
    // EIP-55 checksum encoding
    eip55_checksum(addr)
}

/// EIP-55 mixed-case checksum address
fn eip55_checksum(addr_bytes: &[u8]) -> String {
    let hex_addr: String = addr_bytes.iter().map(|b| format!("{:02x}", b)).collect();
    let hash = keccak256(hex_addr.as_bytes());
    let mut checksummed = String::with_capacity(42);
    checksummed.push_str("0x");
    for (i, c) in hex_addr.chars().enumerate() {
        let hash_nibble = if i % 2 == 0 { hash[i / 2] >> 4 } else { hash[i / 2] & 0x0f };
        if hash_nibble >= 8 {
            checksummed.push(c.to_ascii_uppercase());
        } else {
            checksummed.push(c);
        }
    }
    checksummed
}

/// Parse an address string to 20 bytes
fn parse_address(addr: &str) -> Result<[u8; 20], String> {
    let bytes = hex_decode(addr)?;
    if bytes.len() != 20 {
        return Err(format!("Invalid address length: {} bytes", bytes.len()));
    }
    let mut arr = [0u8; 20];
    arr.copy_from_slice(&bytes);
    Ok(arr)
}

/// Parse a U256 from decimal string
fn parse_u256_decimal(s: &str) -> Result<[u8; 32], String> {
    // Simple decimal-to-big-endian conversion
    let mut result = [0u8; 32];

    // Handle scientific notation
    if s.contains('e') || s.contains('E') {
        return Err("Scientific notation not supported, use plain decimal".into());
    }

    // Convert decimal string to bytes
    let mut digits: Vec<u8> = Vec::new();
    for c in s.chars() {
        if !c.is_ascii_digit() {
            return Err(format!("Invalid decimal character: {}", c));
        }
        digits.push(c as u8 - b'0');
    }

    // Convert to big-endian bytes using repeated division by 256
    let mut big = digits;
    let mut byte_pos = 31i32;
    while !big.is_empty() && !(big.len() == 1 && big[0] == 0) && byte_pos >= 0 {
        let mut remainder = 0u16;
        let mut quotient = Vec::new();
        for &d in &big {
            let val = remainder * 10 + d as u16;
            let q = val / 256;
            remainder = val % 256;
            if !quotient.is_empty() || q > 0 {
                quotient.push(q as u8);
            }
        }
        result[byte_pos as usize] = remainder as u8;
        byte_pos -= 1;
        big = quotient;
    }
    Ok(result)
}

/// Convert a token amount with decimals to raw units
/// e.g., "1.5" with 18 decimals → "1500000000000000000"
fn amount_to_raw(amount: &str, decimals: u8) -> Result<String, String> {
    let parts: Vec<&str> = amount.split('.').collect();
    if parts.len() > 2 {
        return Err("Invalid amount format".into());
    }
    let integer_part = parts[0];
    let decimal_part = if parts.len() == 2 { parts[1] } else { "" };

    if decimal_part.len() > decimals as usize {
        return Err(format!("Too many decimal places (max {} for this token)", decimals));
    }

    let padded_decimals = format!("{:0<width$}", decimal_part, width = decimals as usize);
    let raw = format!("{}{}", integer_part, padded_decimals);
    // Strip leading zeros but keep at least "0"
    let trimmed = raw.trim_start_matches('0');
    if trimmed.is_empty() { Ok("0".into()) } else { Ok(trimmed.into()) }
}

/// Convert raw units to human-readable amount
fn raw_to_amount(raw_hex: &str, decimals: u8) -> Result<String, String> {
    let raw_bytes = hex_decode(raw_hex)?;
    // Convert big-endian bytes to decimal string
    let mut value = Vec::new();
    for &b in &raw_bytes {
        // Multiply existing value by 256 and add new byte
        let mut carry = b as u16;
        for d in value.iter_mut().rev() {
            let val = *d as u16 * 256 + carry;
            *d = (val % 10) as u8;
            carry = val / 10;
        }
        while carry > 0 {
            value.insert(0, (carry % 10) as u8);
            carry /= 10;
        }
    }
    if value.is_empty() {
        value.push(0);
    }

    let decimal_str: String = value.iter().map(|d| (d + b'0') as char).collect();

    if decimals == 0 {
        return Ok(decimal_str);
    }

    let dec = decimals as usize;
    if decimal_str.len() <= dec {
        let padded = format!("{:0>width$}", decimal_str, width = dec + 1);
        let (int_part, frac_part) = padded.split_at(padded.len() - dec);
        Ok(format!("{}.{}", int_part, frac_part.trim_end_matches('0')).trim_end_matches('.').to_string())
    } else {
        let (int_part, frac_part) = decimal_str.split_at(decimal_str.len() - dec);
        let trimmed_frac = frac_part.trim_end_matches('0');
        if trimmed_frac.is_empty() {
            Ok(int_part.to_string())
        } else {
            Ok(format!("{}.{}", int_part, trimmed_frac))
        }
    }
}

// ── ABI Encoding ───────────────────────────────────────────────────────

/// Compute 4-byte function selector from signature
fn function_selector(sig: &str) -> [u8; 4] {
    let hash = keccak256(sig.as_bytes());
    let mut sel = [0u8; 4];
    sel.copy_from_slice(&hash[..4]);
    sel
}

/// ABI-encode an address (left-padded to 32 bytes)
fn abi_encode_address(addr: &[u8; 20]) -> Vec<u8> {
    let mut encoded = vec![0u8; 12]; // 12 zero bytes
    encoded.extend_from_slice(addr);
    encoded
}

/// ABI-encode a uint256 from big-endian bytes
fn abi_encode_uint256(val: &[u8; 32]) -> Vec<u8> {
    val.to_vec()
}

/// ABI-encode a uint24 (fee tier) as uint256
fn abi_encode_uint24_as_uint256(val: u32) -> Vec<u8> {
    let mut encoded = vec![0u8; 32];
    encoded[29] = ((val >> 16) & 0xFF) as u8;
    encoded[30] = ((val >> 8) & 0xFF) as u8;
    encoded[31] = (val & 0xFF) as u8;
    encoded
}

/// Encode ERC-20 balanceOf(address)
fn encode_balance_of(address: &[u8; 20]) -> Vec<u8> {
    let selector = function_selector("balanceOf(address)");
    let mut data = selector.to_vec();
    data.extend_from_slice(&abi_encode_address(address));
    data
}

/// Encode ERC-20 approve(address, uint256)
fn encode_approve(spender: &[u8; 20], amount: &[u8; 32]) -> Vec<u8> {
    let selector = function_selector("approve(address,uint256)");
    let mut data = selector.to_vec();
    data.extend_from_slice(&abi_encode_address(spender));
    data.extend_from_slice(&abi_encode_uint256(amount));
    data
}

/// Encode ERC-20 allowance(owner, spender)
fn encode_allowance(owner: &[u8; 20], spender: &[u8; 20]) -> Vec<u8> {
    let selector = function_selector("allowance(address,address)");
    let mut data = selector.to_vec();
    data.extend_from_slice(&abi_encode_address(owner));
    data.extend_from_slice(&abi_encode_address(spender));
    data
}

/// Encode Uniswap V3 QuoterV2.quoteExactInputSingle
/// quoteExactInputSingle((address,address,uint256,uint24,uint160))
fn encode_quote_exact_input_single(
    token_in: &[u8; 20],
    token_out: &[u8; 20],
    amount_in: &[u8; 32],
    fee: u32,
) -> Vec<u8> {
    let selector = function_selector("quoteExactInputSingle((address,address,uint256,uint24,uint160))");
    let mut data = selector.to_vec();

    // Struct is encoded inline as: token_in, token_out, amountIn, fee, sqrtPriceLimitX96
    data.extend_from_slice(&abi_encode_address(token_in));
    data.extend_from_slice(&abi_encode_address(token_out));
    data.extend_from_slice(&abi_encode_uint256(amount_in));
    data.extend_from_slice(&abi_encode_uint24_as_uint256(fee));
    data.extend_from_slice(&[0u8; 32]); // sqrtPriceLimitX96 = 0 (no limit)
    data
}

/// Encode Uniswap V3 SwapRouter02.exactInputSingle
/// exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
fn encode_exact_input_single(
    token_in: &[u8; 20],
    token_out: &[u8; 20],
    fee: u32,
    recipient: &[u8; 20],
    amount_in: &[u8; 32],
    amount_out_minimum: &[u8; 32],
) -> Vec<u8> {
    let selector = function_selector("exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))");
    let mut data = selector.to_vec();

    data.extend_from_slice(&abi_encode_address(token_in));
    data.extend_from_slice(&abi_encode_address(token_out));
    data.extend_from_slice(&abi_encode_uint24_as_uint256(fee));
    data.extend_from_slice(&abi_encode_address(recipient));
    data.extend_from_slice(&abi_encode_uint256(amount_in));
    data.extend_from_slice(&abi_encode_uint256(amount_out_minimum));
    data.extend_from_slice(&[0u8; 32]); // sqrtPriceLimitX96 = 0
    data
}

// ── RLP Encoding ───────────────────────────────────────────────────────

/// RLP-encode a single byte string
fn rlp_encode_bytes(data: &[u8]) -> Vec<u8> {
    if data.len() == 1 && data[0] < 0x80 {
        return data.to_vec();
    }
    if data.is_empty() {
        return vec![0x80];
    }
    if data.len() <= 55 {
        let mut encoded = vec![(0x80 + data.len()) as u8];
        encoded.extend_from_slice(data);
        encoded
    } else {
        let len_bytes = to_minimal_be_bytes(data.len());
        let mut encoded = vec![(0xb7 + len_bytes.len()) as u8];
        encoded.extend_from_slice(&len_bytes);
        encoded.extend_from_slice(data);
        encoded
    }
}

/// RLP-encode a list of already-RLP-encoded items
fn rlp_encode_list(items: &[Vec<u8>]) -> Vec<u8> {
    let payload: Vec<u8> = items.iter().flat_map(|i| i.clone()).collect();
    if payload.len() <= 55 {
        let mut encoded = vec![(0xc0 + payload.len()) as u8];
        encoded.extend_from_slice(&payload);
        encoded
    } else {
        let len_bytes = to_minimal_be_bytes(payload.len());
        let mut encoded = vec![(0xf7 + len_bytes.len()) as u8];
        encoded.extend_from_slice(&len_bytes);
        encoded.extend_from_slice(&payload);
        encoded
    }
}

/// Convert usize to minimal big-endian byte representation
fn to_minimal_be_bytes(val: usize) -> Vec<u8> {
    if val == 0 { return vec![]; }
    let bytes = val.to_be_bytes();
    let first_nonzero = bytes.iter().position(|&b| b != 0).unwrap_or(bytes.len() - 1);
    bytes[first_nonzero..].to_vec()
}

/// Encode a u64 as minimal big-endian bytes (for RLP)
fn u64_to_minimal_be(val: u64) -> Vec<u8> {
    if val == 0 { return vec![]; }
    let bytes = val.to_be_bytes();
    let first_nonzero = bytes.iter().position(|&b| b != 0).unwrap_or(bytes.len() - 1);
    bytes[first_nonzero..].to_vec()
}

/// Encode a u256 (big-endian [u8; 32]) as minimal big-endian bytes
fn u256_to_minimal_be(val: &[u8; 32]) -> Vec<u8> {
    let first_nonzero = val.iter().position(|&b| b != 0);
    match first_nonzero {
        Some(pos) => val[pos..].to_vec(),
        None => vec![], // represents zero
    }
}

// ── EIP-1559 Transaction Building & Signing ────────────────────────────

/// Build and sign an EIP-1559 (Type 2) transaction
fn sign_eip1559_transaction(
    chain_id: u64,
    nonce: u64,
    max_priority_fee_per_gas: u64,
    max_fee_per_gas: u64,
    gas_limit: u64,
    to: &[u8; 20],
    value: &[u8; 32],
    data: &[u8],
    private_key: &k256::ecdsa::SigningKey,
) -> Result<Vec<u8>, String> {
    // EIP-1559 unsigned tx: 0x02 || RLP([chain_id, nonce, max_priority_fee, max_fee, gas, to, value, data, access_list])
    let items = vec![
        rlp_encode_bytes(&u64_to_minimal_be(chain_id)),
        rlp_encode_bytes(&u64_to_minimal_be(nonce)),
        rlp_encode_bytes(&u64_to_minimal_be(max_priority_fee_per_gas)),
        rlp_encode_bytes(&u64_to_minimal_be(max_fee_per_gas)),
        rlp_encode_bytes(&u64_to_minimal_be(gas_limit)),
        rlp_encode_bytes(to),
        rlp_encode_bytes(&u256_to_minimal_be(value)),
        rlp_encode_bytes(data),
        rlp_encode_list(&[]), // access_list (empty)
    ];

    let unsigned_rlp = rlp_encode_list(&items);

    // Hash = keccak256(0x02 || unsigned_rlp)
    let mut to_hash = vec![0x02u8];
    to_hash.extend_from_slice(&unsigned_rlp);
    let tx_hash = keccak256(&to_hash);

    // Sign with secp256k1
    let (signature, recovery_id) = private_key
        .sign_prehash_recoverable(&tx_hash)
        .map_err(|e| format!("Transaction signing failed: {}", e))?;

    let sig_bytes = signature.to_bytes();
    let r = &sig_bytes[..32];
    let s = &sig_bytes[32..];
    let v = recovery_id.to_byte(); // 0 or 1

    // Signed tx: 0x02 || RLP([chain_id, nonce, max_priority_fee, max_fee, gas, to, value, data, access_list, v, r, s])
    let mut signed_items = items;
    signed_items.push(rlp_encode_bytes(&[v]));
    signed_items.push(rlp_encode_bytes(r));
    signed_items.push(rlp_encode_bytes(s));

    let signed_rlp = rlp_encode_list(&signed_items);

    let mut result = vec![0x02u8];
    result.extend_from_slice(&signed_rlp);
    Ok(result)
}

// ── JSON-RPC Helpers ───────────────────────────────────────────────────

async fn rpc_call(
    rpc_url: &str,
    method: &str,
    params: serde_json::Value,
) -> Result<serde_json::Value, String> {
    let client = reqwest::Client::new();
    let body = serde_json::json!({
        "jsonrpc": "2.0",
        "method": method,
        "params": params,
        "id": 1
    });

    let resp = client
        .post(rpc_url)
        .json(&body)
        .timeout(Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("RPC request failed: {}", e))?;

    let result: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| format!("RPC response parse error: {}", e))?;

    if let Some(error) = result.get("error") {
        return Err(format!("RPC error: {}", error));
    }

    result.get("result")
        .cloned()
        .ok_or_else(|| "RPC response missing 'result' field".into())
}

/// Get ETH balance of an address
async fn eth_get_balance(rpc_url: &str, address: &str) -> Result<String, String> {
    let result = rpc_call(rpc_url, "eth_getBalance", serde_json::json!([address, "latest"])).await?;
    result.as_str().map(String::from).ok_or("Invalid balance result".into())
}

/// Call a contract (read-only)
async fn eth_call(rpc_url: &str, to: &str, data: &[u8]) -> Result<String, String> {
    let result = rpc_call(rpc_url, "eth_call", serde_json::json!([
        { "to": to, "data": hex_encode(data) },
        "latest"
    ])).await?;
    result.as_str().map(String::from).ok_or("Invalid eth_call result".into())
}

/// Get the next nonce for an address
async fn eth_get_transaction_count(rpc_url: &str, address: &str) -> Result<u64, String> {
    let result = rpc_call(rpc_url, "eth_getTransactionCount", serde_json::json!([address, "latest"])).await?;
    let hex = result.as_str().ok_or("Invalid nonce result")?;
    u64::from_str_radix(hex.strip_prefix("0x").unwrap_or(hex), 16)
        .map_err(|e| format!("Parse nonce: {}", e))
}

/// Get current gas fees (EIP-1559)
async fn get_gas_fees(rpc_url: &str) -> Result<(u64, u64), String> {
    // Get base fee from latest block
    let block = rpc_call(rpc_url, "eth_getBlockByNumber", serde_json::json!(["latest", false])).await?;
    let base_fee_hex = block.get("baseFeePerGas")
        .and_then(|v| v.as_str())
        .ok_or("Missing baseFeePerGas")?;
    let base_fee = u64::from_str_radix(base_fee_hex.strip_prefix("0x").unwrap_or(base_fee_hex), 16)
        .map_err(|e| format!("Parse base fee: {}", e))?;

    // Priority fee: reasonable default of 1.5 gwei
    let max_priority_fee = 1_500_000_000u64; // 1.5 gwei

    // Max fee = 2 * base_fee + priority fee (gives room for next block)
    let max_fee = base_fee * 2 + max_priority_fee;

    Ok((max_priority_fee, max_fee))
}

/// Estimate gas for a transaction
async fn eth_estimate_gas(
    rpc_url: &str,
    from: &str,
    to: &str,
    data: &[u8],
    value: &str,
) -> Result<u64, String> {
    let result = rpc_call(rpc_url, "eth_estimateGas", serde_json::json!([{
        "from": from,
        "to": to,
        "data": hex_encode(data),
        "value": value
    }])).await?;
    let hex = result.as_str().ok_or("Invalid gas estimate")?;
    let estimate = u64::from_str_radix(hex.strip_prefix("0x").unwrap_or(hex), 16)
        .map_err(|e| format!("Parse gas estimate: {}", e))?;
    // Add 20% buffer
    Ok(estimate * 120 / 100)
}

/// Broadcast a signed transaction
async fn eth_send_raw_transaction(rpc_url: &str, signed_tx: &[u8]) -> Result<String, String> {
    let result = rpc_call(rpc_url, "eth_sendRawTransaction", serde_json::json!([hex_encode(signed_tx)])).await?;
    result.as_str().map(String::from).ok_or("Invalid tx hash result".into())
}

/// Get chain ID
async fn eth_chain_id(rpc_url: &str) -> Result<u64, String> {
    let result = rpc_call(rpc_url, "eth_chainId", serde_json::json!([])).await?;
    let hex = result.as_str().ok_or("Invalid chain ID")?;
    u64::from_str_radix(hex.strip_prefix("0x").unwrap_or(hex), 16)
        .map_err(|e| format!("Parse chain ID: {}", e))
}

/// Get transaction receipt (to check if tx was mined)
async fn eth_get_transaction_receipt(rpc_url: &str, tx_hash: &str) -> Result<Option<serde_json::Value>, String> {
    let result = rpc_call(rpc_url, "eth_getTransactionReceipt", serde_json::json!([tx_hash])).await?;
    if result.is_null() { Ok(None) } else { Ok(Some(result)) }
}

// ── Token Helpers ──────────────────────────────────────────────────────

/// Resolve a token symbol or address to (address, decimals)
fn resolve_token(symbol_or_address: &str) -> Result<(String, u8), String> {
    let input = symbol_or_address.trim().to_uppercase();

    // Check known tokens by symbol
    for (sym, addr, dec) in KNOWN_TOKENS {
        if input == *sym {
            return Ok((addr.to_string(), *dec));
        }
    }

    // Check if it's an address
    let lower = symbol_or_address.trim().to_lowercase();
    if lower.starts_with("0x") && lower.len() == 42 {
        // Unknown token — assume 18 decimals (caller can override)
        return Ok((symbol_or_address.trim().to_string(), 18));
    }

    Err(format!(
        "Unknown token '{}'. Use a known symbol ({}) or provide the ERC-20 contract address.",
        symbol_or_address,
        KNOWN_TOKENS.iter().map(|(s, _, _)| *s).collect::<Vec<_>>().join(", ")
    ))
}

/// For swaps, if token_in is "ETH" we need to use WETH as the Uniswap input
fn resolve_for_swap(symbol_or_address: &str) -> Result<(String, u8, bool), String> {
    let input = symbol_or_address.trim().to_uppercase();
    if input == "ETH" {
        // Swap uses WETH but sends ETH value
        Ok((WETH_ADDRESS.to_string(), 18, true))
    } else {
        let (addr, dec) = resolve_token(symbol_or_address)?;
        Ok((addr, dec, false))
    }
}

// ── Tool Execute Functions ─────────────────────────────────────────────

/// Create a new Ethereum wallet and store the private key in the vault
pub async fn execute_dex_wallet_create(
    _args: &serde_json::Value,
    creds: &HashMap<String, String>,
    app_handle: &tauri::AppHandle,
) -> Result<String, String> {
    // Check if wallet already exists
    if creds.contains_key("DEX_PRIVATE_KEY") && creds.contains_key("DEX_WALLET_ADDRESS") {
        let addr = creds.get("DEX_WALLET_ADDRESS").unwrap();
        return Ok(format!(
            "Wallet already exists!\n\nAddress: {}\n\nTo create a new wallet, first remove the existing credentials in Settings → Skills → DEX Trading.",
            addr
        ));
    }

    // Generate a new secp256k1 keypair
    use k256::ecdsa::SigningKey;
    let signing_key = SigningKey::random(&mut rand::thread_rng());
    let verifying_key = signing_key.verifying_key();

    // Get uncompressed public key bytes
    let pubkey_bytes = verifying_key.to_encoded_point(false);
    let address = address_from_pubkey(pubkey_bytes.as_bytes());

    // Store private key encrypted in vault
    let private_key_hex = hex_encode(&signing_key.to_bytes());

    let state = app_handle.try_state::<crate::engine::commands::EngineState>()
        .ok_or("Engine state not available")?;
    let vault_key = crate::engine::skills::get_vault_key()?;

    let encrypted_key = crate::engine::skills::encrypt_credential(&private_key_hex, &vault_key);
    state.store.set_skill_credential("dex", "DEX_PRIVATE_KEY", &encrypted_key)?;

    let encrypted_addr = crate::engine::skills::encrypt_credential(&address, &vault_key);
    state.store.set_skill_credential("dex", "DEX_WALLET_ADDRESS", &encrypted_addr)?;

    info!("[dex] Created new wallet: {}", address);

    let chain_name = if let Some(rpc_url) = creds.get("DEX_RPC_URL") {
        match eth_chain_id(rpc_url).await {
            Ok(1) => "Ethereum Mainnet",
            Ok(5) => "Goerli Testnet",
            Ok(11155111) => "Sepolia Testnet",
            Ok(137) => "Polygon",
            Ok(42161) => "Arbitrum One",
            Ok(10) => "Optimism",
            Ok(8453) => "Base",
            Ok(id) => return Ok(format!(
                "✅ New wallet created!\n\nAddress: {}\nChain ID: {}\n\n⚠️ This wallet has zero balance. Send ETH to this address to fund it before trading.\n\n🔒 Private key is encrypted and stored in your OS keychain vault. The AI agent never sees it.",
                address, id
            )),
            Err(_) => "Unknown",
        }
    } else {
        "Not connected (configure RPC URL)"
    };

    Ok(format!(
        "✅ New wallet created!\n\nAddress: {}\nNetwork: {}\n\n⚠️ This wallet has zero balance. Send ETH to this address to fund it before trading.\n\n🔒 Private key is encrypted and stored in your OS keychain vault. The AI agent never sees it.",
        address, chain_name
    ))
}

/// Check ETH and ERC-20 token balances
pub async fn execute_dex_balance(
    args: &serde_json::Value,
    creds: &HashMap<String, String>,
) -> Result<String, String> {
    let rpc_url = creds.get("DEX_RPC_URL").ok_or("Missing DEX_RPC_URL. Configure your RPC endpoint (Infura/Alchemy) in Settings → Skills → DEX Trading.")?;
    let wallet_address = creds.get("DEX_WALLET_ADDRESS").ok_or("No wallet found. Use dex_wallet_create first.")?;

    // Optional: specific token to check
    let token = args.get("token").and_then(|v| v.as_str());

    let mut output = format!("Wallet: {}\n\n", wallet_address);

    // Always show ETH balance
    let eth_balance_hex = eth_get_balance(rpc_url, wallet_address).await?;
    let eth_balance = raw_to_amount(&eth_balance_hex, 18)?;
    output.push_str(&format!("ETH: {} ETH\n", eth_balance));

    if let Some(token_sym) = token {
        // Check specific token
        let (token_addr, decimals) = resolve_token(token_sym)?;
        if token_addr != "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE" {
            let wallet_bytes = parse_address(wallet_address)?;
            let calldata = encode_balance_of(&wallet_bytes);
            let result = eth_call(rpc_url, &token_addr, &calldata).await?;
            let balance = raw_to_amount(&result, decimals)?;
            output.push_str(&format!("{}: {}\n", token_sym.to_uppercase(), balance));
        }
    } else {
        // Check common tokens
        let wallet_bytes = parse_address(wallet_address)?;
        for (sym, addr, dec) in KNOWN_TOKENS {
            if *sym == "ETH" { continue; }
            let calldata = encode_balance_of(&wallet_bytes);
            match eth_call(rpc_url, addr, &calldata).await {
                Ok(result) => {
                    if let Ok(balance) = raw_to_amount(&result, *dec) {
                        if balance != "0" {
                            output.push_str(&format!("{}: {}\n", sym, balance));
                        }
                    }
                }
                Err(_) => {} // Skip tokens that fail (might not exist on this chain)
            }
        }
    }

    Ok(output)
}

/// Get a swap quote from Uniswap V3 Quoter
pub async fn execute_dex_quote(
    args: &serde_json::Value,
    creds: &HashMap<String, String>,
) -> Result<String, String> {
    let rpc_url = creds.get("DEX_RPC_URL").ok_or("Missing DEX_RPC_URL")?;
    let token_in_sym = args["token_in"].as_str().ok_or("dex_quote: missing 'token_in'")?;
    let token_out_sym = args["token_out"].as_str().ok_or("dex_quote: missing 'token_out'")?;
    let amount = args["amount"].as_str().ok_or("dex_quote: missing 'amount'")?;

    let (token_in_addr, token_in_dec, _is_eth) = resolve_for_swap(token_in_sym)?;
    let (token_out_addr, token_out_dec, _) = resolve_for_swap(token_out_sym)?;

    let fee_tier = args.get("fee_tier")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_FEE_TIER) as u32;

    // Convert amount to raw units
    let amount_raw = amount_to_raw(amount, token_in_dec)?;
    let amount_u256 = parse_u256_decimal(&amount_raw)?;

    let token_in_bytes = parse_address(&token_in_addr)?;
    let token_out_bytes = parse_address(&token_out_addr)?;

    let calldata = encode_quote_exact_input_single(
        &token_in_bytes,
        &token_out_bytes,
        &amount_u256,
        fee_tier,
    );

    let result = eth_call(rpc_url, UNISWAP_QUOTER_V2, &calldata).await?;

    // The quoter returns (amountOut, sqrtPriceX96After, initializedTicksCrossed, gasEstimate)
    // amountOut is the first 32 bytes
    let result_bytes = hex_decode(&result)?;
    if result_bytes.len() < 32 {
        return Err(format!("Unexpected quoter response length: {} bytes", result_bytes.len()));
    }

    let amount_out_bytes: [u8; 32] = result_bytes[..32].try_into().unwrap();
    let amount_out_hex = hex_encode(&amount_out_bytes);
    let amount_out = raw_to_amount(&amount_out_hex, token_out_dec)?;

    // Calculate price
    let in_f64: f64 = amount.parse().unwrap_or(0.0);
    let out_f64: f64 = amount_out.parse().unwrap_or(0.0);
    let price = if in_f64 > 0.0 { out_f64 / in_f64 } else { 0.0 };

    let slippage_bps = args.get("slippage_bps")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_SLIPPAGE_BPS);

    let min_out = out_f64 * (10000.0 - slippage_bps as f64) / 10000.0;

    Ok(format!(
        "Swap Quote: {} {} → {} {}\n\nInput: {} {}\nExpected Output: {} {}\nMinimum Output ({}% slippage): {:.6} {}\nExchange Rate: 1 {} = {:.6} {}\nFee Tier: {}%\n\nUse dex_swap to execute this trade.",
        amount, token_in_sym.to_uppercase(),
        amount_out, token_out_sym.to_uppercase(),
        amount, token_in_sym.to_uppercase(),
        amount_out, token_out_sym.to_uppercase(),
        slippage_bps as f64 / 100.0,
        min_out, token_out_sym.to_uppercase(),
        token_in_sym.to_uppercase(), price, token_out_sym.to_uppercase(),
        fee_tier as f64 / 10000.0,
    ))
}

/// Execute a token swap on Uniswap V3
pub async fn execute_dex_swap(
    args: &serde_json::Value,
    creds: &HashMap<String, String>,
) -> Result<String, String> {
    let rpc_url = creds.get("DEX_RPC_URL").ok_or("Missing DEX_RPC_URL")?;
    let wallet_address = creds.get("DEX_WALLET_ADDRESS").ok_or("No wallet. Use dex_wallet_create first.")?;
    let private_key_hex = creds.get("DEX_PRIVATE_KEY").ok_or("Missing private key")?;

    let token_in_sym = args["token_in"].as_str().ok_or("dex_swap: missing 'token_in'")?;
    let token_out_sym = args["token_out"].as_str().ok_or("dex_swap: missing 'token_out'")?;
    let amount = args["amount"].as_str().ok_or("dex_swap: missing 'amount'")?;
    let _reason = args["reason"].as_str().unwrap_or("swap");

    let slippage_bps = args.get("slippage_bps")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_SLIPPAGE_BPS);

    if slippage_bps > MAX_SLIPPAGE_BPS {
        return Err(format!("Slippage {}bps exceeds maximum allowed {}bps ({}%)", slippage_bps, MAX_SLIPPAGE_BPS, MAX_SLIPPAGE_BPS as f64 / 100.0));
    }

    let fee_tier = args.get("fee_tier")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_FEE_TIER) as u32;

    let (token_in_addr, token_in_dec, is_eth_in) = resolve_for_swap(token_in_sym)?;
    let (token_out_addr, token_out_dec, _) = resolve_for_swap(token_out_sym)?;

    let amount_raw = amount_to_raw(amount, token_in_dec)?;
    let amount_u256 = parse_u256_decimal(&amount_raw)?;

    let token_in_bytes = parse_address(&token_in_addr)?;
    let token_out_bytes = parse_address(&token_out_addr)?;
    let wallet_bytes = parse_address(wallet_address)?;

    info!("[dex] Swap: {} {} → {} (wallet: {})", amount, token_in_sym, token_out_sym, wallet_address);

    // Step 1: Get quote for minimum output calculation
    let quote_calldata = encode_quote_exact_input_single(
        &token_in_bytes,
        &token_out_bytes,
        &amount_u256,
        fee_tier,
    );

    let quote_result = eth_call(rpc_url, UNISWAP_QUOTER_V2, &quote_calldata).await?;
    let quote_bytes = hex_decode(&quote_result)?;
    if quote_bytes.len() < 32 {
        return Err("Invalid quoter response".into());
    }

    let expected_out: [u8; 32] = quote_bytes[..32].try_into().unwrap();

    // Apply slippage to get minimum output
    let expected_out_hex = hex_encode(&expected_out);
    let expected_out_f64: f64 = raw_to_amount(&expected_out_hex, token_out_dec)?.parse().unwrap_or(0.0);
    let min_out_f64 = expected_out_f64 * (10000.0 - slippage_bps as f64) / 10000.0;
    let min_out_raw = amount_to_raw(&format!("{:.width$}", min_out_f64, width = token_out_dec as usize), token_out_dec)?;
    let min_out_u256 = parse_u256_decimal(&min_out_raw)?;

    // Step 2: If not ETH, check and set token approval
    if !is_eth_in {
        let router_bytes = parse_address(UNISWAP_SWAP_ROUTER_02)?;
        let allowance_data = encode_allowance(&wallet_bytes, &router_bytes);
        let allowance_result = eth_call(rpc_url, &token_in_addr, &allowance_data).await?;
        let allowance_bytes = hex_decode(&allowance_result)?;

        // Check if allowance is sufficient
        let mut needs_approval = true;
        if allowance_bytes.len() >= 32 {
            // Compare: if allowance >= amount, no approval needed
            let allowance_slice: [u8; 32] = allowance_bytes[..32].try_into().unwrap();
            needs_approval = allowance_slice < amount_u256;
        }

        if needs_approval {
            info!("[dex] Approving token {} for router", token_in_addr);
            let max_approval = [0xffu8; 32]; // type(uint256).max
            let approve_data = encode_approve(&router_bytes, &max_approval);

            let pk_bytes = hex_decode(private_key_hex)?;
            let signing_key = k256::ecdsa::SigningKey::from_slice(&pk_bytes)
                .map_err(|e| format!("Invalid private key: {}", e))?;

            let chain_id = eth_chain_id(rpc_url).await?;
            let nonce = eth_get_transaction_count(rpc_url, wallet_address).await?;
            let (priority_fee, max_fee) = get_gas_fees(rpc_url).await?;
            let gas = eth_estimate_gas(rpc_url, wallet_address, &token_in_addr, &approve_data, "0x0").await?;

            let mut token_in_addr_bytes = [0u8; 20];
            token_in_addr_bytes.copy_from_slice(&hex_decode(&token_in_addr)?[..20]);

            let signed_approve = sign_eip1559_transaction(
                chain_id, nonce, priority_fee, max_fee, gas,
                &token_in_addr_bytes, &[0u8; 32], &approve_data, &signing_key,
            )?;

            let approve_hash = eth_send_raw_transaction(rpc_url, &signed_approve).await?;
            info!("[dex] Approval tx: {}", approve_hash);

            // Wait for approval to be mined (poll for up to 60 seconds)
            for _ in 0..30 {
                tokio::time::sleep(Duration::from_secs(2)).await;
                if let Ok(Some(receipt)) = eth_get_transaction_receipt(rpc_url, &approve_hash).await {
                    let status = receipt.get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("0x0");
                    if status == "0x1" {
                        info!("[dex] Token approval confirmed");
                        break;
                    } else {
                        return Err(format!("Token approval transaction failed (reverted). Tx: {}", approve_hash));
                    }
                }
            }
        }
    }

    // Step 3: Build the swap transaction
    let swap_data = encode_exact_input_single(
        &token_in_bytes,
        &token_out_bytes,
        fee_tier,
        &wallet_bytes,
        &amount_u256,
        &min_out_u256,
    );

    let pk_bytes = hex_decode(private_key_hex)?;
    let signing_key = k256::ecdsa::SigningKey::from_slice(&pk_bytes)
        .map_err(|e| format!("Invalid private key: {}", e))?;

    let chain_id = eth_chain_id(rpc_url).await?;
    let nonce = eth_get_transaction_count(rpc_url, wallet_address).await?;
    let (priority_fee, max_fee) = get_gas_fees(rpc_url).await?;

    // Value is the ETH amount if swapping from ETH, otherwise 0
    let value = if is_eth_in { amount_u256 } else { [0u8; 32] };
    let value_hex = if is_eth_in { hex_encode(&value) } else { "0x0".into() };

    let router_bytes = parse_address(UNISWAP_SWAP_ROUTER_02)?;
    let gas = eth_estimate_gas(rpc_url, wallet_address, UNISWAP_SWAP_ROUTER_02, &swap_data, &value_hex).await
        .unwrap_or(300_000); // fallback gas limit for swaps

    let signed_tx = sign_eip1559_transaction(
        chain_id, nonce, priority_fee, max_fee, gas,
        &router_bytes, &value, &swap_data, &signing_key,
    )?;

    // Step 4: Broadcast
    let tx_hash = eth_send_raw_transaction(rpc_url, &signed_tx).await?;
    info!("[dex] Swap tx broadcast: {}", tx_hash);

    // Step 5: Wait for confirmation (up to 2 minutes)
    let mut confirmed = false;
    let mut final_status = "pending";
    for _ in 0..60 {
        tokio::time::sleep(Duration::from_secs(2)).await;
        match eth_get_transaction_receipt(rpc_url, &tx_hash).await {
            Ok(Some(receipt)) => {
                let status = receipt.get("status")
                    .and_then(|v| v.as_str())
                    .unwrap_or("0x0");
                if status == "0x1" {
                    confirmed = true;
                    final_status = "confirmed";
                } else {
                    final_status = "reverted";
                }
                break;
            }
            Ok(None) => continue, // Not mined yet
            Err(_) => continue,
        }
    }

    let network = match chain_id {
        1 => "https://etherscan.io/tx/",
        5 => "https://goerli.etherscan.io/tx/",
        11155111 => "https://sepolia.etherscan.io/tx/",
        137 => "https://polygonscan.com/tx/",
        42161 => "https://arbiscan.io/tx/",
        10 => "https://optimistic.etherscan.io/tx/",
        8453 => "https://basescan.org/tx/",
        _ => "https://etherscan.io/tx/",
    };

    let expected_out_display = raw_to_amount(&expected_out_hex, token_out_dec).unwrap_or("?".into());

    Ok(format!(
        "{} Swap {}\n\n{} {} → ~{} {}\nSlippage tolerance: {}%\nTransaction: {}{}\nStatus: {}\n\n{}",
        if confirmed { "✅" } else { "⚠️" },
        if confirmed { "Confirmed" } else { "Submitted" },
        amount, token_in_sym.to_uppercase(),
        expected_out_display, token_out_sym.to_uppercase(),
        slippage_bps as f64 / 100.0,
        network, tx_hash,
        final_status,
        if !confirmed && final_status == "pending" {
            "Transaction is still pending. Check the explorer link for status."
        } else if final_status == "reverted" {
            "Transaction reverted! The swap may have failed due to slippage or liquidity issues. Your tokens are safe."
        } else { "" },
    ))
}

/// Check multiple token balances at once
pub async fn execute_dex_portfolio(
    args: &serde_json::Value,
    creds: &HashMap<String, String>,
) -> Result<String, String> {
    let rpc_url = creds.get("DEX_RPC_URL").ok_or("Missing DEX_RPC_URL")?;
    let wallet_address = creds.get("DEX_WALLET_ADDRESS").ok_or("No wallet. Use dex_wallet_create first.")?;

    let wallet_bytes = parse_address(wallet_address)?;

    let mut output = format!("📊 Portfolio for {}\n\n", wallet_address);

    // ETH balance
    let eth_hex = eth_get_balance(rpc_url, wallet_address).await?;
    let eth_balance = raw_to_amount(&eth_hex, 18)?;
    output.push_str(&format!("  ETH: {} ETH\n", eth_balance));

    // Check all known tokens
    let mut has_tokens = false;
    for (sym, addr, dec) in KNOWN_TOKENS {
        if *sym == "ETH" { continue; }
        let calldata = encode_balance_of(&wallet_bytes);
        match eth_call(rpc_url, addr, &calldata).await {
            Ok(result) => {
                if let Ok(balance) = raw_to_amount(&result, *dec) {
                    if balance != "0" {
                        output.push_str(&format!("  {}: {}\n", sym, balance));
                        has_tokens = true;
                    }
                }
            }
            Err(_) => {}
        }
    }

    // Also check any custom tokens specified
    if let Some(tokens) = args.get("tokens").and_then(|v| v.as_array()) {
        for token in tokens {
            if let Some(addr) = token.as_str() {
                let calldata = encode_balance_of(&wallet_bytes);
                if let Ok(result) = eth_call(rpc_url, addr, &calldata).await {
                    if let Ok(balance) = raw_to_amount(&result, 18) {
                        if balance != "0" {
                            output.push_str(&format!("  {}: {}\n", addr, balance));
                            has_tokens = true;
                        }
                    }
                }
            }
        }
    }

    if !has_tokens {
        output.push_str("\n  No ERC-20 token balances found.\n");
    }

    // Get chain info
    match eth_chain_id(rpc_url).await {
        Ok(id) => {
            let chain = match id {
                1 => "Ethereum Mainnet",
                5 => "Goerli Testnet",
                11155111 => "Sepolia Testnet",
                137 => "Polygon",
                42161 => "Arbitrum One",
                10 => "Optimism",
                8453 => "Base",
                _ => "Unknown",
            };
            output.push_str(&format!("\nNetwork: {} (chain ID {})\n", chain, id));
        }
        Err(_) => {}
    }

    Ok(output)
}
