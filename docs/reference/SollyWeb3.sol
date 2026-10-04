// REFERENCE ONLY. Test ERC-20 for local/testnet use. In the real project install OpenZeppelin via forge install and use remappings, not GitHub URL imports.
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/token/ERC20/ERC20.sol";
import "https://github.com/OpenZeppelin/openzeppelin-contracts/blob/master/contracts/access/Ownable.sol";

contract SollyWeb3 is ERC20, Ownable {
    constructor(string memory name, string memory symbol)
        ERC20(name, symbol)
        Ownable(msg.sender)
    {}

    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
}
