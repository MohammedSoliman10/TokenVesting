// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { Script } from "forge-std/Script.sol";
import { console } from "forge-std/console.sol";
import { TestToken } from "../src/TestToken.sol";
import { VestingFactory } from "../src/VestingFactory.sol";

/// @title Deploy
/// @notice T024 — deploys `TestToken` + `VestingFactory` and writes the addresses
///         and contract ABIs into `frontend/src/contracts/` so the frontend only
///         ever consumes generated artifacts (never hand-copied ABIs, FR-013).
/// @dev Uses forge cheatcodes only (`vm.readFile`, `vm.serializeAddress`,
///      `vm.writeJson`); the T002 `fs_permissions` already allow reading `./out`
///      and read-write access to `./frontend/src/contracts`.
contract Deploy is Script {
    /// @dev JSON punctuation recognized by the ABI extractor.
    bytes1 private constant QUOTE = hex"22";
    bytes1 private constant BACKSLASH = hex"5C";
    bytes1 private constant OPEN_BRACKET = hex"5B";
    bytes1 private constant CLOSE_BRACKET = hex"5D";

    /// @notice Reverts when a forge artifact no longer contains the expected `"abi":[` array.
    error ArtifactLayoutUnexpected();

    /// @notice Deploys both contracts, then writes addresses + ABIs for this chain.
    /// @dev Safe to re-run: ABIs are overwritten in place and the address entry is
    ///      merged under this chain's id, so other chains' deployments survive.
    /// @return token The freshly deployed TestToken.
    /// @return factory The freshly deployed VestingFactory.
    function run() external returns (TestToken token, VestingFactory factory) {
        vm.startBroadcast();
        token = new TestToken();
        factory = new VestingFactory();
        vm.stopBroadcast();

        // 1) ABIs: extract each artifact's `"abi":[...]` array and overwrite the
        //    placeholder files the frontend smoke tests already guard.
        _writeAbi("out/TestToken.sol/TestToken.json", "frontend/src/contracts/abis/TestToken.json");
        _writeAbi(
            "out/VestingFactory.sol/VestingFactory.json",
            "frontend/src/contracts/abis/VestingFactory.json"
        );

        // 2) Addresses: merge under this chain's id (`31337` on anvil,
        //    `11155111` on Sepolia) without clobbering other chains (FR-013).
        string memory deployments =
            vm.serializeAddress("deployments", "VestingFactory", address(factory));
        deployments = vm.serializeAddress("deployments", "TestToken", address(token));
        vm.writeJson(
            deployments, "frontend/src/contracts/deployments.json", vm.toString(block.chainid)
        );

        console.log("chainid        ", block.chainid);
        console.log("TestToken      ", address(token));
        console.log("VestingFactory ", address(factory));
    }

    /// @dev Reads a forge artifact, extracts the JSON array at `"abi":`, and
    ///      writes it to `destination` (the frontend's committed ABI location).
    function _writeAbi(string memory artifactPath, string memory destination) private {
        string memory artifact = vm.readFile(artifactPath);
        vm.writeJson(_extractJsonArray(artifact, "abi"), destination);
    }

    /// @dev Returns the raw JSON text of the array following `"key":` inside `json`.
    ///      The scan tracks JSON string state, so `[`/`]` inside values such as
    ///      `"type":"uint256[]"` cannot unbalance the depth counter.
    function _extractJsonArray(string memory json, string memory key)
        private
        pure
        returns (string memory)
    {
        bytes memory data = bytes(json);
        bytes memory needle = bytes(string.concat("\"", key, "\":"));

        uint256 needleAt = _indexOf(data, needle);
        if (needleAt == type(uint256).max) {
            revert ArtifactLayoutUnexpected();
        }

        // Skip whitespace between `"abi":` and the opening `[`.
        uint256 i = needleAt + needle.length;
        while (i < data.length && _isJsonSpace(data[i])) {
            i++;
        }
        if (i >= data.length || data[i] != OPEN_BRACKET) {
            revert ArtifactLayoutUnexpected();
        }
        uint256 open = i;

        // Walk to the matching `]` that closes this array.
        bool inString;
        bool escaped;
        uint256 depth;
        while (i < data.length) {
            bytes1 char = data[i];
            i++;
            if (escaped) {
                escaped = false;
            } else if (inString) {
                if (char == BACKSLASH) {
                    escaped = true;
                } else if (char == QUOTE) {
                    inString = false;
                }
            } else if (char == QUOTE) {
                inString = true;
            } else if (char == OPEN_BRACKET) {
                depth++;
            } else if (char == CLOSE_BRACKET) {
                depth--;
                if (depth == 0) {
                    break;
                }
            }
        }
        if (depth != 0) {
            revert ArtifactLayoutUnexpected();
        }

        // Slice `[open, i)` — from the opening `[` through the closing `]`.
        bytes memory extracted = new bytes(i - open);
        for (uint256 j = 0; j < extracted.length; j++) {
            extracted[j] = data[open + j];
        }
        return string(extracted);
    }

    /// @dev First index of `needle` in `haystack`, or `type(uint256).max` if absent.
    function _indexOf(bytes memory haystack, bytes memory needle) private pure returns (uint256) {
        if (needle.length > haystack.length) {
            return type(uint256).max;
        }
        uint256 lastStart = haystack.length - needle.length;
        for (uint256 i = 0; i <= lastStart; i++) {
            bool matched = true;
            for (uint256 j = 0; j < needle.length; j++) {
                if (haystack[i + j] != needle[j]) {
                    matched = false;
                    break;
                }
            }
            if (matched) {
                return i;
            }
        }
        return type(uint256).max;
    }

    /// @dev True for the four JSON whitespace characters (RFC 8259).
    function _isJsonSpace(bytes1 char) private pure returns (bool) {
        return char == 0x20 || char == 0x09 || char == 0x0a || char == 0x0d;
    }
}
